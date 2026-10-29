// The browser surface the inspector's panels and the TypeScript player touch, for running
// them in Node with no browser. Grown from inspector/tests/test_helpers.js, with one real
// difference: text is measured. The player lays text out from measureText().width alone,
// so a font-size-aware estimate (Helvetica advance widths) gives layouts close to a
// browser's; the test mock's fixed 8 px per character did not.

// Helvetica/Arial advance widths for ASCII 32..126, in 1/1000 em (the standard AFM metrics).
const ADVANCE = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ../
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 0 .. ?
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // @ .. O
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // P .. _
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // ` .. o
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,      // p .. ~
];

function advance(cp) {
    if (cp >= 32 && cp <= 126) return ADVANCE[cp - 32];
    if (cp < 32) return 0;
    // CJK, kana, hangul and fullwidth forms are square; emoji roughly so.
    if ((cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || cp >= 0x1f000) return 1000;
    if (cp >= 0x300 && cp <= 0x36f) return 0;   // combining marks
    return 556;
}

function fontSizePx(font) {
    const m = /(\d+(?:\.\d+)?)px/.exec(font || "");
    return m ? Number(m[1]) : 10;
}

export function measureTextWidth(text, font) {
    const size = fontSizePx(font);
    let w = 0;
    for (const ch of String(text ?? "")) w += advance(ch.codePointAt(0));
    if (/\bbold\b|\b[6-9]00\b/.test(font || "")) w *= 1.06;
    return (w / 1000) * size;
}

function createContext2D(canvas) {
    const ctx = {
        canvas,
        font: "10px sans-serif",
        measureText(text) {
            const size = fontSizePx(ctx.font);
            return {
                width: measureTextWidth(text, ctx.font),
                actualBoundingBoxAscent: size * 0.72, actualBoundingBoxDescent: size * 0.21,
                fontBoundingBoxAscent: size * 0.93, fontBoundingBoxDescent: size * 0.22,
                actualBoundingBoxLeft: 0, actualBoundingBoxRight: measureTextWidth(text, ctx.font),
            };
        },
        getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, is2D: true, isIdentity: true, inverse() { return this; } }; },
        createLinearGradient() { return { addColorStop() {} }; },
        createRadialGradient() { return { addColorStop() {} }; },
        createConicGradient() { return { addColorStop() {} }; },
        createPattern() { return { setTransform() {} }; },
        createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }; },
        getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }; },
        isPointInPath() { return false; },
        isPointInStroke() { return false; },
        getLineDash() { return []; },
        fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
        miterLimit: 10, globalAlpha: 1, globalCompositeOperation: "source-over", shadowColor: "", shadowBlur: 0,
        shadowOffsetX: 0, shadowOffsetY: 0, textAlign: "start", textBaseline: "alphabetic", filter: "none",
        imageSmoothingEnabled: true, letterSpacing: "0px", direction: "ltr",
    };
    // Every drawing call is a no-op: nothing is rasterised here (rc-render's C++ engine
    // makes the pictures), only layout and state matter.
    for (const name of ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo",
        "bezierCurveTo", "rect", "roundRect", "arc", "arcTo", "ellipse", "fill", "stroke", "fillRect", "strokeRect",
        "clearRect", "fillText", "strokeText", "setLineDash", "setTransform", "resetTransform", "transform",
        "translate", "scale", "rotate", "clip", "drawImage", "putImageData", "reset", "drawFocusIfNeeded"]) {
        ctx[name] = () => {};
    }
    return ctx;
}

function createElement(tagName = "div", id = "") {
    const listeners = new Map();
    const children = [];
    const el = {
        tagName: tagName.toUpperCase(), id, children, dataset: {}, attributes: {},
        style: { setProperty(k, v) { this[k] = String(v); }, removeProperty(k) { delete this[k]; }, getPropertyValue(k) { return this[k] || ""; } },
        classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
        className: "", innerHTML: "", textContent: "", value: "", checked: false, disabled: false, hidden: false,
        width: 300, height: 150, offsetWidth: 300, offsetHeight: 150, clientWidth: 300, clientHeight: 150,
        getBoundingClientRect() { return { top: 0, left: 0, x: 0, y: 0, right: el.width, bottom: el.height, width: el.width, height: el.height }; },
        addEventListener(t, h) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(h); },
        removeEventListener(t, h) { const a = listeners.get(t); if (a) { const i = a.indexOf(h); if (i >= 0) a.splice(i, 1); } },
        dispatchEvent(ev) { (listeners.get(ev.type) || []).forEach((h) => h(ev)); return true; },
        appendChild(c) { children.push(c); c.parentNode = el; return c; },
        removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); return c; },
        insertBefore(c) { children.push(c); return c; },
        remove() {}, setAttribute(k, v) { el.attributes[k] = String(v); }, getAttribute(k) { return el.attributes[k] ?? null; },
        removeAttribute(k) { delete el.attributes[k]; }, hasAttribute(k) { return k in el.attributes; },
        querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
        scrollIntoView() {}, focus() {}, blur() {}, click() {},
        setPointerCapture() {}, releasePointerCapture() {},
        getContext(type) { return type === "2d" ? (el._ctx ??= createContext2D(el)) : null; },
        toDataURL() { return "data:image/png;base64,"; },
    };
    return el;
}

export function installEnvironment() {
    const byId = new Map();
    const document = {
        createElement: (t) => createElement(t),
        createElementNS: (_ns, t) => createElement(t),
        createTextNode: (t) => ({ textContent: t }),
        getElementById(id) { if (!byId.has(id)) byId.set(id, createElement("div", id)); return byId.get(id); },
        querySelector: () => null, querySelectorAll: () => [],
        addEventListener() {}, removeEventListener() {},
        body: createElement("body", "body"), documentElement: createElement("html", "html"), activeElement: null,
        fonts: { add() {}, load: async () => [], ready: Promise.resolve() },
    };
    const store = new Map();
    Object.assign(globalThis, {
        window: globalThis, self: globalThis, document,
        localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
        addEventListener() {}, removeEventListener() {},
        HTMLElement: class {}, HTMLCanvasElement: class {}, customElements: { define() {}, get() {} },
        requestAnimationFrame: () => 0, cancelAnimationFrame() {},
        devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800,
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
        Image: class { constructor() { this.width = 0; this.height = 0; } set src(_v) {} },
        ImageData: class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } },
        Path2D: class { addPath() {} moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} closePath() {} arc() {} arcTo() {} ellipse() {} rect() {} roundRect() {} },
        FontFace: class { constructor() {} load() { return Promise.resolve(this); } },
        escapeHtml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    });
    globalThis.URL.createObjectURL ??= () => "blob:none";
    globalThis.URL.revokeObjectURL ??= () => {};
    return { createElement };
}
