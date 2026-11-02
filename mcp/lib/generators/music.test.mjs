import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChord, parseNote, parseFrets, autoFingers, voiceGuitar, voicePiano, identify, intervalLabel, asciiName, generate } from "./music.mjs";

const spelled = (sym) => parseChord(sym).notes.map(asciiName).join(" ");
const shape = (sym) => voiceGuitar(parseChord(sym)).frets.map((f) => (f === null ? "x" : f)).join("");

test("chord spelling uses the right letters", () => {
    assert.equal(spelled("Dm"), "D F A");
    assert.equal(spelled("Cmaj7"), "C E G B");
    assert.equal(spelled("Bbmaj7"), "Bb D F A");
    assert.equal(spelled("F#m7b5"), "F# A C E");
    assert.equal(spelled("F#7"), "F# A# C# E");
    assert.equal(spelled("Ebm"), "Eb Gb Bb");
    assert.equal(spelled("C#dim7"), "C# E G Bb");
    assert.equal(spelled("Abaug"), "Ab C E");
    assert.equal(spelled("E7#9"), "E G# B D F##");
    assert.equal(spelled("Dsus4"), "D G A");
    assert.equal(spelled("Gb"), "Gb Bb Db");
    assert.equal(parseChord("G7/B").bass.letter, "B");
    assert.deepEqual(parseChord("Dm").notes.map(intervalLabel), ["R", "♭3", "5"]);
    assert.deepEqual(parseChord("C#dim7").notes.map(intervalLabel), ["R", "♭3", "♭5", "𝄫7"]);
    assert.throws(() => parseChord("Hm"), /not a chord/);
    assert.throws(() => parseChord("Cfoo"), /unknown chord quality/);
});

test("notes and piano voicings", () => {
    assert.equal(parseNote("C4").midi, 60);
    assert.equal(parseNote("A4").midi, 69);
    assert.equal(parseNote("Cb4").midi, 59);
    assert.equal(parseNote("B#3").midi, 60);
    assert.deepEqual(voicePiano(parseChord("Dm")).map((n) => n.midi), [62, 65, 69]);
    assert.deepEqual(voicePiano(parseChord("Dm"), 4, 1).map((n) => n.midi), [65, 69, 74]);
    assert.deepEqual(voicePiano(parseChord("Bb/D")).map((n) => n.midi), [62, 70, 74, 77]);
    assert.equal(identify(["D4", "F4", "A4"].map((s) => parseNote(s))).ascii, "Dm");
    assert.equal(identify(["E3", "G3", "C4"].map((s) => parseNote(s))).ascii, "C/E");
});

test("fingering parsing", () => {
    assert.deepEqual(parseFrets("xx0231"), [null, null, 0, 2, 3, 1]);
    assert.deepEqual(parseFrets("x 3 2 0 1 0"), [null, 3, 2, 0, 1, 0]);
    assert.deepEqual(parseFrets("x-x-12-14-15-14"), [null, null, 12, 14, 15, 14]);
    assert.deepEqual(parseFrets("X,X,0,2,3,1"), [null, null, 0, 2, 3, 1]);
    assert.throws(() => parseFrets("xx023"), /5 strings/);
    assert.throws(() => parseFrets("xx02a1"), /not a fret/);
});

test("fingers and barres", () => {
    assert.deepEqual(autoFingers(parseFrets("xx0231")), { fingers: [null, null, null, 2, 3, 1], barre: null });
    assert.deepEqual(autoFingers(parseFrets("133211")), { fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 1, from: 0, to: 5 } });
    assert.deepEqual(autoFingers(parseFrets("x24432")), { fingers: [null, 1, 3, 4, 2, 1], barre: { fret: 2, from: 1, to: 5 } });
});

test("guitar shapes from chord names", () => {
    assert.equal(shape("Dm"), "xx0231");
    assert.equal(shape("Am"), "x02210");
    assert.equal(shape("E"), "022100");
    assert.equal(shape("D"), "xx0232");
    assert.equal(shape("A7"), "x02020");
    assert.equal(shape("F"), "133211");
    assert.equal(shape("Bm"), "x24432");
    assert.equal(shape("F#m"), "244222");
});

test("generate: a Dm diagram and keyboard", () => {
    const ctx = { mono: false };
    const fb = JSON.stringify(generate({ view: "fretboard", chord: "Dm" }, ctx));
    assert.ok(fb.includes("D minor (Dm) on guitar: xx0231"));
    const pk = JSON.stringify(generate({ view: "piano", chord: "Dm", sub: "intervals" }, ctx));
    assert.ok(pk.includes("D4, F4, A4"));
    for (const t of ["\"R\"", "\"♭3\"", "\"5\""]) assert.ok(pk.includes(t), t);
});
