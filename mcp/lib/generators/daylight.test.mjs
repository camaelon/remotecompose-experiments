// node --test mcp/lib/generators/daylight.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { cityLonLat, daylightArrays, generate } from "./daylight.mjs";
import { compileComponents } from "../json2rc.mjs";

const ctx = (mono = false) => {
    const arrays = new Map();
    return { mono, arrays, floatArray: (hint, nums) => { const id = `gen_${hint}_${arrays.size + 1}`; arrays.set(id, nums); return `@${id}`; } };
};

test("cities are looked up and placed in the world box", () => {
    assert.deepEqual(cityLonLat([10, 20]), [10, 20]);
    const a = daylightArrays(["London", "Sydney"]);
    assert.ok(Math.abs(a.x[0] - 500) < 2, `London x ${a.x[0]}`);          // ~0 E: the middle
    assert.ok(a.y[0] < a.y[1], "London is north of Sydney");
    assert.ok(Math.abs(a.sinLat[0] - Math.sin(51.5 * Math.PI / 180)) < 0.01);
    assert.ok(a.sinLat[1] < 0, "Sydney is south");
    assert.throws(() => cityLonLat("Nowhere-on-earth"), /unknown city/);
});

test("the elevation formula says day where the sun is overhead and night on the far side", () => {
    // 12:00 UTC at an equinox: the sun over 0 E, 0 N.
    const sinEl = (lon, lat, decl = 0, sunLon = 0) => {
        const r = Math.PI / 180;
        return Math.sin(lat * r) * Math.sin(decl) + Math.cos(lat * r) * Math.cos(decl) * Math.cos((lon - sunLon) * r);
    };
    const [lon, lat] = cityLonLat("London"), [tlon, tlat] = cityLonLat("Tokyo");
    assert.ok(sinEl(lon, lat) > 0.5);
    assert.ok(sinEl(tlon, tlat) < 0);
});

test("one loop over five arrays; mono swaps the colours for shape", () => {
    const c = ctx();
    const out = generate({ cities: ["London", "Tokyo", "Sydney"], decl: "@decl", sunLon: "@sunLon", radius: "@mr", dayColor: "@colors.warning" }, c);
    assert.equal(out.loop.until, 3);
    assert.equal(c.arrays.size, 5);
    const s = JSON.stringify(out);
    assert.match(s, /arrayGet\(@gen_day_sinlat_\d+, wdi\) \* sin\(\(@decl\)\)/);
    assert.match(s, /@colors\.warning/);
    const m = JSON.stringify(generate({ cities: ["London"], decl: "@decl", sunLon: "@sunLon" }, ctx(true)));
    assert.match(m, /@colors\.onSurface/);
    assert.match(m, /@colors\.background/);
    assert.throws(() => generate({ cities: ["Paris"], region: "Europe" }, ctx()), /world map only/);
    assert.throws(() => generate({ cities: [] }, ctx()), /needs cities/);
});

test("WorldMap daylight + sun + twilight expand to plain JSON; without them nothing changes", () => {
    const base = { header: { apiLevel: 7, width: 360, height: 200, profiles: 513 }, root: { WorldMap: { cities: ["London", "Tokyo"], night: true } } };
    const plain = JSON.stringify(compileComponents(structuredClone(base)).doc);
    assert.doesNotMatch(plain, /wmNightE|arrayGet/);
    const on = structuredClone(base);
    Object.assign(on.root.WorldMap, { twilight: true, sun: true, daylight: true });
    const s = JSON.stringify(compileComponents(on).doc);
    assert.match(s, /wmNightE/);
    assert.match(s, /wmNightW/);
    assert.match(s, /arrayGet/);
    assert.doesNotMatch(s, /\$gen|\$if|\$mapPoint/);
});
