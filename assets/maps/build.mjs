#!/usr/bin/env node
// Builds assets/maps/maps.json from the Natural Earth GeoJSON in source/ (public domain,
// naturalearthdata.com, via github.com/nvkelso/natural-earth-vector).
//
// The output keeps geography only, as quantized lon/lat (1/100 degree integers), so a map
// can be clipped, simplified and projected for any region when a document is built
// (mcp/lib/maps.mjs). Layers:
//   land110, land50          land polygons (rings), world and regional detail
//   countries110, countries50  {iso3, iso2, name, continent, subregion, bbox, rings}
//   lakes110                 large lakes
//   cities                   {name, country iso3, lon, lat, rank, capital, stateCapital, pop}
// Rings are [[lon100, lat100], ...] (first point not repeated).
//
// Usage: node assets/maps/build.mjs   (reads source/*.geojson, writes maps.json)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "source");
const read = (f) => JSON.parse(readFileSync(path.join(SRC, f), "utf8"));

const q = (v) => Math.round(v * 100);
function ringsOf(geom) {
    if (!geom) return [];
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    const out = [];
    for (const poly of polys) for (const ring of poly) {
        const r = [];
        for (const [lon, lat] of ring) {
            const p = [q(lon), q(lat)];
            const last = r[r.length - 1];
            if (!last || last[0] !== p[0] || last[1] !== p[1]) r.push(p);
        }
        if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
        if (r.length >= 3) out.push(r);
    }
    return out;
}
const bboxOf = (rings) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of rings) for (const [x, y] of r) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    return [a, b, c, d];
};

const land = (f) => read(f).features.flatMap((ft) => ringsOf(ft.geometry));
const countries = (f) => read(f).features.map((ft) => {
    const p = ft.properties;
    const rings = ringsOf(ft.geometry);
    // ISO_A3 is "-99" for a few (France, Norway in some releases): ADM0_A3 is always set.
    const iso3 = p.ISO_A3 && p.ISO_A3 !== "-99" ? p.ISO_A3 : p.ADM0_A3;
    const iso2 = p.ISO_A2 && p.ISO_A2 !== "-99" ? p.ISO_A2 : (p.ISO_A2_EH ?? null);
    // TYPE: "Sovereign country" / "Country" (a state), "Dependency" (Jersey, the Faroes), "Disputed".
    return { iso3, iso2, name: p.NAME, long: p.NAME_LONG ?? p.NAME, continent: p.CONTINENT, subregion: p.SUBREGION, type: p.TYPE, bbox: bboxOf(rings), rings };
}).filter((c) => c.rings.length);

// The 1:50m places (about 1,250: every state capital) when present, else the 243 of 1:110m;
// the most important first, so a name two places share finds the larger.
const placesFile = existsSync(path.join(SRC, "ne_50m_populated_places_simple.geojson")) ? "ne_50m_populated_places_simple.geojson" : "ne_110m_populated_places_simple.geojson";
const cities = read(placesFile).features.map((ft) => {
    const p = ft.properties;
    return { name: p.name, country: p.adm0_a3 ?? p.sov_a3, lon: +ft.geometry.coordinates[0].toFixed(3), lat: +ft.geometry.coordinates[1].toFixed(3), rank: p.scalerank ?? p.rank_max ?? 0,
        capital: Boolean(p.adm0cap), ...(/admin-1 capital/i.test(p.featurecla ?? "") ? { stateCapital: true } : {}), pop: p.pop_max ?? 0 };
}).sort((a, b) => a.rank - b.rank || b.pop - a.pop);

// States and provinces (admin-1): the 1:50m layer (the largest countries) whole, plus a few more
// countries from the 1:10m layer, simplified (its source is 40 MB and not kept in git: download
// ne_10m_admin_1_states_provinces.geojson into source/ to rebuild them).
function dpRing(r, tol) {   // Douglas-Peucker on an open ring of [lon100, lat100]
    if (r.length < 5) return r;
    const keep = new Uint8Array(r.length); keep[0] = keep[r.length - 1] = 1;
    const st = [[0, r.length - 1]];
    while (st.length) {
        const [a, b] = st.pop(); if (b - a < 2) continue;
        const [ax, ay] = r[a], [bx, by] = r[b]; const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        let idx = -1, md = tol * tol;
        for (let i = a + 1; i < b; i++) { const [px, py] = r[i]; const d = L ? ((px - ax) * dy - (py - ay) * dx) ** 2 / L : (px - ax) ** 2 + (py - ay) ** 2; if (d > md) { md = d; idx = i; } }
        if (idx >= 0) { keep[idx] = 1; st.push([a, idx], [idx, b]); }
    }
    return r.filter((_, i) => keep[i]);
}
const admin1 = (f, only, tol) => {
    if (!existsSync(path.join(SRC, f))) return [];
    return read(f).features.filter((ft) => !only || only.includes(ft.properties.adm0_a3)).map((ft) => {
        const p = ft.properties;
        const rings = ringsOf(ft.geometry).map((r) => tol ? dpRing(r, tol) : r).filter((r) => r.length >= 3);
        return { country: p.adm0_a3, name: p.name, code: p.iso_3166_2, postal: p.postal, type: p.type_en, lon: p.longitude, lat: p.latitude, bbox: bboxOf(rings), rings };
    }).filter((s) => s.rings.length);
};
const EXTRA_ADMIN1 = ["DEU", "JPN", "MEX", "ESP", "ITA", "GBR", "FRA"];
const states = [...admin1("ne_50m_admin_1_states_provinces.geojson", null, 0),
                ...admin1("ne_10m_admin_1_states_provinces.geojson", EXTRA_ADMIN1, 3)];

const out = {
    source: "Natural Earth (public domain), naturalearthdata.com; 1:110m and 1:50m cultural and physical vectors, v5. Coordinates are lon/lat × 100.",
    land110: land("ne_110m_land.geojson"),
    land50: land("ne_50m_land.geojson"),
    lakes110: land("ne_110m_lakes.geojson"),
    countries110: countries("ne_110m_admin_0_countries.geojson"),
    countries50: countries("ne_50m_admin_0_countries.geojson"),
    cities,
    states,
};
const points = (rings) => rings.reduce((n, r) => n + r.length, 0);
writeFileSync(path.join(HERE, "maps.json"), JSON.stringify(out));
console.log(`land110 ${points(out.land110)} pts, land50 ${points(out.land50)} pts, countries110 ${out.countries110.length} (${out.countries110.reduce((n, c) => n + points(c.rings), 0)} pts), ` +
    `countries50 ${out.countries50.length} (${out.countries50.reduce((n, c) => n + points(c.rings), 0)} pts), cities ${out.cities.length}, ` +
    `states ${out.states.length} (${out.states.reduce((n, c) => n + points(c.rings), 0)} pts, ${[...new Set(out.states.map((x) => x.country))].length} countries)`);
