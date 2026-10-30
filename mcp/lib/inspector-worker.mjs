// Runs one inspection in a worker thread: loads a document into the TypeScript player under
// a browser shim (inspector-env.mjs), lays it out, drives frames and taps, and runs the
// inspector's own analysis functions (inspector/src/panels) on the result.
//
// One worker per request. The panels keep module-level state (window.currentDocument, the
// parsed op list, analysis caches), so sharing a process between documents would leak one
// into the next; a worker also gives the caller a clean kill on timeout.
//
// workerData: { bundlePath, panelsDir, bytes (Uint8Array), task, options }
// posts: { ok: true, result } | { ok: false, error }

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { parentPort, workerData } from "node:worker_threads";
import { designAudit, textAudit } from "./design-audit.mjs";
import { installEnvironment } from "./inspector-env.mjs";

const { bundlePath, panelsDir, bytes, task, options: O = {} } = workerData;

installEnvironment();
// Quiet: the player logs freely, and stdout belongs to the MCP transport in stdio mode.
const logs = [];
for (const k of ["log", "info", "debug", "warn", "error"]) {
    console[k] = (...a) => { if (logs.length < 50) logs.push(`${k}: ${a.map(String).join(" ").slice(0, 300)}`); };
}
vm.runInThisContext(readFileSync(bundlePath, "utf8"), { filename: "player.min.js" });
const RC = globalThis.RC;

const P = async (name) => import(pathToFileURL(path.join(panelsDir, `${name}.js`)).href);
const [DL, CL, OPP, DG, LI, RP, DS, PF, ACC, IA, CW, JE, TM, TE, VP] = await Promise.all([
    "DocumentLoader", "CommandListPanel", "OpParameters", "DependencyGraphPanel", "LayoutInspectorPanel",
    "RepaintPanel", "DocumentStatsPanel", "ProfilerPanel", "AccessibilityPanel", "InteractionPanel",
    "ComponentWalk", "JsonEditorPanel", "BinaryTreemapPanel", "ThemeEnvironmentPanel", "VariablesPanel",
].map(P));
window.getOpName = CL.getOpName;

const NV_TYPES = { 0: "string", 1: "float", 2: "color", 4: "int", 5: "long", 6: "float_array" };
const round = (v, d = 2) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
const hex = (c) => "#" + ((c >>> 0).toString(16).toUpperCase().padStart(8, "0"));

// ── Loading and driving ──────────────────────────────────────────────

const density = O.density ?? 1;
const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
// The load lays the document out at the canvas size, so the canvas must already have the
// requested size. Without width/height that is the header's, read from a first load.
if (u8.length < 4 || u8[0] !== 0) {
    // Every document starts with the Header operation, opcode 0.
    throw new Error("not a RemoteCompose document: it does not start with a header operation");
}
async function load(player) {
    try {
        return await player.loadFromArrayBuffer(u8.slice().buffer);
    } catch (e) {
        throw new Error(`the TypeScript player could not read the document (${e?.message ?? e}); ` +
                        "it is truncated or malformed. rc-render's validate shows at which byte and opcode the C++ engine stops.");
    }
}
const probeSize = O.width && O.height ? null : await (async () => {
    const probe = new RC.RcdPlayer(document.createElement("canvas"));
    probe.pause();
    await load(probe);
    return probe.getNaturalSize();
})();
// Layout space: the size the document is laid out at, in its own pixels (CSS px x density).
const width = Math.max(1, Math.round((O.width ?? (probeSize?.width > 0 ? probeSize.width : 400)) * density));
const height = Math.max(1, Math.round((O.height ?? (probeSize?.height > 0 ? probeSize.height : 400)) * density));

// Time: frame i of a session is at i/fps seconds of animation time, and the clock (date and
// time of day) reads clock + i/fps. Both are pinned, so wall time never leaks into a result
// and two calls agree. O.clock is in seconds after RC.pinClock's epoch, 2026-01-01 00:00 local.
const fps = O.fps ?? 60;
const clock0 = O.clock ?? 0;
var sink = null;

/** One loaded, laid-out document with its own player and clock. */
async function createSession() {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const player = new RC.RcdPlayer(canvas);
    player.pause();   // frames are driven by hand, never by requestAnimationFrame
    if (O.theme) player.setTheme(O.theme);
    player.setDensity(density);
    // Measurement is armed before the load so coverage also sees the first layout pass.
    player.setMeasurementSink((m) => sink && sink(m));
    const doc = await load(player);
    const ctx = player.getRemoteContext();
    const S = { player, doc, ctx, frame: 0, natural: player.getNaturalSize() ?? { width: 0, height: 0 } };

    S.namedVars = () => {
        const out = [];
        (ctx?.namedVariables ?? new Map()).forEach(({ id, type }, name) => {
            const t = NV_TYPES[type] ?? `type ${type}`;
            let value = null;
            try {
                if (t === "float") value = round(ctx.getFloat(id), 4);
                else if (t === "int" || t === "long") value = ctx.getInteger(id);
                else if (t === "color") value = hex(ctx.getColor(id));
                else if (t === "string") value = ctx.getText(id);
            } catch {}
            out.push({ name, id, type: t, value });
        });
        return out.sort((a, b) => a.name.localeCompare(b.name));
    };
    S.setVariables = (vars) => {
        const declared = new Map(S.namedVars().map((v) => [v.name, v]));
        for (const [name, value] of Object.entries(vars ?? {})) {
            const v = declared.get(name);
            if (!v) throw new Error(`variables.${name}: the document declares no such variable (it declares: ${[...declared.keys()].join(", ") || "none"})`);
            if (v.type === "float") ctx.setNamedFloatOverride(name, Number(value));
            else if (v.type === "int") ctx.setNamedIntegerOverride(name, Math.trunc(Number(value)));
            else if (v.type === "string") ctx.setNamedStringOverride(name, String(value));
            else if (v.type === "color") {
                const m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(value).trim());
                if (!m) throw new Error(`variables.${name}: colour needs #RRGGBB or #AARRGGBB`);
                ctx.setNamedColorOverride(name, (m[1].length === 6 ? 0xff000000 + parseInt(m[1], 16) : parseInt(m[1], 16)) | 0);
            } else throw new Error(`variables.${name}: ${v.type} variables cannot be set`);
        }
    };
    player.startTime = 0;
    S.paint = () => {
        const t = S.frame / fps;
        RC.pinClock(player, clock0 + t);
        player.renderFrame(t * 1000);
        S.frame++;
    };
    S.frames = (n) => { for (let i = 0; i < n; i++) S.paint(); };
    // A tap the way the web player dispatches one: down, click (no travel), up.
    S.tap = (x, y) => {
        doc.touchDown(ctx, x, y);
        S.paint();
        const clicked = doc.onClick(ctx, x, y);
        doc.touchUp(ctx, x, y, 0, 0);
        S.paint();
        return clicked;
    };
    S.drag = (x0, y0, x1, y1, steps = 8) => {
        doc.touchDown(ctx, x0, y0);
        S.paint();
        for (let i = 1; i <= steps; i++) {
            doc.touchDrag(ctx, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
            S.paint();
        }
        doc.touchUp(ctx, x1, y1, ((x1 - x0) / steps) * fps, ((y1 - y0) / steps) * fps);
        S.paint();
    };
    // Every variable's current value, by id. The state keeps floats and integers apart and
    // an id is either, so both are read: the one that differs between runs is the one that
    // changed.
    S.values = (ids) => {
        const out = new Map();
        for (const id of ids) {
            let f = null, i = null;
            try { f = ctx.getFloat(id); } catch {}
            try { i = ctx.getInteger(id); } catch {}
            out.set(id, { f: typeof f === "number" && !Number.isNaN(f) ? round(f, 4) : null, i: typeof i === "number" ? i : null });
        }
        return out;
    };

    S.setVariables(O.variables);
    RC.pinClock(player, clock0);
    player.resize(width, height);   // lays out (and paints once at wall-clock animation time)
    S.paint();                      // frame 0, at the pinned time
    return S;
}

// A warm-up session first, discarded. The first document a process loads does not behave
// like later ones: flappy.rc's start-up impulse (ImpulseOperation -> RunAction ->
// ValueFloatExpressionChangeAction) runs during that first load, against the wall clock,
// instead of at frame 0 against the pinned one. Every later session is alike, so the
// analysed one and interact's baseline agree, and results do not depend on wall time.
await createSession();
const main = await createSession();
const { player, doc, ctx, natural } = main;
const ops = DL.getAllOperationsFlat(doc, u8);
Object.assign(window, { currentDocument: doc, currentPlayer: player, currentParsedOps: ops, currentBuffer: u8.buffer });
const namedVars = main.namedVars, setVariables = main.setVariables, paint = main.paint, frames = main.frames;

// ── Shared views ─────────────────────────────────────────────────────

const opIndex = new Map(ops.map((op, i) => [op, i]));
const nameOf = (op) => { try { return CL.getOpName(op); } catch { return op?.constructor?.name ?? "?"; } };
const opcodeOf = (op) => op?.OP_CODE ?? op?.constructor?.OP_CODE ?? null;
const idxOf = (op) => (opIndex.has(op) ? opIndex.get(op) : null);
const params = (op, max = 8) => { try { return OPP.formatOpParameters(op, { max }); } catch { return ""; } };
const sizeOf = (op) => (op?._byteEnd ?? 0) - (op?._byteStart ?? 0);
// The formula an expression or constant op defines, in the inspector's notation.
function exprOf(op) {
    const code = opcodeOf(op), name = nameOf(op);
    try {
        if (code === 81 || name.includes("FloatExpression")) {
            const bits = op.mBits || op.bits || op.srcExpression || op.mSrcExpression || op.mFloatExpression || op.mExp || op.exp;
            return bits ? CL.prettyPrintFloatExpression(bits) : null;
        }
        if (code === 144 || code === 82 || name.includes("IntegerExpression")) {
            const vals = op.mValues ?? op.values ?? op.srcExpression ?? op.mSrcExpression;
            return vals ? CL.prettyPrintIntegerExpression(op.mMask ?? op.mask ?? 0, vals) : null;
        }
        if (code === 80 || name === "FloatConstant") return CL.prettyPrintFloatConstant(op);
        if (name === "ColorConstant") return CL.prettyPrintColorConstant(op);
        if (name === "ColorExpression") return CL.prettyPrintColorExpression(op);
        if (name === "NamedVariable") return CL.prettyPrintNamedVariable(op);
    } catch {}
    return null;
}
let graphCache = null;
const graph = () => (graphCache ??= DG.buildExpressionGraphModel(doc));
// Graph node ids are "var_<id>", "sys_<id>" (system variables) or "consumer_<opcode>_<op
// index>" (an operation that reads the value).
const varIdOfNode = (x) => { const m = /^(?:var|sys)_(-?\d+)$/.exec(String(x)); return m ? Number(m[1]) : null; };
const nodeIds = (list) => (list ?? []).map(varIdOfNode).filter((x) => x !== null);
const consumerOps = (list) => (list ?? []).map((x) => /^consumer_\d+_(\d+)$/.exec(String(x))).filter(Boolean).map((m) => Number(m[1]));
const num = (v) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v);
const opRef = (op) => (op ? { index: idxOf(op), op: nameOf(op) } : null);
const bounds = (b) => (b ? { x: round(b.x), y: round(b.y), w: round(b.w ?? b.width), h: round(b.h ?? b.height) } : null);

function header() {
    const h = ops.find((op) => op && op.mMajorVersion !== undefined) ?? {};
    return {
        version: `${h.mMajorVersion ?? "?"}.${h.mMinorVersion ?? "?"}.${h.mPatchVersion ?? "?"}`,
        width: natural.width, height: natural.height, profiles: h.mProfiles ?? null,
        // DOC_CONTENT_DESCRIPTION (9), the document-level accessibility description.
        content_description: (() => { try { return h.get?.(9) ?? null; } catch { return null; } })(),
    };
}

function opcodeHistogram() {
    const m = new Map();
    for (const op of ops) {
        const n = nameOf(op);
        const e = m.get(n) ?? { op: n, count: 0, bytes: 0 };
        e.count++; e.bytes += sizeOf(op);
        m.set(n, e);
    }
    return [...m.values()].sort((a, b) => b.bytes - a.bytes || b.count - a.count);
}

function byteCategories() {
    const t = TM.buildBinaryTreemapModel(doc, ops, u8);
    return {
        total: t.totalBytes,
        categories: Object.values(t.categories).filter((c) => c.totalBytes > 0)
            .map((c) => ({ category: c.name, bytes: c.totalBytes, pct: round(c.pctOfTotal, 1), ops: c.ops.length }))
            .sort((a, b) => b.bytes - a.bytes),
        model: t,
    };
}

function layoutComponents() {
    return LI.extractLayoutComponents(doc);
}

function repaint() {
    const a = RP.analyzeRepaintSchedule(doc, player);
    return {
        verdict: a.verdict, delay_ms: a.delayMs, requested: a.requested,
        causes: (a.causes ?? []).map((c) => ({
            kind: c.kind, label: c.label, value: c.value, winning: Boolean(c.winning), subsumed: Boolean(c.subsumed),
            detail: c.detail, ops: (c.ops ?? []).slice(0, 10).map((o) => opRef(o.op ?? o)).filter(Boolean),
        })),
    };
}

function interactionTargets() {
    return IA.collectInteractionTargets(doc).map((t, i) => ({
        target: i, kind: t.kind,
        ...(t.componentName ? { component: t.componentName, component_id: t.componentId } : {}),
        ...(t.areaId !== undefined ? { area_id: t.areaId, content_description: t.contentDescription ?? null } : {}),
        ...(t.varId !== undefined ? { variable_id: t.varId } : {}),
        ...(t.clickTypeName ? { click_type: t.clickTypeName, dispatchable: t.dispatchable } : {}),
        bounds: bounds(t.bounds), ...(t.bounds ? { center: [round(t.bounds.cx), round(t.bounds.cy)] } : {}),
        op_index: t.idx ?? null,
        actions: (t.actions ?? []).map((a) => ({ op: nameOf(a), index: idxOf(a), params: params(a, 4) })),
    }));
}

function accessibility() {
    const a = ACC.buildAccessibilityTree(doc);
    return {
        has_semantics: a.hasSemantics, document_description: a.documentDescription || header().content_description,
        nodes: a.nodes.map((n) => ({
            component: n.name, id: n.componentId, depth: n.depth, bounds: bounds(n.bounds),
            role: n.role, clickable: n.clickable || Boolean(n.semanticsClickable), enabled: n.enabled,
            content_description: n.contentDescription, text: n.semanticsText, state: n.stateDescription,
            has_semantics: n.hasSemantics,
        })),
        click_areas: (a.areas ?? []).map((x) => ({ id: x.areaId ?? x.id, content_description: x.contentDescription ?? null, bounds: bounds(x.bounds) })),
    };
}

function islands() {
    const a = DG.getUnusedIslandsAnalysis(doc);
    return {
        removable_ops: [...a.removableOpSet].map((op) => (typeof op === "number" ? { index: op, op: nameOf(ops[op]) } : opRef(op))).filter(Boolean),
        removable_count: a.removableOpsCount,
        unused_variable_ids: [...a.unusedVarIdSet],
        island_variable_ids: [...a.unusedIslandSet].map((n) => (typeof n === "string" ? n : n?.varId ?? n)),
    };
}

function variableStats() {
    const v = DS.getCachedVariablesAnalysis(doc, ops, u8.length, u8);
    return {
        total: v.totalVarsCount, named: v.namedVarsCount, constants: v.constCount, expressions: v.expressionsCount,
        bytes: v.totalVarBytes, max_chain_depth: v.maxChainDepth, root_drivers: v.rootDriversCount,
        terminal_sinks: v.terminalSinksCount, dead_orphans: v.deadOrphansCount, fanout: v.fanoutBuckets,
        root_sources: (v.rootSources ?? []).map((r) => ({ id: r.id, name: r.name, dependents: r.depCount })),
    };
}

// ── Audit ────────────────────────────────────────────────────────────

// Components that draw their own content are leaves, not empty containers.
const LEAF = /Text|Image|Bitmap|Canvas|Spacer|Video|Shader|Custom/;

// The inspector's layout diagnostics, minus two kinds of noise: an empty zero-size Box is a
// spacer or placeholder (it is reported as an empty container, not as a sizing bug), and
// leaf components have no children by design. Deep nesting is advice, not a warning.
function layoutDiagnostics(comps) {
    const byKey = new Map(comps.map((c) => [c.key, c]));
    return LI.runLayoutDiagnostics(comps).filter((d) => {
        const c = byKey.get(d.compKey);
        if (!c) return true;
        if (d.type === "empty_container" && LEAF.test(c.name)) return false;
        if (d.type === "zero_size" && c.childCount === 0 && c.drawOpCount === 0 && !c.text) return false;
        if (d.type === "zero_size" && inInactiveAlternative(c, byKey)) return false;
        return true;
    }).map((d) => (d.type === "deep_nesting" ? { ...d, severity: "info" } : d));
}

// Component.Visibility: GONE 0, VISIBLE 1, INVISIBLE 2, or an override in the high bits
// (OVERRIDE_GONE 16, OVERRIDE_VISIBLE 32, OVERRIDE_INVISIBLE 64), which is how a FitBox hides
// the alternatives it doesn't pick.
function notShown(v) {
    if (typeof v !== "number") return false;
    if ((v >> 4) > 0) return (v & 16) === 16 || (v & 64) === 64;
    return v === 0 || v === 2;
}

// Not shown, itself or through an ancestor (a CollapsibleRow/Column hides the children it drops
// with an override GONE; they keep a position, in Java too, but are never drawn).
function hiddenOrUnder(c, byKey) {
    for (let n = c; n; n = byKey.get(n.parentKey)) if (notShown(n.op?.mVisibility)) return true;
    return false;
}

// Inside a StateLayout state or FitBox alternative that isn't the one shown (gone, or laid
// out 0×0 on purpose, in Java too; I10): its zero sizes are not a sizing bug.
function inInactiveAlternative(c, byKey) {
    for (let n = c, p = byKey.get(c.parentKey); p; n = p, p = byKey.get(p.parentKey)) {
        const hidden = notShown(n.op?.mVisibility) || (n.width <= 0 && n.height <= 0);
        if (/StateLayout|FitBox/i.test(p.name) && hidden) return true;
    }
    return false;
}

// Inside a scrolling or clipping ancestor: being outside the layout box is then expected.
function insideViewport(c, byKey) {
    for (let p = byKey.get(c.parentKey); p; p = byKey.get(p.parentKey)) {
        if (p.isScrollable || (p.modifiers ?? []).some((m) => /Clip|Scroll/.test(m.name))) return true;
    }
    return false;
}

// System variables that carry the date (players/typescript/src/json2rc/Expr.ts): month,
// weekday, day of month, epoch seconds, day of year, year.
const DATE_VARS = new Set([9, 11, 12, 32, 34, 35]);

function designFindings() {
    if (O.source_json !== undefined && O.source_json !== null) return designAudit(O.source_json);
    const texts = ops.filter((op) => nameOf(op) === "TextData" && typeof op.mText === "string").map((op) => op.mText);
    let clock = false;
    for (const op of ops) {
        let ids = [];
        try { ids = OPP.getOpVarReferences(op); } catch {}
        if (ids.some((id) => DATE_VARS.has(id))) { clock = true; break; }
    }
    if (!clock) {
        clock = graph().nodes.some((n) => [...(n.inputs ?? [])].some((x) => {
            const m = /^sys_(\d+)$/.exec(String(x));
            return m && DATE_VARS.has(Number(m[1]));
        }));
    }
    return textAudit(texts, { readsClock: clock });
}

function audit() {
    const findings = [];
    const add = (severity, code, title, message, extra = {}) => findings.push({ severity, code, title, message, ...extra });

    // Nothing to show at all.
    const comps = layoutComponents();
    const drawing = ops.some((op) => /^Draw|Text|Bitmap|Canvas/.test(nameOf(op)));
    if (ops.length <= 1 || (comps.length <= 1 && !drawing)) {
        add("error", "empty_document", "The document has no content",
            `${ops.length} operation(s), ${comps.length} component(s) and nothing that draws: it renders blank. ` +
            "If it came from JSON, check the top-level keys (json2rc ignores ones it does not know).");
    }

    // Layout, from the inspector's own diagnostics, grouped per kind.
    const diag = layoutDiagnostics(comps);
    const groups = new Map();
    for (const d of diag) {
        const g = groups.get(d.type) ?? { severity: d.severity, items: [] };
        g.items.push(d);
        groups.set(d.type, g);
    }
    const byKey = new Map(comps.map((c) => [c.key, c]));
    for (const [type, g] of groups) {
        const first = g.items[0];
        add(g.severity, `layout_${type}`, first.title.replace(/\s*\(.*\)$/, "") + (g.items.length > 1 ? ` ×${g.items.length}` : ""),
            first.message.replace(/#\d+/, `#${byKey.get(first.compKey)?.cid ?? "?"}`), {
                count: g.items.length,
                examples: g.items.slice(0, 5).map((d) => {
                    const c = byKey.get(d.compKey);
                    return { component: d.compName, id: c?.cid ?? null, title: d.title, bounds: c ? { x: round(c.globalX), y: round(c.globalY), w: round(c.width), h: round(c.height) } : null };
                }),
            });
    }

    // Content that overflows the layout box.
    const W = width, H = height;
    const outside = comps.filter((c) => c.depth > 0 && c.width > 0 && c.height > 0 && !insideViewport(c, byKey) && !inInactiveAlternative(c, byKey) && !hiddenOrUnder(c, byKey) &&
        (c.globalX + c.width > W + 0.5 || c.globalY + c.height > H + 0.5 || c.globalX < -0.5 || c.globalY < -0.5));
    if (outside.length) {
        add("warning", "layout_overflow", `${outside.length} component(s) extend past the ${W}×${H} layout box`,
            "They are clipped, or scroll if a parent scrolls. Usual causes: fixed sizes larger than the box, or a header size the document no longer matches.",
            { count: outside.length, examples: outside.slice(0, 5).map((c) => ({ component: c.name, id: c.cid, bounds: { x: round(c.globalX), y: round(c.globalY), w: round(c.width), h: round(c.height) } })) });
    }

    // Dead code.
    const isl = islands();
    if (isl.removable_count > 0) {
        add("warning", "dead_code", `${isl.removable_count} operation(s) compute values nothing uses`,
            "Expression chains whose results never reach a draw, layout or output. They can be deleted without changing the rendering.",
            { count: isl.removable_count, ops: isl.removable_ops.slice(0, 20), bytes: isl.removable_ops.reduce((s, r) => s + sizeOf(ops[r.index]), 0) });
    }
    let unusedDefs = [];
    try { unusedDefs = [...CL.getUnusedVariableDefIds(doc, ops)]; } catch {}
    if (unusedDefs.length) {
        add("info", "unused_variables", `${unusedDefs.length} variable(s) are defined but never read`,
            "Their definitions cost bytes and evaluation time for nothing.", { count: unusedDefs.length, variable_ids: unusedDefs.slice(0, 40) });
    }

    // Accessibility.
    const acc = accessibility();
    const targets = interactionTargets();
    const clicks = targets.filter((t) => t.kind === "click");
    if (clicks.length && !acc.has_semantics) {
        add("warning", "a11y_no_semantics", `${clicks.length} clickable component(s), no accessibility semantics`,
            "A screen reader finds nothing to announce for them. Add semantics (role, contentDescription) to interactive components.",
            { count: clicks.length, examples: clicks.slice(0, 5).map((c) => ({ component: c.component, id: c.component_id, bounds: c.bounds })) });
    } else {
        const unlabeled = acc.nodes.filter((n) => n.clickable && !n.content_description && !n.text);
        if (unlabeled.length) {
            add("warning", "a11y_unlabeled_clickable", `${unlabeled.length} clickable component(s) without a label`,
                "Clickable, but with neither a contentDescription nor text: a screen reader announces them as unlabeled.",
                { count: unlabeled.length, examples: unlabeled.slice(0, 5) });
        }
    }
    const undispatchable = clicks.filter((c) => c.dispatchable === false);
    if (undispatchable.length) {
        add("info", "click_types", `${undispatchable.length} long-press / double-tap target(s)`,
            "Only single taps are dispatched by the TypeScript player; these do nothing there.", { count: undispatchable.length });
    }

    // Repaint.
    const rp = repaint();
    if (rp.verdict === "continuous") {
        const w = rp.causes.find((c) => c.winning);
        add("info", "repaint_continuous", "Repaints every frame",
            `${w ? w.label + ". " : ""}Fine for an animation; for a document that should be static it costs battery.`, { cause: w ?? null });
    }

    // Variables.
    const vs = variableStats();
    if (vs.max_chain_depth >= 12) {
        add("info", "deep_expressions", `Expression chains up to ${vs.max_chain_depth} deep`,
            "Long dependency chains are re-evaluated whenever their roots change; flattening them saves work per frame.", { max_chain_depth: vs.max_chain_depth });
    }

    // Size.
    const bc = byteCategories();
    const big = bc.categories[0];
    if (big && bc.total > 20000 && big.pct > 60) {
        add("info", "size_dominated", `${big.category} is ${big.pct}% of ${bc.total} bytes`,
            "One category dominates the file; look there first to make it smaller (inspect_bytes lists the largest operations).", { category: big.category });
    }
    const top = [...ops].map((op, i) => ({ i, s: sizeOf(op) })).sort((a, b) => b.s - a.s)[0];
    if (top && bc.total > 20000 && top.s / bc.total > 0.25) {
        add("info", "size_single_op", `One operation is ${Math.round((top.s / bc.total) * 100)}% of the file`,
            `#${top.i} ${nameOf(ops[top.i])}, ${top.s} bytes — usually an embedded bitmap or font.`, { op: { index: top.i, op: nameOf(ops[top.i]) } });
    }

    // Design: valid, but built in a way that makes it worse (design-audit.mjs). From the JSON
    // as written when there is one; from the text data alone for a binary document.
    try { for (const f of designFindings()) findings.push(f); } catch {}

    // Android caps a float expression at 32 entries (Limits.MAX_EXPRESSION_SIZE): the Java
    // parser and player both reject a longer one, while json2rc, rc2image and the TS player
    // accept it, so the document only fails on a device (EXAMPLES_FINDINGS J39, I19).
    try {
        const long = [];
        for (const op of ops) {
            if (!(opcodeOf(op) === 81 || nameOf(op).includes("FloatExpression"))) continue;
            const bits = op.mBits || op.bits || op.srcExpression || op.mSrcExpression || op.mFloatExpression || op.mExp || op.exp;
            if (bits && bits.length > 32) long.push({ index: idxOf(op), entries: bits.length, expression: exprOf(op) });
        }
        if (long.length) add("warning", "expression_too_long",
            `${long.length} float expression(s) longer than 32 entries`,
            `Android rejects a float expression over 32 entries (operands and operators); the document fails to load there although it renders here. Longest: ${Math.max(...long.map((l) => l.entries))} entries. ` +
            "Split it: compute parts into named `variable`s (or resources.variables) and combine them.",
            { count: long.length, examples: long.slice(0, 5) });
    } catch {}

    // Execution coverage over a short run.
    const cov = runCoverage(O.frames ?? 30);
    if (cov.never.length) {
        add("info", "never_executed", `${cov.never.length} of ${cov.total} operation(s) never executed in ${cov.frames} frames`,
            "Unreached branches (an inactive state, a false condition, a component never shown) or dead code. Interact or set variables to reach them.",
            { count: cov.never.length, ops: cov.never.slice(0, 20) });
    }

    const order = { error: 0, warning: 1, info: 2 };
    findings.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
    const counts = { error: 0, warning: 0, info: 0 };
    for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    return { counts, findings };
}

// ── Runtime ──────────────────────────────────────────────────────────

// The measurement names operations by class, which the minified player shortens; the
// inspector's names come from the opcode instead.
const opNameByCode = new Map(ops.map((op) => [opcodeOf(op), nameOf(op)]));
let measureIds = null;
function opByMeasureId() {
    if (measureIds) return measureIds;
    measureIds = new Map();
    ops.forEach((op, i) => {
        if (!op || typeof op !== "object") return;
        for (const sym of Object.getOwnPropertySymbols(op)) {
            if (sym.description === "rcMeasureId") measureIds.set(op[sym], i);
        }
    });
    return measureIds;
}

function runProfile(n) {
    const acc = { frames: 0, total: 0, peak: 0, last: 0, history: [], types: new Map(), insts: new Map(), badFrames: 0, lastProblem: "", unattributed: 0 };
    sink = (m) => PF.accumulateProfiler(acc, m, player.getOpsPerFrame());
    frames(n);
    sink = null;
    const h = acc.history;
    const sorted = [...h].sort((a, b) => a - b);
    return {
        frames: acc.frames,
        ops_per_frame: h.length ? { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], mean: round(acc.total / acc.frames, 1), max: acc.peak, last: acc.last } : null,
        varying: new Set(h).size > 1,
        by_type: [...acc.types.values()].sort((a, b) => b.total - a.total).slice(0, 15)
            .map((t) => ({ op: opNameByCode.get(t.opCode) ?? t.name, opcode: t.opCode ?? null, per_frame: round(t.total / acc.frames, 1), peak: t.peak })),
        hottest_operations: [...acc.insts.values()].sort((a, b) => b.total - a.total).slice(0, 15)
            .map((t) => {
                const i = opByMeasureId().get(t.id);
                return { index: i ?? null, op: i !== undefined ? nameOf(ops[i]) : (opNameByCode.get(t.opCode) ?? t.name),
                         per_frame: round(t.total / acc.frames, 1), peak: t.peak };
            }),
        unattributed: acc.unattributed,
        mismatched_frames: acc.badFrames,
    };
}

function runCoverage(n) {
    const prof = runProfile(n);
    const c = PF.computeCoverage(doc);
    return {
        frames: prof.frames, total: c.total, executed: c.executed.length,
        never: c.never.map((e) => ({ index: e.idx, op: e.name, params: params(e.op, 4) })),
    };
}

// ── Variables ────────────────────────────────────────────────────────

function variables() {
    const g = graph();
    const usage = CL.getVariableUsageInfo(doc, ops);
    const named = new Map(namedVars().map((v) => [v.id, v]));
    const isl = DG.getUnusedIslandsAnalysis(doc);
    const deadIds = new Set([...isl.unusedVarIdSet]);
    const list = g.nodes.filter((n) => n.type !== "consumer").map((n) => {
        const refs = usage.refMap.get(n.varId) ?? [];
        const nv = named.get(n.varId);
        const sys = VP.getSystemVarName?.(n.varId) ?? null;
        return {
            id: n.varId, name: nv?.name ?? sys ?? null, kind: n.type,
            ...(nv ? { host_type: nv.type, host_value: nv.value } : {}),
            formula: n.formula || (n.op ? exprOf(n.op) : null) || null, value: num(n.value ?? null),
            inputs: nodeIds(n.inputs), outputs: nodeIds(n.outputs),
            consumed_by_ops: consumerOps(n.outputs),
            read_by_ops: refs.length,
            unused: usage.unusedVarIds.has(n.varId) || deadIds.has(n.varId),
            defined_at: n.op ? idxOf(n.op) : null,
        };
    });
    return { list, edges: g.edges.length };
}

function focusVariable(list, key) {
    const byId = new Map(list.map((v) => [v.id, v]));
    const target = list.find((v) => String(v.id) === String(key) || v.name === key);
    if (!target) throw new Error(`no variable "${key}" (give an id, or a host/system variable name)`);
    const walk = (start, dir) => {
        const seen = new Set(), out = [];
        const q = [...(start[dir] ?? [])];
        while (q.length) {
            const id = q.shift();
            if (seen.has(id)) continue;
            seen.add(id);
            const v = byId.get(id);
            if (v) { out.push(v); q.push(...(v[dir] ?? [])); }
        }
        return out;
    };
    const usage = CL.getVariableUsageInfo(doc, ops);
    return {
        variable: target,
        upstream: walk(target, "inputs").map((v) => ({ id: v.id, name: v.name, kind: v.kind, formula: v.formula, value: v.value })),
        downstream: walk(target, "outputs").map((v) => ({ id: v.id, name: v.name, kind: v.kind, formula: v.formula, value: v.value })),
        read_by: (usage.refMap.get(target.id) ?? []).slice(0, 50).map((r) => {
            const op = typeof r === "number" ? ops[r] : r?.op ?? r;
            return { index: typeof r === "number" ? r : idxOf(op), op: nameOf(op), params: params(op, 6) };
        }),
    };
}

// ── Tasks ────────────────────────────────────────────────────────────

function layoutTree(maxDepth) {
    const comps = layoutComponents();
    const kids = new Map();
    for (const c of comps) {
        const k = kids.get(c.parentKey) ?? [];
        k.push(c);
        kids.set(c.parentKey, k);
    }
    let count = 0;
    const node = (c) => {
        count++;
        const mods = (() => { try { return CW.modifiersOf(c.op).map(nameOf); } catch { return []; } })();
        const n = {
            component: c.name, id: c.cid ?? c.id, depth: c.depth,
            bounds: { x: round(c.globalX), y: round(c.globalY), w: round(c.width), h: round(c.height) },
            ...(c.padding && (c.padding.top || c.padding.right || c.padding.bottom || c.padding.left) ? { padding: c.padding } : {}),
            ...(mods.length ? { modifiers: mods } : {}),
            ...(c.text !== undefined ? { text: c.text } : {}),
            ...(c.op?.mVisibility !== undefined && c.op.mVisibility !== 1 ? { visibility: c.op.mVisibility } : {}),
        };
        const ch = kids.get(c.key) ?? [];
        if (ch.length) {
            if (maxDepth !== undefined && c.depth >= maxDepth) n.children_hidden = ch.length;
            else n.children = ch.map(node);
        }
        return n;
    };
    const roots = kids.get(null) ?? [];
    return { components: comps.length, tree: roots.map(node) };
}

function outline(nodes, indent = "") {
    const lines = [];
    for (const n of nodes) {
        const b = n.bounds;
        lines.push(`${indent}${n.component}#${n.id} [${b.x},${b.y} ${b.w}×${b.h}]` +
            (n.text ? ` "${String(n.text).slice(0, 40)}"` : "") + (n.modifiers ? ` · ${n.modifiers.join(", ")}` : "") +
            (n.visibility !== undefined ? ` · visibility ${n.visibility}` : "") +
            (n.children_hidden ? ` · +${n.children_hidden} hidden` : ""));
        if (n.children) lines.push(...outline(n.children, indent + "  "));
    }
    return lines;
}

// Lists that need the whole op list are built after it exists.
const TASKS = {
    summary() {
        const bc = byteCategories();
        const tm = DS.computeTreeMetrics(doc);
        const a = audit();
        const targets = interactionTargets();
        const acc = accessibility();
        let theme = null;
        try { const t = TE.extractDocumentThemeTokens(doc); theme = { named_colors: t.totalColorTokens, has_theme_sections: t.hasThemeOps }; } catch {}
        return {
            header: header(), layout_size: [width, height], density, bytes: u8.length, operations: ops.length,
            top_operations: opcodeHistogram().slice(0, 12),
            byte_categories: bc.categories,
            components: { total: tm.totalComponents, max_depth: tm.maxDepth },
            variables: variableStats(),
            host_variables: namedVars(),
            interactions: { total: targets.length, click: targets.filter((t) => t.kind === "click").length, area: targets.filter((t) => t.kind === "area").length, touch: targets.filter((t) => t.kind === "touch").length },
            accessibility: { has_semantics: acc.has_semantics, labeled_nodes: acc.nodes.filter((n) => n.content_description || n.text).length },
            theme,
            repaint: (({ verdict, delay_ms, requested }) => ({ verdict, delay_ms, requested }))(repaint()),
            audit: { counts: a.counts, top: a.findings.slice(0, 6).map((f) => `${f.severity}: ${f.title}`) },
        };
    },
    audit,
    operations() {
        const re = O.filter ? new RegExp(O.filter, "i") : null;
        const from = O.from ?? 0, to = O.to ?? ops.length - 1;
        const refs = O.references !== undefined ? Number(O.references) : null;
        let rows = [];
        for (let i = Math.max(0, from); i <= Math.min(ops.length - 1, to); i++) {
            const op = ops[i];
            const name = nameOf(op);
            const p = params(op, O.max_params ?? 8);
            if (re && !re.test(name) && !re.test(p)) continue;
            if (refs !== null) {
                let ids = [];
                try { ids = [...OPP.getOpVarReferences(op), ...OPP.getOpVarOutputs(op)]; } catch {}
                if (!ids.includes(refs)) continue;
            }
            const f = exprOf(op);
            rows.push({ index: i, op: name, opcode: opcodeOf(op), offset: op._byteStart ?? null, bytes: sizeOf(op), params: p, ...(f ? { expression: f } : {}) });
        }
        const total = rows.length, limit = O.limit ?? 200, offset = O.offset ?? 0;
        rows = rows.slice(offset, offset + limit);
        return { total_operations: ops.length, matched: total, offset, returned: rows.length, operations: rows,
                 ...(offset + rows.length < total ? { next_offset: offset + rows.length } : {}) };
    },
    operation() {
        const i = O.index;
        const op = ops[i];
        if (!op) throw new Error(`no operation #${i} (the document has ${ops.length}, indexed from 0)`);
        let p = [], reads = [], writes = [];
        try { p = OPP.getOpParameters(op); } catch {}
        try { reads = OPP.getOpVarReferences(op); } catch {}
        try { writes = OPP.getOpVarOutputs(op); } catch {}
        // Expressions encode what they read inside their bit stream; the graph decodes it.
        const node = graph().nodes.find((n) => n.op === op);
        if (node) {
            reads = [...new Set([...reads, ...nodeIds(node.inputs).filter((x) => Number.isFinite(x))])];
            if (node.varId != null && !writes.includes(node.varId)) writes = [...writes, node.varId];
        }
        const usage = CL.getVariableUsageInfo(doc, ops);
        const readers = writes.flatMap((id) => (usage.refMap.get(id) ?? []).map((r) => (typeof r === "number" ? r : idxOf(r?.op ?? r))))
            .filter((x) => x !== null && x !== i);
        return {
            index: i, op: nameOf(op), opcode: opcodeOf(op), offset: op._byteStart ?? null, bytes: sizeOf(op),
            parameters: p.map((x) => ({ label: x.label, value: typeof x.value === "number" ? round(x.value, 4) : x.value, kind: x.kind, ...(x.varId != null ? { variable: x.varId } : {}) })),
            reads_variables: reads, writes_variables: writes,
            read_by_ops: [...new Set(readers)].slice(0, 40).map((x) => ({ index: x, op: nameOf(ops[x]) })),
            ...(exprOf(op) ? { expression: exprOf(op) } : {}),
            ...(node ? { value: num(node.value ?? null) } : {}),
        };
    },
    layout() {
        const t = layoutTree(O.max_depth);
        const comps = layoutComponents();
        const byKey = new Map(comps.map((c) => [c.key, c]));
        const diag = layoutDiagnostics(comps);
        const out = { layout_size: [width, height], density, components: t.components,
            diagnostics: diag.slice(0, 40).map((d) => ({ severity: d.severity, type: d.type, component: d.compName, id: byKey.get(d.compKey)?.cid ?? null, title: d.title })),
            diagnostics_total: diag.length };
        if (O.format === "json") out.tree = t.tree; else out.outline = outline(t.tree).join("\n");
        return out;
    },
    structure() {
        return JE.decompileDocumentToJson(doc);
    },
    variables() {
        const v = variables();
        if (O.variable !== undefined) return focusVariable(v.list, O.variable);
        let list = v.list;
        if (O.kind) list = list.filter((x) => x.kind === O.kind);
        if (O.only_unused) list = list.filter((x) => x.unused);
        if (O.only_named) list = list.filter((x) => x.name);
        return { stats: variableStats(), host_variables: namedVars(), count: list.length, edges: v.edges,
                 variables: list.slice(0, O.limit ?? 300), ...(list.length > (O.limit ?? 300) ? { truncated: true } : {}) };
    },
    bytes() {
        const bc = byteCategories();
        return {
            total: bc.total, categories: bc.categories,
            by_operation_type: opcodeHistogram().slice(0, 25),
            largest_operations: (bc.model.topConsumers ?? []).slice(0, O.limit ?? 20).map((c) => ({
                index: idxOf(c.op), op: c.op ? nameOf(c.op) : c.name, bytes: c.size ?? c.bytes ?? sizeOf(c.op), category: c.category ?? c.categoryKey ?? null,
            })),
        };
    },
    accessibility,
    interactions() { return { layout_size: [width, height], targets: interactionTargets() }; },
    async interact() {
        // Two sessions on the same timeline: the actions run in one, and a baseline gets the
        // same waits but no input. What differs between them was caused by the input, not
        // by time passing (animations, clocks).
        const base = await createSession();
        const ids = [...new Set([
            ...graph().nodes.filter((n) => n.type !== "consumer").map((n) => n.varId),
            ...CL.getVariableUsageInfo(doc, ops).definedVarIds,
        ])].filter((x) => typeof x === "number" && Number.isFinite(x));
        const log = [];
        for (const [k, a] of (O.actions ?? []).entries()) {
            if (a.wait !== undefined) {
                const n = Math.max(0, Math.round(a.wait * fps));
                main.frames(n); base.frames(n);
                log.push({ step: k, wait: a.wait });
                continue;
            }
            const before = main.frame;
            if (a.target !== undefined) {
                const t = IA.collectInteractionTargets(doc)[a.target];
                if (!t) throw new Error(`actions[${k}]: no target ${a.target} (inspect_interactions lists them)`);
                let handled;
                if (t.kind === "area") { handled = doc.performClick?.(ctx, t.areaId, "") === true; main.paint(); }
                else if (t.bounds) handled = main.tap(t.bounds.cx, t.bounds.cy) === true;
                else throw new Error(`actions[${k}]: target ${a.target} is a ${t.kind} target; drag across it instead`);
                log.push({ step: k, target: a.target, kind: t.kind, component: t.componentName ?? null,
                           at: t.bounds ? [round(t.bounds.cx), round(t.bounds.cy)] : null, handled: Boolean(handled) });
            } else if (a.tap) {
                log.push({ step: k, tap: a.tap, handled: Boolean(main.tap(a.tap[0], a.tap[1])) });
            } else if (a.drag) {
                if (a.drag.length !== 4) throw new Error(`actions[${k}].drag is [x0, y0, x1, y1]`);
                main.drag(...a.drag, a.steps ?? 8);
                log.push({ step: k, drag: a.drag });
            } else if (a.variables) {
                main.setVariables(a.variables); main.paint();
                log.push({ step: k, variables: a.variables });
            } else {
                throw new Error(`actions[${k}]: expected one of wait, target, tap, drag, variables`);
            }
            base.frames(main.frame - before);   // keep the baseline on the same clock
        }
        const settle = Math.max(1, Math.round((O.settle ?? 0.5) * fps));
        main.frames(settle); base.frames(settle);

        const after = main.values(ids), baseline = base.values(ids);
        const g = new Map(graph().nodes.map((n) => [n.varId, n]));
        const changed = ids.filter((id) => JSON.stringify(after.get(id)) !== JSON.stringify(baseline.get(id)))
            .map((id) => {
                const n = g.get(id);
                const nv = namedVars().find((v) => v.id === id);
                const a = after.get(id), b = baseline.get(id);
                const which = a.f !== b.f ? "f" : "i";
                return { id, name: nv?.name ?? VP.getSystemVarName?.(id) ?? null, type: which === "f" ? "float" : "int",
                         formula: n?.formula || (n?.op ? exprOf(n.op) : null) || null,
                         without_input: b[which], with_input: a[which] };
            });
        const hostBase = new Map(base.namedVars().map((v) => [v.name, v.value]));
        const hostChanged = namedVars().filter((v) => JSON.stringify(v.value) !== JSON.stringify(hostBase.get(v.name)))
            .map((v) => ({ name: v.name, without_input: hostBase.get(v.name) ?? null, with_input: v.value }));

        // Layout: components whose box or visibility differs from the baseline's.
        const la = LI.extractLayoutComponents(doc), lb = LI.extractLayoutComponents(base.doc);
        const box = (c) => [round(c.globalX, 1), round(c.globalY, 1), round(c.width, 1), round(c.height, 1), c.op?.mVisibility];
        let layoutChanges;
        if (la.length !== lb.length) {
            layoutChanges = { structure_changed: true, components_without_input: lb.length, components_with_input: la.length };
        } else {
            const diffs = la.map((c, i) => ({ c, b: lb[i] })).filter(({ c, b }) => JSON.stringify(box(c)) !== JSON.stringify(box(b)));
            layoutChanges = { changed: diffs.length, components: diffs.slice(0, 25).map(({ c, b }) => ({
                component: c.name, id: c.cid,
                without_input: { x: box(b)[0], y: box(b)[1], w: box(b)[2], h: box(b)[3], visibility: box(b)[4] },
                with_input: { x: box(c)[0], y: box(c)[1], w: box(c)[2], h: box(c)[3], visibility: box(c)[4] },
            })) };
        }

        const result = {
            layout_size: [width, height], steps: log, seconds: round((main.frame - 1) / fps, 3),
            effect: changed.length || hostChanged.length || layoutChanges.structure_changed || layoutChanges.changed
                ? "the input changed the document" : "no difference from the same timeline without input",
            changed_host_variables: hostChanged,
            changed_variables: changed.slice(0, O.limit ?? 40), changed_variables_total: changed.length,
            layout_changes: layoutChanges,
            repaint: repaint().verdict,
        };
        if (O.include_layout) result.outline = outline(layoutTree(O.max_depth).tree).join("\n");
        return result;
    },
    runtime() {
        const rp = repaint();
        const prof = runProfile(O.frames ?? 60);
        const c = PF.computeCoverage(doc);
        return {
            repaint: rp, profile: prof,
            coverage: { frames: prof.frames, total: c.total, executed: c.executed.length, never_executed: c.never.length,
                        never: c.never.slice(0, 40).map((e) => ({ index: e.idx, op: e.name })) },
        };
    },
    theme() {
        const t = TE.extractDocumentThemeTokens(doc);
        return {
            has_theme_sections: t.hasThemeOps,
            theme_sections: (t.themeSections ?? []).slice(0, 40).map((s) => ({ op_index: s.opIndex, theme: s.label })),
            named_colors: (t.namedColors ?? []).map((c) => ({ id: c.id, name: c.name, category: c.categoryTitle, color: c.hex, op_index: c.opIndex })),
            named_floats: (t.namedFloats ?? []).map((f) => ({ id: f.id, name: f.name, value: f.value })),
        };
    },
};

function safe(fn) { try { return fn(); } catch { return null; } }

try {
    if (!TASKS[task]) throw new Error(`unknown task ${task}`);
    const result = await TASKS[task]();
    parentPort.postMessage({ ok: true, result: JSON.parse(JSON.stringify(result, (k, v) =>
        (v instanceof Set ? [...v] : v instanceof Map ? Object.fromEntries(v) : typeof v === "bigint" ? Number(v) : v))), logs });
} catch (e) {
    parentPort.postMessage({ ok: false, error: e?.message ?? String(e), logs });
}
