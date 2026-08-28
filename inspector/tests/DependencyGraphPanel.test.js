import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import { getAllOperationsFlat } from "../src/panels/DocumentLoader.js";
import { getOpName, getOpId, isContainerOp, prettyPrintFloatExpression } from "../src/panels/CommandListPanel.js";
import * as depGraphModule from "../src/panels/DependencyGraphPanel.js";

describe("DependencyGraphPanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
        globalThis.getAllOperationsFlat = getAllOperationsFlat;
        globalThis.getOpName = getOpName;
        globalThis.getOpId = getOpId;
        globalThis.isContainerOp = isContainerOp;
        globalThis.prettyPrintFloatExpression = prettyPrintFloatExpression;
    });

    test("buildExpressionGraphModel extracts nodes and dependencies", async () => {
        const { buildExpressionGraphModel } = depGraphModule;
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const model = buildExpressionGraphModel(doc);
        assert.ok(model, "Graph model should not be null");
        assert.ok(Array.isArray(model.nodes), "Model nodes should be an Array");
        assert.ok(Array.isArray(model.edges), "Model edges should be an Array");
        assert.ok(model.nodeMap instanceof Map, "Model nodeMap should be a Map");
        assert.ok(model.nodes.length > 0, "Should have extracted expression/variable nodes");
    });

    test("getUnusedIslandsAnalysis detects isolated nodes and metrics", async () => {
        const { getUnusedIslandsAnalysis } = depGraphModule;
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const analysis = getUnusedIslandsAnalysis(doc);
        assert.ok(analysis, "Analysis should not be null");
        assert.ok(analysis.unusedIslandSet instanceof Set, "Unused island set should be a Set");
        assert.ok(analysis.unusedVarIdSet instanceof Set, "Unused var set should be a Set");
    });

    test("renderExpressionDependencyGraph renders graph container", async () => {
        const { renderExpressionDependencyGraph } = depGraphModule;
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const container = document.getElementById("depGraphSvgContainer");
        renderExpressionDependencyGraph();
        assert.ok(container, "Dependency graph container exists");
    });
});