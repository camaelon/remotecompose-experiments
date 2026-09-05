// view.mjs — turning JSON text into a foldable, highlighted view.
//
// Separate from index.html so it can be tested outside a browser: `node live/test-view.mjs`.
// Nothing here touches the DOM; it is all text in, text out.

export const esc = (s) =>
    s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * Find every bracket pair that spans more than one line, so those lines can fold.
 *
 * Brackets inside strings are not brackets. `"drawRect"` is harmless, but an expression
 * like `"a[0] * 2"` would open a block that never closes and throw every fold below it out
 * of alignment — so this walks characters with a string/escape state rather than counting
 * brackets. JSON strings cannot span lines, but the state is carried per line anyway
 * because that costs nothing and a lone `"` in a malformed file would otherwise poison
 * every line after it.
 *
 * @returns {{lines: string[], pairs: Map<number, number>, depth: number[], balanced: boolean}}
 *   `pairs` maps an opening line to its closing line, keeping the *outermost* block that
 *   opens on that line: for `[{` you want the fold to run to the `]`, not the `}`.
 *   `depth` is measured at the *start* of each line, so a file's final `}` has depth 1.
 *   `balanced` is whether every bracket closed — false means the view is showing a file
 *   that will not parse, which is worth knowing separately from the converter's opinion.
 */
export function scan(text) {
    const lines = text.replace(/\n$/, '').split('\n');
    const pairs = new Map();
    const depth = new Array(lines.length).fill(0);
    const stack = [];
    let d = 0;
    for (let i = 0; i < lines.length; i++) {
        depth[i] = d;
        const line = lines[i];
        let inStr = false;
        let escaped = false;
        for (let j = 0; j < line.length; j++) {
            const c = line[j];
            if (inStr) {
                if (escaped) escaped = false;
                else if (c === '\\') escaped = true;
                else if (c === '"') inStr = false;
                continue;
            }
            if (c === '"') { inStr = true; continue; }
            if (c === '{' || c === '[') { stack.push(i); d++; }
            else if (c === '}' || c === ']') {
                const open = stack.pop();
                d--;
                if (open !== undefined && open < i) pairs.set(open, i);
            }
        }
    }
    return { lines, pairs, depth, balanced: stack.length === 0 };
}

/**
 * A fold key that survives the file changing under it.
 *
 * Line numbers do not: inserting one line above a folded block moves every fold down by one
 * and silently collapses the wrong things. Trimmed text plus how many identical lines came
 * before it is stable across every edit that does not touch the block itself.
 */
export function foldKeys(lines) {
    const seen = new Map();
    return lines.map((line) => {
        const t = line.trim();
        const n = (seen.get(t) ?? 0) + 1;
        seen.set(t, n);
        return `${t}#${n}`;
    });
}

// #AARRGGBB is the corpus spelling and CSS wants #RRGGBBAA. Getting this backwards silently
// paints every swatch with the alpha byte as its red channel — a wrong colour that still
// looks like a colour, which is the kind of bug nobody notices.
export function cssColour(body) {
    const h = body.slice(1);
    if (h.length === 8) return '#' + h.slice(2) + h.slice(0, 2);
    if (h.length === 6) return '#' + h;
    return null;
}

// A string holding arithmetic, a clock call or an `@name` is not text the document will
// draw — it is an expression the engine evaluates every frame. Colouring those apart from
// ordinary strings is the single most useful thing highlighting can do for this format.
//
// The hyphen is the whole difficulty. Treating `-` as arithmetic wherever it appears makes
// `"living-room-hub"` an expression, and hyphenated words are everywhere in labels and
// content descriptions. So a hyphen counts only with space on both sides, the way an
// expression is actually written; the other operators do not need that hedge because no
// English word contains one.
const EXPR = new RegExp(
    [
        '@[A-Za-z_]',                                  // a variable reference
        '\\b(?:continuousSec|animationTime|sin|cos|tan|clamp|smooth_step|ping_pong|rand'
            + '|abs|sqrt|min|max|step|mod|floor|ceil|pow|log|exp)\\s*\\(',
        '[+*/%]',                                      // unambiguous arithmetic
        '\\s-\\s',                                     // subtraction, spaced
    ].join('|'),
);

export function highlight(text) {
    return esc(text).replace(
        /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}\[\],:])/g,
        (m, str, colon, num, lit, punc) => {
            if (str !== undefined) {
                if (colon) return `<span class="k">${str}</span><span class="p">${colon}</span>`;
                const body = str.slice(1, -1);
                if (/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(body)) {
                    // A colour you can see beats one you have to decode, and changing a
                    // colour is the most likely live edit there is.
                    return `<span class="s"><span class="sw" style="background:${cssColour(body)}"></span>${str}</span>`;
                }
                return `<span class="${EXPR.test(body) ? 'e' : 's'}">${str}</span>`;
            }
            if (num !== undefined) return `<span class="n">${num}</span>`;
            if (lit !== undefined) return `<span class="b">${lit}</span>`;
            return `<span class="p">${punc}</span>`;
        },
    );
}
