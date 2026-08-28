import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleRcBuffer } from "./test_helpers.js";
import "../dist/remote_compose_player.js";
import * as docLoaderModule from "../src/panels/DocumentLoader.js";

describe("DocumentLoader Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    afterEach(() => {
        if (globalThis.currentPlayer && typeof globalThis.currentPlayer.pause === 'function') {
            globalThis.currentPlayer.pause();
        }
    });

    test("loadRcArrayBuffer successfully loads and initializes document", async () => {
        const { loadRcArrayBuffer } = docLoaderModule;
        const buffer = loadSampleRcBuffer("02_ticker.rc");
        await loadRcArrayBuffer(buffer, "02_ticker.rc");

        assert.ok(globalThis.currentPlayer || docLoaderModule.currentPlayer, "currentPlayer should be initialized");
        assert.ok(globalThis.currentDocument || docLoaderModule.currentDocument, "currentDocument should be initialized");
        assert.ok(globalThis.currentBuffer || docLoaderModule.currentBuffer, "currentBuffer should be set");
    });

    test("getAllOperationsFlat flattens tree and reconstructs ContainerEnd", async () => {
        const { getAllOperationsFlat, loadRcArrayBuffer } = docLoaderModule;
        let doc = globalThis.currentDocument || docLoaderModule.currentDocument;
        let buffer = globalThis.currentBuffer || docLoaderModule.currentBuffer;
        if (!doc) {
            buffer = loadSampleRcBuffer("02_ticker.rc");
            await loadRcArrayBuffer(buffer, "02_ticker.rc");
            doc = globalThis.currentDocument || docLoaderModule.currentDocument;
        }

        const u8 = new Uint8Array(buffer);
        const allOps = getAllOperationsFlat(doc, u8);
        assert.ok(Array.isArray(allOps), "Flat ops should be an array");
        assert.ok(allOps.length > 0, "Should contain flat operations");

        const hasContainerEnd = allOps.some(op => op.OP_CODE === 214 || op.constructor?.OP_CODE === 214 || op.constructor?.name === "ContainerEnd");
        assert.ok(hasContainerEnd, "Should include reconstructed ContainerEnd operations");
    });
});