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
        if (region.length !== 4 || !region.every(Number.isFinite)) throw new Error("map region box is [lonMin, latMin, lonMax, latMax]");
        return { box: region.map(Number), label: "box" };
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
function pad([a, b, c, d], f) {
    const w = c - a, h = d - b;
    return [Math.max(-180, a - w * f), Math.max(-90, b - h * f), Math.min(180, c + w * f), Math.min(90, d + h * f)];
}

// ---- projection ----------------------------------------------------------------------------

/** The projection of a region: lon/lat (degrees) to units in a MAP_WIDTH-wide box. */
export function projection(region = "world") {
    const { box, label, country } = regionBox(region);
    const [lon0, lat0, lon1, lat1] = box;
    const world = lon1 - lon0 >= 300;
    const kx = world ? 1 : Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
    const k = MAP_WIDTH / ((lon1 - lon0) * kx);
    const height = Math.round((lat1 - lat0) * k * 10) / 10;
    return {
        box, label, country, width: MAP_WIDTH, height, kx, k,
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
    const wide = P.box[2] - P.box[0] >= 90;
    const tol = MAP_WIDTH * (DETAIL[detail] ?? DETAIL.medium);
    // Outlines are cut well outside the box: the cut edges must not show as coastline (the
    // component clips its canvas to the box).
    const mx = P.width * 0.08, my = P.height * 0.08;
    const clipBox = [-mx, -my, P.width + mx, P.height + my];
    const project = (r) => r.map(([lon, lat]) => [P.x(lon / 100), P.y(lat / 100)]);
    let rings;
    if (layer === "graticule") return graticule(P);
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
    } else throw new Error(`map layer '${layer}': land, countries, states, lakes or graticule`);
    const out = [];
    for (const r of rings) {
        // Skip rings wholly outside before projecting the whole of them.
        const bb = boxOf([r]);
        if (bb[2] / 100 < P.box[0] || bb[0] / 100 > P.box[2] || bb[3] / 100 < P.box[1] || bb[1] / 100 > P.box[3]) continue;
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

/**
 * A great-circle route from one place to another (a city name or [lon, lat]), sampled at n + 1
 * points evenly spaced by distance and projected into the region's box: {x, y, angle (degrees,
 * the heading on the map, 0 = east, 90 = down), km}. arraySpline(x, t) is the point at the
 * fraction t of the distance.
 */
export function mapRoute(region, from, to, n = 48) {
    const P = projection(region);
    const [lon1, lat1] = place(from, "from"), [lon2, lat2] = place(to, "to");
    const r = Math.PI / 180;
    const v = (lon, lat) => [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)];
    const A = v(lon1, lat1), B = v(lon2, lat2);
    const d = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
    const xs = [], ys = [];
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
        xs.push(Math.round(P.x(lon) * 10) / 10); ys.push(Math.round(P.y(lat) * 10) / 10);
    }
    const angle = xs.map((_, i) => {
        const a = Math.max(0, i - 1), b = Math.min(n, i + 1);
        return Math.round(Math.atan2(ys[b] - ys[a], xs[b] - xs[a]) / r * 10) / 10;
    });
    // Unwrapped, so a spline between two samples never swings the long way round.
    for (let i = 1; i < angle.length; i++) { while (angle[i] - angle[i - 1] > 180) angle[i] -= 360; while (angle[i] - angle[i - 1] < -180) angle[i] += 360; }
    return { x: xs, y: ys, angle, km: Math.round(d * 6371) };
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
