// Checks for the design audits (design-audit.mjs). Run: node --test mcp/lib/design-audit.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { designNotes, dateKind, designAudit, designAudit as designAuditAll, isGlyphText, readsClock, textAudit } from "./design-audit.mjs";

const header = { apiLevel: 7, width: 360, height: 640, profiles: 513 };
const codes = (fs) => fs.map((f) => `${f.severity}:${f.code}`).sort();
const text = (value, fontSize = 14, color = "#FFE8EEF6") => ({ text: { value, fontSize, color } });

test("symbols and emoji are glyphs; letters, digits, units and punctuation are not", () => {
    for (const s of ["◐", "☾", "●", "○", "◕", " ★ ", "✓", "✔", "✕", "☀", "☁", "▲", "🌕", "👍🏽", "❤️", "☀☁"]) assert.ok(isGlyphText(s), s);
    for (const s of ["A", "12", "°", "23°", "©", "Hello", "·", "•", "-", "→", "", "★ 4.5", "◐◑◒◓"]) assert.ok(!isGlyphText(s), s);
});

test("dates are recognised, plain numbers and times are not", () => {
    assert.equal(dateKind("OCTOBER 2026"), "month and year");
    assert.equal(dateKind("Oct 30"), "month and day");
    assert.equal(dateKind("2026-10-30"), "date");
    assert.equal(dateKind("Friday 30"), "weekday and day");
    assert.equal(dateKind("30 Oct"), "day and month");
    for (const s of ["Mon", "October", "2026", "12:30", "May the force", "Sat 10%", "phase 3"]) assert.equal(dateKind(s), null, s);
});

test("glyph_icon: moons as text, a warning when large or several", () => {
    const doc = { header, root: { column: { children: ["○", "◐", "●", "◑"].map((g) => text(g, 32)) } } };
    const [f] = designAudit(doc).filter((x) => x.code === "glyph_icon");
    assert.equal(f.severity, "warning");
    assert.equal(f.count, 4);
    assert.match(f.message, /Icon/);
    assert.equal(f.examples[0].path, "root.column.children[0].text.value");
    // One small glyph is advice only.
    const one = designAudit({ header, root: { row: { children: [text("✓", 14), text("Done")] } } });
    assert.deepEqual(codes(one), ["info:glyph_icon"]);
});

test("glyph_icon: a canvas text's size comes from the paint before it", () => {
    const doc = { header, root: { canvas: { commands: [
        { paint: { color: "#FFFFFFFF", textSize: 40 } },
        { drawTextAnchored: { text: "☾", x: 10, y: 10, panX: 0, panY: 0 } },
    ] } } };
    const [f] = designAudit(doc);
    assert.equal(f.code, "glyph_icon");
    assert.equal(f.severity, "warning");
    assert.equal(f.examples[0].fontSize, 40);
});

const moonCell = (day) => ({ canvas: { modifiers: [{ size: 44 }], commands: [
    { paint: { color: "@colors.surface" } }, { drawCircle: { cx: 22, cy: 22, radius: 18 } },
    { paint: { color: "@colors.primary" } }, { variable: { name: "ph", value: `${day} / 29.53` } },
    { drawArc: { left: 4, top: 4, right: 40, bottom: 40, startAngle: -90, sweepAngle: 180 } },
    { drawOval: { left: "22 - 18 * cos(@ph * 6.2832)", top: 4, right: "22 + 18 * cos(@ph * 6.2832)", bottom: 40 } },
    { paint: { color: "@colors.background", style: "stroke", strokeWidth: 1.5 } }, { drawCircle: { cx: 22, cy: 22, radius: 18 } },
    { drawLine: { x1: 4, y1: 22, x2: 40, y2: 22 } }, { drawLine: { x1: 22, y1: 4, x2: 22, y2: 40 } },
] } });

test("repeated_subtree: 31 canvases differing in one number", () => {
    const doc = { header, root: { flow: { children: Array.from({ length: 31 }, (_, i) => moonCell(i + 1)) } } };
    const fs = designAudit(doc).filter((x) => x.code === "repeated_subtree");
    assert.equal(fs.length, 1, "only the outermost repeated subtree is reported");
    const [f] = fs;
    assert.equal(f.severity, "warning");
    assert.equal(f.count, 31);
    assert.deepEqual(f.differing.map((d) => d.path), ["canvas.commands[3].variable.value"]);
    assert.match(f.message, /components/);
    // A few copies are advice.
    const few = designAudit({ header, root: { flow: { children: Array.from({ length: 5 }, (_, i) => moonCell(i + 1)) } } });
    assert.deepEqual(codes(few.filter((x) => x.code === "repeated_subtree")), ["info:repeated_subtree"]);
});

test("repeated_subtree: component calls and definitions are not copies", () => {
    const calls = Array.from({ length: 31 }, (_, i) => ({ MoonDay: { day: i + 1, label: `Day number ${i + 1}`, size: 44, accent: "@colors.primary", note: "x".repeat(150) } }));
    const doc = { header, components: { MoonDay: { params: { day: { type: "float" } }, body: moonCell("@day") } }, root: { flow: { children: calls } } };
    assert.equal(designAudit(doc).filter((x) => x.code === "repeated_subtree").length, 0);
});

test("hardcoded_date: a typed month, worse with nothing reading the clock", () => {
    const fixed = designAudit({ header, root: { column: { children: [text("OCTOBER 2026", 22), text("Today: Oct 30")] } } });
    const [f] = fixed.filter((x) => x.code === "hardcoded_date");
    assert.equal(f.severity, "warning");
    assert.equal(f.reads_clock, false);
    assert.match(f.message, /calendarMonth\(\)/);
    const withClock = designAudit({ header, root: { column: { children: [text("OCTOBER 2026"), { DateLabel: {} }] } } });
    assert.deepEqual(codes(withClock), ["info:hardcoded_date"]);
});

test("hardcoded_date: a month grid typed out as 31 literal day numbers", () => {
    const grid = { header, resources: { variables: { dummy: "dayOfMonth()" } }, root: { flow: { children: Array.from({ length: 31 }, (_, i) => text(String(i + 1))) } } };
    const [f] = designAudit(grid).filter((x) => x.code === "hardcoded_date");
    assert.equal(f.severity, "warning");
    assert.equal(f.literal_day_numbers, 31);
});

test("hardcoded_colors: info alone, a warning next to other hard-wiring; themes are fine", () => {
    // These demo documents are rows of text: leave text_only (its own test) out of the comparison.
    const codes = (fs) => fs.filter((f) => f.code !== "text_only").map((f) => `${f.severity}:${f.code}`).sort();
    const designAudit = (d) => designAuditAll(d).filter((f) => f.code !== "text_only");
    const palette = ["#FF0B1020", "#FFE8EEF6", "#FF8899AA", "#FFF5E6B8", "#FFFFC107", "#FF4DA3FF", "#FF26A69A", "#FFEF5350"];
    const rows = palette.flatMap((c) => [{ box: { modifiers: [{ size: 12 }, { background: c }] } }, text("label", 12, c)]);
    assert.deepEqual(codes(designAudit({ header, root: { column: { children: rows } } })), ["info:hardcoded_colors"]);
    assert.deepEqual(codes(designAudit({ header, root: { column: { children: [text("OCTOBER 2026"), ...rows] } } })),
        ["warning:hardcoded_colors", "warning:hardcoded_date"]);
    const themed = rows.map((r) => JSON.parse(JSON.stringify(r).replace(/"#[0-9A-F]{8}"/g, '"@colors.primary"')));
    assert.deepEqual(designAudit({ header, root: { column: { children: themed } } }), []);
    // Named colours defined as {light, dark} count as themed.
    const res = { colors: Object.fromEntries(palette.map((c, i) => [`c${i}`, { light: c, dark: c }])) };
    const named = rows.map((r) => JSON.parse(JSON.stringify(r).replace(/"(#[0-9A-F]{8})"/g, (_, c) => `"@colors.c${palette.indexOf(c)}"`)));
    assert.deepEqual(designAudit({ header, resources: res, root: { column: { children: named } } }), []);
});

test("readsClock sees expressions, clock components and time capabilities", () => {
    assert.ok(readsClock({ root: { text: { value: { type: "textFromFloat", value: "dayOfMonth()" } } } }));
    assert.ok(readsClock({ root: { textLookup: { index: "calendarMonth() - 1" } } }));
    assert.ok(readsClock({ root: { DigitalClock: {} } }));
    assert.ok(!readsClock({ root: { text: { value: "day" } } }));
});

test("textAudit: the binary document's best effort", () => {
    assert.deepEqual(codes(textAudit(["○", "◐", "OCTOBER 2026", "Hello"], { readsClock: false })), ["warning:glyph_icon", "warning:hardcoded_date"]);
    assert.deepEqual(codes(textAudit(["OCTOBER 2026"])), ["info:hardcoded_date"]);
    assert.deepEqual(textAudit(["Hello", "42", "12:30"]), []);
});

test("layout: a UI drawn on one canvas at fixed coordinates, and centred text at an edge", () => {
    const t = (text, x, y, panX = -1) => ({ drawTextAnchored: { text, x, y, panX, panY: 0 } });
    const texts = Array.from({ length: 12 }, (_, i) => t(`Line ${i}`, 42, 60 + 40 * i));
    const doc = { header: { apiLevel: 7, width: 390, height: 780 }, root: { type: "canvas", modifiers: ["fillMaxSize"], commands: [
        { paint: { textSize: 31 } }, t("San Francisco", 42, 111, 0), ...texts,
        { drawRoundRect: { left: 20, top: 22, right: 370, bottom: 758, rx: 30, ry: 30 } }] } };
    const codes = Object.fromEntries(designAudit(doc).map((f) => [f.code, f.severity]));
    assert.equal(codes.absolute_layout, "warning");
    assert.equal(codes.fixed_coordinates, "warning");
    assert.equal(codes.text_anchor, "warning");
    assert.match(designNotes(doc), /absolute_layout/);
    // The same texts in layout components: none of the three.
    const ok = { header: { apiLevel: 7, width: 390, height: 780 }, root: { column: { modifiers: ["fillMaxSize"],
        children: [{ text: { value: "San Francisco", fontSize: 31 } }, { text: { value: "6:13 PM" } }] } } };
    const okCodes = designAudit(ok).map((f) => f.code);
    for (const c of ["absolute_layout", "fixed_coordinates", "text_anchor"]) assert.ok(!okCodes.includes(c), c);
});

test("text_in_canvas: labels hand-drawn in a drawing that sits in a layout", () => {
    const t = (text, x, y) => ({ drawTextAnchored: { text, x, y, panX: -1, panY: 0 } });
    const canvas = { canvas: { modifiers: ["fillMaxWidth", { height: 200 }], commands: [
        { scale: { sx: "componentWidth() / 440", sy: "componentHeight() / 300" } },
        ...Array.from({ length: 12 }, (_, i) => t(`${i * 2}h`, 20 + 30 * i, 280))] } };
    const doc = { header: { apiLevel: 7, width: 440, height: 300 }, root: { column: { children: [{ text: { value: "Tides" } }, canvas] } } };
    const f = designAudit(doc).find((x) => x.code === "text_in_canvas");
    assert.equal(f?.severity, "warning");
    assert.ok(!designAudit(doc).some((x) => x.code === "absolute_layout"));
});

test("text_only: a screen of texts gets a suggestion, one with an icon does not", () => {
    const t = (v) => ({ text: { value: v } });
    const plain = { header, root: { column: { children: Array.from({ length: 10 }, (_, i) => t(`row ${i}`)) } } };
    assert.equal(designAuditAll(plain).find((f) => f.code === "text_only")?.severity, "info");
    assert.match(designNotes(plain), /suggestions:[\s\S]*text_only/);
    const withIcon = { header, root: { column: { children: [{ Icon: { name: "wifi" } }, ...plain.root.column.children] } } };
    assert.ok(!designAuditAll(withIcon).some((f) => f.code === "text_only"));
});
