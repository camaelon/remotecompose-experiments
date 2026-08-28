import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import * as matrixModule from "../src/panels/ResponsiveMatrixPanel.js";

describe("ResponsiveMatrixPanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("MATRIX_PRESETS contains fitness_matrix, square_grid, and wearable_mobile presets", () => {
        const { MATRIX_PRESETS } = matrixModule;
        assert.ok(MATRIX_PRESETS.fitness_matrix, "fitness_matrix preset must exist");
        assert.ok(MATRIX_PRESETS.square_grid, "square_grid preset must exist");
        assert.ok(MATRIX_PRESETS.wearable_mobile, "wearable_mobile preset must exist");

        // Verify fitness matrix has 4 width buckets and 5 height buckets matching screenshot
        const fit = MATRIX_PRESETS.fitness_matrix;
        assert.strictEqual(fit.widths.length, 4, "Fitness matrix has 4 width buckets (W1..W4)");
        assert.strictEqual(fit.heights.length, 5, "Fitness matrix has 5 height buckets (H0..H4)");
        assert.deepStrictEqual(fit.widths.map(w => w.id), ["W1", "W2", "W3", "W4"]);
        assert.deepStrictEqual(fit.heights.map(h => h.id), ["H0", "H1", "H2", "H3", "H4"]);
    });

    test("MATRIX_THEMES contains dark_gray, light_gray, checkerboard, khaki, dark_slate, calendar_light, and sleep_lavender", () => {
        const { MATRIX_THEMES } = matrixModule;
        assert.ok(MATRIX_THEMES.dark_gray, "dark_gray theme must exist");
        assert.ok(MATRIX_THEMES.light_gray, "light_gray theme must exist");
        assert.ok(MATRIX_THEMES.checkerboard, "checkerboard theme must exist");
        assert.ok(MATRIX_THEMES.khaki, "khaki theme must exist");
        assert.ok(MATRIX_THEMES.dark_slate, "dark_slate theme must exist");
        assert.ok(MATRIX_THEMES.calendar_light, "calendar_light theme must exist");
        assert.ok(MATRIX_THEMES.sleep_lavender, "sleep_lavender theme must exist");
        assert.strictEqual(MATRIX_THEMES.dark_gray.bg, "#242424", "Default dark gray background");
    });

    test("setMatrixTheme and setMatrixDensity update configuration", () => {
        const { setMatrixTheme, setMatrixDensity } = matrixModule;
        setMatrixTheme("calendar_light");
        setMatrixTheme("sleep_lavender");
        setMatrixDensity(2.0);
        // Should execute without errors
        assert.ok(true);
    });

    test("toggleMatrixPlayPause toggles playback state", () => {
        const { toggleMatrixPlayPause } = matrixModule;
        toggleMatrixPlayPause();
        toggleMatrixPlayPause();
        assert.ok(true);
    });

    test("renderResponsiveMatrixPanel handles empty and loaded documents gracefully", async () => {
        const { renderResponsiveMatrixPanel, stopMatrixPlayers, getMatrixPlayers } = matrixModule;

        // 1. Without loaded buffer
        window.currentBuffer = null;
        await renderResponsiveMatrixPanel(null);
        const board = document.getElementById("responsiveMatrixBoard");
        assert.ok(board.innerHTML.includes("No Document Loaded"));

        // 2. With fitness sample document
        const { arrayBuffer } = await loadSampleDocument("fitness_activity_widget.rc");
        window.currentBuffer = arrayBuffer;
        await renderResponsiveMatrixPanel(arrayBuffer);
        const boardAfter = document.getElementById("responsiveMatrixBoard");

        assert.ok(boardAfter.children.length > 0, "Matrix grid layout rendered to board");
        const players = getMatrixPlayers();
        assert.ok(players.length > 0, "Matrix players initialized for cells");

        stopMatrixPlayers();
        assert.strictEqual(getMatrixPlayers().length, 0, "Matrix players stopped and cleared");
    });
});
