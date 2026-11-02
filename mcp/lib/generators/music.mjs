// {"$gen": {"kind": "music", "view": "piano", "chord": "Dm"}}
// {"$gen": {"kind": "music", "view": "fretboard", "chord": "Dm"}}  or "frets": "xx0231"
//
// Music in notation, drawn. The server does the theory: it spells a chord name ("Cmaj7",
// "F#m7b5", "Bb/D") into notes with the right letters (B♭, not A♯), voices it on a piano or finds a
// playable guitar shape, reads a note list ("D4 F4 A4") or a fingering ("xx0231"), names the chord a
// set of notes makes, and works out fingers and barres. The output is one canvas whose geometry is
// all literals in a unit box, scaled to the canvas at run time: a piano is scaled per axis (keys are
// fills, so nothing distorts), a fretboard uniformly (it keeps its proportions), so neither needs an
// expression per key, string or dot. Labels are drawn outside the piano's scale, at positions
// derived from the key width.

export const kind = "music";
export const doc = "Piano keys and guitar chord diagrams from chord names, note lists or fingerings; chord spelling and voicing server-side";

// ---------------------------------------------------------------------------------------------
// Theory

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC_TEXT = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };

/** "F#4", "Bb", "E♭3", "Cx" -> {letter, acc, octave|null, pc, midi|null}. */
export function parseNote(s, defOctave = null) {
    const m = /^\s*([A-Ga-g])(##|bb|x|#|b|♯|♭|𝄪|𝄫)?(-?\d+)?\s*$/.exec(String(s));
    if (!m) throw new Error(`'${s}' is not a note (write C, F#, Bb, Eb4, C#5)`);
    const letter = m[1].toUpperCase();
    const acc = { "##": 2, x: 2, "𝄪": 2, "#": 1, "♯": 1, b: -1, "♭": -1, bb: -2, "𝄫": -2 }[m[2] ?? ""] ?? 0;
    const octave = m[3] !== undefined ? Number(m[3]) : defOctave;
    const pc = (LETTER_PC[letter] + acc + 12) % 12;
    // B#3 is C4 in pitch; Cb4 is B3: the octave number belongs to the letter
    const midi = octave === null ? null : 12 * (octave + 1) + LETTER_PC[letter] + acc;
    return { letter, acc, octave, pc, midi };
}

export const noteName = (n, withOctave = false) => `${n.letter}${ACC_TEXT[n.acc]}${withOctave && n.octave !== null ? n.octave : ""}`;
/** ASCII spelling for tests and descriptions: "Bb", "F#". */
export const asciiName = (n) => `${n.letter}${{ "-2": "bb", "-1": "b", 0: "", 1: "#", 2: "##" }[n.acc]}`;

// Interval: degree (1..13) and semitones above the root.
const IV = (deg, semi) => ({ deg, semi });
const P1 = IV(1, 0), m2 = IV(2, 1), M2 = IV(2, 2), m3 = IV(3, 3), M3 = IV(3, 4), P4 = IV(4, 5), d5 = IV(5, 6), P5 = IV(5, 7), A5 = IV(5, 8),
    m6 = IV(6, 8), M6 = IV(6, 9), d7 = IV(7, 9), m7 = IV(7, 10), M7 = IV(7, 11), m9 = IV(9, 13), M9 = IV(9, 14), A9 = IV(9, 15),
    P11 = IV(11, 17), A11 = IV(11, 18), m13 = IV(13, 20), M13 = IV(13, 21);
void m2; void m6;

/** Chord qualities: suffix spellings -> [name, intervals]. Longest suffix wins. */
const QUALITIES = [
    [["", "maj", "M", "major"], "major", [P1, M3, P5]],
    [["m", "min", "-", "minor"], "minor", [P1, m3, P5]],
    [["dim", "°", "o"], "diminished", [P1, m3, d5]],
    [["aug", "+"], "augmented", [P1, M3, A5]],
    [["sus2"], "suspended 2nd", [P1, M2, P5]],
    [["sus4", "sus"], "suspended 4th", [P1, P4, P5]],
    [["5"], "power chord", [P1, P5]],
    [["6", "maj6", "M6"], "major 6th", [P1, M3, P5, M6]],
    [["m6", "min6", "-6"], "minor 6th", [P1, m3, P5, M6]],
    [["7", "dom7"], "dominant 7th", [P1, M3, P5, m7]],
    [["maj7", "M7", "Δ7", "Δ", "ma7"], "major 7th", [P1, M3, P5, M7]],
    [["m7", "min7", "-7"], "minor 7th", [P1, m3, P5, m7]],
    [["m7b5", "ø", "ø7", "min7b5", "-7b5", "m7♭5"], "half-diminished 7th", [P1, m3, d5, m7]],
    [["dim7", "°7", "o7"], "diminished 7th", [P1, m3, d5, d7]],
    [["mMaj7", "m(maj7)", "mM7", "minmaj7", "-maj7"], "minor-major 7th", [P1, m3, P5, M7]],
    [["aug7", "+7", "7#5", "7♯5"], "augmented 7th", [P1, M3, A5, m7]],
    [["7b5", "7♭5"], "dominant 7th flat 5", [P1, M3, d5, m7]],
    [["7sus4", "7sus"], "7th suspended 4th", [P1, P4, P5, m7]],
    [["add9", "add2"], "added 9th", [P1, M3, P5, M9]],
    [["madd9", "m(add9)"], "minor added 9th", [P1, m3, P5, M9]],
    [["6/9", "69"], "6/9", [P1, M3, P5, M6, M9]],
    [["9"], "dominant 9th", [P1, M3, P5, m7, M9]],
    [["maj9", "M9"], "major 9th", [P1, M3, P5, M7, M9]],
    [["m9", "min9", "-9"], "minor 9th", [P1, m3, P5, m7, M9]],
    [["7b9", "7♭9"], "dominant 7th flat 9", [P1, M3, P5, m7, m9]],
    [["7#9", "7♯9"], "dominant 7th sharp 9", [P1, M3, P5, m7, A9]],
    [["11"], "dominant 11th", [P1, P5, m7, M9, P11]],
    [["m11"], "minor 11th", [P1, m3, P5, m7, M9, P11]],
    [["maj7#11", "M7#11"], "major 7th sharp 11", [P1, M3, P5, M7, A11]],
    [["13"], "dominant 13th", [P1, M3, P5, m7, M9, M13]],
    [["7b13"], "dominant 7th flat 13", [P1, M3, P5, m7, m13]],
];
const SUFFIX = new Map();
for (const [names, name, ivs] of QUALITIES) for (const n of names) SUFFIX.set(n, { name, ivs, suffix: names[0] });

/** A note `iv` above `root` with the right letter: D + m3 = F, Bb + M3 = D, F# + M7 = E#. */
export function spell(root, iv, octave = root.octave) {
    const li = (LETTERS.indexOf(root.letter) + iv.deg - 1);
    const letter = LETTERS[li % 7];
    const natural = LETTER_PC[letter] + 12 * Math.floor(li / 7);       // semitones of the plain letter above root's letter (C-based)
    const target = LETTER_PC[root.letter] + root.acc + iv.semi;
    const acc = target - natural;
    if (Math.abs(acc) > 2) throw new Error(`can't spell ${iv.semi} semitones above ${asciiName(root)}`);
    const oct = octave === null ? null : octave + Math.floor(li / 7);
    return { letter, acc, octave: oct, pc: ((target % 12) + 12) % 12, midi: oct === null ? null : 12 * (oct + 1) + LETTER_PC[letter] + acc, iv };
}

/**
 * "Dm", "Cmaj7", "F#m7b5", "Bb/D", "G7/B" -> {root, quality, name, notes (spelled, root first,
 * no octave), bass (a note or null), symbol}.
 */
export function parseChord(sym) {
    const s = String(sym).trim().replace(/♯/g, "#").replace(/♭/g, "b");
    const m = /^([A-G])(#|b)?(.*?)(?:\/([A-G](?:#|b)?))?$/.exec(s);
    if (!m) throw new Error(`'${sym}' is not a chord name (write C, Dm, F#m7, Bbmaj7, G/B)`);
    const root = parseNote(m[1] + (m[2] ?? ""));
    let q = (m[3] ?? "").replace(/^\((.*)\)$/, "$1");
    if (!SUFFIX.has(q)) {
        const lower = [...SUFFIX.keys()].find((k) => k.toLowerCase() === q.toLowerCase() && !["m", "M", "M7", "m7", "M9", "m9", "M6", "m6", "mM7"].includes(k));
        if (lower === undefined) throw new Error(`'${sym}': unknown chord quality '${q}' (known: ${[...new Set(QUALITIES.map((x) => x[0][0] || "(major)"))].join(", ")})`);
        q = lower;
    }
    const qual = SUFFIX.get(q);
    const notes = qual.ivs.map((iv) => spell(root, iv, null));
    const bass = m[4] ? parseNote(m[4]) : null;
    const rootName = asciiName(root);
    return { root, quality: qual.name, notes, bass, symbol: `${noteName(root)}${qual.suffix}${bass ? `/${noteName(bass)}` : ""}`,
        name: `${noteName(root)} ${qual.name}${bass ? ` over ${noteName(bass)}` : ""}`, ascii: `${rootName}${qual.suffix}${bass ? `/${asciiName(bass)}` : ""}` };
}

/** Interval label of a pitch above the root: R, ♭3, 3, 5, ♭7, 9 ... from its spelled degree. */
export function intervalLabel(n) {
    const iv = n.iv;
    if (!iv) return "";
    if (iv.deg === 1) return "R";
    const majorish = { 2: 2, 3: 4, 6: 9, 7: 11, 9: 14, 13: 21 }, perfect = { 4: 5, 5: 7, 11: 17 };
    const ref = majorish[iv.deg] ?? perfect[iv.deg];
    const diff = iv.semi - ref;
    if (iv.deg === 7 && iv.semi === 9) return "𝄫7";
    return `${diff < 0 ? "♭".repeat(-diff) : "♯".repeat(diff)}${iv.deg}`;
}

/** Names the chord a set of pitch classes makes (bass first preferred): "Dm", "C/E", or null. */
export function identify(notes) {
    const pcs = [...new Set(notes.map((n) => n.pc))];
    const bass = notes.slice().sort((p, q) => (p.midi ?? 0) - (q.midi ?? 0))[0];
    const cands = [];
    for (const r of notes) for (const [names, , ivs] of QUALITIES) {
        const set = new Set(ivs.map((iv) => (r.pc + iv.semi) % 12));
        if (set.size !== pcs.length || !pcs.every((p) => set.has(p))) continue;
        cands.push({ root: r, suffix: names[0], ivs, score: (r.pc === bass.pc ? 0 : 10) + ivs.length });
    }
    cands.sort((p, q) => p.score - q.score);
    const c = cands[0];
    if (!c) return null;
    const root = { letter: c.root.letter, acc: c.root.acc, octave: null };
    return parseChord(`${asciiName(root)}${c.suffix}${c.root.pc === bass.pc ? "" : `/${asciiName(bass)}`}`);
}

/** Piano voicing of a chord: close position from the root at `octave`, slash bass an octave below. */
export function voicePiano(chord, octave = 4, inversion = 0) {
    const root = { ...chord.root, octave };
    let notes = chord.notes.map((n) => spell(root, n.iv, octave));
    for (let i = 0; i < inversion % notes.length; i++) {
        const n = notes.shift();
        notes.push({ ...n, octave: n.octave + 1, midi: n.midi + 12 });
    }
    if (chord.bass) {
        const pcSet = chord.notes.find((n) => n.pc === chord.bass.pc);
        let b = parseNote(asciiName(chord.bass), octave);
        while (b.midi >= notes[0].midi) b = parseNote(asciiName(chord.bass), b.octave - 1);
        b.iv = pcSet?.iv ?? null;
        notes = [b, ...notes];
    }
    return notes;
}

// ---- guitar

export const STANDARD = ["E2", "A2", "D3", "G3", "B3", "E4"];

/** "xx0231", "x 3 2 0 1 0", "8-10-10-9-8-8", "x,x,0,2,3,1" -> [null | fret] low string first. */
export function parseFrets(s, strings = 6) {
    let parts;
    const t = String(s).trim();
    if (/[\s,\-]/.test(t)) parts = t.split(/[\s,\-]+/).filter(Boolean);
    else parts = [...t];
    if (parts.length !== strings) throw new Error(`fingering '${s}' has ${parts.length} strings, the tuning has ${strings} (low string first: "xx0231"; frets over 9 need separators: "x-x-12-14-15-14")`);
    return parts.map((p) => {
        if (/^[xXmM]$/.test(p)) return null;
        if (!/^\d+$/.test(p)) throw new Error(`fingering '${s}': '${p}' is not a fret (x mutes, 0 is open)`);
        return Number(p);
    });
}

/** Fingers for a fingering: a barre with finger 1 when the lowest fret holds 2+ strings across a span with nothing lower in it and more than 4 notes need fingers; the rest 1..4 by fret then string. */
export function autoFingers(frets) {
    const used = frets.map((f, i) => ({ f, i })).filter((x) => x.f !== null && x.f > 0);
    const fingers = frets.map(() => null);
    if (!used.length) return { fingers, barre: null };
    const low = Math.min(...used.map((x) => x.f));
    const atLow = used.filter((x) => x.f === low);
    let barre = null;
    const first = atLow[0].i, last = atLow[atLow.length - 1].i;
    const spanOk = frets.slice(first, last + 1).every((f) => f !== null && f >= low);
    if (atLow.length >= 2 && spanOk && (used.length > 4 || (atLow.length >= 3 && last - first >= 2))) barre = { fret: low, from: first, to: last };
    let next = 1;
    if (barre) { for (const x of atLow) fingers[x.i] = 1; next = 2; }
    // the rest in order of fret, then string from the low side: one finger each
    const rest = used.filter((x) => !(barre && x.f === low)).sort((p, q) => p.f - q.f || p.i - q.i);
    // a note two frets above the lowest takes finger 3 (one finger per fret), never fewer than
    // the next free one
    for (const x of rest) { const f = Math.min(4, Math.max(next, 1 + x.f - low)); fingers[x.i] = f; next = f + 1; }
    return { fingers, barre };
}

/**
 * A playable shape for a chord: every chord tone (the 5th may go when there are 4+), the root (or
 * the slash bass) lowest, muted strings only below the bass, at most 4 fingers (a barre counts once)
 * within 4 frets. Lowest position first, then more open strings, more strings, fewer doubled
 * notes outside the triad.
 */
export function voiceGuitar(chord, tuning = STANDARD, maxPos = 12) {
    const open = tuning.map((t) => parseNote(t));
    const tones = new Map(chord.notes.map((n) => [n.pc, n]));
    const bassPc = chord.bass ? chord.bass.pc : chord.root.pc;
    const required = chord.notes.filter((n) => !(chord.notes.length >= 4 && n.iv.deg === 5 && n.iv.semi === 7)).map((n) => n.pc);
    let best = null;
    for (let pos = 0; pos <= maxPos; pos++) {
        const options = open.map((o) => {
            const opts = [null];
            if (pos <= 1 && tones.has(o.pc)) opts.push(0);
            for (let f = Math.max(1, pos); f <= (pos <= 1 ? 3 : pos + 3); f++) if (tones.has((o.pc + f) % 12)) opts.push(f);
            return opts;
        });
        const pick = new Array(open.length);
        const rec = (k) => {
            if (k === open.length) return consider(pick.slice());
            for (const f of options[k]) { pick[k] = f; rec(k + 1); }
        };
        const consider = (frets) => {
            const sounded = frets.map((f, i) => (f === null ? null : (open[i].pc + f) % 12));
            const firstSound = sounded.findIndex((p) => p !== null);
            if (firstSound < 0) return;
            if (sounded.slice(firstSound).some((p) => p === null)) return;            // no muted string inside
            if (sounded[firstSound] !== bassPc) return;
            const n = sounded.filter((p) => p !== null).length;
            if (n < Math.min(4, open.length - 1) && !(chord.notes.length <= 2)) return;
            if (!required.every((p) => sounded.includes(p))) return;
            const fretted = frets.filter((f) => f !== null && f > 0);
            if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 3) return;
            const { fingers, barre } = autoFingers(frets);
            const fingersUsed = new Set(fingers.filter((f) => f !== null)).size;
            const notesNeedingFingers = barre ? fretted.filter((f) => f !== barre.fret).length + 1 : fretted.length;
            if (notesNeedingFingers > 4 || fingersUsed > 4) return;
            const opens = frets.filter((f) => f === 0).length;
            const minF = fretted.length ? Math.min(...fretted) : 0;
            const score = (pos === 0 ? 0 : minF * 3) - opens * 2 - n * 1.5 + (barre ? 2 : 0) + (fretted.length ? Math.max(...fretted) - minF : 0);
            if (!best || score < best.score) best = { frets, fingers, barre, score };
        };
        rec(0);
        if (best && pos >= 1) break;   // a shape at the nut or first position wins over higher ones
    }
    if (!best) throw new Error(`no playable shape found for ${chord.ascii} in ${tuning.join(" ")}`);
    return best;
}

// ---------------------------------------------------------------------------------------------
// Drawing helpers

const paint = (...ops) => ({ paint: { ops } });
const text = (t, x, y, panX = 0, panY = 0) => ({ drawTextAnchored: { text: t, x, y, panX, panY } });
const fmtN = (v) => Number(Number(v).toFixed(3));

function labelFor(n, how, i, list) {
    if (Array.isArray(list)) return list[i] === undefined || list[i] === null ? "" : String(list[i]);
    if (how === "none") return "";
    if (how === "intervals" || how === "interval") return intervalLabel(n);
    if (how === "octaves" || how === "names+octave") return noteName(n, true);
    return noteName(n);
}

/** Notes for the spec: a chord name, a note list, or a fingering (fretboard). */
function notesOf(spec, defOctave = 4) {
    if (spec.notes !== undefined) {
        const list = Array.isArray(spec.notes) ? spec.notes : String(spec.notes).trim().split(/[\s,]+/);
        let notes = list.map((s) => parseNote(s, defOctave));
        // a bare list without octaves rises: C E G -> C4 E4 G4, A C E -> A4 C5 E5
        for (let i = 1; i < notes.length; i++) if (!/\d/.test(String(list[i]))) while (notes[i].midi <= notes[i - 1].midi) notes[i] = parseNote(asciiName(notes[i]), notes[i].octave + 1);
        const chord = spec.chord ? parseChord(spec.chord) : identify(notes);
        const root = chord ? chord.root : notes.slice().sort((p, q) => p.midi - q.midi)[0];
        // with a chord, a note takes the chord tone's spelling (G over E7#9 is F𝄪, its ♯9)
        notes = notes.map((n) => {
            const t = chord?.notes.find((c) => c.pc === n.pc);
            if (!t || (t.letter === n.letter && t.acc === n.acc)) return { ...n, iv: t?.iv ?? ivAbove(root, n) };
            const li = LETTERS.indexOf(t.letter);
            const octave = Math.round((n.midi - LETTER_PC[t.letter] - t.acc) / 12) - 1;
            void li;
            return { ...n, letter: t.letter, acc: t.acc, octave, iv: t.iv };
        });
        return { notes, chord };
    }
    if (spec.chord === undefined) throw new Error("give chord (\"Dm\"), notes (\"D4 F4 A4\") or, for a fretboard, frets (\"xx0231\")");
    const chord = parseChord(spec.chord);
    return { notes: voicePiano(chord, Number(spec.octave ?? defOctave), Number(spec.inversion ?? 0)), chord };
}
/** The interval of n above root, from the letters (so E# above C# is a 3rd, not a 4th). */
function ivAbove(root, n) {
    const deg = ((LETTERS.indexOf(n.letter) - LETTERS.indexOf(root.letter) + 7) % 7) + 1;
    const semi = ((n.pc - root.pc) + 12) % 12;
    return { deg, semi };
}

// ---------------------------------------------------------------------------------------------
// Piano

const BLACK_AFTER = new Set([0, 2, 5, 7, 9]);    // pitch classes with a black key just above
function pianoView(spec, ctx) {
    const { notes, chord } = notesOf(spec);
    const midis = notes.map((n) => n.midi);
    // range: given, or from the C (or F) below the lowest note to the B (or E) above the highest, at least 2 octaves... of white keys
    let lo, hi;
    if (spec.range) {
        const r = Array.isArray(spec.range) ? spec.range : String(spec.range).split(/[\s,–-]+/);
        lo = parseNote(r[0], 4).midi; hi = parseNote(r[1], 5).midi;
    } else {
        lo = Math.min(...midis); hi = Math.max(...midis);
        lo -= ((lo % 12) + 12) % 12;                      // down to C
        hi += 11 - (((hi % 12) + 12) % 12);               // up to B
        if (hi - lo < 23) hi = lo + 23;                    // two octaves
    }
    // a range edge on a black key widens to the white key beside it
    if (BLACK_AFTER.has((lo % 12 + 11) % 12) && ![0, 5].includes(lo % 12) && isBlack(lo)) lo -= 1;
    if (isBlack(hi)) hi += 1;
    for (const m of midis) if (m < lo || m > hi) throw new Error(`note ${m} is outside the range`);
    const whites = [];
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
    const nW = whites.length;
    const xOfWhite = (m) => whites.indexOf(m);
    const centre = (m) => (isBlack(m) ? xOfWhite(m - 1) + 1 : xOfWhite(m) + 0.5);

    const height = Number(spec.height ?? 120);
    const mono = ctx.mono;
    const hl = mono ? "@colors.onSurface" : (spec.color ?? "@colors.primary");
    const onHl = mono ? "@colors.background" : "@colors.onPrimary";
    const whiteKey = mono ? "@colors.background" : (spec.whiteKey ?? "#FFF7F7F4");
    const blackKey = mono ? "@colors.muted" : (spec.blackKey ?? "#FF1E2229");
    const edge = mono ? "@colors.outline" : "#FF9AA1AC";
    const scope = String(spec.scope ?? "pk").replace(/[^A-Za-z0-9_]/g, "") || "pk";
    const V = (k) => `@${scope}_${k}`, N = (k) => `${scope}_${k}`;
    const BH = 0.62, BW = 0.58;    // black key height and width, in key units

    const keys = [];   // drawn in a box nW wide and 1 tall
    keys.push(paint({ color: edge }, { style: "fill" }, { alpha: 1 }), { drawRect: { left: 0, top: 0, right: nW, bottom: 1 } });
    keys.push(paint({ color: whiteKey }), { loop: { index: "i", from: 0, until: nW, commands: [{ drawRect: { left: "i + 0.04", top: 0, right: "i + 0.96", bottom: 0.985 } }] } });
    const sel = new Set(midis);
    const hiW = whites.filter((m) => sel.has(m));
    if (hiW.length) { keys.push(paint({ color: hl })); for (const m of hiW) keys.push({ drawRect: { left: fmtN(xOfWhite(m) + 0.04), top: 0, right: fmtN(xOfWhite(m) + 0.96), bottom: 0.985 } }); }
    const blacks = [];
    for (let m = lo; m <= hi; m++) if (isBlack(m)) blacks.push(m);
    keys.push(paint({ color: blackKey }));
    for (const m of blacks) { const c = centre(m); keys.push({ drawRect: { left: fmtN(c - BW / 2), top: 0, right: fmtN(c + BW / 2), bottom: BH } }); }
    const hiB = blacks.filter((m) => sel.has(m));
    if (hiB.length) {
        keys.push(paint({ color: hl }));
        for (const m of hiB) { const c = centre(m); keys.push({ drawRect: { left: fmtN(c - BW / 2 + (mono ? 0.08 : 0)), top: 0, right: fmtN(c + BW / 2 - (mono ? 0.08 : 0)), bottom: fmtN(BH - (mono ? 0.03 : 0)) } }); }
    }

    const sub = spec.sub;     // a second label line under the keys: "intervals", "names"...
    const subH = sub ? 18 : 0;
    const cmds = [
        { variable: { name: N("kw"), value: `componentWidth() / ${nW}` } },
        { variable: { name: N("kh"), value: subH ? `componentHeight() - ${subH}` : "componentHeight()" } },
        { save: { commands: [{ scale: { sx: V("kw"), sy: V("kh") } }, ...keys] } },
    ];
    // labels on the highlighted keys (hidden when the keys get too narrow for them)
    const labels = notes.map((n, i) => ({ n, m: n.midi, t: labelFor(n, spec.labels ?? "names", i, spec.labels) })).filter((l) => l.t);
    if (labels.length) {
        const longest = Math.max(...labels.map((l) => [...l.t].length));
        // on a white key, in it near the bottom; under a black key, on the ivory just below it
        const onW = labels.filter((l) => !isBlack(l.m)), onB = labels.filter((l) => isBlack(l.m));
        const fit = `step(${V("kw")}, ${longest * 6.5 + 2})`;
        if (onW.length) {
            cmds.push(paint({ color: onHl }, { style: "fill" }, { textSize: 12 }, { alpha: fit }));
            for (const l of onW) cmds.push(text(l.t, `${V("kw")} * ${fmtN(centre(l.m))}`, `${V("kh")} - 6`, 0, -1));
        }
        if (onB.length) {
            cmds.push(paint({ color: mono ? "@colors.onSurface" : hl }, { style: "fill" }, { textSize: 12 }, { alpha: fit }));
            for (const l of onB) cmds.push(text(l.t, `${V("kw")} * ${fmtN(centre(l.m))}`, `${V("kh")} * ${BH} + 3`, 0, 1));
        }
    }
    // middle-C style landmarks: the octave on each C that isn't highlighted
    if (spec.landmarks !== false) {
        const cs = whites.filter((m) => m % 12 === 0 && !sel.has(m));
        if (cs.length) {
            cmds.push(paint({ color: mono ? "@colors.muted" : "#FF8A919C" }, { style: "fill" }, { textSize: 10 }, { alpha: `step(${V("kw")}, 15)` }));
            for (const m of cs) cmds.push(text(`C${m / 12 - 1}`, `${V("kw")} * ${fmtN(xOfWhite(m) + 0.5)}`, `${V("kh")} - 6`, 0, -1));
        }
    }
    if (sub) {
        const subs = notes.map((n, i) => ({ m: n.midi, t: labelFor(n, sub, i, sub) })).filter((l) => l.t);
        cmds.push(paint({ color: "@colors.onSurface" }, { style: "fill" }, { textSize: 11 }, { alpha: 1 }));
        for (const l of subs) cmds.push(text(l.t, `${V("kw")} * ${fmtN(centre(l.m))}`, `${V("kh")} + 4`, 0, 1));
    }
    const desc = spec.label ?? `${chord ? `${chord.name} (${chord.symbol}): ` : ""}piano keys ${notes.map((n) => noteName(n, true)).join(", ")} highlighted`;
    return { canvas: { modifiers: ["fillMaxWidth", { height: height + subH }, { semantics: { contentDescription: desc } }], commands: cmds } };
}
function isBlack(m) { return [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12); }

// ---------------------------------------------------------------------------------------------
// Fretboard (a vertical chord diagram: strings top to bottom of the page, low string on the left)

function fretboardView(spec, ctx) {
    const tuning = (Array.isArray(spec.tuning) ? spec.tuning : spec.tuning ? String(spec.tuning).trim().split(/[\s,]+/) : STANDARD);
    const open = tuning.map((t) => parseNote(t, 3));
    const S = open.length;
    let frets, fingers, barre, chord = null;
    if (spec.frets !== undefined) {
        frets = parseFrets(spec.frets, S);
        const auto = autoFingers(frets);
        fingers = spec.fingers !== undefined ? parseFrets(spec.fingers, S).map((f) => (f === 0 ? null : f)) : auto.fingers;
        barre = spec.barre !== undefined ? spec.barre : spec.fingers !== undefined ? barreFromFingers(frets, fingers) : auto.barre;
    } else if (spec.chord !== undefined) {
        chord = parseChord(spec.chord);
        ({ frets, fingers, barre } = voiceGuitar(chord, tuning));
    } else throw new Error("give chord (\"Dm\") or frets (\"xx0231\", low string first)");
    if (barre && typeof barre === "number") barre = barreAt(frets, barre);
    // what sounds, spelled against the chord
    const sounding = frets.map((f, i) => (f === null ? null : midiNote(open[i].midi + f)));
    const notes = sounding.filter(Boolean);
    if (!chord && spec.chord) chord = parseChord(spec.chord);
    if (!chord && notes.length) chord = identify(notes);
    const spelled = sounding.map((n) => {
        if (!n) return null;
        const t = chord?.notes.find((c) => c.pc === n.pc) ?? (chord?.bass && chord.bass.pc === n.pc ? chord.bass : null);
        const out = t ? { ...n, letter: t.letter, acc: t.acc } : n;
        return { ...out, iv: chord ? ivAbove(chord.root, out) : null };
    });

    const fretted = frets.filter((f) => f !== null && f > 0);
    const nFrets = Math.max(4, Number(spec.fretCount ?? 0), fretted.length ? Math.max(...fretted) - Math.min(...fretted) + 1 : 0);
    const maxF = fretted.length ? Math.max(...fretted) : 0;
    const first = spec.position !== undefined ? Number(spec.position) : maxF <= nFrets ? 1 : Math.min(...fretted);
    const atNut = first === 1;

    // unit box: 100 wide; strings 18..82; markers row 0..12, nut at 18, frets 18 apart
    const W = 100, x0 = 22, x1 = 86, gap = (x1 - x0) / (S - 1), top = 20, fh = 17;
    const bottom = top + nFrets * fh;
    const below = spec.labels === "none" ? 0 : 16;
    const H = bottom + 6 + below;
    const mono = ctx.mono;
    const ink = "@colors.onSurface", dot = mono ? "@colors.onSurface" : (spec.color ?? "@colors.primary");
    const onDot = mono ? "@colors.background" : "@colors.onPrimary";
    const xs = (i) => fmtN(x0 + i * gap);
    const yMid = (f) => fmtN(top + (f - first + 0.5) * fh);

    const c = [];
    // frets and strings
    c.push(paint({ color: "@colors.outline" }, { style: "stroke" }, { strokeWidth: 1 }, { alpha: 1 }));
    for (let k = 1; k <= nFrets; k++) c.push({ drawLine: { x1: x0, y1: top + k * fh, x2: x1, y2: top + k * fh } });
    c.push(paint({ color: mono ? "@colors.outline" : "@colors.muted" }));
    open.forEach((_, i) => c.push(paint({ strokeWidth: fmtN(0.8 + (S - 1 - i) * 0.18) }), { drawLine: { x1: xs(i), y1: top, x2: xs(i), y2: bottom } }));
    c.push(paint({ color: ink }, { strokeWidth: atNut ? 3.5 : 1 }));
    c.push({ drawLine: { x1: x0 - (atNut ? 0.8 : 0), y1: top, x2: x1 + (atNut ? 0.8 : 0), y2: top } });
    // open and muted markers above the nut
    c.push(paint({ color: ink }, { strokeWidth: 1.3 }));
    frets.forEach((f, i) => {
        if (f === 0) c.push({ drawCircle: { cx: xs(i), cy: 10, radius: 3.2 } });
        else if (f === null) c.push({ drawLine: { x1: xs(i) - 3, y1: 7, x2: xs(i) + 3, y2: 13 } }, { drawLine: { x1: xs(i) - 3, y1: 13, x2: xs(i) + 3, y2: 7 } });
    });
    // barre, dots and finger numbers
    c.push(paint({ color: dot }, { style: "fill" }));
    if (barre) c.push({ drawRoundRect: { left: fmtN(x0 + barre.from * gap - 4.6), top: fmtN(yMid(barre.fret) - 4.6), right: fmtN(x0 + barre.to * gap + 4.6), bottom: fmtN(yMid(barre.fret) + 4.6), rx: 4.6, ry: 4.6 } });
    frets.forEach((f, i) => { if (f && !(barre && f === barre.fret && i >= barre.from && i <= barre.to)) c.push({ drawCircle: { cx: xs(i), cy: yMid(f), radius: 4.6 } }); });
    if (spec.showFingers !== false && fingers.some((x) => x)) {
        c.push(paint({ color: onDot }, { textSize: 6.5 }));
        frets.forEach((f, i) => {
            const inBarre = barre && f === barre.fret && i >= barre.from && i <= barre.to;
            if (f && fingers[i] && (!inBarre || i === barre.from)) c.push(text(String(fingers[i]), xs(i), fmtN(yMid(f) + 0.3), 0, 0));
        });
    }
    // the position, beside the first fret when it isn't the nut
    if (!atNut) c.push(paint({ color: ink }, { textSize: 7 }), text(`${first}fr`, x0 - 7, yMid(first), 1, 0));
    // names or intervals under the strings
    if (below) {
        c.push(paint({ color: "@colors.muted" }, { textSize: 6.5 }));
        spelled.forEach((n, i) => { if (n) { const t = spec.labels === "intervals" ? intervalLabel(n) : noteName(n); if (t) c.push(text(t, xs(i), bottom + 6, 0, 1)); } });
    }
    const size = Number(spec.size ?? 180);
    const sc = `${String(spec.scope ?? "fb").replace(/[^A-Za-z0-9_]/g, "")}_s`;
    const cmds = [
        { variable: { name: sc, value: `min(componentWidth() / ${W}, componentHeight() / ${fmtN(H)})` } },
        { translate: { dx: `(componentWidth() - ${W} * @${sc}) / 2`, dy: `(componentHeight() - ${fmtN(H)} * @${sc}) / 2` } },
        { scale: { sx: `@${sc}`, sy: `@${sc}` } },
        ...c,
    ];
    const fing = frets.map((f) => (f === null ? "x" : f)).join(f10(frets) ? "-" : "");
    const desc = spec.label ?? `${chord ? `${chord.name} (${chord.symbol}) ` : ""}on guitar: ${fing}, ${frets.map((f, i) => `${noteName(open[i])} string ${f === null ? "muted" : f === 0 ? "open" : `fret ${f}${fingers[i] ? ` finger ${fingers[i]}` : ""}`}`).join("; ")}${barre ? `; barre at fret ${barre.fret}` : ""}`;
    const canvas = { canvas: { modifiers: [{ width: fmtN(size * W / H) }, { height: size }, { semantics: { contentDescription: desc } }], commands: cmds } };
    const title = spec.title === false ? null : typeof spec.title === "string" ? spec.title : chord?.symbol;
    if (!title) return canvas;
    return { column: { horizontalAlignment: "center", children: [
        { text: { value: title, fontSize: 18, fontWeight: 600, color: "@colors.onSurface", maxLines: 1 } }, canvas] } };
}
const f10 = (frets) => frets.some((f) => f !== null && f > 9);
function midiNote(m) {
    const pc = ((m % 12) + 12) % 12;
    const [letter, acc] = [["C", 0], ["C", 1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]][pc];
    return { letter, acc, octave: Math.floor((m - LETTER_PC[letter] - acc) / 12) - 1, pc, midi: m };
}
function barreAt(frets, fret) {
    const idx = frets.map((f, i) => (f === fret ? i : -1)).filter((i) => i >= 0);
    return idx.length >= 2 ? { fret, from: idx[0], to: idx[idx.length - 1] } : null;
}
function barreFromFingers(frets, fingers) {
    for (const fg of new Set(fingers.filter(Boolean))) {
        const idx = fingers.map((f, i) => (f === fg ? i : -1)).filter((i) => i >= 0);
        if (idx.length >= 2 && idx.every((i) => frets[i] === frets[idx[0]])) return { fret: frets[idx[0]], from: idx[0], to: idx[idx.length - 1] };
    }
    return null;
}

// ---------------------------------------------------------------------------------------------

export function generate(spec, ctx) {
    const view = spec.view ?? "piano";
    if (view === "piano") return pianoView(spec, ctx);
    if (view === "fretboard" || view === "guitar") return fretboardView(spec, ctx);
    throw new Error(`view '${view}': use piano or fretboard`);
}
