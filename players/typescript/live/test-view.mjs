// test-view.mjs — does the source view actually understand the file?
//
//     node live/test-view.mjs
//
// The folding logic is the part that fails quietly: a bracket miscounted inside a string
// shifts every fold below it, and the result still looks like a plausible outline. So the
// cases here are the ones that would produce a *wrong but believable* view, not the ones
// that would throw.
//
// Each case is checked against a deliberately broken scanner as well as the real one. A
// naive bracket count passes most JSON, which is exactly why it has to be shown failing —
// a test that both implementations pass is measuring nothing.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { scan, foldKeys, highlight, cssColour } from './view.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;

function check(name, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
        failures++;
        console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
    } else {
        console.log(`  ok    ${name}`);
    }
    return ok;
}

/** What a bracket counter that does not know about strings would produce. */
function naiveScan(text) {
    const lines = text.replace(/\n$/, '').split('\n');
    const pairs = new Map();
    const stack = [];
    for (let i = 0; i < lines.length; i++) {
        for (const c of lines[i]) {
            if (c === '{' || c === '[') stack.push(i);
            else if (c === '}' || c === ']') {
                const open = stack.pop();
                if (open !== undefined && open < i) pairs.set(open, i);
            }
        }
    }
    return { lines, pairs };
}

// ── 1. brackets inside strings are not brackets ───────────────────────────────────────────

// An `a[0]` inside an expression is balanced on its own line, so a naive counter survives
// it. This case checks the real scanner handles it, but claims nothing about the control.
{
    const doc = [
        '{',
        '  "root": [',
        '    {"pathExpression": {"expressionX": "200 + sin(a[0] * 3)"}}',
        '  ]',
        '}',
    ].join('\n');
    const { pairs } = scan(doc);
    check('balanced brackets in a string: outer folds 0 -> 4', pairs.get(0), 4);
    check('balanced brackets in a string: array folds 1 -> 3', pairs.get(1), 3);
}

// The case that actually separates the two: a document that *draws* a bracket. One `]` in
// a text value, and a counter that does not know about strings closes the array early —
// every fold after it points at the wrong line, and the outline still looks plausible.
{
    const doc = [
        '{',
        '  "root": [',
        '    {"drawTextAnchored": {"text": "]"}},',
        '    {"drawCircle": {"cx": 10}}',
        '  ]',
        '}',
    ].join('\n');
    const { pairs } = scan(doc);
    check('bracket as text: outer folds 0 -> 5', pairs.get(0), 5);
    check('bracket as text: array folds 1 -> 4', pairs.get(1), 4);

    const naive = naiveScan(doc).pairs;
    if (naive.get(0) === 5 && naive.get(1) === 4) {
        failures++;
        console.log('  FAIL  control: the naive scanner agrees, so this case proves nothing');
    } else {
        console.log(`  ok    control: naive scanner gets it wrong (0->${naive.get(0)}, 1->${naive.get(1)})`);
    }
}

// ── 2. escaped quotes do not end a string ────────────────────────────────────────────────

{
    const doc = ['{', '  "text": "a \\" [ brace",', '  "n": 1', '}'].join('\n');
    const { pairs } = scan(doc);
    check('escaped quote: object still folds 0 -> 3', pairs.get(0), 3);
}

// ── 3. the outermost block on a line wins ────────────────────────────────────────────────

{
    const doc = ['[{', '  "a": 1', '}]'].join('\n');
    const { pairs } = scan(doc);
    // Both `[` and `{` open on line 0. Folding line 0 should hide through the `]`.
    check('outermost wins: 0 -> 2', pairs.get(0), 2);
}

// ── 4. single-line blocks are not foldable ───────────────────────────────────────────────

{
    const doc = ['{', '  "a": {"b": 1},', '  "c": 2', '}'].join('\n');
    const { pairs } = scan(doc);
    check('single-line block is not foldable', pairs.has(1), false);
}

// ── 5. fold keys survive an insertion above ──────────────────────────────────────────────

{
    const before = ['{', '  "a": [', '    1', '  ]', '}'];
    const after = ['{', '  "inserted": 0,', '  "a": [', '    1', '  ]', '}'];
    const kb = foldKeys(before);
    const ka = foldKeys(after);
    // The `"a": [` line moved from index 1 to index 2 and must keep the same key, or a
    // fold on it would jump to whatever line 1 became.
    check('fold key survives an insertion', kb[1], ka[2]);
    // Repeated identical lines must not collide onto one key.
    const dupes = foldKeys(['  {', '  {', '  {']);
    check('identical lines get distinct keys', new Set(dupes).size, 3);
}

// ── 6. highlighting tells expressions from text ──────────────────────────────────────────

{
    const has = (s, cls) => highlight(s).includes(`class="${cls}"`);
    check('expression string is marked', has('"@progress * 360.0"', 'e'), true);
    check('clock call is marked', has('"continuousSec()"', 'e'), true);
    check('plain text is not marked as expression', has('"living-room-hub"', 'e'), false);
    check('a key is a key, not a string', highlight('"width": 5').includes('class="k"'), true);
    // A hyphenated word is text, not arithmetic. This is the case the operator character
    // class gets wrong if it is written carelessly.
    check('hyphenated text is not an expression', has('"living-room-hub"', 's'), true);
}

// ── 7. colour swatches are not byte-swapped ──────────────────────────────────────────────

{
    check('#AARRGGBB -> #RRGGBBAA', cssColour('#FF54C7F5'), '#54C7F5FF');
    check('#RRGGBB passes through', cssColour('#54C7F5'), '#54C7F5');
    check('nonsense length gives nothing', cssColour('#54C7'), null);
}

// ── 8. the real document ─────────────────────────────────────────────────────────────────

{
    const text = readFileSync(join(HERE, 'demo.json'), 'utf8');
    const { lines, pairs, depth, balanced } = scan(text);
    check('demo.json: brackets balance', balanced, true);
    check('demo.json: depth starts at zero', depth[0], 0);
    check('demo.json: the whole file is one foldable block', pairs.get(0), lines.length - 1);
    // …and the balance check has to be able to say no, or it is decoration.
    check('a truncated file is not balanced', scan('{\n  "a": [\n').balanced, false);
    if (pairs.size < 5) {
        failures++;
        console.log(`  FAIL  demo.json: only ${pairs.size} foldable blocks, expected several`);
    } else {
        console.log(`  ok    demo.json: ${pairs.size} foldable blocks`);
    }
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
