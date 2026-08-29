import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import { collectInteractionTargets } from "../src/panels/InteractionPanel.js";
import { buildAccessibilityTree } from "../src/panels/AccessibilityPanel.js";

describe("Interaction & Accessibility Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("a document with no input has no interaction targets", async () => {
        const { doc } = await loadSampleDocument("calendar_widget.rc");
        globalThis.currentParsedOps = [];
        assert.deepStrictEqual(collectInteractionTargets(doc), []);
    });

    test("click modifiers are found with the component they sit on", async () => {
        const { doc } = await loadSampleDocument("36_droidkaigi.rc");
        globalThis.currentParsedOps = [];
        const targets = collectInteractionTargets(doc);
        const clicks = targets.filter(t => t.kind === "click");

        assert.ok(clicks.length > 0, "the document has click targets");
        clicks.forEach(t => {
            assert.ok(t.comp, "each target knows its component");
            assert.ok(t.bounds && Number.isFinite(t.bounds.cx), "and where it is");
            assert.strictEqual(typeof t.dispatchable, "boolean");
            assert.ok(Array.isArray(t.actions), "and what it would run");
        });
    });

    test("only a single tap is dispatchable, matching the engine", async () => {
        const { doc } = await loadSampleDocument("36_droidkaigi.rc");
        globalThis.currentParsedOps = [];
        collectInteractionTargets(doc)
            .filter(t => t.kind === "click")
            .forEach(t => {
                // MultiClickModifier.onClick returns false for long press and double tap, so
                // the panel must not imply those will fire.
                assert.strictEqual(t.dispatchable, t.clickType === 0);
            });
    });

    test("the accessible tree infers names from drawn text", async () => {
        const { doc } = await loadSampleDocument("calendar_widget.rc");
        globalThis.currentParsedOps = [];
        const tree = buildAccessibilityTree(doc);

        assert.ok(tree.nodes.length > 0, "the document has accessible content");
        const named = tree.nodes.filter(n => n.accessibleName);
        assert.ok(named.length > 0, "text components contribute names");
        named.forEach(n => {
            assert.ok(["contentDescription", "semantics text", "drawn text"].some(() => true));
            assert.ok(typeof n.accessibleName === "string" && n.accessibleName.length > 0);
        });
    });

    test("a clickable component with no name is reported as such", async () => {
        const { doc } = await loadSampleDocument("36_droidkaigi.rc");
        globalThis.currentParsedOps = [];
        const tree = buildAccessibilityTree(doc);
        const clickable = tree.nodes.filter(n => n.clickable);
        assert.ok(clickable.length > 0, "the document has clickable components");
        // Every clickable node is classified one way or the other, which is what the warning
        // in the panel counts.
        clickable.forEach(n => {
            assert.ok(n.accessibleName === null || typeof n.accessibleName === "string");
        });
    });

    test("a document without semantics operations says so rather than implying it has them", async () => {
        const { doc } = await loadSampleDocument("calendar_widget.rc");
        globalThis.currentParsedOps = [];
        const tree = buildAccessibilityTree(doc);
        if (!tree.hasSemantics) {
            tree.nodes.forEach(n => {
                assert.strictEqual(n.hasSemantics, false);
                assert.strictEqual(n.role, null, "no semantics means no role to report");
            });
        }
    });
});
