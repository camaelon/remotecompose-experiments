// =========================================================================
// Panel 3: Variables & State Inspector Panel + Live Graphing Engine
// Modularized in src/panels/VariablesPanel.js
// Provides live state inspections, float/int overrides, referenced-only filters,
// real-time oscilloscope canvas graphs, and variable historical tracing.
// =========================================================================

import {
    getOpName,
    prettyPrintFloatExpression
} from './CommandListPanel.js';
import {
    updateExprGraphLiveValues
} from './DependencyGraphPanel.js';
import {
    updateRunningTreeLive
} from './ComponentTreePanel.js';

export const SYSTEM_VARS = {
    1: 'CONTINUOUS_SEC',
    2: 'TIME_IN_SEC',
    3: 'TIME_IN_MIN',
    4: 'TIME_IN_HR',
    5: 'WINDOW_WIDTH',
    6: 'WINDOW_HEIGHT',
    7: 'COMPONENT_WIDTH',
    8: 'COMPONENT_HEIGHT',
    9: 'CALENDAR_MONTH',
    10: 'OFFSET_TO_UTC',
    11: 'WEEK_DAY',
    12: 'DAY_OF_MONTH',
    13: 'TOUCH_POS_X',
    14: 'TOUCH_POS_Y',
    15: 'TOUCH_VEL_X',
    16: 'TOUCH_VEL_Y',
    27: 'DENSITY',
    28: 'API_LEVEL',
    29: 'TOUCH_EVENT_TIME',
    30: 'ANIMATION_TIME',
    31: 'ANIMATION_DELTA_TIME',
    34: 'DAY_OF_YEAR',
    35: 'YEAR'
};

export function getSystemVarName(id) {
    return SYSTEM_VARS[id] || null;
}

export function getReferencedVarIds(doc) {
    const referencedIds = new Set();
    if (!doc) return referencedIds;

    const topOps = typeof doc.getOperations === 'function' ? doc.getOperations() : (doc.mOps || []);
    const state = typeof doc.getRemoteComposeState === 'function' ? doc.getRemoteComposeState() : doc.mRemoteComposeState;

    function checkBits(bitsArray) {
        if (!bitsArray) return;
        for (let i = 0; i < bitsArray.length; i++) {
            const raw = bitsArray[i];
            const bits = typeof raw === 'number' ? raw : 0;
            if ((bits & 0x7f800000) === 0x7f800000 && (bits & 0x7fffff) !== 0) {
                const id = bits & 0x3fffff;
                if (id > 0 && id < 0x40000000) {
                    referencedIds.add(id);
                }
            }
        }
    }

    if (Array.isArray(topOps)) {
        topOps.forEach(op => {
            if (!op) return;
            if (op.mId !== undefined && typeof op.mId === 'number' && op.mId > 0) {
                referencedIds.add(op.mId);
            }
            if (typeof op.getId === 'function') {
                const id = op.getId();
                if (typeof id === 'number' && id > 0 && id < 0x40000000) {
                    referencedIds.add(id);
                }
            }
            if (op.mBits) {
                checkBits(op.mBits);
            }
            for (const key in op) {
                if (key.endsWith('Id') || key.endsWith('ID') || key.includes('Var')) {
                    const val = op[key];
                    if (typeof val === 'number' && val > 0 && val < 0x40000000) {
                        referencedIds.add(val);
                    }
                }
            }
        });
    }

    if (state) {
        const varListeners = state.mVarListeners;
        if (varListeners) {
            if (typeof varListeners.keySet === 'function') {
                varListeners.keySet().forEach(id => {
                    if (id > 0 && id < 0x40000000) referencedIds.add(id);
                });
            } else if (varListeners.mKeys) {
                for (let i = 0; i < varListeners.mKeys.length; i++) {
                    const id = varListeners.mKeys[i];
                    if (id > 0 && id !== -2147483648 && id < 0x40000000) {
                        referencedIds.add(id);
                    }
                }
            }
        }
    }

    return referencedIds;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export const selectedGraphVarIds = new Set();
export const graphHistory = {};
export let graphWindowSec = 10;
export const GRAPH_COLORS = [
    '#38BDF8', // Cyan
    '#34D399', // Emerald
    '#FBBF24', // Amber
    '#F43F5E', // Rose
    '#C084FC', // Purple
    '#60A5FA', // Light Blue
    '#F472B6', // Pink
    '#A3E635'  // Lime
];

export function getVarColor(varId) {
    const idx = Math.abs(varId) % GRAPH_COLORS.length;
    return GRAPH_COLORS[idx];
}

export function updateVariablesPanel() {
    const container = document.getElementById('variablesListContainer');
    const badge = document.getElementById('varCountBadge');
    const filterCheckbox = document.getElementById('showReferencedVarsOnly');
    const showReferencedOnly = filterCheckbox ? filterCheckbox.checked : true;

    if (!container) return;

    const currentDocument = window.currentDocument;
    if (!currentDocument) {
        container.innerHTML = `<div style="text-align:center; padding:32px; color:var(--text-muted); font-size:0.85rem;">No document loaded yet. Drop a .rc file or json to inspect variables.</div>`;
        if (badge) badge.textContent = '0 Vars';
        return;
    }

    const state = typeof currentDocument.getRemoteComposeState === 'function' ? currentDocument.getRemoteComposeState() : currentDocument.mRemoteComposeState;
    const topOps = typeof currentDocument.getOperations === 'function' ? currentDocument.getOperations() : (currentDocument.mOps || []);
    const referencedIds = getReferencedVarIds(currentDocument);

    const rawVarList = [];
    const processedIds = new Set();

    if (Array.isArray(topOps)) {
        topOps.forEach(op => {
            if (!op) return;
            const opName = getOpName(op);
            const opCode = op.OP_CODE;

            if (opCode === 81 || opName === 'FloatExpression') {
                const id = op.mId;
                const val = state ? state.getFloat(id) : NaN;
                const bits = op.mBits || op.bits || op.srcExpression;
                const exprStr = bits ? prettyPrintFloatExpression(bits) : '';
                processedIds.add(id);
                rawVarList.push({
                    id: id,
                    name: getSystemVarName(id) || `var_${id}`,
                    type: 'FloatExpression',
                    value: val,
                    exprStr: exprStr,
                    isSystem: id <= 40
                });
            } else if (opCode === 80 || opName === 'FloatConstant') {
                const id = op.mId;
                const val = op.mValue !== undefined ? op.mValue : (state ? state.getFloat(id) : 0);
                processedIds.add(id);
                rawVarList.push({
                    id: id,
                    name: getSystemVarName(id) || `var_${id}`,
                    type: 'FloatConstant',
                    value: val,
                    isSystem: id <= 40
                });
            } else if (opCode === 83 || opName === 'IntegerConstant') {
                const id = op.mId;
                const val = op.mValue !== undefined ? op.mValue : (state ? state.getInteger(id) : 0);
                processedIds.add(id);
                rawVarList.push({
                    id: id,
                    name: `int_${id}`,
                    type: 'IntegerConstant',
                    value: val,
                    isSystem: false
                });
            } else if (opCode === 84 || opName === 'ColorConstant') {
                const id = op.mId;
                const val = op.mColor !== undefined ? op.mColor : (state ? state.getColor(id) : 0);
                processedIds.add(id);
                rawVarList.push({
                    id: id,
                    name: `color_${id}`,
                    type: 'ColorConstant',
                    value: val,
                    isSystem: false
                });
            }
        });
    }

    if (state && state.mFloatMap && typeof state.mFloatMap.forEach === 'function') {
        state.mFloatMap.forEach((id, val) => {
            if (!processedIds.has(id)) {
                processedIds.add(id);
                rawVarList.push({
                    id: id,
                    name: getSystemVarName(id) || `var_${id}`,
                    type: 'FloatState',
                    value: val,
                    isSystem: id <= 40
                });
            }
        });
    }

    // Filter variables if "Referenced Only" is enabled
    const varList = showReferencedOnly
        ? rawVarList.filter(v => referencedIds.has(v.id))
        : rawVarList;

    if (badge) badge.textContent = `${varList.length} Vars`;

    if (varList.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:32px; color:var(--text-muted); font-size:0.85rem;">No ${showReferencedOnly ? 'referenced ' : ''}variables detected in current document.</div>`;
        return;
    }

    let html = '<div class="var-table">';
    varList.forEach(v => {
        const sysBadge = v.isSystem ? `<span class="badge" style="background:rgba(56,189,248,0.15); color:var(--accent-blue); font-size:0.65rem;">SYS</span>` : '';
        const typeBadge = `<span class="badge" style="background:var(--bg-hover); color:var(--text-secondary); font-size:0.65rem;">${v.type}</span>`;
        const formattedVal = typeof v.value === 'number' ? (Number.isInteger(v.value) ? v.value : v.value.toFixed(2)) : String(v.value);
        const isChecked = selectedGraphVarIds.has(v.id);
        
        let colorSwatchHtml = '';
        if (v.type === 'ColorConstant' && typeof v.value === 'number') {
            const argb = v.value >>> 0;
            const a = ((argb >>> 24) & 0xFF) / 255;
            const r = (argb >>> 16) & 0xFF;
            const g = (argb >>> 8) & 0xFF;
            const b = argb & 0xFF;
            colorSwatchHtml = `<span style="display:inline-block; width:13px; height:13px; border-radius:3px; background-color:rgba(${r}, ${g}, ${b}, ${a.toFixed(2)}); border:1px solid rgba(255,255,255,0.4); vertical-align:middle; margin-right:4px; box-shadow:0 0 3px rgba(0,0,0,0.4);"></span>`;
        }

        html += `
            <div class="var-row" style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-bottom:1px solid var(--border-color); gap:8px;">
                <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                    <input type="checkbox" title="Plot in Graph Panel" class="var-graph-checkbox" data-var-id="${v.id}" ${isChecked ? 'checked' : ''} onchange="toggleGraphVariable(${v.id}, this.checked)">
                    <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            ${colorSwatchHtml}
                            <strong style="font-family:var(--code-font); font-size:0.8rem; color:var(--text-primary);">${escapeHtml(v.name)}</strong>
                            <span style="font-family:var(--code-font); font-size:0.7rem; color:var(--text-muted);">#${v.id}</span>
                            ${sysBadge}
                            ${typeBadge}
                        </div>
                        ${v.exprStr ? `<div style="font-family:var(--code-font); font-size:0.72rem; color:var(--accent-blue); opacity:0.9;">= ${v.exprStr}</div>` : ''}
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <input type="number" step="any" value="${formattedVal}" class="dim-input var-input-field" data-var-id="${v.id}" style="width:90px; text-align:right; font-family:var(--code-font);" onchange="onVarValueEdit(${v.id}, this.value)">
                </div>
            </div>
        `;
    });
    html += '</div>';

    container.innerHTML = html;
}

export function toggleGraphVariable(varId, isChecked) {
    if (isChecked) {
        selectedGraphVarIds.add(varId);
        if (!graphHistory[varId]) graphHistory[varId] = [];
        if (typeof window.restorePanel === 'function') window.restorePanel('pane6');
    } else {
        selectedGraphVarIds.delete(varId);
        delete graphHistory[varId];
    }
    updateGraphLegend();
    renderGraphCanvas();
}

export function setGraphWindowDuration(val) {
    graphWindowSec = parseFloat(val) || 10;
    renderGraphCanvas();
}

export function clearGraphData() {
    Object.keys(graphHistory).forEach(key => {
        graphHistory[key] = [];
    });
    renderGraphCanvas();
}

export function updateGraphLegend() {
    const legendContainer = document.getElementById('graphLegendBar');
    if (!legendContainer) return;

    if (selectedGraphVarIds.size === 0) {
        legendContainer.innerHTML = `<span style="color:var(--text-muted);">Select variables in Panel 🎛️ to plot</span>`;
        return;
    }

    let html = '';
    selectedGraphVarIds.forEach(id => {
        const color = getVarColor(id);
        const name = getSystemVarName(id) || `var_${id}`;
        const history = graphHistory[id] || [];
        const lastVal = history.length > 0 ? history[history.length - 1].val : NaN;
        const formattedVal = !isNaN(lastVal) ? (Number.isInteger(lastVal) ? lastVal : lastVal.toFixed(2)) : '--';

        html += `
            <div style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.05); padding:2px 8px; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">
                <span style="width:8px; height:8px; border-radius:50%; background:${color}; display:inline-block;"></span>
                <span style="font-weight:600; font-family:var(--code-font); color:var(--text-primary);">${escapeHtml(name)}</span>
                <span style="font-family:var(--code-font); color:${color}; font-weight:bold;">${formattedVal}</span>
                <button onclick="toggleGraphVariable(${id}, false); const cb = document.querySelector('.var-graph-checkbox[data-var-id=\\'${id}\\']'); if(cb) cb.checked=false;" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.75rem; margin-left:2px;">✕</button>
            </div>
        `;
    });

    legendContainer.innerHTML = html;
}

export function renderGraphCanvas() {
    const pane6 = document.getElementById('pane6');
    const canvas = document.getElementById('varGraphCanvas');
    if (!canvas) return;

    const rect = (canvas.parentNode && typeof canvas.parentNode.getBoundingClientRect === 'function')
        ? canvas.parentNode.getBoundingClientRect()
        : (typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : { width: 300, height: 150 });
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    if (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height)) {
        canvas.width = Math.floor(rect.width);
        canvas.height = Math.floor(rect.height);
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    if (selectedGraphVarIds.size === 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No variables selected for graphing. Check boxes in Panel 🎛️', w / 2, h / 2);
        return;
    }

    const now = performance.now();
    const windowMs = graphWindowSec * 1000;
    const startTime = now - windowMs;

    let globalMin = Infinity;
    let globalMax = -Infinity;

    selectedGraphVarIds.forEach(id => {
        const history = graphHistory[id] || [];
        history.forEach(sample => {
            if (sample.t >= startTime) {
                if (sample.val < globalMin) globalMin = sample.val;
                if (sample.val > globalMax) globalMax = sample.val;
            }
        });
    });

    if (globalMin === Infinity || globalMax === -Infinity) {
        globalMin = 0;
        globalMax = 100;
    } else if (globalMin === globalMax) {
        globalMin -= 1;
        globalMax += 1;
    }

    const yMargin = (globalMax - globalMin) * 0.1 || 1;
    const yMin = globalMin - yMargin;
    const yMax = globalMax + yMargin;

    const padLeft = 45;
    const padRight = 15;
    const padTop = 20;
    const padBottom = 25;

    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    
    for (let i = 0; i <= 4; i++) {
        const y = padTop + (plotH * i / 4);
        ctx.moveTo(padLeft, y);
        ctx.lineTo(w - padRight, y);

        const val = yMax - (i / 4) * (yMax - yMin);
        ctx.fillStyle = '#64748b';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(val.toFixed(1), padLeft - 6, y + 3);
    }

    for (let i = 0; i <= 5; i++) {
        const x = padLeft + (plotW * i / 5);
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, h - padBottom);

        const secAgo = graphWindowSec * (1 - i / 5);
        let label = '';
        if (secAgo === 0) {
            label = 'now';
        } else if (secAgo >= 60) {
            const m = Math.floor(secAgo / 60);
            const s = Math.round(secAgo % 60);
            label = s > 0 ? `-${m}m${s}s` : `-${m}m`;
        } else {
            label = `-${secAgo.toFixed(0)}s`;
        }

        ctx.fillStyle = '#64748b';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, x, h - padBottom + 14);
    }
    ctx.stroke();

    if (yMin <= 0 && yMax >= 0) {
        const zeroY = padTop + plotH * (1 - (0 - yMin) / (yMax - yMin));
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, zeroY);
        ctx.lineTo(w - padRight, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    selectedGraphVarIds.forEach(id => {
        const history = graphHistory[id];
        if (!history || history.length === 0) return;

        const color = getVarColor(id);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        let started = false;
        history.forEach(sample => {
            if (sample.t < startTime) return;

            const tNorm = (sample.t - startTime) / windowMs;
            const x = padLeft + tNorm * plotW;
            const yNorm = (sample.val - yMin) / (yMax - yMin);
            const y = padTop + (1 - yNorm) * plotH;

            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();
    });
}

export function updateVariableValuesLive() {
    const currentDocument = window.currentDocument;
    const currentPlayer = window.currentPlayer;
    const rCtx = currentPlayer ? (typeof currentPlayer.getRemoteContext === 'function' ? currentPlayer.getRemoteContext() : null) : null;
    const state = currentDocument ? (typeof currentDocument.getRemoteComposeState === 'function' ? currentDocument.getRemoteComposeState() : currentDocument.mRemoteComposeState) : null;
    
    if (state || rCtx) {
        const inputs = document.querySelectorAll('.var-input-field');
        inputs.forEach(input => {
            if (document.activeElement === input) return;
            const varId = parseInt(input.dataset.varId, 10);
            if (isNaN(varId)) return;

            let liveVal = rCtx && typeof rCtx.getFloat === 'function' ? rCtx.getFloat(varId) : (state ? state.getFloat(varId) : NaN);
            if (liveVal === undefined || Number.isNaN(liveVal)) {
                liveVal = state ? state.getFloat(varId) : NaN;
            }
            if (liveVal === undefined || Number.isNaN(liveVal)) {
                liveVal = rCtx && typeof rCtx.getInteger === 'function' ? rCtx.getInteger(varId) : (state ? state.getInteger(varId) : NaN);
            }
            if (liveVal === undefined || Number.isNaN(liveVal)) {
                liveVal = state ? state.getInteger(varId) : NaN;
            }

            if (typeof liveVal === 'number' && !Number.isNaN(liveVal)) {
                const formatted = Number.isInteger(liveVal) ? liveVal.toString() : liveVal.toFixed(2);
                if (input.value !== formatted) {
                    input.value = formatted;
                }
            }
        });

        // Update running tree layout dimensions and expressions per frame
        if (typeof window.updateRunningTreeLive === 'function') window.updateRunningTreeLive();
        else if (typeof updateRunningTreeLive === 'function') updateRunningTreeLive();

        // Update Expression Dependency Graph live values per frame
        if (typeof window.updateExprGraphLiveValues === 'function') window.updateExprGraphLiveValues();
        else if (typeof updateExprGraphLiveValues === 'function') updateExprGraphLiveValues();

        // Record history for graph series
        if (selectedGraphVarIds.size > 0) {
            const now = performance.now();
            const windowMs = graphWindowSec * 1000;

            selectedGraphVarIds.forEach(varId => {
                let val = rCtx && typeof rCtx.getFloat === 'function' ? rCtx.getFloat(varId) : (state ? state.getFloat(varId) : NaN);
                if (val === undefined || Number.isNaN(val)) {
                    val = state ? state.getFloat(varId) : (rCtx && typeof rCtx.getInteger === 'function' ? rCtx.getInteger(varId) : NaN);
                }
                if (typeof val === 'number' && !Number.isNaN(val)) {
                    if (!graphHistory[varId]) graphHistory[varId] = [];
                    graphHistory[varId].push({ t: now, val: val });

                    while (graphHistory[varId].length > 0 && graphHistory[varId][0].t < now - windowMs - 2000) {
                        graphHistory[varId].shift();
                    }
                }
            });

            updateGraphLegend();
            renderGraphCanvas();
        }
    }
}

export function onVarValueEdit(varId, valStr) {
    const num = parseFloat(valStr);
    const currentDocument = window.currentDocument;
    const currentPlayer = window.currentPlayer;
    if (isNaN(num) || !currentDocument) return;
    const state = typeof currentDocument.getRemoteComposeState === 'function' ? currentDocument.getRemoteComposeState() : currentDocument.mRemoteComposeState;
    if (state && typeof state.overrideFloat === 'function') {
        state.overrideFloat(varId, num);
        if (currentPlayer && typeof currentPlayer.repaint === 'function') {
            currentPlayer.repaint();
        }
    }
}

// Window attachments for inline HTML event handlers
window.getSystemVarName = getSystemVarName;
window.getReferencedVarIds = getReferencedVarIds;
window.updateVariablesPanel = updateVariablesPanel;
window.toggleGraphVariable = toggleGraphVariable;
window.setGraphWindowDuration = setGraphWindowDuration;
window.clearGraphData = clearGraphData;
window.updateGraphLegend = updateGraphLegend;
window.renderGraphCanvas = renderGraphCanvas;
window.updateVariableValuesLive = updateVariableValuesLive;
window.onVarValueEdit = onVarValueEdit;
window.getVarColor = getVarColor;
window.selectedGraphVarIds = selectedGraphVarIds;
window.graphHistory = graphHistory;
