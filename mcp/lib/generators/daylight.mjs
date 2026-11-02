// {"$gen": {"kind": "daylight", "cities": ["London", "Tokyo"], ...}}: city markers on a world map
// that light up where the sun is up, for WorldMap's `daylight` option. The server looks each city
// up once (Natural Earth places, or [lon, lat]) and writes five float arrays (x, y in the map box,
// longitude, sin and cos of the latitude) and one loop over them: at run time each iteration
// computes the sun's elevation there,
//     sin(el) = sin(lat) sin(decl) + cos(lat) cos(decl) cos(lon - sunLon),
// and draws a halo (alpha 0.35 while el > 0) and the dot, in dayColor by day and nightColor by
// night (mono: filled by day, hollow by night: the state is the shape, not the colour).
//
// Spec (expressions are substituted by the calling component before this runs):
//   cities      names or [lon, lat] pairs
//   region      "world" or "world-full" (the plate carrée boxes the night shade assumes)
//   decl        expression: solar declination in radians      (WorldMap: "@decl")
//   sunLon      expression: the subsolar longitude in degrees  (WorldMap: "@sunLon")
//   radius      expression: the dot radius in map units        (WorldMap: "@mr")
//   dayColor, nightColor, ringColor  colours (ringColor outlines each dot)
//   index       loop index name (default "wdi")

import { findCity, mapPoint } from "../maps.mjs";

export const kind = "daylight";
export const doc = "City markers on a world map that glow where the sun is up: one loop over server-computed arrays, the sun's elevation per city at run time";

const r4 = (n) => Math.round(n * 10000) / 10000;

/** [lon, lat] of a city name or a [lon, lat] pair. */
export function cityLonLat(c) {
    if (Array.isArray(c) && c.length === 2 && c.every((v) => typeof v === "number")) return c;
    const p = findCity(c);
    if (!p) throw new Error(`unknown city '${c}' (Natural Earth places, or [lon, lat])`);
    return p;
}

/** The arrays the loop reads: x, y in the region's box, lon, sin(lat), cos(lat). */
export function daylightArrays(cities, region = "world") {
    const out = { x: [], y: [], lon: [], sinLat: [], cosLat: [] };
    for (const c of cities) {
        const [lon, lat] = cityLonLat(c);
        const [x, y] = mapPoint(region, { lon, lat });
        out.x.push(r4(x)); out.y.push(r4(y)); out.lon.push(r4(lon));
        out.sinLat.push(r4(Math.sin(lat * Math.PI / 180))); out.cosLat.push(r4(Math.cos(lat * Math.PI / 180)));
    }
    return out;
}

export function generate(spec, ctx) {
    const cities = [].concat(spec.cities ?? []);
    if (!cities.length) throw new Error("daylight needs cities");
    const region = spec.region ?? "world";
    if (!["world", "world-full"].includes(region)) throw new Error(`daylight works on the world map only (region "world" or "world-full"), not ${JSON.stringify(region)}`);
    const a = daylightArrays(cities, region);
    const X = ctx.floatArray("day_x", a.x), Y = ctx.floatArray("day_y", a.y), L = ctx.floatArray("day_lon", a.lon);
    const SL = ctx.floatArray("day_sinlat", a.sinLat), CL = ctx.floatArray("day_coslat", a.cosLat);
    const i = spec.index ?? "wdi";
    const decl = `(${spec.decl ?? 0})`, sunLon = `(${spec.sunLon ?? 0})`, r = `(${spec.radius ?? 3})`;
    const el = `arrayGet(${SL}, ${i}) * sin(${decl}) + arrayGet(${CL}, ${i}) * cos(${decl}) * cos((arrayGet(${L}, ${i}) - ${sunLon}) * 0.0174533)`;
    const at = { cx: `arrayGet(${X}, ${i})`, cy: `arrayGet(${Y}, ${i})` };
    const mono = ctx.mono;
    const day = mono ? "@colors.onSurface" : (spec.dayColor ?? "@colors.warning");
    const night = mono ? "@colors.background" : (spec.nightColor ?? "@colors.muted");
    const ring = mono ? "@colors.onSurface" : (spec.ringColor ?? "@colors.surface");
    return { loop: { index: i, from: 0, until: cities.length, commands: [
            { paint: { ops: [{ color: day }, { style: "fill" }, { alpha: `0.35 * step(${el}, 0)` }] } },
            { drawCircle: { ...at, radius: `${r} * 2` } },
            { paint: { ops: [{ alpha: 1 }, { color: night }] } },
            { conditionalOperations: { condition: "gt", v1: el, v2: 0, commands: [{ paint: { ops: [{ color: day }] } }] } },
            { drawCircle: { ...at, radius: r } },
            { paint: { ops: [{ color: ring }, { style: "stroke" }, { strokeWidth: `${r} * 0.35` }] } },
            { drawCircle: { ...at, radius: r } },
            { paint: { ops: [{ style: "fill" }] } },
        ] } };
}
