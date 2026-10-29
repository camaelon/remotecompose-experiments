// =========================================================================
// Panel 1: Component Tree & Running Tree Panels
// Modularized in src/panels/ComponentTreePanel.js
// Handles hierarchical component tree rendering, running tree expansion,
// live layout dimension tracking, live expression badges, and tree search.
// =========================================================================

import {
    getOpName,
    getOpId,
    isContainerOp,
    isModifierOp,
    isComponentOp,
    getEffectiveChildren,
    prettyPrintFloatExpression,
    prettyPrintIntegerExpression,
    getCoreTextParameters,
    getLayoutAlignmentInfo,
    selectCommandCard,
    findMatchingCommandIndex,
    renderCommandsList
} from './CommandListPanel.js';
import {
    formatDimensionNumber,
    evaluateLoopParams,
    getRunningNodeChildren,
    pausePlayer,
    selectAndRenderStepOp
} from './StagePanel.js';

export const __rtOpRegistry = new Map();

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export const __componentTreeOpRegistry = new Map();

export function renderComponentTree(doc) {
    const container = document.getElementById('componentTreeContainer');
    if (!container) return;
    __componentTreeOpRegistry.clear();
    if (!doc) {
        container.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-muted);">No document parsed.</div>`;
        return;
    }

    const rootLayout = typeof doc.getRootLayoutComponent === 'function' ? doc.getRootLayoutComponent() : doc.mRootLayoutComponent;
    const topOps = typeof doc.getOperations === 'function' ? doc.getOperations() : doc.mOperations;

    let html = '';

    if (rootLayout) {
        html += buildTreeNodeHtml(rootLayout, 0);
    } else if (topOps && topOps.length > 0) {
        topOps.forEach(op => {
            if (isContainerOp(op)) {
                html += buildTreeNodeHtml(op, 0);
            }
        });
    }

    if (!html) {
        html = `<div style="padding:16px; color:var(--text-muted); font-size:0.85rem;">Document contains drawing primitives without layout containers.</div>`;
    }

    container.innerHTML = html;
}

export function getMinDimensions(op, parentOp) {
    if (!op) return null;
    const parentName = parentOp ? getOpName(parentOp) : '';
    const isChildOfFitBox = parentName === 'FitBoxLayout' || parentName.includes('FitBox');
    if (!isChildOfFitBox) return null;

    let minW = null;
    let minH = null;

    if (typeof op.getWidthInModifier === 'function') {
        const wm = op.getWidthInModifier();
        if (wm && typeof wm.getMin === 'function') {
            const val = wm.getMin();
            if (val !== undefined && val !== null && !Number.isNaN(val) && val < 1e30) minW = val;
        }
    }
    if (typeof op.getHeightInModifier === 'function') {
        const hm = op.getHeightInModifier();
        if (hm && typeof hm.getMin === 'function') {
            const val = hm.getMin();
            if (val !== undefined && val !== null && !Number.isNaN(val) && val < 1e30) minH = val;
        }
    }

    const children = getEffectiveChildren(op) || [];
    for (const child of children) {
        if (isModifierOp(child)) {
            const modName = getOpName(child);
            if (minW === null && (modName.includes('WidthIn') || modName.includes('SizeIn'))) {
                const val = child.mMin ?? child.mMinDimensionValue ?? (typeof child.getMin === 'function' ? child.getMin() : null);
                if (val !== undefined && val !== null && !Number.isNaN(val) && val < 1e30) minW = val;
            }
            if (minH === null && (modName.includes('HeightIn') || modName.includes('SizeIn'))) {
                const val = child.mMin ?? child.mMinDimensionValue ?? (typeof child.getMin === 'function' ? child.getMin() : null);
                if (val !== undefined && val !== null && !Number.isNaN(val) && val < 1e30) minH = val;
            }
        }
    }

    if (minW === null && minH === null) return null;
    return {
        minW: minW ?? 0,
        minH: minH ?? 0
    };
}

/**
 * Computes visibility status, icon, and description for a component node.
 * RemoteCompose: GONE = 0, VISIBLE = 1, INVISIBLE = 2, OVERRIDE_GONE = 16, OVERRIDE_VISIBLE = 32, OVERRIDE_INVISIBLE = 64
 * Android View: VISIBLE = 0, INVISIBLE = 4, GONE = 8
 */
export function getVisibilityInfo(op, parentVisInfo = null) {
    if (!op) return { status: 'VISIBLE', icon: '👁️', title: 'Visibility: VISIBLE', className: 'vis-visible' };

    const rawVis = typeof op.getVisibility === 'function' ? op.getVisibility() : (op.mVisibility ?? null);

    let isSelfGone = false;
    let isSelfInvisible = false;
    let isSelfVisible = false;

    if (rawVis !== null && rawVis !== undefined) {
        if (typeof op.isGone === 'function') {
            isSelfGone = op.isGone();
        } else if ((rawVis >> 4) > 0) {
            isSelfGone = (rawVis & 16) === 16;
            isSelfVisible = (rawVis & 32) === 32;
            isSelfInvisible = (rawVis & 64) === 64;
        } else if (rawVis === 17 || rawVis === 16 || rawVis === 0 || rawVis === 8) {
            isSelfGone = true;
        } else if (rawVis === 2 || rawVis === 4) {
            isSelfInvisible = true;
        } else if (rawVis === 1 || rawVis === 33 || rawVis === 32) {
            isSelfVisible = true;
        }
    }

    // Traverse ancestors if parentVisInfo was not explicitly passed
    if (!parentVisInfo) {
        let parent = op.mParent || (typeof op.getParent === 'function' ? op.getParent() : null);
        while (parent) {
            const pVis = typeof parent.getVisibility === 'function' ? parent.getVisibility() : (parent.mVisibility ?? null);
            const pIsGone = typeof parent.isGone === 'function' ? parent.isGone() : (pVis === 17 || pVis === 16 || pVis === 0 || pVis === 8 || ((pVis >> 4) > 0 && (pVis & 16) === 16));
            const pIsInvisible = typeof parent.isInvisible === 'function' ? parent.isInvisible() : (pVis === 2 || pVis === 4 || ((pVis >> 4) > 0 && (pVis & 64) === 64));
            if (pIsGone) {
                parentVisInfo = { status: 'GONE' };
                break;
            }
            if (pIsInvisible && (!parentVisInfo || parentVisInfo.status !== 'GONE')) {
                parentVisInfo = { status: 'INVISIBLE' };
            }
            parent = parent.mParent || (typeof parent.getParent === 'function' ? parent.getParent() : null);
        }
    }

    const parentIsGone = parentVisInfo && parentVisInfo.status === 'GONE';
    const parentIsInvisible = parentVisInfo && parentVisInfo.status === 'INVISIBLE';

    if (isSelfGone || parentIsGone) {
        return {
            status: 'GONE',
            icon: '🚫',
            title: isSelfGone ? 'Visibility: GONE (hidden & removed from layout)' : 'Visibility: GONE (inherited from parent)',
            className: 'vis-gone'
        };
    } else if (isSelfInvisible || parentIsInvisible) {
        return {
            status: 'INVISIBLE',
            icon: '🙈',
            title: isSelfInvisible ? 'Visibility: INVISIBLE (hidden, takes layout space)' : 'Visibility: INVISIBLE (inherited from parent)',
            className: 'vis-invisible'
        };
    } else {
        return {
            status: 'VISIBLE',
            icon: '👁️',
            title: 'Visibility: VISIBLE',
            className: 'vis-visible'
        };
    }
}

export function buildTreeNodeHtml(op, depth, parentOp = null) {
    const name = getOpName(op);
    const id = typeof op.getId === 'function' ? op.getId() : (op.mId ?? null);
    const componentId = typeof op.getComponentId === 'function' ? op.getComponentId() : (op.mComponentId ?? null);
    const displayId = componentId !== null && componentId !== undefined ? componentId : (id !== null && id !== undefined ? id : null);
    const width = typeof op.getWidth === 'function' ? op.getWidth() : (op.mWidth ?? null);
    const height = typeof op.getHeight === 'function' ? op.getHeight() : (op.mHeight ?? null);
    const formattedW = formatDimensionNumber(width);
    const formattedH = formatDimensionNumber(height);
    const currentDocument = window.currentDocument;
    const textContent = op.mText || (op.mTextId && currentDocument?.getText ? currentDocument.getText(op.mTextId) : null);

    const minDims = getMinDimensions(op, parentOp);
    const formattedMinW = minDims ? formatDimensionNumber(minDims.minW) : '';
    const formattedMinH = minDims ? formatDimensionNumber(minDims.minH) : '';

    const parentVisInfo = parentOp ? getVisibilityInfo(parentOp) : null;
    const visInfo = getVisibilityInfo(op, parentVisInfo);

    const children = getEffectiveChildren(op);
    const childComponents = [];
    const modifiers = [];
    const drawOps = [];

    children.forEach(child => {
        if (isContainerOp(child) || isComponentOp(child)) {
            childComponents.push(child);
        } else if (isModifierOp(child)) {
            modifiers.push(child);
        } else {
            drawOps.push(child);
        }
    });

    const hasSubContent = childComponents.length > 0 || drawOps.length > 0;
    const isCanvasOnlyDraw = (name.includes('Canvas') || name === 'CanvasLayout') && childComponents.length === 0 && drawOps.length > 0;
    const startCollapsed = isCanvasOnlyDraw;
    const nodeId = `treeNode-${Math.random().toString(36).substr(2, 9)}`;
    __componentTreeOpRegistry.set(nodeId, op);

    const isCoreText = name === 'CoreText' || name === 'TextLayout' || op.OP_CODE === 239 || op.OP_CODE === 208 || op.mTextId !== undefined;
    const coreTextParams = isCoreText ? getCoreTextParameters(op, currentDocument) : null;

    let html = `
        <div class="tree-node ${depth === 0 ? 'tree-node-root' : ''}">
            <div class="tree-node-content" id="${nodeId}" data-node-id="${nodeId}" onclick="selectTreeNode('${nodeId}', ${displayId !== null ? displayId : 'null'})">
                ${hasSubContent ? `<span class="caret ${startCollapsed ? '' : 'caret-down'}" onclick="toggleTreeNode(event, '${nodeId}')">▶</span>` : '<span style="width:10px;"></span>'}
                <span id="ctVis-${nodeId}" class="tree-vis-icon ${visInfo.className}" title="${visInfo.title}">${visInfo.icon}</span>
                <span class="tree-icon">${getComponentIcon(name)}</span>
                <span class="tree-tag">${name}</span>
                ${displayId !== null && displayId !== undefined ? `<span class="tree-id">ID:${displayId}</span>` : ''}
                <span id="ctDim-${nodeId}" class="tree-dim" style="${formattedW !== '' && formattedH !== '' ? '' : 'display:none;'}" title="Layout Dimensions: ${formattedW}x${formattedH}">(${formattedW}x${formattedH})</span>
                ${minDims ? `<span class="badge" style="font-size:0.68rem; font-family:var(--code-font); background:rgba(245,158,11,0.14); color:var(--accent-amber); border:1px solid rgba(245,158,11,0.35); font-weight:600; padding:1px 5px;" title="FitBoxLayout Constraints: min width = ${formattedMinW}dp, min height = ${formattedMinH}dp">min: ${formattedMinW}×${formattedMinH}</span>` : ''}
                ${(() => {
                    const layoutAlign = getLayoutAlignmentInfo(op);
                    if (!layoutAlign || (!layoutAlign.hName && !layoutAlign.vName)) return '';
                    return `<span class="badge" style="font-size:0.65rem; background:rgba(59,130,246,0.12); color:var(--accent-blue); font-family:var(--code-font);" title="Layout Alignment: Horizontal=${layoutAlign.hName || 'none'}, Vertical=${layoutAlign.vName || 'none'}${layoutAlign.spacedBy !== null ? `, SpacedBy=${layoutAlign.spacedBy}dp` : ''}">↔ ${layoutAlign.hName || '—'} ↕ ${layoutAlign.vName || '—'}${layoutAlign.spacedBy !== null ? ` • 📏${layoutAlign.spacedBy}dp` : ''}</span>`;
                })()}
                ${textContent ? `<span style="color:var(--accent-amber); font-style:italic;">"${escapeHtml(textContent)}"</span>` : ''}
                ${coreTextParams ? `
                    <span class="badge" style="font-size:0.65rem; background:rgba(56,189,248,0.12); color:var(--accent-blue); font-family:var(--code-font);" title="Font Size: ${coreTextParams.fontSize}sp, Weight: ${coreTextParams.fontWeightName}">🔤 ${coreTextParams.fontSize}sp • ${coreTextParams.fontWeight}</span>
                    <span class="badge" style="font-size:0.65rem; background:rgba(168,85,247,0.12); color:var(--accent-purple); font-family:var(--code-font);" title="Alignment: ${coreTextParams.textAlignName}, Overflow: ${coreTextParams.overflowName}">${coreTextParams.textAlignName}${coreTextParams.maxLines < 10000 ? ` • ${coreTextParams.maxLines}L` : ''}</span>
                    ${coreTextParams.colorHex ? `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:${coreTextParams.cssColor}; border:1px solid rgba(255,255,255,0.4); vertical-align:middle;" title="Color: ${coreTextParams.colorHex}${coreTextParams.isDynamicColor ? ` (Var #${coreTextParams.colorId})` : ''}"></span>` : ''}
                    ${coreTextParams.autosize ? `<span class="badge" style="font-size:0.62rem; background:rgba(16,185,129,0.15); color:var(--accent-emerald);">auto</span>` : ''}
                    ${coreTextParams.underline ? `<span class="badge" style="font-size:0.62rem; background:rgba(168,85,247,0.15); color:var(--accent-purple);"><u>U</u></span>` : ''}
                    ${coreTextParams.strikethrough ? `<span class="badge" style="font-size:0.62rem; background:rgba(239,68,68,0.15); color:#f87171;"><s>S</s></span>` : ''}
                ` : ''}
                ${isCanvasOnlyDraw ? `<span class="badge" style="font-size:0.65rem; background:rgba(56,189,248,0.12); color:var(--accent-blue);">${drawOps.length} draw ops</span>` : ''}
                ${modifiers.length > 0 ? `<span class="tree-modifier-badge" onclick="toggleModifiers(event, '${nodeId}')" title="Click to show/hide ${modifiers.length} modifiers">🎨 ${modifiers.length} <span class="caret caret-modifiers-${nodeId}">▶</span></span>` : ''}
            </div>
    `;

    // Render Modifiers container (collapsed by default, toggled via inline badge)
    if (modifiers.length > 0) {
        html += `
            <div id="${nodeId}-modifiers" class="nested-collapsed" style="margin-left: 8px; border-left: 1px dashed rgba(168, 85, 247, 0.4); padding-left: 6px; margin-top: 2px; margin-bottom: 3px;">
        `;
        modifiers.forEach(mod => {
            const modName = getOpName(mod).replace('ModifierOperation', '').replace('Modifier', '');
            const modDesc = typeof mod.deepToString === 'function' ? mod.deepToString("") : "";
            html += `
                <div class="tree-modifier">
                    <span style="color:var(--accent-purple);">🎨</span>
                    <strong style="color:var(--accent-purple);">${modName}:</strong>
                    <span style="font-family:var(--code-font); font-size:0.75rem;">${escapeHtml(modDesc)}</span>
                </div>
            `;
        });
        html += `</div>`;
    }

    html += `
        <div id="${nodeId}-children" class="${startCollapsed ? 'nested-collapsed' : ''}">
    `;

    // Render Children Components
    childComponents.forEach(child => {
        html += buildTreeNodeHtml(child, depth + 1, op);
    });

    // Render Draw Operations inside Container
    drawOps.forEach(dOp => {
        const dName = getOpName(dOp);
        if (dName !== 'ContainerEnd' && dName !== 'Mi') {
            const dDesc = typeof dOp.deepToString === 'function' ? dOp.deepToString("") : "";
            html += `
                <div class="tree-modifier" style="color:var(--accent-blue);">
                    <span>🖌️</span>
                    <strong>${dName}</strong>
                    <span style="font-family:var(--code-font); font-size:0.75rem; color:var(--text-muted);">${escapeHtml(dDesc)}</span>
                </div>
            `;
        }
    });

    html += `
            </div>
        </div>
    `;

    return html;
}

export function getComponentIcon(name) {
    if (name.includes('Box')) return '📦';
    if (name.includes('Column')) return '📊';
    if (name.includes('Row')) return '⏸️';
    if (name.includes('Text')) return '🔤';
    if (name.includes('Canvas')) return '🎨';
    if (name.includes('Image') || name.includes('Bitmap')) return '🖼️';
    return '🧩';
}

export function toggleTreeNode(event, nodeId) {
    event.stopPropagation();
    const caret = event.target;
    const container = document.getElementById(`${nodeId}-children`);
    if (!container) return;

    if (container.classList.contains('nested-collapsed')) {
        container.classList.remove('nested-collapsed');
        caret.classList.add('caret-down');
    } else {
        container.classList.add('nested-collapsed');
        caret.classList.remove('caret-down');
    }
}

export function toggleModifiers(event, nodeId) {
    event.stopPropagation();
    const container = document.getElementById(`${nodeId}-modifiers`);
    const caret = document.querySelector(`.caret-modifiers-${nodeId}`);
    if (!container) return;

    if (container.classList.contains('nested-collapsed')) {
        container.classList.remove('nested-collapsed');
        if (caret) caret.classList.add('caret-down');
    } else {
        container.classList.add('nested-collapsed');
        if (caret) caret.classList.remove('caret-down');
    }
}

export function expandAllTree(expand) {
    const containers = document.querySelectorAll('[id$="-children"]');
    const carets = document.querySelectorAll('.caret');

    containers.forEach(c => {
        if (expand) c.classList.remove('nested-collapsed');
        else c.classList.add('nested-collapsed');
    });

    carets.forEach(c => {
        if (expand) c.classList.add('caret-down');
        else c.classList.remove('caret-down');
    });
}

export function expandTreeAncestors(nodeEl) {
    if (!nodeEl) return;
    let parent = nodeEl.parentElement;
    while (parent) {
        if (parent.id && parent.id.endsWith('-children') && parent.classList.contains('nested-collapsed')) {
            parent.classList.remove('nested-collapsed');
            const parentNodeId = parent.id.replace('-children', '');
            const caret = document.querySelector(`.tree-node-content[data-node-id="${parentNodeId}"] .caret, #${parentNodeId} .caret, .running-node-content[data-node-id="${parentNodeId}"] .caret`);
            if (caret) caret.classList.add('caret-down');
        }
        parent = parent.parentElement;
    }
}

export function selectTreeNode(nodeId, opId) {
    document.querySelectorAll('.tree-node-content').forEach(n => n.classList.remove('selected'));
    const node = document.querySelector(`.tree-node-content[data-node-id="${nodeId}"], #${nodeId}`) || (event?.currentTarget);
    if (node) {
        node.classList.add('selected');
        expandTreeAncestors(node);
        node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const currentParsedOps = window.currentParsedOps;
    const currentBuffer = window.currentBuffer;
    const op = __componentTreeOpRegistry.get(nodeId);

    // Scroll command card into view if op / opId matched
    if (currentParsedOps && currentParsedOps.length > 0) {
        const targetIdx = findMatchingCommandIndex(op, opId, currentParsedOps);
        if (targetIdx >= 0) {
            const u8 = currentBuffer ? new Uint8Array(currentBuffer) : null;
            renderCommandsList(currentParsedOps, u8);
            const matchedOp = currentParsedOps[targetIdx];
            const matchedOpId = getOpId(matchedOp) ?? opId ?? null;
            selectCommandCard(targetIdx, matchedOpId, { scrollTo: true });
            const cmdCard = document.getElementById(`cmdCard-${targetIdx}`);
            if (cmdCard) cmdCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // Forward selection to Layout & Box Model Inspector (Pane 13)
    if (typeof window !== 'undefined' && typeof window.selectLayoutComponent === 'function') {
        window.selectLayoutComponent(op || opId);
    }
}

export function renderRunningOperationsTree(doc) {
    const container = document.getElementById('runningTreeContainer');
    const badge = document.getElementById('runningTreeCountBadge');
    if (!container) return;

    __rtOpRegistry.clear();

    if (!doc) {
        container.innerHTML = `<div style="text-align:center; padding:32px; color:var(--text-muted); font-size:0.85rem;">No running operations inflated yet. Drop a .rc file to inspect post-inflation runtime tree.</div>`;
        if (badge) badge.textContent = '0 Running Ops';
        return;
    }

    const topOps = (typeof doc.getOperations === 'function' ? doc.getOperations() : doc.mOperations) || [];
    if (topOps.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:32px; color:var(--text-muted); font-size:0.85rem;">No running operations found in inflated document.</div>`;
        return;
    }

    let html = '';
    topOps.forEach((op, idx) => {
        const name = getOpName(op);
        if (name !== 'LayoutComponentContent' && name !== 'CanvasContent' && name !== 'ContainerEnd') {
            html += buildRunningTreeNodeHtml(op, 0, `op-${idx}`);
        }
    });

    container.innerHTML = html;
    if (badge) badge.textContent = `${__rtOpRegistry.size} Running Ops`;
    filterRunningTree();
}

export function buildRunningTreeNodeHtml(op, depth, path, parentOp = null) {
    if (!op) return '';
    const nodeId = `rtNode-${path}`;
    __rtOpRegistry.set(nodeId, op);

    const opName = getOpName(op);
    const opId = typeof op.getId === 'function' ? op.getId() : (op.mId ?? null);
    const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? null);
    const cid = typeof op.getComponentId === 'function' ? op.getComponentId() : (op.mComponentId ?? null);
    const aid = typeof op.getAnimationId === 'function' ? op.getAnimationId() : (op.mAnimationId ?? null);
    const isComponent = isComponentOp(op);

    // Live layout measurements (components only)
    const hasLayout = isComponent && (typeof op.getWidth === 'function' || op.mWidth !== undefined);
    const x = isComponent ? (typeof op.getX === 'function' ? op.getX() : (op.mX ?? 0)) : 0;
    const y = isComponent ? (typeof op.getY === 'function' ? op.getY() : (op.mY ?? 0)) : 0;
    const w = isComponent ? (typeof op.getWidth === 'function' ? op.getWidth() : (op.mWidth ?? 0)) : 0;
    const h = isComponent ? (typeof op.getHeight === 'function' ? op.getHeight() : (op.mHeight ?? 0)) : 0;
    const formattedW = isComponent ? formatDimensionNumber(w) : '';
    const formattedH = isComponent ? formatDimensionNumber(h) : '';

    const minDims = isComponent ? getMinDimensions(op, parentOp) : null;
    const formattedMinW = minDims ? formatDimensionNumber(minDims.minW) : '';
    const formattedMinH = minDims ? formatDimensionNumber(minDims.minH) : '';

    // Visibility (components only)
    const parentVisInfo = (parentOp && isComponent) ? getVisibilityInfo(parentOp) : null;
    const visInfo = isComponent ? getVisibilityInfo(op, parentVisInfo) : null;
    const visStr = visInfo ? visInfo.status : '';
    const visClass = visInfo ? (visInfo.status === 'VISIBLE' ? 'color:var(--accent-emerald);' : (visInfo.status === 'INVISIBLE' ? 'color:var(--accent-amber);' : 'color:var(--text-muted);')) : '';

    // Children & sub-operations
    const subOps = getRunningNodeChildren(op);
    const hasChildren = subOps.length > 0;

    // Live expression / value preview with full pretty-printing
    let valBadge = '';
    const currentPlayer = window.currentPlayer;
    const rCtx = currentPlayer ? currentPlayer.getRemoteContext() : null;

    if (opCode === 81 || opName === 'FloatExpression') {
        const bits = op.mBits || op.bits || op.srcExpression;
        const exprStr = bits ? prettyPrintFloatExpression(bits) : '';
        let curVal = rCtx ? rCtx.getFloat(op.mId) : (typeof op.getValue === 'function' ? op.getValue() : NaN);
        if (Number.isNaN(curVal) && typeof op.getValue === 'function') curVal = op.getValue();
        const valFormatted = !Number.isNaN(curVal) && isFinite(curVal) ? (Number.isInteger(curVal) ? curVal.toString() : curVal.toFixed(2)) : '';
        if (exprStr) {
            valBadge = `<span class="badge" style="font-size:0.68rem; font-family:var(--code-font); background:rgba(56,189,248,0.15); color:var(--accent-blue);" title="Expression: ${escapeHtml(exprStr)}">fx: <strong style="color:var(--text-primary);">${escapeHtml(exprStr)}</strong>${valFormatted ? ` = <strong style="color:var(--accent-emerald);">${valFormatted}</strong>` : ''}</span>`;
        } else if (valFormatted) {
            valBadge = `<span class="badge" style="background:rgba(56,189,248,0.15); color:var(--accent-blue);">val: ${valFormatted}</span>`;
        }
    } else if (opCode === 83 || opCode === 144 || opName === 'IntegerExpression') {
        const mask = op.mMask ?? op.mask ?? 0;
        const values = op.mValues || op.values || [];
        const exprStr = prettyPrintIntegerExpression(mask, values);
        const curVal = rCtx ? rCtx.getInteger(op.mId) : (op.mValue ?? null);
        if (exprStr) {
            valBadge = `<span class="badge" style="font-size:0.68rem; font-family:var(--code-font); background:rgba(129,140,248,0.15); color:var(--accent-indigo, #818cf8);" title="Integer Expression: ${escapeHtml(exprStr)}">ix: <strong style="color:var(--text-primary);">${escapeHtml(exprStr)}</strong>${curVal !== null && curVal !== undefined ? ` = <strong style="color:var(--accent-emerald);">${curVal}</strong>` : ''}</span>`;
        } else if (curVal !== null && curVal !== undefined) {
            valBadge = `<span class="badge" style="background:rgba(129,140,248,0.15); color:var(--accent-indigo, #818cf8);">val: ${curVal}</span>`;
        }
    } else if (opCode === 85 || opName === 'ColorExpression') {
        const curVal = rCtx ? rCtx.getColor(op.mId) : (op.mColor ?? 0);
        const hex = '#' + ((curVal >>> 0) & 0xFFFFFF).toString(16).padStart(6, '0');
        valBadge = `<span class="badge" style="font-size:0.68rem; font-family:var(--code-font); background:rgba(234,179,8,0.15); color:var(--accent-amber); display:inline-flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:2px; background:${hex}; border:1px solid rgba(255,255,255,0.4);"></span>${hex}</span>`;
    } else if (opCode === 80 || opName === 'FloatConstant') {
        const val = rCtx ? rCtx.getFloat(op.mId) : (op.mValue ?? (typeof op.getValue === 'function' ? op.getValue() : null));
        if (val !== null && val !== undefined && !Number.isNaN(val)) {
            valBadge = `<span class="badge" style="background:rgba(56,189,248,0.15); color:var(--accent-blue);">float: ${Number.isInteger(val) ? val : val.toFixed(2)}</span>`;
        }
    } else if (opCode === 84 || opName === 'ColorConstant') {
        const val = rCtx ? rCtx.getColor(op.mId) : (op.mColor ?? 0);
        const hex = '#' + ((val >>> 0) & 0xFFFFFF).toString(16).padStart(6, '0');
        valBadge = `<span class="badge" style="font-size:0.68rem; font-family:var(--code-font); background:rgba(234,179,8,0.15); color:var(--accent-amber); display:inline-flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:2px; background:${hex}; border:1px solid rgba(255,255,255,0.4);"></span>${hex}</span>`;
    } else if (typeof op.getValue === 'function') {
        const val = op.getValue();
        if (val !== undefined && val !== null) {
            valBadge = `<span class="badge" style="background:rgba(56,189,248,0.15); color:var(--accent-blue);">val: ${Number(val).toFixed(2).replace(/\\.00$/, '')}</span>`;
        }
    } else if (op.mValue !== undefined && op.mValue !== null) {
        valBadge = `<span class="badge" style="background:rgba(56,189,248,0.15); color:var(--accent-blue);">val: ${op.mValue}</span>`;
    }

    // Text preview
    const currentDocument = window.currentDocument;
    const textContent = op.mText || (op.mTextId && currentDocument?.getText ? currentDocument.getText(op.mTextId) : null);
    // Deep description
    const desc = typeof op.deepToString === 'function' ? op.deepToString("") : (typeof op.toString === 'function' && op.toString() !== '[object Object]' ? op.toString() : '');

    const icon = getRunningOpIcon(opName, opCode);
    const stepTargetOp = window.stepTargetOp;
    const isTarget = stepTargetOp === op;
    const isCanvasOnlyDraw = (opName.includes('Canvas') || opName === 'CanvasLayout') && subOps.every(c => !isContainerOp(c)) && subOps.length > 0;
    const startCollapsed = isCanvasOnlyDraw;

    let html = `
        <div class="tree-node running-tree-node ${depth === 0 ? 'tree-node-root' : ''}" data-opname="${escapeHtml(opName.toLowerCase())}" data-opid="${opId ?? ''}" data-cid="${cid ?? ''}">
            <div class="tree-node-content running-node-content ${isTarget ? 'selected step-active' : ''}" id="${nodeId}" data-node-id="${nodeId}" onclick="selectRunningTreeNode('${nodeId}')" title="Click to draw frame up to ${opName}">
                ${hasChildren ? `<span class="caret ${startCollapsed ? '' : 'caret-down'}" onclick="toggleRunningTreeNode(event, '${nodeId}')">▶</span>` : '<span style="width:10px; display:inline-block;"></span>'}
                ${isComponent && visInfo ? `<span id="rtVisIcon-${nodeId}" class="tree-vis-icon ${visInfo.className}" title="${visInfo.title}">${visInfo.icon}</span>` : ''}
                <span class="tree-icon">${icon}</span>
                <strong class="tree-tag" style="color:var(--text-primary); font-size:0.82rem;">${escapeHtml(opName)}</strong>
                ${opCode !== null ? `<span class="op-badge" style="font-size:0.65rem; padding:1px 4px;">#${opCode}</span>` : ''}
                ${opId !== null ? `<span class="tree-id">ID:${opId}</span>` : ''}
                ${cid !== null && cid !== undefined ? `<span class="badge" style="font-size:0.65rem; background:rgba(168,85,247,0.15); color:var(--accent-purple);">CID:${cid}</span>` : ''}
                ${(opName === 'LoopOperation' || op.OP_CODE === 215) ? (() => {
                    const { from, step, until } = evaluateLoopParams(op, rCtx);
                    const indexId = op.mIndexId ?? 0;
                    return `<span class="badge" style="font-size:0.65rem; background:rgba(234,179,8,0.15); color:var(--accent-amber);">Var#${indexId} = ${from}..${until} (+${step})</span>`;
                })() : ''}
                ${isComponent ? `<span id="rtDim-${nodeId}" class="tree-dim" style="color:var(--accent-emerald); ${hasLayout && formattedW && formattedH ? '' : 'display:none;'}" title="Evaluated Layout Bounds: x:${x}, y:${y}, w:${w}, h:${h}">(${formattedW}×${formattedH})</span>` : ''}
                ${minDims ? `<span class="badge" style="font-size:0.65rem; font-family:var(--code-font); background:rgba(245,158,11,0.14); color:var(--accent-amber); border:1px solid rgba(245,158,11,0.35); font-weight:600; padding:1px 4px;" title="FitBoxLayout Constraints: min width = ${formattedMinW}dp, min height = ${formattedMinH}dp">min: ${formattedMinW}×${formattedMinH}</span>` : ''}
                ${isComponent && visStr ? `<span id="rtVis-${nodeId}" style="font-size:0.68rem; font-weight:600; ${visClass};">[${visStr}]</span>` : ''}
                <span id="rtVal-${nodeId}" class="rt-val-container">${valBadge}</span>
                ${(() => {
                    const layoutAlign = getLayoutAlignmentInfo(op);
                    if (!layoutAlign || (!layoutAlign.hName && !layoutAlign.vName)) return '';
                    return `<span class="badge" style="font-size:0.65rem; background:rgba(59,130,246,0.12); color:var(--accent-blue); font-family:var(--code-font);" title="Layout Alignment: Horizontal=${layoutAlign.hName || 'none'}, Vertical=${layoutAlign.vName || 'none'}${layoutAlign.spacedBy !== null ? `, SpacedBy=${layoutAlign.spacedBy}dp` : ''}">↔ ${layoutAlign.hName || '—'} ↕ ${layoutAlign.vName || '—'}${layoutAlign.spacedBy !== null ? ` • 📏${layoutAlign.spacedBy}dp` : ''}</span>`;
                })()}
                ${textContent ? `<span style="color:var(--accent-amber); font-style:italic; font-size:0.75rem;">"${escapeHtml(textContent)}"</span>` : ''}
                ${(() => {
                    const isCoreText = opName === 'CoreText' || opName === 'TextLayout' || op.OP_CODE === 239 || op.OP_CODE === 208 || op.mTextId !== undefined;
                    const coreTextParams = isCoreText ? getCoreTextParameters(op, currentDocument) : null;
                    if (!coreTextParams) return '';
                    return `
                        <span class="badge" style="font-size:0.65rem; background:rgba(56,189,248,0.12); color:var(--accent-blue); font-family:var(--code-font);" title="Font Size: ${coreTextParams.fontSize}sp, Weight: ${coreTextParams.fontWeightName}">🔤 ${coreTextParams.fontSize}sp • ${coreTextParams.fontWeight}</span>
                        <span class="badge" style="font-size:0.65rem; background:rgba(168,85,247,0.12); color:var(--accent-purple); font-family:var(--code-font);" title="Alignment: ${coreTextParams.textAlignName}, Overflow: ${coreTextParams.overflowName}">${coreTextParams.textAlignName}${coreTextParams.maxLines < 10000 ? ` • ${coreTextParams.maxLines}L` : ''}</span>
                        ${coreTextParams.colorHex ? `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:${coreTextParams.cssColor}; border:1px solid rgba(255,255,255,0.4); vertical-align:middle;" title="Color: ${coreTextParams.colorHex}"></span>` : ''}
                    `;
                })()}
                ${hasChildren ? `<span class="badge" style="font-size:0.65rem; background:rgba(255,255,255,0.06); color:var(--text-muted);">${subOps.length} sub-ops</span>` : ''}
            </div>
    `;

    if (desc && desc !== opName && !desc.startsWith(opName)) {
        html += `<div style="font-family:var(--code-font); font-size:0.72rem; color:var(--text-muted); margin-left:10px; margin-bottom:4px; padding:2px 6px; background:rgba(0,0,0,0.15); border-radius:3px; word-break:break-all;">${escapeHtml(desc)}</div>`;
    }

    if (hasChildren) {
        html += `<div id="${nodeId}-children" class="${startCollapsed ? 'nested-collapsed' : ''}">`;
        subOps.forEach((child, cIdx) => {
            html += buildRunningTreeNodeHtml(child, depth + 1, `${path}-${cIdx}`, op);
        });
        html += `</div>`;
    }

    html += `</div>`;
    return html;
}

export function updateComponentTreeLive() {
    const pane3 = document.getElementById('pane3');
    if (!pane3 || pane3.classList.contains('hidden-panel') || !__componentTreeOpRegistry) return;

    for (const [nodeId, op] of __componentTreeOpRegistry.entries()) {
        if (!op) continue;
        const w = typeof op.getWidth === 'function' ? op.getWidth() : (op.mWidth ?? 0);
        const h = typeof op.getHeight === 'function' ? op.getHeight() : (op.mHeight ?? 0);
        const formattedW = formatDimensionNumber(w);
        const formattedH = formatDimensionNumber(h);

        const dimEl = document.getElementById(`ctDim-${nodeId}`);
        if (dimEl) {
            if (formattedW !== '' && formattedH !== '') {
                dimEl.textContent = `(${formattedW}x${formattedH})`;
                dimEl.style.display = '';
            } else {
                dimEl.style.display = 'none';
            }
        }

        // 2. Update live visibility icon in Component Tree (Pane 3)
        const visEl = document.getElementById(`ctVis-${nodeId}`);
        if (visEl) {
            const visInfo = getVisibilityInfo(op);
            if (visEl.textContent !== visInfo.icon) {
                visEl.textContent = visInfo.icon;
                visEl.title = visInfo.title;
                visEl.className = `tree-vis-icon ${visInfo.className}`;
            }
        }
    }

    // Recompute live overlay bounds for the selected component
    if (typeof window.drawLayoutBoundsOverlay === 'function') {
        window.drawLayoutBoundsOverlay();
    }
}

export function updateRunningTreeLive() {
    updateComponentTreeLive();

    const pane7 = document.getElementById('pane7');
    if (!pane7 || pane7.classList.contains('hidden-panel') || !__rtOpRegistry) return;
    const currentPlayer = window.currentPlayer;
    const rCtx = currentPlayer ? currentPlayer.getRemoteContext() : null;

    for (const [nodeId, op] of __rtOpRegistry.entries()) {
        if (!op) continue;
        const isComponent = isComponentOp(op);

        // 1. Update live layout dimensions per frame (components only)
        const dimEl = document.getElementById(`rtDim-${nodeId}`);
        if (dimEl) {
            if (isComponent) {
                const w = typeof op.getWidth === 'function' ? op.getWidth() : (op.mWidth ?? 0);
                const h = typeof op.getHeight === 'function' ? op.getHeight() : (op.mHeight ?? 0);
                const x = typeof op.getX === 'function' ? op.getX() : (op.mX ?? 0);
                const y = typeof op.getY === 'function' ? op.getY() : (op.mY ?? 0);
                const formattedW = formatDimensionNumber(w);
                const formattedH = formatDimensionNumber(h);

                if (formattedW && formattedH) {
                    dimEl.textContent = `(${formattedW}×${formattedH})`;
                    dimEl.title = `Evaluated Layout Bounds: x:${x}, y:${y}, w:${w}, h:${h}`;
                    dimEl.style.display = '';
                } else {
                    dimEl.style.display = 'none';
                }
            } else {
                dimEl.style.display = 'none';
            }
        }

        // 2. Update live visibility (components only)
        const visIconEl = document.getElementById(`rtVisIcon-${nodeId}`);
        const visEl = document.getElementById(`rtVis-${nodeId}`);
        if (isComponent) {
            const visInfo = getVisibilityInfo(op);
            if (visIconEl) {
                if (visIconEl.textContent !== visInfo.icon) {
                    visIconEl.textContent = visInfo.icon;
                    visIconEl.title = visInfo.title;
                    visIconEl.className = `tree-vis-icon ${visInfo.className}`;
                }
                visIconEl.style.display = '';
            }
            if (visEl) {
                const visStr = visInfo.status;
                const visColor = visInfo.status === 'VISIBLE' ? 'var(--accent-emerald)' : (visInfo.status === 'INVISIBLE' ? 'var(--accent-amber)' : 'var(--text-muted)');
                visEl.textContent = `[${visStr}]`;
                visEl.style.color = visColor;
                visEl.style.display = '';
            }
        } else {
            if (visIconEl) visIconEl.style.display = 'none';
            if (visEl) visEl.style.display = 'none';
        }

        // 3. Update live expressions / values
        const valEl = document.getElementById(`rtVal-${nodeId}`);
        if (valEl) {
            const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? null);
            const opName = getOpName(op);

            if (opCode === 81 || opName === 'FloatExpression') {
                const bits = op.mBits || op.bits || op.srcExpression;
                const exprStr = bits ? prettyPrintFloatExpression(bits) : '';
                let curVal = rCtx ? rCtx.getFloat(op.mId) : (typeof op.getValue === 'function' ? op.getValue() : NaN);
                if (Number.isNaN(curVal) && typeof op.getValue === 'function') curVal = op.getValue();
                const valFormatted = !Number.isNaN(curVal) && isFinite(curVal) ? (Number.isInteger(curVal) ? curVal.toString() : curVal.toFixed(2)) : '';
                if (exprStr) {
                    valEl.innerHTML = `<span class="badge" style="font-size:0.68rem; font-family:var(--code-font); background:rgba(56,189,248,0.15); color:var(--accent-blue);" title="Expression: ${escapeHtml(exprStr)}">fx: <strong style="color:var(--text-primary);">${escapeHtml(exprStr)}</strong>${valFormatted ? ` = <strong style="color:var(--accent-emerald);">${valFormatted}</strong>` : ''}</span>`;
                } else if (valFormatted) {
                    valEl.innerHTML = `<span class="badge" style="background:rgba(56,189,248,0.15); color:var(--accent-blue);">val: ${valFormatted}</span>`;
                }
            } else if (opCode === 83 || opCode === 144 || opName === 'IntegerExpression') {
                const mask = op.mMask ?? op.mask ?? 0;
                const values = op.mValues || op.values || [];
                const exprStr = prettyPrintIntegerExpression(mask, values);
                const curVal = rCtx ? rCtx.getInteger(op.mId) : (op.mValue ?? null);
                if (exprStr) {
                    valEl.innerHTML = `<span class="badge" style="font-size:0.68rem; font-family:var(--code-font); background:rgba(129,140,248,0.15); color:var(--accent-indigo, #818cf8);" title="Integer Expression: ${escapeHtml(exprStr)}">ix: <strong style="color:var(--text-primary);">${escapeHtml(exprStr)}</strong>${curVal !== null && curVal !== undefined ? ` = <strong style="color:var(--accent-emerald);">${curVal}</strong>` : ''}</span>`;
                } else if (curVal !== null && curVal !== undefined) {
                    valEl.innerHTML = `<span class="badge" style="background:rgba(129,140,248,0.15); color:var(--accent-indigo, #818cf8);">val: ${curVal}</span>`;
                }
            } else if (opCode === 85 || opName === 'ColorExpression') {
                const curVal = rCtx ? rCtx.getColor(op.mId) : (op.mColor ?? 0);
                const hex = '#' + ((curVal >>> 0) & 0xFFFFFF).toString(16).padStart(6, '0');
                valEl.innerHTML = `<span class="badge" style="font-size:0.68rem; font-family:var(--code-font); background:rgba(234,179,8,0.15); color:var(--accent-amber); display:inline-flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:2px; background:${hex}; border:1px solid rgba(255,255,255,0.4);"></span>${hex}</span>`;
            }
        }
    }
}

export function getRunningOpIcon(name, code) {
    if (name.includes('Root') || name.includes('Box')) return '📦';
    if (name.includes('Column')) return '📊';
    if (name.includes('Row')) return '⏸️';
    if (name.includes('Text') || name.includes('Font')) return '🔤';
    if (name.includes('Canvas')) return '🎨';
    if (name.includes('Image') || name.includes('Bitmap')) return '🖼️';
    if (name.includes('Modifier')) return '🎨';
    if (name.includes('Draw') || name.includes('Path') || name.includes('Line') || name.includes('Arc') || name.includes('Rect')) return '🖌️';
    if (name.includes('Expression') || name.includes('Constant') || name.includes('Variable')) return '🧮';
    if (name.includes('Click') || name.includes('Touch') || name.includes('State') || name.includes('Listener')) return '⚡';
    if (name.includes('Header') || name.includes('Theme')) return '🏷️';
    return '🌿';
}

export function toggleRunningTreeNode(event, nodeId) {
    event.stopPropagation();
    const caret = event.target;
    const container = document.getElementById(`${nodeId}-children`);
    if (!container) return;

    if (container.classList.contains('nested-collapsed')) {
        container.classList.remove('nested-collapsed');
        caret.classList.add('caret-down');
    } else {
        container.classList.add('nested-collapsed');
        caret.classList.remove('caret-down');
    }
}

export function expandAllRunningTree(expand) {
    document.querySelectorAll('#runningTreeContainer [id$="-children"]').forEach(container => {
        const id = container.id.replace('-children', '');
        const caret = document.querySelector(`.running-node-content[onclick*="${id}"] .caret`);
        if (expand) {
            container.classList.remove('nested-collapsed');
            if (caret) caret.classList.add('caret-down');
        } else {
            container.classList.add('nested-collapsed');
            if (caret) caret.classList.remove('caret-down');
        }
    });
}

export function selectRunningTreeNode(nodeId) {
    const op = __rtOpRegistry.get(nodeId);

    // If player is playing, pause it automatically
    pausePlayer();

    // Render frame up to this clicked operation
    if (op) {
        selectAndRenderStepOp(op);
    }

    document.querySelectorAll('.running-node-content').forEach(n => {
        n.classList.remove('selected');
        n.classList.remove('step-active');
    });
    const nodeEl = document.querySelector(`.running-node-content[data-node-id="${nodeId}"], #${nodeId}`) || document.querySelector(`.running-node-content[onclick*="${nodeId}"]`);
    if (nodeEl) {
        nodeEl.classList.add('selected');
        nodeEl.classList.add('step-active');
        expandTreeAncestors(nodeEl);
        nodeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Also scroll matching command in Pane 2 if applicable
    const currentParsedOps = window.currentParsedOps;
    if (currentParsedOps && currentParsedOps.length > 0) {
        const targetIdx = findMatchingCommandIndex(op, null, currentParsedOps);
        if (targetIdx >= 0) {
            const matchedOp = currentParsedOps[targetIdx];
            const matchedOpId = getOpId(matchedOp) ?? null;
            selectCommandCard(targetIdx, matchedOpId, { scrollTo: true });
            const cmdCard = document.getElementById(`cmdCard-${targetIdx}`);
            if (cmdCard) cmdCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // Forward selection to Layout & Box Model Inspector (Pane 13)
    if (typeof window !== 'undefined' && typeof window.selectLayoutComponent === 'function') {
        window.selectLayoutComponent(op);
    }
}

export function onRunningTreeSearchInput() {
    const input = document.getElementById('runningTreeSearchInput');
    const clearBtn = document.getElementById('runningTreeSearchClearBtn');
    if (input && clearBtn) {
        clearBtn.style.display = input.value.trim().length > 0 ? 'block' : 'none';
    }
    filterRunningTree();
}

export function clearRunningTreeSearch() {
    const input = document.getElementById('runningTreeSearchInput');
    const clearBtn = document.getElementById('runningTreeSearchClearBtn');
    if (input) {
        input.value = '';
        input.focus();
    }
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }
    filterRunningTree();
}

export function filterRunningTree() {
    const input = document.getElementById('runningTreeSearchInput');
    if (!input) return;
    const query = input.value.toLowerCase().trim();
    if (!query) {
        document.querySelectorAll('.running-tree-node').forEach(node => {
            node.style.display = '';
        });
        return;
    }

    document.querySelectorAll('.running-tree-node').forEach(node => {
        const text = node.textContent.toLowerCase();
        const matches = text.includes(query);
        node.style.display = matches ? '' : 'none';
        if (matches) {
            let parent = node.parentElement;
            while (parent && parent.id !== 'runningTreeContainer') {
                if (parent.id && parent.id.endsWith('-children')) {
                    parent.classList.remove('nested-collapsed');
                    const parentNodeId = parent.id.replace('-children', '');
                    const caret = document.querySelector(`.running-node-content[onclick*="${parentNodeId}"] .caret`);
                    if (caret) caret.classList.add('caret-down');
                }
                parent = parent.parentElement;
            }
        }
    });
}

// Window attachments for inline HTML event handlers
window.__rtOpRegistry = __rtOpRegistry;
window.__componentTreeOpRegistry = __componentTreeOpRegistry;
window.renderComponentTree = renderComponentTree;
window.buildTreeNodeHtml = buildTreeNodeHtml;
window.getComponentIcon = getComponentIcon;
window.toggleTreeNode = toggleTreeNode;
window.toggleModifiers = toggleModifiers;
window.expandAllTree = expandAllTree;
window.selectTreeNode = selectTreeNode;
window.renderRunningOperationsTree = renderRunningOperationsTree;
window.buildRunningTreeNodeHtml = buildRunningTreeNodeHtml;
window.updateComponentTreeLive = updateComponentTreeLive;
window.updateRunningTreeLive = updateRunningTreeLive;
window.getVisibilityInfo = getVisibilityInfo;
window.getRunningOpIcon = getRunningOpIcon;
window.toggleRunningTreeNode = toggleRunningTreeNode;
window.expandAllRunningTree = expandAllRunningTree;
window.selectRunningTreeNode = selectRunningTreeNode;
window.onRunningTreeSearchInput = onRunningTreeSearchInput;
window.clearRunningTreeSearch = clearRunningTreeSearch;
window.filterRunningTree = filterRunningTree;
