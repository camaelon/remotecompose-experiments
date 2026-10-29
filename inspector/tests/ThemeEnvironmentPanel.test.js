import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import * as themeModule from "../src/panels/ThemeEnvironmentPanel.js";

describe("ThemeEnvironmentPanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("THEME_MODES and THEME_LABELS constants are correctly configured", () => {
        const { THEME_MODES, THEME_LABELS } = themeModule;
        assert.strictEqual(THEME_MODES.UNSPECIFIED, -1);
        assert.strictEqual(THEME_MODES.DARK, -2);
        assert.strictEqual(THEME_MODES.LIGHT, -3);

        assert.ok(THEME_LABELS[-1]);
        assert.ok(THEME_LABELS[-2]);
        assert.ok(THEME_LABELS[-3]);
        assert.strictEqual(THEME_LABELS[-2].name, "Dark Theme");
        assert.strictEqual(THEME_LABELS[-3].name, "Light Theme");
    });

    test("Color conversion utilities (intToHexColor, hexToArgbInt, intToRgbaString)", () => {
        const { intToHexColor, hexToArgbInt, intToRgbaString } = themeModule;

        // Red (0xFFFF0000 = -65536)
        assert.strictEqual(intToHexColor(-65536), "#ff0000");
        assert.strictEqual(hexToArgbInt("#ff0000"), -65536);
        assert.strictEqual(intToRgbaString(-65536), "rgba(255, 0, 0, 1.00)");

        // Green (0xFF00FF00 = -16711936)
        assert.strictEqual(intToHexColor(-16711936), "#00ff00");
        assert.strictEqual(hexToArgbInt("#00ff00"), -16711936);

        // 3-digit shorthand #F00 -> #FF0000
        assert.strictEqual(hexToArgbInt("#f00"), -65536);
    });

    test("categorizeColorToken groups tokens into expected categories", () => {
        const { categorizeColorToken } = themeModule;

        assert.strictEqual(categorizeColorToken("color.system_accent1_900").key, "accent1");
        assert.strictEqual(categorizeColorToken("color.system_accent2_800").key, "accent2");
        assert.strictEqual(categorizeColorToken("color.system_accent3_600").key, "accent3");
        assert.strictEqual(categorizeColorToken("color.system_on_surface_light").key, "neutral");
        assert.strictEqual(categorizeColorToken("color.system_neutral2_800").key, "neutral");
        assert.strictEqual(categorizeColorToken("color.system_error_500").key, "error");
        assert.strictEqual(categorizeColorToken("custom_card_tint").key, "custom");
    });

    test("extractDocumentThemeTokens extracts all named tokens from 02_ticker.rc", async () => {
        const { extractDocumentThemeTokens } = themeModule;
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const tokens = extractDocumentThemeTokens(doc);
        assert.ok(tokens, "Tokens object should not be null");
        assert.strictEqual(tokens.hasThemeOps, true, "02_ticker.rc has Theme opcodes");
        assert.ok(tokens.namedColors.length >= 12, "Should extract >= 12 color tokens");

        // Verify specific known tokens
        const tokenNames = tokens.namedColors.map(t => t.name);
        assert.ok(tokenNames.includes("color.system_accent2_800"));
        assert.ok(tokenNames.includes("color.system_accent2_50"));
        assert.ok(tokenNames.includes("color.system_on_surface_light"));
        assert.ok(tokenNames.includes("color.system_on_surface_dark"));
        assert.ok(tokenNames.includes("color.system_accent1_900"));

        // Verify system float tokens
        const floatNames = tokens.namedFloats.map(t => t.name);
        assert.ok(floatNames.includes("system.font_size"));
    });

    test("generateM3TonalPalette generates complete tonal palette from seed color", () => {
        const { generateM3TonalPalette } = themeModule;
        const palette = generateM3TonalPalette("#1a73e8");

        assert.ok(palette, "Palette should not be null");
        assert.ok(typeof palette["color.system_accent1_900"] === "number");
        assert.ok(typeof palette["color.system_accent1_50"] === "number");
        assert.ok(typeof palette["color.system_accent2_800"] === "number");
        assert.ok(typeof palette["color.system_accent3_600"] === "number");
        assert.ok(typeof palette["color.system_on_surface_light"] === "number");
        assert.ok(typeof palette["color.system_on_surface_dark"] === "number");
    });

    test("setDocumentTheme switches theme and updates player and active mode", async () => {
        const { setDocumentTheme, getActiveThemeMode, THEME_MODES } = themeModule;
        const { player, doc } = await loadSampleDocument("02_ticker.rc");

        setDocumentTheme(THEME_MODES.DARK, false);
        assert.strictEqual(getActiveThemeMode(), THEME_MODES.DARK);
        assert.strictEqual(player.themeOverride, THEME_MODES.DARK);

        setDocumentTheme(THEME_MODES.LIGHT, false);
        assert.strictEqual(getActiveThemeMode(), THEME_MODES.LIGHT);
        assert.strictEqual(player.themeOverride, THEME_MODES.LIGHT);
    });

    test("overrideNamedColor and resetAllThemeOverrides manipulate live variables", async () => {
        const { overrideNamedColor, resetAllThemeOverrides } = themeModule;
        const { player, doc } = await loadSampleDocument("02_ticker.rc");

        overrideNamedColor("color.system_accent2_800", "#00ff00");
        const ctx = player.getRemoteContext();
        assert.strictEqual(ctx.getColor(42), -16711936);

        resetAllThemeOverrides();
    });

    test("renderThemeEnvironmentPanel populates theme container", async () => {
        const { renderThemeEnvironmentPanel } = themeModule;
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const container = document.getElementById("themeEnvContainer");
        renderThemeEnvironmentPanel(doc);
        assert.ok(container.innerHTML.length > 0, "Theme container should have content");
        assert.ok(container.innerHTML.includes("System Theme Mode"));
        assert.ok(container.innerHTML.includes("Document Named Color Tokens"));
    });
});
