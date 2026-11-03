// What to do about a conversion failure. json2rc's messages are exact but bare ("modifier
// 'margin'", "drawCircle: missing required field 'radius'"): this adds where in the document the
// culprit is, the nearest names that do exist, and a working example of the right form.
//
// The names that exist come from the example catalog (examples/*/doc*.json): every one of those
// documents converts, so every key they use is accepted, and the list follows the converter
// without being kept by hand. Read once, at the first failure.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadLibrary } from "./components.mjs";

const EXAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "examples");
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

// A name with no near spelling, but a usual meaning: what to write instead.
const INSTEAD = {
    modifier: {
        margin: "there is no margin: give the PARENT a {\"padding\": n}, or put a spacer ({\"spacer\": {\"modifiers\": [{\"height\": 8}]}}) between siblings, or a {\"spacedBy\": n} on the row or column",
        offset: "there is no offset modifier: place it in a box (contentAlignment), or with spacers, or draw it in a canvas",
        opacity: "{\"graphicsLayer\": {\"alpha\": 0.5}}",
        alpha: "{\"graphicsLayer\": {\"alpha\": 0.5}}",
        ontap: "{\"onClick\": [ ...actions ]}",
        onpress: "{\"onClick\": [ ...actions ]}",
        cornerradius: "{\"clip\": {\"roundedRect\": 12}} (and a background after it), or a border with \"shape\": 2",
        elevation: "no shadow modifier: draw a slightly larger, darker rounded background behind it",
        shadow: "no shadow modifier: draw a slightly larger, darker rounded background behind it",
        color: "a box takes {\"background\": \"@colors.surface\"}; a text takes \"color\" beside \"text\", not in modifiers",
    },
    component: {
        image: "a bitmap is {\"image\": {\"bitmap\": \"@name\"}} with resources.bitmaps; an icon is the library Icon component",
        button: "the library component is \"Button\" (capital B), or a box with an onClick modifier",
        icon: "the library component is \"Icon\" (capital I): {\"Icon\": {\"name\": \"home\"}}",
        spacer: "{\"spacer\": {\"modifiers\": [{\"width\": 8}]}}",
    },
};

let vocab = null;
/** The accepted names, by kind, each with the shortest example seen: {modifier: Map(lower -> {name, example, from})}. */
export function vocabulary() {
    if (vocab) return vocab;
    vocab = { modifier: new Map(), component: new Map(), command: new Map(), action: new Map(), paint: new Map(), field: new Map() };
    const add = (kind, name, example, from) => {
        const k = name.toLowerCase(), cur = vocab[kind].get(k);
        const ex = JSON.stringify(example);
        if (!cur || (ex.length < cur.example.length && ex.length > name.length + 6)) vocab[kind].set(k, { name, example: ex, from });
    };
    const walk = (x, from, ctx) => {
        if (Array.isArray(x)) {
            for (const y of x) {
                if (ctx === "modifiers") {
                    if (typeof y === "string") add("modifier", y, y, from);
                    else if (isObj(y)) for (const k of Object.keys(y)) add("modifier", k, { [k]: y[k] }, from);
                } else if (ctx === "children" && isObj(y)) {
                    for (const k of Object.keys(y)) if (isObj(y[k])) add("component", k, y, from);
                } else if (ctx === "commands" && isObj(y)) {
                    for (const k of Object.keys(y)) add("command", k, y, from);
                } else if (ctx === "ops" && isObj(y)) {
                    for (const k of Object.keys(y)) add("paint", k, y, from);
                } else if (ctx === "actions" && isObj(y) && typeof y.type === "string") add("action", y.type, y, from);
                walk(y, from, ctx === "actions" ? "actions" : null);
            }
            return;
        }
        if (!isObj(x)) return;
        for (const [k, v] of Object.entries(x)) {
            if (k === "modifiers" || k === "children" || k === "commands" || k === "ops") { walk(v, from, k); continue; }
            if (/^on[A-Z]/.test(k) || k === "multiClick" || k === "actions") {
                if (isObj(v) && typeof v.type === "string") add("action", v.type, v, from);
                walk(Array.isArray(v) ? v : [v], from, "actions");
                continue;
            }
            if (k === "root") {
                for (const y of Array.isArray(v) ? v : [v]) if (isObj(y)) for (const t of Object.keys(y)) if (isObj(y[t])) add("component", t, y, from);
            }
            walk(v, from, null);
        }
    };
    let dirs = [];
    try { dirs = readdirSync(EXAMPLES, { withFileTypes: true }).filter((d) => d.isDirectory() && /^[A-Z]+-\d/.test(d.name)).map((d) => d.name); } catch {}
    for (const d of dirs) {
        for (const f of ["doc.json", "doc.expanded.json"]) {
            const p = path.join(EXAMPLES, d, f);
            if (!existsSync(p)) continue;
            try { walk(JSON.parse(readFileSync(p, "utf8")), d.replace(/^([A-Z]+-\d+).*/, "$1"), null); } catch {}
        }
    }
    try { for (const name of Object.keys(loadLibrary().components ?? {})) add("component", name, { [name]: {} }, "the library"); } catch {}
    return vocab;
}

function distance(a, b) {
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[n];
}

/** The closest accepted names to `name` (case-insensitive), best first. */
export function nearest(name, names, max = 3) {
    const q = name.toLowerCase();
    return [...names].map((n) => {
        const l = n.toLowerCase();
        const d = distance(q, l);
        const contains = q.length >= 3 && (l.includes(q) || q.includes(l)) && Math.min(q.length, l.length) >= 3;
        // Every letter of the one, in order, in the other ("valuechange" in "valueFloatChange").
        const sub = (x, y) => { let i = 0; for (const ch of y) if (ch === x[i]) i++; return i === x.length; };
        if (!contains && q.length >= 5 && (sub(q, l) || sub(l, q))) return { n, score: 2 };
        return { n, score: contains ? Math.min(d, 1.5) : d };
    }).filter((x) => x.score <= Math.max(2, Math.floor(q.length / 3))).sort((a, b) => a.score - b.score || a.n.length - b.n.length).slice(0, max).map((x) => x.n);
}

const pathStr = (p) => p.reduce((s, k) => (typeof k === "number" ? `${s}[${k}]` : s ? `${s}.${k}` : String(k)), "");

/** JSON paths where `test(node, key, parentKey)` holds, in document order (at most `max`). */
function findIn(doc, test, max = 3) {
    const out = [];
    const walk = (x, p, parentKey) => {
        if (out.length >= max) return;
        if (Array.isArray(x)) { x.forEach((y, i) => walk(y, [...p, i], parentKey)); return; }
        if (typeof x === "string") { if (test(x, null, parentKey)) out.push(pathStr(p)); return; }
        if (!isObj(x)) return;
        for (const [k, v] of Object.entries(x)) {
            if (out.length >= max) return;
            if (test(v, k, parentKey)) out.push(pathStr([...p, k]));
            walk(v, [...p, k], k);
        }
    };
    walk(doc, [], null);
    return out;
}

const clip = (s, n = 220) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** "line 3 col 14" and the line with a caret, for a JSON.parse error at a position. */
function syntaxHint(message, text) {
    const at = Number(/position (\d+)/.exec(message)?.[1]);
    if (!Number.isFinite(at) || typeof text !== "string") return [];
    const before = text.slice(0, at);
    const line = before.split("\n").length, col = at - before.lastIndexOf("\n");
    const lineText = text.split("\n")[line - 1] ?? "";
    const from = Math.max(0, col - 60);
    const excerpt = lineText.slice(from, col + 40);
    const near = text.slice(Math.max(0, at - 3), at + 1);
    const cause = /,\s*[}\]]/.test(text.slice(Math.max(0, at - 20), at + 1)) ? "a trailing comma before } or ] (JSON allows none)"
        : /\/[/*]/.test(near) ? "a comment (JSON has none)"
        : /'/.test(near) ? "single quotes (JSON strings and keys take double quotes)"
        : /[A-Za-z_]/.test(text[at] ?? "") ? "a key without quotes, or a missing comma before it"
        : "a missing comma, quote or bracket just before this point";
    const head = `Where: line ${line}, column ${col}: `;
    return [head + excerpt, " ".repeat(head.length + (col - 1 - from)) + "^", `Likely: ${cause}.`];
}

/**
 * Hint lines for a failure message (json2rc's or the component compiler's), or [] when there
 * is nothing useful to add. source: the document as it was converted (object or JSON text).
 */
export function failureHints(message, source, original = null) {
    let doc = source;
    if (typeof source === "string") {
        try { doc = JSON.parse(source); } catch (e) { return syntaxHint(String(e.message), source); }
    }
    if (/SyntaxError/.test(message)) return [];
    if (!isObj(doc)) return [];
    const V = vocabulary();
    const lines = [];
    const suggest = (kind, name, label) => {
        const instead = INSTEAD[kind]?.[name.toLowerCase()];
        const names = nearest(name, [...V[kind].values()].map((e) => e.name));
        if (instead) lines.push(`Instead: ${instead}.`);
        if (names.length) {
            lines.push(`Did you mean: ${names.map((n) => JSON.stringify(n)).join(", ")}?`);
            const e = V[kind].get(names[0].toLowerCase());
            if (e) lines.push(`Example (${e.from}): ${clip(e.example)}`);
        } else if (!instead) lines.push(`No ${label} is called that. Look it up with reference {"query": "${name}"}.`);
        // A short list is worth giving whole.
        if (V[kind].size && V[kind].size <= 12) lines.push(`The ${label}s the examples use: ${[...V[kind].values()].map((e) => e.name).join(", ")}.`);
    };
    // Paths in the document as written; one only the component expansion has is said so.
    const orig = isObj(original) && original !== doc ? original : null;
    let label = "Where";
    const find = (d, test, max) => {
        const own = orig ? findIn(orig, test, max) : [];
        if (own.length || !orig) return orig ? own : findIn(d, test, max);
        label = "Where (inside a component, after expansion)";
        return findIn(d, test, max);
    };
    const where = (paths) => { paths = [...new Set(paths)]; if (paths.length) lines.push(`${label}: ${paths.join(", ")}`); };
    const eq = (a, b) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
    let m;
    if ((m = /modifier '([^']+)'/.exec(message))) {
        where(find(doc, (v, k, pk) => (k === null ? pk === "modifiers" && eq(v, m[1]) : eq(k, m[1]) && pk === "modifiers")));
        suggest("modifier", m[1], "modifier");
    } else if ((m = /component type '([^']+)'/.exec(message))) {
        where(find(doc, (v, k) => k !== null && eq(k, m[1]) && isObj(v)));
        suggest("component", m[1], "component");
    } else if ((m = /canvas command '([^']+)'/.exec(message))) {
        where(find(doc, (v, k, pk) => k !== null && eq(k, m[1]) && pk === "commands"));
        suggest("command", m[1], "canvas command");
    } else if ((m = /click action type '([^']+)'/.exec(message))) {
        where(find(doc, (v, k) => k === "type" && eq(v, m[1])));
        suggest("action", m[1], "action type");
    } else if ((m = /paint key '([^']+)'/.exec(message))) {
        where(find(doc, (v, k, pk) => k !== null && eq(k, m[1]) && pk === "ops"));
        suggest("paint", m[1], "paint op");
    } else if ((m = /^(?:.*: )?(\w+): missing (?:required field )?'([^']+)'/.exec(message))) {
        const [, type, field] = m;
        where(find(doc, (v, k) => k !== null && eq(k, type) && isObj(v) && !(field in v)));
        const e = V.command.get(type.toLowerCase()) ?? V.component.get(type.toLowerCase()) ?? V.modifier.get(type.toLowerCase());
        if (e) lines.push(`Example (${e.from}): ${clip(e.example)}`);
    } else if ((m = /theme colour '([^']+)' is not in the theme/.exec(message))) {
        where(find(doc, (v) => typeof v === "string" && new RegExp(`^[@$]colors\\.${m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(v)));
        let theme = [];
        try { theme = Object.keys(loadLibrary().theme?.colors ?? {}); } catch {}
        const own = Object.keys(doc.resources?.colors ?? {});
        const names = nearest(m[1], [...theme, ...own]);
        if (names.length) lines.push(`Did you mean: ${[...new Set(names)].map((n) => `"@colors.${n}"`).join(", ")}?`);
        lines.push(`Theme colours: ${theme.join(", ")}. Or declare your own in resources.colors.`);
    } else if ((m = /(Color|Path) not found: @?(?:colors\.|paths\.)?([\w.-]+)/.exec(message))) {
        const kind = m[1] === "Color" ? "colors" : "paths";
        where(find(doc, (v) => typeof v === "string" && v.replace(/^[@$](colors|paths)\./, "") === m[2] && /^[@$]/.test(v)));
        const names = nearest(m[2], Object.keys(doc.resources?.[kind] ?? {}));
        lines.push(names.length ? `Did you mean: ${names.map((n) => `"@${kind}.${n}"`).join(", ")}?` : `Declare it in resources.${kind} first.`);
    } else if ((m = /Unknown header tag: (\w+)/.exec(message))) {
        let keys = [];
        try { keys = Object.keys(createRequire(import.meta.url)(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "players", "typescript", "build-json2rc", "Header.js")).HEADER_KEY_TO_TAG ?? {}); } catch {}
        const names = nearest(m[1], keys);
        if (names.length) lines.push(`Did you mean: ${names.map((n) => JSON.stringify(n)).join(", ")}?`);
        lines.push(`The header takes: apiLevel, ${keys.join(", ")}. Other data goes in resources (a variable) or in the document's description.`);
    } else if (/Unknown token in expression|Unsupported integer function/.test(message)) {
        const tok = /: (@?[\w.]+)/.exec(message)?.[1];
        if (tok) where(find(doc, (v) => typeof v === "string" && v.includes(tok) && v !== tok.replace(/^@/, "")));
    }
    return lines;
}
