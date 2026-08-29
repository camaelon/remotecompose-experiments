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

/**
 * The translation an ancestor scroll applies to this component, in the same sense the engine
 * uses: `ScrollModifier.paint` ends in `pc.translate(mScrollX, mScrollY)`, and mScrollY is
 * negative once a list is scrolled down. So a displayed position is the laid-out position
 * *plus* this — scrolling down moves content up.
 *
 * It has to be computed separately because `getLocationInWindow()` walks up summing each
 * parent's position and stops there; it never accounts for scroll. That is right for the
 * engine, which hit-tests in unscrolled layout coordinates, but it means a component inside a
 * scrolling list reports where it would sit if the list were at the top.
 */
export function accumulatedScroll(comp) {
    let x = 0;
    let y = 0;
    // Start at the parent: a component's own scroll modifier moves what is inside it, so a
    // scrolling container's own box is not displaced by its own scroll position.
    let node = comp && (typeof comp.getParent === 'function' ? comp.getParent() : comp.mParent);
    while (node) {
        const mod = typeof node.getScrollModifier === 'function' ? node.getScrollModifier() : null;
        if (mod) {
            if (typeof mod.getScrollX === 'function') x += mod.getScrollX();
            if (typeof mod.getScrollY === 'function') y += mod.getScrollY();
        }
        node = typeof node.getParent === 'function' ? node.getParent() : node.mParent;
    }
    return { x, y };
}

// Modifiers that clip their component's children to its box. A scrolling container carries
// one of these alongside the scroll modifier — that is what keeps the list inside its frame.
const CLIP_OPCODES = new Set([54, 108]);   // RoundedClipRect, ClipRect

export function clipsChildren(comp) {
    return modifiersOf(comp).some(m => {
        const code = m && (m.OP_CODE !== undefined ? m.OP_CODE : m.constructor && m.constructor.OP_CODE);
        return CLIP_OPCODES.has(code);
    });
}

/**
 * A scrolling container, which is the clip worth drawing.
 *
 * Plenty of components clip — a rounded chip clips its own children — and outlining every one
 * of them buries the signal: on one sample document that is 77 frames, mostly a few pixels
 * across. A scroll container is the case where the clip explains something surprising, namely
 * that the content is many times taller than the box it is showing through.
 */
export function isScrollContainer(comp) {
    return !!(comp && typeof comp.getScrollModifier === 'function' && comp.getScrollModifier());
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

// ---------------------------------------------------------------------------
// Layer model — the component tree as a stack of drawn planes.
// ---------------------------------------------------------------------------

// Components that put pixels on screen by being themselves rather than by containing a draw
// operation. This is the part that is easy to get wrong: in this engine text and images are
// *components*, so a document can be full of visible content while not one component's own
// operation list holds a DrawText or DrawBitmap.
const SELF_DRAWING = /^(CoreText|TextLayout|ImageLayout|CanvasContent|CanvasLayout)$/;

// Modifiers that paint behind a component's children.
const PAINTING_MODIFIER = /Background|Border|Ripple|Shadow/;

// Operations that put pixels on a canvas.
const DRAW_OPCODES = new Set([42, 43, 44, 46, 47, 48, 49, 51, 52, 56, 66, 124, 125, 133, 149, 152, 190]);

function opCodeOf(op) {
    if (!op) return -1;
    return op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : -1);
}

// Visibility, mirroring `Visibility` in the player. The plain values are GONE/VISIBLE/
// INVISIBLE; the override bits above them win when any of them is set, which is how a state
// change forces a component on or off regardless of its declared value.
const VIS_GONE = 0;
const VIS_VISIBLE = 1;
const VIS_INVISIBLE = 2;
const VIS_OVERRIDE_GONE = 16;
const VIS_OVERRIDE_VISIBLE = 32;
const VIS_OVERRIDE_INVISIBLE = 64;

export function isVisibleComponent(comp) {
    if (!comp) return false;
    const v = comp.mVisibility;
    if (v === undefined || v === null) return true;   // not a component that declares one
    if ((v >> 4) > 0) return (v & VIS_OVERRIDE_VISIBLE) === VIS_OVERRIDE_VISIBLE;
    return v === VIS_VISIBLE;
}

/**
 * GONE and INVISIBLE are different states and the stack treats them differently: GONE is not
 * laid out at all, so it has no place and no size, while INVISIBLE occupies its space and is
 * simply not painted. One is absent, the other is present but unseen.
 */
export function componentVisibility(comp) {
    if (!comp) return 'gone';
    const v = comp.mVisibility;
    if (v === undefined || v === null) return 'visible';
    if ((v >> 4) > 0) {
        if ((v & VIS_OVERRIDE_GONE) === VIS_OVERRIDE_GONE) return 'gone';
        if ((v & VIS_OVERRIDE_INVISIBLE) === VIS_OVERRIDE_INVISIBLE) return 'invisible';
        return 'visible';
    }
    if (v === VIS_GONE) return 'gone';
    if (v === VIS_INVISIBLE) return 'invisible';
    return 'visible';
}

/** Visibility with ancestors folded in — the most restrictive state along the chain wins. */
export function effectiveVisibility(comp) {
    let state = 'visible';
    let node = comp;
    let hops = 0;
    while (node && hops++ < 64) {
        const own = componentVisibility(node);
        if (own === 'gone') return 'gone';
        if (own === 'invisible') state = 'invisible';
        node = typeof node.getParent === 'function' ? node.getParent() : node.mParent;
    }
    return state;
}

export function isEffectivelyVisible(comp) {
    return effectiveVisibility(comp) === 'visible';
}

/** Why this component draws, or null when it is pure structure. */
export function drawingReason(comp) {
    if (!comp) return null;
    const name = componentName(comp);
    if (SELF_DRAWING.test(name)) return 'self-drawing';

    const own = (typeof comp.getList === 'function' ? comp.getList() : comp.mChildren) || [];
    if (Array.isArray(own) && own.some(op => DRAW_OPCODES.has(opCodeOf(op)))) return 'canvas draw';

    if (modifiersOf(comp).some(m => PAINTING_MODIFIER.test(componentName(m)))) return 'background';
    return null;
}

export function isDrawingComponent(comp) {
    return drawingReason(comp) !== null;
}

/**
 * Flatten the component tree into drawn planes.
 *
 * A component that draws gets a plane of its own and pushes its children one level further
 * out. A component that only groups other components keeps its parent's plane — it is still
 * in the model and still selectable, drawn as a wireframe, but it does not add a layer of
 * separation for something that was never painted.
 *
 * `order` is document order, which is paint order: later entries are drawn on top.
 */
export function buildLayerModel(doc) {
    const layers = [];
    const root = getRootComponent(doc);
    if (!root) return { layers, maxDepth: 0, drawn: 0, flattened: 0 };

    let order = 0;
    let maxDepth = 0;
    // Painted layers get consecutive planes in paint order. Nesting depth alone is not enough
    // here: this engine draws through leaf components (CoreText, ImageLayout), so a document
    // with hundreds of drawn components can be only two or three levels deep, and stacking by
    // depth would pile nearly everything onto one plane.
    let paintIndex = 0;

    let gone = 0;
    let invisible = 0;

    (function rec(comp, planeDepth, ancestorsVis) {
        if (!comp || typeof comp !== 'object') return;
        const id = componentIdOf(comp);
        const isComponent = id !== null && id !== undefined;
        let childDepth = planeDepth;
        // The most restrictive state along the chain wins: nothing inside a GONE component is
        // laid out, and nothing inside an INVISIBLE one is painted.
        const own = isComponent ? componentVisibility(comp) : 'visible';
        const vis = own === 'gone' || ancestorsVis === 'gone' ? 'gone'
            : (own === 'invisible' || ancestorsVis === 'invisible') ? 'invisible' : 'visible';
        const visible = vis === 'visible';

        if (isComponent) {
            const reason = drawingReason(comp);
            const drawing = reason !== null;
            const depth = planeDepth;
            maxDepth = Math.max(maxDepth, depth);
            layers.push({
                comp,
                componentId: id,
                name: componentName(comp),
                bounds: componentBounds(comp),
                depth,
                // A flattened container shares the plane of the last thing painted before it,
                // so it stays reachable without inserting a plane of its own.
                paintIndex: (drawing && visible) ? paintIndex++ : Math.max(0, paintIndex - 1),
                drawing,
                visible,
                vis,
                clips: isScrollContainer(comp),
                reason,
                order: order++
            });
            if (vis === 'gone') gone++;
            else if (vis === 'invisible') invisible++;
            if (drawing) childDepth = planeDepth + 1;
        }

        const kids = Array.isArray(comp.mChildrenComponents)
            ? comp.mChildrenComponents
            : ((typeof comp.getList === 'function' ? comp.getList() : comp.mChildren) || []);
        if (Array.isArray(kids)) kids.forEach(k => rec(k, childDepth, vis));
    })(root, 0, 'visible');

    return {
        layers,
        maxDepth,
        maxPaintIndex: Math.max(0, paintIndex - 1),
        gone,
        invisible,
        hidden: gone,
        drawn: layers.filter(l => l.drawing && l.visible).length,
        flattened: layers.filter(l => !l.drawing && l.visible).length
    };
}
