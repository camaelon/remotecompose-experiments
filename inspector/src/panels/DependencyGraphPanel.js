// =========================================================================
// Panel 9: Expression Dependency Graph Engine & Dead-Code Analyzer
// Modularized in src/panels/DependencyGraphPanel.js
// =========================================================================

let exprGraphMode = 'graph'; // 'graph' | 'tree'
let selectedExprNodeId = null;
let exprGraphPan = { x: 40, y: 40 };
let exprGraphZoom = 1.0;
let isExprGraphDragging = false;
let exprGraphDragStart = { x: 0, y: 0 };
let exprGraphData = { nodes: [], edges: [], nodeMap: new Map() };
let exprGraphNodePositions = new Map();

import { getOpVarReferences, getOpVarOutputs, formatOpParameters } from './OpParameters.js';

// Operations that define a variable without being a FloatExpression/Constant. They are the
// sources of "derived" values such as componentWidth() or a measured text length. Without
// them the draw operations that read their output resolve to no known producer and were
// dropped from the graph entirely.
const COMPONENT_VALUE_TYPES = ['componentWidth', 'componentHeight', 'componentX', 'componentY',
    'componentRootX', 'componentRootY', 'contentWidth', 'contentHeight'];

const DERIVED_VALUE_PRODUCERS = {
    150: { idField: 'mValueId', label: (op) => `${COMPONENT_VALUE_TYPES[op.mType ?? 0] || 'componentValue'}(${op.mComponentId})` },
    155: { idField: 'mId', label: () => 'textMeasure()' },
    156: { idField: 'mLengthId', label: () => 'textLength()' },
    157: { idField: 'mId', label: () => 'touchExpression()' },
    170: { idField: 'mId', label: () => 'textAttribute()' },
    180: { idField: 'mOutputId', label: () => 'colorAttribute()' },
    154: { idField: 'mId', label: () => 'dataMapLookup()' },
    192: { idField: 'mTextId', label: () => 'idLookup()' },
    116: { idField: 'mId', label: () => 'vectorExpression()' },
    187: { idField: 'mMatrixId', label: () => 'matrixExpression()' },
    196: { idField: 'mId', label: () => 'colorTheme()' }
};

function toRawBitsHelper(raw) {
    return typeof window.toRawBits === 'function' ? window.toRawBits(raw) : (raw >>> 0);
}

function getSystemVarName(id) {
    return typeof window.getSystemVarName === 'function' ? window.getSystemVarName(id) : null;
}

export function getFloatExprVarDependencies(bits) {
    if (!bits || !bits.length) return [];
    const deps = new Set();
    const OFFSET = 0x310000;
    function isNaNBits(b) { return (b & 0x7f800000) === 0x7f800000 && (b & 0x7fffff) !== 0; }
    function idFromBits(b) { return b & 0x7fffff; }

    for (let i = 0; i < bits.length; i++) {
        const raw = bits[i];
        const b = toRawBitsHelper(raw);
        if (isNaNBits(b)) {
            const id = idFromBits(b);
            if ((id & 0x700000) === 0x200000) {
                // array reference
            } else if (id > OFFSET && id <= OFFSET + 79) {
                // RPN operator
            } else {
                deps.add(id);
            }
        }
    }
    return Array.from(deps);
}

export function getIntegerExprVarDependencies(mask, vals) {
    if (!vals || !vals.length) return [];
    const deps = new Set();
    const OFFSET = 0x10000;
    for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        const isMaskBitSet = ((1 << i) & mask) !== 0;
        if (isMaskBitSet && v >= OFFSET) {
            // OPERATOR
        } else if (isMaskBitSet && v < OFFSET) {
            deps.add(v);
        }
    }
    return Array.from(deps);
}

export function setExprGraphDisplayMode(mode) {
    exprGraphMode = mode;
    const graphBtn = document.getElementById('exprGraphViewBtn');
    const treeBtn = document.getElementById('exprListViewBtn');
    const svgEl = document.getElementById('exprGraphSvg');
    const treeEl = document.getElementById('exprTreeContainer');

    if (mode === 'graph') {
        if (graphBtn) { graphBtn.classList.add('active'); graphBtn.classList.remove('btn-secondary'); }
        if (treeBtn) { treeBtn.classList.remove('active'); treeBtn.classList.add('btn-secondary'); }
        if (svgEl) svgEl.style.display = 'block';
        if (treeEl) treeEl.style.display = 'none';
    } else {
        if (treeBtn) { treeBtn.classList.add('active'); treeBtn.classList.remove('btn-secondary'); }
        if (graphBtn) { graphBtn.classList.remove('active'); graphBtn.classList.add('btn-secondary'); }
        if (svgEl) svgEl.style.display = 'none';
        if (treeEl) treeEl.style.display = 'block';
    }
    renderExpressionDependencyGraph();
}

export function resetExprGraphZoom() {
    exprGraphPan = { x: 40, y: 40 };
    exprGraphZoom = 1.0;
    updateExprSvgTransform();
}

let exprGraphSortUnusedFirst = false;
export function toggleExprGraphSortUnused() {
    exprGraphSortUnusedFirst = !exprGraphSortUnusedFirst;
    const btn = document.getElementById('exprSortUnusedBtn');
    if (btn) {
        if (exprGraphSortUnusedFirst) {
            btn.classList.add('active');
            btn.style.background = 'rgba(249,115,22,0.25)';
            btn.style.borderColor = '#f97316';
            btn.style.color = '#f97316';
            btn.textContent = '⚠️ Unused First: ON';
        } else {
            btn.classList.remove('active');
            btn.style.background = '';
            btn.style.borderColor = '';
            btn.style.color = '';
            btn.textContent = '⚠️ Unused First: OFF';
        }
    }
    renderExpressionDependencyGraph();
}

let isExprVariableSimulatorOpen = false;

export function toggleExprVariableSimulator() {
    isExprVariableSimulatorOpen = !isExprVariableSimulatorOpen;
    const tray = document.getElementById('exprVariableSimulatorTray');
    const btn = document.getElementById('exprSimulatorToggleBtn');
    if (tray && btn) {
        if (isExprVariableSimulatorOpen) {
            tray.style.display = 'flex';
            btn.classList.add('active');
            btn.style.background = 'rgba(251,191,36,0.22)';
            btn.style.borderColor = 'var(--accent-amber)';
            btn.style.color = 'var(--accent-amber)';
            renderExprVariableSimulator();
        } else {
            tray.style.display = 'none';
            btn.classList.remove('active');
            btn.style.background = '';
            btn.style.borderColor = '';
            btn.style.color = '';
        }
    }
}

function renderExprVariableSimulator() {
    const listEl = document.getElementById('exprSimulatorList');
    const currentDocument = window.currentDocument;
    const escapeHtml = typeof window.escapeHtml === 'function' ? window.escapeHtml : (s => s);
    if (!listEl || !currentDocument) return;

    const state = typeof currentDocument.getRemoteComposeState === 'function' ? currentDocument.getRemoteComposeState() : currentDocument.mRemoteComposeState;
    if (!state || !exprGraphData || !exprGraphData.nodes) {
        listEl.innerHTML = `<div style="color:var(--text-muted); font-style:italic;">No active document state loaded.</div>`;
        return;
    }

    const simNodes = exprGraphData.nodes.filter(n => n.type === 'sys_var' || n.type === 'constant');

    if (simNodes.length === 0) {
        listEl.innerHTML = `<div style="color:var(--text-muted); font-style:italic;">No input system variables or constants found in this document.</div>`;
        return;
    }

    let html = '';
    simNodes.forEach(node => {
        const varId = node.varId;
        if (varId === null || varId === undefined) return;

        let currVal = state.getFloat(varId);
        if (currVal === undefined || Number.isNaN(currVal)) {
            currVal = state.getInteger(varId) ?? 0;
        }

        let minVal = 0, maxVal = 100, stepVal = 0.1;
        const sysName = getSystemVarName(varId);
        if (sysName) {
            if (sysName.includes('TIME')) { minVal = 0; maxVal = 60; stepVal = 0.1; }
            else if (sysName.includes('ANIM') || sysName.includes('PROGRESS')) { minVal = 0; maxVal = 1; stepVal = 0.01; }
            else if (sysName.includes('WIDTH') || sysName.includes('HEIGHT')) { minVal = 0; maxVal = 2000; stepVal = 1; }
            else { minVal = Math.min(-100, Math.floor(currVal * 2)); maxVal = Math.max(100, Math.ceil(currVal * 2)); }
        } else {
            minVal = Math.min(-100, Math.floor(currVal * 2));
            maxVal = Math.max(100, Math.ceil(currVal * 2));
            if (minVal === maxVal) { minVal = 0; maxVal = 100; }
        }

        const formatted = Number.isInteger(currVal) ? currVal.toString() : currVal.toFixed(2);

        html += `
            <div style="display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.2); padding:4px 8px; border-radius:4px; border:1px solid var(--border-color);">
                <span style="font-family:var(--code-font); font-weight:600; color:${node.type === 'sys_var' ? '#d97706' : '#059669'}; width:140px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${escapeHtml(node.label)}">
                    ${node.type === 'sys_var' ? '🟨' : '🟩'} ${escapeHtml(node.label)}
                </span>
                <input type="range" min="${minVal}" max="${maxVal}" step="${stepVal}" value="${formatted}" style="flex:1; accent-color:var(--accent-amber); cursor:pointer;" oninput="onExprSimulatorSliderChange(${varId}, this.value, 'slider-${varId}')">
                <input type="number" id="slider-${varId}-num" value="${formatted}" step="${stepVal}" style="width:60px; padding:1px 4px; font-size:0.72rem; font-family:var(--code-font); background:var(--bg-main); border:1px solid var(--border-color); color:var(--text-primary); border-radius:3px;" oninput="onExprSimulatorSliderChange(${varId}, this.value, 'slider-${varId}')">
            </div>
        `;
    });

    listEl.innerHTML = html;
}

export function onExprSimulatorSliderChange(varId, valStr, numInputId) {
    const num = parseFloat(valStr);
    const currentDocument = window.currentDocument;
    if (isNaN(num) || !currentDocument) return;

    const state = typeof currentDocument.getRemoteComposeState === 'function' ? currentDocument.getRemoteComposeState() : currentDocument.mRemoteComposeState;
    if (state) {
        if (typeof state.setFloat === 'function') state.setFloat(varId, num);
        if (typeof state.overrideFloat === 'function') state.overrideFloat(varId, num);
        if (typeof state.setInteger === 'function' && Number.isInteger(num)) state.setInteger(varId, num);
    }

    if (numInputId) {
        const numEl = document.getElementById(`${numInputId}-num`);
        if (numEl && document.activeElement !== numEl) {
            numEl.value = Number.isInteger(num) ? num.toString() : num.toFixed(2);
        }
    }

    if (typeof window.updateVariableValuesLive === 'function') {
        window.updateVariableValuesLive();
    }
}

let isExprCriticalPathActive = false;

export function toggleExprCriticalPathTrace() {
    isExprCriticalPathActive = !isExprCriticalPathActive;
    const btn = document.getElementById('exprCriticalPathBtn');
    if (btn) {
        if (isExprCriticalPathActive) {
            btn.classList.add('active');
            btn.style.background = 'rgba(245,158,11,0.25)';
            btn.style.borderColor = '#f59e0b';
            btn.style.color = '#f59e0b';
            btn.textContent = '🔥 Critical Path: ON';
        } else {
            btn.classList.remove('active');
            btn.style.background = '';
            btn.style.borderColor = '';
            btn.style.color = '';
            btn.textContent = '🔥 Critical Path';
        }
    }
    renderExpressionDependencyGraph();
}

function findCriticalPathNodes(graphData) {
    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) return { pathNodeSet: new Set(), pathEdgeSet: new Set(), maxDepth: 0 };

    const dist = new Map();
    const parentMap = new Map();

    graphData.nodes.forEach(n => dist.set(n.id, 0));

    graphData.nodes.forEach(u => {
        const uDist = dist.get(u.id);
        if (u.outputs) {
            u.outputs.forEach(vId => {
                if (dist.get(vId) < uDist + 1) {
                    dist.set(vId, uDist + 1);
                    parentMap.set(vId, u.id);
                }
            });
        }
    });

    let maxDist = 0;
    let targetNodeId = null;
    dist.forEach((d, id) => {
        if (d > maxDist) {
            maxDist = d;
            targetNodeId = id;
        }
    });

    const pathNodeSet = new Set();
    const pathEdgeSet = new Set();

    if (targetNodeId) {
        let curr = targetNodeId;
        while (curr) {
            pathNodeSet.add(curr);
            const p = parentMap.get(curr);
            if (p) {
                pathEdgeSet.add(`${p}->${curr}`);
            }
            curr = p;
        }
    }

    return { pathNodeSet, pathEdgeSet, maxDepth: maxDist };
}

let exprGraphCullRafId = null;
function scheduleExprGraphCullUpdate() {
    if (exprGraphCullRafId) return;
    exprGraphCullRafId = requestAnimationFrame(() => {
        exprGraphCullRafId = null;
        if (exprGraphMode === 'graph' && window.currentDocument) {
            const pane9 = document.getElementById('pane9');
            if (pane9 && !pane9.classList.contains('hidden-panel')) {
                renderExpressionDependencyGraph();
            }
        }
    });
}

let isMinimapCollapsed = false;

export function toggleExprMinimapCollapse(e) {
    if (e) e.stopPropagation();
    isMinimapCollapsed = !isMinimapCollapsed;
    const container = document.getElementById('exprGraphMinimapContainer');
    const toggleBtn = document.getElementById('exprMinimapToggleBtn');
    const body = document.getElementById('exprGraphMinimapBody');
    if (container && toggleBtn && body) {
        if (isMinimapCollapsed) {
            container.style.height = '24px';
            body.style.display = 'none';
            toggleBtn.textContent = '+';
        } else {
            container.style.height = '110px';
            body.style.display = 'block';
            toggleBtn.textContent = '−';
            updateExprGraphMinimap();
        }
    }
}

function updateExprGraphMinimap() {
    const minimapSvg = document.getElementById('exprGraphMinimapSvg');
    const container = document.getElementById('exprGraphCanvasContainer');
    if (!minimapSvg || !container || isMinimapCollapsed || !exprGraphNodePositions || exprGraphNodePositions.size === 0) return;

    const cW = container.clientWidth || 800;
    const cH = container.clientHeight || 600;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    exprGraphNodePositions.forEach(pos => {
        if (pos.x < minX) minX = pos.x;
        if (pos.x + 190 > maxX) maxX = pos.x + 190;
        if (pos.y < minY) minY = pos.y;
        if (pos.y + 64 > maxY) maxY = pos.y + 64;
    });

    if (minX === Infinity) return;

    minX -= 60; maxX += 60;
    minY -= 40; maxY += 40;

    const graphW = Math.max(100, maxX - minX);
    const graphH = Math.max(100, maxY - minY);

    const mWidth = minimapSvg.clientWidth || 160;
    const mHeight = minimapSvg.clientHeight || 85;

    const scaleX = mWidth / graphW;
    const scaleY = mHeight / graphH;

    const vMinX = -exprGraphPan.x / exprGraphZoom;
    const vMaxX = (cW - exprGraphPan.x) / exprGraphZoom;
    const vMinY = -exprGraphPan.y / exprGraphZoom;
    const vMaxY = (cH - exprGraphPan.y) / exprGraphZoom;

    const vx = Math.max(0, (vMinX - minX) * scaleX);
    const vy = Math.max(0, (vMinY - minY) * scaleY);
    const vw = Math.min(mWidth - vx, Math.max(6, (vMaxX - vMinX) * scaleX));
    const vh = Math.min(mHeight - vy, Math.max(6, (vMaxY - vMinY) * scaleY));

    const { unusedIslandSet } = getUnusedIslandsAnalysis(window.currentDocument);

    let svgContent = '';

    if (exprGraphData && exprGraphData.nodes) {
        exprGraphData.nodes.forEach(node => {
            const pos = exprGraphNodePositions.get(node.id);
            if (!pos) return;

            const nx = (pos.x - minX) * scaleX;
            const ny = (pos.y - minY) * scaleY;
            const nw = Math.max(3, 190 * scaleX);
            const nh = Math.max(2, 64 * scaleY);

            let color = '#0284c7';
            if (unusedIslandSet.has(node.id)) color = '#f97316';
            else if (node.type === 'int_expr') color = '#9333ea';
            else if (node.type === 'sys_var') color = '#d97706';
            else if (node.type === 'constant') color = '#059669';
            else if (node.type === 'derived') color = '#0d9488';
            else if (node.type === 'consumer') color = '#e11d48';

            svgContent += `<rect x="${nx.toFixed(1)}" y="${ny.toFixed(1)}" width="${nw.toFixed(1)}" height="${nh.toFixed(1)}" rx="1" fill="${color}" opacity="0.85" />`;
        });
    }

    svgContent += `
        <rect id="exprMinimapViewport" x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" rx="2" fill="rgba(56,189,248,0.18)" stroke="#38bdf8" stroke-width="1.5" style="cursor:move;" />
    `;

    minimapSvg.innerHTML = svgContent;

    const body = document.getElementById('exprGraphMinimapBody');
    if (body && !body.dataset.minimapInit) {
        body.dataset.minimapInit = 'true';

        const handleMinimapPan = (e) => {
            const rect = body.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            const targetWorldX = minX + (clickX / scaleX);
            const targetWorldY = minY + (clickY / scaleY);

            exprGraphPan.x = (cW / 2) - targetWorldX * exprGraphZoom;
            exprGraphPan.y = (cH / 2) - targetWorldY * exprGraphZoom;

            updateExprSvgTransform();
            scheduleExprGraphCullUpdate();
        };

        let isMinimapDragging = false;
        body.addEventListener('pointerdown', (e) => {
            isMinimapDragging = true;
            handleMinimapPan(e);
        });

        window.addEventListener('pointermove', (e) => {
            if (isMinimapDragging) handleMinimapPan(e);
        });

        window.addEventListener('pointerup', () => {
            isMinimapDragging = false;
        });
    }
}

function updateExprSvgTransform() {
    const g = document.getElementById('exprGraphGroup');
    if (g) {
        g.setAttribute('transform', `translate(${exprGraphPan.x}, ${exprGraphPan.y}) scale(${exprGraphZoom})`);
    }
    updateExprGraphMinimap();
}

function initExprGraphInteractions() {
    const container = document.getElementById('exprGraphCanvasContainer');
    if (!container || container.dataset.exprInit === 'true') return;
    container.dataset.exprInit = 'true';

    let pointerDownPos = { x: 0, y: 0 };

    container.addEventListener('pointerdown', (e) => {
        pointerDownPos = { x: e.clientX, y: e.clientY };
        if (e.target.closest('.expr-node')) return;
        isExprGraphDragging = true;
        container.style.cursor = 'grabbing';
        exprGraphDragStart = { x: e.clientX - exprGraphPan.x, y: e.clientY - exprGraphPan.y };
    });

    window.addEventListener('pointermove', (e) => {
        if (!isExprGraphDragging) return;
        exprGraphPan.x = e.clientX - exprGraphDragStart.x;
        exprGraphPan.y = e.clientY - exprGraphDragStart.y;
        updateExprSvgTransform();
        scheduleExprGraphCullUpdate();
    });

    window.addEventListener('pointerup', (e) => {
        const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
        if (isExprGraphDragging) {
            isExprGraphDragging = false;
            container.style.cursor = 'grab';
            scheduleExprGraphCullUpdate();
        }
        // Deselect if clicking on empty canvas without dragging
        if (!e.target.closest('.expr-node') && !e.target.closest('#exprNodeDetailCard') && !e.target.closest('#exprGraphLegendBar') && dist < 5) {
            if (selectedExprNodeId) {
                deselectExprGraphNode();
            }
        }
    });

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        const newZoom = Math.max(0.25, Math.min(3.0, exprGraphZoom * zoomFactor));

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        exprGraphPan.x = mouseX - (mouseX - exprGraphPan.x) * (newZoom / exprGraphZoom);
        exprGraphPan.y = mouseY - (mouseY - exprGraphPan.y) * (newZoom / exprGraphZoom);
        exprGraphZoom = newZoom;
        updateExprSvgTransform();
        scheduleExprGraphCullUpdate();
    }, { passive: false });
}

export function buildExpressionGraphModel(doc) {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();

    if (!doc) return { nodes, edges, nodeMap };

    const currentBuffer = window.currentBuffer;
    const getAllOperationsFlat = typeof window.getAllOperationsFlat === 'function' ? window.getAllOperationsFlat : (() => []);
    const getOpName = typeof window.getOpName === 'function' ? window.getOpName : (() => '');
    const getOpId = typeof window.getOpId === 'function' ? window.getOpId : (() => null);
    const isContainerOp = typeof window.isContainerOp === 'function' ? window.isContainerOp : (() => false);
    const prettyPrintFloatExpression = typeof window.prettyPrintFloatExpression === 'function' ? window.prettyPrintFloatExpression : (() => '');
    const prettyPrintIntegerExpression = typeof window.prettyPrintIntegerExpression === 'function' ? window.prettyPrintIntegerExpression : (() => '');

    const topOps = getAllOperationsFlat(doc, currentBuffer ? new Uint8Array(currentBuffer) : null);
    const state = typeof doc.getRemoteComposeState === 'function' ? doc.getRemoteComposeState() : doc.mRemoteComposeState;

    function getOrCreateNode(idKey, defaultObj) {
        if (nodeMap.has(idKey)) return nodeMap.get(idKey);
        const node = {
            id: idKey,
            varId: defaultObj.varId ?? null,
            label: defaultObj.label || idKey,
            type: defaultObj.type || 'sys_var',
            formula: defaultObj.formula || '',
            value: defaultObj.value || '0',
            inputs: [],
            outputs: [],
            op: defaultObj.op || null
        };
        nodeMap.set(idKey, node);
        nodes.push(node);
        return node;
    }

    // 1. Scan operations for Expressions and Constants
    if (Array.isArray(topOps)) {
        topOps.forEach((op, opIdx) => {
            if (!op) return;
            const opName = getOpName(op);
            const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : 0);

            const varId = getOpId(op);

            if (opCode === 81 || opName === 'FloatExpression' || opName.includes('FloatExpression')) {
                if (varId !== null && varId !== undefined) {
                    const nodeId = `var_${varId}`;
                    const bits = op.mBits || op.bits || op.srcExpression || op.mSrcExpression || op.mFloatExpression || op.mExp || op.exp;
                    const formulaStr = bits ? prettyPrintFloatExpression(bits) : '';
                    let liveVal = state ? state.getFloat(varId) : NaN;
                    if (Number.isNaN(liveVal) || liveVal === undefined) liveVal = 0;
                    const formattedVal = Number.isInteger(liveVal) ? liveVal.toString() : liveVal.toFixed(2);

                    const node = getOrCreateNode(nodeId, {
                        varId: varId,
                        label: getSystemVarName(varId) || `var_${varId}`,
                        type: 'float_expr',
                        formula: formulaStr,
                        value: formattedVal,
                        op: op
                    });

                    const inputVarIds = getFloatExprVarDependencies(bits);
                    inputVarIds.forEach(inId => {
                        const inNodeId = (inId <= 40 || getSystemVarName(inId)) ? `sys_${inId}` : `var_${inId}`;
                        const inLabel = getSystemVarName(inId) || `var_${inId}`;
                        const inNode = getOrCreateNode(inNodeId, {
                            varId: inId,
                            label: inLabel,
                            type: inId <= 40 ? 'sys_var' : 'constant',
                            formula: `ID ${inId}`,
                            value: state ? (state.getFloat(inId) ?? state.getInteger(inId) ?? '0') : '0'
                        });
                        if (!node.inputs.includes(inNodeId)) node.inputs.push(inNodeId);
                        if (!inNode.outputs.includes(nodeId)) inNode.outputs.push(nodeId);
                        edges.push({ from: inNodeId, to: nodeId });
                    });
                }

            } else if (opCode === 144 || opCode === 82 || opName.includes('IntegerExpression')) {
                if (varId !== null && varId !== undefined) {
                    const nodeId = `var_${varId}`;
                    const mask = op.mMask ?? op.mask ?? 0;
                    const vals = op.mValues ?? op.values ?? op.srcExpression ?? op.mSrcExpression;
                    const formulaStr = vals ? prettyPrintIntegerExpression(mask, vals) : '';
                    let liveVal = state ? state.getInteger(varId) : NaN;
                    if (Number.isNaN(liveVal) || liveVal === undefined) liveVal = 0;

                    const node = getOrCreateNode(nodeId, {
                        varId: varId,
                        label: `int_${varId}`,
                        type: 'int_expr',
                        formula: formulaStr,
                        value: liveVal.toString(),
                        op: op
                    });

                    const inputVarIds = getIntegerExprVarDependencies(mask, vals);
                    inputVarIds.forEach(inId => {
                        const inNodeId = (inId <= 40 || getSystemVarName(inId)) ? `sys_${inId}` : `var_${inId}`;
                        const inLabel = getSystemVarName(inId) || `var_${inId}`;
                        const inNode = getOrCreateNode(inNodeId, {
                            varId: inId,
                            label: inLabel,
                            type: inId <= 40 ? 'sys_var' : 'constant',
                            formula: `ID ${inId}`,
                            value: state ? (state.getInteger(inId) ?? state.getFloat(inId) ?? '0') : '0'
                        });
                        if (!node.inputs.includes(inNodeId)) node.inputs.push(inNodeId);
                        if (!inNode.outputs.includes(nodeId)) inNode.outputs.push(nodeId);
                        edges.push({ from: inNodeId, to: nodeId });
                    });
                }

            } else if (opCode === 80 || opName === 'FloatConstant') {
                if (varId !== null && varId !== undefined) {
                    const nodeId = `var_${varId}`;
                    const val = op.mValue !== undefined ? op.mValue : (state ? state.getFloat(varId) : 0);
                    getOrCreateNode(nodeId, {
                        varId: varId,
                        label: getSystemVarName(varId) || `var_${varId}`,
                        type: 'constant',
                        formula: `Constant (${val})`,
                        value: typeof val === 'number' ? (Number.isInteger(val) ? val.toString() : val.toFixed(2)) : String(val),
                        op: op
                    });
                }

            } else if (opCode === 83 || opName === 'IntegerConstant') {
                if (varId !== null && varId !== undefined) {
                    const nodeId = `var_${varId}`;
                    const val = op.mValue !== undefined ? op.mValue : (state ? state.getInteger(varId) : 0);
                    getOrCreateNode(nodeId, {
                        varId: varId,
                        label: `int_${varId}`,
                        type: 'constant',
                        formula: `Int Constant (${val})`,
                        value: String(val),
                        op: op
                    });
                }

            } else if (getOpVarOutputs(op).length > 0) {
                // Any operation that declares an output variable is a producer: componentWidth(),
                // a loop index, a measured text length, a particle attribute. Each output becomes
                // a node so that draw operations reading it are no longer orphaned.
                const spec = DERIVED_VALUE_PRODUCERS[opCode];
                const inputIds = getOpVarReferences(op);
                getOpVarOutputs(op).forEach(outId => {
                    if (outId === null || outId === undefined || outId <= 0) return;
                    const nodeId = `var_${outId}`;
                    const liveVal = state ? (state.getFloat(outId) ?? state.getInteger(outId)) : null;
                    const shownVal = (liveVal === null || liveVal === undefined || Number.isNaN(liveVal))
                        ? '0'
                        : (Number.isInteger(liveVal) ? String(liveVal) : liveVal.toFixed(2));
                    const node = getOrCreateNode(nodeId, {
                        varId: outId,
                        label: getSystemVarName(outId) || `var_${outId}`,
                        type: 'derived',
                        formula: spec ? spec.label(op) : `${opName}()`,
                        value: shownVal,
                        op: op
                    });
                    inputIds.forEach(inId => {
                        const inNodeId = (inId <= 40 || getSystemVarName(inId)) ? `sys_${inId}` : `var_${inId}`;
                        const inNode = getOrCreateNode(inNodeId, {
                            varId: inId,
                            label: getSystemVarName(inId) || `var_${inId}`,
                            type: inId <= 40 ? 'sys_var' : 'constant',
                            formula: `ID ${inId}`,
                            value: state ? String(state.getFloat(inId) ?? state.getInteger(inId) ?? 0) : '0'
                        });
                        if (!node.inputs.includes(inNodeId)) node.inputs.push(inNodeId);
                        if (!inNode.outputs.includes(nodeId)) inNode.outputs.push(nodeId);
                        edges.push({ from: inNodeId, to: nodeId });
                    });
                });

            } else if (opCode === 85 || opName === 'ColorExpression') {
                if (varId !== null && varId !== undefined) {
                    const nodeId = `var_${varId}`;
                    getOrCreateNode(nodeId, {
                        varId: varId,
                        label: `color_${varId}`,
                        type: 'int_expr',
                        formula: 'ColorExpression',
                        value: 'Color',
                        op: op
                    });
                }
            }
        });

        // 2. Scan Consumer Operations (ops that read expression outputs)
        topOps.forEach((op, opIdx) => {
            if (!op) return;
            const opName = getOpName(op);
            const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : 0);

            // Skip variable definition operations, metadata headers, and UI layout container operations
            if ([0, 80, 81, 82, 83, 84, 85, 134, 144, 148, 200, 201, 202, 203, 204, 205, 207, 208, 209, 210, 211, 212, 213, 214, 220].includes(opCode) || getOpVarOutputs(op).length > 0 || opName === 'Header' || opName === 'ContainerEnd' || opName.includes('Layout') || isContainerOp(op)) return;

            const referencedIds = new Set();

            // Structural decode first: this understands each operation's parameter layout,
            // including nested payloads such as a PaintData's PaintBundle, which the property
            // scan below cannot see. It also avoids reading a literal ARGB color as a variable
            // reference just because the color happens to match the NaN bit pattern.
            getOpVarReferences(op).forEach(id => referencedIds.add(id));

            // Check explicit bit/expression arrays
            const bits = op.mBits || op.bits || op.srcExpression || op.mSrcExpression;
            if (bits && Array.isArray(bits)) {
                getFloatExprVarDependencies(bits).forEach(id => referencedIds.add(id));
            }

            // Check all operation properties (numbers, arrays, bit patterns)
            for (const key in op) {
                if (['mType', 'type', 'mMode', 'mode', 'mComponentId', 'componentId', 'mId', 'id', 'mFlags', 'flags', 'mMajorVersion', 'mMinorVersion', 'mPatchVersion', 'mCapabilities', 'mProfiles', 'OP_CODE', 'mOpCode', 'mAlign', 'align', 'mGravity', 'gravity'].includes(key)) continue;

                const val = op[key];
                if (typeof val === 'number') {
                    if (Number.isInteger(val) && val > 0 && val < 0x40000000) {
                        if (nodeMap.has(`var_${val}`)) {
                            referencedIds.add(val);
                        }
                    } else {
                        const b = toRawBitsHelper(val);
                        if ((b & 0x7f800000) === 0x7f800000 && (b & 0x7fffff) !== 0) {
                            const id = b & 0x7fffff;
                            if (id > 0 && id < 0x40000000) {
                                if (nodeMap.has(`var_${id}`) || nodeMap.has(`sys_${id}`)) {
                                    referencedIds.add(id);
                                }
                            }
                        }
                    }
                } else if (Array.isArray(val) && key !== 'mOps' && key !== 'mOperations' && key !== 'operations' && key !== 'mList' && key !== 'list') {
                    getFloatExprVarDependencies(val).forEach(id => {
                        if (nodeMap.has(`var_${id}`) || nodeMap.has(`sys_${id}`)) {
                            referencedIds.add(id);
                        }
                    });
                }
            }

            // Collect valid producer nodes present in nodeMap
            const validDependencies = [];
            referencedIds.forEach(refId => {
                let targetNodeId = nodeMap.has(`var_${refId}`) ? `var_${refId}` : (nodeMap.has(`sys_${refId}`) ? `sys_${refId}` : null);
                if (!targetNodeId && refId <= 40 && getSystemVarName(refId)) {
                    targetNodeId = `sys_${refId}`;
                    getOrCreateNode(targetNodeId, {
                        varId: refId,
                        label: getSystemVarName(refId),
                        type: 'sys_var',
                        formula: `System Var (${getSystemVarName(refId)})`,
                        value: state ? String(state.getFloat(refId) ?? state.getInteger(refId) ?? 0) : '0'
                    });
                }
                if (targetNodeId && nodeMap.has(targetNodeId)) {
                    validDependencies.push(targetNodeId);
                }
            });

            // Only create consumer node if it has at least one valid variable/expression input dependency!
            if (validDependencies.length > 0) {
                const consumerNodeId = `consumer_${opCode}_${opIdx}`;
                const consumerNode = getOrCreateNode(consumerNodeId, {
                    varId: null,
                    label: `${opName} #${opIdx + 1}`,
                    type: 'consumer',
                    formula: `Op #${opIdx + 1} (${opName})`,
                    value: 'Consumer',
                    op: op
                });

                validDependencies.forEach(targetNodeId => {
                    const producerNode = nodeMap.get(targetNodeId);
                    if (!consumerNode.inputs.includes(targetNodeId)) consumerNode.inputs.push(targetNodeId);
                    if (!producerNode.outputs.includes(consumerNodeId)) producerNode.outputs.push(consumerNodeId);
                    edges.push({ from: targetNodeId, to: consumerNodeId });
                });
            }
        });
    }

    return { nodes, edges, nodeMap };
}

let cachedAnalysisDoc = null;
let cachedAnalysisResult = null;

export function invalidateUnusedIslandsAnalysisCache() {
    cachedAnalysisDoc = null;
    cachedAnalysisResult = null;
}

export function getUnusedIslandsAnalysis(doc) {
    if (!doc) {
        return {
            graphData: { nodes: [], edges: [], nodeMap: new Map() },
            reachesConsumerSet: new Set(),
            unusedIslandSet: new Set(),
            removableOpSet: new Set(),
            unusedVarIdSet: new Set(),
            removableOpsCount: 0
        };
    }
    if (cachedAnalysisDoc === doc && cachedAnalysisResult) {
        return cachedAnalysisResult;
    }

    const graphData = buildExpressionGraphModel(doc);
    const reachesConsumerSet = new Set();
    const queue = [];

    // Find all consumer nodes
    graphData.nodes.forEach(node => {
        if (node.type === 'consumer') {
            reachesConsumerSet.add(node.id);
            queue.push(node.id);
        }
    });

    // Backward BFS to find all nodes that transitively reach a consumer operation
    while (queue.length > 0) {
        const currId = queue.shift();
        const currNode = graphData.nodeMap.get(currId);
        if (currNode && currNode.inputs) {
            currNode.inputs.forEach(inId => {
                if (!reachesConsumerSet.has(inId)) {
                    reachesConsumerSet.add(inId);
                    queue.push(inId);
                }
            });
        }
    }

    // Any node NOT in reachesConsumerSet is part of an unconsumed island!
    const unusedIslandSet = new Set();
    const removableOpSet = new Set();
    const unusedVarIdSet = new Set();

    graphData.nodes.forEach(node => {
        if (!reachesConsumerSet.has(node.id)) {
            unusedIslandSet.add(node.id);
            if (node.varId !== null && node.varId !== undefined) {
                unusedVarIdSet.add(node.varId);
            }
            if (node.op && node.type !== 'sys_var') {
                removableOpSet.add(node.op);
            }
        }
    });

    cachedAnalysisDoc = doc;
    cachedAnalysisResult = {
        graphData,
        reachesConsumerSet,
        unusedIslandSet,
        removableOpSet,
        unusedVarIdSet,
        removableOpsCount: removableOpSet.size
    };
    return cachedAnalysisResult;
}

export function renderExpressionDependencyGraph() {
    initExprGraphInteractions();
    const badge = document.getElementById('exprNodeCountBadge');
    const searchInput = document.getElementById('exprGraphSearchInput');
    const filterSelect = document.getElementById('exprTypeFilterSelect');
    const currentDocument = window.currentDocument;

    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const typeFilter = filterSelect ? filterSelect.value : 'all';

    if (!currentDocument) {
        if (badge) badge.textContent = '0 Expressions';
        const svgEl = document.getElementById('exprGraphSvg');
        if (svgEl) svgEl.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="var(--text-muted)" font-size="13">No document loaded yet.</text>`;
        return;
    }

    const analysis = getUnusedIslandsAnalysis(currentDocument);
    exprGraphData = analysis.graphData;
    const { unusedIslandSet, removableOpsCount } = analysis;
    let filteredNodes = exprGraphData.nodes;

    const exprCount = exprGraphData.nodes.filter(n => n.type === 'float_expr' || n.type === 'int_expr').length;
    if (badge) {
        let badgeStr = `${exprCount} Expression${exprCount === 1 ? '' : 's'}`;
        if (removableOpsCount > 0) {
            badgeStr += ` • ${removableOpsCount} Removable Op${removableOpsCount === 1 ? '' : 's'}`;
        }
        badge.textContent = badgeStr;
    }

    if (typeFilter !== 'all') {
        if (typeFilter === 'float') filteredNodes = filteredNodes.filter(n => n.type === 'float_expr');
        else if (typeFilter === 'int') filteredNodes = filteredNodes.filter(n => n.type === 'int_expr');
        else if (typeFilter === 'sys') filteredNodes = filteredNodes.filter(n => n.type === 'sys_var');
        else if (typeFilter === 'constant') filteredNodes = filteredNodes.filter(n => n.type === 'constant');
        else if (typeFilter === 'derived') filteredNodes = filteredNodes.filter(n => n.type === 'derived');
        else if (typeFilter === 'consumer') filteredNodes = filteredNodes.filter(n => n.type === 'consumer');
        else if (typeFilter === 'unused') {
            filteredNodes = filteredNodes.filter(n => unusedIslandSet.has(n.id));
        }
    }

    if (exprGraphMode === 'graph') {
        renderExprGraphSvg(filteredNodes, query);
    } else {
        renderExprGraphTree(filteredNodes, query);
    }
}

function renderExprGraphSvg(nodesToRender, query) {
    const svgEl = document.getElementById('exprGraphSvg');
    const escapeHtml = typeof window.escapeHtml === 'function' ? window.escapeHtml : (s => s);
    if (!svgEl) return;

    if (nodesToRender.length === 0) {
        svgEl.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="var(--text-muted)" font-size="13">No expressions match the selected filter.</text>`;
        return;
    }

    // Calculate DAG Layers using Fast BFS Topological Sort (O(V + E))
    const nodeMap = exprGraphData.nodeMap;
    const levelMap = new Map();
    const inDegree = new Map();

    nodesToRender.forEach(node => {
        levelMap.set(node.id, 0);
        inDegree.set(node.id, 0);
    });

    exprGraphData.edges.forEach(edge => {
        if (inDegree.has(edge.to)) {
            inDegree.set(edge.to, inDegree.get(edge.to) + 1);
        }
    });

    const queue = [];
    nodesToRender.forEach(node => {
        if (inDegree.get(node.id) === 0) {
            queue.push(node.id);
        }
    });

    while (queue.length > 0) {
        const currId = queue.shift();
        const currLvl = levelMap.get(currId);
        const node = nodeMap.get(currId);
        if (node && node.outputs) {
            node.outputs.forEach(outId => {
                if (levelMap.has(outId)) {
                    levelMap.set(outId, Math.max(levelMap.get(outId), currLvl + 1));
                    const deg = (inDegree.get(outId) || 1) - 1;
                    inDegree.set(outId, deg);
                    if (deg === 0) {
                        queue.push(outId);
                    }
                }
            });
        }
    }

    let maxLvl = 0;
    levelMap.forEach(lvl => {
        if (lvl > maxLvl) maxLvl = lvl;
    });

    if (maxLvl > 0) {
        levelMap.forEach((lvl, nodeId) => {
            const node = nodeMap.get(nodeId);
            if (!node) return;
            const hasOutputs = node.outputs && node.outputs.length > 0;
            if (!hasOutputs || node.type === 'consumer') {
                levelMap.set(nodeId, maxLvl);
            }
        });
    }

    const layers = [];
    levelMap.forEach((lvl, nodeId) => {
        const node = nodeMap.get(nodeId);
        if (!node) return;
        while (layers.length <= lvl) layers.push([]);
        layers[lvl].push(node);
    });

    if (layers.length > 0 && layers[0]) {
        layers[0].sort((a, b) => {
            if (a.type === 'sys_var' && b.type !== 'sys_var') return -1;
            if (b.type === 'sys_var' && a.type !== 'sys_var') return 1;
            if (a.type === 'constant' && b.type !== 'constant') return -1;
            if (b.type === 'constant' && a.type !== 'constant') return 1;
            return (a.varId ?? 9999) - (b.varId ?? 9999);
        });
    }

    const posMap = new Map();
    const updatePosMap = () => {
        layers.forEach(layerNodes => {
            layerNodes.forEach((node, idx) => {
                posMap.set(node.id, idx);
            });
        });
    };

    for (let iter = 0; iter < 3; iter++) {
        updatePosMap();
        for (let l = 1; l < layers.length; l++) {
            layers[l].sort((a, b) => {
                let sumA = 0, countA = 0;
                if (a.inputs && a.inputs.length > 0) {
                    a.inputs.forEach(inId => {
                        if (posMap.has(inId)) {
                            sumA += posMap.get(inId);
                            countA++;
                        }
                    });
                }
                const baryA = countA > 0 ? sumA / countA : (posMap.get(a.id) ?? 9999);

                let sumB = 0, countB = 0;
                if (b.inputs && b.inputs.length > 0) {
                    b.inputs.forEach(inId => {
                        if (posMap.has(inId)) {
                            sumB += posMap.get(inId);
                            countB++;
                        }
                    });
                }
                const baryB = countB > 0 ? sumB / countB : (posMap.get(b.id) ?? 9999);

                if (baryA !== baryB) return baryA - baryB;
                return (a.varId ?? 9999) - (b.varId ?? 9999);
            });
        }

        updatePosMap();
        for (let l = layers.length - 2; l >= 0; l--) {
            layers[l].sort((a, b) => {
                let sumA = 0, countA = 0;
                if (a.outputs && a.outputs.length > 0) {
                    a.outputs.forEach(outId => {
                        if (posMap.has(outId)) {
                            sumA += posMap.get(outId);
                            countA++;
                        }
                    });
                }
                const baryA = countA > 0 ? sumA / countA : (posMap.get(a.id) ?? 9999);

                let sumB = 0, countB = 0;
                if (b.outputs && b.outputs.length > 0) {
                    b.outputs.forEach(outId => {
                        if (posMap.has(outId)) {
                            sumB += posMap.get(outId);
                            countB++;
                        }
                    });
                }
                const baryB = countB > 0 ? sumB / countB : (posMap.get(b.id) ?? 9999);

                if (baryA !== baryB) return baryA - baryB;
                return (a.varId ?? 9999) - (b.varId ?? 9999);
            });
        }
    }

    if (exprGraphSortUnusedFirst) {
        const { unusedIslandSet } = getUnusedIslandsAnalysis(window.currentDocument);
        layers.forEach(layerNodes => {
            layerNodes.sort((a, b) => {
                const isUnusedA = unusedIslandSet.has(a.id);
                const isUnusedB = unusedIslandSet.has(b.id);
                if (isUnusedA && !isUnusedB) return -1;
                if (!isUnusedA && isUnusedB) return 1;
                return 0;
            });
        });
    }

    const nodePositions = new Map();
    const NODE_W = 190;
    const NODE_H = 64;
    const COL_GAP = 240;
    const ROW_GAP = 85;

    layers.forEach((layerNodes, lvlIdx) => {
        const colX = 60 + lvlIdx * COL_GAP;
        layerNodes.forEach((node, rowIdx) => {
            const rowY = 50 + rowIdx * ROW_GAP;
            nodePositions.set(node.id, { x: colX, y: rowY });
        });
    });

    exprGraphNodePositions = nodePositions;

    const ancestorSet = new Set();
    const descendantSet = new Set();

    if (selectedExprNodeId && nodeMap.has(selectedExprNodeId)) {
        const ancQueue = [selectedExprNodeId];
        while (ancQueue.length > 0) {
            const currId = ancQueue.shift();
            const n = nodeMap.get(currId);
            if (n && n.inputs) {
                n.inputs.forEach(inId => {
                    if (!ancestorSet.has(inId) && inId !== selectedExprNodeId) {
                        ancestorSet.add(inId);
                        ancQueue.push(inId);
                    }
                });
            }
        }

        const descQueue = [selectedExprNodeId];
        while (descQueue.length > 0) {
            const currId = descQueue.shift();
            const n = nodeMap.get(currId);
            if (n && n.outputs) {
                n.outputs.forEach(outId => {
                    if (!descendantSet.has(outId) && outId !== selectedExprNodeId) {
                        descendantSet.add(outId);
                        descQueue.push(outId);
                    }
                });
            }
        }
    }

    const { unusedIslandSet, removableOpsCount } = getUnusedIslandsAnalysis(window.currentDocument);
    const lodMode = exprGraphZoom >= 0.55 ? 'full' : (exprGraphZoom >= 0.30 ? 'medium' : 'low');

    const container = document.getElementById('exprGraphCanvasContainer');
    const cRect = container ? container.getBoundingClientRect() : { width: 800, height: 600 };
    const cW = cRect.width || 800;
    const cH = cRect.height || 600;

    const marginX = 250 / exprGraphZoom;
    const marginY = 150 / exprGraphZoom;
    const minX = -exprGraphPan.x / exprGraphZoom - marginX;
    const maxX = (cW - exprGraphPan.x) / exprGraphZoom + marginX;
    const minY = -exprGraphPan.y / exprGraphZoom - marginY;
    const maxY = (cH - exprGraphPan.y) / exprGraphZoom + marginY;

    const visibleNodeSet = new Set();
    nodesToRender.forEach(node => {
        const pos = nodePositions.get(node.id);
        if (!pos) return;
        const isSelected = selectedExprNodeId === node.id;
        const isAncestor = ancestorSet.has(node.id);
        const isDescendant = descendantSet.has(node.id);
        const isUnused = unusedIslandSet.has(node.id);

        if (isSelected || isAncestor || isDescendant || isUnused || (pos.x + NODE_W >= minX && pos.x <= maxX && pos.y + NODE_H >= minY && pos.y <= maxY)) {
            visibleNodeSet.add(node.id);
        }
    });

    const legendEl = document.getElementById('exprGraphLegendBar');
    if (legendEl) {
        if (selectedExprNodeId && nodeMap.has(selectedExprNodeId)) {
            const selNode = nodeMap.get(selectedExprNodeId);
            legendEl.innerHTML = `
                <span style="display:flex; align-items:center; gap:3px;"><span style="width:8px; height:8px; border-radius:50%; background:#38bdf8; display:inline-block;"></span> <strong>Selected:</strong> ${escapeHtml(selNode.label)}</span>
                <span style="display:flex; align-items:center; gap:3px; margin-left:6px;"><span style="width:8px; height:8px; border-radius:50%; background:#34d399; display:inline-block;"></span> <strong>Dependencies Needed</strong> (${ancestorSet.size})</span>
                <span style="display:flex; align-items:center; gap:3px; margin-left:6px;"><span style="width:8px; height:8px; border-radius:50%; background:#c084fc; display:inline-block;"></span> <strong>Dependents</strong> (${descendantSet.size})</span>
                <button onclick="deselectExprGraphNode()" style="margin-left:auto; background:rgba(255,255,255,0.08); border:1px solid var(--border-color); border-radius:4px; color:var(--text-secondary); cursor:pointer; font-size:0.68rem; padding:1px 6px;" title="Clear selection highlight">✕ Clear Highlight</button>
            `;
        } else {
            const unusedBadgeHtml = unusedIslandSet.size > 0 ? `
                <span onclick="document.getElementById('exprTypeFilterSelect').value='unused'; renderExpressionDependencyGraph();" style="display:inline-flex; align-items:center; gap:4px; padding:1px 6px; background:rgba(249,115,22,0.2); border:1px solid rgba(249,115,22,0.55); border-radius:4px; color:#f97316; font-weight:600; cursor:pointer;" title="Click to filter and view ${unusedIslandSet.size} unused expression islands (${removableOpsCount} operations can be safely removed)">⚠️ ${unusedIslandSet.size} Unused Islands (${removableOpsCount} ops removable)</span>
            ` : '';

            legendEl.innerHTML = `
                <span style="display:flex; align-items:center; gap:3px;"><span style="width:8px; height:8px; border-radius:50%; background:#0284c7; display:inline-block;"></span> FloatExpr</span>
                <span style="display:flex; align-items:center; gap:3px;"><span style="width:8px; height:8px; border-radius:50%; background:#9333ea; display:inline-block;"></span> IntExpr</span>
                <span style="display:flex; align-items:center; gap:3px;"><span style="width:8px; height:8px; border-radius:50%; background:#d97706; display:inline-block;"></span> SysVar</span>
                <span style="display:flex; align-items:center; gap:3px;"><span style="width:8px; height:8px; border-radius:50%; background:#059669; display:inline-block;"></span> Constant</span>
                <span style="display:flex; align-items:center; gap:3px;"><span style="width:8px; height:8px; border-radius:50%; background:#0d9488; display:inline-block;"></span> LayoutValue</span>
                <span style="display:flex; align-items:center; gap:3px;"><span style="width:8px; height:8px; border-radius:50%; background:#e11d48; display:inline-block;"></span> Consumer</span>
                ${unusedBadgeHtml}
                <span style="margin-left:auto; color:var(--text-muted); font-size:0.68rem;">Visible: ${visibleNodeSet.size}/${nodesToRender.length} nodes | Zoom: ${Math.round(exprGraphZoom * 100)}% (${lodMode.toUpperCase()} LOD)</span>
            `;
        }
    }

    const criticalPathInfo = isExprCriticalPathActive ? findCriticalPathNodes(exprGraphData) : { pathNodeSet: new Set(), pathEdgeSet: new Set(), maxDepth: 0 };
    const { pathNodeSet, pathEdgeSet } = criticalPathInfo;

    let svgContent = `
        <defs>
            <marker id="exprArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.3)" />
            </marker>
            <marker id="exprArrowGreen" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#34d399" />
            </marker>
            <marker id="exprArrowPurple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#c084fc" />
            </marker>
            <marker id="exprArrowOrange" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316" />
            </marker>
            <marker id="exprArrowGold" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
            </marker>
            <filter id="nodeGlowSelected" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#38bdf8" flood-opacity="0.85"/>
            </filter>
            <filter id="nodeGlowAncestor" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="4.5" flood-color="#34d399" flood-opacity="0.75"/>
            </filter>
            <filter id="nodeGlowDescendant" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="4.5" flood-color="#c084fc" flood-opacity="0.75"/>
            </filter>
            <filter id="nodeGlowUnused" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="4.5" flood-color="#f97316" flood-opacity="0.8"/>
            </filter>
            <filter id="nodeGlowCritical" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#f59e0b" flood-opacity="0.9"/>
            </filter>
        </defs>
        <g id="exprGraphGroup" transform="translate(${exprGraphPan.x}, ${exprGraphPan.y}) scale(${exprGraphZoom})">
    `;

    svgContent += `<g class="expr-edges">`;
    exprGraphData.edges.forEach(edge => {
        if (!visibleNodeSet.has(edge.from) && !visibleNodeSet.has(edge.to)) return;

        const p1 = nodePositions.get(edge.from);
        const p2 = nodePositions.get(edge.to);
        if (!p1 || !p2) return;

        const x1 = p1.x + NODE_W;
        const y1 = p1.y + NODE_H / 2;
        const x2 = p2.x;
        const y2 = p2.y + NODE_H / 2;
        const dx = Math.max(40, (x2 - x1) / 2);

        const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

        let strokeColor = 'rgba(255,255,255,0.18)';
        let strokeWidth = 1.5;
        let strokeDash = '';
        let marker = lodMode !== 'low' ? 'url(#exprArrow)' : 'none';
        let opacity = '1.0';

        const isUnusedEdge = unusedIslandSet.has(edge.from) && unusedIslandSet.has(edge.to);
        const isCriticalEdge = pathEdgeSet.has(`${edge.from}->${edge.to}`);
        const isUpstreamEdge = selectedExprNodeId ? ((ancestorSet.has(edge.from) || edge.from === selectedExprNodeId) && (ancestorSet.has(edge.to) || edge.to === selectedExprNodeId)) : false;
        const isDownstreamEdge = selectedExprNodeId ? ((descendantSet.has(edge.from) || edge.from === selectedExprNodeId) && (descendantSet.has(edge.to) || edge.to === selectedExprNodeId)) : false;

        if (isCriticalEdge) {
            strokeColor = '#f59e0b';
            strokeWidth = lodMode === 'low' ? 4 : 3.2;
            strokeDash = '';
            marker = lodMode !== 'low' ? 'url(#exprArrowGold)' : 'none';
            opacity = '1.0';
        } else if (isUnusedEdge && !selectedExprNodeId) {
            strokeColor = '#f97316';
            strokeWidth = 2.0;
            strokeDash = 'stroke-dasharray="5 3"';
            marker = lodMode !== 'low' ? 'url(#exprArrowOrange)' : 'none';
        } else if (selectedExprNodeId) {
            if (isUpstreamEdge) {
                strokeColor = '#34d399';
                strokeWidth = lodMode === 'low' ? 3 : 2.5;
                strokeDash = '';
                marker = lodMode !== 'low' ? 'url(#exprArrowGreen)' : 'none';
            } else if (isDownstreamEdge) {
                strokeColor = '#c084fc';
                strokeWidth = lodMode === 'low' ? 3 : 2.5;
                strokeDash = '';
                marker = lodMode !== 'low' ? 'url(#exprArrowPurple)' : 'none';
            } else {
                strokeColor = 'rgba(255,255,255,0.08)';
                strokeWidth = 1.0;
                strokeDash = '';
                opacity = '0.3';
            }
        } else if (isExprCriticalPathActive) {
            opacity = '0.25';
        }

        svgContent += `<path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} ${marker !== 'none' ? `marker-end="${marker}"` : ''} opacity="${opacity}" style="transition: stroke 0.2s, opacity 0.2s;" />`;

        if ((isCriticalEdge || isUpstreamEdge) && lodMode !== 'low') {
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (fromNode && toNode) {
                const evalText = `${fromNode.value} ➔ ${toNode.label}`;
                svgContent += `
                    <g class="expr-edge-badge" transform="translate(${midX}, ${midY})" opacity="${opacity}">
                        <rect x="-38" y="-9" width="76" height="17" rx="8" fill="#0f172a" stroke="${isCriticalEdge ? '#f59e0b' : '#34d399'}" stroke-width="1.2" />
                        <text x="0" y="3" text-anchor="middle" fill="${isCriticalEdge ? '#f59e0b' : '#34d399'}" font-size="8.5" font-weight="bold" font-family="var(--code-font)">${escapeHtml(evalText.length > 15 ? evalText.slice(0, 14) + '…' : evalText)}</text>
                    </g>
                `;
            }
        }
    });
    svgContent += `</g>`;

    svgContent += `<g class="expr-nodes">`;
    nodesToRender.forEach(node => {
        if (!visibleNodeSet.has(node.id)) return;

        const pos = nodePositions.get(node.id);
        if (!pos) return;

        const isSelected = selectedExprNodeId === node.id;
        const isAncestor = ancestorSet.has(node.id);
        const isDescendant = descendantSet.has(node.id);
        const isUnused = unusedIslandSet.has(node.id);

        const truncFormula = node.formula.length > 24 ? node.formula.slice(0, 22) + '…' : node.formula;

        let opacity = '1.0';
        if (selectedExprNodeId) {
            if (isSelected || isAncestor || isDescendant) {
                opacity = '1.0';
            } else {
                opacity = '0.25';
            }
        } else if (query !== '') {
            const isMatch = node.label.toLowerCase().includes(query) || node.formula.toLowerCase().includes(query) || (node.varId !== null && String(node.varId).includes(query));
            opacity = isMatch ? '1.0' : '0.25';
        }

        let fillBg = '#1e293b';
        let strokeColor = '#334155';
        let badgeBg = '#475569';
        let typeIcon = '⚡';

        if (node.type === 'float_expr') {
            fillBg = '#0c4a6e'; strokeColor = '#0284c7'; badgeBg = '#0284c7'; typeIcon = '🟦';
        } else if (node.type === 'int_expr') {
            fillBg = '#3b0764'; strokeColor = '#9333ea'; badgeBg = '#9333ea'; typeIcon = '🟪';
        } else if (node.type === 'sys_var') {
            fillBg = '#451a03'; strokeColor = '#d97706'; badgeBg = '#d97706'; typeIcon = '🟨';
        } else if (node.type === 'constant') {
            fillBg = '#064e3b'; strokeColor = '#059669'; badgeBg = '#059669'; typeIcon = '🟩';
        } else if (node.type === 'derived') {
            fillBg = '#042f2e'; strokeColor = '#0d9488'; badgeBg = '#0d9488'; typeIcon = '📐';
        } else if (node.type === 'consumer') {
            fillBg = '#4c0519'; strokeColor = '#e11d48'; badgeBg = '#e11d48'; typeIcon = '🎨';
        }

        let filterStyle = '';
        let strokeWidth = '1.5';

        const isCriticalNode = pathNodeSet.has(node.id);

        if (isCriticalNode) {
            strokeColor = '#f59e0b';
            filterStyle = lodMode === 'full' ? 'filter="url(#nodeGlowCritical)"' : '';
            strokeWidth = '3.5';
        } else if (isUnused && !selectedExprNodeId) {
            fillBg = 'rgba(249,115,22,0.22)';
            strokeColor = '#f97316';
            badgeBg = '#f97316';
            typeIcon = '⚠️';
            filterStyle = lodMode === 'full' ? 'filter="url(#nodeGlowUnused)"' : '';
            strokeWidth = '2.5';
        }

        if (isSelected) {
            strokeColor = '#38bdf8';
            filterStyle = lodMode === 'full' ? 'filter="url(#nodeGlowSelected)"' : '';
            strokeWidth = '3';
        } else if (isAncestor) {
            strokeColor = '#34d399';
            filterStyle = lodMode === 'full' ? 'filter="url(#nodeGlowAncestor)"' : '';
            strokeWidth = '2.5';
        } else if (isDescendant) {
            strokeColor = '#c084fc';
            filterStyle = lodMode === 'full' ? 'filter="url(#nodeGlowDescendant)"' : '';
            strokeWidth = '2.5';
        }

        let nodeInnerHTML = '';
        if (lodMode === 'full') {
            nodeInnerHTML = `
                <rect x="0" y="0" width="${NODE_W}" height="${NODE_H}" rx="8" fill="${fillBg}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${filterStyle} />
                <rect x="8" y="8" width="16" height="16" rx="4" fill="${badgeBg}" />
                <text x="16" y="20" text-anchor="middle" fill="#ffffff" font-size="10" font-weight="bold">${typeIcon}</text>
                <text x="30" y="20" fill="#f8fafc" font-size="11" font-weight="bold" font-family="var(--code-font)">${escapeHtml(node.label)}</text>
                <text x="10" y="38" fill="#94a3b8" font-size="10" font-family="var(--code-font)">${escapeHtml(truncFormula || 'Val')}</text>
                <text x="10" y="53" fill="#34d399" font-size="11" font-weight="bold" font-family="var(--code-font)" class="expr-live-val" data-node-id="${node.id}">Val: ${escapeHtml(node.value)}</text>
            `;
        } else if (lodMode === 'medium') {
            nodeInnerHTML = `
                <rect x="0" y="0" width="${NODE_W}" height="${NODE_H}" rx="8" fill="${fillBg}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${filterStyle} />
                <rect x="10" y="14" width="20" height="20" rx="4" fill="${badgeBg}" />
                <text x="20" y="28" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="bold">${typeIcon}</text>
                <text x="38" y="28" fill="#f8fafc" font-size="13" font-weight="bold" font-family="var(--code-font)">${escapeHtml(node.label)}</text>
                <text x="38" y="48" fill="#34d399" font-size="11" font-weight="bold" font-family="var(--code-font)" class="expr-live-val" data-node-id="${node.id}">Val: ${escapeHtml(node.value)}</text>
            `;
        } else {
            nodeInnerHTML = `
                <rect x="0" y="0" width="${NODE_W}" height="${NODE_H}" rx="8" fill="${badgeBg}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />
                <text x="${NODE_W/2}" y="${NODE_H/2 + 5}" text-anchor="middle" fill="#ffffff" font-size="15" font-weight="bold" font-family="var(--code-font)">${escapeHtml(node.label)}</text>
            `;
        }

        svgContent += `
            <g class="expr-node" transform="translate(${pos.x}, ${pos.y})" opacity="${opacity}" onclick="selectExprGraphNode('${node.id}')" style="cursor:pointer;" title="${escapeHtml(node.label)}: ${escapeHtml(node.formula)}">
                ${nodeInnerHTML}
            </g>
        `;
    });
    svgContent += `</g></g>`;

    svgEl.innerHTML = svgContent;
    updateExprGraphMinimap();
}

function renderExprGraphTree(nodesToRender, query) {
    const treeEl = document.getElementById('exprTreeContainer');
    const escapeHtml = typeof window.escapeHtml === 'function' ? window.escapeHtml : (s => s);
    if (!treeEl) return;

    if (nodesToRender.length === 0) {
        treeEl.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px;">No expressions match search criteria.</div>`;
        return;
    }

    let html = `<div style="display:flex; flex-direction:column; gap:8px;">`;
    nodesToRender.forEach(node => {
        const isSelected = selectedExprNodeId === node.id;
        const isMatch = query === '' || node.label.toLowerCase().includes(query) || node.formula.toLowerCase().includes(query);
        if (!isMatch) return;

        let typeBadge = `<span class="badge" style="background:#0284c7;">FloatExpr</span>`;
        if (node.type === 'int_expr') typeBadge = `<span class="badge" style="background:#9333ea;">IntExpr</span>`;
        else if (node.type === 'sys_var') typeBadge = `<span class="badge" style="background:#d97706;">SysVar</span>`;
        else if (node.type === 'constant') typeBadge = `<span class="badge" style="background:#059669;">Constant</span>`;
        else if (node.type === 'derived') typeBadge = `<span class="badge" style="background:#0d9488;">LayoutValue</span>`;
        else if (node.type === 'consumer') typeBadge = `<span class="badge" style="background:#e11d48;">Consumer</span>`;

        html += `
            <div style="padding:8px 10px; background:${isSelected ? 'rgba(56,189,248,0.12)' : 'var(--bg-card)'}; border:1px solid ${isSelected ? 'var(--accent-blue)' : 'var(--border-color)'}; border-radius:6px; cursor:pointer;" onclick="selectExprGraphNode('${node.id}')">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        ${typeBadge}
                        <strong>${escapeHtml(node.label)}</strong>
                    </div>
                    <span style="color:var(--accent-emerald); font-weight:600;" class="expr-live-val" data-node-id="${node.id}">Val: ${escapeHtml(node.value)}</span>
                </div>
                <div style="color:var(--text-secondary); margin-top:4px; font-size:0.72rem; word-break:break-all;">
                    <strong>Formula:</strong> <code>${escapeHtml(node.formula || '--')}</code>
                </div>
                <div style="display:flex; gap:12px; margin-top:4px; font-size:0.68rem; color:var(--text-muted);">
                    <span>Inputs: ${node.inputs.length}</span>
                    <span>Outputs: ${node.outputs.length}</span>
                </div>
            </div>
        `;
    });
    html += `</div>`;
    treeEl.innerHTML = html;
}

export function selectExprGraphNode(nodeId, options = {}) {
    selectedExprNodeId = nodeId;
    const node = exprGraphData ? exprGraphData.nodeMap.get(nodeId) : null;
    const card = document.getElementById('exprNodeDetailCard');
    const escapeHtml = typeof window.escapeHtml === 'function' ? window.escapeHtml : (s => s);
    const currentParsedOps = window.currentParsedOps;
    const getOpId = typeof window.getOpId === 'function' ? window.getOpId : (() => null);
    const selectCommandCard = typeof window.selectCommandCard === 'function' ? window.selectCommandCard : (() => null);

    if (!node || !card) {
        if (card) card.style.display = 'none';
        renderExpressionDependencyGraph();
        return;
    }

    card.style.display = 'flex';
    const badgeEl = document.getElementById('exprCardBadge');
    const titleEl = document.getElementById('exprCardTitle');
    const valEl = document.getElementById('exprCardValue');
    const formulaEl = document.getElementById('exprCardFormula');
    const linksEl = document.getElementById('exprCardLinks');

    if (badgeEl) {
        badgeEl.textContent = node.type.toUpperCase();
        badgeEl.style.background = node.type === 'float_expr' ? '#0284c7' : (node.type === 'int_expr' ? '#9333ea' : (node.type === 'sys_var' ? '#d97706' : (node.type === 'constant' ? '#059669' : '#e11d48')));
    }
    if (titleEl) titleEl.textContent = node.label;
    if (valEl) valEl.textContent = `Live Value: ${node.value}`;
    if (formulaEl) formulaEl.textContent = `Formula: ${node.formula || '--'}`;

    if (linksEl) {
        let inBadges = node.inputs.map(inId => {
            const inNode = exprGraphData.nodeMap.get(inId);
            return `<span class="badge" style="background:#059669; cursor:pointer;" onclick="event.stopPropagation(); selectExprGraphNode('${inId}', { source: 'user', scrollTo: true })" title="Click to jump to dependency">← ${escapeHtml(inNode ? inNode.label : inId)}</span>`;
        }).join(' ');

        let outBadges = node.outputs.map(outId => {
            const outNode = exprGraphData.nodeMap.get(outId);
            return `<span class="badge" style="background:#a855f7; cursor:pointer;" onclick="event.stopPropagation(); selectExprGraphNode('${outId}', { source: 'user', scrollTo: true })" title="Click to jump to output dependent">→ ${escapeHtml(outNode ? outNode.label : outId)}</span>`;
        }).join(' ');

        linksEl.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:4px; width:100%;">
                <div><strong>Depends On (${node.inputs.length}):</strong> ${inBadges || '<span style="color:var(--text-muted)">None (Root)</span>'}</div>
                <div><strong>Used By (${node.outputs.length}):</strong> ${outBadges || '<span style="color:var(--text-muted)">None (Leaf)</span>'}</div>
            </div>
        `;
    }

    if (options.scrollTo && exprGraphMode === 'graph' && exprGraphNodePositions) {
        const pos = exprGraphNodePositions.get(nodeId);
        if (pos) {
            const container = document.getElementById('exprGraphCanvasContainer');
            if (container) {
                const rect = container.getBoundingClientRect();
                const cW = rect.width || 480;
                const cH = rect.height || 260;
                exprGraphPan.x = cW / 2 - (pos.x + 95) * exprGraphZoom;
                exprGraphPan.y = cH / 2 - (pos.y + 32) * exprGraphZoom;
                updateExprSvgTransform();
            }
        }
    }

    if (options.source !== 'cmdList' && currentParsedOps) {
        let targetIdx = -1;
        if (node.op) {
            targetIdx = currentParsedOps.indexOf(node.op);
        }
        if (targetIdx < 0 && node.varId !== null && node.varId !== undefined) {
            targetIdx = currentParsedOps.findIndex(op => getOpId(op) === node.varId);
        }

        if (targetIdx >= 0) {
            selectCommandCard(targetIdx, node.varId, { source: 'exprGraph' });
            const cardEl = document.getElementById(`cmdCard-${targetIdx}`);
            if (cardEl) {
                cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    renderExpressionDependencyGraph();
}

export function deselectExprGraphNode() {
    selectedExprNodeId = null;
    const card = document.getElementById('exprNodeDetailCard');
    if (card) card.style.display = 'none';
    renderExpressionDependencyGraph();
}

export function updateExprGraphLiveValues() {
    const pane9 = document.getElementById('pane9');
    const currentDocument = window.currentDocument;
    if (!pane9 || pane9.classList.contains('hidden-panel')) return;
    if (!currentDocument) return;

    const state = typeof currentDocument.getRemoteComposeState === 'function' ? currentDocument.getRemoteComposeState() : currentDocument.mRemoteComposeState;
    if (!state || !exprGraphData || !exprGraphData.nodes) return;

    exprGraphData.nodes.forEach(node => {
        if (node.varId === null || node.varId === undefined) return;
        let liveVal = state.getFloat(node.varId);
        if (liveVal === undefined || Number.isNaN(liveVal)) {
            liveVal = state.getInteger(node.varId);
        }
        if (typeof liveVal === 'number' && !Number.isNaN(liveVal)) {
            const formatted = Number.isInteger(liveVal) ? liveVal.toString() : liveVal.toFixed(2);
            node.value = formatted;

            const elements = document.querySelectorAll(`.expr-live-val[data-node-id="${node.id}"]`);
            elements.forEach(el => {
                el.textContent = `Val: ${formatted}`;
            });

            if (selectedExprNodeId === node.id) {
                const cardVal = document.getElementById('exprCardValue');
                if (cardVal) cardVal.textContent = `Live Value: ${formatted}`;
            }
        }
    });
}

// Auto-expose exported functions to window for HTML inline event handlers
window.buildExpressionGraphModel = buildExpressionGraphModel;
window.getUnusedIslandsAnalysis = getUnusedIslandsAnalysis;
window.invalidateUnusedIslandsAnalysisCache = invalidateUnusedIslandsAnalysisCache;
window.renderExpressionDependencyGraph = renderExpressionDependencyGraph;
window.selectExprGraphNode = selectExprGraphNode;
window.deselectExprGraphNode = deselectExprGraphNode;
window.setExprGraphDisplayMode = setExprGraphDisplayMode;
window.resetExprGraphZoom = resetExprGraphZoom;
window.toggleExprGraphSortUnused = toggleExprGraphSortUnused;
window.toggleExprVariableSimulator = toggleExprVariableSimulator;
window.onExprSimulatorSliderChange = onExprSimulatorSliderChange;
window.toggleExprCriticalPathTrace = toggleExprCriticalPathTrace;
window.toggleExprMinimapCollapse = toggleExprMinimapCollapse;
window.updateExprGraphLiveValues = updateExprGraphLiveValues;
