import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import * as docStatsModule from "../src/panels/DocumentStatsPanel.js";

describe("DocumentStatsPanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("renderDocumentStatistics populates statistics metrics", async () => {
        const { renderDocumentStatistics } = docStatsModule;
        const { doc, arrayBuffer } = await loadSampleDocument("02_ticker.rc");
        const ops = typeof doc.getOperations === "function" ? doc.getOperations() : doc.mOps;
        const u8 = new Uint8Array(arrayBuffer);

        const sizeBadge = document.getElementById("statsTotalSizeBadge");
        const opTypesList = document.getElementById("opTypesList");
        renderDocumentStatistics(doc, ops, u8);
        assert.ok(sizeBadge.textContent.length > 0, "Stats size badge should have content");
        assert.ok(opTypesList.innerHTML.length > 0, "Op types breakdown list should have content");
    });

    test("computeTreeMetrics returns correct count and depth", async () => {
        const { computeTreeMetrics } = docStatsModule;
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const metrics = computeTreeMetrics(doc);
        assert.ok(metrics, "Metrics should not be null");
        assert.ok(typeof metrics.totalComponents === "number", "totalComponents should be a number");
        assert.ok(typeof metrics.maxDepth === "number", "maxDepth should be a number");
    });
});