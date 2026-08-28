// =========================================================================
// Panel 5 & Stage Controls: Stage & Canvas Player Panel
// Modularized in src/panels/StagePanel.js
// Handles live canvas sizing, display density scaling, interactive resizing,
// single-frame step debugging, execution trace tracking, and playback controls.
// =========================================================================

import { getOpName, getOpId, findMatchingCommandIndex } from './CommandListPanel.js';

let customStageWidth = null;
let customStageHeight = null;
let currentDensity = 1.0;
let stageScaleMode = 'fit'; // 'fit' (auto scale down), 'fill' (zoom to fit), or numeric scale string '1', '0.75', '0.5', etc.
let currentStageScale = 1.0;
let isStageAutoScale = true;
let canvasBgWhite = true;
let isPlayerPaused = false;
let isResizing = false;
let stepTargetOp = null;
let executionTrace = [];
let currentStepIndex = -1;

export {
    customStageWidth,
    customStageHeight,
    currentDensity,
    stageScaleMode,
    currentStageScale,
    isStageAutoScale,
    canvasBgWhite,
    isPlayerPaused,
    isResizing,
    stepTargetOp,
    executionTrace,
    currentStepIndex
};

export function formatDimensionNumber(val) {
    if (val === null || val === undefined || val === '') return '';
    if (typeof val === 'number') {
        if (Number.isInteger(val)) return val.toString();
        return (Math.round(val * 10) / 10).toString();
    }
    const num = parseFloat(val);
    if (!isNaN(num)) {
        if (Number.isInteger(num)) return num.toString();
        return (Math.round(num * 10) / 10).toString();
    }
    return String(val);
}

export function setCustomStageSize() {
    const wInput = document.getElementById('stageWidthInput');
    const hInput = document.getElementById('stageHeightInput');
    if (!wInput || !hInput) return;

    const w = Math.max(50, Math.min(4000, parseFloat(wInput.value) || 300));
    const h = Math.max(50, Math.min(4000, parseFloat(hInput.value) || 300));

    customStageWidth = w;
    customStageHeight = h;
    applyStageDimensions(w, h);
}

export function applyStagePreset(w, h) {
    const currentDocument = window.currentDocument;
    if (w === 'doc') {
        customStageWidth = null;
        customStageHeight = null;
        const docW = currentDocument ? (typeof currentDocument.getAuthorWidth === 'function' ? currentDocument.getAuthorWidth() : (currentDocument.mHeader ? currentDocument.mHeader.mWidth : currentDocument.getWidth())) : 300;
        const docH = currentDocument ? (typeof currentDocument.getAuthorHeight === 'function' ? currentDocument.getAuthorHeight() : (currentDocument.mHeader ? currentDocument.mHeader.mHeight : currentDocument.getHeight())) : 300;
        applyStageDimensions(docW, docH);
        return;
    }

    customStageWidth = w;
    customStageHeight = h;
    applyStageDimensions(w, h);
}

export function applyDensity(density, fromUser = true) {
    if (typeof density !== 'number' || isNaN(density) || density <= 0) return;
    currentDensity = density;

    const selectEl = document.getElementById('densitySelect');
    const customInput = document.getElementById('customDensityInput');

    if (selectEl) {
        const matchingOption = Array.from(selectEl.options).find(opt => parseFloat(opt.value) === density);
        if (matchingOption) {
            selectEl.value = matchingOption.value;
            if (customInput) customInput.style.display = 'none';
        } else {
            selectEl.value = 'custom';
            if (customInput) {
                customInput.style.display = 'inline-block';
                if (document.activeElement !== customInput) customInput.value = density.toString();
            }
        }
    }

    const stageSetupBadge = document.getElementById('stageSetupBadge');
    if (stageSetupBadge) {
        const wInput = document.getElementById('stageWidthInput');
        const hInput = document.getElementById('stageHeightInput');
        const curW = wInput ? wInput.value : 300;
        const curH = hInput ? hInput.value : 300;
        stageSetupBadge.textContent = `${curW}×${curH} • ${density}x`;
    }

    const currentPlayer = window.currentPlayer;
    const currentDocument = window.currentDocument;

    if (currentPlayer) {
        if (typeof currentPlayer.setDensity === 'function') {
            currentPlayer.setDensity(density);
        }
        const rContext = currentPlayer.getRemoteContext();
        if (rContext) {
            rContext.setDensity(density);
            rContext.loadFloat(27 /* ID_DENSITY */, density);
            rContext.loadFloat(33 /* ID_FONT_SIZE */, 14 * density * 1.0);
        }
    }

    if (currentDocument) {
        if (typeof currentDocument.setDensity === 'function') {
            currentDocument.setDensity(density);
        }
        currentDocument.mNeedsMeasure = true;
        const rootComp = typeof currentDocument.getRootLayoutComponent === 'function'
            ? currentDocument.getRootLayoutComponent()
            : currentDocument.mRootLayoutComponent;
        if (rootComp) {
            rootComp.mNeedsMeasure = true;
            if (typeof rootComp.invalidateMeasure === 'function') rootComp.invalidateMeasure();
        }
        if (typeof currentDocument.invalidateMeasure === 'function') {
            currentDocument.invalidateMeasure();
        }
    }

    // Re-apply stage dimensions to synchronize canvas pixel width/height with the new density
    const canvas = document.getElementById('previewCanvas');
    const currW = customStageWidth !== null ? customStageWidth : (canvas && canvas.style.width ? parseFloat(canvas.style.width) || (currentDocument ? currentDocument.getWidth() : 300) : 300);
    const currH = customStageHeight !== null ? customStageHeight : (canvas && canvas.style.height ? parseFloat(canvas.style.height) || (currentDocument ? currentDocument.getHeight() : 300) : 300);
    applyStageDimensions(currW, currH);

    if (currentPlayer) {
        if (typeof currentPlayer.repaint === 'function') currentPlayer.repaint();
    }

    if (typeof window.updateRunningTreeLive === 'function') window.updateRunningTreeLive();
}

export function onDensitySelectChange() {
    const selectEl = document.getElementById('densitySelect');
    const customInput = document.getElementById('customDensityInput');
    if (!selectEl) return;
    if (selectEl.value === 'custom') {
        if (customInput) {
            customInput.style.display = 'inline-block';
            customInput.focus();
            const val = parseFloat(customInput.value) || 2.625;
            applyDensity(val);
        }
    } else {
        if (customInput) customInput.style.display = 'none';
        const val = parseFloat(selectEl.value);
        applyDensity(val);
    }
}

export function onCustomDensityInput() {
    const customInput = document.getElementById('customDensityInput');
    if (!customInput) return;
    const val = parseFloat(customInput.value);
    if (!isNaN(val) && val > 0) {
        applyDensity(val);
    }
}

export function updateStageScale() {
    const workspace = document.getElementById('stageWorkspaceContainer');
    const wrapper = document.getElementById('canvasStageWrapper');
    const scaler = document.getElementById('canvasStageScaler');
    const canvas = document.getElementById('previewCanvas');
    if (!workspace || !wrapper) return;

    const w = customStageWidth !== null
        ? customStageWidth
        : (canvas && canvas.style.width ? parseFloat(canvas.style.width) || 300 : 300);
    const h = customStageHeight !== null
        ? customStageHeight
        : (canvas && canvas.style.height ? parseFloat(canvas.style.height) || 300 : 300);

    const padding = 32; // 16px padding on each side of workspace
    const availW = Math.max(50, (workspace.clientWidth || 300) - padding);
    const availH = Math.max(50, (workspace.clientHeight || 300) - padding);

    let scale = 1.0;
    if (stageScaleMode === 'fit') {
        if (w > availW || h > availH) {
            scale = Math.max(0.05, Math.min(1.0, availW / w, availH / h));
        } else {
            scale = 1.0;
        }
    } else if (stageScaleMode === 'fill') {
        scale = Math.max(0.05, Math.min(availW / w, availH / h));
    } else {
        const num = parseFloat(stageScaleMode);
        scale = (!isNaN(num) && num > 0) ? num : 1.0;
    }

    currentStageScale = scale;
    isStageAutoScale = (stageScaleMode === 'fit');

    wrapper.style.transformOrigin = '0 0';
    if (scale !== 1.0) {
        wrapper.style.transform = `scale(${scale})`;
    } else {
        wrapper.style.transform = '';
    }

    const scaledW = Math.round(w * scale);
    const scaledH = Math.round(h * scale);

    if (scaler) {
        scaler.style.width = `${scaledW}px`;
        scaler.style.height = `${scaledH}px`;
    }

    // Update UI controls & badges
    const autoScaleBtn = document.getElementById('stageAutoScaleBtn');
    if (autoScaleBtn) {
        if (stageScaleMode === 'fit') {
            autoScaleBtn.classList.add('active');
        } else {
            autoScaleBtn.classList.remove('active');
        }
    }

    const scaleSelect = document.getElementById('stageScaleSelect');
    if (scaleSelect && scaleSelect.value !== stageScaleMode) {
        scaleSelect.value = stageScaleMode;
    }

    const setupScaleSelect = document.getElementById('stageSetupScaleSelect');
    if (setupScaleSelect && setupScaleSelect.value !== stageScaleMode) {
        setupScaleSelect.value = stageScaleMode;
    }

    const badge = document.getElementById('stageScaleFactorBadge');
    if (badge) {
        const pct = Math.round(scale * 100);
        badge.textContent = `${pct}%${stageScaleMode === 'fit' && scale < 1.0 ? ' (Fit)' : ''}`;
        badge.style.display = 'inline-block';
    }

    const stageSetupBadge = document.getElementById('stageSetupBadge');
    if (stageSetupBadge) {
        const d = currentDensity || 1.0;
        const curW = customStageWidth !== null ? customStageWidth : (canvas ? parseFloat(canvas.style.width) || 300 : 300);
        const curH = customStageHeight !== null ? customStageHeight : (canvas ? parseFloat(canvas.style.height) || 300 : 300);
        const scaleStr = scale !== 1.0 ? ` • ${Math.round(scale * 100)}%` : '';
        stageSetupBadge.textContent = `${Math.round(curW)}×${Math.round(curH)} • ${d}x${scaleStr}`;
    }
}

export function setStageScaleMode(mode) {
    if (!mode) return;
    stageScaleMode = mode;
    isStageAutoScale = (mode === 'fit');
    updateStageScale();
}

export function toggleStageAutoScale() {
    if (stageScaleMode === 'fit') {
        setStageScaleMode('1');
    } else {
        setStageScaleMode('fit');
    }
}

export function onStageScaleSelectChange() {
    const select = document.getElementById('stageScaleSelect');
    if (!select) return;
    setStageScaleMode(select.value);
}

export function onStageSetupScaleSelectChange() {
    const select = document.getElementById('stageSetupScaleSelect');
    if (!select) return;
    setStageScaleMode(select.value);
}

export function initStageLiveResize() {
    const handleE = document.getElementById('stageResizeHandleE');
    const handleS = document.getElementById('stageResizeHandleS');
    const handleSE = document.getElementById('stageResizeHandleSE');
    const wrapper = document.getElementById('canvasStageWrapper');
    const tooltip = document.getElementById('stageResizeTooltip');
    const canvas = document.getElementById('previewCanvas');
    if (!wrapper || !canvas) return;

    let resizeMode = 'both'; // 'w', 'h', or 'both'
    let startX = 0, startY = 0, startW = 300, startH = 300, startAspect = 1.0;
    let rafId = null;
    let targetW = 300, targetH = 300;

    function updateTooltip(w, h) {
        if (!tooltip) return;
        const d = currentDensity || 1.0;
        const pixelW = Math.round(w * d);
        const pixelH = Math.round(h * d);
        tooltip.textContent = `${Math.round(w)} × ${Math.round(h)} dp (${pixelW} × ${pixelH} px @ ${d}x)`;
        tooltip.style.display = 'block';
    }

    function startDrag(e, mode) {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        resizeMode = mode;
        startX = e.clientX;
        startY = e.clientY;
        const d = currentDensity || 1.0;
        startW = customStageWidth !== null
            ? customStageWidth
            : (canvas ? (parseFloat(canvas.style.width) || Math.round((canvas.width || 300) / d)) : 300);
        startH = customStageHeight !== null
            ? customStageHeight
            : (canvas ? (parseFloat(canvas.style.height) || Math.round((canvas.height || 300) / d)) : 300);
        startAspect = (startH > 0) ? (startW / startH) : 1.0;
        targetW = startW;
        targetH = startH;

        const currentPlayer = window.currentPlayer;
        const rContext = currentPlayer?.getRemoteContext?.();
        if (rContext && typeof rContext.setAnimationEnabled === 'function') {
            rContext.setAnimationEnabled(false);
        }

        wrapper.classList.add('resizing');
        document.body.style.cursor = mode === 'w' ? 'ew-resize' : (mode === 'h' ? 'ns-resize' : 'nwse-resize');
        document.body.style.userSelect = 'none';

        if (e.target && typeof e.target.setPointerCapture === 'function') {
            try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
        }

        updateTooltip(startW, startH);

        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', onPointerUp, { passive: false });
        window.addEventListener('pointercancel', onPointerUp, { passive: false });
    }

    function onPointerMove(e) {
        if (!isResizing) return;
        e.preventDefault();
        const scale = currentStageScale || 1.0;
        const deltaX = (e.clientX - startX) / scale;
        const deltaY = (e.clientY - startY) / scale;

        let newW = startW;
        let newH = startH;

        if (resizeMode === 'w' || resizeMode === 'both') {
            newW = Math.max(50, Math.min(3840, Math.round(startW + deltaX)));
        }
        if (resizeMode === 'h' || resizeMode === 'both') {
            newH = Math.max(50, Math.min(3840, Math.round(startH + deltaY)));
        }

        // Shift key locks aspect ratio
        if (e.shiftKey && resizeMode === 'both') {
            newH = Math.max(50, Math.min(3840, Math.round(newW / startAspect)));
        }

        targetW = newW;
        targetH = newH;
        updateTooltip(targetW, targetH);

        customStageWidth = targetW;
        customStageHeight = targetH;
        applyStageDimensions(targetW, targetH);
    }

    function onPointerUp(e) {
        if (!isResizing) return;
        isResizing = false;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        if (e.target && typeof e.target.releasePointerCapture === 'function') {
            try { e.target.releasePointerCapture(e.pointerId); } catch (_) {}
        }

        customStageWidth = targetW;
        customStageHeight = targetH;
        applyStageDimensions(targetW, targetH);

        const currentPlayer = window.currentPlayer;
        const rContext = currentPlayer?.getRemoteContext?.();
        if (rContext && typeof rContext.setAnimationEnabled === 'function') {
            rContext.setAnimationEnabled(true);
        }

        wrapper.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (tooltip) tooltip.style.display = 'none';

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
    }

    if (handleE) {
        handleE.addEventListener('pointerdown', (e) => startDrag(e, 'w'));
        handleE.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const currentDocument = window.currentDocument;
            const docW = currentDocument ? (typeof currentDocument.getAuthorWidth === 'function' ? currentDocument.getAuthorWidth() : (currentDocument.mHeader ? currentDocument.mHeader.mWidth : currentDocument.getWidth())) : 300;
            customStageWidth = docW;
            const d = currentDensity || 1.0;
            const curH = customStageHeight !== null ? customStageHeight : (canvas ? (parseFloat(canvas.style.height) || Math.round((canvas.height || 300) / d)) : 300);
            applyStageDimensions(docW, curH);
        });
    }

    if (handleS) {
        handleS.addEventListener('pointerdown', (e) => startDrag(e, 'h'));
        handleS.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const currentDocument = window.currentDocument;
            const docH = currentDocument ? (typeof currentDocument.getAuthorHeight === 'function' ? currentDocument.getAuthorHeight() : (currentDocument.mHeader ? currentDocument.mHeader.mHeight : currentDocument.getHeight())) : 300;
            customStageHeight = docH;
            const d = currentDensity || 1.0;
            const curW = customStageWidth !== null ? customStageWidth : (canvas ? (parseFloat(canvas.style.width) || Math.round((canvas.width || 300) / d)) : 300);
            applyStageDimensions(curW, docH);
        });
    }

    if (handleSE) {
        handleSE.addEventListener('pointerdown', (e) => startDrag(e, 'both'));
        handleSE.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            applyStagePreset('doc');
        });
    }

    const workspace = document.getElementById('stageWorkspaceContainer');
    if (workspace) {
        workspace.addEventListener('pointerdown', (e) => {
            // Unselect components and clear bounds when clicking outside the document in the preview
            if (!e.target.closest('#previewCanvas') && !e.target.closest('.stage-resize-handle')) {
                if (typeof window.selectLayoutComponent === 'function') {
                    window.selectLayoutComponent(null);
                }
            }
        });

        if (typeof ResizeObserver !== 'undefined') {
            try {
                const ro = new ResizeObserver(() => {
                    if (!isResizing) {
                        updateStageScale();
                    }
                });
                ro.observe(workspace);
            } catch (_) {}
        }
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('resize', () => {
            if (!isResizing) {
                updateStageScale();
            }
        });
    }
}

export function applyStageDimensions(w, h) {
    const d = currentDensity || 1.0;
    const pixelW = Math.round(w * d);
    const pixelH = Math.round(h * d);

    const canvas = document.getElementById('previewCanvas');
    const wrapper = document.getElementById('canvasStageWrapper');
    if (canvas) {
        canvas.width = pixelW;
        canvas.height = pixelH;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
    }
    if (wrapper) {
        wrapper.style.width = `${w}px`;
        wrapper.style.height = `${h}px`;
    }

    const wInput = document.getElementById('stageWidthInput');
    const hInput = document.getElementById('stageHeightInput');
    if (wInput && document.activeElement !== wInput) wInput.value = Math.round(w);
    if (hInput && document.activeElement !== hInput) hInput.value = Math.round(h);

    const dimEl = document.getElementById('docDimBadge');
    if (dimEl) {
        dimEl.textContent = `${formatDimensionNumber(w)}x${formatDimensionNumber(h)} dp${d !== 1.0 ? ` (${pixelW}x${pixelH} px)` : ''}`;
    }

    const stageSetupBadge = document.getElementById('stageSetupBadge');
    if (stageSetupBadge) {
        stageSetupBadge.textContent = `${Math.round(w)}×${Math.round(h)} • ${d}x`;
    }

    const currentDocument = window.currentDocument;
    const currentPlayer = window.currentPlayer;

    if (currentDocument) {
        if (typeof currentDocument.setWidth === 'function') currentDocument.setWidth(pixelW);
        if (typeof currentDocument.setHeight === 'function') currentDocument.setHeight(pixelH);
        currentDocument.mWidth = pixelW;
        currentDocument.mHeight = pixelH;
        currentDocument.mNeedsMeasure = true;
        const rootComp = typeof currentDocument.getRootLayoutComponent === 'function'
            ? currentDocument.getRootLayoutComponent()
            : currentDocument.mRootLayoutComponent;
        if (rootComp) {
            if (typeof rootComp.setWidth === 'function') rootComp.setWidth(pixelW);
            if (typeof rootComp.setHeight === 'function') rootComp.setHeight(pixelH);
            rootComp.mWidth = pixelW;
            rootComp.mHeight = pixelH;
            rootComp.mNeedsMeasure = true;
            if (typeof rootComp.invalidateMeasure === 'function') rootComp.invalidateMeasure();
        }

        const state = typeof currentDocument.getRemoteComposeState === 'function' ? currentDocument.getRemoteComposeState() : currentDocument.mRemoteComposeState;
        if (state) {
            if (typeof state.updateFloat === 'function') {
                state.updateFloat(5, pixelW);
                state.updateFloat(6, pixelH);
                state.updateFloat(7, pixelW);
                state.updateFloat(8, pixelH);
            }
            if (typeof state.overrideFloat === 'function') {
                state.overrideFloat(5, pixelW);
                state.overrideFloat(6, pixelH);
                state.overrideFloat(7, pixelW);
                state.overrideFloat(8, pixelH);
            }
        }

        if (typeof currentDocument.invalidateMeasure === 'function') {
            currentDocument.invalidateMeasure();
        }
    }

    if (currentPlayer) {
        const rContext = currentPlayer.getRemoteContext();
        if (rContext) {
            rContext.mWidth = pixelW;
            rContext.mHeight = pixelH;
            if (typeof rContext.setDensity === 'function') {
                rContext.setDensity(d);
            }
        }
        if (isPlayerPaused && stepTargetOp) {
            if (typeof window.renderFrameUpToOperation === 'function') {
                window.renderFrameUpToOperation(stepTargetOp);
            }
        } else {
            if (typeof currentPlayer.repaint === 'function') {
                currentPlayer.repaint();
            }
        }
    }

    // Sync document header dimensions in JSON Editor source text only when not interactively dragging
    if (!isResizing) {
        try {
            if (typeof window.getJsonInputValue === 'function' && typeof window.setJsonInputValue === 'function') {
                const rawJson = window.getJsonInputValue();
                if (rawJson && rawJson.trim()) {
                    const parsed = JSON.parse(rawJson);
                    if (parsed && parsed.header) {
                        const targetW = Math.round(w);
                        const targetH = Math.round(h);
                        if (parsed.header.width !== targetW || parsed.header.height !== targetH) {
                            parsed.header.width = targetW;
                            parsed.header.height = targetH;
                            window.setJsonInputValue(JSON.stringify(parsed, null, 2));
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore JSON parse errors during active user typing
        }
    }

    // Trigger live updates for Component Tree and Running Operations Tree
    if (typeof window.updateRunningTreeLive === 'function') {
        window.updateRunningTreeLive();
    }

    updateStageScale();
}

export function toggleCanvasBg() {
    const canvasEl = document.getElementById('previewCanvas');
    canvasBgWhite = !canvasBgWhite;
    if (canvasEl) canvasEl.style.background = canvasBgWhite ? '#ffffff' : '#0f172a';
}

export function evaluateLoopParams(loopOp, rContext) {
    if (!loopOp) return { from: 0, step: 1, until: 10 };
    if (typeof loopOp.getFrom === 'function' && rContext) {
        const from = loopOp.getFrom(rContext);
        const step = loopOp.getStep(rContext);
        const until = loopOp.getUntil(rContext);
        if (isFinite(from) && isFinite(step) && isFinite(until)) {
            return { from, step, until };
        }
    }
    function resolveBits(bits) {
        if (typeof bits !== 'number') return 0;
        if ((bits & 0x7F800000) === 0x7F800000 && (bits & 0x007FFFFF) !== 0) {
            const varId = bits & 0x3FFFFF;
            return rContext ? rContext.getFloat(varId) : 0;
        }
        const _dv = new DataView(new ArrayBuffer(4));
        _dv.setInt32(0, bits, false);
        return _dv.getFloat32(0, false);
    }

    const from = loopOp.mFromBits !== undefined ? resolveBits(loopOp.mFromBits) : (loopOp.mFrom ?? 0);
    const step = loopOp.mStepBits !== undefined ? resolveBits(loopOp.mStepBits) : (loopOp.mStep ?? 1);
    const until = loopOp.mUntilBits !== undefined ? resolveBits(loopOp.mUntilBits) : (loopOp.mUntil ?? 10);
    return { from, step, until };
}

export function getRunningNodeChildren(op) {
    if (!op) return [];
    const name = getOpName(op);

    // 1. RootLayoutComponent: holds top-level document components/operations
    const isRootLayout = op.constructor?.name === 'RootLayoutComponent' || op.OP_CODE === 200 || (typeof op.layoutTree === 'function' && typeof op.needsMeasure === 'function');
    if (isRootLayout) {
        if (typeof op.getList === 'function' && Array.isArray(op.getList())) {
            return op.getList().filter(c => getOpName(c) !== 'ContainerEnd');
        }
    }

    // 2. CanvasContent / LayoutComponentContent: container wrapping drawing commands
    if (name === 'CanvasContent' || name === 'LayoutComponentContent' || op.OP_CODE === 207 || op.OP_CODE === 201) {
        const list = typeof op.getList === 'function' ? (op.getList() || []) : (Array.isArray(op.mChildren) ? op.mChildren : []);
        return list.filter(c => getOpName(c) !== 'ContainerEnd');
    }

    // 3. Components: expected traversal for components is using mChildrenComponents for child components,
    // plus mComponentModifiers and mContentOps
    const isComponent = typeof op.paintingComponent === 'function' || (typeof op.getX === 'function' && typeof op.getY === 'function') || op.mChildrenComponents !== undefined;
    if (isComponent) {
        const result = [];
        if (Array.isArray(op.mComponentModifiers)) {
            for (const mod of op.mComponentModifiers) result.push(mod);
        }
        if (Array.isArray(op.mContentOps)) {
            for (const cOp of op.mContentOps) {
                if (getOpName(cOp) !== 'ContainerEnd') {
                    result.push(cOp);
                }
            }
        }
        if (Array.isArray(op.mChildrenComponents)) {
            for (const child of op.mChildrenComponents) result.push(child);
        }
        if (result.length > 0) return result;
    }

    // 4. Containers and loops
    if (typeof op.getList === 'function' && Array.isArray(op.getList())) {
        return op.getList().filter(c => getOpName(c) !== 'ContainerEnd');
    }
    if (Array.isArray(op.mChildren)) {
        return op.mChildren.filter(c => getOpName(c) !== 'ContainerEnd');
    }
    return [];
}

export function buildExecutionTrace(doc, rContext) {
    const trace = [];
    if (!doc) return trace;
    const topOps = (typeof doc.getOperations === 'function' ? doc.getOperations() : doc.mOperations) || [];

    function traverse(op, componentContext, loopInfo) {
        if (!op) return;
        const name = getOpName(op);
        if (name === 'ContainerEnd' || op.OP_CODE === 216) return;

        if (name === 'CanvasContent' || name === 'LayoutComponentContent' || op.OP_CODE === 207 || op.OP_CODE === 201) {
            const canvasOps = typeof op.getList === 'function' ? (op.getList() || []) : (Array.isArray(op.mChildren) ? op.mChildren : []);
            for (const c of canvasOps) {
                traverse(c, componentContext, loopInfo);
            }
            return;
        }

        if (name === 'LoopOperation' || op.OP_CODE === 215) {
            const { from, step, until } = evaluateLoopParams(op, rContext);
            const indexId = op.mIndexId ?? (typeof op.getIndexId === 'function' ? op.getIndexId() : 0);
            const loopChildren = getRunningNodeChildren(op);

            trace.push({
                type: 'loop_header',
                op,
                name: 'LoopOperation',
                component: componentContext,
                loopInfo: { loopOp: op, indexId, from, step, until, i: from }
            });

            if (step > 0 && isFinite(from) && isFinite(until) && isFinite(step)) {
                const maxIter = Math.min(until, from + step * 500);
                for (let i = from; i < maxIter; i += step) {
                    for (const child of loopChildren) {
                        traverse(child, componentContext, { loopOp: op, indexId, i, from, step, until });
                    }
                }
            }
            return;
        }

        const isRootLayout = op.constructor?.name === 'RootLayoutComponent' || op.OP_CODE === 200 || (typeof op.layoutTree === 'function' && typeof op.needsMeasure === 'function');
        if (isRootLayout) {
            trace.push({
                type: 'component_enter',
                op,
                name,
                component: op,
                loopInfo
            });

            const rootChildren = getRunningNodeChildren(op);
            for (const child of rootChildren) {
                traverse(child, op, loopInfo);
            }

            trace.push({
                type: 'component_exit',
                op,
                name,
                component: op,
                loopInfo
            });
            return;
        }

        const isComponent = typeof op.paintingComponent === 'function' || (typeof op.getX === 'function' && typeof op.getY === 'function') || op.mChildrenComponents !== undefined;
        if (isComponent) {
            trace.push({
                type: 'component_enter',
                op,
                name,
                component: op,
                loopInfo
            });

            if (Array.isArray(op.mComponentModifiers)) {
                for (const mod of op.mComponentModifiers) {
                    traverse(mod, op, loopInfo);
                }
            }

            if (Array.isArray(op.mContentOps)) {
                for (const cOp of op.mContentOps) {
                    traverse(cOp, op, loopInfo);
                }
            }

            if (Array.isArray(op.mChildrenComponents)) {
                for (const child of op.mChildrenComponents) {
                    traverse(child, op, loopInfo);
                }
            }

            trace.push({
                type: 'component_exit',
                op,
                name,
                component: op,
                loopInfo
            });
            return;
        }

        const children = getRunningNodeChildren(op);
        if (children.length > 0) {
            trace.push({
                type: 'op_enter',
                op,
                name,
                component: componentContext,
                loopInfo
            });
            for (const child of children) {
                traverse(child, componentContext, loopInfo);
            }
            return;
        }

        trace.push({
            type: 'op',
            op,
            name,
            component: componentContext,
            loopInfo
        });
    }

    for (const op of topOps) {
        traverse(op, null, null);
    }

    return trace;
}

export function pausePlayer() {
    if (!isPlayerPaused) {
        isPlayerPaused = true;
        const currentPlayer = window.currentPlayer;
        if (currentPlayer) currentPlayer.stop();
        const btn = document.getElementById('playPauseBtn');
        if (btn) {
            btn.innerHTML = '<span>▶️</span> <span>Play</span>';
            btn.classList.add('btn-secondary');
        }
        const stepControls = document.getElementById('stepControlsGroup');
        if (stepControls) stepControls.style.display = 'flex';
        const stepStatusPill = document.getElementById('stepStatusPill');
        if (stepStatusPill) stepStatusPill.style.display = 'inline-flex';
    }
}

export function togglePlayPause() {
    isPlayerPaused = !isPlayerPaused;
    const btn = document.getElementById('playPauseBtn');
    const stepControls = document.getElementById('stepControlsGroup');
    const stepStatusPill = document.getElementById('stepStatusPill');

    const currentPlayer = window.currentPlayer;
    const currentDocument = window.currentDocument;

    if (isPlayerPaused) {
        if (currentPlayer) {
            if (typeof currentPlayer.pause === 'function') currentPlayer.pause();
            else currentPlayer.stop();
        }
        if (btn) {
            btn.innerHTML = '<span>▶️</span> <span>Play</span>';
            btn.classList.add('btn-secondary');
        }
        if (stepControls) stepControls.style.display = 'flex';
        if (stepStatusPill) stepStatusPill.style.display = 'inline-flex';

        if (typeof window.restorePanel === 'function') window.restorePanel('pane7');

        const rContext = currentPlayer ? currentPlayer.getRemoteContext() : null;
        executionTrace = buildExecutionTrace(currentDocument, rContext);

        if (currentStepIndex < 0 || currentStepIndex >= executionTrace.length) {
            currentStepIndex = executionTrace.length - 1;
        }
        renderFrameUpToStepIndex(currentStepIndex);
    } else {
        if (btn) {
            btn.innerHTML = '<span>⏸️</span> <span>Pause</span>';
            btn.classList.remove('btn-secondary');
        }
        if (stepControls) stepControls.style.display = 'none';
        if (stepStatusPill) stepStatusPill.style.display = 'none';
        stepTargetOp = null;
        document.querySelectorAll('.running-node-content').forEach(n => n.classList.remove('step-active'));
        if (currentPlayer) {
            if (typeof currentPlayer.play === 'function') currentPlayer.play();
            else currentPlayer.repaint();
        }
    }
}

export function stepOpBackward() {
    const currentDocument = window.currentDocument;
    const currentPlayer = window.currentPlayer;
    if (executionTrace.length === 0 && currentDocument && currentPlayer) {
        executionTrace = buildExecutionTrace(currentDocument, currentPlayer.getRemoteContext());
    }
    if (executionTrace.length === 0) return;
    const nextIdx = currentStepIndex <= 0 ? executionTrace.length - 1 : currentStepIndex - 1;
    renderFrameUpToStepIndex(nextIdx);
}

export function stepOpForward() {
    const currentDocument = window.currentDocument;
    const currentPlayer = window.currentPlayer;
    if (executionTrace.length === 0 && currentDocument && currentPlayer) {
        executionTrace = buildExecutionTrace(currentDocument, currentPlayer.getRemoteContext());
    }
    if (executionTrace.length === 0) return;
    const nextIdx = currentStepIndex >= executionTrace.length - 1 ? 0 : currentStepIndex + 1;
    renderFrameUpToStepIndex(nextIdx);
}

export function resetStepToStart() {
    renderFrameUpToStepIndex(0);
}

export function stepOpToEnd() {
    const currentDocument = window.currentDocument;
    const currentPlayer = window.currentPlayer;
    if (executionTrace.length === 0 && currentDocument && currentPlayer) {
        executionTrace = buildExecutionTrace(currentDocument, currentPlayer.getRemoteContext());
    }
    if (executionTrace.length > 0) {
        renderFrameUpToStepIndex(executionTrace.length - 1);
    }
}

export function selectAndRenderStepOp(op) {
    if (!op) return;
    stepTargetOp = op;
    const currentDocument = window.currentDocument;
    const currentPlayer = window.currentPlayer;

    if (executionTrace.length === 0 && currentDocument && currentPlayer) {
        executionTrace = buildExecutionTrace(currentDocument, currentPlayer.getRemoteContext());
    }

    let foundIdx = -1;
    for (let i = executionTrace.length - 1; i >= 0; i--) {
        if (executionTrace[i].op === op) {
            foundIdx = i;
            break;
        }
    }

    if (foundIdx >= 0) {
        renderFrameUpToStepIndex(foundIdx);
    }
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function highlightStepOperation(op, stepIndex, totalSteps) {
    if (!op) return;

    const opId = typeof op.getId === 'function' ? op.getId() : (op.mId ?? null);
    const cid = typeof op.getComponentId === 'function' ? op.getComponentId() : (op.mComponentId ?? null);

    stepTargetOp = op;
    window.stepTargetOp = op;

    // 1. Update status pill
    const stepStatusPill = document.getElementById('stepStatusPill');
    if (stepStatusPill) {
        const opName = getOpName(op);
        const idText = opId !== null && opId !== undefined ? ` #${opId}` : '';
        const stepNumText = typeof stepIndex === 'number' && typeof totalSteps === 'number' ? `Step ${stepIndex + 1}/${totalSteps}: ` : '';
        stepStatusPill.innerHTML = `<span>⏸️</span> <span>${stepNumText}<strong>${escapeHtml(opName)}</strong>${idText}</span>`;
        stepStatusPill.style.display = 'inline-flex';
    }

    // 2. Highlight in Running Operations Tree (Pane 7)
    let foundNodeId = null;
    const rtRegistry = window.__rtOpRegistry;
    if (rtRegistry) {
        for (const [nodeId, regOp] of rtRegistry.entries()) {
            if (regOp === op) {
                foundNodeId = nodeId;
                break;
            }
        }
        if (!foundNodeId) {
            for (const [nodeId, regOp] of rtRegistry.entries()) {
                const rOpId = typeof regOp.getId === 'function' ? regOp.getId() : (regOp.mId ?? null);
                const rCid = typeof regOp.getComponentId === 'function' ? regOp.getComponentId() : (regOp.mComponentId ?? null);
                if (opId !== null && rOpId === opId) {
                    foundNodeId = nodeId;
                    break;
                }
                if (cid !== null && rCid === cid) {
                    foundNodeId = nodeId;
                    break;
                }
            }
        }
    }

    document.querySelectorAll('.running-node-content').forEach(n => {
        n.classList.remove('selected');
        n.classList.remove('step-active');
    });

    if (foundNodeId) {
        const nodeEl = document.querySelector(`.running-node-content[onclick*="${foundNodeId}"]`);
        if (nodeEl) {
            let parent = nodeEl.parentElement;
            while (parent && parent.id !== 'runningTreeContainer') {
                if (parent.id && parent.id.endsWith('-children')) {
                    parent.classList.remove('nested-collapsed');
                    const parentNodeId = parent.id.replace('-children', '');
                    const caret = document.querySelector(`.running-node-content[onclick*="${parentNodeId}"] .caret`);
                    if (caret) caret.classList.add('caret-down');
                }
                parent = parent.parentElement;
            }
            nodeEl.classList.add('selected');
            nodeEl.classList.add('step-active');
            nodeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // 3. Highlight in Command List (Pane 2)
    const currentParsedOps = window.currentParsedOps;
    if (currentParsedOps && currentParsedOps.length > 0) {
        const targetIdx = findMatchingCommandIndex(op, opId, currentParsedOps);
        if (targetIdx >= 0) {
            const matchedOp = currentParsedOps[targetIdx];
            const matchedOpId = getOpId(matchedOp) ?? opId ?? null;
            if (typeof window.selectCommandCard === 'function') {
                window.selectCommandCard(targetIdx, matchedOpId, { scrollTo: true });
            }
            const cmdCard = document.getElementById(`cmdCard-${targetIdx}`);
            if (cmdCard) cmdCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // 4. Highlight in Component Tree (Pane 3) if applicable
    const ctRegistry = window.__componentTreeOpRegistry;
    if (ctRegistry) {
        for (const [ctNodeId, ctOp] of ctRegistry.entries()) {
            if (ctOp === op || (opId !== null && (typeof ctOp?.getId === 'function' ? ctOp.getId() : ctOp?.mId) === opId)) {
                document.querySelectorAll('.tree-node-content:not(.running-node-content)').forEach(n => n.classList.remove('selected'));
                const ctNodeEl = document.querySelector(`.tree-node-content[onclick*="${ctNodeId}"]`);
                if (ctNodeEl) {
                    ctNodeEl.classList.add('selected');
                    ctNodeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                break;
            }
        }
    }

    // 5. Forward selection to Layout & Box Model Inspector (Pane 13)
    if (typeof window !== 'undefined' && typeof window.selectLayoutComponent === 'function') {
        window.selectLayoutComponent(op || opId);
    }

    // 6. Update Variables & State Panel (Pane 4) and Expression Dependency Graph (Pane 8)
    if (typeof window !== 'undefined' && typeof window.updateVariableValuesLive === 'function') {
        window.updateVariableValuesLive();
    }
}

export function renderFrameUpToStepIndex(targetIndex) {
    const currentDocument = window.currentDocument;
    const currentPlayer = window.currentPlayer;
    if (!currentDocument || !currentPlayer) return;
    const canvas = document.getElementById('previewCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rContext = currentPlayer.getRemoteContext();
    if (!rContext) return;
    const pContext = rContext.getPaintContext();
    if (!pContext) return;

    if (typeof currentPlayer.pause === 'function') currentPlayer.pause();
    else currentPlayer.stop();

    if (executionTrace.length === 0) {
        executionTrace = buildExecutionTrace(currentDocument, rContext);
    }
    if (executionTrace.length === 0) return;

    targetIndex = Math.max(0, Math.min(executionTrace.length - 1, targetIndex));
    currentStepIndex = targetIndex;
    const activeItem = executionTrace[targetIndex];
    stepTargetOp = activeItem.op;
    window.stepTargetOp = activeItem.op;

    // Clear canvas & reset context
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    pContext.reset();
    pContext.clearNeedsRepaint();

    let activeTheme = 1;
    if (typeof currentDocument.getTheme === 'function') {
        activeTheme = currentDocument.getTheme();
    } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        activeTheme = 2;
    }

    rContext.mRemoteComposeState = typeof currentDocument.getRemoteComposeState === 'function' ? currentDocument.getRemoteComposeState() : currentDocument.mRemoteComposeState;
    if (rContext.mRemoteComposeState) {
        rContext.mRemoteComposeState.setContext(rContext);
    }

    const rootLayout = typeof currentDocument.getRootLayoutComponent === 'function' ? currentDocument.getRootLayoutComponent() : currentDocument.mRootLayoutComponent;
    if (rootLayout) {
        rootLayout.layoutTree(rContext);
    }

    rContext.setMode(1);
    rContext.clearLastOpCount();

    const themeColors = typeof currentDocument.getThemedColors === 'function' ? currentDocument.getThemedColors() : [];
    for (const tc of themeColors) {
        if (typeof tc.setTheme === 'function') tc.setTheme(rContext, activeTheme);
    }
    rContext.setPaintTheme(activeTheme);
    rContext.setTheme(0);

    let density = rContext.getDensity();
    if (Number.isNaN(density) || density <= 0) {
        density = 1;
        rContext.setDensity(density);
    }
    rContext.loadFloat(27, density);
    if (typeof currentDocument.seedPlatformTextSize === 'function') {
        currentDocument.seedPlatformTextSize(rContext);
    }

    pContext.save();

    let targetBounds = null;

    // Execute all operations up to and including targetIndex
    for (let s = 0; s <= targetIndex; s++) {
        const item = executionTrace[s];
        const { op, type, loopInfo, component } = item;

        if (loopInfo && loopInfo.indexId !== 0) {
            rContext.loadFloat(loopInfo.indexId, loopInfo.i);
        }

        const opIsDirty = typeof op.isDirty === 'function' ? op.isDirty() : false;
        if (opIsDirty && typeof op.updateVariables === 'function') {
            if (typeof op.markNotDirty === 'function') op.markNotDirty();
            op.updateVariables(rContext);
        }
        rContext.incrementOpCount();

        if (type === 'component_enter') {
            pContext.matrixSave();
            pContext.matrixTranslate(op.getX(), op.getY());
        } else if (type === 'component_exit') {
            pContext.matrixRestore();
        } else if (type === 'modifier') {
            if (op.constructor?.name === 'PaddingModifier' || op.mLeftValue !== undefined) {
                pContext.matrixTranslate(op.mLeftValue || 0, op.mTopValue || 0);
            } else if (typeof op.apply === 'function') {
                op.apply(rContext);
            }
        } else if (type === 'draw_op') {
            if (typeof op.paint === 'function') {
                op.paint(pContext);
            } else if (typeof op.apply === 'function') {
                op.apply(rContext);
            }
        } else if (type !== 'loop_header') {
            if (typeof op.paint === 'function') {
                op.paint(pContext);
            } else if (typeof op.apply === 'function') {
                op.apply(rContext);
            }
        }

        if (s === targetIndex) {
            if (component && typeof component.getX === 'function' && component.getWidth() > 0) {
                targetBounds = { x: component.getX(), y: component.getY(), w: component.getWidth(), h: component.getHeight() };
            } else if (typeof op.getWidth === 'function' && op.getWidth() > 0) {
                targetBounds = { x: op.getX(), y: op.getY(), w: op.getWidth(), h: op.getHeight() };
            } else if (op.mX1 !== undefined && op.mX2 !== undefined) {
                targetBounds = { x: Math.min(op.mX1, op.mX2), y: Math.min(op.mY1, op.mY2), w: Math.abs(op.mX2 - op.mX1) || 20, h: Math.abs(op.mY2 - op.mY1) || 20 };
            }
        }
    }

    pContext.restore();
    rContext.setMode(0);

    if (targetBounds && targetBounds.w > 0 && targetBounds.h > 0) {
        ctx.save();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(targetBounds.x, targetBounds.y, targetBounds.w, targetBounds.h);
        ctx.restore();
    }

    // Highlight active operation in Running Tree, Command List, and Status Pill
    highlightStepOperation(activeItem.op, targetIndex, executionTrace.length);
}

// Window attachments for HTML controls
window.setCustomStageSize = setCustomStageSize;
window.applyStagePreset = applyStagePreset;
window.applyDensity = applyDensity;
window.onDensitySelectChange = onDensitySelectChange;
window.onCustomDensityInput = onCustomDensityInput;
window.initStageLiveResize = initStageLiveResize;
window.applyStageDimensions = applyStageDimensions;
window.toggleCanvasBg = toggleCanvasBg;
window.togglePlayPause = togglePlayPause;
window.stepOpBackward = stepOpBackward;
window.stepOpForward = stepOpForward;
window.resetStepToStart = resetStepToStart;
window.stepOpToEnd = stepOpToEnd;
window.selectAndRenderStepOp = selectAndRenderStepOp;
window.renderFrameUpToOperation = selectAndRenderStepOp;
window.highlightStepOperation = highlightStepOperation;
window.renderFrameUpToStepIndex = renderFrameUpToStepIndex;
window.evaluateLoopParams = evaluateLoopParams;
window.getRunningNodeChildren = getRunningNodeChildren;
window.buildExecutionTrace = buildExecutionTrace;
