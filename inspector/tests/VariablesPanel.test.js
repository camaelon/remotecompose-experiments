import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import * as varsModule from "../src/panels/VariablesPanel.js";

describe("VariablesPanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("SYSTEM_VARS maps core system IDs to names", () => {
        const { SYSTEM_VARS, getSystemVarName } = varsModule;
        assert.strictEqual(SYSTEM_VARS[1], "CONTINUOUS_SEC");
        assert.strictEqual(SYSTEM_VARS[2], "TIME_IN_SEC");
        assert.strictEqual(SYSTEM_VARS[5], "WINDOW_WIDTH");
        assert.strictEqual(SYSTEM_VARS[6], "WINDOW_HEIGHT");
        assert.strictEqual(getSystemVarName(1), "CONTINUOUS_SEC");
        assert.strictEqual(getSystemVarName(999), null);
    });

    test("getReferencedVarIds extracts variable IDs from document ops", async () => {
        const { getReferencedVarIds } = varsModule;
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const refIds = getReferencedVarIds(doc);
        assert.ok(refIds instanceof Set, "Referenced IDs should be a Set");
        assert.ok(refIds.size > 0, "Should have extracted referenced variable IDs");
    });

    test("updateVariablesPanel populates state inspector table", async () => {
        const { updateVariablesPanel } = varsModule;
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const container = document.getElementById("variablesListContainer");
        updateVariablesPanel(doc);
        assert.ok(container.innerHTML.length > 0, "Variables container should have content");
    });
});