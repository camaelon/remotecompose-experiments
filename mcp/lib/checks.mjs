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
    const { $clock, $tap, $size, $wait, $expect, ...values } = sample ?? {};
    const isPoint = (t) => Array.isArray(t) && t.length === 2 && t.every((n) => typeof n === "number");
    const taps = $tap === undefined ? [] : typeof $tap === "string" || isPoint($tap) ? [$tap] : $tap;
    return { values, clock: $clock, taps, size: $size, wait: $wait, expect: $expect };
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
        lines.push(`screen reader: ${said.length ? said.slice(0, 10).map((s) => `"${cut(s)}"`).join("; ") + (said.length > 10 ? `; and ${said.length - 10} more` : "") : "nothing announced"}`);
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
