"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOST_ACTION_STRING_TYPE = exports.SEMANTICS_MODE_SET = exports.Writer = exports.TYPE_WRAP = exports.BITMAP_ENCODING_INLINE = exports.BITMAP_TYPE_PNG = exports.TYPE_WEIGHT = exports.TYPE_FILL = exports.TYPE_EXACT = exports.OP = void 0;
exports.javaHashMapOrder = javaHashMapOrder;
exports.modWidth = modWidth;
exports.modHeight = modHeight;
exports.modPadding = modPadding;
exports.modBorder = modBorder;
exports.modScroll = modScroll;
exports.modVisibility = modVisibility;
exports.modGraphicsLayer = modGraphicsLayer;
exports.modClipRect = modClipRect;
exports.modClipRoundedRect = modClipRoundedRect;
exports.modWidthIn = modWidthIn;
exports.modDimensionConstraints = modDimensionConstraints;
exports.modHeightIn = modHeightIn;
exports.modSemantics = modSemantics;
exports.modClick = modClick;
exports.hostNamedAction = hostNamedAction;
exports.hostAction = hostAction;
exports.valueFloatExpressionChange = valueFloatExpressionChange;
exports.valueFloatChange = valueFloatChange;
exports.valueIntegerChange = valueIntegerChange;
exports.valueStringChange = valueStringChange;
exports.valueIntegerExpressionChange = valueIntegerExpressionChange;
exports.modOffset = modOffset;
exports.modBackgroundId = modBackgroundId;
exports.modBackground = modBackground;
/**
 * RemoteComposeWriter — the op emitters, ported from `rcj/writer.py`.
 *
 * Id allocation is the part to get right, because everything downstream references ids and a
 * single extra allocation shifts every id after it:
 *   - component ids: start at -1 and PRE-decrement, so the first is -2, then -3 …
 *   - data ids (text, colours, …): start at 42 and POST-increment, so 42, 43 …
 *     Text is interned by value: an identical string reuses its id and emits no second
 *     DATA_TEXT.
 */
const WireBuffer_1 = require("./WireBuffer");
const Header_1 = require("./Header");
exports.OP = {
    COMPONENT_VALUE: 150, MODIFIER_OFFSET: 221, ACCESSIBILITY_SEMANTICS: 250,
    MODIFIER_CLICK: 59, MODIFIER_DIMENSION_CONSTRAINTS: 243, TEXT_MERGE: 136, MODIFIER_MULTI_CLICK: 83, HOST_NAMED_ACTION: 210, HOST_ACTION: 209, HOST_ACTION_METADATA: 216,
    MODIFIER_WIDTH_IN: 231, MODIFIER_HEIGHT_IN: 232,
    DEFINE_MESH_3D: 110, SET_CAMERA_3D: 111, MATRIX_3D_OP: 112, DRAW_MESH_3D: 113,
    PAINT_3D_STATE: 114, SET_LIGHTS_3D: 115, VECTOR_EXPRESSION: 116,
    MESH_EXPRESSION_3D: 117, SET_TEXTURE_3D: 118, MESH_PRIMITIVE_3D: 120,
    TOUCH_EXPRESSION: 157, MODIFIER_VISIBILITY: 211,
    LAYOUT_FLOW: 240,
    IMPULSE_START: 164, IMPULSE_PROCESS: 165, MODIFIER_BORDER: 107, MODIFIER_GRAPHICS_LAYER: 224,
    MODIFIER_SCROLL: 226, LAYOUT_FIT_BOX: 176,
    DATA_BITMAP: 101, PARTICLE_DEFINE: 161, PARTICLE_LOOP: 163, PARTICLE_COMPARE: 194,
    VALUE_FLOAT_EXPRESSION_CHANGE_ACTION: 227, VALUE_FLOAT_CHANGE_ACTION: 222,
    VALUE_INTEGER_CHANGE_ACTION: 212, VALUE_STRING_CHANGE_ACTION: 213,
    VALUE_INTEGER_EXPRESSION_CHANGE_ACTION: 218, CONDITIONAL_OPERATIONS: 178,
    DATA_PATH: 123, DRAW_PATH: 124, PATH_CREATE: 159, PATH_EXPRESSION: 193,
    CLIP_PATH: 38, DRAW_TEXT_ON_PATH: 53, DATA_LIST_IDS: 146, TEXT_LOOKUP: 151,
    REM: 185,
    PATH_APPEND: 160, TEXT_FROM_FLOAT: 135, FLOAT_LIST: 147, CV_WIDTH: 0, CV_HEIGHT: 1,
    LAYOUT_ROOT: 200, LAYOUT_CONTENT: 201, LAYOUT_BOX: 202, LAYOUT_ROW: 203,
    LAYOUT_COLUMN: 204, LAYOUT_CANVAS: 205, LAYOUT_CANVAS_CONTENT: 207,
    CONTAINER_END: 214, DATA_TEXT: 102, CORE_TEXT: 239, DATA_SHADER: 45,
    REFERENCED_OPERATIONS: 142, INCLUDE_REFERENCED_OPERATIONS: 245, DATA_INT: 140,
    MACRO_FOR_EACH: 244, MACRO_DEFINE: 246, MACRO_CALL: 247, MACRO_ARGUMENT: 248, MACRO_BLOCK: 249,
    MODIFIER_WIDTH: 16, MODIFIER_HEIGHT: 67, MODIFIER_BACKGROUND: 55,
    MODIFIER_PADDING: 58, MODIFIER_CLIP_RECT: 108, MODIFIER_ROUNDED_CLIP_RECT: 54,
    DATA_FLOAT: 80, ANIMATED_FLOAT: 81, COLOR_CONSTANT: 138, NAMED_VARIABLE: 137,
    PAINT_VALUES: 40, DRAW_RECT: 42, DRAW_CIRCLE: 46, DRAW_LINE: 47, DRAW_OVAL: 56,
    DRAW_ROUND_RECT: 51, DRAW_ARC: 152, DRAW_SECTOR: 52, DRAW_TEXT_ANCHOR: 133,
    MATRIX_SAVE: 130, MATRIX_RESTORE: 131, WAKE_IN: 191, MATRIX_TRANSLATE: 127, MATRIX_SCALE: 126,
    MATRIX_ROTATE: 129, CLIP_RECT: 39, LOOP_START: 215, THEME: 63, COLOR_EXPRESSION: 134,
};
exports.TYPE_EXACT = 0;
exports.TYPE_FILL = 1;
exports.TYPE_WEIGHT = 3;
// BitmapData.TYPE_* / ENCODING_* (BitmapData.java)
exports.BITMAP_TYPE_PNG = 1;
exports.BITMAP_ENCODING_INLINE = 0;
exports.TYPE_WRAP = 2;
const INT_MAX = 2147483647;
/** CoreText parameters in WRITE ORDER, with (name, tag, type, default). */
const CORE_TEXT_PARAMS = [
    ["id", 1, "i", -1], ["animationId", 2, "i", -1], ["color", 3, "i", 0xff000000],
    ["colorId", 4, "i", -1], ["fontSize", 5, "f", 36.0], ["minFontSize", 25, "f", -1.0],
    ["maxFontSize", 26, "f", -1.0], ["fontStyle", 6, "i", 0], ["fontWeight", 7, "f", 400.0],
    ["fontFamily", 8, "i", -1], ["textAlign", 9, "i", 1], ["overflow", 10, "i", 1],
    ["maxLines", 11, "i", INT_MAX], ["letterSpacing", 12, "f", 0.0],
    ["lineHeightAdd", 13, "f", 0.0], ["lineHeightMultiplier", 14, "f", 1.0],
    ["lineBreakStrategy", 15, "i", 0], ["hyphenationFrequency", 16, "i", 0],
    ["justificationMode", 17, "i", 0], ["underline", 18, "b", false],
    ["strikethrough", 19, "b", false], ["autosize", 22, "b", false],
    ["flags", 23, "i", 0], ["parentId", 24, "i", -1],
];
function toInt32(v) {
    return v | 0;
}
/** java.lang.String.hashCode: UTF-16 units, 32-bit wrap-around. */
function javaStringHash(s) {
    let h = 0;
    for (let k = 0; k < s.length; k++)
        h = (Math.imul(h, 31) + s.charCodeAt(k)) | 0;
    return h;
}
/**
 * Entries in the order a java.util.HashMap with default settings iterates them after
 * inserting them in this order: by bucket, (h ^ h >>> 16) & (capacity - 1), and in insertion
 * order within a bucket. The table starts at 16 and doubles past a 0.75 load; a resize keeps
 * each bucket's relative order, so the final capacity alone decides. (Buckets only turn into
 * trees at 8 colliding keys in a table of 64 or more, far past any shader's uniform count.)
 */
function javaHashMapOrder(entries) {
    const seen = new Map();
    const unique = [];
    for (const [k, v] of entries) { // a repeated key replaces the value in place
        if (seen.has(k))
            unique[seen.get(k)][1] = v;
        else {
            seen.set(k, unique.length);
            unique.push([k, v]);
        }
    }
    let capacity = 16;
    while (unique.length > capacity * 0.75)
        capacity *= 2;
    const bucket = (k) => { const h = javaStringHash(k); return (h ^ (h >>> 16)) & (capacity - 1); };
    return unique.map((e, n) => ({ e, n, b: bucket(e[0]) }))
        .sort((x, y) => x.b - y.b || x.n - y.n).map((x) => x.e);
}
class Writer {
    constructor(apiLevel, tags) {
        this.buffer = new WireBuffer_1.WireBuffer();
        this.componentId = -1; // pre-decrement -> first is -2
        this.nextDataId = 42; // post-increment -> first is 42
        this.nextLocal = 0x4000; // pattern-local ids (RemoteComposeState.createNextLocalId)
        this.patternDefineOffsets = [];
        this.lastComponentId = 0;
        this.textCache = new Map();
        this.componentValueCache = new Map();
        this.tffCache = new Map();
        this.nextArrayId = (2 << 20) + 42; // NanMap.START_ARRAY
        this.insertPoint = -1;
        this.globalStart = -1;
        /** Set by the `id` modifier: the next component takes this id instead of a generated one,
         *  and the generated counter does not move (RemoteComposeBuffer.getComponentId). */
        this.componentIdOverride = null;
        /** Set by the `spacedBy` modifier (raw float bits: it may be an expression): the next
         *  row/column writes it instead of 0 (RecordingModifier.spacedBy -> getSpacedBy). */
        this.spacedByBits = null;
        /** The interning caches as each open pattern definition found them (RemoteComposeState's
         *  data scopes). The component-value cache is the writer's own, as in the reference. */
        this.dataScopes = [];
        // ── functions, attributes, lookups, matrices (RemoteComposeWriter / RemoteComposeBuffer) ──
        /** RemoteComposeState's Integer-keyed data cache (textMeasure, textLength, mapLookup). */
        this.intCache = new Map();
        (0, Header_1.applyHeader)(this.buffer, apiLevel, tags);
    }
    encodeToByteArray() {
        return this.buffer.toBytes();
    }
    allocComponentId() {
        if (this.componentIdOverride !== null) {
            const id = this.componentIdOverride;
            this.componentIdOverride = null;
            this.lastComponentId = id;
            return id;
        }
        this.componentId -= 1;
        this.lastComponentId = this.componentId;
        return this.componentId;
    }
    allocDataId() {
        return this.nextDataId++;
    }
    // ── global sections, hoisted ahead of the root ───────────────────────────
    beginGlobal() {
        if (this.globalStart !== -1)
            throw new Error("global section started twice");
        if (this.insertPoint === -1)
            this.insertPoint = this.buffer.index;
        this.globalStart = this.buffer.index;
    }
    endGlobal() {
        if (this.globalStart === -1)
            throw new Error("global section ended without a begin");
        this.buffer.moveBlock(this.globalStart, this.insertPoint);
        this.insertPoint += this.buffer.index - this.globalStart;
        this.globalStart = -1;
    }
    // ── containers ──────────────────────────────────────────────────────────
    rootStart() {
        if (this.insertPoint === -1)
            this.insertPoint = this.buffer.index;
        this.buffer.start(exports.OP.LAYOUT_ROOT);
        this.buffer.writeInt(this.allocComponentId());
    }
    containerEnd() {
        this.buffer.start(exports.OP.CONTAINER_END);
    }
    // ── Loom (component templates) ─────────────────────────────────────────
    // RemoteComposeWriter / RemoteComposeBuffer: definePattern, patternInflation,
    // addPatternBlock, addPatternArgument, addPatternForEach and their ends.
    rippleModifier() { this.buffer.start(229); }
    /** REFERENCED_OPERATIONS (142): a reusable group, closed by containerEnd(). */
    referencedOperationsStart(id) { this.buffer.start(exports.OP.REFERENCED_OPERATIONS); this.buffer.writeInt(id); }
    /** INCLUDE_REFERENCED_OPERATIONS (245): replay a group here (as a component or a modifier). */
    includeReferencedOperations(id) { this.buffer.start(exports.OP.INCLUDE_REFERENCED_OPERATIONS); this.buffer.writeInt(id); }
    /** A pattern-local id (0x4000 range): each inflation gets a fresh one at playback. */
    nextLocalId() { return this.nextLocal++; }
    /** MACRO_DEFINE: the name interned as text is the id; the body follows, and its length is
     *  patched into skipLength by endPatternDefine (PatternDefine.apply / applyEnd). */
    definePattern(name, paramIds) {
        const id = this.addText(name);
        // RemoteComposeWriter.definePattern -> RemoteComposeState.pushDataScope: data first
        // interned inside the body is defined only per inflation (the body is skipped where it
        // stands), so it must not be reused once the body ends. What was interned before stays
        // visible inside.
        this.dataScopes.push([new Map(this.textCache), new Map(this.tffCache), new Map(this.intCache)]);
        this.buffer.start(exports.OP.MACRO_DEFINE);
        this.buffer.writeInt(id);
        this.buffer.writeInt(paramIds.length);
        for (const p of paramIds)
            this.buffer.writeInt(p);
        this.patternDefineOffsets.push(this.buffer.index);
        this.buffer.writeInt(0); // skipLength, patched at the end
        return id;
    }
    endPatternDefine() {
        const offset = this.patternDefineOffsets.pop();
        if (offset !== undefined)
            this.buffer.overwriteInt(offset, this.buffer.index - (offset + 4));
        this.containerEnd();
        // RemoteComposeState.popDataScope: forget what the body interned.
        const scope = this.dataScopes.pop();
        if (scope)
            [this.textCache, this.tffCache, this.intCache] = scope;
    }
    patternInflation(id, argIds) {
        this.buffer.start(exports.OP.MACRO_CALL);
        this.buffer.writeInt(id);
        this.buffer.writeInt(argIds.length);
        for (const a of argIds)
            this.buffer.writeInt(a);
    }
    patternBlock(paramIndex) { this.buffer.start(exports.OP.MACRO_BLOCK); this.buffer.writeInt(paramIndex); }
    patternArgument(paramIndex) { this.buffer.start(exports.OP.MACRO_ARGUMENT); this.buffer.writeInt(paramIndex); }
    patternForEach(collectionId, localItemId) {
        this.buffer.start(exports.OP.MACRO_FOR_EACH);
        this.buffer.writeInt(collectionId);
        this.buffer.writeInt(localItemId);
    }
    contentStart() {
        this.buffer.start(exports.OP.LAYOUT_CONTENT);
        this.buffer.writeInt(this.allocComponentId());
    }
    containerWithAlign(op, horizontal, vertical, spacedBy, modifiers) {
        const cid = this.allocComponentId();
        this.buffer.start(op);
        this.buffer.writeInt(cid);
        this.buffer.writeInt(-1); // animationId
        this.buffer.writeInt(horizontal);
        this.buffer.writeInt(vertical);
        if (spacedBy !== null) {
            if (this.spacedByBits !== null)
                this.buffer.writeIntBitsAsFloat(this.spacedByBits);
            else
                this.buffer.writeFloat(spacedBy);
            this.spacedByBits = null;
        }
        this.spacedByBits = null; // a box has no spacing: never let it reach the next row
        for (const m of modifiers)
            m(this);
        this.contentStart();
    }
    startColumn(h, v, mods, spacedBy = 0.0) {
        this.containerWithAlign(exports.OP.LAYOUT_COLUMN, h, v, spacedBy, mods);
    }
    startRow(h, v, mods, spacedBy = 0.0) {
        this.containerWithAlign(exports.OP.LAYOUT_ROW, h, v, spacedBy, mods);
    }
    startBox(h, v, mods) {
        this.containerWithAlign(exports.OP.LAYOUT_BOX, h, v, null, mods); // box has no spacedBy
    }
    endContainer() {
        this.containerEnd();
        this.containerEnd();
    }
    /**
     * A childless box: BoxStart, modifiers, one ContainerEnd.
     *
     * Not startBox+endBox with nothing between — that form also writes a content op and so
     * closes twice. Upstream also defaults a leaf's alignment to centre where the container
     * form defaults to start/top.
     */
    boxLeaf(h, v, mods) {
        const cid = this.allocComponentId();
        this.buffer.start(exports.OP.LAYOUT_BOX);
        this.buffer.writeInt(cid);
        this.buffer.writeInt(-1);
        this.buffer.writeInt(h);
        this.buffer.writeInt(v);
        for (const m of mods)
            m(this);
        this.containerEnd();
    }
    /**
     * A canvas emits *both* a plain content op and, at apiLevel <= 7, a canvas-content op —
     * two component ids, not one. Emitting only the canvas-content op left every later id
     * short by one and the document six bytes light.
     */
    startCanvas(mods, apiLevel) {
        const cid = this.allocComponentId();
        this.buffer.start(exports.OP.LAYOUT_CANVAS);
        this.buffer.writeInt(cid);
        this.buffer.writeInt(-1);
        for (const m of mods)
            m(this);
        this.contentStart();
        if (apiLevel <= 7) {
            this.buffer.start(exports.OP.LAYOUT_CANVAS_CONTENT);
            this.buffer.writeInt(this.allocComponentId());
        }
    }
    /** Three ends at apiLevel <= 7 — one for the canvas-content op startCanvas added. */
    endCanvas(apiLevel) {
        if (apiLevel <= 7)
            this.containerEnd();
        this.containerEnd();
        this.containerEnd();
    }
    /**
     * Emit a FloatExpression (ANIMATED_FLOAT) and return its asNan(id) bits.
     *
     * The length field packs both counts: exprLen | (animLen << 16).
     */
    /**
     * Component WIDTH/HEIGHT of the *last started component*, cached per (component, type).
     *
     * This is why `lastComponentId` is tracked: `componentWidth()` does not mean the root's
     * width, it means whichever component is currently being built.
     */
    addComponentValue(valueType) {
        const key = `${this.lastComponentId}:${valueType}`;
        const hit = this.componentValueCache.get(key);
        if (hit !== undefined)
            return hit;
        const dataId = this.allocDataId();
        this.buffer.start(exports.OP.COMPONENT_VALUE);
        this.buffer.writeInt(valueType);
        this.buffer.writeInt(this.lastComponentId);
        this.buffer.writeInt(dataId);
        const value = (0, WireBuffer_1.asNanBits)(dataId);
        this.componentValueCache.set(key, value);
        return value;
    }
    floatExpression(opsBits, animFloats) {
        const dataId = this.allocDataId();
        this.buffer.start(exports.OP.ANIMATED_FLOAT);
        this.buffer.writeInt(dataId);
        const nAnim = animFloats ? animFloats.length : 0;
        this.buffer.writeInt(opsBits.length | (nAnim << 16));
        for (const b of opsBits)
            this.buffer.writeInt(b);
        if (animFloats)
            for (const v of animFloats)
                this.buffer.writeFloat(v);
        return (0, WireBuffer_1.asNanBits)(dataId);
    }
    // ── paint + draw ────────────────────────────────────────────────────────
    paintValues(ints) {
        this.buffer.start(exports.OP.PAINT_VALUES);
        this.buffer.writeInt(ints.length); // PaintBundle.writeBundle: mPos
        for (const v of ints)
            this.buffer.writeInt(v);
    }
    /**
     * Canvas float fields go out as raw float32 *bits*, not through writeFloat, so a value
     * that is an expression result (a NaN-boxed id) survives. For a literal the bits are
     * identical either way.
     */
    op(code, bits) {
        this.buffer.start(code);
        for (const b of bits)
            this.buffer.writeInt(b);
    }
    drawRect(l, t, r, b) { this.op(exports.OP.DRAW_RECT, [l, t, r, b]); }
    drawOval(l, t, r, b) { this.op(exports.OP.DRAW_OVAL, [l, t, r, b]); }
    drawCircle(cx, cy, rad) { this.op(exports.OP.DRAW_CIRCLE, [cx, cy, rad]); }
    drawLine(x1, y1, x2, y2) { this.op(exports.OP.DRAW_LINE, [x1, y1, x2, y2]); }
    drawRoundRect(l, t, r, b, rx, ry) {
        this.op(exports.OP.DRAW_ROUND_RECT, [l, t, r, b, rx, ry]);
    }
    drawArc(l, t, r, b, start, sweep) {
        this.op(exports.OP.DRAW_ARC, [l, t, r, b, start, sweep]);
    }
    drawSector(l, t, r, b, start, sweep) {
        this.op(exports.OP.DRAW_SECTOR, [l, t, r, b, start, sweep]);
    }
    drawTextAnchored(textId, x, y, panX, panY, flags) {
        this.buffer.start(exports.OP.DRAW_TEXT_ANCHOR);
        this.buffer.writeInt(textId);
        for (const b of [x, y, panX, panY])
            this.buffer.writeInt(b);
        this.buffer.writeInt(flags);
    }
    matrixSave() { this.buffer.start(exports.OP.MATRIX_SAVE); }
    matrixRestore() { this.buffer.start(exports.OP.MATRIX_RESTORE); }
    /** WAKE_IN: ask the player to repaint within `seconds` (a float, or a variable). */
    wakeIn(seconds) { this.op(exports.OP.WAKE_IN, [seconds]); }
    matrixTranslate(dx, dy) { this.op(exports.OP.MATRIX_TRANSLATE, [dx, dy]); }
    /** Four fields: sx, sy and a pivot that defaults to NaN. Writing two lost 8 bytes. */
    matrixScale(sx, sy, px = 0x7fc00000, py = 0x7fc00000) {
        this.op(exports.OP.MATRIX_SCALE, [sx, sy, px, py]);
    }
    matrixRotate(angle, px, py) {
        this.op(exports.OP.MATRIX_ROTATE, [angle, px, py]);
    }
    clipRect(l, t, r, b) { this.op(exports.OP.CLIP_RECT, [l, t, r, b]); }
    // ── paths ───────────────────────────────────────────────────────────────
    /**
     * A whole path as one DATA_PATH op. Verb tags are NaN-boxed ids, coordinates are plain
     * floats — so the array is a mix of raw bit patterns and numbers, distinguished here by
     * a marker rather than by type.
     */
    addPathData(items) {
        const pathId = this.allocDataId();
        this.buffer.start(exports.OP.DATA_PATH);
        this.buffer.writeInt(pathId);
        this.buffer.writeInt(items.length);
        for (const v of items) {
            if (typeof v === "number")
                this.buffer.writeInt((0, WireBuffer_1.floatToRawIntBits)(v));
            else
                this.buffer.writeInt(v.bits);
        }
        return pathId;
    }
    pathCreate(xBits, yBits) {
        const pathId = this.allocDataId();
        this.buffer.start(exports.OP.PATH_CREATE);
        this.buffer.writeInt(pathId);
        this.buffer.writeInt(xBits);
        this.buffer.writeInt(yBits);
        return pathId;
    }
    /**
     * Emit a PATH_EXPRESSION; return the path id.
     *
     * The path is sampled `count` times with the parameter swept from `min` to `max`, and
     * `a[0]` in either expression is that parameter. A null Y expression is written as a
     * zero-length array, which is how the reference marks "X only".
     *
     * min/max/count go out as float32 *bits* rather than as floats, because each may be a
     * NaN-boxed variable id - the same reason drawCircle takes bits.
     */
    pathExpression(flags, minBits, maxBits, countBits, xOps, yOps) {
        const pathId = this.allocDataId();
        this.buffer.start(exports.OP.PATH_EXPRESSION);
        this.buffer.writeInt(pathId);
        this.buffer.writeInt(flags);
        for (const b of [minBits, maxBits, countBits])
            this.buffer.writeInt(b);
        this.buffer.writeInt(xOps.length);
        for (const b of xOps)
            this.buffer.writeInt(b);
        this.buffer.writeInt(yOps ? yOps.length : 0);
        for (const b of (yOps ?? []))
            this.buffer.writeInt(b);
        return pathId;
    }
    pathAppendLineTo(pathId, xBits, yBits) {
        this.buffer.start(exports.OP.PATH_APPEND);
        this.buffer.writeInt(pathId);
        this.buffer.writeInt(5);
        this.buffer.writeInt((0, WireBuffer_1.asNanBits)(11)); // PATH_LINE
        this.buffer.writeInt((0, WireBuffer_1.floatToRawIntBits)(0.0));
        this.buffer.writeInt((0, WireBuffer_1.floatToRawIntBits)(0.0));
        this.buffer.writeInt(xBits);
        this.buffer.writeInt(yBits);
    }
    pathAppendClose(pathId) {
        this.buffer.start(exports.OP.PATH_APPEND);
        this.buffer.writeInt(pathId);
        this.buffer.writeInt(1);
        this.buffer.writeInt((0, WireBuffer_1.asNanBits)(15)); // PATH_CLOSE
    }
    /** CLIP_PATH (38). */
    clipPath(pathId) {
        this.buffer.start(exports.OP.CLIP_PATH);
        this.buffer.writeInt(pathId);
    }
    /**
     * DRAW_TEXT_ON_PATH (53). The offsets go on the wire **vOffset first**, which is the
     * reverse of the argument order everywhere else in this family — that is the
     * reference's own byte order, and getting it backwards is quiet: the text still draws,
     * just offset across the path instead of along it.
     */
    drawTextOnPath(textId, pathId, hBits, vBits) {
        this.buffer.start(exports.OP.DRAW_TEXT_ON_PATH);
        this.buffer.writeInt(textId);
        this.buffer.writeInt(pathId);
        this.buffer.writeInt(vBits);
        this.buffer.writeInt(hBits);
    }
    /** DATA_LIST_IDS (146): a list of data ids — here text ids — that textLookup indexes. */
    addList(ids) {
        // RemoteComposeWriter.addList: cacheData(ids, NanMap.TYPE_ARRAY), an array-space id.
        const listId = this.nextArrayId++;
        this.buffer.start(exports.OP.DATA_LIST_IDS);
        this.buffer.writeInt(listId);
        this.buffer.writeInt(ids.length);
        for (const id of ids)
            this.buffer.writeInt(id);
        return listId;
    }
    /**
     * TEXT_LOOKUP (151): a text id whose string is `list[index]`, resolved live.
     * This is what lets one drawTextOnPath inside a loop print a different string each
     * iteration instead of needing N unrolled draws.
     */
    textLookup(dataSetId, indexBits) {
        const textId = this.allocDataId();
        this.buffer.start(exports.OP.TEXT_LOOKUP);
        this.buffer.writeInt(textId);
        this.buffer.writeInt(dataSetId);
        this.buffer.writeInt(indexBits);
        return textId;
    }
    /** REM (185): a remark carried in the document. No visual effect. */
    rem(message) {
        this.buffer.start(exports.OP.REM);
        this.buffer.writeUtf8(message);
    }
    drawPath(pathId) {
        this.buffer.start(exports.OP.DRAW_PATH);
        this.buffer.writeInt(pathId);
    }
    /**
     * CONDITIONAL_OPERATIONS (178). The condition type is a *byte*, not an int — the two
     * float operands that follow are ints, so writing four bytes here desyncs everything
     * after it rather than producing a wrong comparison.
     */
    conditionalOperations(condType, aBits, bBits) {
        this.buffer.start(exports.OP.CONDITIONAL_OPERATIONS);
        this.buffer.writeByte(condType);
        this.buffer.writeInt(aBits);
        this.buffer.writeInt(bBits);
    }
    endConditional() {
        this.containerEnd();
    }
    /** LAYOUT_FLOW (240). Closes with two ends, like the other containers. */
    startFlow(h, v, mods, maxItems, spacedBy = 0.0, maxLines = INT_MAX) {
        const cid = this.allocComponentId();
        this.buffer.start(exports.OP.LAYOUT_FLOW);
        this.buffer.writeInt(cid);
        this.buffer.writeInt(-1); // animationId
        this.buffer.writeInt(h);
        this.buffer.writeInt(v);
        // RecordingModifier.getSpacedBy: a spacedBy modifier applies to a flow as to a row.
        if (this.spacedByBits !== null)
            this.buffer.writeIntBitsAsFloat(this.spacedByBits);
        else
            this.buffer.writeFloat(spacedBy);
        this.spacedByBits = null;
        this.buffer.writeInt(maxItems);
        this.buffer.writeInt(maxLines);
        for (const m of mods)
            m(this);
        this.contentStart();
    }
    endFlow() {
        this.containerEnd();
        this.containerEnd();
    }
    /** LAYOUT_FIT_BOX (176). Two ends, like the other aligned containers. */
    startFitBox(h, v, mods) {
        const cid = this.allocComponentId();
        this.buffer.start(exports.OP.LAYOUT_FIT_BOX);
        this.buffer.writeInt(cid);
        this.buffer.writeInt(-1); // animationId
        this.buffer.writeInt(h);
        this.buffer.writeInt(v);
        for (const m of mods)
            m(this);
        this.contentStart();
    }
    endFitBox() {
        this.containerEnd();
        this.containerEnd();
    }
    /**
     * Mirrors RemoteComposeWriter.addModifierScroll: reserve two ids for the scroll extent
     * and the notch extent, write the modifier, then a TouchExpression that *writes the
     * caller's position variable*, and close the container.
     *
     * The two reserved ids are never written to here — the player fills them in once it
     * knows the content size. Reserving them is still required, because their ids are baked
     * into the modifier and everything allocated afterwards depends on the count.
     */
    addModifierScroll(direction, positionBits) {
        const maxBits = (0, WireBuffer_1.asNanBits)(this.allocDataId());
        const notchMaxBits = (0, WireBuffer_1.asNanBits)(this.allocDataId());
        this.buffer.start(exports.OP.MODIFIER_SCROLL);
        this.buffer.writeInt(direction);
        for (const b of [positionBits, maxBits, notchMaxBits]) {
            this.buffer.writeIntBitsAsFloat(b);
        }
        // VERTICAL(0) scrolls with touch Y, HORIZONTAL with touch X. The expression is
        // `touch * -1`: dragging down moves the content up.
        const touchId = direction === 0 ? 14 : 13; // FLOAT_TOUCH_POS_Y / _X
        const mul = (0, WireBuffer_1.asNanBits)(0x310000 + 3); // AnimatedFloatExpression MUL
        const exp = [(0, WireBuffer_1.asNanBits)(touchId), (0, WireBuffer_1.floatToRawIntBits)(-1.0), mul];
        this.touchExpression((0, WireBuffer_1.floatToRawIntBits)(0.0), // default
        (0, WireBuffer_1.floatToRawIntBits)(0.0), // min
        maxBits, // max: the reserved extent
        0, // STOP_GENTLY
        (0, WireBuffer_1.floatToRawIntBits)(0.0), // velocity id
        3, // touch effects
        exp, null, null, positionBits & 0x007fffff);
        this.buffer.start(exports.OP.CONTAINER_END);
    }
    /**
     * PARTICLE_DEFINE (161). Returns [systemId, one data id per variable].
     *
     * The id order is load-bearing: the system's own id is allocated first, then one per
     * variable, all before the op is written. Any other order still produces a readable
     * document in which every particle reads the wrong variable.
     */
    createParticles(initOps, particleCount) {
        const systemId = this.allocDataId();
        const varIds = initOps.map(() => this.allocDataId());
        this.buffer.start(exports.OP.PARTICLE_DEFINE);
        this.buffer.writeInt(systemId);
        this.buffer.writeInt(particleCount);
        this.buffer.writeInt(varIds.length);
        varIds.forEach((vid, i) => {
            this.buffer.writeInt(vid);
            this.buffer.writeInt(initOps[i].length);
            for (const b of initOps[i])
                this.buffer.writeInt(b);
        });
        return [systemId, varIds];
    }
    /** PARTICLE_LOOP (163) — a container; the body follows, then containerEnd(). */
    particlesLoopStart(systemId, restartOps, eqOps) {
        this.buffer.start(exports.OP.PARTICLE_LOOP);
        this.buffer.writeInt(systemId);
        this.buffer.writeInt(restartOps ? restartOps.length : 0);
        for (const b of restartOps ?? [])
            this.buffer.writeInt(b);
        this.buffer.writeInt(eqOps.length);
        for (const ops of eqOps) {
            this.buffer.writeInt(ops.length);
            for (const b of ops)
                this.buffer.writeInt(b);
        }
    }
    /**
     * PARTICLE_COMPARE (194) — a container. `flags` is a *short* here, the one field in the
     * particle ops that is not an int, and an absent condition or equation list is a zero
     * count rather than an omission.
     */
    particlesCompareStart(systemId, flags, minBits, maxBits, condition, then1, then2) {
        this.buffer.start(exports.OP.PARTICLE_COMPARE);
        this.buffer.writeInt(systemId);
        this.buffer.writeShort(flags);
        this.buffer.writeInt(minBits);
        this.buffer.writeInt(maxBits);
        this.buffer.writeInt(condition ? condition.length : 0);
        for (const b of condition ?? [])
            this.buffer.writeInt(b);
        for (const group of [then1, then2]) {
            this.buffer.writeInt(group ? group.length : 0);
            for (const eq of group ?? []) {
                this.buffer.writeInt(eq.length);
                for (const b of eq)
                    this.buffer.writeInt(b);
            }
        }
    }
    /** IMPULSE_START (164) — a container; close it with containerEnd(). */
    impulseStart(durationBits, startBits) {
        this.buffer.start(exports.OP.IMPULSE_START);
        this.buffer.writeInt(durationBits);
        this.buffer.writeInt(startBits);
    }
    /** IMPULSE_PROCESS (165) — a container with no payload. */
    impulseProcessStart() {
        this.buffer.start(exports.OP.IMPULSE_PROCESS);
    }
    // ── bitmaps ─────────────────────────────────────────────────────────────
    /**
     * DATA_BITMAP (101), the packed form.
     *
     * Width and height each share a word with a second field — type in the high half of the
     * first, encoding in the high half of the second. The reader tells this from the plain
     * form by those high bits being set, which is why each dimension must stay inside 16
     * bits: a 70000-pixel image would silently read back as a different type.
     */
    addBitmap(imageId, width, height, data, type = exports.BITMAP_TYPE_PNG, encoding = exports.BITMAP_ENCODING_INLINE) {
        if (!(width >= 0 && width <= 0xffff) || !(height >= 0 && height <= 0xffff)) {
            throw new Error(`bitmap ${width}x${height}: each dimension must fit in 16 bits, because the `
                + "wire format packs type and encoding into the high half of those words");
        }
        this.buffer.start(exports.OP.DATA_BITMAP);
        this.buffer.writeInt(imageId);
        this.buffer.writeInt(((type & 0xffff) << 16) | (width & 0xffff));
        this.buffer.writeInt(((encoding & 0xffff) << 16) | (height & 0xffff));
        this.buffer.writeBuffer(data);
        return imageId;
    }
    // ── 3D ──────────────────────────────────────────────────────────────────
    //
    // Every 3D payload is a length-prefixed array of raw 32-bit patterns. They are bit
    // patterns rather than floats because an element may be a NaN-boxed variable id, and
    // writing one through a float would destroy the payload.
    bitsArray(bits) {
        this.buffer.writeInt(bits.length);
        for (const b of bits)
            this.buffer.writeInt(b);
    }
    defineMesh3D(meshId, indices, verts, normals, uv) {
        this.buffer.start(exports.OP.DEFINE_MESH_3D);
        this.buffer.writeInt(meshId);
        this.buffer.writeInt(indices.length);
        for (const i of indices)
            this.buffer.writeInt(i);
        this.bitsArray(verts);
        // An absent optional channel is a zero length, not a missing field.
        this.bitsArray(normals ?? []);
        this.bitsArray(uv ?? []);
    }
    setCamera3D(projection, projParams, viewParams) {
        this.buffer.start(exports.OP.SET_CAMERA_3D);
        this.buffer.writeInt(projection);
        this.bitsArray(projParams);
        this.bitsArray(viewParams);
    }
    matrix3DOp(sub, args) {
        this.buffer.start(exports.OP.MATRIX_3D_OP);
        this.buffer.writeInt(sub);
        this.bitsArray(args);
    }
    drawMesh3D(meshId, mode) {
        this.buffer.start(exports.OP.DRAW_MESH_3D);
        this.buffer.writeInt(meshId);
        this.buffer.writeInt(mode);
    }
    paint3DState(sub, params) {
        this.buffer.start(exports.OP.PAINT_3D_STATE);
        this.buffer.writeInt(sub);
        this.bitsArray(params);
    }
    setLights3D(types, colors, params) {
        this.buffer.start(exports.OP.SET_LIGHTS_3D);
        this.buffer.writeInt(types.length);
        for (let i = 0; i < types.length; i++) {
            this.buffer.writeInt(types[i]);
            this.buffer.writeInt(colors[i]);
        }
        this.bitsArray(params);
    }
    setTexture3D(bitmapId) {
        this.buffer.start(exports.OP.SET_TEXTURE_3D);
        this.buffer.writeInt(bitmapId);
    }
    meshPrimitive3D(meshId, ptype, segments, flags, channels) {
        this.buffer.start(exports.OP.MESH_PRIMITIVE_3D);
        this.buffer.writeInt(meshId);
        this.buffer.writeInt(ptype);
        this.buffer.writeInt(segments); // float bits, and may be a variable
        this.buffer.writeInt(flags);
        this.buffer.writeInt(channels.length);
        for (const ch of channels)
            this.bitsArray(ch);
    }
    /** MESH_EXPRESSION_3D: RPN expressions the player evaluates over a (u,v) grid. */
    meshExpression3D(meshId, mtype, flags, params, pos, normal, uv) {
        this.buffer.start(exports.OP.MESH_EXPRESSION_3D);
        this.buffer.writeInt(meshId);
        this.buffer.writeInt(mtype);
        this.buffer.writeInt(flags);
        this.bitsArray(params);
        for (const group of [pos, normal, uv]) {
            this.buffer.writeInt(group.length);
            for (const e of group)
                this.bitsArray(e);
        }
    }
    /**
     * VECTOR_EXPRESSION. Returns the base data id.
     *
     * The components land in consecutive ids base..base+dimension-1, so the ids after the
     * base are reserved here — handing one to another op would silently overwrite a
     * component every frame.
     */
    vectorExpression(dimension, flags, opsBits) {
        const base = this.allocDataId();
        for (let i = 0; i < dimension - 1; i++)
            this.allocDataId();
        this.buffer.start(exports.OP.VECTOR_EXPRESSION);
        this.buffer.writeInt(base);
        this.buffer.writeByte(dimension);
        this.buffer.writeByte(flags);
        this.buffer.writeShort(opsBits.length);
        for (const b of opsBits)
            this.buffer.writeInt(b);
        return base;
    }
    /**
     * TOUCH_EXPRESSION. Returns the asNan(id) bits.
     *
     * Unlike a float expression the value *accumulates*: the expression maps a touch to a
     * delta, and the op integrates it, clamps to [min, max] and coasts on release. The four
     * leading fields go out as raw bits because each may be a NaN-boxed id, and because NaN
     * is a legitimate value here — an absent `min` means wrap around `max`, which is a
     * different behaviour from min=0.
     */
    touchExpression(defaultBits, minBits, maxBits, touchMode, velocityBits, touchEffects, expBits, touchSpec, easingSpec, dataIdIn) {
        // `dataIdIn` lets the caller drive a variable that already exists — a scroll
        // modifier's touch expression writes the position variable it was given.
        const dataId = dataIdIn ?? this.allocDataId();
        this.buffer.start(exports.OP.TOUCH_EXPRESSION);
        this.buffer.writeInt(dataId);
        for (const b of [defaultBits, minBits, maxBits, velocityBits]) {
            this.buffer.writeIntBitsAsFloat(b);
        }
        this.buffer.writeInt(touchEffects);
        this.buffer.writeInt(expBits.length);
        for (const b of expBits)
            this.buffer.writeIntBitsAsFloat(b);
        const spec = touchSpec ?? [];
        this.buffer.writeInt(((touchMode & 0xffff) << 16) | (spec.length & 0xffff));
        for (const v of spec)
            this.buffer.writeFloat(v);
        const easing = easingSpec ?? [];
        this.buffer.writeInt(easing.length);
        for (const v of easing)
            this.buffer.writeFloat(v);
        return (0, WireBuffer_1.asNanBits)(dataId);
    }
    // ── control flow ────────────────────────────────────────────────────────
    startLoop(indexId, fromBits, stepBits, untilBits) {
        this.buffer.start(exports.OP.LOOP_START);
        this.buffer.writeInt(indexId);
        for (const b of [fromBits, stepBits, untilBits])
            this.buffer.writeInt(b);
    }
    endLoop() {
        this.containerEnd();
    }
    // ── data ────────────────────────────────────────────────────────────────
    /** TEXT_MERGE (136): a fresh text id that is the concatenation of two text ids. */
    textMerge(id1, id2) {
        const id = this.allocDataId();
        this.buffer.start(exports.OP.TEXT_MERGE);
        this.buffer.writeInt(id);
        this.buffer.writeInt(id1);
        this.buffer.writeInt(id2);
        return id;
    }
    addText(s) {
        const hit = this.textCache.get(s);
        if (hit !== undefined)
            return hit;
        const id = this.allocDataId();
        this.buffer.start(exports.OP.DATA_TEXT);
        this.buffer.writeInt(id);
        this.buffer.writeUtf8(s);
        this.textCache.set(s, id);
        return id;
    }
    /**
     * DATA_SHADER — RemoteComposeShader.commit / ShaderData.apply: the AGSL source as
     * DATA_TEXT (interned, like any addText), then a fresh shader id and the uniforms.
     * Float uniforms are raw float32 bits, so a NaN-boxed variable id animates the uniform.
     * The reference holds each kind of uniform in a java.util.HashMap and writes it in that
     * map's iteration order, so the same order is reproduced here (javaHashMapOrder).
     */
    addShader(source, floats, ints, bitmaps, textId = this.addText(source)) {
        const id = this.allocDataId();
        const f = javaHashMapOrder(floats), i = javaHashMapOrder(ints), b = javaHashMapOrder(bitmaps);
        this.buffer.start(exports.OP.DATA_SHADER);
        this.buffer.writeInt(id);
        this.buffer.writeInt(textId);
        this.buffer.writeInt(f.length | (i.length << 8) | (b.length << 16));
        for (const [name, bits] of f) {
            this.buffer.writeUtf8(name);
            this.buffer.writeInt(bits.length);
            for (const v of bits)
                this.buffer.writeIntBitsAsFloat(v);
        }
        for (const [name, values] of i) {
            this.buffer.writeUtf8(name);
            this.buffer.writeInt(values.length);
            for (const v of values)
                this.buffer.writeInt(v);
        }
        for (const [name, value] of b) {
            this.buffer.writeUtf8(name);
            this.buffer.writeInt(value);
        }
        return id;
    }
    /**
     * A string the host can read and write by name: NAMED_VARIABLE (STRING_TYPE 0), then
     * DATA_TEXT — RemoteComposeWriter.addNamedString. Not interned — two variables with the same initial text must still
     * be two ids, or setting one would set both. EXTENSION: not in the reference JSON
     * parser yet (m5Tab docs/RC_SYSTEM_VARIABLES.md).
     */
    addNamedString(name, value) {
        const id = this.allocDataId();
        this.buffer.start(exports.OP.NAMED_VARIABLE); // before the text, as RemoteComposeWriter does
        this.buffer.writeInt(id);
        this.buffer.writeInt(0); // NV_STRING_TYPE
        this.buffer.writeUtf8(name);
        this.buffer.start(exports.OP.DATA_TEXT);
        this.buffer.writeInt(id);
        this.buffer.writeUtf8(value);
        return id;
    }
    /** FloatConstant (DATA_FLOAT); returns asNan(id) bits. */
    addFloatConstant(value) {
        const dataId = this.allocDataId();
        this.buffer.start(exports.OP.DATA_FLOAT);
        this.buffer.writeInt(dataId);
        this.buffer.writeFloat(value);
        return (0, WireBuffer_1.asNanBits)(dataId);
    }
    /**
     * A float constant the host can read and write by name.
     *
     * The NAMED_VARIABLE goes *before* the constant — the opposite order from a named float
     * array, which writes the array first. Not an inconsistency to tidy: it mirrors upstream,
     * and swapping either changes the bytes.
     */
    addNamedFloat(name, value) {
        const dataId = this.allocDataId();
        this.buffer.start(exports.OP.NAMED_VARIABLE);
        this.buffer.writeInt(dataId);
        this.buffer.writeInt(1); // NV_FLOAT_TYPE
        this.buffer.writeUtf8(name);
        this.buffer.start(exports.OP.DATA_FLOAT);
        this.buffer.writeInt(dataId);
        this.buffer.writeFloat(value);
        return (0, WireBuffer_1.asNanBits)(dataId);
    }
    setFloatName(dataId, name) {
        this.buffer.start(exports.OP.NAMED_VARIABLE);
        this.buffer.writeInt(dataId);
        this.buffer.writeInt(1);
        this.buffer.writeUtf8(name);
    }
    /** COLOR_CONSTANT; returns the raw colour id (NOT NaN-boxed). */
    addColor(color) {
        const colorId = this.allocDataId();
        this.buffer.start(exports.OP.COLOR_CONSTANT);
        this.buffer.writeInt(colorId);
        this.buffer.writeInt(color);
        return colorId;
    }
    /** RemoteComposeWriter.addInteger: a fresh id (never deduplicated), DATA_INT. Returns the raw id. */
    addInteger(value) {
        const id = this.allocDataId();
        this.buffer.start(exports.OP.DATA_INT);
        this.buffer.writeInt(id);
        this.buffer.writeInt(value | 0);
        return id;
    }
    /** RemoteComposeWriter.addNamedInt: NAMED_VARIABLE (INT_TYPE 4) before the DATA_INT. */
    addNamedInt(name, value) {
        const id = this.allocDataId();
        this.buffer.start(exports.OP.NAMED_VARIABLE);
        this.buffer.writeInt(id);
        this.buffer.writeInt(4);
        this.buffer.writeUtf8(name);
        this.buffer.start(exports.OP.DATA_INT);
        this.buffer.writeInt(id);
        this.buffer.writeInt(value | 0);
        return id;
    }
    /** RemoteComposeWriter.setStringName: name an existing text id (NAMED_VARIABLE STRING_TYPE 0). */
    setStringName(id, name) {
        this.buffer.start(exports.OP.NAMED_VARIABLE);
        this.buffer.writeInt(id);
        this.buffer.writeInt(0);
        this.buffer.writeUtf8(name);
    }
    /** DATA_FLOAT / ANIMATED_FLOAT written under an existing id: a variable reassigned
     *  (RemoteComposeBuffer.addFloat / addAnimatedFloat with the variable's id). */
    floatConstantAt(id, value) {
        this.buffer.start(exports.OP.DATA_FLOAT);
        this.buffer.writeInt(id);
        this.buffer.writeFloat(value);
    }
    floatExpressionAt(id, opsBits) {
        this.buffer.start(exports.OP.ANIMATED_FLOAT);
        this.buffer.writeInt(id);
        this.buffer.writeInt(opsBits.length);
        for (const b of opsBits)
            this.buffer.writeInt(b);
    }
    addNamedColor(name, color) {
        const colorId = this.addColor(color);
        this.setColorName(colorId, name);
        return colorId;
    }
    /** RemoteComposeWriter.setColorName: NAMED_VARIABLE (COLOR_TYPE 2) on an existing id. */
    setColorName(colorId, name) {
        this.buffer.start(exports.OP.NAMED_VARIABLE);
        this.buffer.writeInt(colorId);
        this.buffer.writeInt(2); // NV_COLOR_TYPE
        this.buffer.writeUtf8(name);
    }
    /** RemoteComposeWriter.addThemedColor(lightName, lightValue, darkName, darkValue): two
     *  colour constants (each named when a name is given), then the themed colour over them. */
    addThemedColorValues(lightName, light, darkName, dark) {
        const lightId = this.allocDataId();
        const darkId = this.allocDataId();
        if (lightName !== null)
            this.setColorName(lightId, lightName);
        if (darkName !== null)
            this.setColorName(darkId, darkName);
        for (const [id, c] of [[lightId, light], [darkId, dark]]) {
            this.buffer.start(exports.OP.COLOR_CONSTANT);
            this.buffer.writeInt(id);
            this.buffer.writeInt(c);
        }
        return this.addThemedColorIds(lightId, darkId);
    }
    /** RemoteComposeWriter.addThemedColor(lightId, darkId): a fresh colour id, set under
     *  THEME(DARK) and under THEME(LIGHT) by a COLOR_EXPRESSION (mode 3: id to id) with tween
     *  0 (the dark id) or 1 (the light id), each in a one-pass loop; then THEME(UNSPECIFIED). */
    addThemedColorIds(lightId, darkId) {
        const retId = this.allocDataId();
        for (const [theme, tween] of [[-2, 0], [-3, 1]]) { // Rc.Theme.DARK, Rc.Theme.LIGHT
            this.buffer.start(exports.OP.THEME);
            this.buffer.writeInt(theme);
            this.startLoop(0, (0, WireBuffer_1.floatToRawIntBits)(0), (0, WireBuffer_1.floatToRawIntBits)(1), (0, WireBuffer_1.floatToRawIntBits)(1));
            this.buffer.start(exports.OP.COLOR_EXPRESSION);
            this.buffer.writeInt(retId);
            this.buffer.writeInt(3);
            this.buffer.writeInt(darkId & 0xffff);
            this.buffer.writeInt(lightId & 0xffff);
            this.buffer.writeFloat(tween);
            this.endLoop();
        }
        this.buffer.start(exports.OP.THEME);
        this.buffer.writeInt(-1); // Rc.Theme.UNSPECIFIED
        return retId;
    }
    /** FLOAT_LIST. Arrays have their own id counter, starting at START_ARRAY. */
    addFloatArray(values) {
        const arrayId = this.nextArrayId++;
        this.buffer.start(exports.OP.FLOAT_LIST);
        this.buffer.writeInt(arrayId);
        this.buffer.writeInt(values.length);
        for (const v of values)
            this.buffer.writeFloat(v);
        return arrayId;
    }
    /** Unlike addNamedFloat, the NAMED_VARIABLE comes *after* the array. */
    addNamedFloatArray(name, values) {
        const arrayId = this.addFloatArray(values);
        this.buffer.start(exports.OP.NAMED_VARIABLE);
        this.buffer.writeInt(arrayId);
        this.buffer.writeInt(6); // NV_FLOAT_ARRAY_TYPE
        this.buffer.writeUtf8(name);
        return arrayId;
    }
    /** TEXT_FROM_FLOAT: a text id whose string is a live float, deduped like addText. */
    addTextFromFloat(valueBits, before, after, flags) {
        const key = `${valueBits}:${before}:${after}:${flags}`;
        const hit = this.tffCache.get(key);
        if (hit !== undefined)
            return hit;
        const dataId = this.allocDataId();
        this.buffer.start(exports.OP.TEXT_FROM_FLOAT);
        this.buffer.writeInt(dataId);
        this.buffer.writeIntBitsAsFloat(valueBits);
        this.buffer.writeInt(((before & 0xffff) << 16) | (after & 0xffff));
        this.buffer.writeInt(flags);
        this.tffCache.set(key, dataId);
        return dataId;
    }
    cacheInt(key) {
        const id = this.allocDataId();
        this.intCache.set(key | 0, id);
        return id;
    }
    /** FUNCTION_DEFINE (168): the function id, then one fresh id per parameter
     *  (createFloatFunction). Closed by containerEnd(). Returns [fid, paramIds]. */
    defineFloatFunction(paramCount) {
        const fid = this.allocDataId();
        const args = [];
        for (let i = 0; i < paramCount; i++)
            args.push(this.allocDataId());
        this.buffer.start(168);
        this.buffer.writeInt(fid);
        this.buffer.writeInt(args.length);
        for (const a of args)
            this.buffer.writeInt(a);
        return [fid, args];
    }
    /** FUNCTION_CALL (166): id, count, then each argument as float bits. */
    callFloatFunction(id, argBits) {
        this.buffer.start(166);
        this.buffer.writeInt(id);
        this.buffer.writeInt(argBits.length);
        for (const b of argBits)
            this.buffer.writeInt(b);
    }
    /** DRAW_TWEEN_PATH (125). */
    drawTweenPath(p1, p2, tween, start, stop) {
        this.buffer.start(125);
        this.buffer.writeInt(p1);
        this.buffer.writeInt(p2);
        this.buffer.writeInt(tween);
        this.buffer.writeInt(start);
        this.buffer.writeInt(stop);
    }
    /** PATH_TWEEN (158): a new path id interpolating two paths. */
    pathTween(p1, p2, tween) {
        const out = this.allocDataId();
        this.buffer.start(158);
        this.buffer.writeInt(out);
        this.buffer.writeInt(p1);
        this.buffer.writeInt(p2);
        this.buffer.writeInt(tween);
        return out;
    }
    /** PATH_COMBINE (175): op is a byte. */
    pathCombine(p1, p2, op) {
        const out = this.allocDataId();
        this.buffer.start(175);
        this.buffer.writeInt(out);
        this.buffer.writeInt(p1);
        this.buffer.writeInt(p2);
        this.buffer.writeByte(op & 0xff);
        return out;
    }
    /** MATRIX_SKEW (128). */
    matrixSkew(sx, sy) { this.op(128, [sx, sy]); }
    /** MATRIX_FROM_PATH (181). */
    matrixFromPath(pathId, fraction, vOffset, flags) {
        this.buffer.start(181);
        this.buffer.writeInt(pathId);
        this.buffer.writeInt(fraction);
        this.buffer.writeInt(vOffset);
        this.buffer.writeInt(flags);
    }
    /** TEXT_SUBTEXT (182): returns the new (plain) text id. */
    textSubtext(txt, start, len) {
        const id = this.allocDataId();
        this.buffer.start(182);
        this.buffer.writeInt(id);
        this.buffer.writeInt(txt);
        this.buffer.writeInt(start);
        this.buffer.writeInt(len);
        return id;
    }
    /** TEXT_TRANSFORM (199). */
    textTransform(txt, start, len, operation) {
        const id = this.allocDataId();
        this.buffer.start(199);
        this.buffer.writeInt(id);
        this.buffer.writeInt(txt);
        this.buffer.writeInt(start);
        this.buffer.writeInt(len);
        this.buffer.writeInt(operation);
        return id;
    }
    /** TEXT_MEASURE (155): always written, cached under textId + mode*31. NaN-boxed id. */
    textMeasure(textId, mode) {
        const id = this.cacheInt(textId + Math.imul(mode, 31));
        this.buffer.start(155);
        this.buffer.writeInt(id);
        this.buffer.writeInt(textId);
        this.buffer.writeInt(mode);
        return (0, WireBuffer_1.asNanBits)(id);
    }
    /** TEXT_LENGTH (156): cached under textId + (156 << 16). NaN-boxed id. */
    textLength(textId) {
        const id = this.cacheInt(textId + (156 << 16));
        this.buffer.start(156);
        this.buffer.writeInt(id);
        this.buffer.writeInt(textId);
        return (0, WireBuffer_1.asNanBits)(id);
    }
    /** DATA_MAP_LOOKUP (154), deduplicated by mapId + strId*33 (RemoteComposeWriter.mapLookup). */
    mapLookup(mapId, strId) {
        const hash = (mapId + Math.imul(strId, 33)) | 0;
        const hit = this.intCache.get(hash);
        if (hit !== undefined)
            return hit;
        const id = this.cacheInt(hash);
        this.buffer.start(154);
        this.buffer.writeInt(id);
        this.buffer.writeInt(mapId);
        this.buffer.writeInt(strId);
        return id;
    }
    /** ID_LOOKUP (192): the data set is a NaN-boxed id; returns the plain id. */
    idLookup(dataSetBits, indexBits) {
        const id = this.allocDataId();
        this.buffer.start(192);
        this.buffer.writeInt(id);
        this.buffer.writeInt(dataSetBits & 0x3fffff);
        this.buffer.writeInt(indexBits);
        return id;
    }
    /** TEXT_LOOKUP_INT (153): the caller supplies the output id. */
    textLookupInt(id, dataSetBits, indexId) {
        this.buffer.start(153);
        this.buffer.writeInt(id);
        this.buffer.writeInt(dataSetBits & 0x3fffff);
        this.buffer.writeInt(indexId);
    }
    /** UPDATE_DYNAMIC_FLOAT_LIST (198): setArrayValue / updateDynamicFloatList. */
    setArrayValue(id, index, value) {
        this.buffer.start(198);
        this.buffer.writeInt(id);
        this.buffer.writeInt(index);
        this.buffer.writeInt(value);
    }
    /** An array-space id (createID(NanMap.TYPE_ARRAY)). */
    allocArrayId() { return this.nextArrayId++; }
    /** DYNAMIC_FLOAT_LIST (197). */
    addDynamicFloatArray(id, size) {
        this.buffer.start(197);
        this.buffer.writeInt(id);
        this.buffer.writeInt(size);
    }
    /** ATTRIBUTE_COLOR (180): NaN-boxed id. */
    colorAttribute(baseColor, type) {
        const id = this.allocDataId();
        this.buffer.start(180);
        this.buffer.writeInt(id);
        this.buffer.writeInt(baseColor);
        this.buffer.writeShort(type);
        return (0, WireBuffer_1.asNanBits)(id);
    }
    /** ATTRIBUTE_IMAGE (171), no args. */
    imageAttribute(bitmapId, attr) {
        const id = this.allocDataId();
        this.buffer.start(171);
        this.buffer.writeInt(id);
        this.buffer.writeInt(bitmapId);
        this.buffer.writeShort(attr);
        this.buffer.writeShort(0);
        return (0, WireBuffer_1.asNanBits)(id);
    }
    /** ATTRIBUTE_TEXT (170). */
    textAttribute(textId, attr) {
        const id = this.allocDataId();
        this.buffer.start(170);
        this.buffer.writeInt(id);
        this.buffer.writeInt(textId);
        this.buffer.writeShort(attr);
        this.buffer.writeShort(0);
        return (0, WireBuffer_1.asNanBits)(id);
    }
    /** ATTRIBUTE_TIME (172). */
    timeAttribute(longId, type, args) {
        const id = this.allocDataId();
        this.buffer.start(172);
        this.buffer.writeInt(id);
        this.buffer.writeInt(longId);
        this.buffer.writeShort(type);
        this.buffer.writeShort(args.length);
        for (const a of args)
            this.buffer.writeInt(a);
        return (0, WireBuffer_1.asNanBits)(id);
    }
    /** RUN_ACTION (236): closed by containerEnd(). */
    runActionsStart() { this.buffer.start(236); }
    /** MATRIX_EXPRESSION (187), type 0. */
    matrixExpression(id, bits) {
        this.buffer.start(187);
        this.buffer.writeInt(id);
        this.buffer.writeInt(0);
        this.buffer.writeInt(bits.length);
        for (const b of bits)
            this.buffer.writeInt(b);
    }
    /** MATRIX_VECTOR_MATH (188). */
    matrixVectorMath(type, outIds, matrixBits, fromBits) {
        this.buffer.start(188);
        this.buffer.writeShort(type);
        this.buffer.writeInt(matrixBits & 0x3fffff);
        this.buffer.writeInt(outIds.length);
        for (const o of outIds)
            this.buffer.writeInt(o);
        this.buffer.writeInt(fromBits.length);
        for (const b of fromBits)
            this.buffer.writeInt(b);
    }
    // ── layout managers and modifiers ported from DefaultComponentParsers / DefaultModifierParsers ──
    /** ANIMATION_SPEC (14); the two function ids only when an animation is CUSTOM or one is set. */
    animationSpec(id, motionDuration, motionEasing, visDuration, visEasing, enter, exit, enterFn, exitFn) {
        const b = this.buffer;
        b.start(14);
        b.writeInt(id);
        b.writeFloat(motionDuration);
        b.writeInt(motionEasing);
        b.writeFloat(visDuration);
        b.writeInt(visEasing);
        b.writeInt(enter);
        b.writeInt(exit);
        if ((enter & 0xff) === 8 || (exit & 0xff) === 8 || enterFn !== -1 || exitFn !== -1) {
            b.writeInt(enterFn);
            b.writeInt(exitFn);
        }
    }
    /** LAYOUT_STATE (217): id, animationId -1, 0, 0, indexId; modifiers; content. */
    startStateLayout(indexId, mods) {
        const cid = this.allocComponentId();
        this.buffer.start(217);
        this.buffer.writeInt(cid);
        this.buffer.writeInt(-1);
        this.buffer.writeInt(0);
        this.buffer.writeInt(0);
        this.buffer.writeInt(indexId);
        this.spacedByBits = null;
        for (const m of mods)
            m(this);
        this.contentStart();
    }
    /** LAYOUT_COLLAPSIBLE_ROW (230) / LAYOUT_COLLAPSIBLE_COLUMN (233): as row/column. */
    startCollapsible(column, h, v, mods) {
        this.containerWithAlign(column ? 233 : 230, h, v, 0.0, mods);
    }
    /** LAYOUT_CUSTOM (93): the component id is the modifier's own (-1 unless `id` is set). */
    startCustom(configId, props, mods) {
        const cid = this.componentIdOverride ?? -1;
        this.componentIdOverride = null;
        this.buffer.start(93);
        this.buffer.writeInt(cid);
        this.buffer.writeInt(-1);
        this.buffer.writeInt(configId);
        this.buffer.writeInt(props.length);
        for (const [type, dataType, value, isFloat] of props) {
            this.buffer.writeShort(type);
            this.buffer.writeShort(dataType);
            if (dataType === 1 || dataType === 3)
                this.buffer.writeFloat(isFloat ? value : 0);
            else
                this.buffer.writeInt(isFloat ? 0 : value);
        }
        this.spacedByBits = null;
        for (const m of mods)
            m(this);
        this.contentStart();
    }
    // ── text component ──────────────────────────────────────────────────────
    textComponent(textId, p) {
        // RemoteComposeWriter.startTextComponent: the family name, then each axis tag, are
        // interned as texts before the CoreText op.
        const fontFamilyId = p.fontFamily != null ? this.addText(p.fontFamily) : -1;
        const axis = p.fontAxis ? p.fontAxis.map((a) => this.addText(a)) : null;
        if (axis && p.fontAxisValues && axis.length !== p.fontAxisValues.length) {
            throw new Error("fontAxis and fontAxisValues must be the same length");
        }
        const cid = this.allocComponentId();
        const fb = WireBuffer_1.floatToRawIntBits;
        const values = {
            id: cid, animationId: -1, color: p.color, colorId: p.colorId,
            fontSize: p.fontSizeBits, minFontSize: p.minFontSizeBits ?? fb(-1.0),
            maxFontSize: p.maxFontSizeBits ?? fb(-1.0),
            fontStyle: p.fontStyle ?? 0, fontWeight: p.fontWeightBits, fontFamily: fontFamilyId,
            textAlign: p.textAlign, overflow: p.overflow, maxLines: p.maxLines,
            letterSpacing: p.letterSpacingBits ?? fb(0.0),
            lineHeightAdd: p.lineHeightAddBits ?? fb(0.0),
            lineHeightMultiplier: p.lineHeightMultiplierBits ?? fb(1.0),
            lineBreakStrategy: p.lineBreakStrategy ?? 0,
            hyphenationFrequency: p.hyphenationFrequency ?? 0,
            justificationMode: p.justificationMode ?? 0,
            underline: p.underline ?? false, strikethrough: p.strikethrough ?? false,
            autosize: p.autosize ?? false,
            flags: 0, parentId: p.textStyleId ?? -1,
        };
        // Only non-default parameters are written, which is why the defaults above have to
        // match the reference exactly — a wrong default emits a field that should be absent.
        // Floats compare as values (Java's `value == default`), so -0.0 counts as 0.0.
        const emit = [];
        for (const [name, tag, typ, dflt] of CORE_TEXT_PARAMS) {
            if (name === "autosize" && axis && axis.length > 0) {
                // P_FONT_AXIS (20) and P_FONT_AXIS_VALUES (21) go between strikethrough
                // and autosize, as CoreText.apply writes them.
                emit.push([20, "ai", axis]);
                emit.push([21, "af", (p.fontAxisValues ?? []).map((v) => fb(v))]);
            }
            const v = values[name];
            if (typ === "f") {
                if ((0, WireBuffer_1.f32FromBits)(v) !== dflt)
                    emit.push([tag, typ, v]);
            }
            else if (typ === "b") {
                if (Boolean(v) !== Boolean(dflt))
                    emit.push([tag, typ, v]);
            }
            else {
                if (toInt32(v) !== toInt32(dflt))
                    emit.push([tag, typ, v]);
            }
        }
        this.buffer.start(exports.OP.CORE_TEXT);
        this.buffer.writeInt(textId);
        this.buffer.writeShort(emit.length);
        for (const [tag, typ, value] of emit) {
            this.buffer.writeByte(tag);
            if (typ === "b")
                this.buffer.writeByte(value ? 1 : 0);
            else if (typ === "ai" || typ === "af") {
                const arr = value;
                this.buffer.writeShort(arr.length);
                for (const x of arr)
                    this.buffer.writeInt(x);
            }
            else
                this.buffer.writeInt(value);
        }
        for (const m of p.modifiers)
            m(this);
        // A text component is a container in the wire format: it closes itself with a
        // content op and two ends, exactly like a column with no children.
        this.contentStart();
        this.containerEnd();
        this.containerEnd();
    }
}
exports.Writer = Writer;
// ── modifiers ───────────────────────────────────────────────────────────────
function modWidth(typeOrdinal, valueBits) {
    return (w) => { w.buffer.start(exports.OP.MODIFIER_WIDTH); w.buffer.writeInt(typeOrdinal); w.buffer.writeInt(valueBits); };
}
function modHeight(typeOrdinal, valueBits) {
    return (w) => { w.buffer.start(exports.OP.MODIFIER_HEIGHT); w.buffer.writeInt(typeOrdinal); w.buffer.writeInt(valueBits); };
}
function modPadding(l, t, r, b) {
    return (w) => {
        w.buffer.start(exports.OP.MODIFIER_PADDING);
        for (const v of [l, t, r, b])
            w.buffer.writeInt(v);
    };
}
/**
 * MODIFIER_BORDER (107): four reserved ints, then width, corner radius, RGBA and a shape.
 * The colour goes out as four floats, not as a packed int.
 */
function modBorder(width, corner, color, shape, legacy = true) {
    const a = ((color >>> 24) & 0xff) / 255.0;
    const r = ((color >>> 16) & 0xff) / 255.0;
    const g = ((color >>> 8) & 0xff) / 255.0;
    const b = (color & 0xff) / 255.0;
    return (w) => {
        w.buffer.start(exports.OP.MODIFIER_BORDER);
        // The third reserved int is 1 for the non-legacy border, which
        // RemoteComposeWriter.addModifierBorder asks for above apiLevel 7.
        for (let i = 0; i < 4; i++)
            w.buffer.writeInt(i === 2 && !legacy ? 1 : 0);
        w.buffer.writeFloat(width);
        w.buffer.writeFloat(corner);
        w.buffer.writeFloat(r);
        w.buffer.writeFloat(g);
        w.buffer.writeFloat(b);
        w.buffer.writeFloat(a);
        w.buffer.writeInt(shape);
    };
}
/** A scroll modifier and the touch expression that drives it. */
function modScroll(direction, positionBits) {
    return (w) => w.addModifierScroll(direction, positionBits);
}
/**
 * MODIFIER_VISIBILITY (211): the component is shown or hidden by a *variable*.
 *
 * The payload is the id of a float the document owns, not a constant — 0 hides, non-zero
 * shows. That indirection is what makes filtering possible without a round trip: a click
 * action sets the variable and every component reading it appears or disappears.
 */
function modVisibility(valueId) {
    return (w) => {
        w.buffer.start(exports.OP.MODIFIER_VISIBILITY);
        w.buffer.writeInt(valueId);
    };
}
/**
 * MODIFIER_GRAPHICS_LAYER (224): a count, then (tag, float bits) per attribute, with the
 * tag = attribute id | DATA_TYPE_FLOAT (1) << 10.
 */
function modGraphicsLayer(attrs) {
    return (w) => {
        w.buffer.start(exports.OP.MODIFIER_GRAPHICS_LAYER);
        w.buffer.writeInt(attrs.length);
        for (const [id, bits] of attrs) {
            w.buffer.writeInt(id | (1 << 10));
            w.buffer.writeInt(bits);
        }
    };
}
/** MODIFIER_CLIP_RECT (108): clip to the component's own bounds. No payload. */
function modClipRect() {
    return (w) => { w.buffer.start(exports.OP.MODIFIER_CLIP_RECT); };
}
/** MODIFIER_ROUNDED_CLIP_RECT (54): four corner radii, as plain floats. */
function modClipRoundedRect(topStart, topEnd, bottomStart, bottomEnd) {
    return (w) => {
        w.buffer.start(exports.OP.MODIFIER_ROUNDED_CLIP_RECT);
        for (const v of [topStart, topEnd, bottomStart, bottomEnd])
            w.buffer.writeFloat(v);
    };
}
/** MODIFIER_WIDTH_IN (231): a min/max pair, either of which may be an expression. */
function modWidthIn(minBits, maxBits) {
    return (w) => {
        w.buffer.start(exports.OP.MODIFIER_WIDTH_IN);
        w.buffer.writeInt(minBits);
        w.buffer.writeInt(maxBits);
    };
}
/**
 * MODIFIER_DIMENSION_CONSTRAINTS (243): a type byte (0 horizontal, 1 vertical, 2 required
 * horizontal, 3 required vertical), then min and max.
 */
function modDimensionConstraints(type, minBits, maxBits) {
    return (w) => {
        w.buffer.start(exports.OP.MODIFIER_DIMENSION_CONSTRAINTS);
        w.buffer.writeByte(type);
        w.buffer.writeInt(minBits);
        w.buffer.writeInt(maxBits);
    };
}
/** MODIFIER_HEIGHT_IN (232): the vertical sibling of modWidthIn. */
function modHeightIn(minBits, maxBits) {
    return (w) => {
        w.buffer.start(exports.OP.MODIFIER_HEIGHT_IN);
        w.buffer.writeInt(minBits);
        w.buffer.writeInt(maxBits);
    };
}
/**
 * ACCESSIBILITY_SEMANTICS (250) — CoreSemantics.apply.
 *
 * Mixed field widths: ints for the three text ids, bytes for role and mode, then two
 * booleans. `role` is -1 when unset, not 0, and is written as a byte (0xFF).
 */
function modSemantics(contentDescriptionId, role, textId, stateDescriptionId, mode, enabled, clickable) {
    return (w) => {
        w.buffer.start(exports.OP.ACCESSIBILITY_SEMANTICS);
        w.buffer.writeInt(contentDescriptionId);
        w.buffer.writeByte(role & 0xff);
        w.buffer.writeInt(textId);
        w.buffer.writeInt(stateDescriptionId);
        w.buffer.writeByte(mode);
        w.buffer.writeBoolean(enabled);
        w.buffer.writeBoolean(clickable);
    };
}
exports.SEMANTICS_MODE_SET = 0;
/**
 * MODIFIER_CLICK (59) as a container: the op, then each action, then CONTAINER_END.
 *
 * clickType 0 writes the op with no payload at all — the single-int form is a different
 * encoding upstream (addClickModifierOperation(type)), so the two must not be merged.
 */
function modClick(actions, clickType = 0) {
    return (w) => {
        // ClickActionModifier.write: a plain click is MODIFIER_CLICK with no payload; any
        // other click type is MultiClickModifier (MODIFIER_MULTI_CLICK) with the type.
        if (clickType !== 0) {
            w.buffer.start(exports.OP.MODIFIER_MULTI_CLICK);
            w.buffer.writeInt(clickType);
        }
        else
            w.buffer.start(exports.OP.MODIFIER_CLICK);
        for (const a of actions)
            a(w);
        w.buffer.start(exports.OP.CONTAINER_END);
    };
}
/** HOST_NAMED_ACTION (210): name text id, value type, value text id. */
function hostNamedAction(textId, type, valueId) {
    return (w) => {
        w.buffer.start(exports.OP.HOST_NAMED_ACTION);
        w.buffer.writeInt(textId);
        w.buffer.writeInt(type);
        w.buffer.writeInt(valueId);
    };
}
exports.HOST_ACTION_STRING_TYPE = 2;
/**
 * HOST_ACTION (209) with no metadata, HostActionMetadata (216) with it: the host's
 * RemoteContext.runAction(id, metadata) — HostAction(actionId[, metadataId]) in the reference.
 */
function hostAction(actionId, metadataId) {
    return (w) => {
        if (metadataId === -1) {
            w.buffer.start(exports.OP.HOST_ACTION);
            w.buffer.writeInt(actionId);
        }
        else {
            w.buffer.start(exports.OP.HOST_ACTION_METADATA);
            w.buffer.writeInt(actionId);
            w.buffer.writeInt(metadataId);
        }
    };
}
/**
 * VALUE_FLOAT_EXPRESSION_CHANGE_ACTION (227): on click, set the target variable to the
 * value of an expression. This is what lets a document hold its own state without any host
 * code — `{"target": "@d1", "value": "1 - @d1"}` toggles d1 between 0 and 1.
 */
function valueFloatExpressionChange(targetId, valueId) {
    return (w) => {
        w.buffer.start(exports.OP.VALUE_FLOAT_EXPRESSION_CHANGE_ACTION);
        w.buffer.writeInt(targetId);
        w.buffer.writeInt(valueId);
    };
}
/** VALUE_FLOAT_CHANGE_ACTION (222): set the target to a constant. No expression op. */
function valueFloatChange(targetId, valueBits) {
    return (w) => {
        w.buffer.start(exports.OP.VALUE_FLOAT_CHANGE_ACTION);
        w.buffer.writeInt(targetId);
        w.buffer.writeInt(valueBits);
    };
}
/** VALUE_INTEGER_CHANGE_ACTION (212): set an integer variable to a constant. */
function valueIntegerChange(targetId, value) {
    return (w) => {
        w.buffer.start(exports.OP.VALUE_INTEGER_CHANGE_ACTION);
        w.buffer.writeInt(targetId);
        w.buffer.writeInt(value);
    };
}
/** VALUE_STRING_CHANGE_ACTION (213): point a string variable at another text id. */
function valueStringChange(targetId, textId) {
    return (w) => {
        w.buffer.start(exports.OP.VALUE_STRING_CHANGE_ACTION);
        w.buffer.writeInt(targetId);
        w.buffer.writeInt(textId);
    };
}
/**
 * VALUE_INTEGER_EXPRESSION_CHANGE_ACTION (218): both fields are *longs*, not ints.
 *
 * The only action of the five with a 64-bit payload — integer expression ids are long — so
 * writing it like its float sibling produces an op half the size the reader expects and
 * desyncs everything after it.
 */
function valueIntegerExpressionChange(targetId, valueId) {
    return (w) => {
        w.buffer.start(exports.OP.VALUE_INTEGER_EXPRESSION_CHANGE_ACTION);
        w.buffer.writeLong(targetId);
        w.buffer.writeLong(valueId);
    };
}
/** MODIFIER_OFFSET (221): two floats, either of which may be a NaN-boxed variable. */
function modOffset(xBits, yBits) {
    return (w) => {
        w.buffer.start(exports.OP.MODIFIER_OFFSET);
        w.buffer.writeInt(xBits);
        w.buffer.writeInt(yBits);
    };
}
/** A background that references a colour id — the host can change it at runtime. */
function modBackgroundId(colorId) {
    return (w) => {
        w.buffer.start(exports.OP.MODIFIER_BACKGROUND);
        w.buffer.writeInt(2); // BG_COLOR_REF
        w.buffer.writeInt(colorId);
        w.buffer.writeInt(0);
        w.buffer.writeInt(0); // reserve1, reserve2
        for (let i = 0; i < 4; i++)
            w.buffer.writeFloat(0.0); // r g b a unused
        w.buffer.writeInt(0); // shapeType
    };
}
function modBackground(color) {
    const a = ((color >>> 24) & 0xff) / 255.0;
    const r = ((color >>> 16) & 0xff) / 255.0;
    const g = ((color >>> 8) & 0xff) / 255.0;
    const b = (color & 0xff) / 255.0;
    return (w) => {
        w.buffer.start(exports.OP.MODIFIER_BACKGROUND);
        w.buffer.writeInt(0);
        w.buffer.writeInt(0); // flags, colorId
        w.buffer.writeInt(0);
        w.buffer.writeInt(0); // reserve1, reserve2
        w.buffer.writeFloat(r);
        w.buffer.writeFloat(g);
        w.buffer.writeFloat(b);
        w.buffer.writeFloat(a);
        w.buffer.writeInt(0); // shapeType
    };
}
