// Maps for RemoteCompose documents: Natural Earth geography (assets/maps/maps.json, built by
// assets/maps/build.mjs) clipped to a region, simplified for a detail level and projected into
// a box 1000 units wide, as path op lists the component expander writes once per document.
//
// A region is "world" (no Antarctica), "world-full", a continent ("Europe", "Africa", "Asia",
// "North America", "South America", "Oceania"), a subregion ("Western Europe"...), a country
// (ISO A3 "FRA", ISO A2 "FR" or its name; its main landmass, not its overseas parts), or a
// [lonMin, latMin, lonMax, latMax] box. Layers: "land", "countries" (every country, one
// subpath per ring: fill it, or stroke it for borders), "lakes", "graticule" (every 30°/10°).
//
// Projection: equirectangular. The world is plate carrée (x ∝ lon, y ∝ lat); a region is
// scaled by cos(its middle latitude) in x, so a country keeps its shape. Both are linear in
// lon and lat, so a marker from host variables is a plain expression (point()).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAPS_FILE = process.env.RC_MAPS_FILE ?? path.join(HERE, "..", "..", "assets", "maps", "maps.json");
export const MAP_WIDTH = 1000;

let cache = null;
export function loadMaps() {
    if (cache) return cache;
    if (!existsSync(MAPS_FILE)) throw new Error(`maps data not found (${MAPS_FILE}): run node assets/maps/build.mjs`);
    const m = JSON.parse(readFileSync(MAPS_FILE, "utf8"));
    for (const set of [m.countries110, m.countries50]) for (const c of set) c.main = mainBox(c.rings);
    cache = m;
    return m;
}

// ---- regions -----------------------------------------------------------------------------

const area = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };
const boxOf = (rings) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of rings) for (const [x, y] of r) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    return [a, b, c, d];
};
/**
 * A country's main landmass: its largest ring and the islands chained to it across narrow
 * straits (Tasmania with Australia, Corsica with France, Java with Sumatra), not the far ones
 * (Alaska, Svalbard, Guiana, Macquarie Island).
 */
function mainBox(rings) {
    const big = rings.reduce((m, r) => (area(r) > area(m) ? r : m), rings[0]);
    let box = boxOf([big]);
    const gap = Math.min(250, Math.max(box[2] - box[0], box[3] - box[1]) * 0.08 + 60);   // lon/lat × 100
    const boxes = rings.map((r) => boxOf([r]));
    const inBox = new Set([rings.indexOf(big)]);
    for (let grew = true; grew;) {
        grew = false;
        boxes.forEach((b, i) => {
            if (inBox.has(i)) return;
            if (b[2] >= box[0] - gap && b[0] <= box[2] + gap && b[3] >= box[1] - gap && b[1] <= box[3] + gap) {
                inBox.add(i); box = [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])]; grew = true;
            }
        });
    }
    return box;
}

const CONTINENT_ALIASES = { "north america": "North America", "south america": "South America", europe: "Europe", africa: "Africa", asia: "Asia",
    oceania: "Oceania", australia: "Oceania", "latin america": "South America" };

/** The country records of a name (ISO A3, ISO A2 or name, any case), or null. */
export function findCountry(id, detail = "50") {
    const m = loadMaps();
    const s = String(id).trim().toLowerCase();
    const set = detail === "110" ? m.countries110 : m.countries50;
    return set.find((c) => c.iso3?.toLowerCase() === s || c.iso2?.toLowerCase() === s || c.name.toLowerCase() === s || c.long?.toLowerCase() === s) ?? null;
}

/** [lonMin, latMin, lonMax, latMax] in degrees, and a label, for a region spec. */
export function regionBox(region = "world") {
    if (Array.isArray(region)) {
        if (region.length === 4 && region.every(Number.isFinite)) return { box: region.map(Number), label: "box" };
        // [{"fit": [...]}]: WorldMap's fit, the frame (core) inside more geography (box).
        if (region.length === 1 && region[0] && typeof region[0] === "object" && !Array.isArray(region[0]) && Array.isArray(region[0].fit)) {
            const r0 = region[0];
            if (r0.frame) {
                // WorldMap fill: the region itself is the frame, with geography grown around it
                // (not for a world, which has none to add, nor under the night shade, drawn for
                // the world box).
                const inner = regionBox(r0.fit[0] ?? "world");
                const night = [true, 1, "true", "1"].includes(r0.night);
                if (night || inner.box[2] - inner.box[0] >= 300) return { ...inner, core: inner.box };
                return { box: fixBox(grownFrame(inner.box)), core: inner.box, label: inner.label, country: inner.country };
            }
            const f = fitBox(r0.fit, "fill");
            return { box: f.box, core: f.core, label: "fit" };
        }
        if (region.length && region.some((x) => typeof x !== "number")) return { box: fitBox(region).box, label: "fit" };
        throw new Error("map region box is [lonMin, latMin, lonMax, latMax], or a list of places to fit (countries, cities, [lon, lat], [from, to] routes)");
    }
    const s = String(region).trim().toLowerCase();
    if (s === "world") return { box: [-180, -58, 180, 84], label: "world" };
    if (s === "world-full") return { box: [-180, -90, 180, 90], label: "world" };
    const m = loadMaps();
    const cont = CONTINENT_ALIASES[s];
    // Continents by hand: their members' boxes reach Svalbard, the Aleutians or the Kerguelen.
    const CONT_BOX = { Europe: [-25, 34, 45, 71.5], Africa: [-19, -36, 53, 38.5], Asia: [25, -11, 150, 56], "North America": [-170, 7, -50, 75],
        "South America": [-83, -56, -33, 13.5], Oceania: [110, -48, 180, 0] };
    if (cont && CONT_BOX[cont]) return { box: CONT_BOX[cont], label: cont };
    const members = cont ? m.countries50.filter((c) => c.continent === cont)
        : m.countries50.filter((c) => String(c.subregion ?? "").toLowerCase() === s);
    if (members.length) {
        // Europe without Russia's far east: a continent's box is its members' main boxes,
        // Russia counted only west of the Urals for Europe.
        const boxes = members.map((c) => (c.iso3 === "RUS" && cont === "Europe" ? [2700, 4100, 6000, 7000] : c.main));
        const b = [Math.min(...boxes.map((x) => x[0])), Math.min(...boxes.map((x) => x[1])), Math.max(...boxes.map((x) => x[2])), Math.max(...boxes.map((x) => x[3]))];
        return { box: pad(b.map((v) => v / 100), 0.03), label: cont ?? members[0].subregion };
    }
    const c = findCountry(s);
    if (c) return { box: pad(c.main.map((v) => v / 100), 0.06), label: c.name, country: c };
    throw new Error(`no map region '${region}': use world, a continent (${Object.values(CONTINENT_ALIASES).filter((v, i, a) => a.indexOf(v) === i).join(", ")}), a country (ISO code or name) or [lonMin, latMin, lonMax, latMax]`);
}
/**
 * A box framing a list of places tightly: countries (their main landmass), continents or
 * subregions, cities, [lon, lat] points or "lon,lat", and [from, to] pairs of places (the great
 * circle between them, which bows towards the pole). Padded by 15% of the span on each side (at
 * least 1.5°, room for a marker and its label), then widened or heightened to between 1.25:1 and
 * 2.4:1 on the map, the shape of a card, so the frame shows more land rather than blank bands.
 */
const fitCache = new Map();
function fitBox(list, mode = "card") {
    const key = JSON.stringify([list, mode]);
    if (fitCache.has(key)) return structuredClone(fitCache.get(key));
    const pts = [];
    const one = (p) => {
        if (Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "string" || (v && typeof v === "object" && !Array.isArray(v)))) {
            const r = greatCircle(place(p[0], "fit"), place(p[1], "fit"), 24);
            r.forEach((q) => pts.push(q));
            return;
        }
        if (typeof p === "string" && !/^\s*-?[\d.]+\s*,\s*-?[\d.]+\s*$/.test(p)) {
            // A country, continent or subregion first ("Singapore" the country is the city), then a city.
            let b = null;
            try { const c = findCountry(p); if (c) b = c.main.map((v) => v / 100); else if (!findCity(p)) b = regionBox(p).box; } catch { b = null; }
            if (b) { pts.push([b[0], b[1]], [b[2], b[3]]); return; }
        }
        pts.push(place(p, "fit"));
    };
    for (const p of list) one(p);
    if (!pts.length) throw new Error("map fit: an empty list");
    // Longitudes continuous with the first place (a fit across the antimeridian: Tokyo and LA).
    const ref = pts[0][0];
    for (const q of pts) { while (q[0] - ref > 180) q[0] -= 360; while (q[0] - ref < -180) q[0] += 360; }
    let [a, b, c, d] = [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
    const kx = () => Math.cos(((b + d) / 2) * Math.PI / 180);
    // At least 3° each way (a lone city is a few hundred km across), then 15% padding.
    if (c - a < 3 / kx()) { const m = (a + c) / 2; a = m - 1.5 / kx(); c = m + 1.5 / kx(); }
    if (d - b < 3) { const m = (b + d) / 2; b = m - 1.5; d = m + 1.5; }
    const px = Math.max((c - a) * 0.15, 1.5 / kx()), py = Math.max((d - b) * 0.15, 1.5);
    a -= px; c += px; b -= py; d += py;
    const core = [a, b, c, d];
    const ratio = () => ((c - a) * kx()) / (d - b);
    if (mode === "card") {
        if (ratio() < 1.25) { const w = (1.25 * (d - b)) / kx(), m = (a + c) / 2; a = m - w / 2; c = m + w / 2; }
        else if (ratio() > 2.4) { const h = ((c - a) * kx()) / 2.4, m = (b + d) / 2; b = m - h / 2; d = m + h / 2; }
    } else [a, b, c, d] = grownFrame(core);
    const out = { box: fixBox([a, b, c, d]), core: fixBox(core) };
    fitCache.set(key, out);
    return structuredClone(out);
}
/**
 * Geography around a frame for any box from 0.9:1 to 2.6:1: the map fills the box it gets and
 * the frame stays the part that always shows (and some room under it for a legend).
 */
function grownFrame([a, b, c, d]) {
    const kx = Math.cos(((b + d) / 2) * Math.PI / 180);
    const w = (c - a) * kx, h = d - b;
    const W = Math.max(w, 2.6 * h) * 1.04, H = Math.max(h, w / 0.9) * 1.04 + h * 0.3;
    const mx = (a + c) / 2, my = (b + d) / 2;
    return [mx - W / kx / 2, my - H / 2, mx + W / kx / 2, my + H / 2];
}
// Inside the world: shifted, not cut, at the poles; the antimeridian is not crossed (a box past
// 180° is moved back; the outlines are not wrapped).
function fixBox([a, b, c, d]) {
    if (d > 85) { b -= d - 85; d = 85; } if (b < -85) { d += -85 - b; b = -85; }
    if (c > 180 && a > -180) { const s = Math.min(c - 180, a + 180); a -= s; c -= s; }
    if (a < -180 && c < 180) { const s = Math.min(-180 - a, 180 - c); a += s; c += s; }
    return [Math.max(-180, a), Math.max(-85, b), Math.min(180, c), Math.min(85, d)].map((v) => Math.round(v * 100) / 100);
}
function pad([a, b, c, d], f) {
    const w = c - a, h = d - b;
    return [Math.max(-180, a - w * f), Math.max(-90, b - h * f), Math.min(180, c + w * f), Math.min(90, d + h * f)];
}

// ---- projection ----------------------------------------------------------------------------

/** The projection of a region: lon/lat (degrees) to units in a MAP_WIDTH-wide box. */
export function projection(region = "world") {
    const { box, label, country, core } = regionBox(region);
    const [lon0, lat0, lon1, lat1] = box;
    const world = lon1 - lon0 >= 300;
    const kx = world ? 1 : Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
    const k = MAP_WIDTH / ((lon1 - lon0) * kx);
    const height = Math.round((lat1 - lat0) * k * 10) / 10;
    return {
        box, label, country, core, width: MAP_WIDTH, height, kx, k,
        x: (lon) => (lon - lon0) * kx * k,
        y: (lat) => (lat1 - lat) * k,
        /** The same, as expression strings over host values ("@lon"). */
        xExpr: (lon) => `(${lon} - (${+lon0.toFixed(4)})) * ${+(kx * k).toFixed(6)}`,
        yExpr: (lat) => `(${+lat1.toFixed(4)} - ${lat}) * ${+k.toFixed(6)}`,
    };
}

// ---- geometry ------------------------------------------------------------------------------

/** Sutherland–Hodgman: a ring clipped to a box (all in the same units). */
function clipRing(ring, [x0, y0, x1, y1]) {
    const edges = [
        (p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= y0, (p) => p[1] <= y1,
    ];
    const cut = [
        (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])],
        (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])],
        (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0],
        (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1],
    ];
    let out = ring;
    for (let e = 0; e < 4 && out.length; e++) {
        const inp = out; out = [];
        for (let i = 0; i < inp.length; i++) {
            const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
            const ci = edges[e](cur), pi = edges[e](prev);
            if (ci) { if (!pi) out.push(cut[e](prev, cur)); out.push(cur); }
            else if (pi) out.push(cut[e](prev, cur));
        }
    }
    return out;
}

/**
 * A closed ring cut by a box into the open lines inside it (Liang–Barsky per segment); one line
 * marked closed when the ring is wholly inside.
 */
function clipLines(ring, [x0, y0, x1, y1]) {
    const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
    if (ring.every(inside)) return [Object.assign(ring.slice(), { closed: true })];
    const lines = [];
    let cur = null;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        let t0 = 0, t1 = 1, ok = true;
        for (const [pp, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
            if (pp === 0) { if (q < 0) { ok = false; break; } continue; }
            const t = q / pp;
            if (pp < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; }
            else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
        }
        if (!ok) { if (cur) { lines.push(cur); cur = null; } continue; }
        const p0 = [a[0] + dx * t0, a[1] + dy * t0], p1 = [a[0] + dx * t1, a[1] + dy * t1];
        if (!cur) cur = [p0];
        cur.push(p1);
        if (t1 < 1) { lines.push(cur); cur = null; }
    }
    if (cur) {
        // The ring's last run continues into its first.
        if (lines.length && inside(ring[0])) { const first = lines.shift(); cur.push(...first.slice(1)); }
        lines.push(cur);
    }
    return lines;
}

/** Douglas–Peucker on an open line. */
function simplifyOpen(line, tol) {
    if (line.length <= 2 || tol <= 0) return line;
    const keep = new Uint8Array(line.length); keep[0] = keep[line.length - 1] = 1;
    const st = [[0, line.length - 1]], t2 = tol * tol;
    while (st.length) {
        const [a, b] = st.pop(); if (b - a < 2) continue;
        const A = line[a], B = line[b], dx = B[0] - A[0], dy = B[1] - A[1], L = dx * dx + dy * dy;
        let idx = -1, md = t2;
        for (let i = a + 1; i < b; i++) {
            const P = line[i];
            const d = L === 0 ? (P[0] - A[0]) ** 2 + (P[1] - A[1]) ** 2 : ((P[0] - A[0]) * dy - (P[1] - A[1]) * dx) ** 2 / L;
            if (d > md) { md = d; idx = i; }
        }
        if (idx >= 0) { keep[idx] = 1; st.push([a, idx], [idx, b]); }
    }
    return line.filter((_, i) => keep[i]);
}

/** Douglas–Peucker on a closed ring. */
function simplify(ring, tol) {
    if (ring.length <= 4 || tol <= 0) return ring;
    const keep = new Uint8Array(ring.length);
    keep[0] = 1;
    // The farthest point from the first splits the ring in two open chains.
    let far = 0, fd = -1;
    for (let i = 1; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > fd) { fd = d; far = i; } }
    keep[far] = 1;
    const stack = [[0, far], [far, ring.length]];
    const at = (i) => ring[i % ring.length];
    const t2 = tol * tol;
    while (stack.length) {
        const [a, b] = stack.pop();
        if (b - a < 2) continue;
        const A = at(a), B = at(b);
        const dx = B[0] - A[0], dy = B[1] - A[1], L = dx * dx + dy * dy;
        let idx = -1, md = t2;
        for (let i = a + 1; i < b; i++) {
            const P = ring[i];
            let d;
            if (L === 0) d = (P[0] - A[0]) ** 2 + (P[1] - A[1]) ** 2;
            else { const c = ((P[0] - A[0]) * dy - (P[1] - A[1]) * dx); d = (c * c) / L; }
            if (d > md) { md = d; idx = i; }
        }
        if (idx >= 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return ring.filter((_, i) => keep[i]);
}

const DETAIL = { low: 0.006, medium: 0.0025, high: 0.001 };   // tolerance as a fraction of the width

/**
 * The rings of a layer for a region, projected, clipped, simplified: [[[x, y], ...], ...].
 * opts: {layer: land|countries|lakes|graticule, detail: low|medium|high, countries: [ids] (only
 * these, for a highlight), exclude: [ids]}.
 */
export function mapRings(region = "world", { layer = "land", detail = "medium", countries, exclude, outline = false, dot = 0 } = {}) {
    const P = projection(region);
    // dot: a listed country too small to have an outline at this detail (Monaco, Malta) is a
    // disc of that radius at its centre instead of nothing.
    if (dot > 0 && layer === "countries" && countries?.length) {
        return countries.flatMap((id) => {
            const r = mapRings(region, { layer, detail, countries: [id], exclude, outline });
            if (r.length) return r;
            const c = findCountry(id, P.box[2] - P.box[0] >= 90 ? "110" : "50") ?? findCountry(id);
            if (!c) return [];
            const cx = P.x((c.main[0] + c.main[2]) / 200), cy = P.y((c.main[1] + c.main[3]) / 200);
            return [Array.from({ length: 12 }, (_, k) => [cx + dot * Math.cos(k * Math.PI / 6), cy + dot * Math.sin(k * Math.PI / 6)])];
        });
    }
    const m = loadMaps();
    // A frame inside more geography (WorldMap fit or fill) is drawn at the frame's detail: its
    // data set and tolerance follow the frame's width, not the whole box's.
    const span = P.core ? P.core[2] - P.core[0] : P.box[2] - P.box[0];
    const wide = span >= 90;
    const tolBox = MAP_WIDTH * (DETAIL[detail] ?? DETAIL.medium);
    const tolCore = tolBox * (P.core ? Math.min(1, span / (P.box[2] - P.box[0])) : 1);
    // Outlines are cut well outside the box: the cut edges must not show as coastline (the
    // component clips its canvas to the box).
    const mx = P.width * 0.08, my = P.height * 0.08;
    const clipBox = [-mx, -my, P.width + mx, P.height + my];
    const project = (r) => r.map(([lon, lat]) => [P.x(lon / 100), P.y(lat / 100)]);
    let rings;
    if (layer === "graticule") return graticule(P);
    if (layer === "hatch" || layer === "hatch-cross") {
        // Only where it is drawn: over the listed countries (their projected box), or the box.
        let rects = [[0, 0, P.width, P.height]];
        if (countries?.length) {
            const rs = mapRings(region, { layer: "countries", detail, countries, dot: dot || 5 });
            if (rs.length) { const b = boxOf(rs); rects = [[Math.max(0, b[0]), Math.max(0, b[1]), Math.min(P.width, b[2]), Math.min(P.height, b[3])]]; }
        }
        return hatch(rects, layer === "hatch-cross");
    }
    if (layer === "states") {
        // States and provinces (16 countries: the largest from 1:50m, more from 1:10m), the ones
        // in the box; `countries` limits them to those countries (ISO A3), or to named states.
        const ids = (countries ?? []).map((x) => String(x).toLowerCase());
        rings = (m.states ?? []).filter((st) => !ids.length || ids.some((s) => [st.country, st.name, st.code, st.postal].some((v) => String(v ?? "").toLowerCase() === s)))
            .flatMap((st) => st.rings);
        if (!rings.length) throw new Error(`map: no states for ${ids.join(", ") || "this region"} (states exist for ${[...new Set((m.states ?? []).map((x) => x.country))].join(", ")})`);
    } else
    if (layer === "land") rings = wide ? m.land110 : m.land50;
    else if (layer === "lakes") rings = m.lakes110;
    else if (layer === "countries") {
        let set = wide ? m.countries110 : m.countries50;
        const ids = (v) => (v ?? []).map((x) => String(x).toLowerCase());
        const only = ids(countries), not = ids(exclude);
        const match = (c, list) => list.some((s) => [c.iso3, c.iso2, c.name, c.long].some((v) => String(v ?? "").toLowerCase() === s));
        if (only.length) {
            set = set.filter((c) => match(c, only));
            const missing = only.filter((s) => !set.some((c) => match(c, [s])));
            if (missing.length) throw new Error(`map: no country ${missing.join(", ")} (ISO A3, ISO A2 or name)`);
        }
        if (not.length) set = set.filter((c) => !match(c, not));
        rings = set.flatMap((c) => c.rings);
    } else throw new Error(`map layer '${layer}': land, countries, states, lakes, graticule, hatch or hatch-cross`);
    const out = [];
    for (const r of rings) {
        // Skip rings wholly outside before projecting the whole of them.
        const bb = boxOf([r]);
        if (bb[2] / 100 < P.box[0] || bb[0] / 100 > P.box[2] || bb[3] / 100 < P.box[1] || bb[1] / 100 > P.box[3]) continue;
        // The frame's detail for what reaches into the frame, the box's for the land around it.
        const c = P.core;
        const tol = c && (bb[2] / 100 < c[0] || bb[0] / 100 > c[2] || bb[3] / 100 < c[1] || bb[1] / 100 > c[3]) ? tolBox : tolCore;
        if (outline) {
            // For a stroke: the coast only, as open lines where the ring leaves the box (a
            // clipped ring's straight cut edges would draw as stray lines).
            const proj = project(r);
            const lines = clipLines(proj, clipBox);
            if (lines.length === 1 && lines[0].closed) { const ring = simplify(lines[0], tol); if (ring.length >= 3 && area(ring) >= tol * tol * 2) out.push(ring); continue; }
            for (const l of lines) { const sl = simplifyOpen(l, tol); if (sl.length >= 2) out.push(Object.assign(sl, { open: true })); }
            continue;
        }
        let pr = clipRing(project(r), clipBox);
        if (pr.length < 3) continue;
        pr = simplify(pr, tol);
        // Specks smaller than the detail are not drawn (islands a few units across).
        if (pr.length < 3 || area(pr) < tol * tol * 2) continue;
        out.push(pr);
    }
    return out;
}

function graticule(P) {
    const lines = [];
    const step = P.box[2] - P.box[0] >= 90 ? 30 : 10;
    for (let lon = Math.ceil(P.box[0] / step) * step; lon <= P.box[2]; lon += step) lines.push([[P.x(lon), 0], [P.x(lon), P.height]]);
    for (let lat = Math.ceil(P.box[1] / step) * step; lat <= P.box[3]; lat += step) lines.push([[0, P.y(lat)], [P.width, P.y(lat)]]);
    return lines.map((l) => Object.assign(l, { open: true }));
}

/**
 * Hatching for a 1-bit fill: parallel lines 18 units apart at 45° ("/", or "\\" for the cross),
 * cut to each rectangle, to draw through a clipPath. WorldMap's mono legend draws the same
 * 18-unit grid with loops.
 */
function hatch(rects, cross) {
    const gap = 18, lines = [];
    for (const [x0, y0, x1, y1] of rects) {
        // "/": x + y = c; "\\": x - y = c.
        const lo = cross ? x0 - y1 : x0 + y0, hi = cross ? x1 - y0 : x1 + y1;
        for (let c = Math.ceil(lo / gap) * gap + gap / 2; c < hi; c += gap) {
            // The segment of the line inside the rectangle.
            const at = (y) => (cross ? c + y : c - y);
            let ya = y0, yb = y1;
            const xa = at(ya), xb = at(yb);
            const clampY = (x) => (cross ? x - c : c - x);
            if (xa < x0 || xa > x1) ya = clampY(xa < x0 ? x0 : x1);
            if (xb < x0 || xb > x1) yb = clampY(xb < x0 ? x0 : x1);
            if (yb - ya > 0.5) lines.push([[at(ya), ya], [at(yb), yb]]);
        }
    }
    return lines.map((l) => Object.assign(l, { open: true }));
}

/** Rings as a RemoteCompose path op list (moveTo/lineTo/close), coordinates to 0.1 unit. */
export function ringsToPath(rings) {
    const r1 = (v) => Math.round(v * 10) / 10;
    const ops = [];
    for (const r of rings) {
        ops.push({ type: "moveTo", x: r1(r[0][0]), y: r1(r[0][1]) });
        for (let i = 1; i < r.length; i++) ops.push({ type: "lineTo", x: r1(r[i][0]), y: r1(r[i][1]) });
        if (!r.open) ops.push({ type: "close" });
    }
    return ops;
}

/** A city's [lon, lat] by name ("Tokyo", "New York"), or null. */
export function findCity(name) {
    const s = String(name).trim().toLowerCase();
    const c = loadMaps().cities.find((x) => x.name.toLowerCase() === s);
    return c ? [c.lon, c.lat] : null;
}

/**
 * A point on the map: [x, y] numbers for literal lon/lat or a city name, or expression strings
 * for host values ({"lon": "@lon", "lat": "@lat"}).
 */
export function mapPoint(region, at) {
    if (at && typeof at === "object" && !Array.isArray(at)) {
        if (at.core !== undefined) return fitFrame(region, at.core);
        if (at.labels !== undefined) return fitLabel(region, at);
        if (at.legs !== undefined) return legLabel(region, at);
        if (at.from !== undefined && at.to !== undefined) {
            // A point a fraction t (default 0.5) of the way along the great circle.
            const t = Math.max(0, Math.min(1, Number(at.t ?? 0.5)));
            const gc = greatCircle(place(at.from, "from"), place(at.to, "to"), 100);
            at = gc[Math.round(t * 100)];
        }
    }
    const P = projection(region);
    let lon, lat;
    if (typeof at === "string" && /^\s*-?[\d.]+\s*,\s*-?[\d.]+\s*$/.test(at)) [lon, lat] = at.split(",").map(Number);
    else if (typeof at === "string") { const c = findCity(at); if (!c) throw new Error(`map: no city '${at}' (Natural Earth's 1,250 places: capitals, state capitals and large cities; give [lon, lat] otherwise)`); [lon, lat] = c; }
    else if (Array.isArray(at)) [lon, lat] = at;
    else ({ lon, lat } = at ?? {});
    const num = (v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
    if (num(lon) && num(lat)) return [Math.round(P.x(+lon) * 10) / 10, Math.round(P.y(+lat) * 10) / 10];
    return [P.xExpr(lon), P.yExpr(lat)];
}

// ---- routes --------------------------------------------------------------------------------

const place = (p, what) => {
    if (Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(+v))) return p.map(Number);
    if (p && typeof p === "object" && Number.isFinite(+p.lon) && Number.isFinite(+p.lat)) return [+p.lon, +p.lat];
    const m = typeof p === "string" ? /^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/.exec(p) : null;
    if (m) return [+m[1], +m[2]];
    const c = typeof p === "string" ? findCity(p) : null;
    if (!c) throw new Error(`map route ${what}: '${JSON.stringify(p)}' is neither a city (Natural Earth's 1,250 places) nor [lon, lat]`);
    return c;
};

/** n + 1 [lon, lat] points along the great circle from A to B, evenly spaced by distance, lon continuous. */
function greatCircle([lon1, lat1], [lon2, lat2], n) {
    const r = Math.PI / 180;
    const v = (lon, lat) => [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)];
    const A = v(lon1, lat1), B = v(lon2, lat2);
    const d = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
    const out = [];
    let prevLon = lon1;
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const f = d < 1e-9 ? 1 - t : Math.sin((1 - t) * d) / Math.sin(d), g = d < 1e-9 ? t : Math.sin(t * d) / Math.sin(d);
        const p = [0, 1, 2].map((k) => f * A[k] + g * B[k]);
        let lon = Math.atan2(p[1], p[0]) / r;
        const lat = Math.atan2(p[2], Math.hypot(p[0], p[1])) / r;
        // Continuous across the antimeridian (the region's box decides what shows).
        while (lon - prevLon > 180) lon -= 360;
        while (lon - prevLon < -180) lon += 360;
        prevLon = lon;
        out.push([lon, lat]);
    }
    out.km = Math.round(d * 6371);
    return out;
}

/**
 * A great-circle route from one place to another (a city name or [lon, lat]), sampled at n + 1
 * points evenly spaced by distance and projected into the region's box: {x, y, angle (degrees,
 * the heading on the map, 0 = east, 90 = down), km}. arraySpline(x, t) is the point at the
 * fraction t of the distance.
 */
export function mapRoute(region, from, to, n = 48) {
    const P = projection(region);
    const r = Math.PI / 180;
    const gc = greatCircle(place(from, "from"), place(to, "to"), n);
    const xs = gc.map(([lon]) => Math.round(P.x(lon) * 10) / 10), ys = gc.map(([, lat]) => Math.round(P.y(lat) * 10) / 10);
    const angle = xs.map((_, i) => {
        const a = Math.max(0, i - 1), b = Math.min(n, i + 1);
        return Math.round(Math.atan2(ys[b] - ys[a], xs[b] - xs[a]) / r * 10) / 10;
    });
    // Unwrapped, so a spline between two samples never swings the long way round.
    for (let i = 1; i < angle.length; i++) { while (angle[i] - angle[i - 1] > 180) angle[i] -= 360; while (angle[i] - angle[i - 1] < -180) angle[i] += 360; }
    return { x: xs, y: ys, angle, km: gc.km };
}

/**
 * What a region holds, for a map that colours or lists its countries: the box, the height for
 * width 1000, the countries in it (ISO A3 and name, in alphabetical order, with whether their
 * outline survives at each detail level), the countries with state borders, the cities.
 */
export function mapInfo(region = "world", { detail = "low" } = {}) {
    const P = projection(region);
    const m = loadMaps();
    const wide = P.box[2] - P.box[0] >= 90;
    const [lon0, lat0, lon1, lat1] = P.box;
    const hit = (b) => b[2] / 100 >= lon0 && b[0] / 100 <= lon1 && b[3] / 100 >= lat0 && b[1] / 100 <= lat1;
    // In the box: one of its rings is (Russia's whole bbox spans the world, its rings do not).
    const touches = (c) => hit(c.bbox) && c.rings.some((r) => { let a = Infinity, b = Infinity, cc = -Infinity, d = -Infinity; for (const [x, y] of r) { if (x < a) a = x; if (y < b) b = y; if (x > cc) cc = x; if (y > d) d = y; } return hit([a, b, cc, d]); });
    const set = (wide ? m.countries110 : m.countries50).filter(touches);
    // A continent's countries are its members (Russia in Europe, Turkey not); otherwise those whose
    // main landmass is centred in the box.
    const cont = CONTINENT_ALIASES[String(region).trim().toLowerCase()];
    const centred = (c) => { const [a, b, cc, d] = c.main.map((v) => v / 100); const x = (a + cc) / 2, y = (b + d) / 2; return x >= lon0 && x <= lon1 && y >= lat0 && y <= lat1; };
    const member = (c) => (cont ? c.continent === cont : centred(c));
    const all = (cont ? (wide ? m.countries110 : m.countries50).filter((c) => c.continent === cont) : set.filter(member));
    const info = (c) => {
        const at = (lvl) => { try { return mapRings(region, { layer: "countries", detail: lvl, countries: [c.iso3] }).length > 0; } catch { return false; } };
        return { iso3: c.iso3, name: c.name, ...(at(detail) ? {} : { tooSmall: `no outline at detail ${detail}: WorldMap values draws it as a dot` }) };
    };
    const byName = (a, b) => a.name.localeCompare(b.name);
    const states = all.filter((c) => !/dependency|disputed|indeterminate/i.test(c.type ?? "")).map(info).sort(byName);
    const territories = all.filter((c) => /dependency|disputed|indeterminate/i.test(c.type ?? "")).map((c) => ({ ...info(c), type: c.type })).sort(byName);
    const edge = set.filter((c) => !all.includes(c)).map((c) => `${c.iso3} ${c.name}`);
    const statesFor = [...new Set((m.states ?? []).filter((s) => hit(s.bbox)).map((s) => s.country))];
    const inBox = m.cities.filter((c) => c.lon >= lon0 && c.lon <= lon1 && c.lat >= lat0 && c.lat <= lat1);
    const span = (P.box[2] - P.box[0]) * 111 * Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
    const step = Math.max(span * (DETAIL[detail] ?? DETAIL.low), wide ? 50 : 8);
    return {
        region: P.label, box: P.box.map((v) => +v.toFixed(2)), width: P.width, height: P.height, data: wide ? "1:110m (world-scale detail)" : "1:50m",
        coarseness: `outlines are accurate to about ${step < 10 ? Math.round(step) : Math.round(step / 5) * 5} km (the box is ${Math.round(span)} km across)` +
            (span < 400 ? ": a box this small shows coastlines as a few straight lines and no streets or rivers; for a city or a neighbourhood draw a schematic instead of a map" : ""),
        countries: states, ...(territories.length ? { territories } : {}),
        order: `${states.length} countries${territories.length ? ` (and ${territories.length} territories)` : ""}, alphabetical by name: the order to use for WorldMap valueCountries when nothing else fixes one`,
        ...(edge.length ? { partlyIn: edge } : {}), statesFor,
        capitals: inBox.filter((c) => c.capital).map((c) => c.name).slice(0, 60),
        stateCapitals: inBox.filter((c) => c.stateCapital).map((c) => c.name).slice(0, 60),
        largestCities: inBox.filter((c) => !c.capital).map((c) => c.name).slice(0, 25),
    };
}

// ---- route labels --------------------------------------------------------------------------

const legParts = (leg, i) => {
    const [from, to, label] = Array.isArray(leg) ? leg : [leg?.from, leg?.to, leg?.label];
    if (from === undefined || to === undefined) throw new Error(`map legs[${i}]: give {from, to, label?} or [from, to, label?]`);
    return { from, to, label };
};
const groupKm = (km) => String(km).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Where each leg's label goes, all legs at once so they keep apart: a point on its arc (at a
 * fraction 0.18..0.82 of the way, the middle preferred) or just beside it, chosen so the label
 * box misses the other labels, the leg ends (their dots and a city name to the right, or the
 * left past x 800, as WorldMap labels draws them) and the other arcs, and stays in the box.
 * Label boxes are estimated from the text (the label, or "5,493 km" with distance) at size dp
 * and a map width of `width` dp (300, a phone card) in a canvas `height` dp tall; a larger map
 * only spreads them further. at: {legs, leg (index), size, height, width, distance}.
 */
const labelCache = new Map();
function legLabel(region, at) {
    const legs = [].concat(at.legs ?? []).map(legParts);
    const size = Number(at.size ?? 11), height = Number(at.height ?? 160), width = Number(at.width ?? 300);
    const distance = [true, 1, "true", "1"].includes(at.distance);
    const key = JSON.stringify([region, legs, size, height, width, distance]);
    let placed = labelCache.get(key);
    if (!placed) { placed = placeLegLabels(region, legs, { size, height, width, distance }); labelCache.set(key, placed); }
    const i = Math.round(Number(at.leg ?? 0));
    if (!placed[i]) throw new Error(`map legs: no leg ${i} (${legs.length} legs)`);
    return placed[i];
}

function placeLegLabels(region, legs, { size, height, width, distance }) {
    const P = projection(region);
    const s = Math.min(width / 1000, height / P.height);
    const cw = size * 0.56 / s, lh = size * 1.25 / s;   // a character's width, a line's height (map units)
    const routes = legs.map((l) => mapRoute(region, l.from, l.to, 48));
    const texts = legs.map((l, i) => (l.label !== undefined && l.label !== null && l.label !== "" ? String(l.label) : distance ? `${groupKm(routes[i].km)} km` : ""));
    const boxOfText = (x, y, n) => [x - (n * cw) / 2 - 3 / s, y - lh / 2, x + (n * cw) / 2 + 3 / s, y + lh / 2];
    const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const areaOf = (b) => (b[2] - b[0]) * (b[3] - b[1]);
    // Obstacles: the ends' dots and city names.
    const ends = [], names = [];
    const seen = new Set();
    for (const l of legs) for (const p of [l.from, l.to]) {
        const k = JSON.stringify(p); if (seen.has(k)) continue; seen.add(k);
        const [x, y] = mapPoint(region, p);
        ends.push([x - 5 / s, y - 5 / s, x + 5 / s, y + 5 / s]);
        if (typeof p === "string") {
            const w = p.length * cw, x0 = x > 800 ? x - w - 5 / s : x + 5 / s;
            names.push([x0, y - lh / 2, x0 + w, y + lh / 2]);
        }
    }
    const cands = (i) => {
        const r = routes[i], out = [];
        for (let t = 0.15; t < 0.86; t += 0.05) {
            const k = Math.round(t * 48), a = Math.max(0, k - 1), b = Math.min(48, k + 1);
            const dx = r.x[b] - r.x[a], dy = r.y[b] - r.y[a], L = Math.hypot(dx, dy) || 1;
            for (const nOff of [0, -0.75, 0.75, -1.5, 1.5]) {
                // Beside the arc: a line's height off it, on the normal.
                const off = nOff * lh * 0.95;
                out.push({ x: r.x[k] + (-dy / L) * off, y: r.y[k] + (dx / L) * off, t, nOff });
            }
        }
        return out;
    };
    const pos = legs.map(() => null);
    const score = (i, c) => {
        if (!texts[i]) return 0;
        const bx = boxOfText(c.x, c.y, texts[i].length), A = areaOf(bx);
        let sc = Math.abs(c.t - 0.5) * 4 + Math.abs(c.nOff) * 1.2;
        pos.forEach((p, j) => { if (p && j !== i && texts[j]) sc += 60 * inter(bx, boxOfText(p.x, p.y, texts[j].length)) / A; });
        for (const e of ends) sc += 30 * inter(bx, e) / A;
        for (const n of names) sc += 20 * inter(bx, n) / A;
        // Another leg's arc through the label (its samples are ~1/48 of the leg apart).
        routes.forEach((r, j) => { if (j === i) return; for (let k = 0; k < r.x.length; k++) if (r.x[k] > bx[0] && r.x[k] < bx[2] && r.y[k] > bx[1] && r.y[k] < bx[3]) sc += 1.5; });
        const inside = inter(bx, [0, 0, P.width, P.height]) / A;
        sc += (1 - inside) * 40;
        return sc;
    };
    for (let pass = 0; pass < 3; pass++) {
        legs.forEach((_, i) => {
            let best = null, bs = Infinity;
            for (const c of cands(i)) { const sc = score(i, c); if (sc < bs - 1e-9) { bs = sc; best = c; } }
            pos[i] = best;
        });
    }
    return pos.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
}

// ---- labels of a fitted map (WorldMap fit) --------------------------------------------------

// The frame is shown at least this big at the design size: its text is placed for that, and
// scales with the map between TEXT_MIN and TEXT_MAX of the label size.
const REF_W = 300, REF_H = 190, TEXT_MIN = 0.8, TEXT_MAX = 1.8;

/** The fit frame in map units: core 0 its top-left [x, y], 1 its bottom-right, "ref" [s, s] the design scale. */
function fitFrame(region, which) {
    const P = projection(region);
    const c = P.core ?? [P.box[0], P.box[1], P.box[2], P.box[3]];
    const x0 = P.x(c[0]), x1 = P.x(c[2]), y0 = P.y(c[3]), y1 = P.y(c[1]);
    const r = (v) => Math.round(v * 10) / 10;
    if (which === "ref") { const sr = Math.min(REF_W / (x1 - x0), REF_H / (y1 - y0)); return [+sr.toPrecision(4), +sr.toPrecision(4)]; }
    return Number(which) === 1 ? [r(x1), r(y1)] : [r(x0), r(y0)];
}

/**
 * One label of a fitted map: at {labels: {cities, legs, size, distance, marker}, city | leg: i,
 * part}. part: none [x, y] the anchor, "pan" [panX, panY], "min" [s, s] the map scale at or below
 * which it is hidden (0: always shown).
 */
const fitCache2 = new Map();
function fitLabel(region, at) {
    const L = at.labels ?? {};
    const key = JSON.stringify([region, L]);
    let lay = fitCache2.get(key);
    if (!lay) { lay = layoutFit(region, L); fitCache2.set(key, lay); }
    const list = at.city !== undefined ? lay.cities : lay.legs;
    const i = Math.round(Number(at.city ?? at.leg ?? 0));
    const e = list[i];
    if (!e) throw new Error(`map labels: no ${at.city !== undefined ? "city" : "leg"} ${i}`);
    if (at.part === "pan") return [e.panX, e.panY];
    if (at.part === "min") return [e.min, e.min];
    // k: the text's size in map units over its size at the design scale (an expression): the
    // offset from the dot or the arc grows and shrinks with the text.
    if (at.k !== undefined && (e.ox || e.oy)) {
        const k = typeof at.k === "number" ? at.k : `(${at.k})`;
        return [e.ox ? `${e.bx} + ${e.ox} * ${k}` : e.bx, e.oy ? `${e.by} + ${e.oy} * ${k}` : e.by];
    }
    return [e.x, e.y];
}

/**
 * City names and leg labels laid out together at the design scale (the frame REF_W x REF_H dp),
 * in priority order: the cities as listed, then the legs. A city name goes right, left, above or
 * below its dot; a leg label on its arc or beside it, 0.15..0.85 of the way. Text is a fixed size
 * in map units from TEXT_MIN to TEXT_MAX of the design scale, so the layout holds there; below,
 * text is larger than the map and each label gets the scale under which it would touch a label
 * of higher priority (or a dot): it is hidden there, not drawn over.
 */
function layoutFit(region, L) {
    const P = projection(region);
    const [cx0, cy0] = fitFrame(region, 0), [cx1, cy1] = fitFrame(region, 1);
    const sref = fitFrame(region, "ref")[0];
    const size = Number(L.size ?? 11), marker = Number(L.marker ?? 3);
    const distance = [true, 1, "true", "1"].includes(L.distance);
    const cities = [].concat(L.cities ?? []);
    const legs = [].concat(L.legs ?? []).map(legParts);
    const routes = legs.map((l) => mapRoute(region, l.from, l.to, 48));
    const legText = legs.map((l, i) => (l.label !== undefined && l.label !== null && l.label !== "" ? String(l.label) : distance ? `${groupKm(routes[i].km)} km` : ""));
    // Text height in map units at scale s.
    const tmap = (s) => Math.min(size * TEXT_MAX, Math.max(size * TEXT_MIN, size * s / sref)) / s;
    const dotR = (s) => (marker + 1.5) / s;
    const W = (n, s) => n * 0.56 * tmap(s) + 4 / s;   // a text's width with its halo
    const H = (s) => tmap(s) * 1.2;
    // A label's box from its anchor and pan at scale s: the anchor is a base point (the dot, a
    // point of the arc) and an offset that scales with the text.
    const box = (l, s) => {
        const w = W(l.n, s), h = H(s), f = tmap(s) / tmap(sref);
        const x = l.bx + l.ox * f, y = l.by + l.oy * f;
        const left = l.panX < 0 ? x : l.panX > 0 ? x - w : x - w / 2;
        const top = l.panY < 0 ? y - h : l.panY > 0 ? y : y - h / 2;
        return [left, top, left + w, top + h];
    };
    const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const areaOf = (b) => (b[2] - b[0]) * (b[3] - b[1]);
    const dots = [];
    const addDot = (p) => { const [x, y] = mapPoint(region, p); if (!dots.some((d) => Math.abs(d[0] - x) < 0.5 && Math.abs(d[1] - y) < 0.5)) dots.push([x, y]); };
    cities.forEach(addDot); legs.forEach((l) => { addDot(l.from); addDot(l.to); });
    const dotBox = (d, s) => [d[0] - dotR(s), d[1] - dotR(s), d[0] + dotR(s), d[1] + dotR(s)];
    const placed = [];
    const conflict = (b, s, self, upTo) => {
        let c = 0; const A = areaOf(b);
        for (const q of placed.slice(0, upTo)) if (q !== self && q.n && (q.min ?? 0) < s) c += inter(b, box(q, s)) / A;
        for (const d of dots) if (!self.dot || Math.abs(d[0] - self.dot[0]) > 0.5 || Math.abs(d[1] - self.dot[1]) > 0.5) c += inter(b, dotBox(d, s)) / A;
        return c;
    };
    const frame = [cx0, cy0, cx1, cy1];
    const score = (l, extra) => {
        const b = box(l, sref), A = areaOf(b);
        let sc = extra + 50 * conflict(b, sref, l, placed.length);
        sc += 30 * (1 - inter(b, frame) / A);
        routes.forEach((r, j) => { if (j === l.leg) return; for (let k = 0; k < r.x.length; k++) if (r.x[k] > b[0] && r.x[k] < b[2] && r.y[k] > b[1] && r.y[k] < b[3]) sc += 1.5; });
        return sc;
    };
    const s0 = sref, g = dotR(s0) + 1 / s0;
    for (const c of cities) {
        const [x, y] = mapPoint(region, c), n = L.names === false ? 0 : String(c).length;
        const cands = [
            { ox: g, oy: 0, panX: -1, panY: 0, pen: 0 }, { ox: -g, oy: 0, panX: 1, panY: 0, pen: 0.6 },
            { ox: 0, oy: -g, panX: 0, panY: -1, pen: 0.9 }, { ox: 0, oy: g, panX: 0, panY: 1, pen: 1 },
        ].map((k) => ({ ...k, bx: x, by: y }));
        let best = null, bs = Infinity;
        for (const k of cands) { const l = { ...k, n, dot: [x, y] }; const sc = score(l, k.pen); if (sc < bs) { bs = sc; best = l; } }
        best.kind = "city"; placed.push(best);
    }
    legs.forEach((_, i) => {
        const r = routes[i], n = legText[i].length;
        if (!n) { placed.push({ kind: "leg", leg: i, bx: r.x[24], by: r.y[24], ox: 0, oy: 0, panX: 0, panY: 0, n: 0 }); return; }
        let best = null, bs = Infinity;
        for (let t = 0.15; t < 0.86; t += 0.05) {
            const k = Math.round(t * 48), a = Math.max(0, k - 1), b = Math.min(48, k + 1);
            const dx = r.x[b] - r.x[a], dy = r.y[b] - r.y[a], Ln = Math.hypot(dx, dy) || 1;
            for (const nOff of [0, -0.75, 0.75, -1.5, 1.5]) {
                const off = nOff * H(s0) * 0.95;
                const l = { kind: "leg", leg: i, bx: r.x[k], by: r.y[k], ox: (-dy / Ln) * off, oy: (dx / Ln) * off, panX: 0, panY: 0, n };
                const sc = score(l, Math.abs(t - 0.5) * 4 + Math.abs(nOff) * 1.2);
                if (sc < bs) { bs = sc; best = l; }
            }
        }
        placed.push(best);
    });
    // Thresholds, in priority order: the largest scale on a fine grid where the label touches a
    // shown label of higher priority or a dot.
    const grid = []; for (let s = sref * 4; s > sref * 0.1; s /= 1.03) grid.push(s);
    placed.forEach((l, i) => {
        l.min = 0;
        if (!l.n) return;
        for (const s of grid) {
            const b = box(l, s);
            if (conflict(b, s, l, i) > 0.06) { l.min = +s.toPrecision(4); break; }
        }
    });
    const r1 = (v) => Math.round(v * 10) / 10;
    const out = (l) => ({ x: r1(l.bx + l.ox), y: r1(l.by + l.oy), bx: r1(l.bx), by: r1(l.by), ox: r1(l.ox), oy: r1(l.oy), panX: l.panX, panY: l.panY, min: l.min });
    return { cities: placed.filter((l) => l.kind === "city").map(out), legs: placed.filter((l) => l.kind === "leg").map(out) };
}
