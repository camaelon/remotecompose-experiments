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

export const lastPaneWidths = {
    pane1: '480px',
    pane2: '400px',
    pane7: '380px',
    pane3: '320px',
    pane4: '440px',
    pane5: '360px',
    pane6: '440px',
    pane8: '480px',
    pane9: '480px',
    pane10: '480px',
    pane11: '400px',
    pane12: '640px',
    pane13: '440px',
    pane14: '480px',
    pane15: '420px'
};

export const PANEL_META = {
    pane1: { name: 'Player & Controls', icon: '🎨' },
    pane2: { name: 'Commands List (Document Wire)', icon: '📜' },
    pane7: { name: 'Running Tree (Post-Inflation)', icon: '🌿' },
    pane3: { name: 'Component Tree', icon: '🌳' },
    pane4: { name: 'JSON Source (Experimental)', icon: '⚙️' },
    pane5: { name: 'Variables & State', icon: '🎛️' },
    pane6: { name: 'Variable Graphs', icon: '📈' },
    pane8: { name: 'Profiler & Op Measurement', icon: '⏱️' },
    pane9: { name: 'Expression Dependency Graph', icon: '🧬' },
    pane10: { name: 'Binary Treemap & Allocation', icon: '📦' },
    pane11: { name: 'System Theme & Environment', icon: '🎨' },
    pane12: { name: 'Responsive Matrix (Buckets)', icon: '📐' },
    pane13: { name: 'Layout & Box Model', icon: '📐' },
    pane14: { name: 'Document Statistics & Metrics', icon: '📊' },
    pane15: { name: 'Repaint Scheduling', icon: '🔁' }
};

export const CLUSTERS = {
    canvas: {
        id: 'canvas',
        name: 'Canvas Viewport',
        icon: '🎬',
        panels: ['pane1']
    },
    layout: {
        id: 'layout',
        name: 'Layout, Structure & UI',
        icon: '📐',
        panels: ['pane3', 'pane13', 'pane12', 'pane11', 'pane7']
    },
    reactivity: {
        id: 'reactivity',
        name: 'Reactivity & Logic',
        icon: '⚡',
        panels: ['pane5', 'pane6', 'pane9', 'pane15']
    },
    binary: {
        id: 'binary',
        name: 'Binary & Performance',
        icon: '📦',
        panels: ['pane2', 'pane14', 'pane10', 'pane8', 'pane4']
    }
};

export const PANEL_PUCKS = [
    // Cluster 1: Canvas / Player
    { id: 'pane1', cluster: 'canvas', name: 'Player', icon: '🎨' },
    // Cluster 2: Layout & Structure
    { id: 'pane3', cluster: 'layout', name: 'Components', icon: '🌳' },
    { id: 'pane13', cluster: 'layout', name: 'Layout', icon: '📐' },
    { id: 'pane12', cluster: 'layout', name: 'Matrix', icon: '📐' },
    { id: 'pane11', cluster: 'layout', name: 'Theme', icon: '🎨' },
    { id: 'pane7', cluster: 'layout', name: 'Ops Tree', icon: '🌿' },
    // Cluster 3: Reactivity & Logic
    { id: 'pane5', cluster: 'reactivity', name: 'Variables', icon: '🎛️' },
    { id: 'pane6', cluster: 'reactivity', name: 'Graphs', icon: '📈' },
    { id: 'pane9', cluster: 'reactivity', name: 'DAG', icon: '🧬' },
    { id: 'pane15', cluster: 'reactivity', name: 'Repaint', icon: '🔁' },
    // Cluster 4: Binary & Performance
    { id: 'pane2', cluster: 'binary', name: 'Disassembly', icon: '📜' },
    { id: 'pane14', cluster: 'binary', name: 'Stats', icon: '📊' },
    { id: 'pane10', cluster: 'binary', name: 'Treemap', icon: '📦' },
    { id: 'pane8', cluster: 'binary', name: 'Profiler', icon: '⏱️' },
    { id: 'pane4', cluster: 'binary', name: 'JSON', icon: '⚙️' }
];

export const WORKSPACE_PRESETS = {
    layout: {
        id: 'layout',
        name: 'Layout',
        icon: '📐',
        description: 'Player + Component Tree + Layout Inspector',
        panels: ['pane1', 'pane3', 'pane13']
    },
    adaptive: {
        id: 'adaptive',
        name: 'Adaptive',
        icon: '📐',
        description: 'Player + Responsive Matrix',
        panels: ['pane1', 'pane12']
    },
    reactivity: {
        id: 'reactivity',
        name: 'Reactivity',
        icon: '⚡',
        description: 'Variables & State + Variable Graphs',
        panels: ['pane1', 'pane5', 'pane6']
    },
    binary: {
        id: 'binary',
        name: 'Binary',
        icon: '📦',
        description: 'Commands Disassembly + Stats',
        panels: ['pane1', 'pane2', 'pane14']
    },
    performance: {
        id: 'performance',
        name: 'Performance',
        icon: '⏱️',
        description: 'Frame Profiler',
        panels: ['pane1', 'pane8']
    }
};

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
    const pane = document.getElementById(paneId);
    if (!pane) return;

    pane.classList.remove('hidden-panel');
    updateHeaderCollapsedBar();
    updatePanelPucks();
    updateResizersVisibility();
    if (paneId === 'pane7') {
        renderRunningOperationsTree(window.currentDocument);
    }
    if (paneId === 'pane4' && jsonEditor) {
        setTimeout(() => jsonEditor.refresh(), 50);
    }
    if (paneId === 'pane5') {
        updateVariablesPanel();
    }
    if (paneId === 'pane6') {
        updateGraphLegend();
        setTimeout(() => renderGraphCanvas(), 50);
    }
    if (paneId === 'pane8') {
        if (window.currentPlayer && typeof window.currentPlayer.repaint === 'function') {
            window.currentPlayer.repaint();
        }
        drawProfiler();
    }
    if (paneId === 'pane9') {
        renderExpressionDependencyGraph();
    }
    if (paneId === 'pane15') {
        renderRepaintPanel();
    }
    if (paneId === 'pane10') {
        updateTreemapUI();
    }
    if (paneId === 'pane11') {
        renderThemeEnvironmentPanel(window.currentDocument);
    }
    if (paneId === 'pane12') {
        renderResponsiveMatrixPanel(window.currentBuffer || window.currentDocument);
    }
    if (paneId === 'pane13') {
        renderLayoutInspectorPanel(window.currentDocument);
    }
    if (paneId === 'pane14') {
        const u8 = window.currentU8Buffer || (window.currentBuffer ? new Uint8Array(window.currentBuffer) : null);
        renderDocumentStatistics(window.currentDocument, window.allOps || window.currentParsedOps, u8);
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
    const p1 = document.getElementById('pane1');
    const p14 = document.getElementById('pane14');
    const p2 = document.getElementById('pane2');
    const p7 = document.getElementById('pane7');
    const p3 = document.getElementById('pane3');
    const p4 = document.getElementById('pane4');
    const p5 = document.getElementById('pane5');
    const p6 = document.getElementById('pane6');
    const p8 = document.getElementById('pane8');
    const p9 = document.getElementById('pane9');
    const p10 = document.getElementById('pane10');
    const p11 = document.getElementById('pane11');
    const p12 = document.getElementById('pane12');
    const p13 = document.getElementById('pane13');

    const r1 = document.getElementById('resizer1');
    const r14 = document.getElementById('resizer14');
    const r2 = document.getElementById('resizer2');
    const r6 = document.getElementById('resizer6');
    const r3 = document.getElementById('resizer3');
    const r4 = document.getElementById('resizer4');
    const r5 = document.getElementById('resizer5');
    const r6_7 = document.getElementById('resizer6_7');
    const r8_9 = document.getElementById('resizer8_9');
    const r9_10 = document.getElementById('resizer9_10');
    const r10_11 = document.getElementById('resizer10_11');
    const r11_12 = document.getElementById('resizer11_12');
    const r12_13 = document.getElementById('resizer12_13');

    const p1Vis = p1 && !p1.classList.contains('hidden-panel');
    const p14Vis = p14 && !p14.classList.contains('hidden-panel');
    const p2Vis = p2 && !p2.classList.contains('hidden-panel');
    const p7Vis = p7 && !p7.classList.contains('hidden-panel');
    const p3Vis = p3 && !p3.classList.contains('hidden-panel');
    const p4Vis = p4 && !p4.classList.contains('hidden-panel');
    const p5Vis = p5 && !p5.classList.contains('hidden-panel');
    const p6Vis = p6 && !p6.classList.contains('hidden-panel');
    const p8Vis = p8 && !p8.classList.contains('hidden-panel');
    const p9Vis = p9 && !p9.classList.contains('hidden-panel');
    const p10Vis = p10 && !p10.classList.contains('hidden-panel');
    const p11Vis = p11 && !p11.classList.contains('hidden-panel');
    const p12Vis = p12 && !p12.classList.contains('hidden-panel');
    const p13Vis = p13 && !p13.classList.contains('hidden-panel');

    const visiblePanels = [];
    if (p1Vis) visiblePanels.push(p1);
    if (p14Vis) visiblePanels.push(p14);
    if (p2Vis) visiblePanels.push(p2);
    if (p7Vis) visiblePanels.push(p7);
    if (p3Vis) visiblePanels.push(p3);
    if (p4Vis) visiblePanels.push(p4);
    if (p5Vis) visiblePanels.push(p5);
    if (p6Vis) visiblePanels.push(p6);
    if (p8Vis) visiblePanels.push(p8);
    if (p9Vis) visiblePanels.push(p9);
    if (p10Vis) visiblePanels.push(p10);
    if (p11Vis) visiblePanels.push(p11);
    if (p12Vis) visiblePanels.push(p12);
    if (p13Vis) visiblePanels.push(p13);

    // Assign flex: 1 to the last visible panel so it absorbs all remaining container width
    visiblePanels.forEach((p, idx) => {
        if (idx === visiblePanels.length - 1) {
            p.style.flex = '1';
            p.style.width = '';
        } else {
            p.style.flex = 'none';
            if (!p.style.width || p.style.width === 'auto') {
                p.style.width = lastPaneWidths[p.id] || '380px';
            }
        }
    });

    const anyAfter1 = p14Vis || p2Vis || p7Vis || p3Vis || p4Vis || p5Vis || p6Vis || p8Vis || p9Vis || p10Vis || p11Vis || p12Vis || p13Vis;
    const anyAfter14 = p2Vis || p7Vis || p3Vis || p4Vis || p5Vis || p6Vis || p8Vis || p9Vis || p10Vis || p11Vis || p12Vis || p13Vis;
    const anyAfter2 = p7Vis || p3Vis || p4Vis || p5Vis || p6Vis || p8Vis || p9Vis || p10Vis || p11Vis || p12Vis || p13Vis;
    const anyAfter7 = p3Vis || p4Vis || p5Vis || p6Vis || p8Vis || p9Vis || p10Vis || p11Vis || p12Vis || p13Vis;
    const anyAfter3 = p4Vis || p5Vis || p6Vis || p8Vis || p9Vis || p10Vis || p11Vis || p12Vis || p13Vis;
    const anyAfter4 = p5Vis || p6Vis || p8Vis || p9Vis || p10Vis || p11Vis || p12Vis || p13Vis;
    const anyAfter5 = p6Vis || p8Vis || p9Vis || p10Vis || p11Vis || p12Vis || p13Vis;
    const anyAfter6 = p8Vis || p9Vis || p10Vis || p11Vis || p12Vis || p13Vis;
    const anyAfter8 = p9Vis || p10Vis || p11Vis || p12Vis || p13Vis;
    const anyAfter9 = p10Vis || p11Vis || p12Vis || p13Vis;
    const anyAfter10 = p11Vis || p12Vis || p13Vis;
    const anyAfter11 = p12Vis || p13Vis;
    const anyAfter12 = p13Vis;

    if (r1) r1.style.display = (p1Vis && anyAfter1) ? 'flex' : 'none';
    if (r14) r14.style.display = (p14Vis && anyAfter14) ? 'flex' : 'none';
    if (r2) r2.style.display = (p2Vis && anyAfter2) ? 'flex' : 'none';
    if (r6) r6.style.display = (p7Vis && anyAfter7) ? 'flex' : 'none';
    if (r3) r3.style.display = (p3Vis && anyAfter3) ? 'flex' : 'none';
    if (r4) r4.style.display = (p4Vis && anyAfter4) ? 'flex' : 'none';
    if (r5) r5.style.display = (p5Vis && anyAfter5) ? 'flex' : 'none';
    if (r6_7) r6_7.style.display = (p6Vis && anyAfter6) ? 'flex' : 'none';
    if (r8_9) r8_9.style.display = (p8Vis && anyAfter8) ? 'flex' : 'none';
    if (r9_10) r9_10.style.display = (p9Vis && anyAfter9) ? 'flex' : 'none';
    if (r10_11) r10_11.style.display = (p10Vis && anyAfter10) ? 'flex' : 'none';
    if (r11_12) r11_12.style.display = (p11Vis && anyAfter11) ? 'flex' : 'none';
    if (r12_13) r12_13.style.display = (p12Vis && anyAfter12) ? 'flex' : 'none';
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

export function getCustomSetups() {
    if (!isLocalStorageAvailable()) return {};
    try {
        const raw = SafeStorage.getItem('rc_custom_setups');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'object' && parsed !== null) {
                return parsed;
            }
        }
    } catch (_) {}
    return {};
}

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
        }
    });

    updateHeaderCollapsedBar();
    updateResizersVisibility();
    updatePanelPucks();

    if (activeKey) {
        SafeStorage.setItem('rc_active_workspace', activeKey);
    }
}

export function applyWorkspacePreset(presetId) {
    const preset = WORKSPACE_PRESETS[presetId];
    if (!preset) return;
    applyWorkspace(preset.panels, presetId);
    renderSetupsMenu();
}

export function applyCustomSetup(setupName) {
    if (!isLocalStorageAvailable()) return;
    const setups = getCustomSetups();
    const setup = setups[setupName];
    if (!setup) return;
    applyWorkspace(setup.panels, `custom:${setupName}`, setup.widths);
    renderSetupsMenu();
}

export function saveCustomSetup(name) {
    if (!isLocalStorageAvailable()) return;
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    const setups = getCustomSetups();

    const visiblePanels = [];
    Object.keys(PANEL_META).forEach(paneId => {
        const pane = document.getElementById(paneId);
        if (pane && !pane.classList.contains('hidden-panel')) {
            visiblePanels.push(paneId);
        }
    });

    const widths = {};
    visiblePanels.forEach(paneId => {
        const pane = document.getElementById(paneId);
        if (pane && pane.style.width) {
            widths[paneId] = pane.style.width;
        } else if (lastPaneWidths[paneId]) {
            widths[paneId] = lastPaneWidths[paneId];
        }
    });

    setups[cleanName] = {
        name: cleanName,
        panels: visiblePanels,
        widths: widths,
        updatedAt: Date.now()
    };

    SafeStorage.setItem('rc_custom_setups', JSON.stringify(setups));
    SafeStorage.setItem('rc_active_workspace', `custom:${cleanName}`);

    updatePanelPucks();
    renderSetupsMenu();
}

export function deleteCustomSetup(name) {
    if (!isLocalStorageAvailable() || !name) return;
    const setups = getCustomSetups();
    delete setups[name];
    SafeStorage.setItem('rc_custom_setups', JSON.stringify(setups));
    const active = SafeStorage.getItem('rc_active_workspace');
    if (active === `custom:${name}`) {
        SafeStorage.setItem('rc_active_workspace', 'layout');
        applyWorkspacePreset('layout');
    }
    updatePanelPucks();
    renderSetupsMenu();
}

export function detectMatchingPreset() {
    const visible = Object.keys(PANEL_META).filter(paneId => {
        const p = document.getElementById(paneId);
        return p && !p.classList.contains('hidden-panel');
    });
    const visibleSet = new Set(visible);

    for (const [key, preset] of Object.entries(WORKSPACE_PRESETS)) {
        if (preset.panels.length === visibleSet.size && preset.panels.every(id => visibleSet.has(id))) {
            return key;
        }
    }
    return null;
}

export function togglePanelCheckbox(paneId) {
    if (paneId === 'pane1') return;
    const pane = document.getElementById(paneId);
    if (!pane) return;

    if (pane.classList.contains('hidden-panel')) {
        restorePanel(paneId);
    } else {
        hidePanel(null, paneId);
    }

    const activePreset = detectMatchingPreset();
    if (activePreset) {
        SafeStorage.setItem('rc_active_workspace', activePreset);
    }
    updatePanelPucks();
    renderSetupsMenu();
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

    updateWorkspaceSelectUI();
}

export function togglePanelPuck(paneId) {
    if (paneId === 'pane1') return; // Canvas Player is always pinned
    const pane = document.getElementById(paneId);
    if (!pane) return;

    if (pane.classList.contains('hidden-panel')) {
        restorePanel(paneId);
    } else {
        hidePanel(null, paneId);
    }

    const activePreset = detectMatchingPreset();
    if (activePreset) {
        SafeStorage.setItem('rc_active_workspace', activePreset);
    }
    updatePanelPucks();
    renderSetupsMenu();
}

export function onWorkspaceSelectChange(value) {
    if (!value) return;
    if (value.startsWith('custom:')) {
        const setupName = value.substring(7);
        applyCustomSetup(setupName);
    } else if (WORKSPACE_PRESETS[value]) {
        applyWorkspacePreset(value);
    }
}

export function promptSaveCustomWorkspace() {
    if (!isLocalStorageAvailable()) {
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
            window.alert('Custom workspace saving is unavailable in sandboxed environments without storage access.');
        }
        return;
    }
    const defaultName = `Setup ${Object.keys(getCustomSetups()).length + 1}`;
    const name = typeof window !== 'undefined' && typeof window.prompt === 'function' ? window.prompt("Enter a name for this custom setup:", defaultName) : defaultName;
    if (!name || !name.trim()) return;
    saveCustomSetup(name.trim());
}

export function updateWorkspaceSelectUI() {
    const select = document.getElementById('workspaceSelect');
    if (!select) return;

    const saveBtn = document.getElementById('saveWorkspaceBtn');
    if (saveBtn) {
        saveBtn.style.display = isLocalStorageAvailable() ? 'inline-flex' : 'none';
    }

    const customSetups = getCustomSetups();
    const customNames = Object.keys(customSetups);

    let html = `
        <option value="">📂 Workspace Presets...</option>
        <option value="layout">📐 Layout (Tree + Inspector)</option>
        <option value="adaptive">📐 Adaptive (Matrix)</option>
        <option value="reactivity">⚡ Reactivity (Vars + Graphs)</option>
        <option value="binary">📦 Binary (Disasm + Stats)</option>
        <option value="performance">⏱️ Performance (Profiler)</option>
    `;

    if (isLocalStorageAvailable() && customNames.length > 0) {
        html += `<optgroup label="⭐ Custom Setups">`;
        customNames.forEach(name => {
            html += `<option value="custom:${name}">⭐ ${name} (${customSetups[name].panels.length}p)</option>`;
        });
        html += `</optgroup>`;
    }

    select.innerHTML = html;

    const matched = detectMatchingPreset();
    const saved = SafeStorage.getItem('rc_active_workspace');

    if (matched) {
        select.value = matched;
    } else if (saved && saved.startsWith('custom:') && customSetups[saved.substring(7)]) {
        select.value = saved;
    } else {
        select.value = '';
    }
}

export function toggleSetupsDropdown(event) {
    if (event) {
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        if (typeof event.preventDefault === 'function') event.preventDefault();
    }
    const dropdown = document.getElementById('setupsDropdownPopover');
    const btn = document.getElementById('setupsMenuBtn');
    if (!dropdown) return;

    if (dropdown.style.display === 'none' || !dropdown.style.display) {
        renderSetupsMenu();
        dropdown.style.display = 'flex';

        // Auto-adjust left/right alignment so the popover never clips offscreen
        if (btn && typeof window !== 'undefined') {
            const btnRect = btn.getBoundingClientRect();
            const popoverWidth = Math.min(480, (window.innerWidth || 1000) - 32);
            if (btnRect.right < popoverWidth) {
                dropdown.style.left = '0';
                dropdown.style.right = 'auto';
            } else {
                dropdown.style.left = 'auto';
                dropdown.style.right = '0';
            }
        }
    } else {
        dropdown.style.display = 'none';
    }
}

export function renderSetupsMenu() {
    const dropdown = document.getElementById('setupsDropdownPopover');
    if (!dropdown) return;

    const customSetups = getCustomSetups();
    const customNames = Object.keys(customSetups);
    let activeKey = SafeStorage.getItem('rc_active_workspace');
    if (!activeKey) activeKey = detectMatchingPreset() || 'layout';

    let html = `
        <div class="setups-popover-header">
            <span class="setups-popover-title">⚙️ Workspace Setups & Panels</span>
            <button class="setups-close-btn" onclick="toggleSetupsDropdown(event)" title="Close">✕</button>
        </div>
        <div class="setups-popover-body">
    `;

    // Saved Custom Setups Section (Only shown if storage access is available)
    if (!isLocalStorageAvailable()) {
        html += `
            <div class="setups-section">
                <div style="font-size:0.75rem; color:var(--text-muted); background:rgba(0,0,0,0.25); border:1px dashed var(--border-color); border-radius:6px; padding:8px 10px; line-height:1.4;">
                    🔒 <strong>Sandboxed Mode:</strong> Local storage access is disabled in this environment. Custom setup saving is unavailable.
                </div>
            </div>
        `;
    } else {
        html += `
            <div class="setups-section">
                <div class="setups-section-title">⭐ Saved Custom Setups</div>
                <div class="setups-custom-list">
        `;
        if (customNames.length === 0) {
            html += `<div style="font-size:0.75rem; color:var(--text-muted); padding:4px 0;">No custom setups saved yet. Configure panels below and click "Save View".</div>`;
        } else {
            customNames.forEach(name => {
                const isCurrent = activeKey === `custom:${name}`;
                html += `
                    <div class="custom-setup-item ${isCurrent ? 'active' : ''}">
                        <button class="custom-setup-select-btn" onclick="applyCustomSetup('${name}')" title="Load '${name}' setup">
                            <span>${isCurrent ? '●' : '○'}</span>
                            <span style="font-weight:${isCurrent ? '600' : '400'};">${name}</span>
                            <span style="font-size:0.7rem; color:var(--text-muted);">(${customSetups[name].panels.length} panels)</span>
                        </button>
                        <button class="custom-setup-del-btn" onclick="deleteCustomSetup('${name}')" title="Delete setup '${name}'">🗑️</button>
                    </div>
                `;
            });
        }
        html += `
                </div>
                <div class="setups-save-bar">
                    <input type="text" id="customSetupNameInput" class="dim-input" placeholder="New setup name..." style="flex:1; font-size:0.75rem; padding:4px 8px;" onkeydown="if(event.key==='Enter'){saveCurrentCustomSetupFromInput();}">
                    <button class="btn btn-secondary" style="font-size:0.75rem; padding:4px 10px;" onclick="saveCurrentCustomSetupFromInput()">💾 Save View</button>
                </div>
            </div>
        `;
    }

    // Panels Checklist grouped by Cluster
    html += `
        <div class="setups-section" style="border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 8px;">
            <div class="setups-section-title">🎛️ Panels Visibility by Cluster</div>
            <div class="clusters-grid">
    `;

    Object.values(CLUSTERS).forEach(cluster => {
        html += `
            <div class="cluster-block">
                <div class="cluster-title">${cluster.icon} ${cluster.name}</div>
                <div class="cluster-panels-list">
        `;
        cluster.panels.forEach(paneId => {
            const meta = PANEL_META[paneId];
            if (!meta) return;
            const pane = document.getElementById(paneId);
            const isVisible = pane ? !pane.classList.contains('hidden-panel') : false;
            const isLocked = paneId === 'pane1';

            html += `
                <label class="panel-checkbox-label ${isLocked ? 'locked' : ''}" title="${meta.name}">
                    <input type="checkbox" ${isVisible ? 'checked' : ''} ${isLocked ? 'disabled' : ''} onchange="togglePanelCheckbox('${paneId}')">
                    <span>${meta.icon}</span>
                    <span class="panel-name-text">${meta.name}</span>
                    ${isLocked ? '<span style="font-size:0.65rem; color:var(--text-muted); margin-left:auto;">(Locked)</span>' : ''}
                </label>
            `;
        });
        html += `
                </div>
            </div>
        `;
    });

    html += `
            </div>
        </div>
    `;

    html += `
        </div>
        <div class="setups-popover-footer">
            <button class="btn btn-secondary" style="font-size:0.72rem; padding:3px 8px;" onclick="applyWorkspacePreset('layout')">🔄 Reset to Layout</button>
            <button class="btn" style="font-size:0.72rem; padding:3px 8px; margin-left:auto;" onclick="toggleSetupsDropdown(event)">Done</button>
        </div>
    `;

    dropdown.innerHTML = html;
}

export function saveCurrentCustomSetupFromInput() {
    const input = document.getElementById('customSetupNameInput');
    if (!input || !input.value.trim()) return;
    saveCustomSetup(input.value.trim());
}

export function initWorkspaces() {
    if (typeof window === 'undefined') return;

    renderPanelPucks();
    updateWorkspaceSelectUI();

    // Attach click outside listener to close setups dropdown
    const dropdownEl = document.getElementById('setupsDropdownPopover');
    if (dropdownEl) {
        dropdownEl.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    window.addEventListener('click', (e) => {
        const dropdown = document.getElementById('setupsDropdownPopover');
        const btn = document.getElementById('setupsMenuBtn');
        if (dropdown && dropdown.style.display !== 'none') {
            if (!dropdown.contains(e.target) && (!btn || !btn.contains(e.target))) {
                dropdown.style.display = 'none';
            }
        }
    });

    // Check saved workspace preference
    const saved = SafeStorage.getItem('rc_active_workspace');

    if (saved) {
        if (saved.startsWith('custom:')) {
            const setupName = saved.substring(7);
            const setups = getCustomSetups();
            if (setups[setupName]) {
                applyCustomSetup(setupName);
                return;
            }
        } else if (WORKSPACE_PRESETS[saved]) {
            applyWorkspacePreset(saved);
            return;
        }
    }

    // Default to 'layout' preset on first load
    applyWorkspacePreset('layout');
}

export function initPaneResizers() {
    const resizer1 = document.getElementById('resizer1');
    const resizer14 = document.getElementById('resizer14');
    const resizer2 = document.getElementById('resizer2');
    const resizer6 = document.getElementById('resizer6');
    const resizer3 = document.getElementById('resizer3');
    const resizer4 = document.getElementById('resizer4');
    const resizer5 = document.getElementById('resizer5');
    const pane1 = document.getElementById('pane1');
    const pane14 = document.getElementById('pane14');
    const pane2 = document.getElementById('pane2');
    const pane7 = document.getElementById('pane7');
    const pane3 = document.getElementById('pane3');
    const pane4 = document.getElementById('pane4');
    const pane5 = document.getElementById('pane5');
    const pane6 = document.getElementById('pane6');

    function setupDrag(resizer, onDrag) {
        if (!resizer) return;
        resizer.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            const startX = e.clientX;
            const startP1W = pane1 ? pane1.getBoundingClientRect().width : 480;
            const startP14W = pane14 ? pane14.getBoundingClientRect().width : 480;
            const startP2W = pane2 ? pane2.getBoundingClientRect().width : 400;
            const startP7W = pane7 ? pane7.getBoundingClientRect().width : 380;
            const startP3W = pane3 ? pane3.getBoundingClientRect().width : 320;
            const startP4W = pane4 ? pane4.getBoundingClientRect().width : 440;
            const startP5W = pane5 ? pane5.getBoundingClientRect().width : 360;
            const startP6W = pane6 ? pane6.getBoundingClientRect().width : 440;

            function onPointerMove(moveEvent) {
                const deltaX = moveEvent.clientX - startX;
                onDrag(deltaX, startP1W, startP14W, startP2W, startP7W, startP3W, startP4W, startP5W, startP6W);
            }

            function onPointerUp() {
                resizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                if (jsonEditor) jsonEditor.refresh();
                renderGraphCanvas();
            }

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        });
    }

    setupDrag(resizer1, (deltaX, p1W) => {
        if (pane1) {
            const newP1W = Math.max(240, Math.min(1400, p1W + deltaX));
            pane1.style.width = `${newP1W}px`;
            pane1.style.flex = 'none';
            lastPaneWidths.pane1 = `${newP1W}px`;
        }
    });

    setupDrag(resizer14, (deltaX, p1W, p14W) => {
        if (pane14 && !pane14.classList.contains('hidden-panel')) {
            const newP14W = Math.max(240, Math.min(1400, (p14W || 480) + deltaX));
            pane14.style.width = `${newP14W}px`;
            pane14.style.flex = 'none';
            lastPaneWidths.pane14 = `${newP14W}px`;
        }
    });
    if (resizer14) {
        resizer14.addEventListener('dblclick', () => {
            if (pane14) {
                pane14.style.width = '480px';
                pane14.style.flex = 'none';
                lastPaneWidths.pane14 = '480px';
                updateResizersVisibility();
            }
        });
    }

    setupDrag(resizer2, (deltaX, p1W, p14W, p2W) => {
        if (pane2) {
            const newP2W = Math.max(200, Math.min(1400, p2W + deltaX));
            pane2.style.width = `${newP2W}px`;
            pane2.style.flex = 'none';
            lastPaneWidths.pane2 = `${newP2W}px`;
        }
    });

    setupDrag(resizer6, (deltaX, p1W, p2W, p7W) => {
        if (pane7 && !pane7.classList.contains('hidden-panel')) {
            const newP7W = Math.max(200, Math.min(1400, p7W + deltaX));
            pane7.style.width = `${newP7W}px`;
            pane7.style.flex = 'none';
            lastPaneWidths.pane7 = `${newP7W}px`;
        }
    });

    setupDrag(resizer3, (deltaX, p1W, p2W, p7W, p3W) => {
        if (pane3 && !pane3.classList.contains('hidden-panel')) {
            const newP3W = Math.max(200, Math.min(1400, p3W + deltaX));
            pane3.style.width = `${newP3W}px`;
            pane3.style.flex = 'none';
            lastPaneWidths.pane3 = `${newP3W}px`;
        }
    });

    setupDrag(resizer4, (deltaX, p1W, p2W, p7W, p3W, p4W) => {
        if (pane4 && !pane4.classList.contains('hidden-panel')) {
            const newP4W = Math.max(200, Math.min(1400, p4W + deltaX));
            pane4.style.width = `${newP4W}px`;
            pane4.style.flex = 'none';
            lastPaneWidths.pane4 = `${newP4W}px`;
        }
    });

    setupDrag(resizer5, (deltaX, p1W, p2W, p7W, p3W, p4W, p5W) => {
        if (pane5 && !pane5.classList.contains('hidden-panel')) {
            const newP5W = Math.max(200, Math.min(1400, p5W + deltaX));
            pane5.style.width = `${newP5W}px`;
            pane5.style.flex = 'none';
            lastPaneWidths.pane5 = `${newP5W}px`;
        }
    });

    if (resizer1) {
        resizer1.addEventListener('dblclick', () => {
            if (pane1) {
                pane1.style.width = '480px';
                pane1.style.flex = 'none';
                lastPaneWidths.pane1 = '480px';
                updateResizersVisibility();
            }
        });
    }
    if (resizer2) {
        resizer2.addEventListener('dblclick', () => {
            if (pane2) {
                pane2.style.width = '400px';
                pane2.style.flex = 'none';
                lastPaneWidths.pane2 = '400px';
                updateResizersVisibility();
            }
        });
    }
    if (resizer6) {
        resizer6.addEventListener('dblclick', () => {
            if (pane7) {
                pane7.style.width = '380px';
                pane7.style.flex = 'none';
                lastPaneWidths.pane7 = '380px';
                updateResizersVisibility();
            }
        });
    }
    if (resizer3) {
        resizer3.addEventListener('dblclick', () => {
            if (pane3) {
                pane3.style.width = '320px';
                pane3.style.flex = 'none';
                lastPaneWidths.pane3 = '320px';
                updateResizersVisibility();
            }
        });
    }
    if (resizer4) {
        resizer4.addEventListener('dblclick', () => {
            if (pane4) {
                pane4.style.width = '440px';
                pane4.style.flex = 'none';
                lastPaneWidths.pane4 = '440px';
                updateResizersVisibility();
            }
        });
    }
    if (resizer5) {
        resizer5.addEventListener('dblclick', () => {
            if (pane5) {
                pane5.style.width = '360px';
                pane5.style.flex = 'none';
                lastPaneWidths.pane5 = '360px';
                updateResizersVisibility();
            }
        });
    }
    const resizer6_7 = document.getElementById('resizer6_7');
    setupDrag(resizer6_7, (deltaX, p1W, p2W, p7W, p3W, p4W, p5W, p6W) => {
        if (pane6 && !pane6.classList.contains('hidden-panel')) {
            const newP6W = Math.max(200, Math.min(1400, p6W + deltaX));
            pane6.style.width = `${newP6W}px`;
            pane6.style.flex = 'none';
            lastPaneWidths.pane6 = `${newP6W}px`;
        }
    });
    if (resizer6_7) {
        resizer6_7.addEventListener('dblclick', () => {
            if (pane6) {
                pane6.style.width = '440px';
                pane6.style.flex = 'none';
                lastPaneWidths.pane6 = '440px';
                updateResizersVisibility();
            }
        });
    }

    const resizer8_9 = document.getElementById('resizer8_9');
    const pane8 = document.getElementById('pane8');
    setupDrag(resizer8_9, (deltaX, p1W, p2W, p7W, p3W, p4W, p5W, p6W, p8W) => {
        if (pane8 && !pane8.classList.contains('hidden-panel')) {
            const newP8W = Math.max(200, Math.min(1400, (p8W || 480) + deltaX));
            pane8.style.width = `${newP8W}px`;
            pane8.style.flex = 'none';
            lastPaneWidths.pane8 = `${newP8W}px`;
        }
    });
    if (resizer8_9) {
        resizer8_9.addEventListener('dblclick', () => {
            if (pane8) {
                pane8.style.width = '480px';
                pane8.style.flex = 'none';
                lastPaneWidths.pane8 = '480px';
                updateResizersVisibility();
            }
        });
    }

    const resizer9_10 = document.getElementById('resizer9_10');
    const pane9 = document.getElementById('pane9');
    setupDrag(resizer9_10, (deltaX, p1W, p2W, p7W, p3W, p4W, p5W, p6W, p8W, p9W) => {
        if (pane9 && !pane9.classList.contains('hidden-panel')) {
            const newP9W = Math.max(200, Math.min(1400, (p9W || 480) + deltaX));
            pane9.style.width = `${newP9W}px`;
            pane9.style.flex = 'none';
            lastPaneWidths.pane9 = `${newP9W}px`;
        }
    });
    if (resizer9_10) {
        resizer9_10.addEventListener('dblclick', () => {
            if (pane9) {
                pane9.style.width = '480px';
                pane9.style.flex = 'none';
                lastPaneWidths.pane9 = '480px';
                updateResizersVisibility();
            }
        });
    }

    const resizer10_11 = document.getElementById('resizer10_11');
    const pane10 = document.getElementById('pane10');
    setupDrag(resizer10_11, (deltaX, p1W, p2W, p7W, p3W, p4W, p5W, p6W, p8W, p9W, p10W) => {
        if (pane10 && !pane10.classList.contains('hidden-panel')) {
            const newP10W = Math.max(200, Math.min(1400, (p10W || 480) + deltaX));
            pane10.style.width = `${newP10W}px`;
            pane10.style.flex = 'none';
            lastPaneWidths.pane10 = `${newP10W}px`;
        }
    });
    if (resizer10_11) {
        resizer10_11.addEventListener('dblclick', () => {
            if (pane10) {
                pane10.style.width = '480px';
                pane10.style.flex = 'none';
                lastPaneWidths.pane10 = '480px';
                updateResizersVisibility();
            }
        });
    }

    const resizer11_12 = document.getElementById('resizer11_12');
    const pane11 = document.getElementById('pane11');
    setupDrag(resizer11_12, (deltaX, p1W, p2W, p7W, p3W, p4W, p5W, p6W, p8W, p9W, p10W, p11W) => {
        if (pane11 && !pane11.classList.contains('hidden-panel')) {
            const newP11W = Math.max(200, Math.min(1400, (p11W || 400) + deltaX));
            pane11.style.width = `${newP11W}px`;
            pane11.style.flex = 'none';
            lastPaneWidths.pane11 = `${newP11W}px`;
        }
    });
    if (resizer11_12) {
        resizer11_12.addEventListener('dblclick', () => {
            if (pane11) {
                pane11.style.width = '400px';
                pane11.style.flex = 'none';
                lastPaneWidths.pane11 = '400px';
                updateResizersVisibility();
            }
        });
    }

    const resizer12_13 = document.getElementById('resizer12_13');
    const pane12 = document.getElementById('pane12');
    setupDrag(resizer12_13, (deltaX, p1W, p2W, p7W, p3W, p4W, p5W, p6W, p8W, p9W, p10W, p11W, p12W) => {
        if (pane12 && !pane12.classList.contains('hidden-panel')) {
            const newP12W = Math.max(200, Math.min(1400, (p12W || 640) + deltaX));
            pane12.style.width = `${newP12W}px`;
            pane12.style.flex = 'none';
            lastPaneWidths.pane12 = `${newP12W}px`;
        }
    });
    if (resizer12_13) {
        resizer12_13.addEventListener('dblclick', () => {
            if (pane12) {
                pane12.style.width = '640px';
                pane12.style.flex = 'none';
                lastPaneWidths.pane12 = '640px';
                updateResizersVisibility();
            }
        });
    }
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
    window.applyWorkspacePreset = applyWorkspacePreset;
    window.applyCustomSetup = applyCustomSetup;
    window.saveCustomSetup = saveCustomSetup;
    window.deleteCustomSetup = deleteCustomSetup;
    window.togglePanelCheckbox = togglePanelCheckbox;
    window.toggleSetupsDropdown = toggleSetupsDropdown;
    window.renderSetupsMenu = renderSetupsMenu;
    window.saveCurrentCustomSetupFromInput = saveCurrentCustomSetupFromInput;
    window.initWorkspaces = initWorkspaces;
    window.renderPanelPucks = renderPanelPucks;
    window.updatePanelPucks = updatePanelPucks;
    window.togglePanelPuck = togglePanelPuck;
    window.onWorkspaceSelectChange = onWorkspaceSelectChange;
    window.updateWorkspaceSelectUI = updateWorkspaceSelectUI;
    window.promptSaveCustomWorkspace = promptSaveCustomWorkspace;
}
