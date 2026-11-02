// {"$gen": {"kind": "dashboard-grid", "cards": [...]}}: a responsive grid of cards, packed on
// the server for every column count it can have (1 .. maxColumns) and switched at run time by
// the width. The caller gives cards in reading order, each a title and content with an
// optional span (columns it wants), height (dp of its content) and priority (the column count
// from which it shows). For each column count this file packs the visible cards into rows in
// order (a card that does not fit the rest of a row starts the next one, and the cards of the
// row it leaves widen in proportion to their spans, so a row never has a hole), gives every card of a
// row the row's height (the tallest content), and writes one flow:
//
//   box (the size it is given, default the window, background)
//     tree variables: columns, column width, grow factor, and per card its span and height
//     column (verticalScroll, padding)
//       header (title, subtitle, headerEnd)
//       flow: one box per card of exact width and height (and a visibility for priorities)
//
// Rows grow, up to `grow` times, to fill a window taller than the content; past that the
// column scrolls. Inside a card's content "@cardWidth" and "@cardHeight" are the content box's
// size in dp (for a RowList or anything that needs its width and height given).

export const kind = "dashboard-grid";
export const doc = "A responsive grid of cards: columns follow the width, spans and row heights are packed per column count on the server, no holes, rows share a height";

const fmt = (n) => { const r = Math.round(n * 1000) / 1000; return String(Object.is(r, -0) ? 0 : r); };
const num = (v, d) => (v === undefined || v === null || v === "" ? d : Number(v));

/** Packs cards for c columns: [{units, row}] per card (null when hidden) and the row heights. */
export function pack(cards, c) {
    const out = cards.map(() => null);
    const rows = [];
    let row = null;
    const close = () => {
        if (!row) return;
        const free = c - row.used;
        // A short row shares the free columns in proportion to the spans, so its cards stay
        // in the same ratio and the row reaches the edge (no hole).
        if (free > 0) for (const i of row.items) out[i].units = out[i].units * c / row.used;
        rows.push(row);
        row = null;
    };
    cards.forEach((cd, i) => {
        if (cd.priority > c) return;
        const s = Math.max(1, Math.min(c, cd.span));
        if (row && row.used + s > c) close();
        if (!row) row = { used: 0, items: [], h: 0 };
        out[i] = { units: s, row: rows.length };
        row.items.push(i);
        row.used += s;
        row.h = Math.max(row.h, cd.h);
    });
    close();
    for (const o of out) if (o) o.h = rows[o.row].h;
    return { cards: out, rows: rows.map((r) => r.h) };
}

/** A value chosen by the column count: v[0] at 1 column, v[1] at 2, ... */
function select(vals, colsVar) {
    let e = fmt(vals[0]);
    let any = false;
    for (let k = 1; k < vals.length; k++) {
        const d = vals[k] - vals[k - 1];
        if (Math.abs(d) < 1e-9) continue;
        any = true;
        e += ` + ${fmt(d)} * step(${colsVar}, ${fmt(k + 0.5)})`;
    }
    return any ? e : fmt(vals[0]);
}

function replaceTokens(node, w, h) {
    if (typeof node === "string") return node.replace(/@cardWidth\b/g, `(${w})`).replace(/@cardHeight\b/g, `(${h})`);
    if (Array.isArray(node)) return node.map((x) => replaceTokens(x, w, h));
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, replaceTokens(v, w, h)]));
    return node;
}

export function generate(spec, ctx) {
    const list = spec.cards;
    if (!Array.isArray(list) || !list.length) throw new Error("cards: give at least one card");
    const maxCols = Math.max(1, Math.min(6, Math.round(num(spec.maxColumns, 4))));
    const minW = num(spec.minColumnWidth, 240);
    const gap = num(spec.gap, 12);
    const pad = num(spec.padding, 16);
    const grow = Math.max(1, num(spec.grow, 1.3));
    const cardPad = 14;
    const W = String(spec.width ?? "windowWidth()");
    const H = String(spec.height ?? "windowHeight()");
    const mono = ctx.mono;

    const cards = list.map((cd, i) => {
        if (!cd || typeof cd !== "object") throw new Error(`cards[${i}]: an object {title, content, span, height, priority}`);
        if (cd.content === undefined) throw new Error(`cards[${i}]: content is required (a node or a list of nodes)`);
        const hasTitle = Boolean(cd.title) || Boolean(cd.note);
        const titleH = hasTitle ? 26 : 0;
        const contentH = num(cd.height, 120);
        const span = Math.round(num(cd.span, 1));
        const priority = Math.round(num(cd.priority, 1));
        if (!(span >= 1)) throw new Error(`cards[${i}]: span is 1 or more`);
        if (!(priority >= 1)) throw new Error(`cards[${i}]: priority is 1 or more (the column count from which the card shows)`);
        return { ...cd, span, priority, titleH, h: contentH + titleH + 2 * cardPad };
    });
    if (!cards.some((c) => c.priority <= 1)) throw new Error("at least one card needs priority 1, or a phone shows nothing");

    const packs = [];
    for (let c = 1; c <= maxCols; c++) packs.push(pack(cards, c));

    const p = ctx.unique("dash");
    const vars = [];
    const decl = (name, value) => { vars.push({ variable: { name: p + name, value: typeof value === "number" ? fmt(value) : value } }); return `@${p}${name}`; };

    // Header
    const hasHeader = Boolean(spec.title || spec.subtitle || (Array.isArray(spec.headerEnd) ? spec.headerEnd.length : spec.headerEnd));
    const headerH = hasHeader ? (spec.title ? 30 : 0) + (spec.subtitle ? 20 : 0) + 12 : 0;

    const cols = decl("c", `clamp(1, ${maxCols}, floor((${W} - ${fmt(2 * pad - gap)}) / ${fmt(minW + gap)}))`);
    const colW = decl("u", `floor((${W} - ${fmt(2 * pad)} - (${cols} - 1) * ${fmt(gap)} - 1) / ${cols})`);
    // Grow: rows scale to fill a taller window, up to `grow` times.
    let f = null;
    if (grow > 1) {
        const per = packs.map((pk) => {
            const S = pk.rows.reduce((a, b) => a + b, 0);
            const fixed = 2 * pad + headerH + pk.rows.length * gap + 2;
            return { S, fixed };
        });
        const fixedSel = select(per.map((x) => x.fixed), cols), sSel = select(per.map((x) => x.S), cols);
        const room = decl("r", `${H} - (${fixedSel})`);
        const tot = /^[\d.]+$/.test(sSel) ? sSel : decl("s", sSel);
        f = decl("f", `clamp(1, ${fmt(grow)}, ${room} / ${tot})`);
    }

    const cells = cards.map((cd, i) => {
        const units = packs.map((pk) => pk.cards[i]?.units ?? 1);
        const heights = packs.map((pk) => pk.cards[i]?.h ?? cd.h);
        const uSel = select(units, cols);
        const width = uSel === "1" ? colW : (() => { const k = decl(`k${i}`, uSel); return `${k} * (${colW} + ${fmt(gap)}) - ${fmt(gap)}`; })();
        const hSel = select(heights, cols);
        const hVar = decl(`h${i}`, f ? (/^[\d.]+$/.test(hSel) ? `${hSel} * ${f}` : `(${hSel}) * ${f}`) : hSel);
        const contentW = `${width} - ${2 * cardPad}`;
        const contentH = `${hVar} - ${fmt(cd.titleH + 2 * cardPad)}`;
        const content = replaceTokens(Array.isArray(cd.content) ? cd.content : [cd.content], contentW, contentH);

        const mods = [];
        if (cd.priority > 1) mods.push({ visibility: decl(`v${i}`, `step(${cols}, ${fmt(cd.priority - 0.5)})`) });
        mods.push({ width }, { height: `${hVar} + ${fmt(gap)}` }, { padding: { bottom: gap } }, { clip: { roundedRect: 16 } });
        if (mono) mods.push({ background: "@colors.outline" }, { padding: 1 }, { clip: { roundedRect: 15 } }, { background: "@colors.background" }, { padding: cardPad - 1 });
        else mods.push({ background: "@colors.surface" }, { padding: cardPad });
        if (cd.label) mods.push({ semantics: { contentDescription: cd.label } });

        const children = [];
        if (cd.titleH) {
            const row = [];
            if (cd.title) row.push({ text: { value: String(cd.title), fontSize: 14, fontWeight: 600, color: "@colors.onSurface", maxLines: 1, overflow: "ellipsis", modifiers: [{ weight: 1 }] } });
            if (cd.note) row.push({ text: { value: String(cd.note), fontSize: 12, color: "@colors.muted", maxLines: 1 } });
            children.push({ row: { modifiers: ["fillMaxWidth", { height: cd.titleH }], verticalAlignment: "top", children: row } });
        }
        const align = cd.align === "center" ? "center" : cd.align === "bottom" ? "bottom" : "top";
        children.push({ box: { modifiers: ["fillMaxWidth", { height: contentH }], verticalAlignment: align, children: content } });
        return { column: { modifiers: mods, children } };
    });

    const colChildren = [];
    if (hasHeader) {
        const texts = [];
        if (spec.title) texts.push({ text: { value: String(spec.title), fontSize: 20, fontWeight: 600, color: "@colors.onSurface", maxLines: 1, overflow: "ellipsis" } });
        if (spec.subtitle) texts.push({ text: { value: String(spec.subtitle), fontSize: 13, color: "@colors.muted", maxLines: 1, overflow: "ellipsis" } });
        const end = spec.headerEnd ? (Array.isArray(spec.headerEnd) ? spec.headerEnd : [spec.headerEnd]) : [];
        colChildren.push({ row: { modifiers: ["fillMaxWidth", { height: headerH - 12 }], verticalAlignment: "center", children: [
            { column: { modifiers: [{ weight: 1 }, { spacedBy: 2 }], children: texts } },
            ...end,
        ] } });
        colChildren.push({ box: { modifiers: [{ height: 12 }] } });
    }
    colChildren.push({ flow: { modifiers: ["fillMaxWidth"], horizontalArrangement: "spaceBetween", children: cells } });

    const scroll = spec.scroll ? [{ verticalScroll: spec.scroll }] : [];
    const outerSize = spec.width !== undefined || spec.height !== undefined
        ? [{ width: W }, { height: H }]
        : ["fillMaxSize"];
    const bg = spec.background === false ? [] : [{ background: spec.background ?? "@colors.background" }];
    return { box: { modifiers: [...outerSize, ...bg], children: [
        ...vars,
        { column: { modifiers: ["fillMaxSize", ...scroll, { padding: pad }], children: colChildren } },
    ] } };
}
