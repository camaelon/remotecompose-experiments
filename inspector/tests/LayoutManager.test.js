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

    test("CLUSTERS groups all 9 panels into the 3 functional groups", () => {
        const { CLUSTERS, PANEL_META } = layoutModule;
        assert.ok(CLUSTERS.document, "Document cluster should exist");
        assert.ok(CLUSTERS.runtime, "Runtime cluster should exist");
        assert.ok(CLUSTERS.output, "Output cluster should exist");

        const allClusteredPanels = [
            ...CLUSTERS.document.panels,
            ...CLUSTERS.runtime.panels,
            ...CLUSTERS.output.panels
        ];
        assert.strictEqual(allClusteredPanels.length, 9, "All 9 panels should be in clusters");
        assert.strictEqual(new Set(allClusteredPanels).size, 9, "No panel should appear in two clusters");
        Object.keys(PANEL_META).forEach(paneId => {
            assert.ok(allClusteredPanels.includes(paneId), `Panel ${paneId} should be in a cluster`);
        });
    });

    test("PANEL_PUCKS lists the 9 panels in working order", () => {
        const { PANEL_PUCKS } = layoutModule;
        assert.strictEqual(PANEL_PUCKS.length, 9, "Should contain all 9 panel pucks");
        assert.deepStrictEqual(PANEL_PUCKS.map(p => p.id),
            ['pane1', 'pane2', 'pane3', 'pane8', 'pane5', 'pane9', 'pane11', 'pane14', 'pane4'],
            "Player, Disassembly, Structure, Runtime, Variables, DAG, Environment, Binary, JSON");

        // Cluster runs stay contiguous so the bar's dividers fall between groups.
        const seq = PANEL_PUCKS.map(p => p.cluster);
        assert.deepStrictEqual(Array.from(new Set(seq)), ['document', 'runtime', 'output']);
    });

    test("merged panels declare their tabs and splits without overlap", () => {
        const { PANEL_SUBVIEWS, PANEL_SPLITS, SUBVIEW_HOST, SPLIT_HOST, PANEL_META } = layoutModule;

        // Every host is a real panel, and no sub-view is both a tab and a split section.
        Object.keys(PANEL_SUBVIEWS).forEach(host => assert.ok(PANEL_META[host], `${host} should be a panel`));
        Object.keys(PANEL_SPLITS).forEach(host => assert.ok(PANEL_META[host], `${host} should be a panel`));
        const tabs = Object.values(PANEL_SUBVIEWS).flat();
        const splits = Object.values(PANEL_SPLITS).flat();
        splits.forEach(id => assert.ok(!tabs.includes(id), `${id} should not be both a tab and a split`));

        // The tree views take turns; the box model sits beside them.
        assert.deepStrictEqual(PANEL_SUBVIEWS.pane3, ['sub_pane3', 'pane7', 'layers3d', 'pane17']);
        assert.deepStrictEqual(PANEL_SPLITS.pane3, ['pane13']);
        assert.strictEqual(SUBVIEW_HOST.pane7, 'pane3');
        assert.strictEqual(SPLIT_HOST.pane13, 'pane3');
        assert.strictEqual(SPLIT_HOST.pane6, 'pane5');
        // Environment opens on the size matrix.
        assert.strictEqual(PANEL_SUBVIEWS.pane11[0], 'pane12');
    });

    test("restorePanel routes an absorbed panel id to the host that now contains it", () => {
        const { restorePanel, hidePanel } = layoutModule;

        hidePanel(null, "pane3");
        restorePanel("pane7");
        assert.ok(!document.getElementById("pane3").classList.contains("hidden-panel"),
            "Restoring a tab should reveal its host panel");
        assert.ok(!document.getElementById("pane7").classList.contains("hidden-panel"),
            "The requested tab should be the visible one");

        hidePanel(null, "pane5");
        restorePanel("pane6");
        assert.ok(!document.getElementById("pane5").classList.contains("hidden-panel"),
            "Restoring a split section should reveal its host panel");
    });

    test("renderPanelPucks and togglePanelPuck manage the pucks bar and active states", () => {
        const { renderPanelPucks, togglePanelPuck, hidePanel } = layoutModule;
        const container = document.getElementById("panelPucksBar");

        renderPanelPucks();
        assert.ok(container.innerHTML.includes("puck_pane1"), "Should render puck for pane1");
        assert.ok(container.innerHTML.includes("puck_pane3"), "Should render puck for pane3");
        assert.ok(container.innerHTML.includes("puck_pane9"), "Should render puck for pane9");

        hidePanel(null, "pane3");
        assert.ok(document.getElementById("pane3").classList.contains("hidden-panel"), "pane3 hidden");

        togglePanelPuck("pane3");
        assert.ok(!document.getElementById("pane3").classList.contains("hidden-panel"), "pane3 visible after toggle");

        togglePanelPuck("pane3");
        assert.ok(document.getElementById("pane3").classList.contains("hidden-panel"), "pane3 hidden after toggling again");
    });

    test("a split section can be hidden and shown without disturbing its host", () => {
        const { toggleSplitSection, restorePanel, PANEL_SPLITS } = layoutModule;
        restorePanel("pane3");
        const host = document.getElementById("pane3");
        const section = document.getElementById("pane13");

        assert.ok(!host.classList.contains("hidden-panel"));
        assert.ok(PANEL_SPLITS.pane3.includes("pane13"));

        toggleSplitSection("pane3", "pane13");
        assert.ok(section.classList.contains("hidden-panel"), "the section hides");
        assert.ok(!host.classList.contains("hidden-panel"), "the host stays open");

        toggleSplitSection("pane3", "pane13");
        assert.ok(!section.classList.contains("hidden-panel"), "and comes back");
    });

    test("switching a tab leaves the split section alone", () => {
        const { switchPanelTab, restorePanel } = layoutModule;
        restorePanel("pane3");
        const layoutSection = document.getElementById("pane13");
        const before = layoutSection.classList.contains("hidden-panel");

        switchPanelTab("pane3", "pane7");
        assert.ok(!document.getElementById("pane7").classList.contains("hidden-panel"),
            "the requested tab is shown");
        assert.ok(document.getElementById("sub_pane3").classList.contains("hidden-panel"),
            "the previous tab is hidden");
        assert.strictEqual(layoutSection.classList.contains("hidden-panel"), before,
            "the box model is a split, not a tab, so a tab change must not touch it");
    });

    test("maximising a panel is reversible", () => {
        const { maximizePanel, restorePanel, lastPaneWidths } = layoutModule;
        restorePanel("pane2");
        const before = lastPaneWidths.pane2;

        maximizePanel(null, "pane2");
        maximizePanel(null, "pane2");
        assert.strictEqual(lastPaneWidths.pane2, before,
            "a second press restores the width the panel had, not a hardcoded default");
    });
});
