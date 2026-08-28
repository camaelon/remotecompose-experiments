import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import * as jsonEditorModule from "../src/panels/JsonEditorPanel.js";

describe("JsonEditorPanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("decompileDocumentToJson decompiles document to JSON object", async () => {
        const { decompileDocumentToJson } = jsonEditorModule;
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const json = decompileDocumentToJson(doc);
        assert.ok(json, "Decompiled JSON should not be null");
        assert.ok(typeof json === "object", "Decompiled result should be an object");
        assert.ok(json.header, "Decompiled JSON should have header");
        assert.ok(json.root || json.operations, "Decompiled JSON should have root or operations");
    });

    test("showCompileStatus updates status badge", () => {
        const { showCompileStatus } = jsonEditorModule;
        const statusEl = document.getElementById("compileStatusMsg");

        showCompileStatus("✓ Compiled successfully", true);
        assert.strictEqual(statusEl.textContent, "✓ Compiled successfully");
    });

    test("setJsonInputValue and getJsonInputValue handle text values", () => {
        const { setJsonInputValue, getJsonInputValue } = jsonEditorModule;
        const textarea = document.getElementById("jsonTextarea");

        setJsonInputValue("{\"test\": 123}");
        assert.strictEqual(textarea.value, "{\"test\": 123}");
        assert.strictEqual(getJsonInputValue(), "{\"test\": 123}");
    });
});