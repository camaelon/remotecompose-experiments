// =========================================================================
// Test Helpers & Mock Browser Environment for RemoteCompose Inspector Tests
// =========================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, "..");

export function createMockElement(tagName = "div", id = "") {
    const classSet = new Set();
    const styleObj = {
        width: "",
        height: "",
        backgroundColor: "",
        display: "",
        setProperty(prop, val) {
            this[prop] = String(val);
        },
        removeProperty(prop) {
            delete this[prop];
        },
        getPropertyValue(prop) {
            return this[prop] || "";
        }
    };
    const datasetObj = {};
    const listeners = new Map();
    const children = [];
    let _innerHTML = "";
    let _textContent = "";
    let _value = "";

    const el = {
        tagName: tagName.toUpperCase(),
        id,
        options: [],
        children,
        style: styleObj,
        classList: {
            add(...classes) { classes.forEach(c => classSet.add(c)); },
            remove(...classes) { classes.forEach(c => classSet.delete(c)); },
            toggle(c, force) {
                if (force === true) { classSet.add(c); return true; }
                if (force === false) { classSet.delete(c); return false; }
                if (classSet.has(c)) { classSet.delete(c); return false; }
                classSet.add(c);
                return true;
            },
            contains(c) { return classSet.has(c); },
            values() { return Array.from(classSet); }
        },
        get className() { return Array.from(classSet).join(' '); },
        set className(val) {
            classSet.clear();
            String(val || '').split(/\s+/).filter(Boolean).forEach(c => classSet.add(c));
        },
        dataset: datasetObj,
        get innerHTML() { return _innerHTML; },
        set innerHTML(val) {
            _innerHTML = String(val);
            _textContent = _innerHTML.replace(/<[^>]*>/g, "");
        },
        get textContent() { return _textContent; },
        set textContent(val) {
            _textContent = String(val);
            _innerHTML = String(val);
        },
        get value() { return _value; },
        set value(val) { _value = String(val); },
        checked: false,
        disabled: false,
        width: 300,
        height: 300,
        offsetWidth: 300,
        offsetHeight: 300,
        scrollIntoView: () => {},
        focus: () => {},
        getBoundingClientRect: () => ({
            top: 0,
            left: 0,
            right: 300,
            bottom: 300,
            width: 300,
            height: 300,
            x: 0,
            y: 0
        }),
        click: () => {
            const clickHandlers = listeners.get("click") || [];
            clickHandlers.forEach(h => h({ target: el, preventDefault(){}, stopPropagation(){} }));
            if (typeof el.onclick === "function") {
                el.onclick({ target: el, preventDefault(){}, stopPropagation(){} });
            }
        },
        addEventListener(evt, handler) {
            if (!listeners.has(evt)) listeners.set(evt, []);
            listeners.get(evt).push(handler);
        },
        removeEventListener(evt, handler) {
            if (!listeners.has(evt)) return;
            const arr = listeners.get(evt);
            const idx = arr.indexOf(handler);
            if (idx >= 0) arr.splice(idx, 1);
        },
        dispatchEvent(evt) {
            const arr = listeners.get(evt.type) || [];
            arr.forEach(h => h(evt));
            return true;
        },
        appendChild(child) {
            children.push(child);
            child.parentNode = el;
            return child;
        },
        removeChild(child) {
            const idx = children.indexOf(child);
            if (idx >= 0) children.splice(idx, 1);
            child.parentNode = null;
            return child;
        },
        replaceChild(newChild, oldChild) {
            const idx = children.indexOf(oldChild);
            if (idx >= 0) children[idx] = newChild;
            newChild.parentNode = el;
            oldChild.parentNode = null;
            return oldChild;
        },
        cloneNode() {
            const clone = createMockElement(tagName, id);
            clone.innerHTML = _innerHTML;
            return clone;
        },
        closest(selector) {
            let curr = el;
            while (curr) {
                if (selector.startsWith('#') && curr.id === selector.slice(1)) return curr;
                if (selector.startsWith('.') && curr.classList?.contains(selector.slice(1))) return curr;
                if (curr.tagName?.toLowerCase() === selector.toLowerCase()) return curr;
                curr = curr.parentNode;
            }
            return null;
        },
        querySelector(selector) {
            return null;
        },
        querySelectorAll(selector) {
            return [];
        },
        getContext(type) {
            return mockCanvasContext;
        }
    };
    return el;
}

export const mockCanvasContext = {
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo(x, y) {},
    lineTo(x, y) {},
    quadraticCurveTo(x1, y1, x2, y2) {},
    bezierCurveTo(x1, y1, x2, y2, x3, y3) {},
    rect(x, y, w, h) {},
    roundRect(x, y, w, h, radii) {},
    arc(x, y, r, sa, ea) {},
    ellipse(x, y, rx, ry, rot, sa, ea) {},
    fill() {},
    stroke() {},
    fillRect(x, y, w, h) {},
    strokeRect(x, y, w, h) {},
    clearRect(x, y, w, h) {},
    fillText(text, x, y) {},
    strokeText(text, x, y) {},
    measureText(text) {
        return {
            width: (text || "").length * 8,
            actualBoundingBoxAscent: 10,
            actualBoundingBoxDescent: 3
        };
    },
    setLineDash(d) {},
    setTransform(a, b, c, d, e, f) {},
    transform(a, b, c, d, e, f) {},
    translate(x, y) {},
    scale(x, y) {},
    rotate(angle) {},
    clip() {},
    drawImage() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createConicGradient() { return { addColorStop() {} }; },
    createPattern() { return {}; },
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    shadowColor: "",
    shadowBlur: 0
};

export function setupMockEnvironment() {
    const elementsById = new Map();
    const storage = new Map();
    const windowListeners = new Map();

    const mockDocument = {
        createElement(tag) {
            return createMockElement(tag);
        },
        getElementById(id) {
            function find(node) {
                if (!node) return null;
                if (node.id === id) return node;
                if (node.children && Array.isArray(node.children)) {
                    for (const c of node.children) {
                        const res = find(c);
                        if (res) return res;
                    }
                }
                return null;
            }
            if (mockDocument.body) {
                const found = find(mockDocument.body);
                if (found) return found;
            }
            if (!elementsById.has(id)) {
                elementsById.set(id, createMockElement("div", id));
            }
            return elementsById.get(id);
        },
        querySelector(sel) {
            if (!sel) return null;
            if (sel.includes('#')) {
                const idMatch = sel.match(/#([a-zA-Z0-9_-]+)/);
                if (idMatch) return mockDocument.getElementById(idMatch[1]);
            }
            const res = mockDocument.querySelectorAll(sel);
            return res.length > 0 ? res[0] : null;
        },
        querySelectorAll(sel) {
            const results = [];
            function matches(node, selector) {
                if (!node || !node.tagName) return false;
                if (selector.startsWith('.')) {
                    const classes = selector.split('.').filter(Boolean);
                    return classes.every(cls => Boolean(node.classList && node.classList.contains(cls)));
                }
                if (selector.startsWith('#')) {
                    return node.id === selector.slice(1);
                }
                return node.tagName.toLowerCase() === selector.toLowerCase();
            }
            function collect(node) {
                if (matches(node, sel)) results.push(node);
                if (node.children && Array.isArray(node.children)) {
                    node.children.forEach(collect);
                }
            }
            if (mockDocument.body) collect(mockDocument.body);
            elementsById.forEach(el => {
                if (matches(el, sel) && !results.includes(el)) results.push(el);
            });
            return results;
        },
        addEventListener(evt, handler) {
            if (!windowListeners.has(evt)) windowListeners.set(evt, []);
            windowListeners.get(evt).push(handler);
        },
        removeEventListener(evt, handler) {
            if (!windowListeners.has(evt)) return;
            const arr = windowListeners.get(evt);
            const idx = arr.indexOf(handler);
            if (idx >= 0) arr.splice(idx, 1);
        },
        body: createMockElement("body", "body"),
        documentElement: createMockElement("html", "html"),
        activeElement: null
    };

    const mockLocalStorage = {
        getItem(k) { return storage.get(String(k)) || null; },
        setItem(k, v) { storage.set(String(k), String(v)); },
        removeItem(k) { storage.delete(String(k)); },
        clear() { storage.clear(); },
        get length() { return storage.size; },
        key(i) { return Array.from(storage.keys())[i] || null; }
    };

    globalThis.window = globalThis;
    globalThis.document = mockDocument;
    globalThis.localStorage = mockLocalStorage;
    globalThis.addEventListener = (evt, handler) => mockDocument.addEventListener(evt, handler);
    globalThis.removeEventListener = (evt, handler) => mockDocument.removeEventListener(evt, handler);
    globalThis.HTMLElement = class {};
    globalThis.customElements = {
        define() {},
        get() {}
    };
    globalThis.requestAnimationFrame = (cb) => {
        return setTimeout(() => {
            try { cb(performance.now()); } catch (e) {}
        }, 16);
    };
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    globalThis.Blob = class {
        constructor(parts, opts) {
            this.parts = parts;
            this.type = opts?.type || "";
        }
    };
    globalThis.URL = {
        createObjectURL() { return "blob:mock-url"; },
        revokeObjectURL() {}
    };
    globalThis.Image = class {
        constructor() {
            this.width = 100;
            this.height = 100;
        }
    };
    globalThis.Path2D = class {
        constructor() {}
        moveTo() {}
        lineTo() {}
        quadraticCurveTo() {}
        bezierCurveTo() {}
        closePath() {}
        arc() {}
        rect() {}
    };
    globalThis.FileReader = class {
        readAsArrayBuffer(blob) {
            setTimeout(() => {
                this.result = blob.parts ? blob.parts[0] : new ArrayBuffer(0);
                if (typeof this.onload === "function") this.onload({ target: this });
            }, 0);
        }
        readAsText(blob) {
            setTimeout(() => {
                this.result = typeof blob === "string" ? blob : "";
                if (typeof this.onload === "function") this.onload({ target: this });
            }, 0);
        }
    };

    globalThis.escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    return { mockDocument, elementsById, mockLocalStorage };
}

setupMockEnvironment();

export function loadSampleRcBuffer(filename = "02_ticker.rc") {
    const filePath = path.join(PROJECT_ROOT, "samples", filename);
    if (!fs.existsSync(filePath)) {
        throw new Error("Sample file not found: " + filePath);
    }
    const buf = fs.readFileSync(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

let cachedRcModulePromise = null;
const sampleDocCache = new Map();

export async function loadSampleDocument(filename = "02_ticker.rc") {
    setupMockEnvironment();
    if (!cachedRcModulePromise) {
        cachedRcModulePromise = import(path.join(PROJECT_ROOT, "dist", "remote_compose_player.js"));
    }
    await cachedRcModulePromise;
    const RC = globalThis.RC || globalThis.window.RC;
    if (!RC || !RC.RcdPlayer) {
        throw new Error("RC.RcdPlayer not found on globalThis/window");
    }
    const canvas = globalThis.document.getElementById("previewCanvas");
    const player = new RC.RcdPlayer(canvas);
    const arrayBuffer = loadSampleRcBuffer(filename);
    const doc = await player.loadFromArrayBuffer(arrayBuffer);
    if (typeof player.pause === 'function') {
        player.pause();
    }
    globalThis.currentPlayer = player;
    globalThis.currentDocument = doc;
    globalThis.currentBuffer = arrayBuffer;
    return { player, doc, arrayBuffer, RC };
}
