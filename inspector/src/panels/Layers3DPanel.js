// Layers: the component tree as a stack of planes you can orbit.
//
// A flat tree tells you what contains what; it does not tell you what is drawn on top of
// what, or where two components overlap. This view answers that by giving every drawn
// component its own plane, separated along Z in paint order, and letting you rotate the
// stack to look at it edge-on.
//
// Components that only group other components are flattened — they keep their parent's plane
// instead of adding an empty layer — but stay in the model as wireframes so they remain
// selectable. Measured across the sample documents, flattening removes 37–59% of the planes,
// which is the difference between a readable stack and a solid block.
//
// Rendering is CSS 3D rather than a canvas: every quad is a real element, so hit-testing,
// hover and click-to-select come from the DOM and the selection wiring the tree already uses.
// The layers are parallel planes, so the one thing CSS 3D cannot do — interpenetrating
// geometry — never arises.

import { buildLayerModel, componentBounds, accumulatedScroll, isScrollContainer, effectiveVisibility } from './ComponentWalk.js';
import { selectLayoutComponent, getSelectedComponentOp } from './LayoutInspectorPanel.js';
import { getCoreTextParameters } from './CommandListPanel.js';

const MIN_PITCH = -89;
const MAX_PITCH = 89;

// "paint" gives every drawn component its own plane in the order it is painted, which is
// what shows one thing sitting on top of another. "nesting" separates by containment instead,
// which is the familiar hierarchy view but collapses almost flat on documents that draw
// through leaf components.
let stackMode = 'nesting';
// Scrolled content is laid out at full height, so without this the stack shows where things
// would be if the list were at the top rather than where they are on screen.
let applyScroll = true;
let showClips = true;
// Render a CoreText layer as the words it draws rather than its type and id. The stack is
// much easier to recognise when the text you can see on the canvas is the text on the plane.
let showText = false;
let captured = false;
let view = { pitch: 26, yaw: -24, zoom: 1, spacing: null, userZoom: false, pivot: null, panX: 0, panY: 0 };
let showFlattened = true;
let cachedModel = null;
let cachedDoc = null;
let cachedContent = null;
let hoveredIndex = -1;

export function resetLayers3DView() {
    view = { pitch: 26, yaw: -24, zoom: 1, spacing: null, userZoom: false, pivot: null, panX: 0, panY: 0 };
    renderLayers3DPanel();
}

export function setStackMode(mode) {
    stackMode = mode === 'nesting' ? 'nesting' : 'paint';
    view.spacing = null;   // the two modes need very different separations
    renderLayers3DPanel();
}

/** Plane index for a layer under the current mode. */
function planeOf(layer) {
    return stackMode === 'paint' ? layer.paintIndex : layer.depth;
}

/**
 * A default separation that fits the whole stack on screen: a few hundred components in paint
 * order need a much finer spacing than five nesting levels.
 */
function defaultSpacing(planeCount) {
    if (planeCount <= 1) return 24;
    return Math.max(1, Math.min(30, Math.round(560 / planeCount)));
}

export function setLayerSpacing(value) {
    view.spacing = Number(value) || 0;
    applySceneTransform();
    applyLayerDepths();
    fitToViewport();
}

/** Position a layer where it is displayed, rather than where it was laid out. */
function displayBounds(layer) {
    const b = layer.bounds;
    if (!b || !applyScroll) return b;
    const s = accumulatedScroll(layer.comp);
    if (!s.x && !s.y) return b;
    // Added, not subtracted: the engine translates by this value, and it is already negative
    // when a list has been scrolled down.
    return { ...b, x: b.x + s.x, y: b.y + s.y, cx: b.cx + s.x, cy: b.cy + s.y };
}

/**
 * The clip box each layer is subject to: the intersection of the displayed box of every
 * scrolling ancestor. A scrolling list is laid out well past its frame and only a window of it
 * is ever on screen, which is invisible in a stack of plain quads until the clip is drawn.
 */
function clipRectFor(layer, byComp) {
    let rect = null;
    let node = typeof layer.comp.getParent === 'function' ? layer.comp.getParent() : layer.comp.mParent;
    while (node) {
        if (isScrollContainer(node)) {
            const owner = byComp.get(node);
            const b = owner && displayBounds(owner);
            if (b) {
                rect = rect
                    ? { x: Math.max(rect.x, b.x), y: Math.max(rect.y, b.y),
                        r: Math.min(rect.r, b.x + b.w), b: Math.min(rect.b, b.y + b.h) }
                    : { x: b.x, y: b.y, r: b.x + b.w, b: b.y + b.h };
            }
        }
        node = typeof node.getParent === 'function' ? node.getParent() : node.mParent;
    }
    return rect;
}

/** Opacity for a layer given how much of it survives its clip. */
export function clipOpacityFor(shown) {
    return shown <= 0.001 ? 0.35 : shown < 0.999 ? 0.7 : 1;
}

function isDescendantOf(node, ancestor) {
    let n = node && (typeof node.getParent === 'function' ? node.getParent() : node.mParent);
    let hops = 0;
    while (n && hops++ < 64) {
        if (n === ancestor) return true;
        n = typeof n.getParent === 'function' ? n.getParent() : n.mParent;
    }
    return false;
}

/** How much of a layer survives its clip: 1 fully visible, 0 entirely clipped away. */
export function visibleFraction(bounds, clip) {
    if (!clip) return 1;
    const w = Math.max(0, Math.min(bounds.x + bounds.w, clip.r) - Math.max(bounds.x, clip.x));
    const h = Math.max(0, Math.min(bounds.y + bounds.h, clip.b) - Math.max(bounds.y, clip.y));
    const area = Math.max(1, bounds.w * bounds.h);
    return (w * h) / area;
}

/**
 * Show each layer's pixels from the live canvas.
 *
 * One snapshot of the whole canvas is shared by every quad, which each shows its own window
 * into it through `background-position`. Cropping per layer into its own image was the obvious
 * approach and the wrong one: those crops are baked at capture time, so the moment anything
 * scrolled, every layer carried pixels belonging to where it used to be. A shared snapshot
 * plus a per-quad offset is both cheaper — one `toDataURL` instead of one per layer — and
 * correct, because the offset is recomputed with the geometry on every frame.
 *
 * The honest limit remains: only what has been rendered can be shown, so layers scrolled out
 * of the visible window come back empty. And a window into the composite shows whatever the
 * neighbours painted there too — it is not the layer's private contribution.
 */
let capturedImage = null;
let capturedW = 0;
let capturedH = 0;
let lastGrab = 0;

function grabCanvas() {
    const canvas = document.getElementById('previewCanvas');
    if (!canvas || !canvas.width || !canvas.height) return false;
    try {
        capturedImage = canvas.toDataURL('image/png');
        capturedW = canvas.width;
        capturedH = canvas.height;
        lastGrab = Date.now();
        publishCapture();
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * The snapshot lives in a custom property on the scene so the data URL is written once. Put
 * inline on every quad it was 77MB of style strings for a 500-layer document; each quad now
 * carries only its own offset into it.
 */
function publishCapture() {
    const scene = document.getElementById('layers3dScene');
    if (!scene) return;
    if (capturedImage) {
        scene.style.setProperty('--layer-capture', `url(${capturedImage})`);
        scene.style.setProperty('--layer-capture-size', `${capturedW}px ${capturedH}px`);
    } else {
        scene.style.removeProperty('--layer-capture');
        scene.style.removeProperty('--layer-capture-size');
    }
}

/** Where this layer's window sits within the shared snapshot. */
function capturePosition(b) {
    return `${-Math.round(b.x)}px ${-Math.round(b.y)}px`;
}

export function captureLayerContent() {
    if (!grabCanvas()) return;
    captured = true;
    renderLayers3DPanel();
}

export function clearLayerContent() {
    captured = false;
    capturedImage = null;
    publishCapture();
    renderLayers3DPanel();
}

export function toggleTextContent() {
    showText = !showText;
    renderLayers3DPanel();
}

/** The text a component draws, and the size it draws it at, when it is a text component. */
function textOf(layer) {
    if (!/^(CoreText|TextLayout)$/.test(layer.name)) return null;
    try {
        const params = getCoreTextParameters(layer.comp, window.currentDocument);
        if (!params || !params.text) return null;
        return { text: params.text, size: params.fontSize || 12, color: params.cssColor || null };
    } catch (e) { return null; }
}

export function toggleClipAreas() {
    showClips = !showClips;
    renderLayers3DPanel();
}

export function toggleScrollOffset() {
    applyScroll = !applyScroll;
    renderLayers3DPanel();
}

export function toggleFlattenedLayers() {
    showFlattened = !showFlattened;
    renderLayers3DPanel();
}

/**
 * The extent the layers actually occupy, which is not the document size: a scrolling
 * container lays its children out at full content height, so a 400x800 document can hold a
 * component tree 5000px tall. Fitting to the header size buries most of the stack off-screen.
 */
function contentBounds(layers, docW, docH) {
    let minX = 0, minY = 0, maxX = docW, maxY = docH;
    layers.forEach(l => {
        const b = l.bounds;
        if (!b) return;
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
    });
    return { minX, minY, maxX, maxY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function docSize(doc) {
    const w = typeof doc.getWidth === 'function' ? doc.getWidth() : (doc.mHeader?.mWidth || 400);
    const h = typeof doc.getHeight === 'function' ? doc.getHeight() : (doc.mHeader?.mHeight || 400);
    return { w: w || 400, h: h || 400 };
}

function esc(s) {
    return typeof window.escapeHtml === 'function' ? window.escapeHtml(String(s)) : String(s);
}

/** Depth-tinted colour so a plane's height in the stack is readable without counting. */
function layerColor(depth, maxDepth) {
    const t = maxDepth > 0 ? depth / maxDepth : 0;
    const hue = 205 - t * 150;   // blue at the back, warm at the front
    return { stroke: `hsl(${hue}, 78%, 62%)`, fill: `hsla(${hue}, 78%, 58%, 0.14)` };
}

/**
 * Convert a screen-space drag into a displacement on the scene's XY plane.
 *
 * Every layer is parallel to that plane, so the projection inverts cleanly: CSS applies
 * `rotateX(a) rotateY(b)` right to left, giving screen_x = x·cos b and
 * screen_y = y·cos a + x·sin b·sin a. Solving back for x and y lets the pivot follow a pan,
 * which is what keeps rotation centred on the view rather than on the content.
 */
export function sceneDeltaToScreen(x, y, pitchDeg, yawDeg, zoom = 1) {
    const a = pitchDeg * Math.PI / 180;
    const b = yawDeg * Math.PI / 180;
    return {
        x: x * Math.cos(b) * zoom,
        y: (y * Math.cos(a) + x * Math.sin(b) * Math.sin(a)) * zoom
    };
}

export function screenDeltaToScene(dxScreen, dyScreen, pitchDeg, yawDeg, zoom = 1) {
    const a = pitchDeg * Math.PI / 180;
    const b = yawDeg * Math.PI / 180;
    const cb = Math.cos(b), ca = Math.cos(a);
    // Edge-on, the plane projects to a line and the inverse is undefined; clamp rather than
    // divide by zero and send the pivot to infinity.
    const cosB = Math.abs(cb) < 1e-3 ? (cb < 0 ? -1e-3 : 1e-3) : cb;
    const cosA = Math.abs(ca) < 1e-3 ? (ca < 0 ? -1e-3 : 1e-3) : ca;
    const z = zoom || 1;
    const x = (dxScreen / z) / cosB;
    const y = ((dyScreen / z) - x * Math.sin(b) * Math.sin(a)) / cosA;
    return { x, y };
}

function screenToScene(dxScreen, dyScreen) {
    return screenDeltaToScene(dxScreen, dyScreen, view.pitch, view.yaw, view.zoom);
}

/**
 * Move the pan into the pivot without changing what is on screen, so that rotation turns about
 * the middle of the view. Pan slides the flat image, which is right for panning and zooming but
 * would leave the rotation pivot off to one side; this converts it back into a scene point
 * before an orbit begins.
 */
function foldPanIntoPivot() {
    if (!view.panX && !view.panY) return;
    const pv = currentPivot();
    const d = screenToScene(-view.panX, -view.panY);
    view.pivot = { x: pv.x + d.x, y: pv.y + d.y };
    view.panX = 0;
    view.panY = 0;
    applySceneTransform();
}

/** The scene point held at the centre of the viewport, and thus the point rotation turns about. */
function currentPivot() {
    if (view.pivot) return view.pivot;
    return {
        x: cachedContent ? (cachedContent.minX + cachedContent.maxX) / 2 : 0,
        y: cachedContent ? (cachedContent.minY + cachedContent.maxY) / 2 : 0
    };
}

function applySceneTransform() {
    const scene = document.getElementById('layers3dScene');
    if (!scene) return;
    // The content offset has to be the innermost transform, not a margin: a margin is applied
    // in layout space, so it is not affected by the scale that follows it, and a tall
    // scrolling document would be shifted thousands of unscaled pixels off the viewport.
    // Transforms apply right to left, so this centres the content first, then scales, rotates
    // and finally parks the result in the middle of the viewport.
    const pivot = currentPivot();
    scene.style.transform =
        `translate(-50%, -50%) rotateX(${view.pitch}deg) rotateY(${view.yaw}deg) `
        + `translate(${-pivot.x}px, ${-pivot.y}px)`;

    // Zoom is a flat scale applied outside the perspective, so it magnifies the projected
    // image the way zooming a photo does. Folding it into the 3D transform scaled the layer
    // separation along with everything else, which read as the spacing slider moving on its own.
    // Zoom and pan are flat operations on the projected image, outside the perspective. Doing
    // them here rather than in the 3D transform is what keeps layer separation independent of
    // zoom, and it makes the cursor anchor exact at every depth instead of only on the pivot's
    // own plane — a 2D scale about a fixed origin is exactly invertible, a 3D one is not.
    const zoom = document.getElementById('layers3dZoom');
    if (zoom) zoom.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
}

function applyLayerDepths() {
    if (!cachedModel) return;
    // Centre the stack on its own depth so it rotates about the middle. Anchoring at plane 0
    // sends a deep stack off the side of the viewport as soon as it is tilted.
    const mid = (currentPlaneCount() - 1) / 2;
    const totalOrder = cachedModel.layers.length;
    document.querySelectorAll('#layers3dScene .layer-quad, #layers3dScene .layer-clip').forEach(el => {
        const plane = Number(el.dataset.plane) || 0;
        const order = Number(el.dataset.order) || 0;
        // A hair of per-component offset keeps co-planar quads from z-fighting, expressed as a
        // fraction of the spacing so it can never push a quad past its own plane. A fixed
        // offset did: in paint order the planes are ~2px apart and 500 components at 0.02
        // each spanned 10px, so late siblings drifted several planes forward.
        const nudge = totalOrder > 0 ? (order / totalOrder) * view.spacing * 0.4 : 0;
        const z = (plane - mid) * view.spacing + nudge;
        el.style.transform = `translate3d(${el.dataset.x}px, ${el.dataset.y}px, ${z}px)`;
    });
    const ground = document.querySelector('#layers3dScene .layer-ground');
    if (ground) ground.style.transform = `translate3d(0, 0, ${(-mid * view.spacing) - 14}px)`;
}

function currentPlaneCount() {
    if (!cachedModel) return 1;
    return (stackMode === 'paint' ? cachedModel.maxPaintIndex : cachedModel.maxDepth) + 1;
}

/**
 * Scale so the tilted stack fits. A deep stack is wider on screen than the document is,
 * because rotation projects its depth sideways — fitting to the document alone would push
 * the far planes out of view.
 */
function fitToViewport() {
    const viewport = document.getElementById('layers3dViewport');
    const doc = window.currentDocument;
    if (!viewport || !doc || view.userZoom || !cachedContent) return;
    const vb = viewport.getBoundingClientRect();
    if (!vb.width || !vb.height) return;
    const docW = cachedContent.w;
    const docH = cachedContent.h;
    const depth = (currentPlaneCount() - 1) * view.spacing;
    const yaw = Math.abs(view.yaw) * Math.PI / 180;
    const pitch = Math.abs(view.pitch) * Math.PI / 180;
    const spanX = docW * Math.cos(yaw) + depth * Math.sin(yaw);
    const spanY = docH * Math.cos(pitch) + depth * Math.sin(pitch);
    const fit = Math.min(vb.width / Math.max(1, spanX), vb.height / Math.max(1, spanY)) * 0.8;
    if (Number.isFinite(fit) && fit > 0) {
        view.zoom = fit;
        applySceneTransform();
    }
}

export function renderLayers3DPanel() {
    const host = document.getElementById('layers3dBody');
    if (!host) return;
    const doc = window.currentDocument;
    if (!doc) {
        host.innerHTML = `<div style="text-align:center; padding:28px; color:var(--text-muted);">No document loaded yet.</div>`;
        return;
    }

    if (cachedDoc !== doc || !cachedModel) {
        cachedModel = buildLayerModel(doc);
        cachedDoc = doc;
    }
    const { layers, maxDepth, maxPaintIndex, drawn, flattened, gone, invisible } = cachedModel;
    const planeCount = (stackMode === 'paint' ? maxPaintIndex : maxDepth) + 1;
    if (view.spacing === null) view.spacing = defaultSpacing(planeCount);
    const { w: docW, h: docH } = docSize(doc);
    cachedContent = contentBounds(layers.map(l => ({ bounds: displayBounds(l) })), docW, docH);
    // GONE is not laid out, so it has no place in a stack of what gets drawn — only its count
    // is reported. INVISIBLE does occupy its space and is worth seeing: it is the difference
    // between "this is not here" and "this is here and you cannot see it".
    const visible = layers.filter(l => l.vis !== 'gone' && (l.drawing || showFlattened));

    // Index by component so a layer can find the displayed box of a clipping ancestor. Kept on
    // the model because the per-frame refresh needs it as well.
    const byComp = new Map(layers.map(l => [l.comp, l]));
    cachedModel.byComp = byComp;

    const quads = visible.map((l, i) => {
        const b = displayBounds(l) || { x: 0, y: 0, w: 0, h: 0 };
        const clip = clipRectFor(l, byComp);
        const shown = visibleFraction(b, clip);
        // Clipped content is still part of the document and worth reading in the stack, just
        // visibly not on screen. On a long scrolling list most of the content is clipped at any
        // moment, so this is a gentle knock-down rather than a fade to nothing.
        const clipOpacity = clipOpacityFor(shown);
        const plane = planeOf(l);
        // Mauve marks a layer that is laid out but never painted.
        const c = l.vis === 'invisible'
            ? { stroke: '#c9a0dc', fill: 'rgba(201, 160, 220, 0.16)' }
            : layerColor(plane, planeCount - 1);
        const wire = !l.drawing;
        const w = Math.max(1, b.w);
        const h = Math.max(1, b.h);
        const drawn = (showText && !captured) ? textOf(l) : null;
        const label = drawn ? drawn.text : `${l.name}${l.componentId !== null ? ` [${l.componentId}]` : ''}`;
        const title = `${l.name}${l.componentId !== null ? ` [${l.componentId}]` : ''}`
            + `${drawn ? ` — “${drawn.text}”` : ''} — ${Math.round(b.w)}×${Math.round(b.h)} at ${Math.round(b.x)}, ${Math.round(b.y)}\n`
            + (wire ? `flattened container (no draw of its own) — shares plane ${plane}`
                     : `plane ${plane} · ${l.reason}`)
            + (l.vis === 'invisible' ? '\nINVISIBLE — laid out, taking up its space, but never painted' : '')
            + (shown <= 0.001 ? '\nclipped out — outside its container\'s clip area'
               : shown < 0.999 ? `\npartly clipped — ${Math.round(shown * 100)}% inside the clip area` : '');
        return `
            <div class="layer-quad${wire ? ' layer-wire' : ''}"
                 data-index="${layers.indexOf(l)}" data-plane="${plane}" data-order="${l.order}"
                 data-x="${b.x}" data-y="${b.y}"
                 title="${esc(title)}"
                 style="width:${w}px; height:${h}px;
                        border-color:${wire ? 'rgba(148,163,184,0.55)' : c.stroke};
                        ${captured
                            ? `background-image:var(--layer-capture); background-size:var(--layer-capture-size); background-repeat:no-repeat; background-position:${capturePosition(b)};`
                            : `background:${wire ? 'transparent' : c.fill};`}
                        opacity:${(wire ? 0.5 : 1) * clipOpacity};">
                <span class="layer-label${drawn ? ' layer-text' : ''}" ${captured ? 'hidden' : ''}
                      style="color:${drawn ? (drawn.color || '#e2e8f0') : (wire ? 'var(--text-muted)' : c.stroke)};${drawn ? ` font-size:${Math.max(4, Math.min(drawn.size, h))}px;` : ''}">${esc(label)}</span>
            </div>`;
    }).join('');

    // One red frame per clipping component, on that component's own plane.
    const clipFrames = !showClips ? '' : layers.filter(l => l.clips).map(l => {
        const b = displayBounds(l);
        if (!b) return '';
        // Sit the frame in front of everything it clips, not on the container's own plane. A
        // window belongs between you and what is behind it — drawn flat among the layers it
        // governs, it reads as just another one of them.
        let frontPlane = planeOf(l);
        layers.forEach(other => {
            if (other !== l && isDescendantOf(other.comp, l.comp)) {
                frontPlane = Math.max(frontPlane, planeOf(other));
            }
        });
        return `
            <div class="layer-clip" data-index="${layers.indexOf(l)}" data-plane="${frontPlane + 1}" data-order="${l.order}"
                 data-x="${b.x}" data-y="${b.y}"
                 title="${esc(`${l.name} clips its children to ${Math.round(b.w)}×${Math.round(b.h)}`)}"
                 style="width:${Math.max(1, b.w)}px; height:${Math.max(1, b.h)}px;"></div>`;
    }).join('');

    host.innerHTML = `
        <div class="layers3d-controls">
            <span style="font-size:0.72rem; color:var(--text-secondary);">
                <strong style="color:var(--accent-emerald);">${drawn}</strong> drawn ·
                <strong style="color:var(--text-muted);">${flattened}</strong> flattened ·
                ${planeCount} planes${invisible ? ` · <span style="color:#c9a0dc;" title="Laid out and taking up space, but never painted">${invisible} invisible</span>` : ''}${gone ? ` · <span style="color:var(--text-muted);" title="GONE: not laid out at all, and neither is anything inside them — no place in the stack">${gone} gone</span>` : ''}${cachedContent && cachedContent.h > docH * 1.05
                    ? ` · <span style="color:var(--accent-amber);" title="Components extend past the document viewport — a scrolling container lays its children out at full content height">content ${Math.round(cachedContent.w)}×${Math.round(cachedContent.h)} vs doc ${docW}×${docH}</span>`
                    : ''}
            </span>
            <label style="display:flex; align-items:center; gap:5px; font-size:0.71rem; color:var(--text-secondary);">
                Stack by
                <select class="dim-input" style="padding:1px 5px; font-size:0.7rem; min-width:104px;" onchange="setStackMode(this.value)">
                    <option value="paint"${stackMode === 'paint' ? ' selected' : ''}>Paint order</option>
                    <option value="nesting"${stackMode === 'nesting' ? ' selected' : ''}>Nesting</option>
                </select>
            </label>
            <label style="display:flex; align-items:center; gap:5px; font-size:0.71rem; color:var(--text-secondary);">
                Spacing
                <input type="range" min="0" max="80" value="${view.spacing}" style="width:96px;"
                       oninput="setLayerSpacing(this.value)">
            </label>
            <button class="btn btn-secondary" style="padding:2px 8px; font-size:0.71rem;"
                    onclick="${captured ? 'clearLayerContent()' : 'captureLayerContent()'}"
                    title="${captured
                        ? 'Drop the captured pixels and go back to outlines'
                        : 'Paint each layer with its pixels from the current frame. Only what is on screen can be captured.'}">
                ${captured ? '✕ Clear capture' : '📷 Capture'}
            </button>
            <button class="btn btn-secondary" style="padding:2px 8px; font-size:0.71rem;"
                    onclick="toggleTextContent()"
                    title="Show the words a text layer draws instead of its type and id">
                ${showText ? '☑' : '☐'} Text
            </button>
            <button class="btn btn-secondary" style="padding:2px 8px; font-size:0.71rem;"
                    onclick="toggleClipAreas()"
                    title="Outline the areas that clip their children, and fade what falls outside them">
                ${showClips ? '☑' : '☐'} Clips
            </button>
            <button class="btn btn-secondary" style="padding:2px 8px; font-size:0.71rem;"
                    onclick="toggleScrollOffset()"
                    title="Position layers where they are displayed, with scroll applied, rather than where they were laid out">
                ${applyScroll ? '☑' : '☐'} Scroll
            </button>
            <button class="btn btn-secondary" style="padding:2px 8px; font-size:0.71rem;"
                    onclick="toggleFlattenedLayers()"
                    title="Containers that draw nothing stay selectable as wireframes">
                ${showFlattened ? '☑' : '☐'} Containers
            </button>
            <button class="btn btn-secondary" style="padding:2px 8px; font-size:0.71rem;"
                    onclick="resetLayers3DView()">⟳ Reset view</button>
        </div>
        <div class="layers3d-viewport" id="layers3dViewport" title="Drag to orbit · shift-drag or middle-drag to pan · scroll to zoom">
          <div class="layers3d-zoom" id="layers3dZoom">
            <div class="layers3d-stage">
            <div class="layers3d-scene" id="layers3dScene">
                <div class="layer-ground" style="width:${docW}px; height:${docH}px;"></div>
                ${quads}
                ${clipFrames}
            </div>
            </div>
          </div>
          <div class="layers3d-hint">Drag to orbit · hold Shift to pan · scroll to zoom</div>
        </div>`;

    publishCapture();
    applySceneTransform();
    wireInteractions(docW, docH);
    applyLayerDepths();
    fitToViewport();
    highlightSelection();
    requestAnimationFrame(() => { fitToViewport(); });
}

function wireInteractions(docW, docH) {
    const viewport = document.getElementById('layers3dViewport');
    const scene = document.getElementById('layers3dScene');
    if (!viewport || !scene) return;

    // The scene is positioned at the viewport centre and the quads are laid out in document
    // coordinates, so the whole stack has to be shifted by half the document to orbit around
    // its middle rather than its top-left corner.


    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    let panning = false;

    viewport.addEventListener('contextmenu', (e) => e.preventDefault());
    viewport.addEventListener('pointerdown', (e) => {
        // Shift-drag, middle-drag or right-drag pans; a plain drag orbits; a plain click on a
        // quad selects it.
        panning = e.shiftKey || e.button === 1 || e.button === 2;
        if (!panning && e.target.closest('.layer-quad')) return;
        if (!panning) foldPanIntoPivot();
        dragging = true;
        lastX = e.clientX; lastY = e.clientY;
        try { viewport.setPointerCapture(e.pointerId); } catch (_) { /* no active pointer */ }
        viewport.classList.add(panning ? 'panning' : 'orbiting');
    });
    viewport.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        if (panning) {
            view.panX += e.clientX - lastX;
            view.panY += e.clientY - lastY;
        } else {
            view.yaw += (e.clientX - lastX) * 0.35;
            view.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, view.pitch - (e.clientY - lastY) * 0.35));
        }
        lastX = e.clientX; lastY = e.clientY;
        applySceneTransform();
    });
    const endDrag = (e) => {
        dragging = false;
        panning = false;
        viewport.classList.remove('orbiting', 'panning');
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();

        // Scale by how much the gesture actually moved, not a fixed step per event. A wheel
        // notch is one event, but a trackpad emits a stream of small ones — applying the same
        // factor to each compounded a gentle swipe into an enormous jump.
        const px = e.deltaMode === 1 ? e.deltaY * 16        // lines
                 : e.deltaMode === 2 ? e.deltaY * 400       // pages
                 : e.deltaY;                                // pixels
        // Pinch arrives as a wheel event with ctrlKey set, in much smaller increments.
        const sensitivity = e.ctrlKey ? 0.010 : 0.0022;
        // Exponential in the delta keeps each pixel of gesture worth the same *proportion* of
        // the current zoom, which is what makes it feel even at any magnification.
        const factor = Math.min(1.25, Math.max(0.8, Math.exp(-px * sensitivity)));

        const prev = view.zoom;
        view.zoom = Math.max(0.02, Math.min(6, prev * factor));
        const applied = view.zoom / prev;

        // Anchor on the cursor: keep whatever is under the pointer where it is, rather than
        // pulling everything towards the centre of the viewport.
        const rect = viewport.getBoundingClientRect();
        const offX = (e.clientX - rect.left) - rect.width / 2;
        const offY = (e.clientY - rect.top) - rect.height / 2;
        // screen = centre + pan + zoom · projected, so holding the point under the cursor fixed
        // is the plain 2D solve — and it holds for every layer, whatever its depth.
        view.panX = offX - (offX - view.panX) * applied;
        view.panY = offY - (offY - view.panY) * applied;

        view.userZoom = true;   // stop auto-fitting once the view has been zoomed by hand
        applySceneTransform();
    }, { passive: false });

    scene.addEventListener('click', (e) => {
        const quad = e.target.closest('.layer-quad');
        if (!quad) return;
        e.stopPropagation();
        const layer = cachedModel && cachedModel.layers[Number(quad.dataset.index)];
        if (!layer) return;
        // Same entry point the tree uses, so the box model and tree highlight follow along.
        selectLayoutComponent(layer.comp);
        highlightSelection();
    });

    scene.addEventListener('pointerover', (e) => {
        const quad = e.target.closest('.layer-quad');
        const idx = quad ? Number(quad.dataset.index) : -1;
        if (idx === hoveredIndex) return;
        hoveredIndex = idx;
        document.querySelectorAll('#layers3dScene .layer-quad').forEach(el => {
            el.classList.toggle('hovered', Number(el.dataset.index) === idx);
        });
    });
}

/**
 * Mirror the panel-wide component selection onto the stack, matching on the component object
 * itself — ids are not unique enough here, and the tree, the box model and this view all hold
 * the same live objects.
 */
export function highlightSelection() {
    if (!cachedModel) return;
    const selected = typeof getSelectedComponentOp === 'function' ? getSelectedComponentOp() : null;
    document.querySelectorAll('#layers3dScene .layer-quad').forEach(el => {
        const layer = cachedModel.layers[Number(el.dataset.index)];
        el.classList.toggle('selected', !!(selected && layer && layer.comp === selected));
    });
}

/**
 * Re-read the live component geometry onto the quads. Components move while the document
 * runs — an animation, a state change, a resized stage — and a stack drawn from bounds
 * captured once is a photograph, not an inspector.
 */
export function refreshLayers3DBounds() {
    const host = document.getElementById('layers3dBody');
    const sub = document.getElementById('layers3d');
    if (!host || !cachedModel || !sub || sub.classList.contains('hidden-panel')) return;

    // Visibility is state, not structure: a component can go GONE and come back as the document
    // runs. Both the set of layers and the planes they occupy depend on it, so this rebuilds
    // rather than nudging what is already on screen — and it has to run before the check for
    // moved geometry, because a component appearing does not move anything.
    if (cachedModel.layers.some(l => effectiveVisibility(l.comp) !== l.vis)) {
        cachedModel = null;
        renderLayers3DPanel();
        return;
    }

    let moved = false;
    cachedModel.layers.forEach(l => {
        const next = componentBounds(l.comp);
        if (!next || !l.bounds) return;
        const sc = applyScroll ? accumulatedScroll(l.comp) : { x: 0, y: 0 };
        if (next.x !== l.bounds.x || next.y !== l.bounds.y ||
            next.w !== l.bounds.w || next.h !== l.bounds.h ||
            sc.x !== l.scrollX || sc.y !== l.scrollY) {
            l.bounds = next;
            l.scrollX = sc.x;
            l.scrollY = sc.y;
            moved = true;
        }
    });
    if (!moved) return;

    // The canvas itself changes as the document scrolls or animates, so the snapshot is
    // refreshed too — throttled, since toDataURL is the expensive part.
    if (captured && Date.now() - lastGrab > 250) grabCanvas();

    const byComp = cachedModel.byComp;
    document.querySelectorAll('#layers3dScene .layer-quad').forEach(el => {
        const layer = cachedModel.layers[Number(el.dataset.index)];
        const b = layer && displayBounds(layer);
        if (!b) return;
        el.dataset.x = b.x;
        el.dataset.y = b.y;
        el.style.width = `${Math.max(1, b.w)}px`;
        el.style.height = `${Math.max(1, b.h)}px`;

        // The window into the snapshot moves with the layer, so captured pixels stay aligned
        // with where the layer actually is.
        if (captured) el.style.backgroundPosition = capturePosition(b);

        // Scrolling changes *which* layers are clipped, so the fade has to be recomputed with
        // the geometry. Setting it once at render left the first frame's answer on screen.
        if (byComp) {
            const shown = visibleFraction(b, clipRectFor(layer, byComp));
            const wire = !layer.drawing;
            el.style.opacity = `${(wire ? 0.5 : 1) * clipOpacityFor(shown)}`;
            const state = shown <= 0.001 ? 'out' : shown < 0.999 ? 'part' : 'in';
            if (el.dataset.clipState !== state) {
                el.dataset.clipState = state;
                const base = (el.title || '').split('\n').slice(0, 2).join('\n');
                el.title = base + (state === 'out' ? '\nclipped out — outside its container\'s clip area'
                    : state === 'part' ? `\npartly clipped — ${Math.round(shown * 100)}% inside the clip area` : '');
            }
        }
    });

    // The clip frames follow the same geometry. They were rendered once and never updated, so
    // they stayed behind whenever their container moved.
    document.querySelectorAll('#layers3dScene .layer-clip').forEach(el => {
        const layer = cachedModel.layers[Number(el.dataset.index)];
        const b = layer && displayBounds(layer);
        if (!b) return;
        el.dataset.x = b.x;
        el.dataset.y = b.y;
        el.style.width = `${Math.max(1, b.w)}px`;
        el.style.height = `${Math.max(1, b.h)}px`;
    });
    applyLayerDepths();
}

/** Drop the cached model when a new document is loaded. */
export function invalidateLayers3DModel() {
    captured = false;
    capturedImage = null;
    cachedModel = null;
    cachedDoc = null;
    cachedContent = null;
    view.spacing = null;
    view.userZoom = false;
    // Rebuild straight away when the tab is on screen, otherwise the panel keeps showing the
    // previous document's stack until something else happens to re-render it.
    const sub = document.getElementById('layers3d');
    if (sub && !sub.classList.contains('hidden-panel')) renderLayers3DPanel();
}
