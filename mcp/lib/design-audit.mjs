// Design audits: documents that are valid and render, but are built in a way that makes
// them worse than they need to be — a pictograph drawn as a text glyph, the same 1.5 KB
// subtree pasted 31 times, "OCTOBER 2026" typed in instead of read from the clock, every
// colour a literal so light/dark/mono cannot follow. Each finding names the fix.
//
// designAudit(json) works on the RemoteCompose JSON as written (before library components
// are expanded, so a library call repeated is not a repeated subtree). textAudit(strings)
// is the best effort for a binary .rc: the glyph and date rules on its text data alone.
// Findings have the inspector audit's shape: {severity, code, title, message, ...extra}.

// ── Glyph icons ───────────────────────────────────────────────────────

// Symbols that read as text, not as pictures (units and marks).
const TEXTUAL_SYMBOLS = new Set(["°", "©", "®", "™", "℃", "℉", "№", "℗", "‰"]);
// A single glyph this large (sp) is plainly an icon; smaller, one alone is advice.
const LARGE_GLYPH = 24;
const SYMBOL_CHAR = /^[\p{So}\p{Extended_Pictographic}]$/u;
const IGNORABLE = /[\s︎️‍⃣\p{Emoji_Modifier}\p{M}]/gu;

/** The string is (mostly) one to three symbol/pictograph characters and nothing else. */
export function isGlyphText(s) {
    if (typeof s !== "string") return false;
    const t = s.replace(IGNORABLE, "");
    if (!t || t.length > 12) return false;
    const chars = [...t];
    if (chars.length > 3) return false;
    return chars.every((c) => SYMBOL_CHAR.test(c) && !TEXTUAL_SYMBOLS.has(c));
}

// ── Dates ─────────────────────────────────────────────────────────────

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const YEAR = "(?:19|20)\\d{2}";
const DATE_PATTERNS = [
    ["month and year", new RegExp(`\\b${MONTH}\\.?,?\\s+${YEAR}\\b`, "i")],
    ["date", new RegExp(`\\b${YEAR}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])\\b`)],
    ["date", /\b(?:0?[1-9]|[12]\d|3[01])[/.](?:0?[1-9]|1[0-2])[/.](?:19|20)\d{2}\b/],
    ["month and day", new RegExp(`\\b${MONTH}\\.?\\s+(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\b(?!\\s*(?:%|:|[a-z]))`, "i")],
    ["day and month", new RegExp(`\\b(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+${MONTH}\\b`, "i")],
    ["weekday and day", new RegExp(`\\b${WEEKDAY},?\\s+(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\b(?!\\s*(?:%|:))`, "i")],
];

/** What kind of calendar date the text spells out ("month and year", "date"...), or null. */
export function dateKind(s) {
    if (typeof s !== "string" || s.length > 80) return null;
    for (const [kind, re] of DATE_PATTERNS) if (re.test(s)) return kind;
    return null;
}

// Expression names and features that read the clock (players/typescript/src/json2rc/Expr.ts).
const CLOCK_EXPR = /\b(?:calendarMonth|weekDay|weekday|dayOfWeek|dayOfMonth|dayOfYear|epochSecond|timeInSec|timeInMin|timeInHr|continuousSec|offsetToUtc|utcOffset)\b|\b(?:year|month|day)\s*\(\s*\)/;
const CLOCK_COMPONENTS = /^(?:DateLabel|DigitalClock|AnalogClock|Calendar\w*|Clock\w*)$/;

// ── Walking the JSON ─────────────────────────────────────────────────

const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const isCall = (node) => {
    if (!isObj(node)) return false;
    if (typeof node.type === "string" && /^[A-Z]/.test(node.type)) return true;
    const k = Object.keys(node);
    return k.length === 1 && /^[A-Z][A-Za-z0-9]*$/.test(k[0]);
};
const callName = (node) => (typeof node.type === "string" && /^[A-Z]/.test(node.type) ? node.type : Object.keys(node)[0]);
const pathStr = (p) => p.reduce((s, k) => (typeof k === "number" ? `${s}[${k}]` : s ? `${s}.${k}` : String(k)), "");
const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_REF = /^[@$]colors\.(.+)$/;

/** Every string leaf of the document's content (not header) with its path, and its context. */
function collectStrings(doc) {
    const out = [];
    const visit = (node, p, ctx) => {
        if (typeof node === "string") { out.push({ value: node, path: p, ...ctx }); return; }
        if (Array.isArray(node)) {
            // A canvas's commands: a paint's textSize applies to the draws after it.
            let textSize = ctx.fontSize;
            node.forEach((x, i) => {
                const paint = isObj(x) && isObj(x.paint) ? x.paint : null;
                if (paint && typeof paint.textSize === "number") textSize = paint.textSize;
                visit(x, [...p, i], { ...ctx, fontSize: textSize });
            });
            return;
        }
        if (!isObj(node)) return;
        const fontSize = typeof node.fontSize === "number" ? node.fontSize
            : typeof node.textSize === "number" ? node.textSize : ctx.fontSize;
        for (const [k, v] of Object.entries(node)) {
            if (p.length === 0 && k === "header") continue;
            if (k === "contentDescription" || k === "description") continue;
            visit(v, [...p, k], { ...ctx, fontSize, key: k });
        }
    };
    visit(doc, [], {});
    return out;
}

// ── Rules ─────────────────────────────────────────────────────────────

const GLYPH_FIX =
    "Use an icon instead: {\"Icon\": {\"name\": ...}} draws any of 4,157 Material Symbols (find kind \"icons\" " +
    "searches them: ★ is `star`, ✓ `check`, ☀ `light_mode`). For a symbol that shows a value, a library " +
    "component (MoonPhase, WeatherIcon, BatteryIndicator...) or an inline component under top-level " +
    "`components` when it repeats. A text glyph depends on the device's fonts (it may be missing, an emoji, " +
    "or a different shape), cannot be coloured or sized precisely, and reads badly to a screen reader.";

function glyphFindings(items) {
    const hits = items.filter((s) => isGlyphText(s.value));
    if (!hits.length) return [];
    const distinct = new Set(hits.map((h) => h.value.trim()));
    const large = hits.filter((h) => (h.fontSize ?? 0) >= LARGE_GLYPH);
    const severity = hits.length >= 2 || large.length ? "warning" : "info";
    return [{
        severity, code: "glyph_icon",
        title: `${hits.length} text${hits.length > 1 ? "s are" : " is"} a symbol used as an icon (${[...distinct].slice(0, 8).join(" ")})`,
        message: `Unicode symbols or emoji drawn as text${large.length ? `, ${large.length} at ${LARGE_GLYPH}sp or larger` : ""}. ${GLYPH_FIX}`,
        count: hits.length,
        examples: hits.slice(0, 6).map((h) => ({ text: h.value, ...(h.path ? { path: pathStr(h.path) } : {}), ...(h.fontSize ? { fontSize: h.fontSize } : {}) })),
    }];
}

const DATE_FIX =
    "Compute it from the clock: textLookup over a month-name list indexed by calendarMonth() - 1, " +
    "textFromFloat of year() / dayOfMonth(), weekDay() for the day of the week (examples TIM-03 date card, " +
    "EXP-13 system values), or the DateLabel library component; a calendar grid positions its days from " +
    "dayOfMonth() and weekDay(). Pin the clock (rc-inspect / rc-render `clock`) to check another date.";

function dateFindings(items, readsClock) {
    // A date that is the starting value of a host variable (resources, a tree `variable`) is the
    // app's data, sample until the app sets it: not a date fixed on screen.
    const hostValue = (s) => (s.path ?? [])[0] === "resources" || (s.path ?? []).includes("variable");
    const hits = items.map((s) => ({ ...s, kind: dateKind(s.value) })).filter((h) => h.kind && !hostValue(h));
    // A month grid typed out: the day numbers 1..28 or more as separate literal texts.
    const days = new Set(items.filter((s) => /^\s*(?:[1-9]|[12]\d|3[01])\s*$/.test(s.value) && s.key !== "id" && s.key !== "name").map((s) => Number(s.value)));
    let grid = true;
    for (let d = 1; d <= 28; d++) if (!days.has(d)) { grid = false; break; }
    if (!hits.length && !grid) return [];
    // Nothing reads the clock: whatever the document treats as "today" is fixed too.
    const severity = !readsClock || grid ? "warning" : "info";
    const what = [
        ...(hits.length ? [`${hits.length} text${hits.length > 1 ? "s" : ""} spell${hits.length > 1 ? "" : "s"} out a fixed date (${[...new Set(hits.map((h) => `"${h.value.trim().slice(0, 30)}"`))].slice(0, 4).join(", ")})`] : []),
        ...(grid ? [`the day numbers 1..${Math.max(...days)} are literal texts (a month grid typed out)`] : []),
    ].join("; ");
    return [{
        severity, code: "hardcoded_date",
        title: hits.length ? `Hard-coded date ${hits.slice(0, 2).map((h) => `"${h.value.trim().slice(0, 24)}"`).join(", ")}` : "Hard-coded month grid",
        message: `${what}${readsClock ? "" : ", and nothing in the document reads the clock"}: it is right on one day only. ${DATE_FIX}`,
        count: hits.length + (grid ? 1 : 0),
        reads_clock: readsClock,
        examples: hits.slice(0, 6).map((h) => ({ text: h.value, kind: h.kind, ...(h.path ? { path: pathStr(h.path) } : {}) })),
        ...(grid ? { literal_day_numbers: Math.max(...days) } : {}),
    }];
}

const MIN_INSTANCE_BYTES = 150;
const MIN_TOTAL_BYTES = 3000;
const MIN_REPEATS = 4;
// Below these a few copies are advice (a feature demo's rows); above, they are the problem.
const WARN_REPEATS = 20;
const WARN_TOTAL_BYTES = 12_000;

function repeatedFindings(doc) {
    // Signature of every object subtree: its structure with literal leaves reduced to types.
    const nodes = [];
    const sig = (node, p, skip) => {
        if (Array.isArray(node)) return `[${node.map((x, i) => sig(x, [...p, i], skip)).join(",")}]`;
        if (isObj(node)) {
            // A component call is already the reuse unit: its arguments are not copies.
            skip ||= isCall(node);
            const keys = Object.keys(node).sort();
            const inner = keys.map((k) => {
                // Definitions are written once on purpose; their insides are not repeats.
                const def = (p.length === 0 && k === "components") || k === "definePattern";
                return `${JSON.stringify(k)}:${sig(node[k], [...p, k], skip || def)}`;
            }).join(",");
            const s = `{${inner}}`;
            if (!skip) nodes.push({ node, path: p, sig: s });
            return s;
        }
        return node === null ? "z" : typeof node === "number" ? "n" : typeof node === "boolean" ? "b" : "s";
    };
    sig(doc, [], false);

    const groups = new Map();
    for (const n of nodes) {
        const g = groups.get(n.sig) ?? [];
        g.push(n);
        groups.set(n.sig, g);
    }
    const leaves = (node, p = [], out = []) => {
        if (Array.isArray(node)) node.forEach((x, i) => leaves(x, [...p, i], out));
        else if (isObj(node)) for (const [k, v] of Object.entries(node)) leaves(v, [...p, k], out);
        else out.push([p, node]);
        return out;
    };
    const candidates = [];
    for (const g of groups.values()) {
        if (g.length < MIN_REPEATS) continue;
        const size = JSON.stringify(g[0].node).length;
        if (size < MIN_INSTANCE_BYTES || size * g.length < MIN_TOTAL_BYTES) continue;
        // Instances nested in each other (a recursive structure) count once.
        candidates.push({ g, size, total: g.reduce((s, n) => s + JSON.stringify(n.node).length, 0) });
    }
    candidates.sort((a, b) => b.total - a.total);

    const covered = [];   // path prefixes already reported
    const under = (p) => covered.some((c) => c.length <= p.length && c.every((k, i) => p[i] === k));
    const out = [];
    for (const { g, size, total } of candidates) {
        const fresh = g.filter((n) => !under(n.path));
        if (fresh.length < MIN_REPEATS) continue;
        const ls = fresh.map((n) => leaves(n.node));
        const differing = ls[0].map(([p], i) => ({ path: p, values: ls.map((l) => l[i][1]) }))
            .filter((d) => d.values.some((v) => v !== d.values[0]));
        const nLeaves = ls[0].length;
        // Structurally the same but differing almost everywhere: a list of different things.
        if (differing.length > Math.max(6, nLeaves * 0.25)) continue;
        for (const n of fresh) covered.push(n.path);
        const root = fresh[0].node;
        const kind = isObj(root) ? (Object.keys(root).length === 1 ? Object.keys(root)[0] : root.type ?? "object") : "subtree";
        out.push({
            severity: fresh.length >= WARN_REPEATS || total >= WARN_TOTAL_BYTES ? "warning" : "info", code: "repeated_subtree",
            title: `The same ${kind} is written out ${fresh.length} times (~${Math.round(total / 1024 * 10) / 10} KB)`,
            message: `${fresh.length} copies of a ~${size}-byte \`${kind}\` that differ only in ${differing.length === 0 ? "nothing (identical copies)" : `${differing.length} literal value${differing.length > 1 ? "s" : ""} (${differing.slice(0, 4).map((d) => pathStr(d.path) || "(value)").join(", ")})`}. ` +
                "Define it once as an inline component under top-level `components` ({\"components\": {\"MoonDay\": {\"params\": {...}, \"body\": ...}}}) " +
                "with the differing values as params and call it per instance, or generate the instances with {\"$each\": ...} inside a component body " +
                "(or a loop / definePattern) — then it is written, reviewed and fixed in one place.",
            count: fresh.length, bytes: total, instance_bytes: size,
            paths: fresh.slice(0, 6).map((n) => pathStr(n.path)),
            differing: differing.slice(0, 8).map((d) => ({ path: pathStr(d.path) || "(value)", values: [...new Set(d.values)].slice(0, 8) })),
        });
        if (out.length >= 5) break;
    }
    return out;
}

// Enough literal colours, and different enough, that a palette is clearly being typed out.
const MIN_LITERAL_COLORS = 16;
const MIN_DISTINCT_COLORS = 6;

function colorFindings(doc) {
    const defined = isObj(doc?.resources?.colors) ? doc.resources.colors : {};
    let literal = 0, named = 0, themed = 0;
    const distinct = new Set();
    const visit = (node, p) => {
        if (typeof node === "string") {
            if (HEX.test(node)) {
                // A resources.colors definition is a name, counted where it is used.
                if (p[0] === "resources" && p[1] === "colors") return;
                literal++; distinct.add(node.toUpperCase());
                return;
            }
            const m = COLOR_REF.exec(node);
            if (m) {
                const d = defined[m[1]];
                if (typeof d === "string" || (isObj(d) && d.light === undefined)) named++; else themed++;
            }
            return;
        }
        if (Array.isArray(node)) node.forEach((x, i) => visit(x, [...p, i]));
        else if (isObj(node)) {
            // A themed colour value written inline: {"light": c, "dark": c}.
            if (node.light !== undefined && node.dark !== undefined && p[0] !== "resources") { themed++; return; }
            for (const [k, v] of Object.entries(node)) visit(v, [...p, k]);
        }
    };
    visit(doc, []);
    // Library components take their colours from the theme.
    let calls = 0;
    const walk = (n) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (isObj(n)) { if (isCall(n) && !["definePattern"].includes(callName(n))) calls++; Object.values(n).forEach(walk); }
    };
    walk(doc.root);
    const total = literal + named + themed;
    if (literal < MIN_LITERAL_COLORS || distinct.size < MIN_DISTINCT_COLORS || literal / total < 0.9) return [];
    return [{
        severity: "info", code: "hardcoded_colors",
        title: `${literal} of ${total} colours are literals (${distinct.size} distinct)`,
        message: `${themed + named ? `Only ${themed + named} colour${themed + named > 1 ? "s" : ""} come from a theme or a name; the rest` : "Every colour"} is an ARGB literal, so the document cannot follow light, dark or mono (always-on, e-ink) ` +
            "and every shade is repeated where it is used. Use the library theme's roles (\"@colors.background\", \"@colors.surface\", \"@colors.onSurface\", " +
            "\"@colors.primary\", \"@colors.muted\"... — rc-examples lists them), or define your own under resources.colors as {\"light\": c, \"dark\": c} and refer to them as \"@colors.name\".",
        literal, named, themed, distinct: distinct.size, component_calls: calls,
        examples: [...distinct].slice(0, 8),
    }];
}

// ── Layout: a whole UI hand-placed on a canvas ───────────────────────

const LAYOUT_KINDS = new Set(["column", "row", "box", "text", "flow", "fitbox", "statelayout", "collapsiblerow",
    "collapsiblecolumn", "image", "spacer", "button"]);
const TEXT_DRAWS = new Set(["drawText", "drawTextAnchored", "drawTextRun", "drawTextOnPath", "drawTextOnCircle"]);
const DRAWS = /^draw/;
const SIZE_EXPR = /\b(?:componentWidth|componentHeight|windowWidth|windowHeight|contentWidth|contentHeight)\s*\(/;
const RESIZING = (m) => m === "fillMaxSize" || m === "fillMaxWidth" || m === "fillMaxHeight"
    || (isObj(m) && ("weight" in m || "verticalWeight" in m || "horizontalWeight" in m));

/** Every canvas in the document (its commands and modifiers), and whether any layout component exists. */
function scanLayout(doc) {
    const canvases = [];
    let layout = 0;
    const visit = (node) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!isObj(node)) return;
        if (isCall(node)) layout++;          // a library or inline component lays itself out
        const kind = typeof node.type === "string" ? node.type.toLowerCase() : null;
        for (const [k, v] of Object.entries(node)) {
            const lk = k.toLowerCase();
            if (lk === "canvas" && isObj(v)) canvases.push(v);
            else if (LAYOUT_KINDS.has(lk) && isObj(v)) layout++;
            visit(v);
        }
        if (kind === "canvas") canvases.push(node);
        else if (kind && LAYOUT_KINDS.has(kind)) layout++;
    };
    visit(doc.root ?? doc);
    return { canvases, layout };
}
const commandsOf = (c) => (Array.isArray(c.commands) ? c.commands : []);
const flatCommands = (cmds) => cmds.flatMap((x) => (isObj(x) && Array.isArray(x.save) ? flatCommands(x.save) : [x]));
const commandName = (x) => (isObj(x) ? Object.keys(x)[0] : "");

const LAYOUT_FIX =
    "Lay text and structure out with components (column, row, box, text, and library components such as " +
    "Card, ListItem, StatTile, Icon) and keep canvases for drawings (a chart, a dial, a path). Layout " +
    "components measure their text, wrap it, follow the font scale and the screen size, and expose the text " +
    "to screen readers; text drawn on a canvas does none of that.";

// Keys json2rc and the reference parser ignore without a word, each a guess at a real feature:
// the document converts, the effect never appears (a number sat top-left in its disc).
const WRONG_KEYS = {
    contentAlignment: "use the container's own keys: box/fitBox {\"horizontalAlignment\", \"verticalAlignment\"}, row {\"verticalAlignment\", \"horizontalArrangement\"}, column {\"horizontalAlignment\", \"verticalArrangement\"}",
    alignment: "use horizontalAlignment / verticalAlignment (box, fitBox) or verticalAlignment (row) / horizontalAlignment (column)",
    contentDescription: "on a node it is dropped: label it with the modifier {\"semantics\": {\"contentDescription\": \"...\"}} (the header's contentDescription describes the document)",
    gravity: "use horizontalAlignment / verticalAlignment",
    align: "use textAlign on a text (start | center | end), or the container's alignment keys",
};
const NODE_KINDS = /^(box|row|column|text|fitbox|canvas|flow|collapsiblecolumn|collapsiblerow|statelayout|image|verticalscroll|horizontalscroll)$/i;
function wrongKeyFindings(doc) {
    const hits = new Map();   // key -> count
    const visit = (x, inNode) => {
        if (Array.isArray(x)) { for (const y of x) visit(y, inNode); return; }
        if (!isObj(x)) return;
        // A node is {"box": {...}}, {"type": "box", ...} or the root.
        const self = inNode || (typeof x.type === "string" && NODE_KINDS.test(x.type));
        for (const [k, v] of Object.entries(x)) {
            const nodeBody = (NODE_KINDS.test(k) || k === "root") && isObj(v);
            // A component call ({"StatusMark": {...}}) takes the component's own params: not a node.
            // So is a draw command: drawBitmap and its kin do take a contentDescription.
            const call = (/^[A-Z]/.test(k) || /^draw/i.test(k)) && isObj(v);
            if (/^draw/i.test(String(x.type ?? ""))) continue;
            if (self && k in WRONG_KEYS && !(k === "contentDescription" && x === doc.header)) hits.set(k, (hits.get(k) ?? 0) + 1);
            visit(v, !call && (nodeBody || (k === "children") || (self && !["modifiers", "resources", "components", "params", "locals"].includes(k))));
        }
    };
    visit(doc, false);
    return [...hits].map(([k, n]) => ({
        severity: "warning", code: "ignored_key",
        title: `"${k}" is not a RemoteCompose key (${n} use(s)): it converts but does nothing`,
        message: `"${k}": ${WRONG_KEYS[k]}.`,
        count: n,
    }));
}

// A number declared as a root-level `variable` command is read fine by the tree, but a
// component's local computed from it (a TextChoice's clamped index) is a deferred tree
// variable that the integer expressions reading it never see: the reference parser makes a
// fresh integer 0 there (U57). Numbers belong in resources.variables; the root form is for strings.
function rootVariableFindings(doc) {
    const root = Array.isArray(doc.root) ? doc.root : [];
    const nums = root.filter((n) => isObj(n) && isObj(n.variable) && typeof n.variable.name === "string"
        && !/string|text/i.test(String(n.variable.vtype ?? "")) && typeof n.variable.value !== "string").map((n) => n.variable.name);
    if (!nums.length) return [];
    // Only a root number passed to a component call is at risk (the tree itself reads it fine).
    const fed = new Set();
    const visit = (x) => {
        if (Array.isArray(x)) { for (const y of x) visit(y); return; }
        if (!isObj(x)) return;
        const keys = Object.keys(x);
        if (keys.length === 1 && /^[A-Z]/.test(keys[0]) && isObj(x[keys[0]])) {
            const argText = JSON.stringify(x[keys[0]]);
            for (const n of nums) if (new RegExp(`@${n}\\b`).test(argText)) fed.add(`${n} → ${keys[0]}`);
        }
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc.root);
    if (!fed.size) return [];
    return [{
        severity: "warning", code: "root_number_variable",
        title: `${fed.size} root variable number(s) passed to a component (${[...fed].slice(0, 4).join(", ")})`,
        message: "Declare numbers the app sets in resources.variables ({\"playing\": {\"value\": 0, \"export\": true}}) when a component " +
            "reads them; a root-level {\"variable\": ...} is for strings. A component local computed from a root variable (a TextChoice " +
            "index, a Gauge value) is a deferred tree variable that integer expressions cannot see, and the component sticks at 0 (U57).",
        count: fed.size,
    }];
}

// A hostNamedAction name used by two click lists is written as one text, inside the FIRST
// list; the player registers it when that click runs, so the second control sends a nameless
// action until the first is tapped (json2rc and the reference parser cache texts alike: U58).
function sharedActionNameFindings(doc) {
    const seen = new Map();   // name -> branch -> click lists
    let list = 0;
    // (The document tree only: a component definition's body and its `call` example are not
    // controls on the screen — a login form's checkbox counted its own example call.)
    // A stateLayout shows one child at a time: the same name in two of its children is one
    // control at a time, not two, so each child is its own branch.
    const visitRoot = () => visit(doc.root, "");
    const visit = (x, branch) => {
        if (Array.isArray(x)) { for (const y of x) visit(y, branch); return; }
        if (!isObj(x)) return;
        for (const [k, v] of Object.entries(x)) {
            if (k === "onClick" || k === "multiClick") {
                list++;
                const acts = Array.isArray(v) ? v : [v];
                // (A name that is a component's param — "@action", "$name" — differs per call.)
                for (const a of acts) if (isObj(a) && /^host(named)?action$/i.test(String(a.type ?? "")) && typeof a.name === "string" && !/^[@$]/.test(a.name)) {
                    const byBranch = seen.get(a.name) ?? new Map();
                    byBranch.set(branch, (byBranch.get(branch) ?? new Set()).add(list));
                    seen.set(a.name, byBranch);
                }
            }
            if (/^statelayout$/i.test(k) && isObj(v) && Array.isArray(v.children)) {
                v.children.forEach((c, i) => visit(c, `${branch}/${list}:${i}`));
                for (const [k2, v2] of Object.entries(v)) if (k2 !== "children") visit(v2, branch);
                continue;
            }
            visit(v, branch);
        }
    };
    visitRoot();
    // Shared: two lists in one branch, or in a branch and one that contains it.
    for (const [name, byBranch] of seen) {
        const merged = new Map();
        for (const [b, lists] of byBranch) for (const [b2, l2] of byBranch) if (b2 === b || b.startsWith(b2 + "/")) for (const l of l2) (merged.get(b) ?? merged.set(b, new Set()).get(b)).add(l);
        seen.set(name, new Set([...merged.values()].reduce((best, s) => (s.size > best.size ? s : best), new Set())));
    }
    const shared = [...seen].filter(([, lists]) => lists.size > 1).map(([n]) => n);
    if (!shared.length) return [];
    return [{
        severity: "info", code: "shared_action_name",
        title: `${shared.length} hostNamedAction name(s) used by several controls (${shared.slice(0, 4).join(", ")})`,
        message: "json2rc declares a shared name once before the tree, so every control sends it (with a valueType value, e.g. one " +
            "\"rate\" action from five stars). The reference JSON parser writes it inside the first control's list only, where the " +
            "others send a nameless action until that one is tapped: give each control its own name if the document must also convert there.",
        count: shared.length,
    }];
}

// Two host strings with the same initial value are ONE text in the document (the parsers
// cache texts by value; json2rc and the reference alike): the names share an id, so the app
// setting one sets both (two departure slots both starting "42").
function sharedStringFindings(doc) {
    const byValue = new Map();
    const visit = (x) => {
        if (Array.isArray(x)) { for (const y of x) visit(y); return; }
        if (!isObj(x)) return;
        const v = x.variable;
        if (isObj(v) && typeof v.name === "string" && /string|text/i.test(String(v.vtype ?? "")) && typeof v.value === "string") {
            byValue.set(v.value, [...(byValue.get(v.value) ?? []), v.name]);
        }
        for (const y of Object.values(x)) visit(y);
    };
    visit(doc.root);
    const shared = [...byValue].filter(([, names]) => names.length > 1);
    if (!shared.length) return [];
    return [{
        severity: "warning", code: "shared_string_value",
        title: `${shared.length} group(s) of host strings with the same initial value (${shared.slice(0, 3).map(([v, n]) => `${n.join("/")} = ${JSON.stringify(v)}`).join("; ")})`,
        message: "Texts are stored once per value, so these names point at one text: the app setting one changes all of them. " +
            "Only the INITIAL values must differ: once the app sets each one by name they are separate texts, and real data may repeat " +
            "(two ingredients in \"cups\"). So give each a distinct starting value — the sample data, or \"unit 1\", \"unit 2\" — and let the app send the real ones.",
        count: shared.length,
    }];
}

// A visibility modifier takes a variable ("@shown") or an expression of one: a number is read
// as a variable ID by json2rc and the reference parser, so {"visibility": 1} shows or hides by
// whatever variable has id 1 (a prompt-8 cell vanished in check_component this way).
function visibilityFindings(doc) {
    let n = 0, inline = 0;
    const seen = new Set(), exprs = new Set();
    const visit = (x) => {
        if (Array.isArray(x)) { for (const y of x) visit(y); return; }
        if (!isObj(x)) return;
        if (Array.isArray(x.modifiers)) for (const m of x.modifiers) {
            if (!isObj(m)) continue;
            if (typeof m.visibility === "number") { n++; seen.add(m.visibility); }
            // An expression written in the modifier is parsed as an INTEGER expression: plain
            // arithmetic on variables works, a function call (step, min, abs) does not reliably,
            // and the component vanishes (a seasons widget lost its day count to
            // {"visibility": "step(@days, 0.5)"}).
            // (Nor does a bare call with no operator, even abs, min, max or clamp: without + - * / %
            // the string is taken for a text id. "1 - min(1, @x)" works, "min(1, @x)" hides.)
            else if (typeof m.visibility === "string" && (/\b(?!abs\b|min\b|max\b|clamp\b)[A-Za-z_]\w*\s*\(/.test(m.visibility) || /\d\.\d/.test(m.visibility)
                || (m.visibility.includes("(") && !/[-+*/%]/.test(m.visibility)))) { inline++; exprs.add(m.visibility); }
        }
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc);
    // A variable declared INSIDE the layout tree (a `variable` command below the root level —
    // what a component's computed local becomes) is a deferred tree variable: an integer
    // expression (a visibility) reading it gets a fresh 0 and the component hides (U57).
    // Only a read that comes BEFORE the declaration, in document order, sees the fresh 0: a
    // variable written earlier in the tree (a 0-size canvas first) is there when it is read.
    const treeVars = new Map();   // name -> order of its declaration
    let order = 0;
    const collect = (x, depth) => {
        if (Array.isArray(x)) { for (const y of x) collect(y, depth); return; }
        if (!isObj(x)) return;
        order++;
        if (depth > 1 && isObj(x.variable) && typeof x.variable.name === "string" && !treeVars.has(x.variable.name)) treeVars.set(x.variable.name, order);
        for (const [k, v] of Object.entries(x)) if (k !== "resources" && k !== "components") collect(v, depth + (k === "root" ? 0 : 1));
    };
    collect(doc.root, 0);
    const treeHits = new Map();
    order = 0;
    const scanVis = (x, depth) => {
        if (Array.isArray(x)) { for (const y of x) scanVis(y, depth); return; }
        if (!isObj(x)) return;
        order++;
        const here = order;
        if (Array.isArray(x.modifiers)) for (const m of x.modifiers) if (isObj(m) && typeof m.visibility === "string") {
            for (const r of m.visibility.matchAll(/@([A-Za-z_][\w.]*)/g)) if (treeVars.has(r[1]) && treeVars.get(r[1]) > here) treeHits.set(r[1], (treeHits.get(r[1]) ?? 0) + 1);
        }
        for (const [k, v] of Object.entries(x)) if (k !== "resources" && k !== "components") scanVis(v, depth + (k === "root" ? 0 : 1));
    };
    scanVis(doc.root, 0);
    const out = [];
    if (treeHits.size) out.push({
        severity: "warning", code: "tree_variable_visibility",
        title: `${treeHits.size} visibility expression(s) read a variable declared inside the layout (${[...treeHits.keys()].slice(0, 3).join(", ")})`,
        message: "A variable command inside the tree is written where it stands and a visibility is an integer expression that only sees variables " +
            "already written; these visibilities come BEFORE their variable, so (in the reference parser and on Android) they get a fresh 0 and the component hides. Declare the value in resources.variables (a component local " +
            "computed from params and resources only stays there), or switch the content by a resources variable.",
        count: treeHits.size,
    });
    if (n) out.push({
        severity: "warning", code: "literal_visibility",
        title: `${n} visibility modifier(s) with a number (${[...seen].join(", ")}) instead of a variable`,
        message: "A number in \"visibility\" is a variable ID, not shown/hidden: the component follows whatever variable has that id. " +
            "Declare a variable (resources.variables {\"shown\": 1}) and write {\"visibility\": \"@shown\"}.",
        count: n,
    });
    if (inline) out.push({
        severity: "warning", code: "inline_visibility",
        title: `${inline} visibility modifier(s) calling a function inline (${[...exprs].slice(0, 2).map((e) => JSON.stringify(e)).join(", ")})`,
        message: "An expression inside \"visibility\" is an INTEGER expression (+ - * / %, abs, min, max, clamp, whole numbers): anything " +
            "else (step, ifElse, floor, a decimal, or a bare call with no operator such as max(@a, @b)) is not one, the string becomes a text id and the component is hidden. In a component, a param passed to a visibility counts too. Compute the " +
            "condition as a float variable (resources.variables {\"shown\": \"step(@days, 0.5)\"}, exactly 0 or 1) and write {\"visibility\": \"@shown\"}.",
        count: inline,
    });
    return out;
}

// A `variable` command inside the layout tree is deferred: json2rc (and the reference parser)
// writes its expression where it is FIRST READ. When that reader is inside the content of a
// component that can be hidden (the children or canvas commands of one with a visibility, a
// stateLayout child), the expression sits there, and hidden content is not painted, so the
// expression is not re-evaluated, whether time or a host value drives it (Android does the
// same). Every other reader then sees a frozen value: a 3D engine's crank angle first read by a
// flow diagram hidden behind the 3D view, and nothing moved. A root-level variable, one in
// resources.variables or in a root "global" block is written up front and updates every frame.
// Reads are followed through other deferred variables: a deferred variable's own references
// are written where IT is written.
function hiddenFirstReadFindings(doc) {
    const deferred = new Map();   // name -> referenced names (its expression)
    const refsOf = (v) => [...JSON.stringify(v ?? "").matchAll(/@([A-Za-z_]\w*)/g)].map((m) => m[1]);
    const dynamic = (v) => {
        const x = isObj(v) && "value" in v ? v.value : v;
        return typeof x === "string" && !/^\s*-?\d*\.?\d+\s*$/.test(x);
    };
    // Pass 1: the deferred declarations (inside the tree, not in a global block, a dynamic float or int).
    const collect = (x, depth, inGlobal) => {
        if (Array.isArray(x)) { for (const y of x) collect(y, depth, inGlobal); return; }
        if (!isObj(x)) return;
        const v = x.variable;
        if (isObj(v) && typeof v.name === "string" && depth > 0 && !inGlobal && !deferred.has(v.name)
            && /^(float|int|integer|)$/i.test(String(v.vtype ?? "")) && dynamic(v.value)) deferred.set(v.name, refsOf(v.value));
        for (const [k, y] of Object.entries(x)) collect(y, depth + 1, inGlobal || k === "global");
    };
    if (Array.isArray(doc.root)) for (const item of doc.root) collect(item, isObj(item) && "variable" in item ? 0 : 1, false);
    else collect(doc.root, 1, false);
    if (!deferred.size) return [];

    // Pass 2: reads in document order, each with the stack of hideable components around it.
    const hideables = [];          // id -> a short label
    const written = new Map();     // name -> the stack where its expression is written
    const reads = [];              // { name, stack }
    const read = (name, stack) => {
        reads.push({ name, stack });
        if (!deferred.has(name) || written.has(name)) return;
        written.set(name, stack);
        for (const r of deferred.get(name)) if (r !== name) read(r, stack);
    };
    const walk = (x, stack) => {
        if (Array.isArray(x)) { for (const y of x) walk(y, stack); return; }
        if (typeof x === "string") { for (const r of refsOf(x)) read(r, stack); return; }
        if (!isObj(x)) return;
        if (isObj(x.variable) && typeof x.variable.name === "string" && deferred.has(x.variable.name)) return;
        for (const [k, v] of Object.entries(x)) {
            if (k === "resources" || k === "components") continue;
            const kind = isObj(v) ? k : null;
            const node = kind && isObj(v) ? v : null;
            const mods = node && Array.isArray(node.modifiers) ? node.modifiers : null;
            const vis = mods?.find((m) => isObj(m) && typeof m.visibility === "string");
            // (Measured in the TS player: the component's own modifiers and its own text go on
            // updating while it is hidden; its content, children and canvas commands, does not.)
            let inner = stack;
            if (vis) {
                hideables.push(`a ${kind} with visibility ${JSON.stringify(vis.visibility)}`);
                inner = [...stack, hideables.length - 1];
            }
            if (node && /^statelayout$/i.test(kind) && Array.isArray(node.children)) {
                for (const [k2, v2] of Object.entries(node)) if (k2 !== "children") walk(v2, stack);
                node.children.forEach((c, i) => {
                    hideables.push(`child ${i} of a stateLayout`);
                    walk(c, [...inner, hideables.length - 1]);
                });
                continue;
            }
            if (vis) {
                for (const [k2, v2] of Object.entries(node)) walk(v2, k2 === "children" || k2 === "commands" ? inner : stack);
                continue;
            }
            walk(v, stack);
        }
    };
    walk(doc.root, []);

    const hits = [];
    for (const [name, stack] of written) {
        if (!stack.length) continue;
        const h = stack[stack.length - 1];
        if (reads.some((r) => r.name === name && !r.stack.includes(h))) hits.push({ name, where: hideables[h] });
    }
    if (!hits.length) return [];
    const byWhere = new Map();
    for (const { name, where } of hits) byWhere.set(where, [...(byWhere.get(where) ?? []), name]);
    const detail = [...byWhere].slice(0, 3).map(([w, ns]) => `${ns.slice(0, 8).join(", ")}${ns.length > 8 ? ", …" : ""} inside ${w}`).join("; ");
    return [{
        severity: "warning", code: "hidden_first_read",
        title: `${hits.length} variable(s) first read inside hideable content, and read outside it too (${detail})`,
        message: "A variable command inside the layout is written where it is FIRST read, here in the content (children or canvas commands) of a " +
            "component that can be hidden; hidden content is not painted, so the expression is not re-evaluated (on Android too) and every other reader sees a value frozen " +
            "while it is hidden: an animation that does not move, a value that does not follow a slider. Declare values shared by views that " +
            "can be hidden up front: in a root {\"global\": {\"children\": [{\"variable\": ...}, ...]}} block (or resources.variables, or a " +
            "variable command at the root level), which is re-evaluated every frame whatever is shown.",
        count: hits.length,
    }];
}

function layoutFindings(doc) {
    const out = [];
    const { canvases, layout } = scanLayout(doc);
    const W = Number(doc.header?.width) || 0;
    const allText = canvases.reduce((n, c) => n + flatCommands(commandsOf(c)).filter((x) => TEXT_DRAWS.has(commandName(x))).length, 0);
    if (allText >= 4 && layout === 0) {
        out.push({
            // A drawing demo labels a few things on its canvas; a UI drawn this way has many texts.
            severity: allText >= 12 ? "warning" : "info", code: "absolute_layout",
            title: `The whole UI is drawn on a canvas (${allText} texts placed by hand)`,
            message: `No layout component: every text and box is positioned at fixed coordinates. ${LAYOUT_FIX}`,
            count: allText,
        });
    }
    for (const c of canvases) {
        const cmds = flatCommands(commandsOf(c));
        const draws = cmds.filter((x) => DRAWS.test(commandName(x)));
        // Labels hand-placed inside a drawing, in a document that otherwise has a layout: they
        // scale with the drawing instead of relaying out, and screen readers can't reach them.
        // (Loops draw the same label repeatedly: count the commands, not their iterations.)
        const texts = cmds.filter((x) => TEXT_DRAWS.has(commandName(x))).length;
        if (layout > 0 && texts >= 5) {
            out.push({
                severity: texts >= 12 ? "warning" : "info", code: "text_in_canvas",
                title: `${texts} texts drawn inside a canvas`,
                message: "Labels, values and titles drawn on a canvas are placed by hand: they don't measure or wrap, " +
                    "scale with the drawing instead of relaying out, and screen readers can't read them. Put them in " +
                    "text components around the drawing (a row of axis labels under a chart, a column of values beside " +
                    "it; LineChart and the other library charts do this) and keep the canvas for the shapes.",
                count: texts,
            });
        }
        const resizes = (c.modifiers ?? []).some(RESIZING);
        // Fixed: every coordinate of every draw is a literal (no expression, no variable) and
        // nothing scales the drawing to the component's size.
        const literalOnly = draws.every((x) => Object.entries(Object.values(x)[0] ?? {})
            .every(([k, v]) => k === "text" || k === "path" || typeof v !== "string"));
        const scaled = cmds.some((x) => ["scale", "translate", "matrix"].includes(commandName(x)) && /[@a-z(]/i.test(JSON.stringify(Object.values(x)[0])));
        // ...and the drawing spans the header-sized layout (coordinates past half the header
        // width or height), so it only fits that size; small offsets from the top left are fine.
        const H = Number(doc.header?.height) || 0;
        const reach = (keys) => Math.max(0, ...draws.flatMap((x) => Object.entries(Object.values(x)[0] ?? {})
            .filter(([k, v]) => keys.test(k) && typeof v === "number").map(([, v]) => v)));
        const spans = (W && reach(/^(?:x|x1|x2|cx|left|right)$/) > 0.6 * W) || (H && reach(/^(?:y|y1|y2|cy|top|bottom)$/) > 0.6 * H);
        if (resizes && draws.length >= 6 && literalOnly && !scaled && spans && !SIZE_EXPR.test(JSON.stringify(cmds))) {
            out.push({
                severity: "warning", code: "fixed_coordinates",
                title: `A canvas that resizes draws at fixed coordinates (${draws.length} draws)`,
                message: "It fills its parent, but every coordinate is a literal laid out for the header size, so " +
                    "on another screen the drawing is cut off or leaves empty space. Derive positions from " +
                    "componentWidth() / componentHeight() (named `variable`s once, then reused), scale a fixed " +
                    "design box to the size, or use layout components for anything that isn't a drawing.",
                count: draws.length,
            });
        }
        // drawTextAnchored: panX/panY say where the text goes relative to (x, y): -1 right of / above,
        // 0 centred, 1 left of / below. 0 near an edge cuts the text in half.
        let textSize = 14;
        // Coordinates relative to a translate, scale or loop are not the canvas's own.
        const relative = cmds.some((x) => ["translate", "scale", "matrix", "loop", "rotate"].includes(commandName(x)));
        for (const x of relative ? [] : cmds) {
            if (isObj(x) && isObj(x.paint) && typeof x.paint.textSize === "number") textSize = x.paint.textSize;
            const t = isObj(x) ? x.drawTextAnchored : null;
            if (!isObj(t) || typeof t.x !== "number" || !W || typeof t.text !== "string" || /^[@$]/.test(t.text)) continue;
            // Roughly half the text's width (0.55 em per character): centred on x, does it cross an edge?
            const half = 0.55 * textSize * t.text.length / 2;
            if (t.panX === 0 && (t.x - half < -2 || t.x + half > W + 2)) {
                out.push({
                    severity: "warning", code: "text_anchor",
                    title: `Centred text anchored near the edge ("${String(t.text).slice(0, 30)}" at x=${t.x})`,
                    message: "drawTextAnchored panX 0 CENTRES the text on x, so text anchored near an edge is cut in " +
                        "half. panX -1 puts the text to the right of x (left-aligned), 1 to the left of x " +
                        "(right-aligned); panY -1 puts it above y, 0 centres it, 1 below. Better still, use a text " +
                        "component in a row or column.",
                });
                break;
            }
        }
    }
    if (out.some((f) => f.code === "fixed_coordinates")) for (const f of out) if (f.code === "absolute_layout") f.severity = "warning";

    // A screen of text alone: no icon, no drawing, no chart, no image. It reads as a form, and
    // what it says (a status, a quantity, a time) is easier to see as a picture.
    let texts = 0, visual = 0;
    // The document's own components that draw (a canvas or image in their body): a call to one
    // is a visual (a calorie ring and macro bars written as inline components were missed).
    // (A body that calls a library visual — an Icon, a ProgressBar — counts too: a status
    // icon and bars written as an inline row component were missed.)
    const VISUAL_CALL = /"(canvas|image|Icon|MoonPhase|WeatherIcon|BatteryIndicator|ProgressRing|ProgressBar|Gauge|LineChart|Sparkline|BarChart|DonutChart|AnalogClock|Steps|Legend|Rating|Avatar)"\s*:/;
    const drawing = new Set(Object.entries(isObj(doc.components) ? doc.components : {})
        .filter(([, d]) => VISUAL_CALL.test(JSON.stringify(d?.body ?? d ?? {})) || /"type"\s*:\s*"(canvas|image)"/i.test(JSON.stringify(d?.body ?? {})))
        .map(([name]) => name));
    // A component calling another drawing component draws too (two passes cover the usual nesting).
    for (let pass = 0; pass < 2; pass++) for (const [name, d] of Object.entries(isObj(doc.components) ? doc.components : {})) {
        if (!drawing.has(name) && [...drawing].some((n) => JSON.stringify(d?.body ?? {}).includes(`"${n}"`))) drawing.add(name);
    }
    const scan = (n) => {
        if (Array.isArray(n)) return n.forEach(scan);
        if (!isObj(n)) return;
        for (const [k, v] of Object.entries(n)) {
            const lk = k.toLowerCase();
            if (drawing.has(k)) visual++;
            if (lk === "text" && isObj(v)) texts++;
            if (lk === "canvas" || lk === "image" || /^(Icon|MoonPhase|WeatherIcon|BatteryIndicator|ProgressRing|ProgressBar|Gauge|LineChart|Sparkline|BarChart|DonutChart|AnalogClock|Avatar|Slider|Switch|Checkbox)$/.test(k)) visual++;
            scan(v);
        }
        if (typeof n.type === "string" && /^(canvas|image)$/i.test(n.type)) visual++;
    };
    scan(doc.root);
    if (visual === 0 && texts >= 8) {
        out.push({
            severity: "info", code: "text_only",
            title: `A screen of ${texts} texts and nothing else`,
            message: "No icon, drawing, chart or image: give it a visual focal point. Icons for statuses and kinds " +
                "({\"Icon\": {\"name\": ...}}, find kind \"icons\"), a chart or ring for quantities and progress (LineChart, " +
                "ProgressRing, Gauge, BarChart), a drawing for what has a shape (a component of your own).",
            count: texts,
        });
    }
    return out;
}

/** Whether anything in the document reads the date or time of day. */
export function readsClock(doc) {
    let found = false;
    const visit = (node, key) => {
        if (found) return;
        if (typeof node === "string") { if (CLOCK_EXPR.test(node) || /^time\.(?:date|clock)/.test(node)) found = true; return; }
        if (Array.isArray(node)) { node.forEach((x) => visit(x, key)); return; }
        if (!isObj(node)) return;
        for (const [k, v] of Object.entries(node)) {
            if (CLOCK_COMPONENTS.test(k) || /^time\.(?:date|clock)/.test(k)) { found = true; return; }
            visit(v, k);
        }
        if (typeof node.type === "string" && CLOCK_COMPONENTS.test(node.type)) found = true;
    };
    visit(doc);
    return found;
}

/** Design findings for a RemoteCompose JSON document (object or JSON text), before expansion. */
// {"value": ..., "anim": 1}: the reference parser packs a 1 s duration as "the default", which
// it writes as no animation at all, so the value jumps (json2rc matches it byte for byte).
function animOneFindings(doc) {
    let n = 0;
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        if ("value" in x && "anim" in x && Number(x.anim) === 1) n++;
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc.root); visit(doc.resources); visit(doc.components);
    return n ? [{
        severity: "warning", code: "anim_one_second",
        title: `${n} animated value(s) with "anim": 1 do not animate`,
        message: "A duration of exactly 1 second is written as no animation by the format's JSON parser (1 is its default and packs to nothing), so the value jumps. Use 0.99 or 1.01 (or any other duration).",
        count: n,
    }] : [];
}

// A text field that is exactly "@name" where nothing declares `name`: the converter keeps it as
// the literal text "@name" (a screen reader announced "@powerDesc"). A name declared only LATER in
// the document (a canvas's own commands come after its modifiers, so a description there cannot
// read a text the canvas declares) is just as literal (a run's description read "@vn0@vn1").
function undeclaredRefFindings(doc) {
    const declared = new Set(), later = new Set();
    const declares = (k, v) => ["name", "varName", "localItem", "index", "as"].includes(k) && typeof v === "string";
    const collect = (x) => {
        if (Array.isArray(x)) { x.forEach(collect); return; }
        if (!isObj(x)) return;
        for (const [k, v] of Object.entries(x)) {
            if (declares(k, v)) later.add(v);
            if (k === "parameters" && Array.isArray(v)) for (const p of v) if (typeof p === "string") later.add(p);
            collect(v);
        }
    };
    collect(doc.root); collect(doc.global);
    for (const sec of Object.values(doc.resources ?? {})) {
        if (isObj(sec)) for (const k of Object.keys(sec)) declared.add(k);
        else if (Array.isArray(sec)) for (const e of sec) if (isObj(e)) { if (typeof e.name === "string") declared.add(e.name); else for (const k of Object.keys(e)) declared.add(k); }
    }
    const bad = new Map(), early = new Map();
    const FIELDS = new Set(["contentDescription", "stateDescription", "text", "value", "label", "hint", "id1", "id2"]);
    const check = (v) => {
        const m = /^@([A-Za-z_][\w]*)$/.exec(v);
        if (!m || declared.has(m[1])) return;
        const into = later.has(m[1]) ? early : bad;
        into.set(m[1], (into.get(m[1]) ?? 0) + 1);
    };
    // Document order: a node's modifiers are written before its content.
    const keysInOrder = (x) => Object.keys(x).sort((a, b) => (b === "modifiers") - (a === "modifiers"));
    const visit = (x, inCall) => {
        if (Array.isArray(x)) { x.forEach((y) => visit(y, inCall)); return; }
        if (!isObj(x)) return;
        const after = [];
        for (const k of keysInOrder(x)) {
            const v = x[k];
            // A component call's arguments are its params; the expander resolves those.
            if (/^[A-Z]/.test(k) && isObj(v)) { visit(v, true); continue; }
            if (!inCall && FIELDS.has(k) && typeof v === "string") check(v);
            // A text op's own varName is declared once its parts are read.
            if (declares(k, v) && k === "varName") { after.push(v); continue; }
            if (declares(k, v)) declared.add(v);
            if (k === "parameters" && Array.isArray(v)) for (const p of v) if (typeof p === "string") declared.add(p);
            visit(v, inCall && !(NODE_KINDS.test(k)));
        }
        for (const v of after) declared.add(v);
    };
    visit(doc.global, false);
    visit(doc.root, false);
    const out = [];
    if (bad.size) {
        const names = [...bad.keys()];
        out.push({
            severity: "warning", code: "undeclared_reference",
            title: `${names.length} "@name" reference(s) to nothing declared: ${names.slice(0, 6).map((n) => "@" + n).join(", ")}`,
            message: "A text or description that names no declared variable is kept as the literal text (a screen reader reads \"@" + names[0] + "\"). Declare it (resources.variables, a tree variable, a textMerge varName) or fix the name.",
            count: names.length,
        });
    }
    if (early.size) {
        const names = [...early.keys()];
        out.push({
            severity: "warning", code: "reference_before_declaration",
            title: `${names.length} "@name" reference(s) read before their declaration: ${names.slice(0, 6).map((n) => "@" + n).join(", ")}`,
            message: "The document is read in order, and a name not yet declared is kept as the literal text (\"@" + names[0] + "\" is what a screen reader hears). A canvas's commands come after its own modifiers, so a description on the canvas cannot read a text its commands declare. Declare it earlier: in an earlier sibling (a size-0 canvas with the text ops before it), or as a document-level text.",
            count: names.length,
        });
    }
    return out;
}

// A padding object reads only start/top/end/bottom: "left", "right", "horizontal" or
// "vertical" are dropped without a word (a run's 4 dp left padding never appeared).
function paddingKeyFindings(doc) {
    const bad = new Set();
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        if (isObj(x.padding) && !("$if" in x.padding)) for (const k of Object.keys(x.padding)) if (!["start", "top", "end", "bottom"].includes(k)) bad.add(k);
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc.root); for (const c of Object.values(doc.components ?? {})) if (isObj(c)) visit(c.body);
    return bad.size ? [{
        severity: "warning", code: "padding_key",
        title: `padding {${[...bad].join(", ")}} is ignored`,
        message: "A padding object takes only start, top, end and bottom. Write {\"padding\": {\"start\": 4}} or a list: [all], [horizontal, vertical] or [start, top, end, bottom].",
        count: bad.size,
    }] : [];
}

// {"padding": 16} before the background or clip is a margin outside them: the content then sits
// on the card's edge and a rounded clip cuts its corner (a header lost its first letter, in every
// render, and the picture was the only sign). Modifiers apply in order.
function modifierOrderFindings(doc) {
    let count = 0;
    const has = (m, k) => isObj(m) && k in m;
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        // (Content centred in its box stays clear of the edge: a margin there is a touch target.)
        const centred = x.horizontalAlignment === "center" && x.verticalAlignment === "center";
        if (Array.isArray(x.modifiers) && !centred && (Array.isArray(x.children) || "value" in x)) {
            const ms = x.modifiers;
            const edge = ms.findIndex((m) => has(m, "background") || has(m, "clip"));
            const lastEdge = ms.reduce((acc, m, i) => (has(m, "background") || has(m, "clip") ? i : acc), -1);
            const before = ms.findIndex((m) => has(m, "padding"));
            const after = ms.findIndex((m, i) => i > lastEdge && has(m, "padding"));
            if (edge >= 0 && before >= 0 && before < edge && after < 0) count++;
        }
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc.root); for (const c of Object.values(doc.components ?? {})) if (isObj(c)) visit(c.body);
    return count ? [{
        severity: "warning", code: "padding_before_background",
        title: `${count} container(s) have their padding before their background or clip`,
        message: "Modifiers apply in order, so that padding is a margin outside the background: the content touches the edge and a rounded clip cuts it. Put padding after them: [{\"clip\": 12}, {\"background\": \"@colors.surface\"}, {\"padding\": 16}]. (A margin as well: a second padding before.)",
        count,
    }] : [];
}

// A bare "verticalScroll" does not scroll in Java or TS, only in C++ (U84). And an onRelease inside
// a scroll also fires for the LAST child wherever the finger was, and never for the dragged
// control (U80): that is the Java player's behaviour, so it is what a device does.
function scrollFindings(doc) {
    let bare = 0, released = 0;
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        if (Array.isArray(x.modifiers)) {
            const scrolls = x.modifiers.some((m) => m === "verticalScroll" || m === "horizontalScroll" || (isObj(m) && ("verticalScroll" in m || "horizontalScroll" in m)));
            if (x.modifiers.includes("verticalScroll") || x.modifiers.includes("horizontalScroll")) bare++;
            if (scrolls && /"onRelease"/.test(JSON.stringify(x.children ?? []))) released++;
        }
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc.root); for (const c of Object.values(doc.components ?? {})) if (isObj(c)) visit(c.body);
    const out = [];
    if (bare) out.push({ severity: "warning", code: "bare_scroll", title: `${bare} bare "verticalScroll" modifier(s)`,
        message: "As a bare word it does not scroll on Android or in TypeScript, though the C++ render scrolls. Bind it: {\"verticalScroll\": \"@scroll\"} with resources.variables {\"scroll\": 0}.", count: bare });
    if (released) out.push({ severity: "warning", code: "release_in_scroll", title: `${released} scrolling container(s) hold a control with onRelease`,
        message: "Inside a scroll, onRelease also fires for the last child wherever the finger lifts, and the dragged control's own may not fire (the reference player does this). Tell the app from the value instead (it reads the exported variable), or put the control outside the scroll.", count: released });
    return out;
}

// Weights share the whole width and spacedBy then adds to it: the gaps run past the edge and cut
// the last child (a condition word became "Clea").
function spacedByWeightFindings(doc) {
    let count = 0;
    const weighted = (c) => isObj(c) && Object.values(c).some((n) => isObj(n) && Array.isArray(n.modifiers) && n.modifiers.some((m) => isObj(m) && ("weight" in m || "verticalWeight" in m || "horizontalWeight" in m)));
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        if (Array.isArray(x.modifiers) && Array.isArray(x.children)
            && x.modifiers.some((m) => isObj(m) && Number(m.spacedBy) > 0) && x.children.some(weighted)) count++;
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc.root); for (const c of Object.values(doc.components ?? {})) if (isObj(c)) visit(c.body);
    return count ? [{
        severity: "info", code: "spaced_by_with_weight",   // (a render reports the overflow when it really happens)
        title: `${count} row(s) or column(s) mix spacedBy with a weighted child`,
        message: "The weights share the whole size, then the gaps overflow it by their sum and the last child is cut. Separate the children with spacer boxes ({\"box\": {\"modifiers\": [{\"width\": 8}]}}) instead of spacedBy.",
        count,
    }] : [];
}

// "weight" is the horizontal weight (the reference JSON's meaning): in a column it gives the
// child no height (an empty box gets 0, a filling one takes everything and squeezes out what
// follows). And a later fill or size on the same axis replaces a weight: RecordingModifier keeps
// one width and one height modifier.
function weightAxisFindings(doc) {
    const wrong = [], overridden = [];
    const W = ["weight", "horizontalWeight"], H = ["verticalWeight"];
    const has = (m, keys) => isObj(m) && keys.some((k) => k in m);
    const nodeOf = (c) => !isObj(c) ? null : typeof c.type === "string" ? { kind: c.type, n: c }
        : (([k, v]) => (isObj(v) ? { kind: k, n: v } : null))(Object.entries(c)[0] ?? []);
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        const me = nodeOf(x);
        if (me && Array.isArray(me.n.children) && ["row", "column"].includes(me.kind)) {
            const bad = me.kind === "column" ? W : H;
            for (const c of me.n.children) {
                const mods = nodeOf(c)?.n.modifiers;
                if (Array.isArray(mods) && mods.some((m) => has(m, bad))) wrong.push(me.kind);
            }
        }
        if (Array.isArray(x.modifiers)) {
            const mods = x.modifiers, name = (m) => (typeof m === "string" ? m : isObj(m) ? Object.keys(m)[0] : "");
            mods.forEach((m, i) => {
                const later = mods.slice(i + 1).map(name);
                if (has(m, W) && later.some((k) => ["fillMaxWidth", "fillMaxSize", "width", "size"].includes(k))) overridden.push("weight");
                if (has(m, H) && later.some((k) => ["fillMaxHeight", "fillMaxSize", "height", "size"].includes(k))) overridden.push("verticalWeight");
            });
        }
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc.root); for (const c of Object.values(doc.components ?? {})) if (isObj(c)) visit(c.body);
    const out = [];
    if (wrong.length) out.push({ severity: "warning", code: "weight_wrong_axis",
        title: `${wrong.length} weighted child(ren) use the other axis's weight`,
        message: "\"weight\" is horizontal: in a row. In a column use {\"verticalWeight\": 1}. A column child with \"weight\" gets no height (an empty box collapses to 0; one that also fills takes the whole column and squeezes out what follows).",
        count: wrong.length });
    if (overridden.length) out.push({ severity: "warning", code: "weight_overridden",
        title: `${overridden.length} weight(s) replaced by a later fill or size on the same axis`,
        message: "An element keeps one width and one height modifier: a fillMaxWidth / fillMaxSize / width after {\"weight\"} (or fillMaxHeight / height after {\"verticalWeight\"}) replaces the weight. Drop the fill: the weight already fills its share.",
        count: overridden.length });
    return out;
}

// A label on a container that cannot be tapped is read, and then so is every text inside: only a
// click merges them into one item (semantics in JSON are always mode SET).
function repeatedLabelFindings(doc) {
    let count = 0;
    const hasText = (x) => Array.isArray(x) ? x.some(hasText) : isObj(x) && (isObj(x.text) || Object.values(x).some(hasText));
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        if (Array.isArray(x.modifiers) && Array.isArray(x.children)
            && x.modifiers.some((m) => isObj(m) && isObj(m.semantics) && m.semantics.contentDescription !== undefined)
            && !JSON.stringify(x.modifiers).includes("onClick") && hasText(x.children)) count++;
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc.root); for (const c of Object.values(doc.components ?? {})) if (isObj(c)) visit(c.body);
    return count ? [{
        severity: "info", code: "label_read_twice",
        title: `${count} labelled container(s) that cannot be tapped hold text`,
        message: "A screen reader reads the label and then the texts inside as well. Only a tappable container merges them. Drop the label and let the text speak, or word the label to add only what the text lacks.",
        count,
    }] : [];
}

// A text or container with a fixed number for its width fits one screen size only: a text cut to
// "Oc…" in a 2x2 widget, a card floating in the middle of a larger one.
function fixedWidthFindings(doc) {
    let texts = 0, boxes = 0;
    // (A narrow fixed column, such as labels lined up in a table, is fine.)
    const fixed = (ms) => ms.some((m) => isObj(m) && typeof m.width === "number" && m.width >= 100);
    // (Under a fitBox a fixed width is how an alternative says what it needs, so it is meant.)
    const visit = (x, inCanvas) => {
        if (Array.isArray(x)) { x.forEach((y) => visit(y, inCanvas)); return; }
        if (!isObj(x)) return;
        for (const [k, v] of Object.entries(x)) {
            if (!isObj(v)) { if (Array.isArray(v) || isObj(v)) visit(v, inCanvas); continue; }
            const lk = k.toLowerCase();
            if (lk === "fitbox") continue;
            if (!inCanvas && Array.isArray(v.modifiers) && fixed(v.modifiers)) {
                if (lk === "text") texts++;
                else if (["column", "row", "box", "collapsiblecolumn", "collapsiblerow"].includes(lk) && v.modifiers.some((m) => isObj(m) && typeof m.width === "number" && m.width >= 120)) boxes++;
            }
            visit(v, inCanvas || lk === "canvas");
        }
    };
    visit(doc.root, false); for (const c of Object.values(doc.components ?? {})) if (isObj(c)) visit(c.body, false);
    return texts >= 2 || boxes >= 1 ? [{
        severity: "warning", code: "fixed_widths",
        title: `${texts} text(s) and ${boxes} container(s) have a fixed width`,
        message: "They fit one size only: at another a text is cut, or the content floats in empty space. Let the size decide: \"fillMaxWidth\" on containers, {\"weight\": 1} on the text that should take the room in a row (it ellipsizes when short of it), and a fixed width only for small things such as a badge.",
        count: texts + boxes,
    }] : [];
}

// An `integers` resource read in a float expression (an index, a size, a TextChoice): float
// expressions read an integer variable as 0, so the choice never moves (a weather name stayed
// "Sunny" next to a rain icon).
function integerInFloatFindings(doc) {
    const ints = Object.keys(isObj(doc.resources?.integers) ? doc.resources.integers : {});
    if (!ints.length) return [];
    const used = new Set();
    const re = new RegExp(`@(${ints.map((n) => n.replace(/[^\w]/g, "")).join("|")})\\b`, "g");
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (typeof x === "string") { for (const m of x.matchAll(re)) used.add(m[1]); return; }
        if (!isObj(x)) return;
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc.root); for (const c of Object.values(doc.components ?? {})) if (isObj(c)) visit(c.body);
    return used.size ? [{
        severity: "warning", code: "integer_in_expression",
        title: `${used.size} integer variable(s) read where a number is expected: ${[...used].map((n) => "@" + n).join(", ")}`,
        message: "A float expression (an index, a size, a position, a component's number param) reads an `integers` resource as 0, so it never changes. Declare the host value as a float in resources.variables ({\"code\": {\"value\": 3, \"export\": true}}); integers are only for integer-typed ops.",
        count: used.size,
    }] : [];
}

// A stateLayout whose panes (a phone, a widget, a tablet layout) repeat the same texts and
// component calls: each copy is written in full (documents of 27-32 KB in the eval runs).
function repeatedPaneFindings(doc) {
    let repeated = 0, panes = 0;
    const sigs = (x, out) => {
        if (Array.isArray(x)) { x.forEach((y) => sigs(y, out)); return out; }
        if (!isObj(x)) return out;
        for (const [k, v] of Object.entries(x)) {
            if (k === "text" && isObj(v) && !("type" in v)) out.add("text:" + JSON.stringify(v.text ?? v.value));
            else if (/^[A-Z]/.test(k) && isObj(v)) out.add(k + ":" + JSON.stringify(v));
            sigs(v, out);
        }
        return out;
    };
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        for (const [k, v] of Object.entries(x)) {
            if (/^statelayout$/i.test(k) && isObj(v) && Array.isArray(v.children) && v.children.length > 1) {
                const each = v.children.map((c) => sigs(c, new Set()));
                const count = new Map();
                for (const s of each) for (const sig of s) count.set(sig, (count.get(sig) ?? 0) + 1);
                const rep = [...count.values()].filter((n) => n > 1);
                repeated += rep.reduce((a, n) => a + n - 1, 0);
                panes = Math.max(panes, v.children.length);
            }
            visit(v);
        }
    };
    visit(doc.root);
    return repeated >= 6 ? [{
        severity: "info", code: "repeated_panes",
        title: `${repeated} texts and component calls are repeated across stateLayout panes (up to ${panes} panes)`,
        message: "Each pane is written in full, so a phone/widget/tablet document carries its content once per layout. Put the shared parts in " +
            "inline components (\"components\": {...}) called from each pane, and set \"componentMode\": \"pattern\": a component used " +
            "several times is then written once as a template. Or keep one layout that adapts (weights, fitBox, collapsible) where the panes differ little.",
        count: repeated,
    }] : [];
}

// A variable named like an expression function ("step", "min", "time", "day"): both parsers look
// the name up as a variable first, so "step(2.5, @cur)" becomes 2.5 * cur (U77).
const EXPR_FUNCTIONS = new Set(["seed", "seed_2arg", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sqrt", "abs", "pow", "min", "max", "floor", "ceil", "log", "ln", "sign", "round", "lerp", "step", "smooth_step", "clamp", "ifElse", "mad", "ping_pong", "fract", "exp", "hypot", "square", "rand", "arrayMin", "arrayMax", "arrayLength", "arraySum", "arraySumSqr", "arraySumXY", "arrayGet", "spline", "arraySpline", "splineLoop", "anim", "time", "continuousSec", "seconds", "timeInSec", "timeInMin", "timeInHr", "animationTime", "animTime", "deltaTime", "delta_time", "dt", "animationDeltaTime", "epochSecond", "calendarMonth", "month", "offsetToUtc", "utcOffset", "weekDay", "weekday", "dayOfWeek", "dayOfMonth", "day", "dayOfYear", "year", "windowWidth", "windowHeight", "density", "apiLevel", "fontSize", "touchX", "touchPosX", "touchPositionX", "touchY", "touchPosY", "touchPositionY", "touchVelX", "touchVelocityX", "touchVelY", "touchVelocityY", "touchTime", "touchEventTime", "accelX", "accelerationX", "accelY", "accelerationY", "accelZ", "accelerationZ", "gyroX", "gyroRotX", "gyroRotationX", "gyroY", "gyroRotY", "gyroRotationY", "gyroZ", "gyroRotZ", "gyroRotationZ", "magneticX", "magneticY", "magneticZ", "light", "lightLevel", "batteryLevel", "powerState", "memoryFree", "networkSignal", "rand", "u", "v"]);
function shadowedFunctionFindings(doc) {
    const names = new Set();
    const vars = doc.resources?.variables;
    if (isObj(vars)) for (const k of Object.keys(vars)) names.add(k);
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        if (isObj(x.variable) && typeof x.variable.name === "string") names.add(x.variable.name);
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc.root);
    // Only a name the document also CALLS is a problem ("day" as a variable is fine until
    // something writes day()).
    const text = JSON.stringify(doc);
    const bad = [...names].filter((n) => EXPR_FUNCTIONS.has(n) && new RegExp(`(^|[^@\\w.])${n}\\s*\\(`).test(text));
    return bad.length ? [{
        severity: "warning", code: "shadowed_function",
        title: `${bad.length} variable(s) named like an expression function: ${bad.join(", ")}`,
        message: `A variable named ${bad[0]} hides the function ${bad[0]}() in every expression of the document (the format's parser looks names up as variables first: "${bad[0]}(2.5, @x)" no longer calls it). Rename the variable (${bad[0]}Index, cur${bad[0][0].toUpperCase() + bad[0].slice(1)}).`,
        count: bad.length,
    }] : [];
}

// {"spacedBy": "@gap"}: the spacing is a row/column parameter the players read as a plain
// number; a variable there (its NaN-boxed id) collapses the layout (every child 0 wide).
function spacedByVariableFindings(doc) {
    let n = 0;
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        if (Array.isArray(x.modifiers)) for (const m of x.modifiers) if (isObj(m) && typeof m.spacedBy === "string" && !/^-?\d+(\.\d+)?$/.test(m.spacedBy)) n++;
        for (const v of Object.values(x)) visit(v);
    };
    visit(doc.root); for (const c of Object.values(doc.components ?? {})) if (isObj(c)) visit(c.body);
    return n ? [{
        severity: "warning", code: "spaced_by_variable",
        title: `${n} spacedBy given a variable or expression`,
        message: "spacedBy is a plain number (dp): a \"@variable\" there is read as garbage and the row or column lays its children out 0 wide. Use a number, or fixed spacer boxes whose width is the variable.",
        count: n,
    }] : [];
}

// A layout text with no colour draws black in every look: invisible on a dark or mono-dark
// background (a run's plant widget lost its labels there while render said nothing).
function uncoloredTextFindings(doc) {
    let n = 0; const examples = [];
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        for (const [k, v] of Object.entries(x)) {
            // (A {"type": "textFromFloat", ...} under "text" is a text expression, not a node.)
            if (k === "text" && isObj(v) && !("type" in v) && ("text" in v || "value" in v) && !("color" in v)) {
                n++;
                const t = v.text ?? v.value;
                if (examples.length < 4) examples.push(typeof t === "string" ? JSON.stringify(t.slice(0, 30)) : "(computed)");
            }
            visit(v);
        }
    };
    visit(doc.root);
    // Only a component's body draws texts (its params and slots are declarations).
    for (const c of Object.values(doc.components ?? {})) if (isObj(c)) visit(c.body);
    if (!n) return [];
    const themed = JSON.stringify(doc).includes("@colors.");
    return [{
        severity: themed ? "warning" : "info", code: "uncolored_text",
        title: `${n} text(s) have no "color": they draw black in every look`,
        message: `Black text is invisible on a dark or mono-dark background (${examples.join(", ")}). ` +
            "Give each text a theme colour: \"color\": \"@colors.onSurface\" (or @colors.muted for secondary text).",
        count: n,
    }];
}

// An SVG path string ("M10 20 L30 40 Q..."): json2rc writes it compactly, but the Java parser
// pads every one to 1024 floats, about 4 KB, so the document an Android host builds is far larger.
function svgPathFindings(doc) {
    let n = 0;
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!isObj(x)) return;
        for (const [k, v] of Object.entries(x)) {
            if (k === "path" && typeof v === "string" && /^\s*[Mm]\s*-?\d/.test(v)) n++;
            else visit(v);
        }
    };
    visit(doc?.root); visit(doc?.resources?.paths);
    return n ? [{ severity: "warning", code: "svg_path_string",
        title: `${n} path(s) written as SVG strings: about 4 KB each when the Java parser builds the document`,
        message: "Write each path as an op list: [{\"type\": \"moveTo\", \"x\": 65, \"y\": 29}, {\"type\": \"lineTo\", ...}, {\"type\": \"quadTo\", ...}, {\"type\": \"close\"}] (resources.paths or drawPath), or use drawLine, drawCircle and drawRoundRect for simple shapes.", count: n }] : [];
}

export function designAudit(json) {
    const doc = typeof json === "string" ? JSON.parse(json) : json;
    if (!isObj(doc)) return [];
    const strings = collectStrings(doc);
    const findings = [
        ...glyphFindings(strings),
        ...repeatedFindings(doc),
        ...dateFindings(strings, readsClock(doc)),
        ...colorFindings(doc),
        ...layoutFindings(doc),
        ...visibilityFindings(doc),
        ...hiddenFirstReadFindings(doc),
        ...wrongKeyFindings(doc),
        ...svgPathFindings(doc),
        ...rootVariableFindings(doc),
        ...sharedActionNameFindings(doc),
        ...sharedStringFindings(doc),
        ...uncoloredTextFindings(doc),
        ...animOneFindings(doc),
        ...undeclaredRefFindings(doc),
        ...paddingKeyFindings(doc),
        ...modifierOrderFindings(doc),
        ...scrollFindings(doc),
        ...spacedByWeightFindings(doc),
        ...weightAxisFindings(doc),
        ...repeatedLabelFindings(doc),
        ...fixedWidthFindings(doc),
        ...integerInFloatFindings(doc),
        ...repeatedPaneFindings(doc),
        ...shadowedFunctionFindings(doc),
        ...spacedByVariableFindings(doc),
    ];
    // Literal colours are advice for a feature demo; in a document that is also hard-wired
    // otherwise (glyphs, copies, a fixed date), they are part of the same problem.
    if (findings.some((f) => f.severity === "warning")) {
        for (const f of findings) if (f.code === "hardcoded_colors") f.severity = "warning";
    }
    return findings;
}

/**
 * The best effort for a binary document: the glyph and date rules on its text data.
 * readsClock: whether the document reads a date system variable (unknown: treat as true).
 */
export function textAudit(strings, { readsClock: clock = true } = {}) {
    const items = strings.filter((s) => typeof s === "string").map((value) => ({ value }));
    return [...glyphFindings(items), ...dateFindings(items, clock)];
}

/**
 * The design warnings of a JSON document as a short text block for a tool result (convert,
 * render), or "" when there are none: a model that never calls audit still reads them.
 */
// Advice worth showing with the warnings although it is info level (a text-only screen: fine for
// a feature demo, a weak result for a generated UI).
const SUGGEST = new Set(["text_only"]);

// Faults that only exist once components are expanded: an expression passed through a param to
// a visibility, and a variable whose name hijacks a function the expansion calls ("round" breaks
// every TextChoice, which expands to round()).
export function expandedFindings(expanded, own) {
    if (!isObj(expanded)) return [];
    const sameAsOwn = (f) => own.some((o) => o.code === f.code);
    return [...visibilityFindings(expanded).filter((f) => f.code === "inline_visibility"), ...shadowedFunctionFindings(expanded), ...scrollFindings(expanded)].filter((f) => !sameAsOwn(f));
}

export function designNotes(json, expanded = null) {
    let all;
    try { all = designAudit(json); all = [...all, ...expandedFindings(expanded, all)]; } catch { return ""; }
    const findings = all.filter((f) => f.severity === "warning");
    const suggest = all.filter((f) => f.severity !== "warning" && SUGGEST.has(f.code));
    if (!findings.length && !suggest.length) return "";
    return [
        ...(findings.length ? ["design warnings (fix these; audit gives details):", ...findings.map((f) => `- [${f.code}] ${f.title}. ${f.message}`)] : []),
        ...(suggest.length ? ["suggestions:", ...suggest.map((f) => `- [${f.code}] ${f.title}. ${f.message}`)] : []),
    ].join("\n");
}

// The design problems a document must not ship with: its structure is wrong, not just its style
// (literal colours and fixed dates in a demo are advice; these break on another screen or device).
export const BLOCKING = new Set(["absolute_layout", "fixed_coordinates", "text_anchor", "glyph_icon", "expression_too_long"]);

/** The blocking design warnings of a JSON document (findings at warning level in BLOCKING). */
export function blockingFindings(json) {
    try { return designAudit(json).filter((f) => f.severity === "warning" && BLOCKING.has(f.code)); } catch { return []; }
}
