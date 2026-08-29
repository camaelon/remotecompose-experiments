// =========================================================================
// Workspace & Layout Manager (Resizers, Panel Toggles, Key Nav, Lookup)
// Modularized in src/panels/LayoutManager.js
// =========================================================================

import { renderRunningOperationsTree, __rtOpRegistry } from './ComponentTreePanel.js';
import { jsonEditor } from './JsonEditorPanel.js';
import { updateVariablesPanel, renderGraphCanvas, updateGraphLegend } from './VariablesPanel.js';
import { drawProfiler } from './ProfilerPanel.js';
import { renderExpressionDependencyGraph } from './DependencyGraphPanel.js';
import { renderRepaintPanel } from './RepaintPanel.js';
import { renderInteractionPanel } from './InteractionPanel.js';
import { renderAccessibilityPanel } from './AccessibilityPanel.js';
import {
    stepOpForward,
    stepOpBackward,
    togglePlayPause,
    resetStepToStart,
    stepOpToEnd,
    buildExecutionTrace
} from './StagePanel.js';

import { renderBinaryTreemapPanel, updateTreemapUI } from './BinaryTreemapPanel.js';
import { renderThemeEnvironmentPanel } from './ThemeEnvironmentPanel.js';
import { renderResponsiveMatrixPanel } from './ResponsiveMatrixPanel.js';
import { renderLayoutInspectorPanel } from './LayoutInspectorPanel.js';
import { renderDocumentStatistics } from './DocumentStatsPanel.js';

export const DEFAULT_PANE_WIDTHS = {
    pane1: '480px',
    pane2: '760px',
    pane3: '620px',
    pane4: '440px',
    pane5: '640px',
    pane8: '480px',
    pane9: '480px',
    pane11: '640px',
    pane14: '480px'
};

// Live widths, updated as panels are dragged.
export const lastPaneWidths = { ...DEFAULT_PANE_WIDTHS };

export const PANEL_META = {
    pane1: { name: 'Player & Controls', icon: '🎨' },
    pane2: { name: 'Commands List (Document Wire)', icon: '📜' },
    pane3: { name: 'Structure (Trees, Layout, Accessibility)', icon: '🌳' },
    pane4: { name: 'JSON Source (Experimental)', icon: '⚙️' },
    pane5: { name: 'Variables (Values & Graphs)', icon: '🎛️' },
    pane8: { name: 'Runtime (Profiler, Repaint, Interaction)', icon: '⚡' },
    pane9: { name: 'Expression Dependency Graph', icon: '🧬' },
    pane11: { name: 'Environment (Theme & Size Matrix)', icon: '🌗' },
    pane14: { name: 'Statistics (Overview & Treemap)', icon: '📊' }
};

export const CLUSTERS = {
    document: {
        id: 'document',
        name: 'Document',
        icon: '📄',
        panels: ['pane1', 'pane2', 'pane3']
    },
    runtime: {
        id: 'runtime',
        name: 'Runtime & Logic',
        icon: '⚡',
        panels: ['pane8', 'pane5', 'pane9']
    },
    output: {
        id: 'output',
        name: 'Environment & Output',
        icon: '📦',
        panels: ['pane11', 'pane14', 'pane4']
    }
};

// The panel bar reads left to right in the order you work: what the document is, then what
// it does when it runs, then what it renders to and compiles into.
export const PANEL_PUCKS = [
    { id: 'pane1', cluster: 'document', name: 'Player', icon: '🎨' },
    { id: 'pane2', cluster: 'document', name: 'Disassembly', icon: '📜' },
    { id: 'pane3', cluster: 'document', name: 'Structure', icon: '🌳' },
    { id: 'pane8', cluster: 'runtime', name: 'Runtime', icon: '⚡' },
    { id: 'pane5', cluster: 'runtime', name: 'Variables', icon: '🎛️' },
    { id: 'pane9', cluster: 'runtime', name: 'DAG', icon: '🧬' },
    { id: 'pane11', cluster: 'output', name: 'Environment', icon: '🌗' },
    { id: 'pane14', cluster: 'output', name: 'Statistics', icon: '📊' },
    { id: 'pane4', cluster: 'output', name: 'JSON', icon: '⚙️' }
];

// Panels a fresh session opens with.
export const DEFAULT_PANELS = ['pane1', 'pane2'];


// =========================================================================
// Merged panels
//
// Several panels answered one question between them — two views of the same tree, a
// treemap of the statistics next to it, a graph of the variable beside its value. They are
// now tabbed sub-views of a single host panel, which keeps the panel bar readable and stops
// four columns fighting over the same width.
//
// A sub-view keeps the element id its panel had, so every existing lookup, visibility guard
// and `restorePanel('pane6')` call site keeps working: `restorePanel` routes an absorbed id
// to its host and selects the right tab.
// =========================================================================

// Views that share a host by taking turns. Only one is on screen at a time.
export const PANEL_SUBVIEWS = {
    pane3: ['sub_pane3', 'pane7', 'pane17'],
    pane14: ['sub_pane14', 'pane10'],
    // Runtime: what the document does once it is running.
    pane8: ['sub_pane8', 'pane15', 'pane16'],
    // Environment: the conditions the document renders under — theme, then screen size.
    pane11: ['pane12', 'sub_pane11']
};

// Views that share a host by splitting it, because you need to see them at the same time:
// you pick a component in the tree and read its box model, or tick a variable and watch it
// plot. Tabbing those would defeat the point.
export const PANEL_SPLITS = {
    pane3: ['pane13'],
    pane5: ['sub_pane5', 'pane6']
};

/** Split section id -> the host panel it is always visible inside. */
export const SPLIT_HOST = (() => {
    const map = {};
    Object.entries(PANEL_SPLITS).forEach(([host, parts]) => {
        parts.forEach(part => { if (part !== `sub_${host}`) map[part] = host; });
    });
    return map;
})();

/** Absorbed pane id -> the host panel that now contains it. */
export const SUBVIEW_HOST = (() => {
    const map = {};
    Object.entries(PANEL_SUBVIEWS).forEach(([host, subs]) => {
        subs.forEach(sub => { if (sub !== `sub_${host}`) map[sub] = host; });
    });
    return map;
})();

/** Refresh whichever panel a sub-view id belongs to, reusing the per-panel render hooks. */
function renderSubview(subId) {
    const doc = window.currentDocument;
    if (subId === 'pane7') renderRunningOperationsTree(doc);
    else if (subId === 'pane13') renderLayoutInspectorPanel(doc);
    else if (subId === 'pane10') updateTreemapUI();
    else if (subId === 'pane6') { updateGraphLegend(); setTimeout(() => renderGraphCanvas(), 30); }
    else if (subId === 'pane17') renderAccessibilityPanel();
    else if (subId === 'pane15') renderRepaintPanel();
    else if (subId === 'pane16') renderInteractionPanel();
    else if (subId === 'pane12') renderResponsiveMatrixPanel(window.currentBuffer || window.currentDocument);
    else if (subId === 'sub_pane11') renderThemeEnvironmentPanel(window.currentDocument);
    else if (subId === 'sub_pane5') updateVariablesPanel();
    else if (subId === 'sub_pane8') {
        if (window.currentPlayer && typeof window.currentPlayer.repaint === 'function') window.currentPlayer.repaint();
        drawProfiler();
    }
    else if (subId === 'sub_pane14') {
        const u8 = window.currentU8Buffer || (window.currentBuffer ? new Uint8Array(window.currentBuffer) : null);
        renderDocumentStatistics(doc, window.allOps || window.currentParsedOps, u8);
    }
}

/** Render everything currently on screen in a host panel. */
function renderHostPanel(hostId) {
    const tabs = PANEL_SUBVIEWS[hostId];
    if (tabs) {
        const active = tabs.find(id => {
            const el = document.getElementById(id);
            return el && !el.classList.contains('hidden-panel');
        }) || tabs[0];
        if (active) renderSubview(active);
    }
    (PANEL_SPLITS[hostId] || []).forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden-panel')) renderSubview(id);
    });
}

/**
 * Drag-to-resize for a split host. The two sections share the panel's height, so the drag
 * sets the top section's flex-basis and lets the bottom take the rest.
 */
export function initSplitDividers() {
    document.querySelectorAll('.split-divider').forEach(divider => {
        if (divider.dataset.wired === '1') return;
        divider.dataset.wired = '1';
        divider.addEventListener('pointerdown', (e) => {
            const split = divider.parentElement;
            const primary = split && split.querySelector('.split-primary');
            if (!primary) return;
            e.preventDefault();
            divider.classList.add('dragging');
            divider.setPointerCapture(e.pointerId);
            const startX = e.clientX;
            const startW = primary.getBoundingClientRect().width;
            const total = split.getBoundingClientRect().width;

            const onMove = (ev) => {
                const w = Math.max(140, Math.min(total - 160, startW + (ev.clientX - startX)));
                primary.style.flex = `0 0 ${w}px`;
            };
            const onUp = (ev) => {
                divider.classList.remove('dragging');
                try { divider.releasePointerCapture(ev.pointerId); } catch (_) {}
                divider.removeEventListener('pointermove', onMove);
                divider.removeEventListener('pointerup', onUp);
            };
            divider.addEventListener('pointermove', onMove);
            divider.addEventListener('pointerup', onUp);
        });
    });
}

/**
 * Show or hide one half of a split host. The pairing is useful, not obligatory: you may want
 * the tree on its own, or the variable list without the plot, and either half can take the
 * whole panel when the other is off.
 */
export function toggleSplitSection(hostId, sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const showing = section.classList.contains('hidden-panel');
    section.classList.toggle('hidden-panel', !showing);

    // The divider only means something while both halves are on screen.
    const divider = section.previousElementSibling;
    if (divider && divider.classList.contains('split-divider')) {
        divider.classList.toggle('hidden-panel', !showing);
    }
    const btn = document.getElementById(`split_${sectionId}`);
    if (btn) btn.classList.toggle('active', showing);

    if (showing) renderSubview(sectionId);
}

export function switchPanelTab(hostId, subId) {
    const subs = PANEL_SUBVIEWS[hostId];
    if (!subs) return;
    subs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden-panel', id !== subId);
        const tab = document.getElementById(`tab_${id.replace(/^sub_/, '')}`);
        if (tab) tab.classList.toggle('active', id === subId);
    });
    renderSubview(subId);
}

/**
 * Give a panel its remembered width and stop it growing into whatever space is free.
 * Panels are meant to keep the size you gave them — a lone panel stretching to fill a wide
 * window is what made it look unresizable, since there was nothing left to drag towards.
 */
export function applyPaneWidth(paneId, pane) {
    const el = pane || document.getElementById(paneId);
    if (!el) return;
    const width = lastPaneWidths[paneId] || DEFAULT_PANE_WIDTHS[paneId];
    if (!width) return;
    el.style.width = width;
    el.style.flex = 'none';
}

/** Show the panels a fresh session opens with. */
export function applyDefaultLayout() {
    applyWorkspace(DEFAULT_PANELS);
}

export function hidePanel(event, paneId) {
    if (event) event.stopPropagation();
    const pane = document.getElementById(paneId);
    if (!pane) return;

    pane.classList.add('hidden-panel');
    updateHeaderCollapsedBar();
    updatePanelPucks();
    updateResizersVisibility();
}

export function restorePanel(paneId) {
    // An absorbed panel is now a tab: show its host and select it.
    const host = SUBVIEW_HOST[paneId];
    if (host) {
        restorePanel(host);
        switchPanelTab(host, paneId);
        return;
    }
    // A split section is always on screen inside its host — showing the host is enough.
    const splitHost = SPLIT_HOST[paneId];
    if (splitHost) {
        restorePanel(splitHost);
        const section = document.getElementById(paneId);
        if (section && section.classList.contains('hidden-panel')) toggleSplitSection(splitHost, paneId);
        return;
    }

    const pane = document.getElementById(paneId);
    if (!pane) return;

    pane.classList.remove('hidden-panel');
    applyPaneWidth(paneId, pane);
    updateHeaderCollapsedBar();
    updatePanelPucks();
    updateResizersVisibility();
    if (paneId === 'pane4' && jsonEditor) {
        setTimeout(() => jsonEditor.refresh(), 50);
    }
    if (PANEL_SUBVIEWS[paneId] || PANEL_SPLITS[paneId]) {
        renderHostPanel(paneId);
    }
    if (paneId === 'pane9') {
        renderExpressionDependencyGraph();
    }
}

export function updateHeaderCollapsedBar() {
    const container = document.getElementById('headerCollapsedPanels');
    if (!container) return;

    let html = '';
    Object.keys(PANEL_META).forEach(paneId => {
        const pane = document.getElementById(paneId);
        if (pane && pane.classList.contains('hidden-panel')) {
            const meta = PANEL_META[paneId];
            html += `
                <button class="collapsed-panel-chip" onclick="restorePanel('${paneId}')" title="Click to restore ${meta.name}">
                    <span>${meta.icon}</span>
                    <span>${meta.name}</span>
                    <span style="font-weight:bold; font-size:0.85rem;">+</span>
                </button>
            `;
        }
    });

    container.innerHTML = html;
}


export function updateResizersVisibility() {
    // A handle reads as a divider, so it only earns its place between two panels. A trailing
    // one sitting past the last panel does resize that panel, but nothing about it says so —
    // it looks like a stray control. The single exception is a lone open panel: with nothing
    // to divide it would otherwise have no way to be resized at all.
    const isVisible = (el) => el && !el.classList.contains('hidden-panel');
    const openPanels = Array.from(document.querySelectorAll('.panel')).filter(isVisible);
    const onlyOnePanel = openPanels.length === 1;

    document.querySelectorAll('.panel-resizer').forEach(resizer => {
        const pane = document.getElementById(resizer.dataset.resizePane);
        if (!isVisible(pane)) { resizer.style.display = 'none'; return; }

        let dividesTwo = false;
        let node = resizer.nextElementSibling;
        while (node) {
            if (node.classList.contains('panel') && isVisible(node)) { dividesTwo = true; break; }
            node = node.nextElementSibling;
        }
        resizer.style.display = (dividesTwo || onlyOnePanel) ? '' : 'none';
    });
}

// --- Safe Storage & Sandbox Detection (e.g. x20web without allow-same-origin) ---
let _storageChecked = false;
let _hasLocalStorage = false;

export function checkLocalStorageAvailable() {
    if (_storageChecked) return _hasLocalStorage;
    _storageChecked = true;
    _hasLocalStorage = false;
    try {
        if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage !== null) {
            const probe = '__rc_probe_storage__';
            window.localStorage.setItem(probe, probe);
            window.localStorage.removeItem(probe);
            _hasLocalStorage = true;
        }
    } catch (_) {
        // Sandboxed environment without allow-same-origin throws SecurityError
        _hasLocalStorage = false;
    }
    return _hasLocalStorage;
}

export function isLocalStorageAvailable() {
    return _storageChecked ? _hasLocalStorage : checkLocalStorageAvailable();
}

export const SafeStorage = {
    getItem(key) {
        if (!isLocalStorageAvailable()) return null;
        try {
            return window.localStorage.getItem(key);
        } catch (_) {
            return null;
        }
    },
    setItem(key, value) {
        if (!isLocalStorageAvailable()) return;
        try {
            window.localStorage.setItem(key, String(value));
        } catch (_) {}
    },
    removeItem(key) {
        if (!isLocalStorageAvailable()) return;
        try {
            window.localStorage.removeItem(key);
        } catch (_) {}
    }
};

// --- Workspace & Custom Setups Management ---


export function applyWorkspace(panelIds, activeKey = null, customWidths = null) {
    const targetSet = new Set(panelIds);
    // Ensure pane1 is always in targetSet
    targetSet.add('pane1');

    if (customWidths && typeof customWidths === 'object') {
        Object.entries(customWidths).forEach(([paneId, width]) => {
            if (width) lastPaneWidths[paneId] = width;
        });
    }

    Object.keys(PANEL_META).forEach(paneId => {
        const pane = document.getElementById(paneId);
        if (!pane) return;
        const shouldBeVisible = targetSet.has(paneId);
        const isCurrentlyVisible = !pane.classList.contains('hidden-panel');

        if (shouldBeVisible && !isCurrentlyVisible) {
            restorePanel(paneId);
        } else if (!shouldBeVisible && isCurrentlyVisible) {
            pane.classList.add('hidden-panel');
        } else if (shouldBeVisible) {
            // Already on screen from the markup, so restorePanel never ran for it — it still
            // needs its width, or it stretches to the window edge and its resize handle ends
            // up pinned there with nothing to drag towards.
            applyPaneWidth(paneId, pane);
        }
    });

    updateHeaderCollapsedBar();
    updateResizersVisibility();
    updatePanelPucks();

    if (activeKey) {
        SafeStorage.setItem('rc_active_workspace', activeKey);
    }
}







export function renderPanelPucks() {
    const container = document.getElementById('panelPucksBar');
    if (!container) return;

    let html = '';
    let currentCluster = null;

    PANEL_PUCKS.forEach((puck) => {
        if (puck.cluster !== currentCluster) {
            if (currentCluster !== null) {
                html += `<div class="puck-divider" title="Cluster separator"></div>`;
            }
            currentCluster = puck.cluster;
        }

        const pane = document.getElementById(puck.id);
        const isVisible = pane ? !pane.classList.contains('hidden-panel') : false;

        html += `
            <button class="panel-puck ${isVisible ? 'active' : ''}" id="puck_${puck.id}" onclick="togglePanelPuck('${puck.id}')" title="Toggle ${PANEL_META[puck.id]?.name || puck.name} (${puck.id})">
                <span class="puck-icon">${puck.icon}</span>
                <span class="puck-name">${puck.name}</span>
            </button>
        `;
    });

    container.innerHTML = html;
}

export function updatePanelPucks() {
    PANEL_PUCKS.forEach(puck => {
        const btn = document.getElementById(`puck_${puck.id}`);
        const pane = document.getElementById(puck.id);
        if (btn && pane) {
            const isVisible = !pane.classList.contains('hidden-panel');
            if (isVisible) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });

}

export function togglePanelPuck(paneId) {
    const pane = document.getElementById(paneId);
    if (!pane) return;

    if (pane.classList.contains('hidden-panel')) {
        restorePanel(paneId);
    } else {
        hidePanel(null, paneId);
    }

    updatePanelPucks();
}







export function initWorkspaces() {
    renderPanelPucks();
    applyDefaultLayout();
}

export function initPaneResizers() {
    // A divider moves the boundary between two panels: drag right and the left panel grows
    // while the right one shrinks, drag left and the reverse. Resizing only the left panel
    // is what left the last panel in the row with no way to be sized — the one handle on
    // screen belonged to its neighbour.
    const FALLBACK_MIN_W = 220;

    // Panels declare their own min-width in CSS and the values differ. Clamping against a
    // single constant let one side stop at its CSS floor while the other kept moving, so the
    // boundary drifted and the row grew wider than the window.
    const minWidthOf = (el) => {
        const declared = parseFloat(getComputedStyle(el).minWidth);
        return Number.isFinite(declared) && declared > 0 ? declared : FALLBACK_MIN_W;
    };

    document.querySelectorAll('.panel-resizer').forEach(resizer => {
        if (resizer.dataset.wired === '1') return;
        resizer.dataset.wired = '1';
        const paneId = resizer.dataset.resizePane;

        const nextVisiblePanel = () => {
            let node = resizer.nextElementSibling;
            while (node) {
                if (node.classList.contains('panel') && !node.classList.contains('hidden-panel')) return node;
                node = node.nextElementSibling;
            }
            return null;
        };

        resizer.addEventListener('pointerdown', (e) => {
            const left = document.getElementById(paneId);
            if (!left) return;
            const right = nextVisiblePanel();
            e.preventDefault();
            resizer.classList.add('dragging');
            resizer.setPointerCapture(e.pointerId);
            const startX = e.clientX;
            const startLeftW = left.getBoundingClientRect().width;
            const startRightW = right ? right.getBoundingClientRect().width : 0;
            const minLeft = minWidthOf(left);
            const minRight = right ? minWidthOf(right) : 0;

            const onMove = (ev) => {
                let dx = ev.clientX - startX;
                // Neither side may fall below its own minimum.
                dx = Math.max(dx, minLeft - startLeftW);
                if (right) dx = Math.min(dx, startRightW - minRight);

                const lw = Math.round(startLeftW + dx);
                left.style.width = `${lw}px`;
                left.style.flex = 'none';
                lastPaneWidths[paneId] = `${lw}px`;

                if (right) {
                    const rw = Math.round(startRightW - dx);
                    right.style.width = `${rw}px`;
                    right.style.flex = 'none';
                    lastPaneWidths[right.id] = `${rw}px`;
                }
            };
            const onUp = (ev) => {
                resizer.classList.remove('dragging');
                try { resizer.releasePointerCapture(ev.pointerId); } catch (_) {}
                resizer.removeEventListener('pointermove', onMove);
                resizer.removeEventListener('pointerup', onUp);
            };
            resizer.addEventListener('pointermove', onMove);
            resizer.addEventListener('pointerup', onUp);
        });

        resizer.addEventListener('dblclick', () => {
            [document.getElementById(paneId), nextVisiblePanel()].forEach(pane => {
                if (!pane) return;
                const def = DEFAULT_PANE_WIDTHS[pane.id];
                if (!def) return;
                pane.style.width = def;
                pane.style.flex = 'none';
                lastPaneWidths[pane.id] = def;
            });
        });
    });

    updateResizersVisibility();
}

export function initKeyboardNavigation() {
    window.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement;
        const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
        if (isTyping) {
            return;
        }

        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault();
            stepOpForward();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            e.preventDefault();
            stepOpBackward();
        } else if (e.key === ' ' && !isTyping) {
            e.preventDefault();
            togglePlayPause();
        } else if (e.key === 'Home') {
            e.preventDefault();
            resetStepToStart();
        } else if (e.key === 'End') {
            e.preventDefault();
            stepOpToEnd();
        }
    });
}

export function toggleSectionCollapse(bodyId, btnId) {
    const bodyEl = document.getElementById(bodyId);
    const btnEl = document.getElementById(btnId);
    if (!bodyEl) return;
    const isHidden = bodyEl.style.display === 'none';
    if (isHidden) {
        bodyEl.style.display = '';
        if (btnEl) btnEl.classList.remove('collapsed');
    } else {
        bodyEl.style.display = 'none';
        if (btnEl) btnEl.classList.add('collapsed');
    }
}

export function findOperationByInstanceId(instanceId) {
    if (!instanceId) return null;

    let trace = window.executionTrace;
    if ((!trace || trace.length === 0) && window.currentDocument && window.currentPlayer) {
        trace = buildExecutionTrace(window.currentDocument, window.currentPlayer.getRemoteContext());
        window.executionTrace = trace;
    }

    function checkOp(op) {
        if (!op || typeof op !== 'object') return null;
        const symbols = Object.getOwnPropertySymbols(op);
        for (let i = 0; i < symbols.length; i++) {
            if (op[symbols[i]] === instanceId) return op;
        }
        const sub = typeof op.getList === 'function' ? op.getList() : (op.mOperations || op.mOps);
        if (Array.isArray(sub)) {
            for (let i = 0; i < sub.length; i++) {
                const found = checkOp(sub[i]);
                if (found) return found;
            }
        }
        return null;
    }

    if (Array.isArray(trace)) {
        for (let i = 0; i < trace.length; i++) {
            const found = checkOp(trace[i]?.op);
            if (found) return found;
        }
    }

    const doc = window.currentDocument;
    if (doc) {
        const ops = typeof doc.getOperations === 'function' ? doc.getOperations() : (doc.mOperations || doc.mOps);
        if (Array.isArray(ops)) {
            for (let i = 0; i < ops.length; i++) {
                const found = checkOp(ops[i]);
                if (found) return found;
            }
        }
        const rootComp = typeof doc.getRootLayoutComponent === 'function' ? doc.getRootLayoutComponent() : doc.mRootLayoutComponent;
        if (rootComp) {
            const found = checkOp(rootComp);
            if (found) return found;
        }
        for (const key of Object.keys(doc)) {
            const val = doc[key];
            if (Array.isArray(val)) {
                for (let i = 0; i < val.length; i++) {
                    const found = checkOp(val[i]);
                    if (found) return found;
                }
            } else if (val && typeof val === 'object') {
                const found = checkOp(val);
                if (found) return found;
            }
        }
    }

    if (typeof __rtOpRegistry !== 'undefined' && __rtOpRegistry) {
        for (const op of __rtOpRegistry.values()) {
            const found = checkOp(op);
            if (found) return found;
        }
    }

    return null;
}

if (typeof window !== 'undefined') {
    window.hidePanel = hidePanel;
    window.restorePanel = restorePanel;
    window.updateHeaderCollapsedBar = updateHeaderCollapsedBar;
    window.updateResizersVisibility = updateResizersVisibility;
    window.initPaneResizers = initPaneResizers;
    window.initKeyboardNavigation = initKeyboardNavigation;
    window.toggleSectionCollapse = toggleSectionCollapse;
    window.findOperationByInstanceId = findOperationByInstanceId;
    window.applyWorkspace = applyWorkspace;
    window.initWorkspaces = initWorkspaces;
    window.renderPanelPucks = renderPanelPucks;
    window.updatePanelPucks = updatePanelPucks;
    window.togglePanelPuck = togglePanelPuck;
}
