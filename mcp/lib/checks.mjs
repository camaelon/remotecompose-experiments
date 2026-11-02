// What makes a repeated check cheap: the list of what to render, kept beside the document, and
// which pictures the caller has already seen, so "check again" needs no arguments and shows only
// what changed. Pure apart from the file reads and writes of loadPlan and savePlan.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const KEPT = ["looks", "sizes", "samples", "every_look", "width", "height", "clock", "variables", "density"];

/** x.json or x.rc -> x.checks.json. */
export const planPathOf = (src) => String(src).replace(/\.(json|rc)$/i, "") + ".checks.json";

export function loadPlan(file) {
    try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null; } catch { return null; }
}

export function savePlan(file, args, hashes) {
    const plan = { hashes };
    for (const k of KEPT) if (args[k] !== undefined) plan[k] = args[k];
    try { writeFileSync(file, JSON.stringify(plan)); } catch { /* the check stands without it */ }
}

export const imageHash = (base64) => createHash("sha1").update(base64).digest("hex").slice(0, 16);

/**
 * A sample's special keys apart from its host values:
 * $clock pins its time; $tap taps: the words of a tappable thing ("Harbour Front"), [x, y] in dp
 * at that size, or a list of either; $wait waits that many seconds after the taps; $expect checks
 * variables at the end ({"open": 2}); $size limits it to one size.
 */
export function splitSample(sample) {
    const { $clock, $tap, $drag, $size, $wait, $expect, ...values } = sample ?? {};
    const isPoint = (t) => Array.isArray(t) && t.length === 2 && t.every((n) => typeof n === "number");
    const taps = $tap === undefined ? [] : typeof $tap === "string" || isPoint($tap) ? [$tap] : $tap;
    return { values, clock: $clock, taps, drag: $drag, size: $size, wait: $wait, expect: $expect };
}

/** What a tap target says, from the accessibility nodes (its label and the texts merged into it). */
export function targetWords(target, nodes) {
    const n = (nodes ?? []).find((x) => x.id === target.component_id);
    return [n?.content_description, n?.text, ...(n?.merged ?? [])].filter(Boolean);
}

/** The target whose words contain `label`: a whole match first, else a part. Null when none does. */
export function findTapTarget(label, targets, nodes) {
    const want = String(label).toLowerCase();
    const scored = (targets ?? []).map((t) => ({ t, words: targetWords(t, nodes).map((w) => String(w).toLowerCase()) }));
    const hit = scored.find((x) => x.words.includes(want)) ?? scored.find((x) => x.words.some((w) => w.includes(want)));
    return hit?.t ?? null;
}

/** Each expected variable against the value read: [{name, expected, actual, ok}]. */
export function compareExpected(expected, actual) {
    return Object.entries(expected ?? {}).map(([name, want]) => {
        const got = actual[name];
        const ok = typeof want === "number" ? Math.abs(Number(got) - want) <= 0.01 : String(got) === String(want);
        return { name, expected: want, actual: got, ok };
    });
}

/**
 * The inspection results a check adds, in a few short lines: what a screen reader announces, the
 * tap targets with their positions, where the two engines disagree in structure, the repaint.
 */
export function summarizeInspection({ nodes, targetsBySize, engines, repaint }) {
    const cut = (s, n = 70) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
    const lines = [];
    if (nodes) {
        const said = nodes.map((n) => [n.content_description ?? n.text, n.state].filter(Boolean).join(", ")).filter(Boolean);
        lines.push(`screen reader: ${said.length ? said.slice(0, 16).map((s) => `"${cut(s)}"`).join("; ") + (said.length > 16 ? `; and ${said.length - 16} more` : "") : "nothing announced"}`);
    }
    for (const { size, targets, nodes: sizeNodes } of targetsBySize ?? []) {
        const list = targets.slice(0, 8).map((t) => `"${cut(targetWords(t, sizeNodes)[0] ?? t.component, 30)}" at ${t.center.map(Math.round).join(",")}`);
        lines.push(`tap targets at ${size[0]}×${size[1]}: ${list.length ? list.join("; ") : "none"}`);
    }
    if (engines?.length) {
        const bad = engines.filter((e) => e.structural);
        lines.push(bad.length ? `players disagree on structure: ${bad.map((e) => `${e.size.join("×")}: ${e.structural} component(s)`).join("; ")} (inspect engines lists them)` : "players: same structure in C++ and TypeScript.");
    }
    if (repaint) lines.push(`repaint: ${repaint}`);
    return lines;
}

/** touch_events for taps: apart, so an animation that a tap starts settles before the next. */
export function tapEvents(taps) {
    return taps.map(([x, y], i) => ({ t: 0.1 + i * 0.7, type: "tap", x, y }));
}

/** touch_events for a drag [x0, y0, x1, y1], after any taps: it presses, moves in steps, lifts. */
export function dragEvents([x0, y0, x1, y1], start = 0.1) {
    const steps = [0.25, 0.5, 0.75, 1].map((f, i) => ({ t: start + 0.05 * (i + 1), type: "move", x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f }));
    return [{ t: start, type: "down", x: x0, y: y0 }, ...steps, { t: start + 0.3, type: "up", x: x1, y: y1 }];
}

/** How long to run so the tap's ripple and any animation have ended in the picture. */
// ($wait is exact, to see a state at that time; without it everything has settled.)
export const tapSettle = (taps, wait) => (wait !== undefined ? 0.1 + Math.max(0, taps.length - 1) * 0.7 + wait : 0.1 + taps.length * 0.7 + 1.5);

/**
 * A document with the starting values of its named variables replaced: an example's host
 * variables are its parameters. Only plain values (not a formula); an unknown name is an error
 * that lists what can be set.
 */
export function setVariables(doc, set) {
    const out = JSON.parse(JSON.stringify(doc));
    const known = new Map();
    for (const group of ["variables", "integers", "strings"]) {
        const vars = out.resources?.[group];
        if (!vars || Array.isArray(vars)) continue;
        for (const [name, v] of Object.entries(vars)) {
            if (v && typeof v === "object" && "value" in v) known.set(name, (x) => { v.value = x; });
            else if (typeof v === "number") known.set(name, (x) => { vars[name] = x; });
        }
    }
    const visit = (x) => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!x || typeof x !== "object") return;
        const v = x.variable;
        if (v && typeof v === "object" && typeof v.name === "string" && "value" in v && typeof v.value !== "object") known.set(v.name, (y) => { v.value = y; });
        for (const c of Object.values(x)) visit(c);
    };
    visit(out.root);
    for (const [name, value] of Object.entries(set ?? {})) {
        const put = known.get(name);
        if (!put) throw new Error(`set: no plain variable "${name}". It can set: ${[...known.keys()].join(", ") || "nothing"}`);
        put(value);
    }
    return out;
}

/** The visible leaves of an inspect layout tree: texts and drawings, with their boxes. */
export function visibleLeaves(tree) {
    const out = [];
    // (Under a graphics layer a text may be faded out: pager pages stack in one place.)
    // (Under a scroll a box may run past the window on purpose.)
    const walk = (n, layered = false, scrolled = false) => {
        if (n.hidden) return;
        const kids = n.children ?? [];
        const under = layered || (n.modifiers ?? []).some((m) => /graphicslayer/i.test(m));
        const inScroll = scrolled || (n.modifiers ?? []).some((m) => /scroll/i.test(m)) || /scroll|marquee/i.test(n.component ?? "");
        const drawing = /canvas/i.test(n.component ?? "") && !/content/i.test(n.component ?? "");
        if (n.text !== undefined && n.text !== null && n.text !== "") out.push({ id: n.id, text: String(n.text), box: n.bounds, layered: under, scrolled: inScroll });
        else if (drawing && n.bounds.w > 0 && n.bounds.h > 0) out.push({ id: n.id, drawing: true, box: n.bounds });
        kids.forEach((k) => walk(k, under, inScroll));
    };
    tree.forEach((n) => walk(n));
    return out;
}

const overlapShare = (a, b) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / Math.min(a.w * a.h, b.w * b.h);
};

/** A number no one would write: float noise (38.400002), E notation (0.23E-40), money with one decimal ($0.3). */
export const oddNumber = (t) => /\d\.\d{5,}/.test(t) || /\d\.?\d*E-?\d/.test(t) || /[$€£¥]\s?\d[\d,]*\.\d(?!\d)/.test(t);

/**
 * What looking at the pictures would find, compared across sizes ([{size, leaves, targets}]):
 * content the largest size shows and a smaller one drops (a fact to judge), a drawing shrunk to
 * almost nothing, texts on top of each other, and tap targets on top of each other (faults).
 */
export function layoutFaults(perSize) {
    if (!perSize.length) return { warnings: [], dropped: [] };
    const area = ({ size }) => size[0] * size[1];
    const big = [...perSize].sort((a, b) => area(b) - area(a))[0];
    const name = (l) => (l.text !== undefined ? JSON.stringify(l.text.length > 24 ? l.text.slice(0, 23) + "…" : l.text) : "a drawing");
    const warnings = [], dropped = [];
    for (const s of perSize) {
        const here = `${s.size[0]}×${s.size[1]}`;
        const byId = new Map(s.leaves.map((l) => [l.id, l]));
        if (s !== big) {
            // (By its words as well: a layout may show the same text from another copy.)
            const words = new Set(s.leaves.map((l) => l.text).filter(Boolean));
            const gone = big.leaves.filter((l) => !byId.has(l.id) && !(l.text !== undefined && words.has(l.text)));
            if (gone.length) dropped.push(`at ${here}: ${gone.slice(0, 6).map(name).join(", ")}${gone.length > 6 ? ` and ${gone.length - 6} more` : ""}`);
            for (const l of big.leaves) {
                const small = byId.get(l.id);
                if (!l.drawing || !small) continue;
                const was = Math.min(l.box.w, l.box.h), now = Math.min(small.box.w, small.box.h);
                // (A bar or a line is thin on purpose: it has to be small both ways.)
                // A chart that had room and is now a sliver: wide still, but no longer readable.
                if (was >= 48 && now < 24 && Math.max(small.box.w, small.box.h) >= 48) warnings.push(`warning: [squashed_content] at ${here} a drawing is ${Math.round(small.box.w)}×${Math.round(small.box.h)}, ${Math.round(was)} at its smallest side in the largest size. Hide it at this size, or give it the room by dropping something else.`);
                if (now < 24 && Math.max(small.box.w, small.box.h) < 48 && was >= now * 3) warnings.push(`warning: [shrunk_content] at ${here} a drawing is ${Math.round(small.box.w)}×${Math.round(small.box.h)} dp (${Math.round(l.box.w)}×${Math.round(l.box.h)} at ${big.size.join("×")}): too small to read. Hide it at this size or give it room.`);
            }
        }
        const texts = s.leaves.filter((l) => l.text !== undefined && !l.layered);
        // Past the window with no scroll to reach it: cut off whatever the layout thinks.
        const cut = texts.filter((l) => !l.scrolled && l.box.w > 0 && l.box.h > 0 && (l.box.y + l.box.h > s.size[1] + 1 || l.box.x + l.box.w > s.size[0] + 1));
        if (cut.length) warnings.push(`warning: [cut_by_window] at ${here}: ${cut.slice(0, 3).map(name).join(", ")} runs past the edge of the window, and nothing scrolls to it.`);
        const odd = [...new Set(texts.map((l) => l.text).filter(oddNumber))];
        if (odd.length) warnings.push(`warning: [odd_number] at ${here}: ${odd.slice(0, 3).map((t) => JSON.stringify(t)).join(", ")}: float noise, E notation or money with one decimal. textFromFloat flags decide padding: 7 keeps the trailing zero of $0.30.`);
        const hit = [];
        for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
            // (Starting at exactly one point they are alternatives stacked on purpose: two faces of a
            // chip, the pages of a pager. An accident does not line up that well.)
            const stacked = texts[i].box.x === texts[j].box.x && texts[i].box.y === texts[j].box.y;
            if (!stacked && overlapShare(texts[i].box, texts[j].box) > 0.3) hit.push(`${name(texts[i])} and ${name(texts[j])}`);
        }
        if (hit.length) warnings.push(`warning: [overlapping_text] at ${here}: ${hit.slice(0, 3).join("; ")}.`);
        const t = s.targets ?? [];
        const tap = [];
        for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
            const a = t[i].bounds, b = t[j].bounds;
            // (One box twice is one component with several gestures.)
            const same = a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
            if (a && b && !same && overlapShare(a, b) > 0.25) tap.push(`${Math.round(a.x)},${Math.round(a.y)} and ${Math.round(b.x)},${Math.round(b.y)}`);
        }
        if (tap.length) warnings.push(`warning: [overlapping_targets] at ${here}: tap targets at ${tap.slice(0, 3).join("; ")} overlap, so a tap can reach the wrong one.`);
    }
    return { warnings: [...new Set(warnings)], dropped };
}

/** An interact action in the forms callers guess: {"type": "tap", "x", "y"}, {"$tap": [x, y]}, {"type": "wait", "seconds"}. */
export function normalizeAction(a) {
    if (!a || typeof a !== "object") return a;
    if (a.$tap !== undefined) return { tap: a.$tap };
    if (a.type === "tap" && a.x !== undefined) return { tap: [a.x, a.y] };
    if (a.type === "wait") return { wait: a.seconds ?? a.wait ?? a.duration ?? 0.5 };
    return a;
}

export const fitsSize = (size, w, h) => !Array.isArray(size) || (size[0] === w && size[1] === h);

/**
 * Cells ([{label, hash}]) split by whether their picture changed since `previous` ({label: hash}).
 * A new or failed cell (no hash) counts as changed; `showAll` keeps every picture.
 */
export function changedCells(cells, previous, showAll = false) {
    const changed = new Set(), unchanged = [];
    for (const c of cells) {
        if (!showAll && c.hash && previous?.[c.label] === c.hash) unchanged.push(c.label);
        else changed.add(c.label);
    }
    return { changed, unchanged };
}
