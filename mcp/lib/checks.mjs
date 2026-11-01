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
 * $clock pins its time, $tap taps ([x, y], or a list of them, in document coordinates at that
 * size), $size limits it to one size (tap positions usually fit only one).
 */
export function splitSample(sample) {
    const { $clock, $tap, $size, ...values } = sample ?? {};
    const taps = $tap === undefined ? [] : Array.isArray($tap[0]) ? $tap : [$tap];
    return { values, clock: $clock, taps, size: $size };
}

/** touch_events for taps: apart, so an animation that a tap starts settles before the next. */
export function tapEvents(taps) {
    return taps.map(([x, y], i) => ({ t: 0.1 + i * 0.7, type: "tap", x, y }));
}

/** How long to run so the tap's ripple and any animation have ended in the picture. */
export const tapSettle = (taps) => 0.1 + taps.length * 0.7 + 1.5;

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
