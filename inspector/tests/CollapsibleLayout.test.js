import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import * as stageModule from "../src/panels/StagePanel.js";

function countVisibleOperations(doc) {
    let count = 0;
    function traverse(list) {
        if (!list) return;
        for (const op of list) {
            if (typeof op.isGone === "function" && !op.isGone()) {
                count++;
            }
            if (typeof op.getList === "function") {
                traverse(op.getList());
            }
        }
    }
    traverse(doc.getOperations());
    return count;
}

describe("CollapsibleLayout Dynamic Resize Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("collapsible calendar widget collapses when shrunk and re-expands when enlarged", async () => {
        const { player, doc } = await loadSampleDocument("collapsible_calendar_widget.rc");

        // 1. Initial Large Stage (300x300)
        stageModule.applyStageDimensions(300, 300);
        player.renderFrame();
        const initialCount = countVisibleOperations(doc);
        assert.ok(initialCount > 0, "Initial visible count should be positive");

        // 2. Shrunk Stage (300x70) - elements should collapse
        stageModule.applyStageDimensions(300, 70);
        player.renderFrame();
        const shrunkCount = countVisibleOperations(doc);
        assert.ok(shrunkCount < initialCount, `Shrunk count (${shrunkCount}) should be less than initial (${initialCount})`);

        // 3. Resized back to Large Stage (300x300) - elements should reappear
        stageModule.applyStageDimensions(300, 300);
        player.renderFrame();
        const restoredCount = countVisibleOperations(doc);
        assert.strictEqual(restoredCount, initialCount, `Restored count (${restoredCount}) should match initial (${initialCount})`);
    });

    test("collapsible fitness widget collapses when shrunk and re-expands when enlarged", async () => {
        const { player, doc } = await loadSampleDocument("collapsible_fitness_widget.rc");

        stageModule.applyStageDimensions(300, 300);
        player.renderFrame();
        const initialCount = countVisibleOperations(doc);

        stageModule.applyStageDimensions(120, 60);
        player.renderFrame();
        const shrunkCount = countVisibleOperations(doc);
        assert.ok(shrunkCount < initialCount, `Shrunk count (${shrunkCount}) should be less than initial (${initialCount})`);

        stageModule.applyStageDimensions(300, 300);
        player.renderFrame();
        const restoredCount = countVisibleOperations(doc);
        assert.strictEqual(restoredCount, initialCount, `Restored count (${restoredCount}) should match initial (${initialCount})`);
    });

    test("collapsible sleep widget collapses when shrunk and re-expands when enlarged", async () => {
        const { player, doc } = await loadSampleDocument("collapsible_sleep_widget.rc");

        stageModule.applyStageDimensions(300, 300);
        player.renderFrame();
        const initialCount = countVisibleOperations(doc);

        stageModule.applyStageDimensions(120, 60);
        player.renderFrame();
        const shrunkCount = countVisibleOperations(doc);
        assert.ok(shrunkCount < initialCount, `Shrunk count (${shrunkCount}) should be less than initial (${initialCount})`);

        stageModule.applyStageDimensions(300, 300);
        player.renderFrame();
        const restoredCount = countVisibleOperations(doc);
        assert.strictEqual(restoredCount, initialCount, `Restored count (${restoredCount}) should match initial (${initialCount})`);
    });
});
