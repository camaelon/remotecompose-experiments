// Operation parameter decoding shared by the Command List and the Expression Dependency Graph.
//
// RemoteCompose encodes a float parameter that is driven by an expression as a NaN-boxed
// float: the IEEE-754 exponent is all ones and the mantissa carries the variable id. An op
// therefore stores either a literal float or a variable reference in the same slot, and the
// two are only distinguishable by inspecting the raw bits. Operations keep the raw bits in
// `mFooBits` and the value resolved for the current frame in `mFoo`; matrix operations keep
// the raw bits directly in the named field.
//
// Decoding lives here so that what the Command List displays and what the dependency graph
// treats as an edge can never drift apart.

const NAN_MASK = 0x7f800000;

export function isVarRefBits(bits) {
    if (!Number.isInteger(bits)) return false;
    const b = bits | 0;
    return (b & NAN_MASK) === NAN_MASK && (b & 0x7fffff) !== 0;
}

export function varIdFromBits(bits) {
    return (bits | 0) & 0x7fffff;
}

const _dv = new DataView(new ArrayBuffer(4));
export function bitsToFloat(bits) {
    _dv.setInt32(0, bits | 0);
    return _dv.getFloat32(0);
}

export function formatColorInt(v) {
    return '#' + ((v >>> 0).toString(16).padStart(8, '0').toUpperCase());
}

function formatScalar(v) {
    if (typeof v !== 'number') return String(v);
    if (Number.isInteger(v)) return String(v);
    if (!Number.isFinite(v)) return String(v);
    const abs = Math.abs(v);
    if (abs !== 0 && (abs < 0.001 || abs >= 1e7)) return v.toExponential(3);
    return String(Math.round(v * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// PaintBundle
// ---------------------------------------------------------------------------

// Paint parameters live in a flat int array of [command, value...] runs. The tag in the low
// 16 bits of the command selects how many words follow and how each is interpreted; enum-style
// tags carry their value in the high 16 bits instead. This mirrors PaintBundle.registerListening
// in players/typescript — a blind NaN scan over the array is NOT safe here, because an opaque
// ARGB color such as 0xFFFFC46B also matches the NaN bit pattern while being a literal color.
const PAINT = {
    TEXT_SIZE: 1, COLOR: 4, STROKE_WIDTH: 5, STROKE_MITER: 6, STROKE_CAP: 7, STYLE: 8,
    SHADER: 9, IMAGE_FILTER_QUALITY: 10, GRADIENT: 11, ALPHA: 12, COLOR_FILTER: 13,
    ANTI_ALIAS: 14, STROKE_JOIN: 15, TYPEFACE: 16, FILTER_BITMAP: 17, BLEND_MODE: 18,
    COLOR_ID: 19, COLOR_FILTER_ID: 20, CLEAR_COLOR_FILTER: 21, SHADER_MATRIX: 22,
    FONT_AXIS: 23, TEXTURE: 24, PATH_EFFECT: 25, FALLBACK_TYPEFACE: 26
};

const PAINT_TAG_NAMES = {
    1: 'textSize', 4: 'color', 5: 'strokeWidth', 6: 'strokeMiter', 7: 'strokeCap', 8: 'style',
    9: 'shader', 10: 'filterQuality', 11: 'gradient', 12: 'alpha', 13: 'colorFilter',
    14: 'antiAlias', 15: 'strokeJoin', 16: 'typeface', 17: 'filterBitmap', 18: 'blendMode',
    19: 'colorId', 20: 'colorFilterId', 21: 'clearColorFilter', 22: 'shaderMatrix',
    23: 'fontAxis', 24: 'texture', 25: 'pathEffect', 26: 'fallbackTypeface'
};

const STYLE_NAMES = ['fill', 'stroke', 'fillAndStroke'];
const CAP_NAMES = ['butt', 'round', 'square'];
const JOIN_NAMES = ['miter', 'round', 'bevel'];
const GRADIENT_NAMES = ['linear', 'radial', 'sweep'];

function floatParam(label, raw) {
    if (isVarRefBits(raw)) {
        return { label, raw, varId: varIdFromBits(raw), kind: 'float' };
    }
    return { label, raw, value: bitsToFloat(raw), kind: 'float' };
}

/**
 * Decode a PaintBundle into labelled parameters, following the tag grammar so that
 * literal colors are never mistaken for variable references.
 */
export function walkPaintBundle(bundle) {
    const params = [];
    if (!bundle) return params;
    const arr = bundle.mArray || bundle.array;
    const end = bundle.mPos ?? (arr ? arr.length : 0);
    if (!arr) return params;

    let i = 0;
    let guard = 0;
    while (i < end && guard++ < 4096) {
        const cmd = arr[i++];
        const tag = cmd & 0xffff;
        const high = (cmd >> 16) & 0xffff;
        const name = PAINT_TAG_NAMES[tag] || `tag${tag}`;

        switch (tag) {
            case PAINT.STROKE_MITER:
            case PAINT.STROKE_WIDTH:
            case PAINT.ALPHA:
            case PAINT.TEXT_SIZE:
                params.push(floatParam(name, arr[i++]));
                break;

            case PAINT.COLOR_ID:
            case PAINT.COLOR_FILTER_ID:
                params.push({ label: name, raw: arr[i], varId: arr[i], kind: 'colorId' });
                i++;
                break;

            case PAINT.COLOR:
                params.push({ label: name, raw: arr[i], value: formatColorInt(arr[i]), kind: 'color' });
                i++;
                break;

            case PAINT.TYPEFACE:
            case PAINT.SHADER:
            case PAINT.COLOR_FILTER:
            case PAINT.FALLBACK_TYPEFACE:
                params.push({ label: name, raw: arr[i], value: arr[i], kind: 'int' });
                i++;
                break;

            // Enum-style tags carry their value packed in the command's high half.
            case PAINT.STYLE:
                params.push({ label: name, value: STYLE_NAMES[high] ?? high, kind: 'enum' });
                break;
            case PAINT.STROKE_CAP:
                params.push({ label: name, value: CAP_NAMES[high] ?? high, kind: 'enum' });
                break;
            case PAINT.STROKE_JOIN:
                params.push({ label: name, value: JOIN_NAMES[high] ?? high, kind: 'enum' });
                break;
            case PAINT.ANTI_ALIAS:
            case PAINT.FILTER_BITMAP:
                params.push({ label: name, value: high ? 'true' : 'false', kind: 'enum' });
                break;
            case PAINT.IMAGE_FILTER_QUALITY:
            case PAINT.BLEND_MODE:
            case PAINT.CLEAR_COLOR_FILTER:
                params.push({ label: name, value: high, kind: 'enum' });
                break;

            case PAINT.FONT_AXIS:
                for (let j = 0; j < high; j++) {
                    const axisTag = arr[i++];
                    params.push(floatParam(`fontAxis[${axisTag}]`, arr[i++]));
                }
                break;

            case PAINT.TEXTURE:
                params.push({ label: name, value: `${arr[i]}, ${arr[i + 1]}, ${arr[i + 2]}`, kind: 'int' });
                i += 3;
                break;

            case PAINT.SHADER_MATRIX:
                params.push({ label: name, raw: arr[i], value: arr[i], kind: 'int' });
                i++;
                break;

            case PAINT.PATH_EFFECT:
                for (let j = 0; j < high; j++) params.push(floatParam(`pathEffect[${j}]`, arr[i++]));
                params.push(floatParam('pathEffectPhase', arr[i++]));
                break;

            case PAINT.GRADIENT: {
                const meta = arr[i++];
                const numColors = meta & 0xff;
                const register = (meta >> 16) & 0xffff;
                params.push({ label: 'gradient', value: GRADIENT_NAMES[high] ?? high, kind: 'enum' });
                for (let j = 0; j < numColors; j++) {
                    // A registered slot holds a color id to resolve; the rest are literal colors.
                    if ((register & (1 << j)) !== 0) {
                        params.push({ label: `gradColor[${j}]`, raw: arr[i], varId: arr[i], kind: 'colorId' });
                    } else {
                        params.push({ label: `gradColor[${j}]`, raw: arr[i], value: formatColorInt(arr[i]), kind: 'color' });
                    }
                    i++;
                }
                const numStops = arr[i++];
                for (let j = 0; j < numStops; j++) params.push(floatParam(`gradStop[${j}]`, arr[i++]));
                const geometry = high === 0 ? ['x0', 'y0', 'x1', 'y1']
                    : high === 1 ? ['cx', 'cy', 'radius']
                    : high === 2 ? ['cx', 'cy'] : [];
                geometry.forEach(g => params.push(floatParam(`grad.${g}`, arr[i++])));
                if (high === 0 || high === 1) i++; // tileMode
                break;
            }

            default:
                // Unknown tag: stop rather than desynchronise and emit garbage.
                return params;
        }
    }
    return params;
}

// ---------------------------------------------------------------------------
// Operation parameter schemas
// ---------------------------------------------------------------------------

// Friendly names for the positional slots of the common draw/matrix operations. Anything not
// listed here still gets its parameters shown, labelled by field name.
const OP_PARAM_SCHEMAS = {
    42:  { fields: [['mX1', 'left'], ['mY1', 'top'], ['mX2', 'right'], ['mY2', 'bottom']] },            // DrawRect
    46:  { fields: [['mV1', 'cx'], ['mV2', 'cy'], ['mV3', 'radius']] },                                  // DrawCircle
    47:  { fields: [['mX1', 'x1'], ['mY1', 'y1'], ['mX2', 'x2'], ['mY2', 'y2']] },                       // DrawLine
    56:  { fields: [['mX1', 'left'], ['mY1', 'top'], ['mX2', 'right'], ['mY2', 'bottom']] },            // DrawOval
    51:  { fields: [['mV1', 'left'], ['mV2', 'top'], ['mV3', 'right'], ['mV4', 'bottom'], ['mV5', 'rx'], ['mV6', 'ry']] },
    152: { fields: [['mV1', 'left'], ['mV2', 'top'], ['mV3', 'right'], ['mV4', 'bottom'], ['mV5', 'startAngle'], ['mV6', 'sweepAngle']] },
    52:  { fields: [['mV1', 'left'], ['mV2', 'top'], ['mV3', 'right'], ['mV4', 'bottom'], ['mV5', 'startAngle'], ['mV6', 'sweepAngle']] },
    43:  { fields: [['mV1', 'left'], ['mV2', 'top'], ['mV3', 'right'], ['mV4', 'bottom'], ['mV5', 'srcLeft'], ['mV6', 'srcTop']] },
    // Matrix ops keep raw NaN-boxed bits directly in their named fields.
    129: { rawFields: [['mAngle', 'angle'], ['mPivotX', 'pivotX'], ['mPivotY', 'pivotY']] },
    126: { rawFields: [['mScaleX', 'scaleX'], ['mScaleY', 'scaleY'], ['mCenterX', 'centerX'], ['mCenterY', 'centerY']] },
    127: { rawFields: [['mTranslateX', 'translateX'], ['mTranslateY', 'translateY']] },
    128: { rawFields: [['mSkewX', 'skewX'], ['mSkewY', 'skewY']] },
    181: { plain: [['mPathId', 'pathId']], rawFields: [['mFraction', 'fraction'], ['mVOffset', 'vOffset']] },
    133: { fields: [['mX', 'x'], ['mY', 'y'], ['mPanX', 'panX'], ['mPanY', 'panY']], plain: [['mTextID', 'textId'], ['mFlags', 'flags']] },
    150: { componentValue: true },
    215: { loop: true },      // LoopOperation defines the loop index variable
    161: { particles: true }  // ParticlesCreate defines one variable per particle attribute
};

// ComponentValue reads a layout component's geometry into a float variable.
const COMPONENT_VALUE_TYPES = ['width', 'height', 'posX', 'posY', 'posRootX', 'posRootY', 'contentWidth', 'contentHeight'];

// Bookkeeping and cached-render fields that are not operation parameters.
const SKIP_FIELDS = new Set([
    'mDirty', 'OP_CODE', 'mOpCode', '_byteStart', '_byteEnd', 'mLastChange',
    'mLastCalculatedValue', 'mLastAnimatedValue', 'mOutArray', 'mOutBits', 'mOutInputs',
    'mTempOut', 'mR0', 'mR1', 'mR2', 'mR3', 'mPos', 'mList', 'mOps', 'mOperations',
    'operations', 'mParent', 'mComponent', 'mPaintBundle', 'mBuffer'
]);

// Layout components carry their measured geometry on the same object as their serialized
// fields. These are computed during layout, not read from the binary, so they are tagged
// separately rather than presented as payload parameters.
const MEASURED_FIELDS = new Set(['mX', 'mY', 'mWidth', 'mHeight', 'mZIndex', 'mVisibility', 'mCurrentId']);

function labelFor(prop) {
    return prop.replace(/^m(?=[A-Z])/, '').replace(/^./, c => c.toLowerCase());
}

/**
 * Decode an operation's parameters into a labelled list. Slots holding a variable reference
 * report `varId` alongside the value the engine resolved for the current frame.
 */
export function getOpParameters(op) {
    if (!op) return [];
    const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : -1);
    const params = [];

    if (opCode === 40 || (op.mPaintBundle && op.mPaintBundle.mArray)) {
        return walkPaintBundle(op.mPaintBundle);
    }

    const schema = OP_PARAM_SCHEMAS[opCode];

    if (schema && schema.componentValue) {
        const type = op.mType ?? 0;
        params.push({ label: 'value', value: COMPONENT_VALUE_TYPES[type] ?? `type${type}`, kind: 'enum' });
        params.push({ label: 'of', value: `component ${op.mComponentId}`, kind: 'ref' });
        params.push({ label: 'into', value: op.mValueId, varId: op.mValueId, kind: 'output' });
        return params;
    }

    if (schema && schema.loop) {
        if (op.mIndexId !== undefined) {
            params.push({ label: 'index', value: op.mIndexId, varId: op.mIndexId, kind: 'output' });
        }
        [['mFromBits', 'from'], ['mStepBits', 'step'], ['mUntilBits', 'until']].forEach(([prop, label]) => {
            if (op[prop] !== undefined) params.push(floatParam(label, op[prop]));
        });
        return params;
    }

    if (schema && schema.particles) {
        if (op.mParticleCount !== undefined) {
            params.push({ label: 'count', value: op.mParticleCount, kind: 'int' });
        }
        const varIds = op.mVarId || [];
        for (let i = 0; i < varIds.length; i++) {
            params.push({ label: `particleVar[${i}]`, value: varIds[i], varId: varIds[i], kind: 'output' });
        }
        return params;
    }

    if (schema) {
        // `mFooBits` holds the encoding, `mFoo` the value resolved for this frame.
        (schema.fields || []).forEach(([prop, label]) => {
            const bits = op[`${prop}Bits`];
            if (bits === undefined) return;
            if (isVarRefBits(bits)) {
                params.push({ label, raw: bits, varId: varIdFromBits(bits), value: op[prop], kind: 'float' });
            } else {
                params.push({ label, raw: bits, value: op[prop] ?? bitsToFloat(bits), kind: 'float' });
            }
        });
        (schema.rawFields || []).forEach(([prop, label]) => {
            const bits = op[prop];
            if (bits === undefined) return;
            if (isVarRefBits(bits)) {
                params.push({ label, raw: bits, varId: varIdFromBits(bits), kind: 'float' });
            } else {
                params.push({ label, raw: bits, value: bitsToFloat(bits), kind: 'float' });
            }
        });
        (schema.plain || []).forEach(([prop, label]) => {
            if (op[prop] !== undefined) params.push({ label, value: op[prop], kind: 'int' });
        });
        if (params.length) return params;
    }

    // Generic fallback: every own numeric field, preferring the `Bits` variant when present.
    const seen = new Set();
    for (const key in op) {
        if (SKIP_FIELDS.has(key) || key.startsWith('_')) continue;
        const val = op[key];
        if (typeof val !== 'number') continue;
        const base = key.endsWith('Bits') ? key.slice(0, -4) : key;
        if (seen.has(base)) continue;
        const bitsKey = `${base}Bits`;
        const hasBits = typeof op[bitsKey] === 'number';
        const bits = hasBits ? op[bitsKey] : val;
        seen.add(base);
        if (isVarRefBits(bits) && (hasBits || key.endsWith('Bits'))) {
            params.push({ label: labelFor(base), raw: bits, varId: varIdFromBits(bits), value: op[base], kind: 'float' });
        } else if (isVarRefBits(bits) && !Number.isInteger(op[base])) {
            params.push({ label: labelFor(base), raw: bits, varId: varIdFromBits(bits), value: op[base], kind: 'float' });
        } else {
            const isMeasured = MEASURED_FIELDS.has(base) && op.mComponentId !== undefined;
            params.push({
                label: labelFor(base), raw: bits, value: hasBits ? op[base] : val,
                kind: isMeasured ? 'measured' : 'int'
            });
        }
    }
    return params;
}

// Terminal operations do work that matters on its own — they are not a variable definition
// waiting for a reader. The particle family runs a simulation every frame and advances its own
// state, so an attribute variable that no draw operation happens to read does not make the
// operation dead code: it cannot be removed, and none of its five attributes can be removed
// individually. Reachability analysis must therefore treat these as roots, exactly like a
// drawing operation, rather than requiring them to reach a consumer.
const TERMINAL_OP_CODES = new Set([
    161, // ParticlesCreate
    163, // ParticlesLoop
    194  // ParticlesCompare
]);

export function isTerminalOp(op) {
    if (!op) return false;
    const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : -1);
    return TERMINAL_OP_CODES.has(opCode);
}

/**
 * Variable ids this operation reads, decoded structurally. `output` slots are excluded:
 * they are what the operation writes, not what it consumes.
 */
export function getOpVarReferences(op) {
    const ids = new Set();
    getOpParameters(op).forEach(p => {
        if (p.kind === 'output') return;
        if (p.varId !== undefined && p.varId !== null && p.varId > 0) ids.add(p.varId);
    });
    return Array.from(ids);
}

/** Variable ids this operation defines, if any. */
export function getOpVarOutputs(op) {
    const ids = [];
    getOpParameters(op).forEach(p => {
        if (p.kind === 'output' && p.varId !== undefined && p.varId !== null) ids.push(p.varId);
    });
    return ids;
}

/** Compact one-line rendering, e.g. `cx=200, cy=200, radius=var_46 (25.81)`. */
export function formatOpParameters(op, { max = 8 } = {}) {
    const params = getOpParameters(op);
    if (!params.length) return '';
    const parts = params.slice(0, max).map(p => {
        if (p.kind === 'output') return `${p.label}=var_${p.varId}`;
        if (p.varId !== undefined && p.varId !== null) {
            const resolved = typeof p.value === 'number' && Number.isFinite(p.value)
                ? ` (${formatScalar(p.value)})` : '';
            const prefix = p.kind === 'colorId' ? 'color_' : 'var_';
            return `${p.label}=${prefix}${p.varId}${resolved}`;
        }
        return `${p.label}=${formatScalar(p.value)}`;
    });
    if (params.length > max) parts.push(`… +${params.length - max}`);
    return parts.join(', ');
}

export { formatScalar };
