import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import * as treemapModule from "../src/panels/BinaryTreemapPanel.js";

describe("BinaryTreemapPanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("CATEGORY_COLORS contains definitions for all categories", () => {
        const { CATEGORY_COLORS } = treemapModule;
        assert.ok(CATEGORY_COLORS.header, "Should have header color");
        assert.ok(CATEGORY_COLORS.layout, "Should have layout color");
        assert.ok(CATEGORY_COLORS.modifier, "Should have modifier color");
        assert.ok(CATEGORY_COLORS.text, "Should have text color");
        assert.ok(CATEGORY_COLORS.path, "Should have path color");
        assert.ok(CATEGORY_COLORS.state, "Should have state color");
        assert.ok(CATEGORY_COLORS.draw, "Should have draw color");
        assert.ok(CATEGORY_COLORS.bitmap, "Should have bitmap color");
        assert.ok(CATEGORY_COLORS.control, "Should have control color");
        assert.ok(CATEGORY_COLORS.other, "Should have other color");
    });

    test("classifyOpCategory categorizes opcodes accurately", () => {
        const { classifyOpCategory } = treemapModule;
        assert.strictEqual(classifyOpCategory({ OP_CODE: 0 }), "header");
        assert.strictEqual(classifyOpCategory({ OP_CODE: 123 }), "path");
        assert.strictEqual(classifyOpCategory({ OP_CODE: 175 }), "path");
        assert.strictEqual(classifyOpCategory({ OP_CODE: 81 }), "state");
        assert.strictEqual(classifyOpCategory({ OP_CODE: 137 }), "state");
        assert.strictEqual(classifyOpCategory({ OP_CODE: 138 }), "state");
        assert.strictEqual(classifyOpCategory({ OP_CODE: 200 }), "layout");
    });

    test("buildBinaryTreemapModel extracts hierarchy and allocations", async () => {
        const { buildBinaryTreemapModel } = treemapModule;
        const { doc, arrayBuffer } = await loadSampleDocument("02_ticker.rc");
        const ops = typeof doc.getOperations === "function" ? doc.getOperations() : doc.mOps;
        const u8 = new Uint8Array(arrayBuffer);

        const model = buildBinaryTreemapModel(doc, ops, u8);
        assert.ok(model, "Treemap model should not be null");
        assert.strictEqual(model.totalBytes, u8.length);
        assert.ok(model.categories && typeof model.categories === "object", "Model should have categories");
        assert.ok(model.allAllocations && model.allAllocations.length > 0, "Model should have allocations");
    });

    test("computeSquarifiedTreemap calculates valid bounding boxes", () => {
        const { computeSquarifiedTreemap } = treemapModule;
        const items = [
            { id: 1, sizeBytes: 60, name: "A" },
            { id: 2, sizeBytes: 40, name: "B" }
        ];

        const rects = computeSquarifiedTreemap(items, 0, 0, 800, 600, 100);
        assert.ok(Array.isArray(rects), "Rects should be an array");
        assert.strictEqual(rects.length, 2);
        for (const r of rects) {
            assert.ok(r.width >= 0, "Width should be non-negative");
            assert.ok(r.height >= 0, "Height should be non-negative");
            assert.ok(r.x >= 0 && r.x <= 800, "X in bounds");
            assert.ok(r.y >= 0 && r.y <= 600, "Y in bounds");
        }
    });

    test("renderBinaryTreemapPanel renders treemap into container", async () => {
        const { renderBinaryTreemapPanel } = treemapModule;
        const { doc, arrayBuffer } = await loadSampleDocument("02_ticker.rc");
        const ops = typeof doc.getOperations === "function" ? doc.getOperations() : doc.mOps;
        const u8 = new Uint8Array(arrayBuffer);

        const container = document.getElementById("treemapVisualContainer");
        renderBinaryTreemapPanel(doc, ops, u8);
        assert.ok(container.innerHTML.length > 0, "Container should not be empty");
    });

    test("onTreemapItemClick does not restore pane2 if pane2 is hidden", async () => {
        const { renderBinaryTreemapPanel, onTreemapItemClick } = treemapModule;
        const { doc, arrayBuffer } = await loadSampleDocument("02_ticker.rc");
        const ops = typeof doc.getOperations === "function" ? doc.getOperations() : doc.mOps;
        const u8 = new Uint8Array(arrayBuffer);

        renderBinaryTreemapPanel(doc, ops, u8);

        let restoredPane = null;
        globalThis.window.restorePanel = (paneId) => {
            restoredPane = paneId;
        };

        const pane2 = document.getElementById("pane2");
        if (pane2) {
            pane2.classList.add("hidden-panel");
        }

        onTreemapItemClick(0);
        assert.strictEqual(restoredPane, null, "Should not restore pane2 when pane2 is closed");
    });

    test("onTreemapItemClick navigates command list if pane2 is open", async () => {
        const { renderBinaryTreemapPanel, onTreemapItemClick } = treemapModule;
        const { doc, arrayBuffer } = await loadSampleDocument("02_ticker.rc");
        const ops = typeof doc.getOperations === "function" ? doc.getOperations() : doc.mOps;
        const u8 = new Uint8Array(arrayBuffer);

        renderBinaryTreemapPanel(doc, ops, u8);

        let selectedIdx = null;
        globalThis.window.selectCommandCard = (idx) => {
            selectedIdx = idx;
        };

        const pane2 = document.getElementById("pane2");
        if (pane2) {
            pane2.classList.remove("hidden-panel");
        }

        onTreemapItemClick(2);
        assert.strictEqual(selectedIdx, 2, "Should select command card 2 when pane2 is open");
    });

    test("renderTileVisualPreview generates SVG elements for BitmapData and PathData", () => {
        const { renderTileVisualPreview } = treemapModule;

        // BitmapData Op
        const bmpOpItem = {
            isOp: true,
            opCode: 101,
            name: "BitmapData",
            op: {
                mImageId: 1,
                mWidth: 64,
                mHeight: 64,
                mType: 2,
                mBitmap: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
            }
        };

        const bmpPreview = renderTileVisualPreview(bmpOpItem, 10, 10, 100, 100, true, true);
        assert.ok(bmpPreview.includes("<image"), "Should render SVG <image> tag for BitmapData");
        assert.ok(bmpPreview.includes("data:image/png"), "Should include png data URL");

        // PathData Op
        const pathOpItem = {
            isOp: true,
            opCode: 123,
            name: "PathData",
            op: {
                mId: 2,
                mOutputPath: [10, 0, 0, 11, 0, 0, 100, 100, 15, 16]
            }
        };

        const pathPreview = renderTileVisualPreview(pathOpItem, 10, 10, 100, 100, true, true);
        assert.ok(pathPreview.includes("<svg"), "Should render SVG container for PathData");
        assert.ok(pathPreview.includes("<path"), "Should render <path> tag for PathData");
        assert.ok(pathPreview.includes("M 0 0"), "Should include MoveTo path command");
    });
});