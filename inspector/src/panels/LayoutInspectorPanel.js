// =========================================================================
// Panel 13: Layout & Box Model Inspector
// Modularized in src/panels/LayoutInspectorPanel.js
// Provides deep layout diagnostics, interactive visual box model diagrams
// (Margin -> Border -> Padding -> Content), modifier execution pipeline
// inspection, constraint linting, on-canvas layout bounds overlays, and live sandbox tweaks.
// =========================================================================

import { getOpName, getOpId, isContainerOp, isModifierOp, isComponentOp, getEffectiveChildren, selectCommandCard, findMatchingCommandIndex, getCoreTextParameters, getLayoutAlignmentInfo } from './CommandListPanel.js';
import { formatDimensionNumber, currentDensity } from './StagePanel.js';
import { getComponentIcon, getVisibilityInfo, __componentTreeOpRegistry, __rtOpRegistry, expandTreeAncestors } from './ComponentTreePanel.js';

let selectedComponentKey = null;
let showLayoutBoundsOverlay = false;
let cachedLayoutComponents = [];
let activeTweaks = new Map(); // compKey -> { width, height, padding, cornerRadius, align }

export function getSelectedComponentKey() {
    return selectedComponentKey;
}

export function getShowLayoutBoundsOverlay() {
    return showLayoutBoundsOverlay;
}

export function getCachedLayoutComponents() {
    return cachedLayoutComponents;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function getSafeFloat(val, fallback = 0) {
    if (typeof val !== 'number' || Number.isNaN(val) || !isFinite(val)) return fallback;
    if (val > 50000 || val < -50000) return fallback; // Variable ID or NaN-boxed integer
    return val;
}

export function getComponentPadding(op) {
    if (!op) return { left: 0, top: 0, right: 0, bottom: 0 };
    let pl = getSafeFloat(typeof op.getPaddingLeft === 'function' ? op.getPaddingLeft() : op.mPaddingLeft);
    let pt = getSafeFloat(typeof op.getPaddingTop === 'function' ? op.getPaddingTop() : op.mPaddingTop);
    let pr = getSafeFloat(typeof op.getPaddingRight === 'function' ? op.getPaddingRight() : op.mPaddingRight);
    let pb = getSafeFloat(typeof op.getPaddingBottom === 'function' ? op.getPaddingBottom() : op.mPaddingBottom);

    const rawChildren = getEffectiveChildren(op) || [];
    rawChildren.forEach(child => {
        if (isModifierOp(child)) {
            const modName = getOpName(child);
            if (modName.includes('Padding')) {
                const l = getSafeFloat(typeof child.getLeft === 'function' ? child.getLeft() : (child.mLeftValue ?? child.mLeft));
                const t = getSafeFloat(typeof child.getTop === 'function' ? child.getTop() : (child.mTopValue ?? child.mTop));
                const r = getSafeFloat(typeof child.getRight === 'function' ? child.getRight() : (child.mRightValue ?? child.mRight));
                const b = getSafeFloat(typeof child.getBottom === 'function' ? child.getBottom() : (child.mBottomValue ?? child.mBottom));
                pl = Math.max(pl, l);
                pt = Math.max(pt, t);
                pr = Math.max(pr, r);
                pb = Math.max(pb, b);
            }
        }
    });

    return { left: pl, top: pt, right: pr, bottom: pb };
}

export function getComponentGlobalPosition(op) {
    let gx = 0, gy = 0;
    let curr = op;
    while (curr) {
        const x = getSafeFloat(typeof curr.getX === 'function' ? curr.getX() : curr.mX);
        const y = getSafeFloat(typeof curr.getY === 'function' ? curr.getY() : curr.mY);
        gx += x;
        gy += y;
        const parent = curr.mParent || (typeof curr.getParent === 'function' ? curr.getParent() : null);
        if (parent) {
            let pl = getSafeFloat(typeof parent.getPaddingLeft === 'function' ? parent.getPaddingLeft() : parent.mPaddingLeft);
            let pt = getSafeFloat(typeof parent.getPaddingTop === 'function' ? parent.getPaddingTop() : parent.mPaddingTop);
            if (pl === 0 && pt === 0) {
                const pad = getComponentPadding(parent);
                pl = pad.left;
                pt = pad.top;
            }
            const sx = getSafeFloat(typeof parent.getScrollX === 'function' ? parent.getScrollX() : parent.mScrollX);
            const sy = getSafeFloat(typeof parent.getScrollY === 'function' ? parent.getScrollY() : parent.mScrollY);
            gx += pl + sx;
            gy += pt + sy;
        }
        curr = parent;
    }
    return { gx, gy };
}

/**
 * Recursively extracts all layout components and their geometry from the document.
 */
export function extractLayoutComponents(doc) {
    const list = [];
    if (!doc) return list;

    const rootLayout = typeof doc.getRootLayoutComponent === 'function' ? doc.getRootLayoutComponent() : doc.mRootLayoutComponent;
    const topOps = (typeof doc.getOperations === 'function' ? doc.getOperations() : doc.mOperations) || [];

    let counter = 0;

    function walk(op, depth, parentKey = null, parentX = 0, parentY = 0) {
        if (!op) return;
        const name = getOpName(op);
        if (name === 'ContainerEnd' || name === 'Mi' || op.OP_CODE === 214 ||
            name === 'LayoutComponentContent' || op.OP_CODE === 201 ||
            name === 'CanvasContent' || op.OP_CODE === 207) return;

        const isContainer = isContainerOp(op);
        const isComponent = isComponentOp(op);
        const hasLayoutProps = typeof op.getWidth === 'function' || op.mWidth !== undefined || isContainer || isComponent;

        if (hasLayoutProps || isContainer || isComponent) {
            const key = `comp_${++counter}`;
            const id = typeof op.getId === 'function' ? op.getId() : (op.mId ?? null);
            const cid = typeof op.getComponentId === 'function' ? op.getComponentId() : (op.mComponentId ?? null);

            // Local coordinates & dimensions (in dp)
            const localX = getSafeFloat(typeof op.getX === 'function' ? op.getX() : op.mX);
            const localY = getSafeFloat(typeof op.getY === 'function' ? op.getY() : op.mY);
            const width = getSafeFloat(typeof op.getWidth === 'function' ? op.getWidth() : op.mWidth);
            const height = getSafeFloat(typeof op.getHeight === 'function' ? op.getHeight() : op.mHeight);

            // Extract modifiers & child nodes
            const rawChildren = getEffectiveChildren(op) || [];
            const modifiers = [];
            const childComponents = [];
            const drawOps = [];

            const padding = getComponentPadding(op);
            let paddingLeft = padding.left;
            let paddingTop = padding.top;
            let paddingRight = padding.right;
            let paddingBottom = padding.bottom;

            let marginLeft = getSafeFloat(op.mMarginLeft);
            let marginTop = getSafeFloat(op.mMarginTop);
            let marginRight = getSafeFloat(op.mMarginRight);
            let marginBottom = getSafeFloat(op.mMarginBottom);

            let borderWidth = getSafeFloat(op.mBorderWidth);
            let borderColor = op.mBorderColor ?? null;
            let cornerRadius = getSafeFloat(op.mCornerRadius);
            let isClickable = false;
            let isScrollable = false;
            let alignment = op.mAlignment || op.mHorizontalAlignment || op.mVerticalAlignment || null;

            rawChildren.forEach(child => {
                if (isModifierOp(child)) {
                    const modName = getOpName(child);
                    const modDesc = typeof child.deepToString === 'function' ? child.deepToString('') : '';
                    modifiers.push({ op: child, name: modName, desc: modDesc });

                    if (modName.includes('Margin')) {
                        const l = getSafeFloat(typeof child.getLeft === 'function' ? child.getLeft() : (child.mLeftValue ?? child.mLeft ?? child.mMarginLeft));
                        const t = getSafeFloat(typeof child.getTop === 'function' ? child.getTop() : (child.mTopValue ?? child.mTop ?? child.mMarginTop));
                        const r = getSafeFloat(typeof child.getRight === 'function' ? child.getRight() : (child.mRightValue ?? child.mRight ?? child.mMarginRight));
                        const b = getSafeFloat(typeof child.getBottom === 'function' ? child.getBottom() : (child.mBottomValue ?? child.mBottom ?? child.mMarginBottom));
                        marginLeft = Math.max(marginLeft, l);
                        marginTop = Math.max(marginTop, t);
                        marginRight = Math.max(marginRight, r);
                        marginBottom = Math.max(marginBottom, b);
                    }
                    if (modName.includes('Border')) {
                        borderWidth = Math.max(borderWidth, getSafeFloat(child.mWidth ?? child.mBorderWidth ?? 1));
                        borderColor = child.mColor ?? child.mBorderColor ?? borderColor;
                        cornerRadius = Math.max(cornerRadius, getSafeFloat(child.mRadius ?? child.mCornerRadius));
                    }
                    if (modName.includes('Clip')) {
                        cornerRadius = Math.max(cornerRadius, getSafeFloat(child.mRadius ?? child.mCornerRadius));
                    }
                    if (modName.includes('Click') || modName.includes('Touch')) {
                        isClickable = true;
                    }
                    if (modName.includes('Scroll')) {
                        isScrollable = true;
                    }
                } else if (isContainerOp(child) || isComponentOp(child)) {
                    childComponents.push(child);
                } else {
                    drawOps.push(child);
                }
            });

            // Computed global position
            const pos = getComponentGlobalPosition(op);
            const globalX = (op.mParent || typeof op.getParent === 'function') ? pos.gx : parentX + localX;
            const globalY = (op.mParent || typeof op.getParent === 'function') ? pos.gy : parentY + localY;

            // Text or image metadata
            const text = op.mText || (op.mTextId && doc.getText ? doc.getText(op.mTextId) : null);
            const imageId = op.mImageId ?? op.imageId ?? op.mBitmapId ?? null;

            // Layout alignment & positioning metadata
            const alignInfo = getLayoutAlignmentInfo(op);
            const horizontalAlignment = alignInfo ? alignInfo.hName : null;
            const verticalAlignment = alignInfo ? alignInfo.vName : null;
            const spacing = alignInfo ? alignInfo.spacedBy : null;

            const compData = {
                key,
                op,
                name,
                id,
                cid,
                depth,
                parentKey,
                localX,
                localY,
                globalX,
                globalY,
                width,
                height,
                padding: { top: paddingTop, right: paddingRight, bottom: paddingBottom, left: paddingLeft },
                margin: { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
                border: { width: borderWidth, color: borderColor, radius: cornerRadius },
                isClickable,
                isScrollable,
                alignment,
                horizontalAlignment,
                verticalAlignment,
                spacing,
                modifiers,
                childCount: childComponents.length,
                drawOpCount: drawOps.length,
                text,
                imageId
            };

            list.push(compData);

            childComponents.forEach(child => {
                walk(child, depth + 1, key, globalX + paddingLeft, globalY + paddingTop);
            });
        } else if (typeof op.getList === 'function') {
            const children = getEffectiveChildren(op);
            children.forEach(c => walk(c, depth, parentKey, parentX, parentY));
        }
    }

    if (rootLayout) {
        walk(rootLayout, 0, null, 0, 0);
    } else {
        topOps.forEach(op => {
            if (isContainerOp(op) || isComponentOp(op)) walk(op, 0, null, 0, 0);
        });
    }

    return list;
}

/**
 * Runs layout diagnostics to detect common layout bugs and anti-patterns.
 */
export function runLayoutDiagnostics(components) {
    const issues = [];
    if (!components || components.length === 0) return issues;

    components.forEach(c => {
        // 1. Zero-Size / Collapsed Component Warning
        if (c.width <= 0 || c.height <= 0) {
            issues.push({
                severity: 'warning',
                type: 'zero_size',
                compKey: c.key,
                compName: c.name,
                id: c.id,
                title: `Zero Dimensions (${c.width}×${c.height} dp)`,
                message: `${c.name} #${c.id ?? c.key} has 0 width or height. It will not be visible on screen unless given fixed or wrap-content constraints.`
            });
        }

        // 2. Small Touch Target Accessibility Warning (< 48x48 dp)
        if (c.isClickable && (c.width < 48 || c.height < 48)) {
            issues.push({
                severity: 'info',
                type: 'touch_target',
                compKey: c.key,
                compName: c.name,
                id: c.id,
                title: `Touch Target < 48dp (${Math.round(c.width)}×${Math.round(c.height)} dp)`,
                message: `Clickable element ${c.name} #${c.id ?? c.key} is smaller than the recommended 48×48dp minimum accessible touch target.`
            });
        }

        // 3. Deep Nesting Warning (> 8 levels)
        if (c.depth > 8) {
            issues.push({
                severity: 'warning',
                type: 'deep_nesting',
                compKey: c.key,
                compName: c.name,
                id: c.id,
                title: `Deep Nesting (Depth ${c.depth})`,
                message: `${c.name} is nested ${c.depth} levels deep. Deep layout trees increase measure/layout pass overhead.`
            });
        }

        // 4. Empty Container Warning
        if (c.childCount === 0 && c.drawOpCount === 0 && !c.text && !c.imageId) {
            issues.push({
                severity: 'info',
                type: 'empty_container',
                compKey: c.key,
                compName: c.name,
                id: c.id,
                title: `Empty Container`,
                message: `${c.name} #${c.id ?? c.key} contains no child components or drawing operations.`
            });
        }
    });

    return issues;
}

/**
 * Renders the Box Model Diagram (Margin -> Border -> Padding -> Content)
 */
export function renderBoxModelDiagram(comp, density = 1.0) {
    if (!comp) {
        return `
            <div style="text-align:center; padding:32px 16px; color:var(--text-muted); font-size:0.85rem;">
                Select a layout component above to inspect its box model.
            </div>
        `;
    }

    const m = comp.margin || { top: 0, right: 0, bottom: 0, left: 0 };
    const p = comp.padding || { top: 0, right: 0, bottom: 0, left: 0 };
    const b = comp.border || { width: 0, radius: 0 };

    const wDp = Math.max(0, comp.width);
    const hDp = Math.max(0, comp.height);
    const contentWDp = Math.max(0, wDp - p.left - p.right);
    const contentHDp = Math.max(0, hDp - p.top - p.bottom);

    const wPx = Math.round(wDp * density);
    const hPx = Math.round(hDp * density);
    const contentWPx = Math.round(contentWDp * density);
    const contentHPx = Math.round(contentHDp * density);

    return `
        <div class="box-model-container">
            <!-- Margin Layer (Outer / Orange) -->
            <div class="box-model-layer box-model-margin">
                <div class="box-model-label">margin</div>
                <div class="box-model-val-top">${formatDimensionNumber(m.top)}</div>
                <div class="box-model-val-left">${formatDimensionNumber(m.left)}</div>
                <div class="box-model-val-right">${formatDimensionNumber(m.right)}</div>
                <div class="box-model-val-bottom">${formatDimensionNumber(m.bottom)}</div>

                <!-- Border Layer (Amber) -->
                <div class="box-model-layer box-model-border">
                    <div class="box-model-label">border ${b.width > 0 ? `(${b.width}dp${b.radius > 0 ? `, r:${b.radius}` : ''})` : ''}</div>
                    
                    <!-- Padding Layer (Green) -->
                    <div class="box-model-layer box-model-padding">
                        <div class="box-model-label">padding</div>
                        <div class="box-model-val-top">${formatDimensionNumber(p.top)}</div>
                        <div class="box-model-val-left">${formatDimensionNumber(p.left)}</div>
                        <div class="box-model-val-right">${formatDimensionNumber(p.right)}</div>
                        <div class="box-model-val-bottom">${formatDimensionNumber(p.bottom)}</div>

                        <!-- Content Layer (Sky Blue) -->
                        <div class="box-model-layer box-model-content">
                            <div style="font-weight:700; color:#38bdf8; font-size:0.85rem;">
                                ${formatDimensionNumber(contentWDp)} × ${formatDimensionNumber(contentHDp)} <span style="font-size:0.7rem; opacity:0.8;">dp</span>
                            </div>
                            <div style="font-size:0.7rem; color:var(--text-muted);">
                                (${contentWPx} × ${contentHPx} px)
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding:6px 12px; background:rgba(0,0,0,0.2); border-radius:6px; font-size:0.75rem;">
            <span style="color:var(--text-secondary);">Total Bounds:</span>
            <span style="font-family:var(--code-font); font-weight:600; color:var(--text-primary);">
                ${formatDimensionNumber(wDp)} × ${formatDimensionNumber(hDp)} dp <span style="color:var(--text-muted);">(${wPx}×${hPx} px)</span>
            </span>
            <span style="color:var(--text-secondary);">Pos:</span>
            <span style="font-family:var(--code-font); color:var(--accent-emerald);">
                (${formatDimensionNumber(comp.localX)}, ${formatDimensionNumber(comp.localY)}) dp
            </span>
        </div>
    `;
}

export const DIMENSION_MODIFIER_TYPES = {
    0: { name: 'EXACT', label: 'EXACT (0)', unit: 'px', desc: 'Fixed size in raw pixels / points' },
    1: { name: 'FILL', label: 'FILL (1)', unit: 'fraction', desc: 'Fill available parent space (fillMaxWidth / fillMaxHeight, fraction in value)' },
    2: { name: 'WRAP', label: 'WRAP (2)', unit: '', desc: 'Wrap content to intrinsic child size (wrapContentWidth / wrapContentHeight)' },
    3: { name: 'WEIGHT', label: 'WEIGHT (3)', unit: 'weight', desc: 'Proportional flex weight distribution in Row / Column (Modifier.weight)' },
    4: { name: 'INTRINSIC_MIN', label: 'INTRINSIC_MIN (4)', unit: '', desc: 'Minimum intrinsic size of child content' },
    5: { name: 'INTRINSIC_MAX', label: 'INTRINSIC_MAX (5)', unit: '', desc: 'Maximum intrinsic size of child content' },
    6: { name: 'EXACT_DP', label: 'EXACT_DP (6)', unit: 'dp', desc: 'Fixed size in density-independent pixels (dp)' },
    7: { name: 'FILL_PARENT_MAX_WIDTH', label: 'FILL_PARENT_MAX_WIDTH (7)', unit: '', desc: 'Fill to parent container\'s maximum width constraint' },
    8: { name: 'FILL_PARENT_MAX_HEIGHT', label: 'FILL_PARENT_MAX_HEIGHT (8)', unit: '', desc: 'Fill to parent container\'s maximum height constraint' }
};

/**
 * Renders the Step-by-Step Modifier Execution Chain.
 */
export function renderModifierChain(comp) {
    if (!comp || !comp.modifiers || comp.modifiers.length === 0) {
        return `
            <div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">
                No modifiers attached to ${comp ? comp.name : 'this component'}.
            </div>
        `;
    }

    let html = `
        <div style="display:flex; flex-direction:column; gap:6px;">
    `;

    comp.modifiers.forEach((m, idx) => {
        let icon = '🎨';
        let badgeColor = '#94a3b8';
        let role = 'Visual';
        const isDimMod = m.name.includes('Width') || m.name.includes('Height') || m.name.includes('Size') || m.name.includes('Dimension') || m.name.includes('Weight') || m.op?.OP_CODE === 16 || m.op?.OP_CODE === 67;

        if (m.name.includes('Padding') || m.name.includes('Margin')) {
            icon = '🏷️';
            badgeColor = '#34d399';
            role = 'Spacing / Inset';
        } else if (isDimMod) {
            icon = '📏';
            badgeColor = '#38bdf8';
            role = 'Constraints';
        } else if (m.name.includes('Clip') || m.name.includes('Border') || m.name.includes('Shape')) {
            icon = '✂️';
            badgeColor = '#fbbf24';
            role = 'Clip / Geometry';
        } else if (m.name.includes('Click') || m.name.includes('Touch') || m.name.includes('Ripple')) {
            icon = '👆';
            badgeColor = '#f43f5e';
            role = 'Interaction';
        } else if (m.name.includes('Scroll')) {
            icon = '📜';
            badgeColor = '#c084fc';
            role = 'Scrollable';
        }

        const isWidthOrHeight = m.name === 'WidthModifier' || m.name === 'HeightModifier' || m.name === 'WidthModifierOperation' || m.name === 'HeightModifierOperation' || m.op?.OP_CODE === 16 || m.op?.OP_CODE === 67;

        let interactiveEditorHtml = '';
        if (isWidthOrHeight && m.op) {
            const modType = m.op.mType ?? m.op.type ?? 0;
            const modRawVal = typeof m.op.mOutValue === 'number' ? m.op.mOutValue : (typeof m.op.mValue === 'number' ? m.op.mValue : 0);
            const modVal = isNaN(modRawVal) ? (modType === 1 ? 1 : 0) : modRawVal;
            const typeInfo = DIMENSION_MODIFIER_TYPES[modType] || { name: `TYPE_${modType}`, label: `Type ${modType}`, unit: '', desc: '' };

            interactiveEditorHtml = `
                <div style="margin-top:6px; padding:8px 10px; background:rgba(0,0,0,0.25); border-radius:6px; border:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; gap:6px;">
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px 10px;">
                        <div>
                            <label for="tweakModType_${idx}" style="color:var(--text-secondary); font-size:0.68rem; font-weight:700; text-transform:uppercase; display:block; margin-bottom:2px;">Constraint Mode (Enum)</label>
                            <select id="tweakModType_${idx}" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.72rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyModifierTweaks(${idx})">
                                ${Object.entries(DIMENSION_MODIFIER_TYPES).map(([k, v]) => `
                                    <option value="${k}" ${parseInt(k, 10) === modType ? 'selected' : ''}>${v.label} - ${v.name}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div>
                            <label for="tweakModValue_${idx}" style="color:var(--text-secondary); font-size:0.68rem; font-weight:700; text-transform:uppercase; display:block; margin-bottom:2px;">Value (${typeInfo.unit || 'val'})</label>
                            <input id="tweakModValue_${idx}" type="number" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.72rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" value="${Math.round(modVal * 100) / 100}" step="${modType === 1 ? '0.05' : '1'}" oninput="applyModifierTweaks(${idx})" />
                        </div>
                    </div>
                    <div style="font-size:0.68rem; color:var(--accent-blue); padding:3px 6px; background:rgba(56,189,248,0.06); border-radius:4px; border:1px solid rgba(56,189,248,0.12);">
                        💡 <strong>${typeInfo.name}:</strong> ${typeInfo.desc}
                    </div>
                </div>
            `;
        }

        html += `
            <div style="display:flex; flex-direction:column; gap:4px; padding:6px 10px; background:rgba(255,255,255,0.03); border:1px solid var(--border-color); border-radius:6px; font-size:0.75rem;">
                <div style="display:flex; align-items:flex-start; gap:8px;">
                    <span style="font-weight:700; color:var(--text-muted); font-family:var(--code-font); min-width:20px;">#${idx + 1}</span>
                    <span style="font-size:0.9rem;">${icon}</span>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                            <strong style="color:var(--text-primary);">${escapeHtml(m.name)}</strong>
                            <div style="display:flex; gap:4px; align-items:center;">
                                ${isWidthOrHeight ? `<span class="badge" style="font-size:0.65rem; background:rgba(56,189,248,0.15); color:var(--accent-blue);">⚡ Live</span>` : ''}
                                <span class="badge" style="background:${badgeColor}20; color:${badgeColor}; font-size:0.65rem;">${role}</span>
                            </div>
                        </div>
                        ${m.desc ? `<div style="font-family:var(--code-font); font-size:0.7rem; color:var(--text-secondary); word-break:break-all;">${escapeHtml(m.desc)}</div>` : ''}
                    </div>
                </div>
                ${interactiveEditorHtml}
            </div>
        `;
    });

    html += `</div>`;
    return html;
}

export function floatToIntBits(f) {
    const buf = new ArrayBuffer(4);
    new Float32Array(buf)[0] = f;
    return new Int32Array(buf)[0];
}

export function intBitsToFloat(b) {
    const buf = new ArrayBuffer(4);
    new Int32Array(buf)[0] = b;
    return new Float32Array(buf)[0];
}

export function argbHexToRgbHex(hex) {
    if (!hex) return '#000000';
    const clean = hex.replace(/^#/, '');
    if (clean.length === 8) {
        return '#' + clean.substring(2);
    }
    if (clean.length === 6) {
        return '#' + clean;
    }
    return '#000000';
}

/**
 * Renders dedicated WidthModifier & HeightModifier constraint section with enum guide
 */
export function renderDimensionModifiersInspectorSection(selectedComp) {
    if (!selectedComp || !selectedComp.op) return '';

    const widthMod = selectedComp.modifiers?.find(m => m.name === 'WidthModifier' || m.op?.OP_CODE === 16 || m.name === 'WidthModifierOperation');
    const heightMod = selectedComp.modifiers?.find(m => m.name === 'HeightModifier' || m.op?.OP_CODE === 67 || m.name === 'HeightModifierOperation');

    const wType = widthMod?.op ? (widthMod.op.mType ?? widthMod.op.type ?? 6) : 6;
    const wVal = widthMod?.op ? (typeof widthMod.op.mOutValue === 'number' ? widthMod.op.mOutValue : (typeof widthMod.op.mValue === 'number' ? widthMod.op.mValue : selectedComp.width)) : selectedComp.width;
    const wInfo = DIMENSION_MODIFIER_TYPES[wType] || DIMENSION_MODIFIER_TYPES[6];

    const hType = heightMod?.op ? (heightMod.op.mType ?? heightMod.op.type ?? 6) : 6;
    const hVal = heightMod?.op ? (typeof heightMod.op.mOutValue === 'number' ? heightMod.op.mOutValue : (typeof heightMod.op.mValue === 'number' ? heightMod.op.mValue : selectedComp.height)) : selectedComp.height;
    const hInfo = DIMENSION_MODIFIER_TYPES[hType] || DIMENSION_MODIFIER_TYPES[6];

    return `
        <div style="background:var(--bg-card); border:1px solid var(--border-color); border-left:3px solid var(--accent-blue); border-radius:8px; padding:12px;">
            <div style="font-weight:700; font-size:0.8rem; color:var(--accent-blue); margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span>📏</span> Dimension Modifiers (WidthModifier &amp; HeightModifier)
                </div>
                <span class="badge" style="background:rgba(59,130,246,0.15); color:var(--accent-blue); font-size:0.68rem; font-family:var(--code-font);">⚡ Live Editable</span>
            </div>

            <!-- Width & Height Live Controls -->
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
                <!-- Width Modifier Card -->
                <div style="background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.04);">
                    <div style="font-weight:700; font-size:0.72rem; color:var(--accent-blue); text-transform:uppercase; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                        <span>↔ WidthModifier (Op 16)</span>
                        <span class="badge" style="font-size:0.65rem; background:rgba(56,189,248,0.15); color:var(--accent-blue);">${wInfo.name} (${wType})</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <div>
                            <label for="tweakDimType_width" style="color:var(--text-secondary); font-size:0.68rem; font-weight:700; text-transform:uppercase; display:block; margin-bottom:2px;">Constraint Mode</label>
                            <select id="tweakDimType_width" class="dim-input" style="width:100%; padding:4px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyDimensionTweaks('width')">
                                ${Object.entries(DIMENSION_MODIFIER_TYPES).map(([k, v]) => `
                                    <option value="${k}" ${parseInt(k, 10) === wType ? 'selected' : ''}>${v.label} - ${v.name}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div>
                            <label for="tweakDimValue_width" style="color:var(--text-secondary); font-size:0.68rem; font-weight:700; text-transform:uppercase; display:block; margin-bottom:2px;">Value (${wInfo.unit || 'value'})</label>
                            <input id="tweakDimValue_width" type="number" class="dim-input" style="width:100%; padding:4px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" value="${Math.round(wVal * 100) / 100}" step="${wType === 1 ? '0.05' : '1'}" oninput="applyDimensionTweaks('width')" />
                        </div>
                        <div style="font-size:0.68rem; color:var(--accent-blue); padding:3px 6px; background:rgba(56,189,248,0.06); border-radius:4px; border:1px solid rgba(56,189,248,0.12);">
                            💡 <strong>${wInfo.name}:</strong> ${wInfo.desc}
                        </div>
                    </div>
                </div>

                <!-- Height Modifier Card -->
                <div style="background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.04);">
                    <div style="font-weight:700; font-size:0.72rem; color:var(--accent-purple); text-transform:uppercase; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                        <span>↕ HeightModifier (Op 67)</span>
                        <span class="badge" style="font-size:0.65rem; background:rgba(168,85,247,0.15); color:var(--accent-purple);">${hInfo.name} (${hType})</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <div>
                            <label for="tweakDimType_height" style="color:var(--text-secondary); font-size:0.68rem; font-weight:700; text-transform:uppercase; display:block; margin-bottom:2px;">Constraint Mode</label>
                            <select id="tweakDimType_height" class="dim-input" style="width:100%; padding:4px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyDimensionTweaks('height')">
                                ${Object.entries(DIMENSION_MODIFIER_TYPES).map(([k, v]) => `
                                    <option value="${k}" ${parseInt(k, 10) === hType ? 'selected' : ''}>${v.label} - ${v.name}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div>
                            <label for="tweakDimValue_height" style="color:var(--text-secondary); font-size:0.68rem; font-weight:700; text-transform:uppercase; display:block; margin-bottom:2px;">Value (${hInfo.unit || 'value'})</label>
                            <input id="tweakDimValue_height" type="number" class="dim-input" style="width:100%; padding:4px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" value="${Math.round(hVal * 100) / 100}" step="${hType === 1 ? '0.05' : '1'}" oninput="applyDimensionTweaks('height')" />
                        </div>
                        <div style="font-size:0.68rem; color:var(--accent-purple); padding:3px 6px; background:rgba(168,85,247,0.06); border-radius:4px; border:1px solid rgba(168,85,247,0.12);">
                            💡 <strong>${hInfo.name}:</strong> ${hInfo.desc}
                        </div>
                    </div>
                </div>
            </div>

            <!-- Enum Reference Cheat-Sheet Guide -->
            <details style="background:rgba(0,0,0,0.15); border-radius:6px; border:1px solid var(--border-color); font-size:0.72rem;">
                <summary style="padding:6px 10px; cursor:pointer; font-weight:600; color:var(--text-secondary); display:flex; align-items:center; gap:6px;">
                    <span>📖</span> Dimension Modifier Enum Values Reference (0–8)
                </summary>
                <div style="padding:8px 10px; display:flex; flex-direction:column; gap:4px; border-top:1px solid var(--border-color);">
                    <div style="display:grid; grid-template-columns: 80px 140px 1fr; gap:6px; font-weight:700; color:var(--text-muted); padding-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.06);">
                        <span>Value</span>
                        <span>Name</span>
                        <span>Description &amp; Compose Equivalent</span>
                    </div>
                    ${Object.entries(DIMENSION_MODIFIER_TYPES).map(([k, v]) => `
                        <div style="display:grid; grid-template-columns: 80px 140px 1fr; gap:6px; align-items:center; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.02);">
                            <span class="badge" style="background:rgba(255,255,255,0.06); font-family:var(--code-font); font-size:0.65rem;">Enum ${k}</span>
                            <strong style="color:var(--text-primary); font-family:var(--code-font); font-size:0.7rem;">${v.name}</strong>
                            <span style="color:var(--text-secondary); font-size:0.7rem;">${v.desc}</span>
                        </div>
                    `).join('')}
                </div>
            </details>
        </div>
    `;
}

/**
 * Renders dedicated CoreText typography and attribute dashboard in Layout Inspector
 */
export function renderCoreTextInspectorSection(selectedComp) {
    if (!selectedComp || !selectedComp.op) return '';
    const name = selectedComp.name;
    const isTextOp = name === 'CoreText' || name === 'TextLayout' || selectedComp.op.mTextId !== undefined || selectedComp.op.OP_CODE === 239 || selectedComp.op.OP_CODE === 208;
    if (!isTextOp) return '';

    const currentDoc = typeof window !== 'undefined' ? window.currentDocument : null;
    const params = getCoreTextParameters(selectedComp.op, currentDoc);
    if (!params) return '';

    const escapeHtml = typeof window !== 'undefined' && typeof window.escapeHtml === 'function' ? window.escapeHtml : (s => String(s));

    return `
        <div style="background:var(--bg-card); border:1px solid var(--border-color); border-left:3px solid var(--accent-blue); border-radius:8px; padding:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <div style="font-weight:700; font-size:0.8rem; color:var(--accent-blue); display:flex; align-items:center; gap:6px;">
                    <span>🔤</span> CoreText Typography &amp; Parameters
                </div>
                <div style="display:flex; gap:4px; align-items:center;">
                    ${params.textId !== -1 ? `<span class="badge" style="font-size:0.65rem; background:rgba(234,179,8,0.15); color:var(--accent-amber);">Text ID: ${params.textId}</span>` : ''}
                    <span class="badge" style="font-size:0.65rem; background:rgba(16,185,129,0.15); color:var(--accent-emerald);">⚡ Live Editable</span>
                </div>
            </div>

            <!-- Text Content Banner & Live Edit Input -->
            <div style="background:rgba(0,0,0,0.3); border-radius:6px; padding:8px 10px; margin-bottom:10px; border:1px solid rgba(255,255,255,0.06);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-size:0.68rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Text String Content</span>
                    <span style="font-size:0.68rem; color:var(--text-muted);">${(params.text || '').length} chars • ${(params.text || '').trim().split(/\s+/).filter(Boolean).length} words</span>
                </div>
                <input id="tweakCoreTextString" type="text" class="dim-input" style="width:100%; padding:5px 8px; font-size:0.82rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; font-family:var(--code-font);" value="${escapeHtml(params.text || '')}" placeholder="Type text here..." oninput="applyCoreTextTweaks()" />
            </div>

            <!-- 4 Structured Subsections Grid -->
            <div style="display:flex; flex-direction:column; gap:8px;">
                <!-- 1. Font & Typography -->
                <div style="background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:6px;">
                    <div style="font-weight:700; font-size:0.72rem; color:var(--accent-blue); text-transform:uppercase; margin-bottom:6px; display:flex; align-items:center; gap:4px;">
                        <span>📐</span> Font &amp; Typography
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px 12px; font-size:0.75rem;">
                        <div>
                            <label for="tweakCoreTextFontSize" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Font Size (sp):</label>
                            <input id="tweakCoreTextFontSize" type="number" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" value="${params.fontSize}" step="1" min="1" oninput="applyCoreTextTweaks()" />
                        </div>
                        <div>
                            <label for="tweakCoreTextFontWeight" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Font Weight:</label>
                            <select id="tweakCoreTextFontWeight" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyCoreTextTweaks()">
                                <option value="100" ${params.fontWeight === 100 ? 'selected' : ''}>Thin (100)</option>
                                <option value="200" ${params.fontWeight === 200 ? 'selected' : ''}>Extra Light (200)</option>
                                <option value="300" ${params.fontWeight === 300 ? 'selected' : ''}>Light (300)</option>
                                <option value="400" ${params.fontWeight === 400 ? 'selected' : ''}>Normal (400)</option>
                                <option value="500" ${params.fontWeight === 500 ? 'selected' : ''}>Medium (500)</option>
                                <option value="600" ${params.fontWeight === 600 ? 'selected' : ''}>Semi-Bold (600)</option>
                                <option value="700" ${params.fontWeight === 700 ? 'selected' : ''}>Bold (700)</option>
                                <option value="800" ${params.fontWeight === 800 ? 'selected' : ''}>Extra Bold (800)</option>
                                <option value="900" ${params.fontWeight === 900 ? 'selected' : ''}>Black (900)</option>
                            </select>
                        </div>
                        <div>
                            <label for="tweakCoreTextFontStyle" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Font Style:</label>
                            <select id="tweakCoreTextFontStyle" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyCoreTextTweaks()">
                                <option value="0" ${params.fontStyle === 0 ? 'selected' : ''}>Normal</option>
                                <option value="1" ${params.fontStyle === 1 ? 'selected' : ''}>Italic</option>
                            </select>
                        </div>
                        <div>
                            <label for="tweakCoreTextFontFamily" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Font Family:</label>
                            <select id="tweakCoreTextFontFamily" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyCoreTextTweaks()">
                                <option value="0" ${String(params.fontFamily).toLowerCase() === 'default' ? 'selected' : ''}>Default</option>
                                <option value="1" ${String(params.fontFamily).toLowerCase() === 'sans-serif' ? 'selected' : ''}>Sans-Serif</option>
                                <option value="2" ${String(params.fontFamily).toLowerCase() === 'serif' ? 'selected' : ''}>Serif</option>
                                <option value="3" ${String(params.fontFamily).toLowerCase() === 'monospace' ? 'selected' : ''}>Monospace</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- 2. Color & Appearance -->
                <div style="background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:6px;">
                    <div style="font-weight:700; font-size:0.72rem; color:var(--accent-purple); text-transform:uppercase; margin-bottom:6px; display:flex; align-items:center; gap:4px;">
                        <span>🎨</span> Color &amp; Appearance
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px 12px; font-size:0.75rem;">
                        <div>
                            <label style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Text Color:</label>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <input id="tweakCoreTextColorPicker" type="color" style="width:28px; height:24px; padding:0; border:none; background:none; cursor:pointer;" value="${argbHexToRgbHex(params.colorHex)}" oninput="handleCoreTextColorPicker(this.value)" />
                                <input id="tweakCoreTextColorHex" type="text" class="dim-input" style="flex:1; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; font-family:var(--code-font);" value="${params.colorHex}" oninput="applyCoreTextTweaks()" />
                            </div>
                        </div>
                        <div>
                            <span style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Dynamic Color:</span>
                            <div style="padding-top:4px; color:var(--text-primary); font-weight:600;">
                                ${params.isDynamicColor ? `Yes (Var #${params.colorId})` : 'No (Static)'}
                            </div>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; padding-top:4px;">
                            <label style="display:flex; align-items:center; gap:4px; cursor:pointer; color:var(--text-primary); font-size:0.75rem;">
                                <input id="tweakCoreTextUnderline" type="checkbox" ${params.underline ? 'checked' : ''} onchange="applyCoreTextTweaks()" />
                                <u>Underline</u>
                            </label>
                            <label style="display:flex; align-items:center; gap:4px; cursor:pointer; color:var(--text-primary); font-size:0.75rem;">
                                <input id="tweakCoreTextStrikethrough" type="checkbox" ${params.strikethrough ? 'checked' : ''} onchange="applyCoreTextTweaks()" />
                                <s>Strikethrough</s>
                            </label>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; padding-top:4px;">
                            <label style="display:flex; align-items:center; gap:4px; cursor:pointer; color:var(--text-primary); font-size:0.75rem;">
                                <input id="tweakCoreTextAutosize" type="checkbox" ${params.autosize ? 'checked' : ''} onchange="applyCoreTextTweaks()" />
                                <span>Autosize</span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- 3. Alignment & Flow -->
                <div style="background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:6px;">
                    <div style="font-weight:700; font-size:0.72rem; color:var(--accent-amber); text-transform:uppercase; margin-bottom:6px; display:flex; align-items:center; gap:4px;">
                        <span>⏸️</span> Alignment &amp; Flow
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px 12px; font-size:0.75rem;">
                        <div>
                            <label for="tweakCoreTextTextAlign" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Text Align:</label>
                            <select id="tweakCoreTextTextAlign" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyCoreTextTweaks()">
                                <option value="1" ${params.textAlign === 1 ? 'selected' : ''}>Left (1)</option>
                                <option value="2" ${params.textAlign === 2 ? 'selected' : ''}>Right (2)</option>
                                <option value="3" ${params.textAlign === 3 ? 'selected' : ''}>Center (3)</option>
                                <option value="4" ${params.textAlign === 4 ? 'selected' : ''}>Justify (4)</option>
                                <option value="5" ${params.textAlign === 5 ? 'selected' : ''}>Start (5)</option>
                                <option value="6" ${params.textAlign === 6 ? 'selected' : ''}>End (6)</option>
                            </select>
                        </div>
                        <div>
                            <label for="tweakCoreTextOverflow" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Overflow:</label>
                            <select id="tweakCoreTextOverflow" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyCoreTextTweaks()">
                                <option value="1" ${params.overflow === 1 ? 'selected' : ''}>Clip (1)</option>
                                <option value="2" ${params.overflow === 2 ? 'selected' : ''}>Visible (2)</option>
                                <option value="3" ${params.overflow === 3 ? 'selected' : ''}>Ellipsis (3)</option>
                                <option value="4" ${params.overflow === 4 ? 'selected' : ''}>Start Ellipsis (4)</option>
                                <option value="5" ${params.overflow === 5 ? 'selected' : ''}>Middle Ellipsis (5)</option>
                            </select>
                        </div>
                        <div>
                            <label for="tweakCoreTextMaxLines" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Max Lines:</label>
                            <input id="tweakCoreTextMaxLines" type="number" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" value="${params.maxLines >= 10000 ? '' : params.maxLines}" placeholder="∞ (Unlimited)" min="0" oninput="applyCoreTextTweaks()" />
                        </div>
                        <div>
                            <label for="tweakCoreTextLetterSpacing" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Letter Spacing (sp):</label>
                            <input id="tweakCoreTextLetterSpacing" type="number" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" value="${params.letterSpacing}" step="0.1" oninput="applyCoreTextTweaks()" />
                        </div>
                        <div>
                            <label for="tweakCoreTextLineHeightMult" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Line Height Multiplier:</label>
                            <input id="tweakCoreTextLineHeightMult" type="number" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" value="${params.lineHeightMultiplier}" step="0.05" oninput="applyCoreTextTweaks()" />
                        </div>
                        <div>
                            <label for="tweakCoreTextLineHeightAdd" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Line Height Add (dp):</label>
                            <input id="tweakCoreTextLineHeightAdd" type="number" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" value="${params.lineHeightAdd}" step="1" oninput="applyCoreTextTweaks()" />
                        </div>
                    </div>
                </div>

                <!-- 4. Advanced Typography Options -->
                <div style="background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:6px;">
                    <div style="font-weight:700; font-size:0.72rem; color:var(--accent-emerald); text-transform:uppercase; margin-bottom:6px; display:flex; align-items:center; gap:4px;">
                        <span>⚙️</span> Advanced Options
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px 12px; font-size:0.75rem;">
                        <div>
                            <label for="tweakCoreTextLineBreak" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Break Strategy:</label>
                            <select id="tweakCoreTextLineBreak" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyCoreTextTweaks()">
                                <option value="0" ${params.lineBreakStrategy === 0 ? 'selected' : ''}>Simple (0)</option>
                                <option value="1" ${params.lineBreakStrategy === 1 ? 'selected' : ''}>High Quality (1)</option>
                                <option value="2" ${params.lineBreakStrategy === 2 ? 'selected' : ''}>Balanced (2)</option>
                            </select>
                        </div>
                        <div>
                            <label for="tweakCoreTextHyphenation" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Hyphenation:</label>
                            <select id="tweakCoreTextHyphenation" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyCoreTextTweaks()">
                                <option value="0" ${params.hyphenationFrequency === 0 ? 'selected' : ''}>None (0)</option>
                                <option value="1" ${params.hyphenationFrequency === 1 ? 'selected' : ''}>Normal (1)</option>
                                <option value="2" ${params.hyphenationFrequency === 2 ? 'selected' : ''}>Full (2)</option>
                                <option value="3" ${params.hyphenationFrequency === 3 ? 'selected' : ''}>Normal Fast (3)</option>
                                <option value="4" ${params.hyphenationFrequency === 4 ? 'selected' : ''}>Full Fast (4)</option>
                            </select>
                        </div>
                        <div>
                            <label for="tweakCoreTextJustification" style="color:var(--text-secondary); display:block; margin-bottom:2px; font-size:0.7rem;">Justification:</label>
                            <select id="tweakCoreTextJustification" class="dim-input" style="width:100%; padding:3px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyCoreTextTweaks()">
                                <option value="0" ${params.justificationMode === 0 ? 'selected' : ''}>None (0)</option>
                                <option value="1" ${params.justificationMode === 1 ? 'selected' : ''}>Inter-Word (1)</option>
                                <option value="2" ${params.justificationMode === 2 ? 'selected' : ''}>Inter-Character (2)</option>
                            </select>
                        </div>
                        ${params.animationId !== -1 ? `
                            <div>
                                <span style="color:var(--text-secondary); font-size:0.7rem;">Animation ID:</span>
                                <strong style="color:var(--text-primary); margin-left:4px;">${params.animationId}</strong>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function renderLayoutAlignmentInspectorSection(selectedComp) {
    if (!selectedComp || !selectedComp.op) return '';
    const align = getLayoutAlignmentInfo(selectedComp.op);
    if (!align || (!align.hName && !align.vName && align.spacedBy === null)) return '';

    const hPos = align.hPos ?? 1;
    const vPos = align.vPos ?? 4;
    const spacedBy = align.spacedBy ?? 0;

    return `
        <div style="background:var(--bg-card); border:1px solid var(--border-color); border-left:3px solid var(--accent-blue); border-radius:8px; padding:12px;">
            <div style="font-weight:700; font-size:0.8rem; color:var(--accent-blue); margin-bottom:8px; display:flex; align-items:center; justify-content:space-between;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span>📐</span> Layout Alignment &amp; Distribution
                </div>
                <span class="badge" style="background:rgba(59,130,246,0.15); color:var(--accent-blue); font-size:0.68rem; font-family:var(--code-font);">⚡ Live Editable</span>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:8px; font-size:0.75rem;">
                <div style="background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:6px;">
                    <label for="tweakHorizontalAlign" style="color:var(--text-muted); font-size:0.68rem; font-weight:700; text-transform:uppercase; margin-bottom:4px; display:block;">↔ Horizontal Alignment</label>
                    <select id="tweakHorizontalAlign" class="dim-input" style="width:100%; padding:4px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyLayoutTweaks()">
                        <option value="1" ${hPos === 1 ? 'selected' : ''}>Start (1)</option>
                        <option value="2" ${hPos === 2 ? 'selected' : ''}>Center (2)</option>
                        <option value="3" ${hPos === 3 ? 'selected' : ''}>End (3)</option>
                        <option value="4" ${hPos === 4 ? 'selected' : ''}>Top (4)</option>
                        <option value="5" ${hPos === 5 ? 'selected' : ''}>Bottom (5)</option>
                        <option value="6" ${hPos === 6 ? 'selected' : ''}>Space Between (6)</option>
                        <option value="7" ${hPos === 7 ? 'selected' : ''}>Space Evenly (7)</option>
                        <option value="8" ${hPos === 8 ? 'selected' : ''}>Space Around (8)</option>
                    </select>
                </div>
                <div style="background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:6px;">
                    <label for="tweakVerticalAlign" style="color:var(--text-muted); font-size:0.68rem; font-weight:700; text-transform:uppercase; margin-bottom:4px; display:block;">↕ Vertical Alignment</label>
                    <select id="tweakVerticalAlign" class="dim-input" style="width:100%; padding:4px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" onchange="applyLayoutTweaks()">
                        <option value="4" ${vPos === 4 ? 'selected' : ''}>Top (4)</option>
                        <option value="2" ${vPos === 2 ? 'selected' : ''}>Center (2)</option>
                        <option value="5" ${vPos === 5 ? 'selected' : ''}>Bottom (5)</option>
                        <option value="1" ${vPos === 1 ? 'selected' : ''}>Start (1)</option>
                        <option value="3" ${vPos === 3 ? 'selected' : ''}>End (3)</option>
                        <option value="6" ${vPos === 6 ? 'selected' : ''}>Space Between (6)</option>
                        <option value="7" ${vPos === 7 ? 'selected' : ''}>Space Evenly (7)</option>
                        <option value="8" ${vPos === 8 ? 'selected' : ''}>Space Around (8)</option>
                    </select>
                </div>
                <div style="background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:6px;">
                    <label for="tweakSpacedBy" style="color:var(--text-muted); font-size:0.68rem; font-weight:700; text-transform:uppercase; margin-bottom:4px; display:block;">📏 Spaced By (dp)</label>
                    <input id="tweakSpacedBy" type="number" class="dim-input" style="width:100%; padding:4px 6px; font-size:0.75rem; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px;" value="${spacedBy}" step="1" onchange="applyLayoutTweaks()" oninput="applyLayoutTweaks()" />
                </div>
            </div>
        </div>
    `;
}

/**
 * Main render function for Panel 13: Layout & Box Model Inspector.
 */
export function renderLayoutInspectorPanel(doc) {
    const container = document.getElementById('layoutInspectorContainer');
    if (!container) return;

    if (!doc) {
        container.innerHTML = `
            <div style="text-align:center; padding:48px 16px; color:var(--text-muted);">
                <div style="font-size:2rem; margin-bottom:8px;">📐</div>
                <div style="font-weight:600; font-size:0.95rem;">No Document Loaded</div>
                <div style="font-size:0.8rem; margin-top:4px;">Open a .rc document to inspect component box models, modifier chains, and layout constraints.</div>
            </div>
        `;
        return;
    }

    cachedLayoutComponents = extractLayoutComponents(doc);
    const diagnostics = runLayoutDiagnostics(cachedLayoutComponents);
    const density = currentDensity || 1.0;

    // Keep selectedComponentKey if valid, otherwise clear it
    if (selectedComponentKey && !cachedLayoutComponents.find(c => c.key === selectedComponentKey)) {
        selectedComponentKey = null;
    }

    const selectedComp = cachedLayoutComponents.find(c => c.key === selectedComponentKey) || null;

    let html = `
        <div style="display:flex; flex-direction:column; gap:12px; padding:12px;">
            <!-- Top Controls: Selected Component Info & Overlay Toggle -->
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; background:rgba(0,0,0,0.25); padding:10px 12px; border-radius:8px; border:1px solid var(--border-color);">
                <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                    <span style="font-size:1.3rem;">${selectedComp ? getComponentIcon(selectedComp.name) : '📐'}</span>
                    <div style="display:flex; flex-direction:column; min-width:0;">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <strong style="color:var(--accent-blue); font-size:0.85rem; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                                ${selectedComp ? `${escapeHtml(selectedComp.name)}` : 'No Component Selected'}
                            </strong>
                            ${selectedComp && selectedComp.id !== null ? `
                                <span class="badge" style="background:rgba(56,189,248,0.15); color:var(--accent-blue); font-size:0.65rem;">ID: ${selectedComp.id}</span>
                            ` : ''}
                            ${(selectedComp && (selectedComp.horizontalAlignment || selectedComp.verticalAlignment)) ? `
                                <span class="badge" style="background:rgba(59,130,246,0.15); color:var(--accent-blue); font-size:0.65rem;">↔ H: ${selectedComp.horizontalAlignment || '—'} • ↕ V: ${selectedComp.verticalAlignment || '—'}${selectedComp.spacing !== null && selectedComp.spacing !== undefined ? ` • 📏 ${selectedComp.spacing}dp` : ''}</span>
                            ` : ''}
                        </div>
                        <div style="font-size:0.7rem; color:var(--text-muted); font-family:var(--code-font);">
                            ${selectedComp ? `${Math.round(selectedComp.width)}×${Math.round(selectedComp.height)} dp • Depth ${selectedComp.depth}` : 'Select an element in the Component Tree panel or Preview to inspect'}
                        </div>
                    </div>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <button class="btn btn-xs ${showLayoutBoundsOverlay ? 'btn-primary' : 'btn-secondary'}" onclick="toggleLayoutBoundsOverlay()" title="Toggle visual bounding boxes overlay on stage canvas">
                        <span>${showLayoutBoundsOverlay ? '🔲 Hide Bounds' : '🔲 Show Bounds'}</span>
                    </button>
                    ${selectedComp && selectedComp.id !== null ? `
                        <button class="btn btn-secondary btn-xs" onclick="jumpToCommandCard(${selectedComp.id})" title="Jump to command card">
                            📜 Card
                        </button>
                    ` : ''}
                </div>
            </div>

            <!-- Diagnostics Badge & Drawer (if any issues found) -->
            ${diagnostics.length > 0 ? `
                <div style="background:rgba(251,191,36,0.08); border:1px solid rgba(251,191,36,0.3); border-radius:6px; padding:8px 10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-weight:700; font-size:0.75rem; color:var(--accent-amber); display:flex; align-items:center; gap:4px;">
                            ⚠️ Layout Diagnostics (${diagnostics.length} issue${diagnostics.length > 1 ? 's' : ''})
                        </span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px; max-height:100px; overflow-y:auto;">
                        ${diagnostics.slice(0, 4).map(d => `
                            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; background:rgba(0,0,0,0.2); padding:3px 6px; border-radius:4px;">
                                <span style="color:var(--text-primary); text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:240px;" title="${escapeHtml(d.message)}">
                                    • <strong>${escapeHtml(d.title)}</strong>
                                </span>
                                <button class="btn btn-secondary btn-xs" style="padding:0 4px; font-size:0.65rem;" onclick="selectLayoutComponent('${d.compKey}')">Inspect</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- Dedicated CoreText Typography & Parameters Section (when CoreText is selected) -->
            ${selectedComp ? renderCoreTextInspectorSection(selectedComp) : ''}

            <!-- Dedicated Layout Alignment & Distribution Section -->
            ${selectedComp ? renderLayoutAlignmentInspectorSection(selectedComp) : ''}

            <!-- Dedicated Dimension Modifiers (Width & Height) Section -->
            ${selectedComp ? renderDimensionModifiersInspectorSection(selectedComp) : ''}

            <!-- Section 1: Visual Box Model Diagram -->
            <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:12px;">
                <div style="font-weight:700; font-size:0.8rem; color:var(--accent-blue); margin-bottom:10px; display:flex; align-items:center; gap:6px;">
                    <span>📦</span> Visual Box Model
                </div>
                ${renderBoxModelDiagram(selectedComp, density)}
            </div>

            <!-- Section 2: Step-by-Step Modifier Pipeline -->
            <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:12px;">
                <div style="font-weight:700; font-size:0.8rem; color:var(--accent-rose); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                    <span style="display:flex; align-items:center; gap:6px;">
                        <span>🧱</span> Modifier Execution Chain (${selectedComp ? selectedComp.modifiers.length : 0})
                    </span>
                    <span style="font-size:0.7rem; color:var(--text-muted);">Outer → Inner</span>
                </div>
                ${renderModifierChain(selectedComp)}
            </div>

            <!-- Section 3: Live Layout Sandbox & Tweaker -->
            <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:12px;">
                <div style="font-weight:700; font-size:0.8rem; color:var(--accent-emerald); margin-bottom:10px; display:flex; align-items:center; gap:6px;">
                    <span>🎛️</span> Layout Sandbox & Tweaker
                </div>
                ${selectedComp ? `
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:0.75rem;">
                        <div>
                            <label style="color:var(--text-secondary); display:block; margin-bottom:2px;">Width (dp)</label>
                            <input id="tweakWidthInput" type="number" class="dim-input" style="width:100%; padding:3px 6px;" value="${Math.round(selectedComp.width)}" onchange="applyLayoutTweaks()" />
                        </div>
                        <div>
                            <label style="color:var(--text-secondary); display:block; margin-bottom:2px;">Height (dp)</label>
                            <input id="tweakHeightInput" type="number" class="dim-input" style="width:100%; padding:3px 6px;" value="${Math.round(selectedComp.height)}" onchange="applyLayoutTweaks()" />
                        </div>
                        <div>
                            <label style="color:var(--text-secondary); display:block; margin-bottom:2px;">Padding (dp)</label>
                            <input id="tweakPaddingInput" type="number" class="dim-input" style="width:100%; padding:3px 6px;" value="${selectedComp.padding.top}" onchange="applyLayoutTweaks()" />
                        </div>
                        <div>
                            <label style="color:var(--text-secondary); display:block; margin-bottom:2px;">Corner Radius (dp)</label>
                            <input id="tweakRadiusInput" type="number" class="dim-input" style="width:100%; padding:3px 6px;" value="${selectedComp.border.radius}" onchange="applyLayoutTweaks()" />
                        </div>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:10px;">
                        <button class="btn btn-secondary btn-xs" onclick="resetLayoutTweaks()">⟳ Reset</button>
                        <button class="btn btn-xs" onclick="applyLayoutTweaks()">⚡ Apply Live</button>
                    </div>
                ` : `
                    <div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">
                        Select a component to adjust its layout properties live.
                    </div>
                `}
            </div>
        </div>
    `;

    container.innerHTML = html;
    drawLayoutBoundsOverlay();
}

/**
 * Selects a component in the Layout Inspector and updates the UI and on-canvas highlight.
 */
export function selectLayoutComponent(target) {
    const win = typeof window !== 'undefined' ? window : globalThis;

    if (!target && target !== 0) {
        selectedComponentKey = null;
        if (typeof document !== 'undefined') {
            document.querySelectorAll('.tree-node-content').forEach(n => n.classList.remove('selected'));
            document.querySelectorAll('.running-node-content').forEach(n => n.classList.remove('selected'));
        }
        const p13 = typeof document !== 'undefined' ? document.getElementById('pane13') : null;
        if (p13 && !p13.classList.contains('hidden-panel')) {
            renderLayoutInspectorPanel(win.currentDocument);
        }
        drawLayoutBoundsOverlay();
        return;
    }

    if (win.currentDocument) {
        cachedLayoutComponents = extractLayoutComponents(win.currentDocument);
    }

    let found = null;
    if (typeof target === 'string' && target.startsWith('comp_')) {
        found = cachedLayoutComponents.find(c => c.key === target);
        selectedComponentKey = found ? found.key : target;
    } else if (typeof target === 'number') {
        // Prefer matching componentId (cid) first if distinct, or non-zero id
        found = cachedLayoutComponents.find(c => c.cid !== null && c.cid !== undefined && c.cid === target);
        if (!found && target !== 0) {
            found = cachedLayoutComponents.find(c => c.id !== null && c.id !== undefined && c.id === target);
        }
        selectedComponentKey = found ? found.key : null;
    } else if (typeof target === 'object' && target !== null) {
        const targetId = typeof target.getId === 'function' ? target.getId() : (target.mId ?? null);
        const targetCid = typeof target.getComponentId === 'function' ? target.getComponentId() : (target.mComponentId ?? null);
        found = cachedLayoutComponents.find(c => c.op === target);
        if (!found && targetCid !== null && targetCid !== undefined) {
            found = cachedLayoutComponents.find(c => c.cid === targetCid);
        }
        if (!found && targetId !== null && targetId !== 0) {
            found = cachedLayoutComponents.find(c => c.id === targetId);
        }
        selectedComponentKey = found ? found.key : null;
    }

    // Highlight matching node in Component Tree (Pane 3) and Running Tree (Pane 7)
    if (typeof document !== 'undefined') {
        const selectedComp = cachedLayoutComponents.find(c => c.key === selectedComponentKey);
        if (selectedComp) {
            // 1. Component Tree (Pane 3)
            let matchedNodeId = null;
            if (__componentTreeOpRegistry && selectedComp.op) {
                for (const [nId, regOp] of __componentTreeOpRegistry.entries()) {
                    if (regOp === selectedComp.op) {
                        matchedNodeId = nId;
                        break;
                    }
                }
            }
            let nodeEl = matchedNodeId ? (document.getElementById(matchedNodeId) || document.querySelector(`.tree-node-content[data-node-id="${matchedNodeId}"], #${matchedNodeId}`)) : null;
            if (!nodeEl && (selectedComp.cid !== null || (selectedComp.id !== null && selectedComp.id !== 0))) {
                const matchId = selectedComp.cid ?? selectedComp.id;
                nodeEl = document.querySelector(`.tree-node-content[onclick*="${matchId}"]`);
            }

            document.querySelectorAll('.tree-node-content').forEach(n => n.classList.remove('selected'));
            if (nodeEl) {
                nodeEl.classList.add('tree-node-content');
                nodeEl.classList.add('selected');
                if (typeof expandTreeAncestors === 'function') {
                    expandTreeAncestors(nodeEl);
                }
                nodeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }

            // 2. Running Operations Tree (Pane 7)
            let matchedRtNodeId = null;
            if (__rtOpRegistry && selectedComp.op) {
                for (const [nId, regOp] of __rtOpRegistry.entries()) {
                    if (regOp === selectedComp.op) {
                        matchedRtNodeId = nId;
                        break;
                    }
                }
            }
            let rtNodeEl = matchedRtNodeId ? (document.getElementById(matchedRtNodeId) || document.querySelector(`.running-node-content[data-node-id="${matchedRtNodeId}"], #${matchedRtNodeId}`)) : null;
            if (!rtNodeEl && (selectedComp.cid !== null || (selectedComp.id !== null && selectedComp.id !== 0))) {
                const matchId = selectedComp.cid ?? selectedComp.id;
                rtNodeEl = document.querySelector(`.running-node-content[onclick*="${matchId}"]`);
            }

            document.querySelectorAll('.running-node-content').forEach(n => n.classList.remove('selected'));
            if (rtNodeEl) {
                rtNodeEl.classList.add('running-node-content');
                rtNodeEl.classList.add('selected');
                if (typeof expandTreeAncestors === 'function') {
                    expandTreeAncestors(rtNodeEl);
                }
            }
        } else {
            document.querySelectorAll('.tree-node-content').forEach(n => n.classList.remove('selected'));
            document.querySelectorAll('.running-node-content').forEach(n => n.classList.remove('selected'));
        }
    }

    const p13 = typeof document !== 'undefined' ? document.getElementById('pane13') : null;
    if (p13 && !p13.classList.contains('hidden-panel')) {
        renderLayoutInspectorPanel(win.currentDocument);
    }
    drawLayoutBoundsOverlay();
}

export function selectLayoutComponentByOpId(opId) {
    selectLayoutComponent(opId);
}

/**
 * Focuses / jumps to the command card in Pane 2 corresponding to this operation.
 */
export function jumpToCommandCard(opId, op = null) {
    const win = typeof window !== 'undefined' ? window : globalThis;
    const allOps = win.currentParsedOps || [];
    const idx = findMatchingCommandIndex(op, opId, allOps);
    if (idx >= 0) {
        const matchedOp = allOps[idx];
        const matchedOpId = getOpId(matchedOp) ?? opId ?? null;
        selectCommandCard(idx, matchedOpId, { scrollTo: true });
        const card = document.getElementById(`cmdCard-${idx}`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

/**
 * Toggles on-canvas layout bounds overlay.
 */
export function toggleLayoutBoundsOverlay() {
    showLayoutBoundsOverlay = !showLayoutBoundsOverlay;
    const win = typeof window !== 'undefined' ? window : globalThis;
    renderLayoutInspectorPanel(win.currentDocument);
    drawLayoutBoundsOverlay();
}

/**
 * Draws visual layout bounds, padding boxes, and touch hitboxes on an overlay canvas over the main stage.
 */
export function drawLayoutBoundsOverlay() {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;

    let overlayCanvas = doc.getElementById('layoutBoundsOverlayCanvas');
    const stageCanvas = doc.getElementById('previewCanvas') || doc.getElementById('canvas');
    const stageWrapper = doc.getElementById('canvasStageWrapper');

    const win = typeof window !== 'undefined' ? window : globalThis;
    if (win.currentDocument) {
        cachedLayoutComponents = extractLayoutComponents(win.currentDocument);
    }

    const shouldDraw = (showLayoutBoundsOverlay || Boolean(selectedComponentKey)) && Boolean(stageCanvas) && Boolean(cachedLayoutComponents && cachedLayoutComponents.length > 0);

    if (!shouldDraw) {
        if (overlayCanvas) overlayCanvas.style.display = 'none';
        return;
    }

    if (!overlayCanvas && stageWrapper) {
        overlayCanvas = doc.createElement('canvas');
        overlayCanvas.id = 'layoutBoundsOverlayCanvas';
        overlayCanvas.style.position = 'absolute';
        overlayCanvas.style.top = '0';
        overlayCanvas.style.left = '0';
        overlayCanvas.style.pointerEvents = 'none';
        overlayCanvas.style.zIndex = '5';
        overlayCanvas.style.background = 'transparent';
        overlayCanvas.style.backgroundColor = 'transparent';
        overlayCanvas.style.boxShadow = 'none';
        overlayCanvas.style.border = 'none';
        stageWrapper.appendChild(overlayCanvas);
    }

    if (!overlayCanvas) return;

    overlayCanvas.style.display = 'block';
    overlayCanvas.style.background = 'transparent';
    overlayCanvas.style.backgroundColor = 'transparent';
    overlayCanvas.style.boxShadow = 'none';
    overlayCanvas.style.border = 'none';
    overlayCanvas.style.borderRadius = stageCanvas.style.borderRadius || '8px';
    overlayCanvas.width = stageCanvas.width;
    overlayCanvas.height = stageCanvas.height;
    overlayCanvas.style.width = stageCanvas.style.width || `${stageCanvas.width}px`;
    overlayCanvas.style.height = stageCanvas.style.height || `${stageCanvas.height}px`;

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const density = currentDensity || 1.0;

    cachedLayoutComponents.forEach(comp => {
        const isSelected = comp.key === selectedComponentKey;
        if (!showLayoutBoundsOverlay && !isSelected) return; // When global overlay is off, ONLY draw the selected component

        const op = comp.op;
        const livePos = op ? getComponentGlobalPosition(op) : { gx: comp.globalX, gy: comp.globalY };
        const liveW = op ? getSafeFloat(typeof op.getWidth === 'function' ? op.getWidth() : (op.mWidth ?? comp.width)) : comp.width;
        const liveH = op ? getSafeFloat(typeof op.getHeight === 'function' ? op.getHeight() : (op.mHeight ?? comp.height)) : comp.height;
        const livePad = op ? getComponentPadding(op) : comp.padding;

        const x = Math.round(livePos.gx * density);
        const y = Math.round(livePos.gy * density);
        const w = Math.round(liveW * density);
        const h = Math.round(liveH * density);

        const visInfo = op ? getVisibilityInfo(op) : { status: 'VISIBLE' };
        const isGone = visInfo.status === 'GONE';

        if (isGone || w <= 0 || h <= 0) {
            if (isSelected) {
                const label = `${comp.name} (${Math.max(0, Math.round(liveW))}×${Math.max(0, Math.round(liveH))}dp - Inactive / GONE)`;
                const drawW = w > 0 ? w : 40;
                const drawH = h > 0 ? h : 20;
                ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(x, y, drawW, drawH);
                ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
                ctx.fillRect(x, y, drawW, drawH);
                ctx.setLineDash([]);
                ctx.font = 'bold 11px monospace';
                const textW = ctx.measureText(label).width;
                const badgeY = Math.max(0, y - 18);
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(x, badgeY, textW + 10, 16);
                ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x, badgeY, textW + 10, 16);
                ctx.fillStyle = '#f59e0b';
                ctx.fillText(label, x + 5, badgeY + 12);
            }
            return;
        }

        // 1. Component Bounds (Vivid cyan for selected, subtle blue for others)
        ctx.strokeStyle = isSelected ? '#38bdf8' : 'rgba(56, 189, 248, 0.4)';
        ctx.lineWidth = isSelected ? 2.5 : 1;
        ctx.setLineDash([]);
        ctx.strokeRect(x, y, w, h);

        if (isSelected) {
            ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
            ctx.fillRect(x, y, w, h);
        }

        // 2. Padding Bounds (Green tint)
        const pt = Math.round(livePad.top * density);
        const pr = Math.round(livePad.right * density);
        const pb = Math.round(livePad.bottom * density);
        const pl = Math.round(livePad.left * density);

        if (pt > 0 || pr > 0 || pb > 0 || pl > 0) {
            ctx.fillStyle = 'rgba(52, 211, 153, 0.15)';
            if (pt > 0) ctx.fillRect(x, y, w, pt);
            if (pb > 0) ctx.fillRect(x, y + h - pb, w, pb);
            if (pl > 0) ctx.fillRect(x, y + pt, pl, h - pt - pb);
            if (pr > 0) ctx.fillRect(x + w - pr, y + pt, pr, h - pt - pb);
        }

        // 3. Clickable / Touch target (Yellow dashed)
        if (comp.isClickable) {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
            ctx.setLineDash([]);
        }

        // 4. Label Badge for selected component
        if (isSelected) {
            const label = `${comp.name} (${Math.round(liveW)}×${Math.round(liveH)}dp)`;
            ctx.font = 'bold 11px monospace';
            const textW = ctx.measureText(label).width;
            const badgeY = Math.max(0, y - 18);
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(x, badgeY, textW + 10, 16);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, badgeY, textW + 10, 16);
            ctx.fillStyle = '#38bdf8';
            ctx.fillText(label, x + 5, badgeY + 12);
        }
    });
}

/**
 * Live layout sandbox tweaker handler.
 */
export function applyLayoutTweaks(fullRefresh = false) {
    const win = typeof window !== 'undefined' ? window : globalThis;
    const doc = win.currentDocument;
    const player = win.currentPlayer;
    if (!doc || !selectedComponentKey) return;

    const comp = cachedLayoutComponents.find(c => c.key === selectedComponentKey);
    if (!comp || !comp.op) return;

    const wInput = document.getElementById('tweakWidthInput');
    const hInput = document.getElementById('tweakHeightInput');
    const pInput = document.getElementById('tweakPaddingInput');
    const rInput = document.getElementById('tweakRadiusInput');

    const hAlignInput = document.getElementById('tweakHorizontalAlign');
    const vAlignInput = document.getElementById('tweakVerticalAlign');
    const spaceInput = document.getElementById('tweakSpacedBy');

    if (wInput && !isNaN(parseFloat(wInput.value))) {
        const w = parseFloat(wInput.value);
        if (typeof comp.op.setWidth === 'function') comp.op.setWidth(w);
        comp.op.mWidth = w;
    }

    if (hInput && !isNaN(parseFloat(hInput.value))) {
        const h = parseFloat(hInput.value);
        if (typeof comp.op.setHeight === 'function') comp.op.setHeight(h);
        comp.op.mHeight = h;
    }

    if (pInput && !isNaN(parseFloat(pInput.value))) {
        const p = parseFloat(pInput.value);
        comp.op.mPaddingLeft = p;
        comp.op.mPaddingTop = p;
        comp.op.mPaddingRight = p;
        comp.op.mPaddingBottom = p;
    }

    if (rInput && !isNaN(parseFloat(rInput.value))) {
        comp.op.mCornerRadius = parseFloat(rInput.value);
    }

    if (hAlignInput && hAlignInput.value !== '') {
        const hVal = parseInt(hAlignInput.value, 10);
        comp.op.mHorizontalPositioning = hVal;
        comp.op.mHorizontalAlignment = hVal;
    }

    if (vAlignInput && vAlignInput.value !== '') {
        const vVal = parseInt(vAlignInput.value, 10);
        comp.op.mVerticalPositioning = vVal;
        comp.op.mVerticalAlignment = vVal;
    }

    if (spaceInput && !isNaN(parseFloat(spaceInput.value))) {
        const sVal = parseFloat(spaceInput.value);
        comp.op.mSpacedBy = sVal;
        comp.op.mSpacing = sVal;
        comp.op.mHorizontalSpacing = sVal;
        comp.op.mVerticalSpacing = sVal;
    }

    comp.op.mNeedsMeasure = true;
    if (typeof comp.op.invalidateMeasure === 'function') comp.op.invalidateMeasure();
    doc.mNeedsMeasure = true;

    if (player && typeof player.repaint === 'function') {
        player.repaint();
    }

    drawLayoutBoundsOverlay();

    if (fullRefresh) {
        renderLayoutInspectorPanel(doc);
    }
}

/**
 * Live CoreText attributes tweaker handler.
 */
export function applyCoreTextTweaks(fullRefresh = false) {
    const win = typeof window !== 'undefined' ? window : globalThis;
    const doc = win.currentDocument;
    const player = win.currentPlayer;
    if (!doc || !selectedComponentKey) return;

    const comp = cachedLayoutComponents.find(c => c.key === selectedComponentKey);
    if (!comp || !comp.op) return;

    const textInput = document.getElementById('tweakCoreTextString');
    const fontSizeInput = document.getElementById('tweakCoreTextFontSize');
    const fontWeightInput = document.getElementById('tweakCoreTextFontWeight');
    const fontStyleInput = document.getElementById('tweakCoreTextFontStyle');
    const fontFamilyInput = document.getElementById('tweakCoreTextFontFamily');
    const colorHexInput = document.getElementById('tweakCoreTextColorHex');
    const textAlignInput = document.getElementById('tweakCoreTextTextAlign');
    const overflowInput = document.getElementById('tweakCoreTextOverflow');
    const maxLinesInput = document.getElementById('tweakCoreTextMaxLines');
    const letterSpacingInput = document.getElementById('tweakCoreTextLetterSpacing');
    const lineHeightMultInput = document.getElementById('tweakCoreTextLineHeightMult');
    const lineHeightAddInput = document.getElementById('tweakCoreTextLineHeightAdd');
    const lineBreakInput = document.getElementById('tweakCoreTextLineBreak');
    const hyphenationInput = document.getElementById('tweakCoreTextHyphenation');
    const justificationInput = document.getElementById('tweakCoreTextJustification');
    const underlineInput = document.getElementById('tweakCoreTextUnderline');
    const strikethroughInput = document.getElementById('tweakCoreTextStrikethrough');
    const autosizeInput = document.getElementById('tweakCoreTextAutosize');

    // 1. Text String
    if (textInput) {
        const newText = textInput.value;
        comp.op.mText = newText;
        comp.op.mCachedString = newText;
        comp.op.mNewString = newText;
        if (comp.op.mTextId !== undefined && comp.op.mTextId !== -1) {
            if (typeof doc.addText === 'function') {
                doc.addText(comp.op.mTextId, newText);
            } else if (doc.mTextDatabase && typeof doc.mTextDatabase.put === 'function') {
                doc.mTextDatabase.put(comp.op.mTextId, newText);
            }
        }
    }

    // 2. Font Size
    if (fontSizeInput && !isNaN(parseFloat(fontSizeInput.value))) {
        const fs = parseFloat(fontSizeInput.value);
        comp.op.mFontSizeValue = fs;
        comp.op.mFontSize = floatToIntBits(fs);
        comp.op.mMeasureFontSize = fs;
    }

    // 3. Font Weight
    if (fontWeightInput && !isNaN(parseFloat(fontWeightInput.value))) {
        const fw = parseFloat(fontWeightInput.value);
        comp.op.mFontWeightValue = fw;
        comp.op.mFontWeight = floatToIntBits(fw);
    }

    // 4. Font Style
    if (fontStyleInput && fontStyleInput.value !== '') {
        comp.op.mFontStyle = parseInt(fontStyleInput.value, 10);
    }

    // 5. Font Family
    if (fontFamilyInput && fontFamilyInput.value !== '') {
        comp.op.mType = parseInt(fontFamilyInput.value, 10);
    }

    // 6. Color
    if (colorHexInput && colorHexInput.value) {
        let hex = colorHexInput.value.trim().replace(/^#/, '');
        if (hex.length === 6) hex = 'FF' + hex;
        if (hex.length === 8) {
            const parsedColor = parseInt(hex, 16) >>> 0;
            comp.op.mColor = parsedColor;
            comp.op.mColorValue = parsedColor;
        }
    }

    // 7. Text Align
    if (textAlignInput && textAlignInput.value !== '') {
        const alignVal = parseInt(textAlignInput.value, 10);
        comp.op.mTextAlign = alignVal;
        comp.op.mTextAlignValue = alignVal & 0xFFFF;
    }

    // 8. Overflow
    if (overflowInput && overflowInput.value !== '') {
        comp.op.mOverflow = parseInt(overflowInput.value, 10);
    }

    // 9. Max Lines
    if (maxLinesInput) {
        const ml = parseInt(maxLinesInput.value, 10);
        comp.op.mMaxLines = (!isNaN(ml) && ml > 0) ? ml : 2147483647;
    }

    // 10. Letter Spacing
    if (letterSpacingInput && !isNaN(parseFloat(letterSpacingInput.value))) {
        comp.op.mLetterSpacing = parseFloat(letterSpacingInput.value);
    }

    // 11. Line Height
    if (lineHeightMultInput && !isNaN(parseFloat(lineHeightMultInput.value))) {
        comp.op.mLineHeightMultiplier = parseFloat(lineHeightMultInput.value);
    }
    if (lineHeightAddInput && !isNaN(parseFloat(lineHeightAddInput.value))) {
        comp.op.mLineHeightAdd = parseFloat(lineHeightAddInput.value);
    }

    // 12. Break Strategy, Hyphenation, Justification
    if (lineBreakInput && lineBreakInput.value !== '') {
        comp.op.mLineBreakStrategy = parseInt(lineBreakInput.value, 10);
    }
    if (hyphenationInput && hyphenationInput.value !== '') {
        comp.op.mHyphenationFrequency = parseInt(hyphenationInput.value, 10);
    }
    if (justificationInput && justificationInput.value !== '') {
        comp.op.mJustificationMode = parseInt(justificationInput.value, 10);
    }

    // 13. Checkboxes
    if (underlineInput) comp.op.mUnderline = underlineInput.checked;
    if (strikethroughInput) comp.op.mStrikethrough = strikethroughInput.checked;
    if (autosizeInput) comp.op.mAutosize = autosizeInput.checked;

    comp.op.mNeedsMeasure = true;
    if (typeof comp.op.invalidateMeasure === 'function') comp.op.invalidateMeasure();
    doc.mNeedsMeasure = true;

    if (player && typeof player.repaint === 'function') {
        player.repaint();
    }

    drawLayoutBoundsOverlay();

    if (fullRefresh) {
        renderLayoutInspectorPanel(doc);
    }
}

export function handleCoreTextColorPicker(rgbHex) {
    const hexInput = document.getElementById('tweakCoreTextColorHex');
    if (hexInput && rgbHex) {
        let clean = rgbHex.replace(/^#/, '').toUpperCase();
        hexInput.value = '#FF' + clean;
    }
    applyCoreTextTweaks();
}

/**
 * Live Modifier Tweaker handler (for inline modifiers like WidthModifier / HeightModifier).
 */
export function applyModifierTweaks(modIndex, fullRefresh = false) {
    const win = typeof window !== 'undefined' ? window : globalThis;
    const doc = win.currentDocument;
    const player = win.currentPlayer;
    if (!doc || !selectedComponentKey) return;

    const comp = cachedLayoutComponents.find(c => c.key === selectedComponentKey);
    if (!comp || !comp.modifiers || !comp.modifiers[modIndex]) return;

    const mod = comp.modifiers[modIndex];
    if (!mod || !mod.op) return;

    const typeSelect = document.getElementById(`tweakModType_${modIndex}`);
    const valueInput = document.getElementById(`tweakModValue_${modIndex}`);

    if (typeSelect && typeSelect.value !== '') {
        const type = parseInt(typeSelect.value, 10);
        mod.op.mType = type;
        if (typeof mod.op.setType === 'function') mod.op.setType(type);
    }

    if (valueInput && !isNaN(parseFloat(valueInput.value))) {
        const val = parseFloat(valueInput.value);
        mod.op.mOutValue = val;
        mod.op.mValue = val;
        mod.op.mValueBits = floatToIntBits(val);
        if (typeof mod.op.setValue === 'function') mod.op.setValue(val);
    }

    comp.op.mNeedsMeasure = true;
    if (typeof comp.op.invalidateMeasure === 'function') comp.op.invalidateMeasure();
    doc.mNeedsMeasure = true;

    if (player && typeof player.repaint === 'function') {
        player.repaint();
    }

    drawLayoutBoundsOverlay();

    if (fullRefresh) {
        renderLayoutInspectorPanel(doc);
    }
}

/**
 * Live Dimension Tweaker handler (Width / Height constraint selector in dedicated dimension section).
 */
export function applyDimensionTweaks(kind, fullRefresh = false) {
    const win = typeof window !== 'undefined' ? window : globalThis;
    const doc = win.currentDocument;
    const player = win.currentPlayer;
    if (!doc || !selectedComponentKey) return;

    const comp = cachedLayoutComponents.find(c => c.key === selectedComponentKey);
    if (!comp || !comp.op) return;

    const typeSelect = document.getElementById(`tweakDimType_${kind}`);
    const valueInput = document.getElementById(`tweakDimValue_${kind}`);
    if (!typeSelect || !valueInput) return;

    const type = parseInt(typeSelect.value, 10);
    const val = parseFloat(valueInput.value);
    if (isNaN(type) || isNaN(val)) return;

    const isWidth = kind === 'width';
    const modName = isWidth ? 'WidthModifier' : 'HeightModifier';
    const opCode = isWidth ? 16 : 67;

    let mod = comp.modifiers?.find(m => m.name === modName || m.op?.OP_CODE === opCode || m.name === `${modName}Operation`);
    if (!mod && isWidth && comp.op.mWidthMod) mod = { op: comp.op.mWidthMod };
    if (!mod && !isWidth && comp.op.mHeightMod) mod = { op: comp.op.mHeightMod };

    if (mod && mod.op) {
        mod.op.mType = type;
        mod.op.mOutValue = val;
        mod.op.mValue = val;
        mod.op.mValueBits = floatToIntBits(val);
        if (typeof mod.op.setType === 'function') mod.op.setType(type);
        if (typeof mod.op.setValue === 'function') mod.op.setValue(val);
    } else {
        // Update direct layout dimensions on comp.op
        if (isWidth) {
            comp.op.mWidth = val;
            if (typeof comp.op.setWidth === 'function') comp.op.setWidth(val);
        } else {
            comp.op.mHeight = val;
            if (typeof comp.op.setHeight === 'function') comp.op.setHeight(val);
        }
    }

    comp.op.mNeedsMeasure = true;
    if (typeof comp.op.invalidateMeasure === 'function') comp.op.invalidateMeasure();
    doc.mNeedsMeasure = true;

    if (player && typeof player.repaint === 'function') {
        player.repaint();
    }

    drawLayoutBoundsOverlay();

    if (fullRefresh) {
        renderLayoutInspectorPanel(doc);
    }
}

export function resetLayoutTweaks() {
    const win = typeof window !== 'undefined' ? window : globalThis;
    renderLayoutInspectorPanel(win.currentDocument);
}

if (typeof window !== 'undefined') {
    window.selectLayoutComponent = selectLayoutComponent;
    window.toggleLayoutBoundsOverlay = toggleLayoutBoundsOverlay;
    window.jumpToCommandCard = jumpToCommandCard;
    window.applyLayoutTweaks = applyLayoutTweaks;
    window.resetLayoutTweaks = resetLayoutTweaks;
    window.applyCoreTextTweaks = applyCoreTextTweaks;
    window.handleCoreTextColorPicker = handleCoreTextColorPicker;
    window.applyModifierTweaks = applyModifierTweaks;
    window.applyDimensionTweaks = applyDimensionTweaks;
    window.renderDimensionModifiersInspectorSection = renderDimensionModifiersInspectorSection;
    window.renderLayoutInspectorPanel = renderLayoutInspectorPanel;
}


