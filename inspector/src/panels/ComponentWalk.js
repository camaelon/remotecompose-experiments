// Shared walk over the inflated component tree.
//
// The flat operation list is the document's wire order; it does not say which component a
// modifier belongs to. Interaction and accessibility are both properties of a *component*
// — a click modifier without its component's bounds is not actionable, and a semantics
// modifier without its component is not placeable in a tree — so both panels walk the
// inflated tree instead, where a component owns its modifiers and knows its geometry.

export function getRootComponent(doc) {
    if (!doc) return null;
    return typeof doc.getRootLayoutComponent === 'function'
        ? doc.getRootLayoutComponent() : doc.mRootLayoutComponent;
}

export function componentIdOf(op) {
    if (!op) return null;
    return typeof op.getComponentId === 'function' ? op.getComponentId() : (op.mComponentId ?? null);
}

export function componentName(op) {
    if (typeof window.getOpName === 'function') return window.getOpName(op);
    return (op && op.constructor && op.constructor.name || 'Component').replace(/^_/, '');
}

/** Absolute position of a component in document space, and its measured size. */
export function componentBounds(comp) {
    if (!comp) return null;
    let x = comp.mX ?? 0;
    let y = comp.mY ?? 0;
    if (typeof comp.getLocationInWindow === 'function') {
        try {
            const loc = comp.getLocationInWindow();
            if (Array.isArray(loc) && loc.length >= 2) { x = loc[0]; y = loc[1]; }
        } catch (e) { /* fall back to local coordinates */ }
    }
    const w = comp.mWidth ?? 0;
    const h = comp.mHeight ?? 0;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

export function modifiersOf(comp) {
    if (!comp) return [];
    const mods = comp.mComponentModifiers;
    if (Array.isArray(mods)) return mods;
    if (mods && Array.isArray(mods.mList)) return mods.mList;
    return [];
}

function childComponentsOf(comp) {
    if (!comp) return [];
    if (Array.isArray(comp.mChildrenComponents)) return comp.mChildrenComponents;
    const list = typeof comp.getList === 'function' ? comp.getList() : comp.mChildren;
    return Array.isArray(list) ? list : [];
}

/**
 * Depth-first walk of the component tree. `visit` receives (component, depth, path).
 * Non-component entries in a child list are skipped; a component is anything carrying a
 * component id, which is how the inflated tree marks them.
 */
export function walkComponents(root, visit) {
    const seen = new Set();
    (function rec(comp, depth, path) {
        if (!comp || typeof comp !== 'object' || seen.has(comp)) return;
        seen.add(comp);
        const id = componentIdOf(comp);
        const isComponent = id !== null && id !== undefined;
        const nextPath = isComponent ? path.concat([comp]) : path;
        if (isComponent) visit(comp, depth, nextPath);
        childComponentsOf(comp).forEach(child => rec(child, isComponent ? depth + 1 : depth, nextPath));
    })(root, 0, []);
}
