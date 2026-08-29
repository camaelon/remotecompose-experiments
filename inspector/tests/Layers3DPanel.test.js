import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment } from "./test_helpers.js";
import {
    visibleFraction,
    clipOpacityFor,
    sceneDeltaToScreen,
    screenDeltaToScene
} from "../src/panels/Layers3DPanel.js";

describe("Layers3D geometry Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("a layer with no clip above it is fully visible", () => {
        assert.strictEqual(visibleFraction({ x: 0, y: 0, w: 10, h: 10 }, null), 1);
    });

    test("clipping is measured as the fraction of area that survives", () => {
        const clip = { x: 0, y: 0, r: 100, b: 100 };
        assert.strictEqual(visibleFraction({ x: 10, y: 10, w: 10, h: 10 }, clip), 1, "inside");
        assert.strictEqual(visibleFraction({ x: 200, y: 200, w: 10, h: 10 }, clip), 0, "outside");
        assert.strictEqual(visibleFraction({ x: -5, y: 0, w: 10, h: 10 }, clip), 0.5, "half in");
        assert.strictEqual(visibleFraction({ x: 95, y: 95, w: 10, h: 10 }, clip), 0.25, "a corner in");
    });

    test("a scrolled-away layer is faded, not hidden, and a whole one is untouched", () => {
        // Most of a long list is clipped at any moment, so this is a knock-down rather than a
        // fade to nothing: at 0.14 the stack went black.
        assert.strictEqual(clipOpacityFor(1), 1);
        assert.strictEqual(clipOpacityFor(0.5), 0.7);
        assert.strictEqual(clipOpacityFor(0), 0.35);
    });

    test("the screen-to-scene projection inverts its own forward transform", () => {
        // This inverse is what lets the pivot follow a pan, which is what keeps rotation
        // centred on the view. Every layer is parallel to the XY plane, so it is exact.
        const cases = [
            { pitch: 26, yaw: -24, zoom: 1 },
            { pitch: 0, yaw: 0, zoom: 1 },
            { pitch: 60, yaw: 45, zoom: 0.25 },
            { pitch: -30, yaw: 120, zoom: 3 }
        ];
        for (const { pitch, yaw, zoom } of cases) {
            for (const [x, y] of [[100, 0], [0, 100], [-37, 84], [500, -250]]) {
                const screen = sceneDeltaToScreen(x, y, pitch, yaw, zoom);
                const back = screenDeltaToScene(screen.x, screen.y, pitch, yaw, zoom);
                assert.ok(Math.abs(back.x - x) < 1e-6,
                    `x round-trips at pitch ${pitch} yaw ${yaw} zoom ${zoom}: ${back.x} vs ${x}`);
                assert.ok(Math.abs(back.y - y) < 1e-6,
                    `y round-trips at pitch ${pitch} yaw ${yaw} zoom ${zoom}: ${back.y} vs ${y}`);
            }
        }
    });

    test("an edge-on view is clamped rather than dividing by zero", () => {
        // At yaw 90 the plane projects to a line; the inverse is undefined and must not send
        // the pivot to infinity.
        const d = screenDeltaToScene(10, 10, 90, 90, 1);
        assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y), "the result stays finite");
    });

    test("zoom scales the scene delta, so a drag means less at high magnification", () => {
        const near = screenDeltaToScene(100, 0, 0, 0, 1);
        const far = screenDeltaToScene(100, 0, 0, 0, 4);
        assert.strictEqual(near.x, 100);
        assert.strictEqual(far.x, 25, "the same drag covers a quarter of the scene when zoomed 4x");
    });
});
