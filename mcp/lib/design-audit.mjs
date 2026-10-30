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
    const hits = items.map((s) => ({ ...s, kind: dateKind(s.value) })).filter((h) => h.kind);
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
export function designAudit(json) {
    const doc = typeof json === "string" ? JSON.parse(json) : json;
    if (!isObj(doc)) return [];
    const strings = collectStrings(doc);
    const findings = [
        ...glyphFindings(strings),
        ...repeatedFindings(doc),
        ...dateFindings(strings, readsClock(doc)),
        ...colorFindings(doc),
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
