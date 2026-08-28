import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment } from "./test_helpers.js";
import * as stageModule from "../src/panels/StagePanel.js";

describe("StagePanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("formatDimensionNumber formats integers and decimals", () => {
        const { formatDimensionNumber } = stageModule;
        assert.strictEqual(formatDimensionNumber(100), "100");
        assert.strictEqual(formatDimensionNumber(100.55), "100.6");
        assert.strictEqual(formatDimensionNumber("200"), "200");
        assert.strictEqual(formatDimensionNumber(null), "");
    });

    test("applyStageDimensions updates canvas width and height properties and badge", () => {
        const { applyStageDimensions } = stageModule;
        const canvas = document.getElementById("previewCanvas");
        const badge = document.getElementById("docDimBadge");

        applyStageDimensions(400, 800);
        assert.strictEqual(canvas.width, 400);
        assert.strictEqual(canvas.height, 800);
        assert.ok(badge.textContent.includes("400x800"));
    });

    test("applyDensity updates density state and select input", () => {
        const { applyDensity } = stageModule;
        const select = document.getElementById("densitySelect");
        select.options = [{ value: "1" }, { value: "2" }, { value: "3" }];

        applyDensity(2.0);
        assert.strictEqual(select.value, "2");
    });

    test("toggleCanvasBg switches between dark and light themes", () => {
        const { toggleCanvasBg } = stageModule;
        const canvas = document.getElementById("previewCanvas");

        toggleCanvasBg();
        assert.strictEqual(canvas.style.background, "#0f172a");

        toggleCanvasBg();
        assert.strictEqual(canvas.style.background, "#ffffff");
    });

    test("updateStageScale computes downscale factor when stage is larger than workspace container", () => {
        const { updateStageScale, setStageScaleMode, applyStageDimensions } = stageModule;
        const workspace = document.getElementById("stageWorkspaceContainer");
        const wrapper = document.getElementById("canvasStageWrapper");
        const scaler = document.getElementById("canvasStageScaler");
        const canvas = document.getElementById("previewCanvas");

        workspace.clientWidth = 500;
        workspace.clientHeight = 500;

        setStageScaleMode("fit");
        applyStageDimensions(1000, 1000);

        // Available space: (500 - 32) = 468. Scale should be ~468 / 1000 = 0.468
        assert.ok(wrapper.style.transform.includes("scale("));
        assert.strictEqual(scaler.style.width, "468px");
        assert.strictEqual(scaler.style.height, "468px");
    });

    test("setStageScaleMode and toggleStageAutoScale manage active modes correctly", () => {
        const { setStageScaleMode, toggleStageAutoScale, updateStageScale } = stageModule;
        const workspace = document.getElementById("stageWorkspaceContainer");
        const wrapper = document.getElementById("canvasStageWrapper");
        const scaler = document.getElementById("canvasStageScaler");
        const autoScaleBtn = document.getElementById("stageAutoScaleBtn");

        workspace.clientWidth = 800;
        workspace.clientHeight = 800;

        setStageScaleMode("0.5");
        assert.strictEqual(stageModule.stageScaleMode, "0.5");
        assert.strictEqual(stageModule.currentStageScale, 0.5);
        assert.ok(wrapper.style.transform.includes("scale(0.5)"));

        toggleStageAutoScale();
        assert.strictEqual(stageModule.stageScaleMode, "fit");
        assert.strictEqual(stageModule.isStageAutoScale, true);
        assert.ok(autoScaleBtn.classList.contains("active"));

        toggleStageAutoScale();
        assert.strictEqual(stageModule.stageScaleMode, "1");
        assert.strictEqual(stageModule.isStageAutoScale, false);
    });
});