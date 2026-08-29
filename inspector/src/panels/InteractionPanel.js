// Interaction: what in this document is clickable or touchable, where, and what it does.
//
// Interaction was previously invisible here — ClickModifier (59), MultiClickModifier (83),
// ClickArea (64) and TouchExpression (157) appeared only as names in the disassembly, with
// no way to see where a hit region is, what it would run, or whether it runs at all. That
// makes "why doesn't this button do anything" unanswerable in the inspector, which is why
// clicktest.mjs and dragtest.mjs had to exist as separate tools.
//
// Everything here is read from the inflated tree: a click modifier lives on a component and
// the component knows its own measured bounds, so the region is exactly what the engine
// hit-tests in LayoutComponent.onClick. Firing goes through the engine's own dispatch
// (CoreDocument.onClick) rather than a private path, so what happens here is what happens
// when a user taps.

import { getRootComponent, componentIdOf, componentName, componentBounds, modifiersOf, walkComponents } from './ComponentWalk.js';
import { getOpParameters, formatScalar } from './OpParameters.js';

const OP_CLICK_MODIFIER = 59;
const OP_CLICK_AREA = 64;
const OP_MULTI_CLICK_MODIFIER = 83;
const OP_TOUCH_EXPRESSION = 157;

const CLICK_TYPE_NAMES = { 0: 'single tap', 1: 'long press', 2: 'double tap' };

function opCodeOf(op) {
    if (!op) return -1;
    return op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : -1);
}

function opName(op) {
    return typeof window.getOpName === 'function' ? window.getOpName(op)
        : (op && op.constructor && op.constructor.name || 'Operation').replace(/^_/, '');
}

function opIndexOf(op) {
    const ops = window.currentParsedOps;
    return Array.isArray(ops) ? ops.indexOf(op) : -1;
}

function actionsOf(mod) {
    const list = typeof mod.getList === 'function' ? mod.getList() : mod.mList;
    return Array.isArray(list) ? list : [];
}

function textOf(doc, id) {
    if (!doc || id === undefined || id === null || id <= 0) return null;
    try { return typeof doc.getText === 'function' ? doc.getText(id) : null; } catch (e) { return null; }
}

/**
 * Every interactive target in the document.
 *
 * `kind` distinguishes what the engine will do with it: a `click` target is dispatched by
 * hit-testing a component's bounds, an `area` is a declared rectangle with an id the host
 * can invoke by name, and a `touch` target is a variable driven by drag rather than a tap.
 */
export function collectInteractionTargets(doc) {
    const targets = [];
    if (!doc) return targets;

    const root = getRootComponent(doc);
    walkComponents(root, (comp, depth) => {
        modifiersOf(comp).forEach(mod => {
            const code = opCodeOf(mod);
            if (code !== OP_CLICK_MODIFIER && code !== OP_MULTI_CLICK_MODIFIER) return;
            const clickType = code === OP_MULTI_CLICK_MODIFIER ? (mod.mClickType ?? 0) : 0;
            targets.push({
                kind: 'click',
                comp, depth,
                componentId: componentIdOf(comp),
                componentName: componentName(comp),
                bounds: componentBounds(comp),
                clickType,
                clickTypeName: CLICK_TYPE_NAMES[clickType] || `type ${clickType}`,
                // Only a single tap is dispatched; MultiClickModifier.onClick returns false
                // for long press and double tap, so those never fire in this player.
                dispatchable: clickType === 0,
                mod,
                idx: opIndexOf(mod),
                actions: actionsOf(mod)
            });
        });
    });

    const ops = window.currentParsedOps;
    if (Array.isArray(ops)) {
        ops.forEach((op, idx) => {
            const code = opCodeOf(op);
            if (code === OP_CLICK_AREA) {
                targets.push({
                    kind: 'area', idx, op,
                    areaId: op.mId,
                    metadataId: op.mMetadataId,
                    contentDescription: textOf(doc, op.mContentDescriptionId),
                    bounds: {
                        x: op.mOutLeft ?? 0, y: op.mOutTop ?? 0,
                        w: (op.mOutRight ?? 0) - (op.mOutLeft ?? 0),
                        h: (op.mOutBottom ?? 0) - (op.mOutTop ?? 0),
                        cx: ((op.mOutLeft ?? 0) + (op.mOutRight ?? 0)) / 2,
                        cy: ((op.mOutTop ?? 0) + (op.mOutBottom ?? 0)) / 2
                    },
                    actions: []
                });
            } else if (code === OP_TOUCH_EXPRESSION) {
                targets.push({ kind: 'touch', idx, op, varId: op.mId, actions: [] });
            }
        });
    }

    return targets;
}

/** Fire a target through the engine's own dispatch, then repaint. */
export function fireInteractionTarget(index) {
    const doc = window.currentDocument;
    const player = window.currentPlayer;
    if (!doc || !player) return;
    const targets = collectInteractionTargets(doc);
    const t = targets[index];
    if (!t) return;

    const context = typeof player.getRemoteContext === 'function' ? player.getRemoteContext() : player.remoteContext;
    if (!context) return;

    let handled = false;
    try {
        if (t.kind === 'area' && typeof doc.performClick === 'function') {
            handled = doc.performClick(context, t.areaId, '') === true;
        } else if (t.bounds) {
            handled = doc.onClick(context, t.bounds.cx, t.bounds.cy) === true;
        }
    } catch (e) {
        lastFireResult = { index, error: String(e && e.message || e) };
        renderInteractionPanel();
        return;
    }

    lastFireResult = { index, handled, at: t.bounds ? `${Math.round(t.bounds.cx)}, ${Math.round(t.bounds.cy)}` : null };
    if (typeof player.repaint === 'function') player.repaint();
    if (typeof window.updateVariableValuesLive === 'function') window.updateVariableValuesLive();
    renderInteractionPanel();
}

let lastFireResult = null;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function esc(s) {
    return typeof window.escapeHtml === 'function' ? window.escapeHtml(String(s)) : String(s);
}

function jumpChip(idx, label, title) {
    if (idx < 0) return `<span style="font-family:var(--code-font); font-size:0.72rem; color:var(--text-muted);">${esc(label)}</span>`;
    return `<span onclick="event.stopPropagation(); toggleCommandExpand(${idx}, null); const el=document.getElementById('cmdCard-${idx}'); if(el) el.scrollIntoView({behavior:'smooth', block:'center'});"
        title="${esc(title || `Operation #${idx + 1} — click to show it in the Commands List`)}"
        style="cursor:pointer; color:var(--accent-blue); background:rgba(56,189,248,0.14); border-radius:3px; padding:0 4px; font-family:var(--code-font); font-size:0.72rem;">#${idx + 1} ${esc(label)}</span>`;
}

function actionRowHtml(action) {
    const params = getOpParameters(action)
        .slice(0, 4)
        .map(p => {
            if (p.varId !== undefined && p.varId !== null) return `${p.label}=var_${p.varId}`;
            const v = typeof p.value === 'number' ? formatScalar(p.value) : String(p.value ?? '');
            return `${p.label}=${v}`;
        }).join(', ');
    return `
        <div style="display:flex; gap:6px; align-items:baseline; padding:1px 0 1px 10px;">
            <span style="color:var(--text-muted);">↳</span>
            ${jumpChip(opIndexOf(action), opName(action))}
            ${params ? `<span style="font-family:var(--code-font); font-size:0.7rem; color:var(--text-secondary);">${esc(params)}</span>` : ''}
        </div>`;
}

function targetCardHtml(t, index) {
    const fired = lastFireResult && lastFireResult.index === index ? lastFireResult : null;
    let firedNote = '';
    if (fired) {
        firedNote = fired.error
            ? `<span style="color:#f43f5e; font-size:0.7rem;">error: ${esc(fired.error)}</span>`
            : fired.handled
                ? `<span style="color:var(--accent-emerald); font-size:0.7rem;">✓ handled${fired.at ? ` at ${esc(fired.at)}` : ''}</span>`
                : `<span style="color:var(--accent-amber); font-size:0.7rem;">not handled — nothing at that point accepted the click</span>`;
    }

    if (t.kind === 'touch') {
        return `
            <div style="border:1px solid var(--border-color); border-left:3px solid #a855f7; border-radius:5px; padding:7px 10px; margin-bottom:6px;">
                <div style="display:flex; gap:8px; align-items:center; margin-bottom:3px;">
                    <span class="badge" style="background:#a855f7;">drag</span>
                    <strong style="font-size:0.78rem;">TouchExpression</strong>
                    ${jumpChip(t.idx, `var_${t.varId}`)}
                </div>
                <div style="font-size:0.7rem; color:var(--text-muted);">Drives var_${t.varId} from drag gestures on the canvas. Drag the preview in the Player panel to exercise it.</div>
            </div>`;
    }

    const b = t.bounds;
    const boundsStr = b ? `${Math.round(b.x)}, ${Math.round(b.y)} → ${Math.round(b.x + b.w)}, ${Math.round(b.y + b.h)}  (${Math.round(b.w)}×${Math.round(b.h)})` : 'no bounds';
    const empty = b && (b.w <= 0 || b.h <= 0);

    if (t.kind === 'area') {
        return `
            <div style="border:1px solid var(--border-color); border-left:3px solid var(--accent-amber); border-radius:5px; padding:7px 10px; margin-bottom:6px;">
                <div style="display:flex; gap:8px; align-items:center; margin-bottom:3px; flex-wrap:wrap;">
                    <span class="badge" style="background:var(--accent-amber); color:#3a2c05;">area</span>
                    <strong style="font-size:0.78rem;">ClickArea</strong>
                    ${jumpChip(t.idx, `id ${t.areaId}`)}
                    <button class="btn btn-secondary" style="padding:1px 8px; font-size:0.7rem; margin-left:auto;" onclick="fireInteractionTarget(${index})">▶ Fire</button>
                </div>
                <div style="font-family:var(--code-font); font-size:0.72rem; color:${empty ? 'var(--accent-amber)' : 'var(--text-secondary)'};">${esc(boundsStr)}${empty ? '  — zero-sized, cannot be hit' : ''}</div>
                ${t.contentDescription ? `<div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">“${esc(t.contentDescription)}”</div>` : ''}
                ${firedNote ? `<div style="margin-top:4px;">${firedNote}</div>` : ''}
            </div>`;
    }

    const actionsHtml = t.actions.length
        ? t.actions.map(actionRowHtml).join('')
        : `<div style="font-size:0.7rem; color:var(--accent-amber); padding-left:10px;">No actions attached — a tap here is accepted and does nothing.</div>`;

    return `
        <div style="border:1px solid var(--border-color); border-left:3px solid ${t.dispatchable ? 'var(--accent-emerald)' : 'var(--accent-amber)'}; border-radius:5px; padding:7px 10px; margin-bottom:6px;">
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:3px; flex-wrap:wrap;">
                <span class="badge" style="background:${t.dispatchable ? 'var(--accent-emerald)' : 'var(--accent-amber)'}; color:#04231a;">${esc(t.clickTypeName)}</span>
                <strong style="font-size:0.78rem;">${esc(t.componentName)}</strong>
                <span style="font-size:0.72rem; color:var(--accent-emerald); font-family:var(--code-font);">[${t.componentId}]</span>
                ${jumpChip(t.idx, opName(t.mod))}
                <button class="btn btn-secondary" style="padding:1px 8px; font-size:0.7rem; margin-left:auto;" onclick="fireInteractionTarget(${index})" title="Dispatch through CoreDocument.onClick at the centre of these bounds">▶ Fire</button>
            </div>
            <div style="font-family:var(--code-font); font-size:0.72rem; color:${empty ? 'var(--accent-amber)' : 'var(--text-secondary)'}; margin-bottom:3px;">${esc(boundsStr)}${empty ? '  — zero-sized, cannot be hit' : ''}</div>
            ${!t.dispatchable ? `<div style="font-size:0.69rem; color:var(--accent-amber); margin-bottom:3px;">MultiClickModifier.onClick only dispatches a single tap, so this ${esc(t.clickTypeName)} never fires in this player.</div>` : ''}
            ${actionsHtml}
            ${firedNote ? `<div style="margin-top:4px;">${firedNote}</div>` : ''}
        </div>`;
}

export function renderInteractionPanel() {
    const container = document.getElementById('interactionPanelBody');
    if (!container) return;
    const doc = window.currentDocument;
    if (!doc) {
        container.innerHTML = `<div style="text-align:center; padding:28px; color:var(--text-muted);">No document loaded yet.</div>`;
        return;
    }

    const targets = collectInteractionTargets(doc);
    if (!targets.length) {
        container.innerHTML = `<div style="padding:14px; color:var(--text-muted); font-size:0.78rem; line-height:1.5;">
            This document has no click modifiers, click areas or touch expressions. Nothing in it responds to input.</div>`;
        return;
    }

    const clicks = targets.filter(t => t.kind === 'click').length;
    const areas = targets.filter(t => t.kind === 'area').length;
    const touches = targets.filter(t => t.kind === 'touch').length;
    const noAction = targets.filter(t => t.kind === 'click' && t.actions.length === 0).length;
    const zeroSized = targets.filter(t => t.bounds && (t.bounds.w <= 0 || t.bounds.h <= 0)).length;

    const warn = [];
    if (noAction) warn.push(`${noAction} click target${noAction === 1 ? ' has' : 's have'} no actions`);
    if (zeroSized) warn.push(`${zeroSized} target${zeroSized === 1 ? ' is' : 's are'} zero-sized and cannot be hit`);

    container.innerHTML = `
        <div style="display:flex; gap:10px; align-items:center; font-size:0.72rem; color:var(--text-secondary); margin-bottom:8px; flex-wrap:wrap;">
            ${clicks ? `<span><strong style="color:var(--accent-emerald);">${clicks}</strong> click</span>` : ''}
            ${areas ? `<span><strong style="color:var(--accent-amber);">${areas}</strong> area</span>` : ''}
            ${touches ? `<span><strong style="color:#a855f7;">${touches}</strong> drag</span>` : ''}
        </div>
        ${warn.length ? `<div style="padding:5px 9px; border:1px solid rgba(251,191,36,0.4); background:rgba(251,191,36,0.1); border-radius:5px; color:var(--accent-amber); font-size:0.72rem; margin-bottom:8px;">⚠️ ${esc(warn.join(' · '))}</div>` : ''}
        ${targets.map(targetCardHtml).join('')}`;
}
