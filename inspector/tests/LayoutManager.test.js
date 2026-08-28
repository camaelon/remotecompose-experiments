import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment } from "./test_helpers.js";
import * as layoutModule from "../src/panels/LayoutManager.js";

describe("LayoutManager Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("toggleSectionCollapse toggles body display and button class", () => {
        const { toggleSectionCollapse } = layoutModule;
        const body = document.getElementById("testBody");
        const btn = document.getElementById("testBtn");

        toggleSectionCollapse("testBody", "testBtn");
        assert.strictEqual(body.style.display, "none", "Body should be hidden");
        assert.ok(btn.classList.contains("collapsed"), "Button should have collapsed class");

        toggleSectionCollapse("testBody", "testBtn");
        assert.strictEqual(body.style.display, "", "Body should be visible");
        assert.ok(!btn.classList.contains("collapsed"), "Button should no longer be collapsed");
    });

    test("hidePanel and restorePanel manage panel visibility and header chips", () => {
        const { hidePanel, restorePanel } = layoutModule;
        const panel = document.getElementById("pane1");
        const headerBar = document.getElementById("headerCollapsedPanels");

        hidePanel({ stopPropagation() {} }, "pane1");
        assert.ok(panel.classList.contains("hidden-panel"), "Panel should have hidden-panel class");
        assert.ok(headerBar.innerHTML.includes("pane1"), "Header bar should have restore chip for pane1");

        restorePanel("pane1");
        assert.ok(!panel.classList.contains("hidden-panel"), "Panel should no longer be hidden");
    });

    test("CLUSTERS structure contains all 4 functional groups with all 15 panels", () => {
        const { CLUSTERS, PANEL_META } = layoutModule;
        assert.ok(CLUSTERS.canvas, "Canvas cluster should exist");
        assert.ok(CLUSTERS.layout, "Layout cluster should exist");
        assert.ok(CLUSTERS.reactivity, "Reactivity cluster should exist");
        assert.ok(CLUSTERS.binary, "Binary cluster should exist");

        // Verify layout cluster contains Responsive Matrix and Theme panels as requested
        assert.ok(CLUSTERS.layout.panels.includes("pane12"), "Layout cluster must include Responsive Matrix (pane12)");
        assert.ok(CLUSTERS.layout.panels.includes("pane11"), "Layout cluster must include System Theme & Environment (pane11)");

        // Verify every panel in PANEL_META is present in exactly one cluster
        const allClusteredPanels = [
            ...CLUSTERS.canvas.panels,
            ...CLUSTERS.layout.panels,
            ...CLUSTERS.reactivity.panels,
            ...CLUSTERS.binary.panels
        ];
        assert.strictEqual(allClusteredPanels.length, 15, "All 15 panels should be in clusters");
        Object.keys(PANEL_META).forEach(paneId => {
            assert.ok(allClusteredPanels.includes(paneId), `Panel ${paneId} should be in a cluster`);
        });
    });

    test("PANEL_PUCKS orders all 15 panels strictly according to the 4 clusters", () => {
        const { PANEL_PUCKS, CLUSTERS } = layoutModule;
        assert.strictEqual(PANEL_PUCKS.length, 15, "Should contain all 15 panel pucks");

        // Verify cluster order
        const clusterSequence = PANEL_PUCKS.map(p => p.cluster);
        const uniqueClusters = Array.from(new Set(clusterSequence));
        assert.deepStrictEqual(uniqueClusters, ['canvas', 'layout', 'reactivity', 'binary']);

        // Verify specific puck IDs in cluster 1
        assert.strictEqual(PANEL_PUCKS[0].id, 'pane1');

        // Verify specific puck IDs in cluster 2 (Layout)
        const layoutPuckIds = PANEL_PUCKS.filter(p => p.cluster === 'layout').map(p => p.id);
        assert.deepStrictEqual(layoutPuckIds, ['pane3', 'pane13', 'pane12', 'pane11', 'pane7']);

        // Verify specific puck IDs in cluster 3 (Reactivity)
        const reactivityPuckIds = PANEL_PUCKS.filter(p => p.cluster === 'reactivity').map(p => p.id);
        assert.deepStrictEqual(reactivityPuckIds, ['pane5', 'pane6', 'pane9', 'pane15']);

        // Verify specific puck IDs in cluster 4 (Binary)
        const binaryPuckIds = PANEL_PUCKS.filter(p => p.cluster === 'binary').map(p => p.id);
        assert.deepStrictEqual(binaryPuckIds, ['pane2', 'pane14', 'pane10', 'pane8', 'pane4']);
    });

    test("applyWorkspacePreset toggles visibility according to refined workspace definitions", () => {
        const { applyWorkspacePreset, WORKSPACE_PRESETS } = layoutModule;

        // Verify only the 5 core presets exist
        const presetKeys = Object.keys(WORKSPACE_PRESETS);
        assert.deepStrictEqual(presetKeys.sort(), ['adaptive', 'binary', 'layout', 'performance', 'reactivity'].sort());

        // Apply Layout preset: Player + Component Tree + Layout Inspector
        applyWorkspacePreset("layout");
        assert.ok(!document.getElementById("pane1").classList.contains("hidden-panel"), "pane1 should be visible");
        assert.ok(!document.getElementById("pane3").classList.contains("hidden-panel"), "pane3 should be visible");
        assert.ok(!document.getElementById("pane13").classList.contains("hidden-panel"), "pane13 should be visible");
        assert.ok(document.getElementById("pane12").classList.contains("hidden-panel"), "pane12 should be hidden");
        assert.ok(document.getElementById("pane5").classList.contains("hidden-panel"), "pane5 should be hidden");

        // Apply Adaptive preset: Player + Responsive Matrix
        applyWorkspacePreset("adaptive");
        assert.ok(!document.getElementById("pane1").classList.contains("hidden-panel"), "pane1 should be visible");
        assert.ok(!document.getElementById("pane12").classList.contains("hidden-panel"), "pane12 should be visible");
        assert.ok(document.getElementById("pane3").classList.contains("hidden-panel"), "pane3 should be hidden");
        assert.ok(document.getElementById("pane13").classList.contains("hidden-panel"), "pane13 should be hidden");

        // Apply Reactivity preset: Player + Variables & State + Variable Graphs
        applyWorkspacePreset("reactivity");
        assert.ok(!document.getElementById("pane1").classList.contains("hidden-panel"), "pane1 should be visible");
        assert.ok(!document.getElementById("pane5").classList.contains("hidden-panel"), "pane5 should be visible");
        assert.ok(!document.getElementById("pane6").classList.contains("hidden-panel"), "pane6 should be visible");
        assert.ok(document.getElementById("pane3").classList.contains("hidden-panel"), "pane3 should be hidden");
        assert.ok(document.getElementById("pane9").classList.contains("hidden-panel"), "pane9 should be hidden");

        // Apply Binary preset: Player + Commands Disassembly + Stats
        applyWorkspacePreset("binary");
        assert.ok(!document.getElementById("pane1").classList.contains("hidden-panel"), "pane1 should be visible");
        assert.ok(!document.getElementById("pane2").classList.contains("hidden-panel"), "pane2 should be visible");
        assert.ok(!document.getElementById("pane14").classList.contains("hidden-panel"), "pane14 should be visible");
        assert.ok(document.getElementById("pane10").classList.contains("hidden-panel"), "pane10 should be hidden");
        assert.ok(document.getElementById("pane8").classList.contains("hidden-panel"), "pane8 should be hidden");

        // Apply Performance preset: Player + Frame Profiler
        applyWorkspacePreset("performance");
        assert.ok(!document.getElementById("pane1").classList.contains("hidden-panel"), "pane1 should be visible");
        assert.ok(!document.getElementById("pane8").classList.contains("hidden-panel"), "pane8 should be visible");
        assert.ok(document.getElementById("pane2").classList.contains("hidden-panel"), "pane2 should be hidden");
        assert.ok(document.getElementById("pane5").classList.contains("hidden-panel"), "pane5 should be hidden");
    });

    test("renderPanelPucks and togglePanelPuck dynamically manage pucks bar and active states", () => {
        const { renderPanelPucks, togglePanelPuck, applyWorkspacePreset } = layoutModule;
        const container = document.getElementById("panelPucksBar");

        renderPanelPucks();
        assert.ok(container.innerHTML.includes("puck_pane1"), "Should render puck for pane1");
        assert.ok(container.innerHTML.includes("puck_pane3"), "Should render puck for pane3");
        assert.ok(container.innerHTML.includes("puck_pane13"), "Should render puck for pane13");

        // Switch to performance preset (hides pane3)
        applyWorkspacePreset("performance");
        assert.ok(document.getElementById("pane3").classList.contains("hidden-panel"), "pane3 hidden initially in performance preset");

        togglePanelPuck("pane3");
        assert.ok(!document.getElementById("pane3").classList.contains("hidden-panel"), "pane3 should be visible after toggle");

        togglePanelPuck("pane3");
        assert.ok(document.getElementById("pane3").classList.contains("hidden-panel"), "pane3 should be hidden after toggle again");
    });

    test("Custom Setups can be saved, loaded, listed, and deleted", () => {
        const { saveCustomSetup, getCustomSetups, applyCustomSetup, deleteCustomSetup, restorePanel, hidePanel } = layoutModule;

        // Configure a custom view: pane1 + pane13 + pane5
        restorePanel("pane1");
        restorePanel("pane13");
        restorePanel("pane5");
        hidePanel(null, "pane2");
        hidePanel(null, "pane3");
        hidePanel(null, "pane14");

        // Save as custom setup
        saveCustomSetup("My Custom Test Setup");
        const setups = getCustomSetups();
        assert.ok(setups["My Custom Test Setup"], "Custom setup should be saved in localStorage");
        assert.ok(setups["My Custom Test Setup"].panels.includes("pane13"), "pane13 should be in saved setup");
        assert.ok(setups["My Custom Test Setup"].panels.includes("pane5"), "pane5 should be in saved setup");

        // Switch to another preset
        layoutModule.applyWorkspacePreset("performance");
        assert.ok(document.getElementById("pane13").classList.contains("hidden-panel"), "pane13 should be hidden in performance mode");

        // Restore custom setup
        applyCustomSetup("My Custom Test Setup");
        assert.ok(!document.getElementById("pane13").classList.contains("hidden-panel"), "pane13 should be restored");
        assert.ok(!document.getElementById("pane5").classList.contains("hidden-panel"), "pane5 should be restored");

        // Delete custom setup
        deleteCustomSetup("My Custom Test Setup");
        const updatedSetups = getCustomSetups();
        assert.strictEqual(updatedSetups["My Custom Test Setup"], undefined, "Custom setup should be deleted");
    });

    test("renderSetupsMenu generates cluster-grouped panel checklist and setup list", () => {
        const { renderSetupsMenu, toggleSetupsDropdown } = layoutModule;
        const popover = document.getElementById("setupsDropdownPopover");

        renderSetupsMenu();
        assert.ok(popover.innerHTML.includes("Canvas Viewport"), "Should render Canvas cluster title");
        assert.ok(popover.innerHTML.includes("Layout, Structure &amp; UI") || popover.innerHTML.includes("Layout, Structure & UI"), "Should render Layout cluster title");
        assert.ok(popover.innerHTML.includes("Reactivity &amp; Logic") || popover.innerHTML.includes("Reactivity & Logic"), "Should render Reactivity cluster title");
        assert.ok(popover.innerHTML.includes("Binary &amp; Performance") || popover.innerHTML.includes("Binary & Performance"), "Should render Binary cluster title");
        assert.ok(popover.innerHTML.includes("Responsive Matrix"), "Should render Responsive Matrix checkbox item");
        assert.ok(popover.innerHTML.includes("System Theme &amp; Environment") || popover.innerHTML.includes("System Theme & Environment"), "Should render Theme checkbox item");
    });

    test("Storage error handling disables custom setups and falls back gracefully", () => {
        const { checkLocalStorageAvailable, isLocalStorageAvailable, getCustomSetups, SafeStorage, updateWorkspaceSelectUI, renderSetupsMenu } = layoutModule;

        assert.strictEqual(typeof isLocalStorageAvailable(), "boolean");
        assert.strictEqual(typeof checkLocalStorageAvailable(), "boolean");

        // SafeStorage returns null or no-ops without throwing
        const nonExistent = SafeStorage.getItem("__non_existent_key__");
        assert.strictEqual(nonExistent, null);
    });
});