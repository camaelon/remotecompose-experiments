// The two players side by side: the C++ player (rc2layout; render's images come from it) and
// the TypeScript one (players/typescript/layout.mjs; inspect and the web playground run it)
// lay the same document out at the same size, and the components they place differently are
// named. When they disagree, an image and an inspection of the same document can tell
// different stories (a dropped collapsible child, a text that wraps in one only).

import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCUMENT_PROPS, prepareDocument } from "./document.mjs";
import { componentPaths } from "./json2rc.mjs";
import { resolvePath } from "./workspace.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYERS = path.join(HERE, "..", "..", "players");
const DEFAULT_RC2LAYOUT = path.join(PLAYERS, "cpp/build/tools/rc2layout/rc2layout");
// (Read at each call, so a test or an operator can point it elsewhere.)
const rc2layout = () => process.env.RC2LAYOUT ?? DEFAULT_RC2LAYOUT;
/** Is the C++ layout tool built here? Without it only the TypeScript layout is available. */
export const rc2layoutAvailable = () => existsSync(rc2layout());
const TS_DIR = path.join(PLAYERS, "typescript");
// Text is measured with real fonts in C++ and approximate metrics in Node, so a few dp of
// difference is expected: only structural differences (shown in one engine and not the
// other) or large moves are reported.
const TOL = 6;

const run = (cmd, argv, cwd) => new Promise((resolve) =>
    execFile(cmd, argv, { cwd, timeout: 60_000, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
        resolve(err ? { error: errorLine(String(stderr || err.message)) } : { out: stdout })));
// The line that says what went wrong: a Node crash ends with its version ("Node.js v25.9.0").
const errorLine = (s) => {
    const lines = s.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    return (lines.find((l) => /^\w*Error\b|Error:/.test(l)) ?? lines.at(-1) ?? "").slice(0, 200);
};

function parse(out) {
    const map = new Map();
    for (const m of out.matchAll(/^LAYOUT id=(-?\d+) x=(-?[\d.]+) y=(-?[\d.]+) w=(-?[\d.]+) h=(-?[\d.]+)(?: (\w+))?( GONE)?( INFITBOX)?/gm)) {
        // A GONE component (TS keeps its last box) counts as empty, as C++ reports it.
        map.set(+m[1], { x: +m[2], y: +m[3], w: +m[4], h: +m[5], type: m[6], gone: Boolean(m[7]), fitAlt: Boolean(m[8]) });
    }
    return map;
}

export const enginesTool = {
    name: "inspect_engines",
    get description() {
        return rc2layoutAvailable()
            ? "Lay the document out in both players (C++, which render uses, and TypeScript, which inspect and the playground use) at one size and list the components they place differently (x, y, w, h beyond 1 dp), each named by its path. Empty when they agree."
            : "Lay the document out in the TypeScript player (inspect and the playground use it) at one size and count its components. (The C++ comparison is not available on this server: its layout tool is not built.)";
    },
    inputSchema: { type: "object", properties: { ...DOCUMENT_PROPS,
        width: { type: "number", description: "Layout width (default: the header's)." },
        height: { type: "number", description: "Layout height (default: the header's)." } } },
    async handler(a = {}) {
        const doc = prepareDocument(a);
        if (doc.conversionError) throw new Error(doc.conversionError);
        try {
            let w = a.width, h = a.height;
            if (!(w > 0 && h > 0)) {
                const j = a.json_path ? JSON.parse(readFileSync(resolvePath(a.json_path, "json_path"), "utf8")) : typeof a.json === "string" ? JSON.parse(a.json) : a.json;
                w ??= j?.header?.width ?? 360; h ??= j?.header?.height ?? 640;
            }
            // Without the C++ tool: the TypeScript layout alone, said in one line, not an error.
            if (!rc2layoutAvailable()) {
                const t = await run("node", ["layout.mjs", doc.rcPath, "--width", String(w), "--height", String(h), "--all"], TS_DIR);
                if (t.error) throw new Error(`layout failed: ${t.error}`);
                const ts = parse(t.out);
                for (const [id, b] of ts) if (/Content$/.test(b.type ?? "")) ts.delete(id);
                const shown = [...ts.values()].filter((b) => !b.gone && b.w > 0.5 && b.h > 0.5).length;
                return [{ type: "text", text: JSON.stringify({ size: [w, h], compared: false, typescript: { components: ts.size, shown },
                    note: "Only the TypeScript layout: the C++ player's layout tool (rc2layout) is not built on this server, so the two players were not compared. render's images are the C++ engine; inspect layout gives the TypeScript tree in full." }, null, 1) }];
            }
            const [c, t] = await Promise.all([
                run(rc2layout(), [doc.rcPath, String(w), String(h)]),
                run("node", ["layout.mjs", doc.rcPath, "--width", String(w), "--height", String(h), "--all"], TS_DIR),
            ]);
            if (c.error || t.error) throw new Error(`layout failed: ${c.error ?? t.error}`);
            const cpp = parse(c.out), ts = parse(t.out);
            // Content wrappers (LayoutComponentContent, CanvasContent) are not components: C++
            // gives them their parent's box, TypeScript none. Only the TS dump names types.
            for (const [id, b] of ts) if (/Content$/.test(b.type ?? "")) { ts.delete(id); cpp.delete(id); }
            // GONE in TypeScript (a stateLayout's other panes, a visibility): the C++ dump has no
            // visibility and keeps such boxes, so they are not compared.
            // (A fitBox's alternatives stay compared: which one each engine picks is the classic
            // disagreement; a GONE one there is empty.)
            for (const [id, b] of ts) { if (b.gone && !b.fitAlt) { ts.delete(id); cpp.delete(id); } else if (b.gone) { b.w = 0; b.h = 0; } }
            const src = a.json_path ? readFileSync(resolvePath(a.json_path, "json_path"), "utf8") : a.json;
            const paths = src ? componentPaths(src, a.json_path ? path.dirname(resolvePath(a.json_path, "json_path")) : resolvePath(".")) : null;
            const diffs = [];
            for (const [id, b] of cpp) {
                const o = ts.get(id);
                const name = paths?.[id] ?? `#${id}`;
                if (!o) { diffs.push({ component: name, id, cpp: b, ts: null, what: "laid out in C++ only" }); continue; }
                const shown = (r) => r.w > 0.5 && r.h > 0.5;
                const box = (r) => [r.x, r.y, r.w, r.h].map((v) => +v.toFixed(1));
                if (shown(b) !== shown(o)) { diffs.push({ component: name, id, what: shown(b) ? "drawn in C++, empty in TypeScript" : "empty in C++, drawn in TypeScript", structural: true, cpp: box(b), ts: box(o) }); continue; }
                const off = ["x", "y", "w", "h"].filter((k) => Math.abs(b[k] - o[k]) > Math.max(TOL, 0.08 * Math.max(b.w, b.h, 1) * (k === "x" || k === "y" ? 0 : 1)));
                if (off.length) diffs.push({ component: name, id, what: off.join(", "), cpp: box(b), ts: box(o) });
            }
            for (const [id] of ts) if (!cpp.has(id)) diffs.push({ component: paths?.[id] ?? `#${id}`, id, what: "laid out in TypeScript only" });
            // The outermost differences first: a child moves when its parent did.
            diffs.sort((p, q) => (q.structural ? 1 : 0) - (p.structural ? 1 : 0) || String(p.component).length - String(q.component).length);
            return [{ type: "text", text: JSON.stringify({ size: [w, h], compared: true, components: cpp.size, agree: diffs.length === 0,
                ...(diffs.length ? { differences: diffs.length, first: diffs.slice(0, 12),
                    structural: diffs.filter((d) => d.structural).length, note: "Small text-height differences are expected (Node measures text approximately). render's images are the C++ layout; inspect (accessibility, interact) and the playground are the TypeScript one. Look first at the outermost component listed: its children follow it." } : {}) }, null, 1) }];
        } finally { if (doc.temp) try { rmSync(doc.rcPath, { force: true }); } catch {} }
    },
};
