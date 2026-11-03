// The front door's round-trip savers: convert returns its pictures (and says they are current),
// inspect task "controls" tries every control in one call, and inspect task "engines" degrades
// to the TypeScript layout when the C++ layout tool is not built.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { definition, picturesNote, writeFinalSheets } from "../remotecompose-server.mjs";
import { enginesTool, rc2layoutAvailable } from "./engines.mjs";
import { RC2IMAGE } from "./rc2image.mjs";

const EXAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "examples");
const ex = (id) => path.join(EXAMPLES, id, "doc.json");
const tool = (name) => definition.tools.find((t) => t.name === name);
const controls = async (id) => JSON.parse((await tool("inspect").handler({ task: "controls", json_path: ex(id) }))[0].text);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64").toString("base64");

test("controls: every switch and checkbox tapped once, each with its own change", async () => {
    const r = await controls("CMP-02-toggles-gallery");
    assert.equal(r.controls, 4);
    assert.equal(r.exercised, 4);
    const wifi = r.results.find((c) => c.label === "Wi-Fi");
    assert.ok(wifi, JSON.stringify(r.results.map((c) => c.label)));
    assert.equal(wifi.kind, "click");
    assert.ok(wifi.changed.includes("wifi: 0 → 1"), wifi.changed.join("; "));
    // Each from a fresh start: Bluetooth (on) turns off, whatever Wi-Fi did before it.
    assert.ok(r.results.find((c) => c.label === "Bluetooth").changed.includes("bluetooth: 1 → 0"));
    assert.ok(r.results.every((c) => !c.suspicious), JSON.stringify(r.results));
    // The touch position is not an effect.
    assert.ok(r.results.every((c) => c.changed.every((l) => !/^TOUCH_/.test(l))));
});

test("controls: a slider is dragged, its value reported against its range", async () => {
    const r = await controls("CMP-03-slider-gallery");
    const vol = r.results.find((c) => c.label === "Volume");
    assert.equal(vol.kind, "touch");
    assert.deepEqual(vol.range, [0, 100]);
    assert.equal(vol.variable, "volume");
    assert.ok(vol.changed.some((l) => /^volume: 40 → /.test(l)), vol.changed.join("; "));
    assert.ok(!vol.suspicious);
});

test("controls: an option already selected is flagged as having no effect; a pager swipes", async () => {
    const bmi = await controls("CMP-25-bmi-calculator");
    const metric = bmi.results.find((c) => c.label === "Units: Metric");
    assert.match(metric.suspicious?.[0] ?? "", /no effect/);
    const imperial = bmi.results.find((c) => c.label === "Units: Imperial");
    assert.ok(imperial.changed.includes("unit: 0 → 1"));
    assert.match(imperial.layout, /shown: .*hidden: /);
    const pager = await controls("INT-06-pager");
    assert.ok(pager.results[0].changed.includes("page: 0 → 1"), JSON.stringify(pager.results[0]));
});

test("engines: without the C++ layout tool, the TypeScript layout and a note, not an error", async () => {
    const saved = process.env.RC2LAYOUT;
    process.env.RC2LAYOUT = path.join(tmpdir(), "no-such-dir", "rc2layout");
    try {
        assert.equal(rc2layoutAvailable(), false);
        assert.match(enginesTool.description, /not available/);
        const r = JSON.parse((await tool("inspect").handler({ task: "engines", json_path: ex("CMP-02-toggles-gallery") }))[0].text);
        assert.equal(r.compared, false);
        assert.ok(r.typescript.components > 0);
        assert.match(r.note, /not built/);
    } finally {
        if (saved === undefined) delete process.env.RC2LAYOUT; else process.env.RC2LAYOUT = saved;
    }
});

test("engines: with the C++ layout tool, the two players compared", { skip: !rc2layoutAvailable() && "rc2layout is not built" }, async () => {
    const r = JSON.parse((await enginesTool.handler({ json_path: ex("CMP-02-toggles-gallery") }))[0].text);
    assert.equal(r.compared, true);
    assert.equal(typeof r.agree, "boolean");
});

test("picturesNote: says the sheet is current, or that nothing changed", () => {
    const shown = [{ type: "image", data: PNG, mimeType: "image/png" }, { type: "text", text: "contact sheet: 4 renders" },
        { type: "text", text: "Checked 4 render(s): 4 shown, 0 unchanged since the last check, 0 warning(s)." }];
    assert.match(picturesNote(shown)[0].text, /4 render\(s\) of THIS version.*do not call render for the same looks and sizes/s);
    assert.match(picturesNote([{ type: "text", text: "Checked 4 render(s): 0 shown, 4 unchanged since the last check, 0 warning(s)." }])[0].text, /none changed/);
    assert.deepEqual(picturesNote([{ type: "text", text: "something else" }]), []);
});

test("writeFinalSheets: a complete check's sheet is written; a partial one is not", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rc-final-"));
    try {
        const kept = path.join(dir, "doc.json");
        const full = [{ type: "image", data: PNG }, { type: "text", text: "Checked 2 render(s): 2 shown, 0 unchanged since the last check, 0 warning(s)." }];
        assert.deepEqual(writeFinalSheets(kept, full), [path.join(dir, "doc-final-sheet.png")]);
        assert.ok(existsSync(path.join(dir, "doc-final-sheet.png")));
        assert.equal(writeFinalSheets(kept, [{ type: "image", data: PNG }, { type: "text", text: "Checked 2 render(s): 1 shown, 1 unchanged since the last check, 0 warning(s)." }]), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("convert with looks and sizes returns the contact sheet image, said to be current", { skip: !existsSync(RC2IMAGE) && "rc2image is not built" }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rc-convert-sheet-"));
    try {
        const file = path.join(dir, "toggles.json");
        copyFileSync(ex("CMP-02-toggles-gallery"), file);
        const r = await tool("convert").handler({ json_path: file, looks: ["light", "dark"], sizes: [[360, 280], [320, 160]] });
        const images = r.filter((c) => c.type === "image");
        assert.equal(images.length, 1, "one contact sheet");
        const png = Buffer.from(images[0].data, "base64");
        assert.ok(png.readUInt32BE(16) <= 1600, `sheet ${png.readUInt32BE(16)} px wide`);
        const at = r.indexOf(images[0]);
        assert.match(r[at - 1].text, /^Pictures: .*4 render\(s\) of THIS version/);
        // Clean: the final sheet is the check's own (no second render), on disk.
        if (r.some((c) => c.type === "text" && c.text.startsWith("NO FAULTS"))) {
            assert.deepEqual(readFileSync(path.join(dir, "toggles-final-sheet.png")), png);
        }
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
