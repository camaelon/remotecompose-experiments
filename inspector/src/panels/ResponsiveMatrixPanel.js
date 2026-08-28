// =========================================================================
// Panel 12: Responsive Matrix (Size Buckets Multi-Player Grid)
// Modularized in src/panels/ResponsiveMatrixPanel.js
// Renders the loaded document across multiple responsive width (W1..W4)
// and height (H0..H4) bucket constraints using independent RcdPlayer instances.
// =========================================================================

import { applyStageDimensions } from './StagePanel.js';
import { loadRcArrayBuffer, fetchArrayBuffer } from './DocumentLoader.js';

export const MATRIX_PRESETS = {
    fitness_matrix: {
        name: 'Responsive Widget Matrix (4×5)',
        icon: '📱',
        widths: [
            { id: 'W1', label: 'W1', width: 72 },
            { id: 'W2', label: 'W2', width: 148 },
            { id: 'W3', label: 'W3', width: 220 },
            { id: 'W4', label: 'W4', width: 300 }
        ],
        heights: [
            { id: 'H0', label: 'H0', height: 32, activeCols: ['W1', 'W2', 'W3', 'W4'] },
            { id: 'H1', label: 'H1', height: 72, activeCols: ['W1', 'W2', 'W3', 'W4'] },
            { id: 'H2', label: 'H2', height: 112, activeCols: ['W1', 'W2', 'W3', 'W4'] },
            { id: 'H3', label: 'H3', height: 152, activeCols: ['W1', 'W2', 'W3', 'W4'] },
            { id: 'H4', label: 'H4', height: 216, activeCols: ['W1', 'W2', 'W3', 'W4'] }
        ]
    },
    square_grid: {
        name: 'Standard Square Grid (3×3)',
        icon: '⏹️',
        widths: [
            { id: 'W1', label: 'W1 (100px)', width: 100 },
            { id: 'W2', label: 'W2 (200px)', width: 200 },
            { id: 'W3', label: 'W3 (300px)', width: 300 }
        ],
        heights: [
            { id: 'H1', label: 'H1 (100px)', height: 100, activeCols: ['W1', 'W2', 'W3'] },
            { id: 'H2', label: 'H2 (200px)', height: 200, activeCols: ['W1', 'W2', 'W3'] },
            { id: 'H3', label: 'H3 (300px)', height: 300, activeCols: ['W1', 'W2', 'W3'] }
        ]
    },
    wearable_mobile: {
        name: 'Wearable & Glance Matrix (3×3)',
        icon: '⌚',
        widths: [
            { id: 'W1', label: 'Tile (120px)', width: 120 },
            { id: 'W2', label: 'Watch (190px)', width: 190 },
            { id: 'W3', label: 'Widget (320px)', width: 320 }
        ],
        heights: [
            { id: 'H1', label: 'Small (80px)', height: 80, activeCols: ['W1', 'W2', 'W3'] },
            { id: 'H2', label: 'Medium (160px)', height: 160, activeCols: ['W1', 'W2', 'W3'] },
            { id: 'H3', label: 'Large (280px)', height: 280, activeCols: ['W1', 'W2', 'W3'] }
        ]
    }
};

export const MATRIX_THEMES = {
    dark_slate: {
        name: 'Panel Default (Dark Slate)',
        icon: '🌙',
        bg: '#0F172A',
        cardBg: 'transparent',
        textColor: '#38BDF8',
        rulerColor: '#38BDF8',
        borderColor: 'rgba(56, 189, 248, 0.3)'
    },
    calendar_light: {
        name: 'Light / Calendar (Screenshot)',
        icon: '📅',
        bg: '#F3F4F6',
        cardBg: 'transparent',
        textColor: '#1E293B',
        rulerColor: '#1E293B',
        borderColor: 'rgba(30, 41, 59, 0.3)'
    },
    sleep_lavender: {
        name: 'Lavender / Sleep (Screenshot)',
        icon: '😴',
        bg: '#CAC3E3',
        cardBg: 'transparent',
        textColor: '#103EB2',
        rulerColor: '#103EB2',
        borderColor: 'rgba(16, 62, 178, 0.3)'
    },
    dark_gray: {
        name: 'Dark Gray',
        icon: '⬛',
        bg: '#242424',
        cardBg: 'transparent',
        textColor: '#E0E0E0',
        rulerColor: '#9E9E9E',
        borderColor: 'rgba(255, 255, 255, 0.15)'
    },
    light_gray: {
        name: 'Light Gray',
        icon: '⬜',
        bg: '#E5E7EB',
        cardBg: 'transparent',
        textColor: '#374151',
        rulerColor: '#6B7280',
        borderColor: 'rgba(0, 0, 0, 0.15)'
    },
    checkerboard: {
        name: 'Checkerboard',
        icon: '🏁',
        bg: 'repeating-conic-gradient(#2B2B2B 0% 25%, #1F1F1F 0% 50%) 50% / 20px 20px',
        cardBg: 'transparent',
        textColor: '#E0E0E0',
        rulerColor: '#60A5FA',
        borderColor: 'rgba(255, 255, 255, 0.2)'
    },
    khaki: {
        name: 'Khaki Olive (Screenshot)',
        icon: '🫒',
        bg: '#7B7846',
        cardBg: 'transparent',
        textColor: '#E8EA8A',
        rulerColor: '#E8EA8A',
        borderColor: 'rgba(232, 234, 138, 0.4)'
    }
};

let currentPresetKey = 'fitness_matrix';
let currentThemeKey = 'dark_slate';
let currentMatrixDensity = 1.0;
let isMatrixPaused = false;
let matrixPlayers = []; // [{ player, canvas, col, row, width, height }]
let activeGridConfig = JSON.parse(JSON.stringify(MATRIX_PRESETS.fitness_matrix));

export function getMatrixPlayers() {
    return matrixPlayers;
}

export function stopMatrixPlayers() {
    if (matrixPlayers && matrixPlayers.length > 0) {
        matrixPlayers.forEach(item => {
            if (item.player && typeof item.player.stop === 'function') {
                try {
                    item.player.stop();
                } catch (e) {}
            }
        });
        matrixPlayers = [];
    }
}

export function setMatrixTheme(themeKey) {
    if (!MATRIX_THEMES[themeKey]) return;
    currentThemeKey = themeKey;
    applyMatrixThemeStyles();
}

function applyMatrixThemeStyles() {
    const win = (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
    const doc = (typeof document !== 'undefined' ? document : win.document);
    const theme = MATRIX_THEMES[currentThemeKey];
    const container = doc ? doc.getElementById('responsiveMatrixBoard') : null;
    if (!container || !theme) return;

    if (theme.bg.includes('gradient')) {
        container.style.backgroundColor = '#1F1F1F';
        container.style.background = theme.bg;
    } else {
        container.style.backgroundColor = theme.bg;
        container.style.background = theme.bg;
    }
    if (typeof container.style.setProperty === 'function') {
        container.style.setProperty('--matrix-text-color', theme.textColor);
        container.style.setProperty('--matrix-ruler-color', theme.rulerColor);
        container.style.setProperty('--matrix-border-color', theme.borderColor);
    } else {
        container.style.color = theme.textColor;
    }
}

export function setMatrixDensity(density) {
    const d = parseFloat(density);
    if (isNaN(d) || d <= 0) return;
    currentMatrixDensity = d;
    const win = (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
    renderResponsiveMatrixPanel(win.currentBuffer || win.currentDocument);
}

export function toggleMatrixPlayPause() {
    isMatrixPaused = !isMatrixPaused;
    const win = (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
    const doc = (typeof document !== 'undefined' ? document : win.document);
    const btn = doc ? doc.getElementById('matrixPlayPauseBtn') : null;
    if (btn) {
        btn.innerHTML = isMatrixPaused ? '<span>▶️</span> <span>Play</span>' : '<span>⏸️</span> <span>Pause</span>';
    }
    matrixPlayers.forEach(item => {
        if (item.player) {
            if (isMatrixPaused) {
                if (typeof item.player.pause === 'function') item.player.pause();
            } else {
                if (typeof item.player.play === 'function') item.player.play();
                else if (typeof item.player.repaint === 'function') item.player.repaint();
            }
        }
    });
}

export function loadMatrixPreset(presetKey) {
    if (!MATRIX_PRESETS[presetKey]) return;
    currentPresetKey = presetKey;
    activeGridConfig = JSON.parse(JSON.stringify(MATRIX_PRESETS[presetKey]));
    const win = (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
    renderResponsiveMatrixPanel(win.currentBuffer || win.currentDocument);
}

export async function loadQuickSample(sampleName) {
    const url = `samples/${sampleName}`;
    try {
        const buffer = await fetchArrayBuffer(url);
        if (buffer) {
            await loadRcArrayBuffer(buffer, sampleName);
        }
    } catch (e) {
        console.error(`Failed to load quick sample ${sampleName}:`, e);
    }
}

export function inspectMatrixCell(width, height) {
    applyStageDimensions(width, height);
    // Visual flash on main canvas preview to show the selected dimensions
    const win = (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
    const doc = (typeof document !== 'undefined' ? document : win.document);
    const previewWrapper = doc ? doc.getElementById('canvasStageWrapper') : null;
    if (previewWrapper) {
        previewWrapper.style.transition = 'outline 0.2s ease';
        previewWrapper.style.outline = '3px solid var(--accent-blue)';
        setTimeout(() => {
            previewWrapper.style.outline = '';
        }, 600);
    }
}

let activeRenderId = 0;

/**
 * Main render function for the Responsive Matrix Panel.
 */
export async function renderResponsiveMatrixPanel(bufferOrDoc) {
    const renderId = ++activeRenderId;
    const win = (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
    const doc = (typeof document !== 'undefined' ? document : win.document);
    const container = doc ? doc.getElementById('responsiveMatrixBoard') : null;
    if (!container) return;

    stopMatrixPlayers();
    container.innerHTML = '';
    applyMatrixThemeStyles();

    const buffer = (bufferOrDoc instanceof ArrayBuffer ? bufferOrDoc : (win.currentBuffer || globalThis.currentBuffer));
    if (!buffer) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; color:var(--matrix-text-color, #E8EA8A); text-align:center; gap:16px;">
                <div style="font-size:2.5rem;">📐</div>
                <div style="font-weight:700; font-size:1.1rem;">No Document Loaded</div>
                <div style="font-size:0.85rem; opacity:0.85; max-width:360px;">
                    Drop a <code>.rc</code> binary or select a sample from the top header to preview responsive layout buckets.
                </div>
            </div>
        `;
        return;
    }

    const rcRuntime = (typeof RC !== 'undefined' ? RC : undefined) || win.RC || globalThis.RC;
    if (!rcRuntime || typeof rcRuntime.RcdPlayer === 'undefined') {
        container.innerHTML = `<div style="padding:20px; color:#F87171;">RemoteCompose Player runtime not found.</div>`;
        return;
    }

    const widths = activeGridConfig.widths || [];
    const heights = activeGridConfig.heights || [];
    const density = currentMatrixDensity || 1.0;

    // Create Table / Grid structure
    const gridWrapper = doc.createElement('div');
    gridWrapper.className = 'matrix-grid-layout';

    // 1. Header Row (Top Ruler & Width Headers)
    const headerRow = doc.createElement('div');
    headerRow.className = 'matrix-row matrix-header-row';

    // Corner spacer
    const cornerCell = doc.createElement('div');
    cornerCell.className = 'matrix-cell matrix-corner-cell';
    headerRow.appendChild(cornerCell);

    widths.forEach(col => {
        const colHeader = doc.createElement('div');
        colHeader.className = 'matrix-cell matrix-col-header';
        colHeader.style.width = `${col.width}px`;

        colHeader.innerHTML = `
            <div class="matrix-col-title">${col.label}</div>
            <div class="matrix-h-ruler">
                <span class="ruler-tick-start">|</span>
                <span class="ruler-line"></span>
                <span class="ruler-tick-end">|</span>
            </div>
            <div class="matrix-dim-subtext">${col.width}dp</div>
        `;
        headerRow.appendChild(colHeader);
    });
    gridWrapper.appendChild(headerRow);

    // Mount grid immediately so layout, headers, and rulers appear with zero delay
    container.innerHTML = '';
    container.appendChild(gridWrapper);

    const cellPromises = [];

    // 2. Data Rows (H0..H4)
    for (let rIdx = 0; rIdx < heights.length; rIdx++) {
        const row = heights[rIdx];
        const rowEl = doc.createElement('div');
        rowEl.className = 'matrix-row';
        rowEl.style.height = `${row.height}px`;

        // Row Header (Left label & vertical ruler)
        const rowHeader = doc.createElement('div');
        rowHeader.className = 'matrix-cell matrix-row-header';
        rowHeader.style.height = `${row.height}px`;
        rowHeader.innerHTML = `
            <div class="matrix-row-title">${row.label}</div>
            <div class="matrix-v-ruler" style="height:${row.height}px;">
                <span class="ruler-tick-top">—</span>
                <span class="ruler-v-line"></span>
                <span class="ruler-tick-bottom">—</span>
            </div>
            <div class="matrix-dim-subtext">${row.height}dp</div>
        `;
        rowEl.appendChild(rowHeader);

        // Columns in this row
        for (let cIdx = 0; cIdx < widths.length; cIdx++) {
            const col = widths[cIdx];
            const cellEl = doc.createElement('div');
            cellEl.className = 'matrix-cell matrix-data-cell';
            cellEl.style.width = `${col.width}px`;
            cellEl.style.height = `${row.height}px`;

            const isActive = !row.activeCols || row.activeCols.includes(col.id);

            if (isActive) {
                const cardWrapper = doc.createElement('div');
                cardWrapper.className = 'matrix-widget-card';
                cardWrapper.style.width = `${col.width}px`;
                cardWrapper.style.height = `${row.height}px`;
                cardWrapper.title = `Click to inspect ${col.width}×${row.height} on Stage`;
                cardWrapper.onclick = () => inspectMatrixCell(col.width, row.height);

                const canvas = doc.createElement('canvas');
                canvas.className = 'matrix-canvas';
                canvas.width = Math.round(col.width * density);
                canvas.height = Math.round(row.height * density);
                canvas.style.width = `${col.width}px`;
                canvas.style.height = `${row.height}px`;

                cardWrapper.appendChild(canvas);
                cellEl.appendChild(cardWrapper);

                // Queue concurrent player initialization for this cell
                cellPromises.push((async () => {
                    if (renderId !== activeRenderId) return;
                    try {
                        const player = new rcRuntime.RcdPlayer(canvas);
                        if (typeof player.setDensity === 'function') {
                            player.setDensity(density);
                        }
                        const bufClone = buffer.slice(0);
                        const rcDoc = await player.loadFromArrayBuffer(bufClone);
                        if (renderId !== activeRenderId) {
                            if (typeof player.stop === 'function') player.stop();
                            return;
                        }

                        const rContext = player.getRemoteContext();
                        if (rContext) {
                            rContext.setDensity(density);
                        }

                        const targetW = Math.round(col.width * density);
                        const targetH = Math.round(row.height * density);
                        if (rcDoc) {
                            if (typeof rcDoc.setWidth === 'function') rcDoc.setWidth(targetW);
                            if (typeof rcDoc.setHeight === 'function') rcDoc.setHeight(targetH);
                            rcDoc.mWidth = targetW;
                            rcDoc.mHeight = targetH;
                            if (rcDoc.mHeader) {
                                rcDoc.mHeader.mWidth = targetW;
                                rcDoc.mHeader.mHeight = targetH;
                            }
                            rcDoc.mNeedsMeasure = true;
                            const rootComp = typeof rcDoc.getRootLayoutComponent === 'function' ? rcDoc.getRootLayoutComponent() : null;
                            if (rootComp) rootComp.mNeedsMeasure = true;
                        }

                        if (!isMatrixPaused && (rcDoc?.mClock || rcDoc?.mNeedsRepaintFlag) && typeof player.play === 'function') {
                            player.play();
                        } else if (typeof player.repaint === 'function') {
                            player.repaint();
                        }

                        matrixPlayers.push({
                            player,
                            canvas,
                            col,
                            row,
                            width: col.width,
                            height: row.height
                        });
                    } catch (err) {
                        console.error(`Failed to initialize matrix player at ${col.id}×${row.id}:`, err);
                        cellEl.innerHTML = `<div style="color:#F87171; font-size:0.65rem;">Err</div>`;
                    }
                })());
            } else {
                cellEl.classList.add('matrix-empty-cell');
            }

            rowEl.appendChild(cellEl);
        }

        gridWrapper.appendChild(rowEl);
    }

    // Await concurrent cell rendering
    await Promise.all(cellPromises);
}
