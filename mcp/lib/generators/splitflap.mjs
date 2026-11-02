// {"$gen": {"kind": "split-flap", ...}}: split-flap tiles (SplitFlap). Each tile shows one
// slice of a drum string (one character, or a whole word for word flaps) and, when its code
// changes, flips forward through the drum to the new one, as a real flap unit does: the
// steps are (new - old) mod the drum size, at `speed` flaps a second, after a per-tile delay
// (a ripple along the tiles and down the rows plus a hashed jitter). Each flip is drawn as
// the next glyph's top half and the current glyph's bottom half behind a flap: the current
// top half folding down to the split, then the next bottom half opening, darkened edge-on.
//
// What the caller gives, per tile, as expressions of `i` (the tile, from 0) and `r` (the
// row, from 0): `code` (the drum index now shown) and `prev` (the one before, default the
// drum's first entry, so tiles flip in from blank), and `since` (seconds since the change,
// default animationTime()). Or a static `text`: its characters' drum indices become a float
// array here. Mono: outlined tiles with the final glyph, the split cut as a gap, no motion.

export const kind = "split-flap";
export const doc = "Split-flap tiles that flip forward through a drum of characters (or words) to a new code, rippling across tiles and rows";

export const DEFAULT_DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-.";

const isSet = (v) => v !== undefined && v !== null && v !== "";
const ex = (v, d) => (isSet(v) ? String(v) : String(d));
const num = (v, d) => (isSet(v) ? Number(v) : d);

/** Drum indices of a text, one per character (an unknown character is an error). */
export function codesOf(text, drum = DEFAULT_DRUM, glyphWidth = 1) {
    const out = [];
    const chars = [...String(text)];
    if (glyphWidth === 1) {
        for (const ch of chars) {
            const k = drum.indexOf(ch.toUpperCase());
            if (k < 0) throw new Error(`text: '${ch}' is not on the drum ${JSON.stringify(drum)}`);
            out.push(k);
        }
        return out;
    }
    throw new Error("text works with one-character glyphs; for word flaps pass code");
}

export function generate(spec, ctx) {
    const p = ctx.unique("sf");
    const V = (n) => `@${p}${n}`;
    const E = (s) => s.replace(/\$(\w+)/g, (_, n) => V(n));
    const drum = isSet(spec.drum) ? String(spec.drum) : DEFAULT_DRUM;
    const gw = Math.max(1, Math.round(num(spec.glyphWidth, 1)));
    const nGlyphs = Math.floor(drum.length / gw);
    if (nGlyphs < 2) throw new Error("drum: needs at least two glyphs");
    let code = spec.code, tiles = spec.tiles;
    if (!isSet(code)) {
        if (!isSet(spec.text)) throw new Error("give text, or code and tiles");
        const codes = codesOf(spec.text, drum, gw);
        code = `arrayGet(${ctx.floatArray(`${p}_text`, codes)}, i)`;
        if (!isSet(tiles)) tiles = codes.length;
    }
    if (!isSet(tiles)) throw new Error("tiles: required with code");
    const rows = ex(spec.rows, 1);
    const tw = ex(spec.tileWidth, 28), th = ex(spec.tileHeight, 40);
    const gap = ex(spec.gap, 4), rowGap = ex(spec.rowGap, 8);
    const tileX = ex(spec.tileX, `i * (${tw} + ${gap})`);
    const tileY = ex(spec.tileY, 0);
    const pitch = ex(spec.rowPitch, `${th} + ${rowGap}`);
    const ox = ex(spec.x, 0), oy = ex(spec.y, 0);
    const speed = num(spec.speed, 22);
    const delay = `${ex(spec.delay, 0.25)} + r * ${ex(spec.rowRipple, 0.16)} + i * ${ex(spec.ripple, 0.035)}` +
        (num(spec.jitter, 0.25) ? ` + fract(sin(r * 12.9 + i * 78.2) * 437.5) * ${num(spec.jitter, 0.25)}` : "");
    const size = ex(spec.textSize, 0.62);
    const start = spec.align === "start";
    const inset = ex(spec.inset, 0.3);
    const bold = spec.bold !== false;
    const tile = ex(spec.tileColor, "@colors.surface"), flapC = ex(spec.flapColor, "@colors.surfaceHigh");
    const ink = ex(spec.color, "@colors.onSurface"), split = ex(spec.splitColor, "@colors.background");
    const radius = ex(spec.radius, `min(${tw}, ${th}) * 0.1`);
    const mono = ctx.mono;

    const sub = (idx, name) => ({ textSubtext: { text: drum, start: gw === 1 ? E(idx) : E(`(${idx}) * ${gw}`), len: gw, varName: p + name } });
    const tx = start ? E(`$x0 + ${th} * ${inset}`) : E("($x0 + $x1) / 2");
    const txt = (g) => ({ drawTextAnchored: { text: `@${p}${g}`, x: tx, y: E("$md"), panX: start ? -1 : 0, panY: 0 } });
    const box = { drawRoundRect: { left: E("$x0"), top: E("$y0"), right: E("$x1"), bottom: E("$y1"), rx: String(radius), ry: String(radius) } };
    const paintInk = { paint: { color: ink, style: bold ? "fillAndStroke" : "fill", ...(bold ? { strokeWidth: `${th} * 0.025` } : {}), textSize: `${th} * ${size}`, alpha: 1 } };
    const v = (n, value) => ({ variable: { name: p + n, value: E(value) } });

    const cell = [
        v("x0", `${ox} + ${tileX}`), v("x1", `$x0 + ${tw}`),
        v("y0", `${oy} + r * ${pitch} + ${tileY}`), v("y1", `$y0 + ${th}`), v("md", `$y0 + ${th} / 2`),
    ];
    if (mono) {
        cell.push(v("cur", `${code}`), sub("$cur", "gC"),
            { paint: { color: "@colors.outline", style: "stroke", strokeWidth: 1, alpha: 1 } }, box,
            { paint: { color: "@colors.onSurface", style: bold ? "fillAndStroke" : "fill", ...(bold ? { strokeWidth: `${th} * 0.025` } : {}), textSize: `${th} * ${size}`, alpha: 1 } }, txt("gC"),
            { paint: { color: "@colors.background", style: "fill" } },
            { drawRect: { left: E("$x0 - 1"), top: E(`$md - ${th} * 0.02`), right: E("$x1 + 1"), bottom: E(`$md + ${th} * 0.02`) } });
    } else {
        const since = ex(spec.since, "animationTime()");
        cell.push(
            v("o", ex(spec.prev, 0)), v("nw", code),
            v("n", `($nw - $o + ${nGlyphs}) % ${nGlyphs}`),
            v("f", `clamp((${since} - (${delay})) * ${speed}, $n, 0)`),
            v("cur", `($o + floor($f)) % ${nGlyphs}`),
            v("nx", `($cur + 1 - step($f, $n)) % ${nGlyphs}`),
            v("s", "$f - floor($f)"),
            v("lo", "step(0.5, $s)"),
            sub("$nx", "gN"), sub("$cur", "gC"), sub("ifElse($nx, $cur, $lo)", "gF"),
            { paint: { color: tile, style: "fill", alpha: 1 } }, box, paintInk,
            { save: { commands: [{ clipRect: { left: E("$x0"), top: E("$y0"), right: E("$x1"), bottom: E("$md") } }, txt("gN")] } },
            { save: { commands: [{ clipRect: { left: E("$x0"), top: E("$md"), right: E("$x1"), bottom: E("$y1") } }, txt("gC")] } },
            { save: { commands: [
                { clipRect: { left: E("$x0"), top: E("ifElse($md, $y0, $lo)"), right: E("$x1"), bottom: E("ifElse($y1, $md, $lo)") } },
                { scale: { sx: 1, sy: E("max(0.001, abs(1 - 2 * $s))"), pivotX: E("$x0"), pivotY: E("$md") } },
                { paint: { color: flapC, style: "fill" } }, box, paintInk, txt("gF"),
                { paint: { color: ex(spec.shadeColor, "#FF000000"), style: "fill", alpha: E("(1 - abs(1 - 2 * $s)) * 0.6") } },
                { drawRect: { left: E("$x0"), top: E("$y0"), right: E("$x1"), bottom: E("$y1") } },
            ] } },
            { paint: { color: split, style: "fill", alpha: 1 } },
            { drawRect: { left: E("$x0"), top: E(`$md - ${th} * 0.02`), right: E("$x1"), bottom: E(`$md + ${th} * 0.02`) } });
    }
    const commands = [{ loop: { index: "r", from: 0, until: rows, commands: [
        { loop: { index: "i", from: 0, until: String(tiles), commands: cell } }] } }];
    const modifiers = [];
    if (spec.fill === true) modifiers.push("fillMaxSize");
    else {
        const nums = (...xs) => xs.every((x) => Number.isFinite(Number(x)));
        if (!isSet(spec.tileX) && !nums(tiles, tw, gap) && !isSet(spec.width)) throw new Error("width: give it (or fill) when tiles or sizes are expressions");
        if (!isSet(spec.rowPitch) && !nums(rows, th, rowGap) && !isSet(spec.height)) throw new Error("height: give it (or fill) when rows or sizes are expressions");
        const w = isSet(spec.width) ? Number(spec.width) : Number(tiles) * (Number(tw) + Number(gap)) - Number(gap);
        const h = isSet(spec.height) ? Number(spec.height) : Number(rows) * (Number(th) + Number(rowGap)) - Number(rowGap);
        modifiers.push({ size: [w, h] });
    }
    if (isSet(spec.label) || isSet(spec.text)) modifiers.push({ semantics: { contentDescription: String(isSet(spec.label) ? spec.label : spec.text) } });
    return { canvas: { modifiers, commands } };
}
