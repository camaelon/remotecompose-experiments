import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import {
    buildLayerModel,
    isVisibleComponent,
    componentVisibility,
    effectiveVisibility,
    drawingReason,
    isDrawingComponent,
    isScrollContainer,
    clipsChildren,
    accumulatedScroll,
    componentBounds,
    walkComponents,
    getRootComponent
} from "../src/panels/ComponentWalk.js";

describe("ComponentWalk Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("text and image components draw by being themselves", () => {
        // The mistake worth guarding: looking only for draw *ops inside* a component reports
        // almost nothing, because this engine draws through leaf components. weather_demo has
        // 67 CoreText and 25 ImageLayout and not one draw op in a component's child list.
        assert.strictEqual(drawingReason({ constructor: { name: "CoreText" } }), "self-drawing");
        assert.strictEqual(drawingReason({ constructor: { name: "ImageLayout" } }), "self-drawing");
        assert.strictEqual(drawingReason({ constructor: { name: "CanvasContent" } }), "self-drawing");
        assert.strictEqual(drawingReason({ constructor: { name: "ColumnLayout" } }), null,
            "a plain container draws nothing of its own");
    });

    test("a container that paints a background counts as drawing", () => {
        const withBackground = {
            constructor: { name: "BoxLayout" },
            mComponentModifiers: [{ constructor: { name: "BackgroundModifier" } }]
        };
        assert.strictEqual(drawingReason(withBackground), "background");
        assert.ok(isDrawingComponent(withBackground));
    });

    test("a component holding canvas draw ops counts as drawing", () => {
        const canvas = {
            constructor: { name: "SomeContainer" },
            getList: () => [{ OP_CODE: 46 }]      // DrawCircle
        };
        assert.strictEqual(drawingReason(canvas), "canvas draw");
    });

    test("a component's own scroll does not displace itself", () => {
        // A scroll modifier translates a component's children, not the component. Walking from
        // the component itself made a scrolling frame slide by its own scroll position.
        const scrollMod = { getScrollX: () => 0, getScrollY: () => -600 };
        const scroller = { getScrollModifier: () => scrollMod, getParent: () => null };
        const child = { getParent: () => scroller };

        assert.deepStrictEqual(accumulatedScroll(scroller), { x: 0, y: 0 },
            "the scrolling container itself is not displaced");
        assert.deepStrictEqual(accumulatedScroll(child), { x: 0, y: -600 },
            "its children are");
    });

    test("nested scrolls accumulate", () => {
        const outer = { getScrollModifier: () => ({ getScrollX: () => -10, getScrollY: () => -100 }), getParent: () => null };
        const inner = { getScrollModifier: () => ({ getScrollX: () => 0, getScrollY: () => -50 }), getParent: () => outer };
        const leaf = { getParent: () => inner };
        assert.deepStrictEqual(accumulatedScroll(leaf), { x: -10, y: -150 });
    });

    test("scroll containers and clipping components are distinguished", () => {
        const clipper = { mComponentModifiers: [{ OP_CODE: 108 }] };       // ClipRectModifier
        assert.ok(clipsChildren(clipper));
        assert.ok(!isScrollContainer(clipper), "clipping alone is not a scroll container");

        const scroller = { getScrollModifier: () => ({}) };
        assert.ok(isScrollContainer(scroller));
    });

    test("the layer model flattens containers that draw nothing", async () => {
        const { doc } = await loadSampleDocument("calendar_widget.rc");
        const model = buildLayerModel(doc);

        assert.ok(model.layers.length > 0, "the document produces layers");
        assert.strictEqual(model.drawn + model.flattened + model.gone + model.invisible,
            model.layers.length, "every layer is drawn, flattened, gone or invisible");
        assert.ok(model.drawn > 0, "something draws");
        assert.ok(model.flattened > 0, "pure containers are flattened out of the stack");
        assert.ok(model.drawn < model.layers.length,
            "flattening actually removes planes rather than keeping every component");
    });

    test("flattened containers keep their parent's plane and stay in the model", async () => {
        const { doc } = await loadSampleDocument("calendar_widget.rc");
        const { layers } = buildLayerModel(doc);

        const flattened = layers.filter(l => !l.drawing);
        assert.ok(flattened.length > 0);
        flattened.forEach(l => {
            assert.strictEqual(l.reason, null, "a flattened layer has no drawing reason");
            assert.ok(l.comp, "it is still reachable, so it can still be selected");
        });
    });

    test("paint order is consecutive for drawn layers and shared by flattened ones", async () => {
        const { doc } = await loadSampleDocument("calendar_widget.rc");
        const { layers, maxPaintIndex } = buildLayerModel(doc);

        // Only painted layers get a plane, so hidden ones are excluded from the sequence.
        const drawnIndices = layers.filter(l => l.drawing && l.visible).map(l => l.paintIndex);
        assert.deepStrictEqual(drawnIndices, drawnIndices.slice().sort((a, b) => a - b),
            "drawn layers are numbered in paint order");
        assert.strictEqual(new Set(drawnIndices).size, drawnIndices.length,
            "each drawn layer gets a plane of its own");
        assert.strictEqual(maxPaintIndex, Math.max(...drawnIndices));

        layers.filter(l => !l.drawing && l.visible).forEach(l => {
            assert.ok(l.paintIndex <= maxPaintIndex,
                "a flattened container shares an existing plane rather than adding one");
        });
    });

    test("every layer carries usable bounds", async () => {
        const { doc } = await loadSampleDocument("calendar_widget.rc");
        const { layers } = buildLayerModel(doc);
        layers.forEach(l => {
            assert.ok(l.bounds, `${l.name} has bounds`);
            ["x", "y", "w", "h"].forEach(k => {
                assert.ok(Number.isFinite(l.bounds[k]), `${l.name}.${k} is a finite number`);
            });
        });
    });

    test("walkComponents visits only components, deepest last within a branch", async () => {
        const { doc } = await loadSampleDocument("02_ticker.rc");
        const seen = [];
        walkComponents(getRootComponent(doc), (comp, depth) => seen.push({ comp, depth }));
        assert.ok(seen.length > 0);
        assert.strictEqual(seen[0].depth, 0, "the root is at depth 0");
        seen.forEach(({ comp }) => {
            const bounds = componentBounds(comp);
            assert.ok(bounds && Number.isFinite(bounds.cx), "each visited node can be measured");
        });
    });

    test("visibility follows the engine, override bits included", () => {
        // Plain values are GONE/VISIBLE/INVISIBLE; once any override bit is set it decides,
        // which is how a state change forces a component on or off.
        assert.ok(isVisibleComponent({ mVisibility: 1 }), "VISIBLE");
        assert.ok(!isVisibleComponent({ mVisibility: 0 }), "GONE");
        assert.ok(!isVisibleComponent({ mVisibility: 2 }), "INVISIBLE");
        assert.ok(isVisibleComponent({ mVisibility: 32 }), "OVERRIDE_VISIBLE wins");
        assert.ok(!isVisibleComponent({ mVisibility: 16 }), "OVERRIDE_GONE wins");
        assert.ok(!isVisibleComponent({ mVisibility: 64 }), "OVERRIDE_INVISIBLE wins");
        assert.ok(!isVisibleComponent({ mVisibility: 16 | 1 }),
            "an override beats the plain value underneath it");
        assert.ok(isVisibleComponent({}), "a node that declares no visibility is shown");
    });

    test("a hidden component takes its subtree out of the stack", async () => {
        const { doc } = await loadSampleDocument("calendar_widget.rc");
        const model = buildLayerModel(doc);

        // Hide a container that has children, then rebuild.
        const parent = model.layers.find(l => {
            const kids = l.comp.mChildrenComponents || [];
            return kids.length > 0 && l.comp.mVisibility !== undefined;
        });
        assert.ok(parent, "the document has a container declaring visibility");

        const before = buildLayerModel(doc);
        const original = parent.comp.mVisibility;
        parent.comp.mVisibility = 0;                 // GONE
        const after = buildLayerModel(doc);
        parent.comp.mVisibility = original;

        assert.ok(after.hidden > before.hidden,
            "hiding a container hides it and everything inside it");
        assert.ok(after.drawn <= before.drawn, "and removes planes rather than adding them");
        after.layers.filter(l => l.visible === false).forEach(l => {
            assert.strictEqual(l.visible, false, "hidden layers are marked, not silently dropped");
        });
    });

    test("a hidden layer never consumes a paint plane", async () => {
        const { doc } = await loadSampleDocument("calendar_widget.rc");
        const { layers } = buildLayerModel(doc);
        const drawnVisible = layers.filter(l => l.drawing && l.visible);
        const indices = drawnVisible.map(l => l.paintIndex);
        assert.strictEqual(new Set(indices).size, indices.length,
            "planes are spent only on layers that are actually painted");
    });

    test("GONE and INVISIBLE are told apart", () => {
        assert.strictEqual(componentVisibility({ mVisibility: 0 }), "gone");
        assert.strictEqual(componentVisibility({ mVisibility: 1 }), "visible");
        assert.strictEqual(componentVisibility({ mVisibility: 2 }), "invisible");
        assert.strictEqual(componentVisibility({ mVisibility: 16 }), "gone", "OVERRIDE_GONE");
        assert.strictEqual(componentVisibility({ mVisibility: 32 }), "visible", "OVERRIDE_VISIBLE");
        assert.strictEqual(componentVisibility({ mVisibility: 64 }), "invisible", "OVERRIDE_INVISIBLE");
        assert.strictEqual(componentVisibility({}), "visible");
    });

    test("the most restrictive visibility along the chain wins", () => {
        const goneParent = { mVisibility: 0, getParent: () => null };
        const invisibleParent = { mVisibility: 2, getParent: () => null };
        assert.strictEqual(effectiveVisibility({ mVisibility: 1, getParent: () => goneParent }), "gone",
            "a visible child of a GONE parent is not laid out at all");
        assert.strictEqual(effectiveVisibility({ mVisibility: 1, getParent: () => invisibleParent }), "invisible",
            "a visible child of an INVISIBLE parent is laid out but not painted");
        assert.strictEqual(effectiveVisibility({ mVisibility: 2, getParent: () => ({ mVisibility: 1, getParent: () => null }) }),
            "invisible");
    });

    test("an INVISIBLE component keeps its place in the model but not a paint plane", async () => {
        const { doc } = await loadSampleDocument("calendar_widget.rc");
        const base = buildLayerModel(doc);
        const target = base.layers.find(l => l.drawing && l.comp.mVisibility !== undefined);
        assert.ok(target, "the document has a drawn component declaring visibility");

        const original = target.comp.mVisibility;
        target.comp.mVisibility = 2;                  // INVISIBLE
        const withInvisible = buildLayerModel(doc);
        target.comp.mVisibility = 0;                  // GONE
        const withGone = buildLayerModel(doc);
        target.comp.mVisibility = original;

        assert.ok(withInvisible.invisible > base.invisible,
            "INVISIBLE is counted as such, not dropped");
        assert.ok(withGone.gone > base.gone, "GONE is counted separately");
        assert.strictEqual(withInvisible.layers.length, base.layers.length,
            "the model still holds the component either way");
        assert.ok(withInvisible.drawn < base.drawn,
            "but an unpainted layer no longer occupies a plane");
    });
});
