// Accessibility: what a screen reader would find in this document.
//
// A RemoteCompose document ships to a device where it is read aloud, but until now nothing
// in the inspector surfaced that side of it. AccessibilitySemantics (250) appeared only as a
// name in the opcode table, and the document's own contentDescription was not shown anywhere.
//
// The tree here is the component tree with the accessible parts kept: a component appears if
// it carries semantics, is clickable, or has an accessible name — plus its ancestors, so the
// structure a reader traverses stays intact. Nodes with no accessible name are called out,
// because a clickable component a screen reader cannot name is the defect this panel exists
// to find.

import { getRootComponent, componentIdOf, componentName, componentBounds, modifiersOf, walkComponents } from './ComponentWalk.js';

const OP_SEMANTICS = 250;
const OP_CLICK_AREA = 64;
const OP_CLICK_MODIFIER = 59;
const OP_MULTI_CLICK_MODIFIER = 83;
const OP_CORE_TEXT = 239;
const OP_TEXT_LAYOUT = 208;

function opCodeOf(op) {
    if (!op) return -1;
    return op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : -1);
}

function textOf(doc, id) {
    if (!doc || id === undefined || id === null || id <= 0) return null;
    try {
        const t = typeof doc.getText === 'function' ? doc.getText(id) : null;
        return t || null;
    } catch (e) { return null; }
}

/**
 * Build the accessible tree.
 *
 * `role`, `mode` and the state description are reported as the raw values the wire carries.
 * The TypeScript player declares no names for them — inventing labels here would be guessing
 * at a mapping the player itself does not make.
 */
export function buildAccessibilityTree(doc) {
    const nodes = [];
    if (!doc) return { nodes, documentDescription: null, hasSemantics: false };

    const root = getRootComponent(doc);
    walkComponents(root, (comp, depth) => {
        const mods = modifiersOf(comp);
        const semantics = mods.filter(m => opCodeOf(m) === OP_SEMANTICS);
        const clickable = mods.some(m => {
            const c = opCodeOf(m);
            return c === OP_CLICK_MODIFIER || c === OP_MULTI_CLICK_MODIFIER;
        });

        // Text the component draws, which is what a reader falls back to. CoreText is itself a
        // component rather than a child operation, so the component's own mTextId comes first —
        // looking only at children finds nothing for exactly the nodes that carry the text.
        let ownText = textOf(doc, comp.mTextId);
        if (!ownText) {
            const children = typeof comp.getList === 'function' ? comp.getList() : (comp.mChildren || []);
            if (Array.isArray(children)) {
                for (const child of children) {
                    const c = opCodeOf(child);
                    if (c === OP_CORE_TEXT || c === OP_TEXT_LAYOUT || child.mTextId !== undefined) {
                        const t = textOf(doc, child.mTextId);
                        if (t) { ownText = t; break; }
                    }
                }
            }
        }

        const sem = semantics[0] || null;
        const contentDescription = sem ? textOf(doc, sem.mContentDescriptionId) : null;
        const semanticsText = sem ? textOf(doc, sem.mTextId) : null;
        const stateDescription = sem ? textOf(doc, sem.mStateDescriptionId) : null;

        const accessibleName = contentDescription || semanticsText || ownText || null;
        if (!sem && !clickable && !ownText) return; // nothing accessible about this node

        nodes.push({
            comp, depth,
            componentId: componentIdOf(comp),
            name: componentName(comp),
            bounds: componentBounds(comp),
            hasSemantics: !!sem,
            role: sem ? sem.mRole : null,
            mode: sem ? sem.mMode : null,
            enabled: sem ? sem.mEnabled : null,
            semanticsClickable: sem ? sem.mClickable : null,
            clickable,
            contentDescription, semanticsText, stateDescription, ownText,
            accessibleName
        });
    });

    // ClickArea carries its own content description and is registered with the document
    // during paint rather than living on a component.
    const areas = [];
    const registered = doc.mClickAreas;
    if (registered && typeof registered.forEach === 'function') {
        registered.forEach(a => areas.push({
            id: a.id, contentDescription: a.contentDescription || null,
            bounds: { x: a.left, y: a.top, w: a.right - a.left, h: a.bottom - a.top }
        }));
    }
    if (!areas.length && Array.isArray(window.currentParsedOps)) {
        window.currentParsedOps.forEach(op => {
            if (opCodeOf(op) !== OP_CLICK_AREA) return;
            areas.push({
                id: op.mId, contentDescription: textOf(doc, op.mContentDescriptionId),
                bounds: { x: op.mOutLeft, y: op.mOutTop, w: (op.mOutRight ?? 0) - (op.mOutLeft ?? 0), h: (op.mOutBottom ?? 0) - (op.mOutTop ?? 0) }
            });
        });
    }

    const documentDescription = typeof doc.getContentDescription === 'function'
        ? (doc.getContentDescription() || null) : null;

    return { nodes, areas, documentDescription, hasSemantics: nodes.some(n => n.hasSemantics) };
}

function esc(s) {
    return typeof window.escapeHtml === 'function' ? window.escapeHtml(String(s)) : String(s);
}

function nodeRowHtml(n) {
    const indent = Math.min(n.depth, 12) * 14;
    const unnamed = !n.accessibleName;
    const flags = [];
    if (n.clickable) flags.push('clickable');
    if (n.hasSemantics && n.enabled === false) flags.push('disabled');
    if (n.role !== null && n.role !== undefined && n.role !== 0) flags.push(`role ${n.role}`);
    if (n.stateDescription) flags.push(`state “${n.stateDescription}”`);

    const nameHtml = unnamed
        ? `<span style="color:var(--accent-amber); font-style:italic;">no accessible name</span>`
        : `<span style="color:var(--text-primary);">“${esc(n.accessibleName)}”</span>`;

    const source = n.contentDescription ? 'contentDescription'
        : n.semanticsText ? 'semantics text'
        : n.ownText ? 'drawn text' : null;

    return `
        <div style="padding:3px 0 3px ${indent}px; border-left:${unnamed && n.clickable ? '2px solid var(--accent-amber)' : '2px solid transparent'}; padding-left:${indent + 6}px;">
            <div style="display:flex; gap:6px; align-items:baseline; flex-wrap:wrap;">
                ${n.hasSemantics ? '<span class="badge" style="background:#0ea5e9;">semantics</span>' : ''}
                <span style="font-family:var(--code-font); font-size:0.74rem; color:var(--text-secondary);">${esc(n.name)}</span>
                <span style="font-family:var(--code-font); font-size:0.7rem; color:var(--accent-emerald);">[${n.componentId}]</span>
                ${nameHtml}
                ${source ? `<span style="font-size:0.66rem; color:var(--text-muted);">via ${esc(source)}</span>` : ''}
            </div>
            ${flags.length ? `<div style="font-size:0.68rem; color:var(--text-muted); padding-left:2px;">${esc(flags.join(' · '))}</div>` : ''}
        </div>`;
}

export function renderAccessibilityPanel() {
    const container = document.getElementById('accessibilityPanelBody');
    if (!container) return;
    const doc = window.currentDocument;
    if (!doc) {
        container.innerHTML = `<div style="text-align:center; padding:28px; color:var(--text-muted);">No document loaded yet.</div>`;
        return;
    }

    const tree = buildAccessibilityTree(doc);
    const unnamedClickable = tree.nodes.filter(n => n.clickable && !n.accessibleName).length;

    const docHtml = `
        <div style="padding:7px 10px; border:1px solid var(--border-color); border-radius:5px; margin-bottom:8px;">
            <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:2px;">Document contentDescription</div>
            ${tree.documentDescription
                ? `<div style="font-size:0.8rem; color:var(--text-primary);">“${esc(tree.documentDescription)}”</div>`
                : `<div style="font-size:0.76rem; color:var(--accent-amber);">not set — the document as a whole has no accessible name</div>`}
        </div>`;

    const warnHtml = unnamedClickable ? `
        <div style="padding:5px 9px; border:1px solid rgba(251,191,36,0.4); background:rgba(251,191,36,0.1); border-radius:5px; color:var(--accent-amber); font-size:0.72rem; margin-bottom:8px;">
            ⚠️ ${unnamedClickable} clickable component${unnamedClickable === 1 ? '' : 's'} with no accessible name — a screen reader cannot announce ${unnamedClickable === 1 ? 'it' : 'them'}.
        </div>` : '';

    const areasHtml = (tree.areas && tree.areas.length) ? `
        <div style="margin-top:10px;">
            <div style="font-size:0.72rem; font-weight:600; color:var(--text-secondary); margin-bottom:4px;">Click areas (${tree.areas.length})</div>
            ${tree.areas.map(a => `
                <div style="font-size:0.74rem; padding:2px 0; display:flex; gap:8px; align-items:baseline;">
                    <span style="font-family:var(--code-font); color:var(--accent-emerald);">id ${a.id}</span>
                    ${a.contentDescription
                        ? `<span style="color:var(--text-primary);">“${esc(a.contentDescription)}”</span>`
                        : `<span style="color:var(--accent-amber); font-style:italic;">no contentDescription</span>`}
                    <span style="font-family:var(--code-font); font-size:0.68rem; color:var(--text-muted);">${Math.round(a.bounds.w)}×${Math.round(a.bounds.h)}</span>
                </div>`).join('')}
        </div>` : '';

    const treeHtml = tree.nodes.length
        ? `<div style="margin-top:4px;">${tree.nodes.map(nodeRowHtml).join('')}</div>`
        : `<div style="font-size:0.76rem; color:var(--text-muted); padding:8px 0; line-height:1.5;">
             No component in this document carries accessibility semantics, is clickable, or draws text.
             Nothing here would be announced beyond the document description above.</div>`;

    const noteHtml = !tree.hasSemantics && tree.nodes.length ? `
        <div style="margin-top:8px; font-size:0.69rem; color:var(--text-muted); line-height:1.5;">
            No AccessibilitySemantics (op 250) in this document — every name above is inferred from
            drawn text, which is what a reader would fall back to rather than something the document states.
        </div>` : '';

    container.innerHTML = docHtml + warnHtml + treeHtml + areasHtml + noteHtml;
}
