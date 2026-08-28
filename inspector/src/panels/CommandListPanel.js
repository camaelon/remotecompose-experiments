// =========================================================================
// Panel 2: Command List Panel
// Modularized in src/panels/CommandListPanel.js
// =========================================================================

import { getSystemVarName } from './VariablesPanel.js';
import { getUnusedIslandsAnalysis } from './DependencyGraphPanel.js';

let cmdDisplayCompact = true; // Default: Compact (Indented by Container Depth)
let cmdSortMode = 'position'; // 'position', 'sizeDesc', 'sizeAsc'
const expandedCmdIndices = new Set();

function getOpId(op) {
    if (!op) return null;
    let rawId = null;
    if (typeof op.getId === 'function') {
        rawId = op.getId();
    }
    if (rawId === undefined || rawId === null) {
        rawId = op.mId ?? op.mVarId ?? op.varId ?? op.mColorId ?? op.colorId ?? op.mLengthId ?? op.lengthId ?? op.mTextId ?? op.textId ?? op.id;
    }
    if (typeof rawId === 'bigint') {
        rawId = Number(rawId);
    }
    return (typeof rawId === 'number' && !isNaN(rawId)) ? rawId : null;
}

export { getOpId };

export const KNOWN_OPCODES = {
    0: 'Header',
    2: 'ComponentStart',
    14: 'AnimationSpec',
    16: 'WidthModifier',
    38: 'ClipPath',
    39: 'ClipRect',
    40: 'PaintData',
    42: 'DrawRect',
    43: 'DrawText',
    44: 'DrawBitmap',
    45: 'ShaderData',
    46: 'DrawCircle',
    47: 'DrawLine',
    48: 'DrawBitmapFontText',
    49: 'DrawBitmapFontTextOnPath',
    51: 'DrawRoundRect',
    52: 'DrawSector',
    53: 'DrawTextOnPath',
    54: 'RoundedClipRectModifier',
    55: 'BackgroundModifier',
    56: 'DrawOval',
    57: 'DrawTextOnCircle',
    58: 'PaddingModifier',
    59: 'ClickModifier',
    63: 'Theme',
    64: 'ClickArea',
    65: 'RootContentBehavior',
    66: 'DrawBitmapInt',
    67: 'HeightModifier',
    80: 'FloatConstant',
    81: 'FloatExpression',
    83: 'MultiClickModifier',
    93: 'Custom',
    101: 'BitmapData',
    102: 'TextData',
    103: 'RootContentDescription',
    107: 'BorderModifier',
    108: 'ClipRectModifier',
    123: 'PathData',
    124: 'DrawPath',
    125: 'DrawTweenPath',
    126: 'MatrixScale',
    127: 'MatrixTranslate',
    128: 'MatrixSkew',
    129: 'MatrixRotate',
    130: 'MatrixSave',
    131: 'MatrixRestore',
    132: 'MatrixSet',
    133: 'DrawTextAnchored',
    134: 'ColorExpression',
    135: 'TextFromFloat',
    136: 'TextMerge',
    137: 'NamedVariable',
    138: 'ColorConstant',
    139: 'DrawContent',
    140: 'IntegerConstant',
    141: 'PlaySound',
    142: 'ReferencedOperations',
    143: 'BooleanConstant',
    144: 'IntegerExpression',
    145: 'DataMapIds',
    146: 'IdListData',
    147: 'FloatListData',
    148: 'LongConstant',
    149: 'DrawBitmapScaled',
    150: 'ComponentValue',
    151: 'TextLookup',
    152: 'DrawArc',
    153: 'TextLookupInt',
    154: 'DataMapLookup',
    155: 'TextMeasure',
    156: 'TextLength',
    157: 'TouchExpression',
    158: 'PathTween',
    159: 'PathCreate',
    160: 'PathAppend',
    161: 'ParticlesCreate',
    162: 'ParticlesProcess',
    163: 'ParticlesLoop',
    164: 'ImpulseOperation',
    165: 'ImpulseProcess',
    166: 'FunctionCall',
    167: 'BitmapFontData',
    168: 'FunctionDefine',
    169: 'SoundData',
    170: 'TextAttribute',
    171: 'ImageAttribute',
    172: 'TimeAttribute',
    173: 'CanvasOperations',
    174: 'DrawContentOperation',
    175: 'PathCombine',
    176: 'FitBoxLayout',
    177: 'HapticFeedback',
    178: 'ConditionalOperations',
    179: 'DebugMessage',
    180: 'ColorAttribute',
    181: 'MatrixFromPath',
    182: 'TextSubtext',
    183: 'BitmapTextMeasure',
    184: 'DrawBitmapTextAnchored',
    185: 'Rem',
    186: 'MatrixConstant',
    187: 'MatrixExpression',
    188: 'MatrixVectorMath',
    189: 'FontData',
    190: 'DrawToBitmap',
    191: 'WakeIn',
    192: 'IdLookup',
    193: 'PathExpression',
    194: 'ParticlesCompare',
    196: 'ColorTheme',
    197: 'DataDynamicListFloat',
    198: 'UpdateDynamicFloatList',
    199: 'TextTransform',
    200: 'RootLayoutComponent',
    201: 'LayoutComponentContent',
    202: 'BoxLayout',
    203: 'RowLayout',
    204: 'ColumnLayout',
    205: 'CanvasLayout',
    206: 'SoundExpression',
    207: 'CanvasContent',
    208: 'TextLayout',
    209: 'HostAction',
    210: 'HostNamedAction',
    211: 'ComponentVisibility',
    212: 'ValueIntegerChangeAction',
    213: 'ValueStringChangeAction',
    214: 'ContainerEnd',
    215: 'LoopOperation',
    216: 'HostActionMetadata',
    217: 'StateLayout',
    218: 'ValueIntegerExpressionChangeAction',
    219: 'TouchModifier',
    220: 'TouchUpModifier',
    221: 'OffsetModifier',
    222: 'ValueFloatChangeAction',
    223: 'ZIndexModifier',
    224: 'GraphicsLayerModifier',
    225: 'TouchCancelModifier',
    226: 'ScrollModifier',
    227: 'ValueFloatExpressionChangeAction',
    228: 'MarqueeModifier',
    229: 'RippleModifier',
    230: 'CollapsibleRowLayout',
    231: 'WidthInModifier',
    232: 'HeightInModifier',
    233: 'CollapsibleColumnLayout',
    234: 'ImageLayout',
    235: 'CollapsiblePriorityModifier',
    236: 'RunAction',
    237: 'AlignByModifier',
    238: 'LayoutCompute',
    239: 'CoreText',
    240: 'FlowLayout',
    242: 'TextStyle',
    243: 'DimensionConstraintsModifier',
    244: 'MacroForEach',
    245: 'IncludeReferencedOperations',
    246: 'MacroDefine',
    247: 'MacroCall',
    248: 'MacroArgument',
    249: 'MacroBlock',
    250: 'AccessibilitySemantics'
};

export function getOpName(op) {
    if (!op) return 'Operation';
    const code = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? -1);
    if (code >= 0 && KNOWN_OPCODES[code]) {
        return KNOWN_OPCODES[code];
    }
    if (typeof op.deepToString === 'function') {
        const str = op.deepToString("").trim();
        const match = str.match(/^([A-Za-z0-9_]+)/);
        if (match && match[1] && match[1].length > 2 && !/^[A-Z][a-z]?$/.test(match[1])) {
            return match[1];
        }
    }
    const cName = op.constructor?.name;
    if (cName && cName.length > 2 && !/^[A-Z][a-z]?$/.test(cName)) {
        return cName.startsWith('_') ? cName.slice(1) : cName;
    }
    return code >= 0 ? `Op_${code}` : 'Operation';
}

export function isModifierOp(op) {
    if (!op) return false;
    const code = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? -1);
    if ((code >= 16 && code <= 19) || code === 54 || code === 55 || code === 58 || code === 59 || code === 67 || code === 83 || code === 107 || code === 108 || (code >= 211 && code <= 213) || code === 219 || code === 220 || code === 221 || (code >= 223 && code <= 226) || code === 228 || code === 229 || code === 231 || code === 232 || code === 235 || code === 237 || code === 243) {
        return true;
    }
    const name = getOpName(op);
    if (name.endsWith('Modifier') || name.includes('ModifierOperation') || name === 'ComponentVisibility' || name === 'ComponentWeight' || name === 'ComponentAlign') {
        return true;
    }
    return false;
}

export function isContainerOp(op) {
    if (!op) return false;
    const code = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? -1);
    if (code === 200 || (code >= 202 && code <= 206) || (code >= 208 && code <= 210) || code === 217 || code === 230) {
        return true;
    }
    if (isModifierOp(op) || code === 201 || code === 207 || code === 214 || code === 239 || code === 240) return false;
    const name = getOpName(op);
    if (name === 'ContainerEnd' || name === 'Mi' || name === 'LayoutComponentContent' || name === 'CanvasContent' || name === 'CoreText' || name === 'CorePath') {
        return false;
    }
    if (name.includes('Layout') && !name.includes('Text')) {
        return true;
    }
    return false;
}

export function isComponentOp(op) {
    if (!op) return false;
    const code = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? -1);
    if (code === 200 || (code >= 202 && code <= 206) || (code >= 208 && code <= 210) || code === 217 || code === 230 || code === 239 || code === 240) {
        return true;
    }
    if (isModifierOp(op) || code === 201 || code === 207 || code === 214) return false;
    const name = getOpName(op);
    if (name === 'ContainerEnd' || name === 'Mi' || name === 'LayoutComponentContent' || name === 'CanvasContent') {
        return false;
    }
    if (isContainerOp(op)) return true;
    if (name.includes('Layout') || name === 'CoreText' || name.endsWith('Box') || name.endsWith('Row') || name.endsWith('Column')) {
        return true;
    }
    return false;
}

export function toRawBits(raw) {
    if (typeof raw !== 'number') return 0;
    if (Number.isNaN(raw) || !Number.isInteger(raw)) {
        const buf = new ArrayBuffer(4);
        new Float32Array(buf)[0] = raw;
        return new Int32Array(buf)[0];
    }
    return raw | 0;
}

export function prettyPrintFloatExpression(bits) {
    if (!bits || bits.length === 0) return '';
    const stack = [];
    const OFFSET = 0x310000;

    function isNaNBits(b) {
        return (b & 0x7f800000) === 0x7f800000 && (b & 0x7fffff) !== 0;
    }

    function idFromBits(b) {
        return b & 0x7fffff;
    }

    function intBitsToFloat(b) {
        const buf = new ArrayBuffer(4);
        new Int32Array(buf)[0] = b;
        return new Float32Array(buf)[0];
    }

    for (let i = 0; i < bits.length; i++) {
        const raw = bits[i];
        const b = toRawBits(raw);

        if (isNaNBits(b)) {
            const id = idFromBits(b);
            if ((id & 0x700000) === 0x200000) {
                stack.push(`array_${id & 0x1fffff}`);
            } else if (id > OFFSET && id <= OFFSET + 79) {
                const op = id - OFFSET;
                switch (op) {
                    case 1: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} + ${b})`); break; }
                    case 2: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} - ${b})`); break; }
                    case 3: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} * ${b})`); break; }
                    case 4: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} / ${b})`); break; }
                    case 5: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} % ${b})`); break; }
                    case 6: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`min(${a}, ${b})`); break; }
                    case 7: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`max(${a}, ${b})`); break; }
                    case 8: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`pow(${a}, ${b})`); break; }
                    case 9: { const a = stack.pop() || '0'; stack.push(`sqrt(${a})`); break; }
                    case 10: { const a = stack.pop() || '0'; stack.push(`abs(${a})`); break; }
                    case 11: { const a = stack.pop() || '0'; stack.push(`sign(${a})`); break; }
                    case 12: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`copySign(${a}, ${b})`); break; }
                    case 13: { const a = stack.pop() || '0'; stack.push(`exp(${a})`); break; }
                    case 14: { const a = stack.pop() || '0'; stack.push(`floor(${a})`); break; }
                    case 15: { const a = stack.pop() || '0'; stack.push(`log10(${a})`); break; }
                    case 16: { const a = stack.pop() || '0'; stack.push(`log(${a})`); break; }
                    case 17: { const a = stack.pop() || '0'; stack.push(`round(${a})`); break; }
                    case 18: { const a = stack.pop() || '0'; stack.push(`sin(${a})`); break; }
                    case 19: { const a = stack.pop() || '0'; stack.push(`cos(${a})`); break; }
                    case 20: { const a = stack.pop() || '0'; stack.push(`tan(${a})`); break; }
                    case 21: { const a = stack.pop() || '0'; stack.push(`asin(${a})`); break; }
                    case 22: { const a = stack.pop() || '0'; stack.push(`acos(${a})`); break; }
                    case 23: { const a = stack.pop() || '0'; stack.push(`atan(${a})`); break; }
                    case 24: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`atan2(${a}, ${b})`); break; }
                    case 25: { const c = stack.pop() || '0', b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`mad(${a}, ${b}, ${c})`); break; }
                    case 26: { const c = stack.pop() || '0', b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${c} > 0 ? ${b} : ${a})`); break; }
                    case 27: { const c = stack.pop() || '0', b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`clamp(${a}, ${b}, ${c})`); break; }
                    case 28: { const a = stack.pop() || '0'; stack.push(`cbrt(${a})`); break; }
                    case 29: { const a = stack.pop() || '0'; stack.push(`deg(${a})`); break; }
                    case 30: { const a = stack.pop() || '0'; stack.push(`rad(${a})`); break; }
                    case 31: { const a = stack.pop() || '0'; stack.push(`ceil(${a})`); break; }
                    case 44: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} > ${b})`); break; }
                    case 49: { const c = stack.pop() || '0', b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`lerp(${a}, ${b}, ${c})`); break; }
                    case 73: { const a = stack.pop() || '0'; stack.push(`-${a}`); break; }
                    default: stack.push(`op_${op}`); break;
                }
            } else {
                stack.push(`var_${id}`);
            }
        } else {
            const f = intBitsToFloat(b);
            stack.push(Number.isInteger(f) ? f.toString() : f.toFixed(2));
        }
    }
    return stack.pop() || '';
}

export function prettyPrintIntegerExpression(mask, exp) {
    if (!exp || exp.length === 0) return '';
    const stack = [];
    const OFFSET = 0x310000;

    function isVar(val) {
        return (val & 0x7f800000) === 0x7f800000 && (val & 0x7fffff) !== 0;
    }

    function isOp(val) {
        const id = val & 0x7fffff;
        return isVar(val) && id > OFFSET && id <= OFFSET + 79;
    }

    function getOp(val) {
        return (val & 0x7fffff) - OFFSET;
    }

    for (let i = 0; i < exp.length; i++) {
        const val = exp[i];
        if (isOp(val)) {
            const op = getOp(val);
            switch (op) {
                case 1: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} + ${b})`); break; }
                case 2: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} - ${b})`); break; }
                case 3: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} * ${b})`); break; }
                case 4: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} / ${b})`); break; }
                case 5: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} % ${b})`); break; }
                case 6: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`min(${a}, ${b})`); break; }
                case 7: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`max(${a}, ${b})`); break; }
                case 26: { const c = stack.pop() || '0', b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${c} > 0 ? ${b} : ${a})`); break; }
                case 27: { const c = stack.pop() || '0', b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`clamp(${a}, ${b}, ${c})`); break; }
                case 44: { const b = stack.pop() || '0', a = stack.pop() || '0'; stack.push(`(${a} > ${b})`); break; }
                case 73: { const a = stack.pop() || '0'; stack.push(`-${a}`); break; }
                default: stack.push(`op_${op}`); break;
            }
        } else if (isVar(val)) {
            const id = val & 0x7fffff;
            stack.push(`var_${id}`);
        } else {
            stack.push(val.toString());
        }
    }
    return stack.pop() || '';
}

export function getEffectiveChildren(op) {
    if (!op || typeof op.getList !== 'function') return [];
    const result = [];
    const list = op.getList() || [];
    list.forEach(child => {
        const name = getOpName(child);
        if (name === 'LayoutComponentContent' || child.OP_CODE === 201 ||
            name === 'CanvasContent' || child.OP_CODE === 207) {
            result.push(...getEffectiveChildren(child));
        } else if (name !== 'ContainerEnd' && name !== 'Mi' && child.OP_CODE !== 214) {
            result.push(child);
        }
    });
    return result;
}

export function toggleCmdDisplayMode() {
    cmdDisplayCompact = !cmdDisplayCompact;
    const btn = document.getElementById('toggleCmdModeBtn');
    if (btn) {
        btn.textContent = cmdDisplayCompact ? '📋 Compact' : '🔍 Detailed';
        btn.title = cmdDisplayCompact ? 'Switch to Detailed Mode' : 'Switch to Compact (Indented) Mode';
    }
    const currentParsedOps = window.currentParsedOps;
    const currentBuffer = window.currentBuffer;
    if (currentParsedOps) {
        const u8 = currentBuffer ? new Uint8Array(currentBuffer) : null;
        renderCommandsList(currentParsedOps, u8);
    }
}

export function changeCmdSortMode(mode) {
    cmdSortMode = mode || 'position';
    const currentParsedOps = window.currentParsedOps;
    const currentBuffer = window.currentBuffer;
    if (currentParsedOps) {
        const u8 = currentBuffer ? new Uint8Array(currentBuffer) : null;
        renderCommandsList(currentParsedOps, u8);
    }
}

export function renderPathDataPreviewHtml(op, idx) {
    if (!op) return '';
    const parsed = parsePathDataOp(op);
    if (!parsed || !parsed.d || !isFinite(parsed.minX) || !isFinite(parsed.maxX)) return '';

    const pad = Math.max(8, (parsed.w || 10) * 0.1, (parsed.h || 10) * 0.1);
    const vMinX = parsed.minX - pad;
    const vMinY = parsed.minY - pad;
    const vW = Math.max(16, parsed.w + pad * 2);
    const vH = Math.max(16, parsed.h + pad * 2);

    const cmdsHtml = (parsed.segments || []).map(s => 
        `<span style="font-family:var(--code-font); font-size:0.7rem; color:var(--text-secondary);"><strong style="color:var(--accent-blue);">${s.type}</strong> ${s.str ? s.str.replace(s.type, '') : ''}</span>`
    ).join(' ');

    return `
        <div style="margin-top:6px; display:flex; align-items:center; gap:12px; background:rgba(0,0,0,0.3); padding:8px; border-radius:4px; border:1px solid rgba(255,255,255,0.06);">
            <svg width="100" height="70" viewBox="${vMinX} ${vMinY} ${vW} ${vH}" style="background:#0f172a; border-radius:4px; border:1px solid var(--border-color); flex-shrink:0;">
                <path d="${parsed.d}" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="${Math.max(1.2, vW / 80)}" />
            </svg>
            <div style="flex:1; overflow-x:auto; max-height:75px; font-size:0.68rem; line-height:1.4;">
                <div style="font-weight:600; color:var(--text-primary); margin-bottom:2px; display:flex; align-items:center; gap:6px;">
                    <span>📐 Vector Path Data</span>
                    <span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:0.65rem;">${parsed.cmdCount} commands</span>
                    <span style="color:var(--text-muted); font-size:0.68rem;">Bounds: ${parsed.minX.toFixed(1)},${parsed.minY.toFixed(1)} (${parsed.w.toFixed(1)} × ${parsed.h.toFixed(1)})</span>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:4px;">${cmdsHtml}</div>
            </div>
        </div>
    `;
}

export function renderPathCombinePreviewHtml(op, idx) {
    if (!op) return '';
    const outId = op.mOutId ?? op.mId ?? op.id ?? 0;
    const p1 = op.mPathId1 ?? op.path1Id ?? op.path1 ?? op.mPath1 ?? 0;
    const p2 = op.mPathId2 ?? op.path2Id ?? op.path2 ?? op.mPath2 ?? 0;
    const mode = op.mOperation ?? op.mMode ?? op.mode ?? 0;

    const MODES = {
        0: { name: 'DIFFERENCE', icon: '−', sym: '∖', label: 'P1 ∖ P2 (Subtract Path 2 from Path 1)' },
        1: { name: 'INTERSECT', icon: '∩', sym: '∩', label: 'P1 ∩ P2 (Intersection)' },
        2: { name: 'REVERSE_DIFFERENCE', icon: '⧵', sym: '⧵', label: 'P2 ∖ P1 (Subtract Path 1 from Path 2)' },
        3: { name: 'UNION', icon: '∪', sym: '∪', label: 'P1 ∪ P2 (Union)' },
        4: { name: 'XOR', icon: '⊕', sym: '⊕', label: 'P1 ⊕ P2 (Exclusive OR)' }
    };
    const modeInfo = MODES[mode] || { name: `MODE_${mode}`, icon: '⚙️', sym: '⚙️', label: `Mode ${mode}` };

    const allOps = window.currentParsedOps || [];
    let p1Op = null, p2Op = null;
    let p1Idx = -1, p2Idx = -1;
    allOps.forEach((o, i) => {
        const id = getOpId(o);
        if (id === p1 && !p1Op) { p1Op = o; p1Idx = i; }
        if (id === p2 && !p2Op) { p2Op = o; p2Idx = i; }
    });

    const p1Parsed = p1Op ? parsePathDataOp(p1Op) : null;
    const p2Parsed = p2Op ? parsePathDataOp(p2Op) : null;

    let svgContent = '';
    let boundsText = '';

    if (p1Parsed && p2Parsed && p1Parsed.d && p2Parsed.d) {
        const minX = Math.min(p1Parsed.minX, p2Parsed.minX);
        const minY = Math.min(p1Parsed.minY, p2Parsed.minY);
        const maxX = Math.max(p1Parsed.maxX, p2Parsed.maxX);
        const maxY = Math.max(p1Parsed.maxY, p2Parsed.maxY);
        const w = Math.max(10, maxX - minX);
        const h = Math.max(10, maxY - minY);
        const pad = Math.max(8, w * 0.1, h * 0.1);
        const vMinX = minX - pad;
        const vMinY = minY - pad;
        const vW = w + pad * 2;
        const vH = h + pad * 2;
        const sw = Math.max(1.2, vW / 80);

        boundsText = `Bounds: ${minX.toFixed(1)},${minY.toFixed(1)} (${w.toFixed(1)} × ${h.toFixed(1)})`;

        svgContent = `
            <svg width="110" height="75" viewBox="${vMinX} ${vMinY} ${vW} ${vH}" style="background:#0f172a; border-radius:4px; border:1px solid var(--border-color); flex-shrink:0;">
                <!-- Path 1 (Source A) -->
                <path d="${p1Parsed.d}" fill="rgba(56, 189, 248, 0.22)" stroke="#38bdf8" stroke-width="${sw}" />
                <!-- Path 2 (Source B) -->
                <path d="${p2Parsed.d}" fill="rgba(245, 158, 11, 0.22)" stroke="#f59e0b" stroke-width="${sw}" stroke-dasharray="${sw * 3},${sw * 2}" />
            </svg>
        `;
    } else if (p1Parsed && p1Parsed.d) {
        const pad = Math.max(8, p1Parsed.w * 0.1, p1Parsed.h * 0.1);
        const vMinX = p1Parsed.minX - pad;
        const vMinY = p1Parsed.minY - pad;
        const vW = Math.max(16, p1Parsed.w + pad * 2);
        const vH = Math.max(16, p1Parsed.h + pad * 2);
        const sw = Math.max(1.2, vW / 80);

        svgContent = `
            <svg width="110" height="75" viewBox="${vMinX} ${vMinY} ${vW} ${vH}" style="background:#0f172a; border-radius:4px; border:1px solid var(--border-color); flex-shrink:0;">
                <path d="${p1Parsed.d}" fill="rgba(56, 189, 248, 0.22)" stroke="#38bdf8" stroke-width="${sw}" />
            </svg>
        `;
    } else {
        svgContent = `
            <div style="width:110px; height:75px; background:#0f172a; border-radius:4px; border:1px solid var(--border-color); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; flex-shrink:0;">
                <span style="font-size:1.4rem;">${modeInfo.icon}</span>
                <span style="font-size:0.65rem; color:var(--text-muted); font-family:var(--code-font);">${modeInfo.name}</span>
            </div>
        `;
    }

    const p1Chip = p1Idx >= 0 
        ? `<button class="btn btn-secondary btn-xs" onclick="event.stopPropagation(); selectCommandCard(${p1Idx}, ${p1})" style="padding:2px 6px; font-size:0.68rem; font-family:var(--code-font); color:#38bdf8; border-color:rgba(56,189,248,0.4);" title="Click to view Source Path 1 in Command List">🟦 Path #${p1} (Op #${p1Idx + 1})</button>`
        : `<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:0.68rem;">Path #${p1}</span>`;

    const p2Chip = p2Idx >= 0
        ? `<button class="btn btn-secondary btn-xs" onclick="event.stopPropagation(); selectCommandCard(${p2Idx}, ${p2})" style="padding:2px 6px; font-size:0.68rem; font-family:var(--code-font); color:#f59e0b; border-color:rgba(245,158,11,0.4);" title="Click to view Source Path 2 in Command List">🟨 Path #${p2} (Op #${p2Idx + 1})</button>`
        : `<span class="badge" style="background:rgba(245,158,11,0.15); color:#f59e0b; font-size:0.68rem;">Path #${p2}</span>`;

    return `
        <div style="margin-top:6px; display:flex; align-items:center; gap:12px; background:rgba(0,0,0,0.3); padding:8px; border-radius:4px; border:1px solid rgba(255,255,255,0.06);">
            ${svgContent}
            <div style="flex:1; overflow-x:auto; font-size:0.72rem; line-height:1.4;">
                <div style="font-weight:600; color:var(--text-primary); margin-bottom:4px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <span>✨ Constructive Area Geometry (CAG)</span>
                    <span class="badge" style="background:rgba(192,132,252,0.2); color:#c084fc; font-weight:600;">${modeInfo.name} (${mode})</span>
                    ${boundsText ? `<span style="color:var(--text-muted); font-size:0.68rem;">${boundsText}</span>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:4px;">
                    ${p1Chip}
                    <span style="font-size:0.9rem; font-weight:bold; color:var(--text-secondary);">${modeInfo.sym}</span>
                    ${p2Chip}
                    <span style="font-size:0.8rem; color:var(--text-muted);">➔</span>
                    <span class="badge" style="background:rgba(52,211,153,0.18); color:#34d399; font-weight:600;">Result: Path #${outId}</span>
                </div>
                <div style="font-size:0.68rem; color:var(--text-muted);">${modeInfo.label}</div>
            </div>
        </div>
    `;
}

export function uint8ArrayToDataUrl(u8, mime = 'image/png') {
    if (!u8) return '';
    const bytes = u8 instanceof Uint8Array 
        ? u8 
        : (ArrayBuffer.isView(u8) ? new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength) : new Uint8Array(u8));
    if (bytes.length === 0) return '';

    if (typeof Buffer !== 'undefined') {
        return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
    }
    let binary = '';
    const len = bytes.length;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
}

export function getOpBitmapDataUrl(op) {
    if (!op) return null;

    // 1. Direct raw bitmap bytes (PNG, JPG, WebP, GIF, or RAW8/RAW8888)
    const raw = op.mBitmap ?? op.bitmap;
    if (raw) {
        const u8 = raw instanceof Uint8Array 
            ? (raw.buffer ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : raw)
            : (ArrayBuffer.isView(raw) ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : new Uint8Array(raw));

        if (u8 && u8.length > 0) {
            const isPng = u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47;
            const isJpg = u8[0] === 0xFF && u8[1] === 0xD8;
            const isGif = u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46;
            const isWebp = u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46;

            if (isPng || isJpg || isGif || isWebp) {
                const mime = isPng ? 'image/png' : (isJpg ? 'image/jpeg' : (isGif ? 'image/gif' : 'image/webp'));
                return uint8ArrayToDataUrl(u8, mime);
            }

            const w = op.mWidth ?? op.mImageWidth ?? op.width ?? 0;
            const h = op.mHeight ?? op.mImageHeight ?? op.height ?? 0;
            const type = op.mType ?? op.type ?? 0;

            if (w > 0 && h > 0 && typeof document !== 'undefined' && typeof document.createElement === 'function') {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        const imgData = ctx.createImageData(w, h);
                        const d = imgData.data;
                        if (type === 2) { // TYPE_RAW8
                            for (let i = 0; i < w * h && i < u8.length; i++) {
                                const val = u8[i];
                                d[i * 4] = val;
                                d[i * 4 + 1] = val;
                                d[i * 4 + 2] = val;
                                d[i * 4 + 3] = 255;
                            }
                        } else { // TYPE_RAW8888 or fallback
                            for (let i = 0; i < d.length && i < u8.length; i++) {
                                d[i] = u8[i];
                            }
                        }
                        ctx.putImageData(imgData, 0, 0);
                        return canvas.toDataURL();
                    }
                } catch (e) {
                    // ignore canvas error
                }
            }

            return uint8ArrayToDataUrl(u8, 'image/png');
        }
    }

    // 2. Check player's bitmapCanvasCache or bitmapCache (only convert loaded Image to canvas, never return revoked blob url)
    const imgId = op.mImageId ?? op.imageId ?? op.mId ?? op.id ?? op.mBitmapId;
    const player = typeof window !== 'undefined' ? window.currentPlayer : null;
    if (player && player.paintContext && typeof imgId === 'number') {
        const cachedCanvasCtx = player.paintContext.bitmapCanvasCache?.get(imgId);
        if (cachedCanvasCtx && cachedCanvasCtx.canvas) {
            try {
                return cachedCanvasCtx.canvas.toDataURL();
            } catch (e) {}
        }
        const cachedImg = player.paintContext.bitmapCache?.get(imgId);
        if (cachedImg && typeof document !== 'undefined' && typeof document.createElement === 'function') {
            try {
                const nw = cachedImg.naturalWidth || cachedImg.width || 0;
                const nh = cachedImg.naturalHeight || cachedImg.height || 0;
                if (nw > 0 && nh > 0) {
                    const canvas = document.createElement('canvas');
                    canvas.width = nw;
                    canvas.height = nh;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(cachedImg, 0, 0);
                        return canvas.toDataURL();
                    }
                }
            } catch (e) {}
        }
    }

    // 3. If this op references a bitmap ID (e.g. ImageLayout, DrawBitmap), look up the source BitmapData op
    if (typeof imgId === 'number') {
        const allOps = (typeof window !== 'undefined' && window.currentParsedOps) ? window.currentParsedOps : [];
        for (const o of allOps) {
            const oId = o.mImageId ?? o.imageId ?? o.mId ?? o.id;
            if (oId === imgId && (o.mBitmap || o.bitmap) && o !== op) {
                return getOpBitmapDataUrl(o);
            }
        }
        if (player && player.mRemoteComposeState) {
            const stateObj = player.mRemoteComposeState.getObject?.(imgId);
            if (stateObj && stateObj !== op && (stateObj.mBitmap || stateObj.bitmap)) {
                return getOpBitmapDataUrl(stateObj);
            }
        }
    }

    return null;
}

export function renderBitmapDataPreviewHtml(op, idx) {
    if (!op) return '';
    const imgId = op.mImageId ?? op.imageId ?? op.mId ?? op.id ?? 0;
    const w = op.mWidth ?? op.mImageWidth ?? op.width ?? 0;
    const h = op.mHeight ?? op.mImageHeight ?? op.height ?? 0;
    const type = op.mType ?? op.type ?? 0;
    const encoding = op.mEncoding ?? op.encoding ?? 0;
    const raw = op.mBitmap ?? op.bitmap;
    const byteLen = raw ? (raw.length || raw.byteLength || 0) : 0;

    const TYPE_NAMES = {
        0: 'PNG_8888',
        1: 'PNG',
        2: 'RAW8',
        3: 'RAW8888',
        4: 'PNG_ALPHA_8'
    };
    const ENCODING_NAMES = {
        0: 'Inline',
        1: 'URL',
        2: 'File Ref',
        3: 'Empty Buffer'
    };
    const typeName = TYPE_NAMES[type] || `TYPE_${type}`;
    const encodingName = ENCODING_NAMES[encoding] || `ENC_${encoding}`;

    const dataUrl = getOpBitmapDataUrl(op);

    let visualContent = '';
    if (dataUrl) {
        visualContent = `
            <div style="position:relative; width:90px; height:75px; background-color:#0b111a; background-image:linear-gradient(45deg, #1e293b 25%, transparent 25%), linear-gradient(-45deg, #1e293b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1e293b 75%), linear-gradient(-45deg, transparent 75%, #1e293b 75%); background-size:12px 12px; background-position:0 0, 0 6px, 6px -6px, -6px 0px; border-radius:4px; border:1px solid var(--border-color); display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0;">
                <img src="${dataUrl}" style="max-width:86px; max-height:71px; object-fit:contain; display:block;" alt="Bitmap ${imgId}" />
            </div>
        `;
    } else {
        visualContent = `
            <div style="width:90px; height:75px; background:#0f172a; border-radius:4px; border:1px dashed var(--border-color); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; flex-shrink:0;">
                <span style="font-size:1.4rem;">🖼️</span>
                <span style="font-size:0.62rem; color:var(--text-muted); font-family:var(--code-font);">${w}×${h}</span>
            </div>
        `;
    }

    return `
        <div style="margin-top:6px; display:flex; align-items:center; gap:12px; background:rgba(0,0,0,0.3); padding:8px; border-radius:4px; border:1px solid rgba(255,255,255,0.06);">
            ${visualContent}
            <div style="flex:1; overflow-x:auto; font-size:0.68rem; line-height:1.4;">
                <div style="font-weight:600; color:var(--text-primary); margin-bottom:2px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <span>🖼️ Bitmap Image Data</span>
                    <span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:0.65rem;">ID: ${imgId}</span>
                    <span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; font-size:0.65rem;">${w} × ${h} px</span>
                    <span class="badge" style="background:rgba(192,132,252,0.15); color:#c084fc; font-size:0.65rem;">${typeName}</span>
                    <span class="badge" style="background:rgba(251,191,36,0.15); color:#fbbf24; font-size:0.65rem;">${encodingName}</span>
                </div>
                <div style="color:var(--text-muted); font-size:0.68rem; margin-top:2px;">
                    ${byteLen > 0 ? `Size: <strong>${byteLen.toLocaleString()} B</strong> (${(byteLen / 1024).toFixed(1)} KB)` : (encoding === 3 ? 'Allocated offscreen canvas target for DrawToBitmap operations.' : 'Empty bitmap buffer')} &bull; Type: <strong>${typeName}</strong> &bull; Encoding: <strong>${encodingName}</strong>
                </div>
            </div>
        </div>
    `;
}

export function renderDrawBitmapReferenceHtml(op, idx) {
    if (!op) return '';
    const imgId = op.mImageId ?? op.imageId ?? op.mId ?? op.id ?? op.mBitmapId;
    if (imgId === undefined || imgId === null || imgId === -1) return '';

    const allOps = (typeof window !== 'undefined' && window.currentParsedOps) ? window.currentParsedOps : [];
    let bmpOp = null;
    let bmpIdx = -1;
    allOps.forEach((o, i) => {
        const code = o.OP_CODE !== undefined ? o.OP_CODE : (o.constructor?.OP_CODE ?? 0);
        const id = o.mImageId ?? o.imageId ?? o.mId ?? o.id;
        if ((code === 101 || o.constructor?.name === 'ws' || o.constructor?.name === 'BitmapData' || (o.mBitmap || o.bitmap)) && id === imgId && !bmpOp) {
            bmpOp = o;
            bmpIdx = i;
        }
    });

    if (!bmpOp && typeof window !== 'undefined' && window.currentPlayer?.mRemoteComposeState) {
        const stateObj = window.currentPlayer.mRemoteComposeState.getObject?.(imgId);
        if (stateObj && (stateObj.mBitmap || stateObj.bitmap)) {
            bmpOp = stateObj;
        }
    }

    const dataUrl = bmpOp ? getOpBitmapDataUrl(bmpOp) : null;
    const w = bmpOp ? (bmpOp.mWidth ?? bmpOp.width ?? '?') : '?';
    const h = bmpOp ? (bmpOp.mHeight ?? bmpOp.height ?? '?') : '?';

    return `
        <div style="margin-top:4px; display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.25); padding:4px 8px; border-radius:4px; border:1px solid rgba(255,255,255,0.06); font-size:0.72rem;">
            ${dataUrl ? `<img src="${dataUrl}" style="width:22px; height:22px; object-fit:contain; background:#0b111a; border-radius:3px; border:1px solid var(--border-color);" alt="" />` : '<span style="font-size:1rem;">🖼️</span>'}
            <span style="color:var(--text-secondary);">Source Image:</span>
            ${bmpIdx >= 0 ? `
                <button class="btn btn-secondary btn-xs" onclick="event.stopPropagation(); selectCommandCard(${bmpIdx}, ${imgId})" style="padding:1px 6px; font-size:0.68rem; font-family:var(--code-font); color:#38bdf8; border-color:rgba(56,189,248,0.4);" title="Click to jump to BitmapData #${bmpIdx + 1}">
                    🖼️ Bitmap #${imgId} (${w}×${h} px)
                </button>
            ` : `
                <span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:0.68rem;">Bitmap #${imgId}</span>
            `}
        </div>
    `;
}

export function getVariableUsageInfo(doc, ops) {
    const getOpName = typeof window.getOpName === 'function' ? window.getOpName : (() => 'Operation');
    const usageInfo = {
        definedVarIds: new Set(),
        refMap: new Map(),
        unusedVarIds: new Set()
    };
    if (!doc && (!ops || ops.length === 0)) return usageInfo;

    const currentParsedOps = window.currentParsedOps;
    const currentBuffer = window.currentBuffer;
    const allOps = (ops && ops.length > 0) ? ops : (doc ? (typeof doc.getOperations === 'function' ? doc.getOperations() : (doc.mOps || [])) : []);
    const state = doc ? (typeof doc.getRemoteComposeState === 'function' ? doc.getRemoteComposeState() : doc.mRemoteComposeState) : null;

    if (!Array.isArray(allOps) || allOps.length === 0) return usageInfo;

    allOps.forEach((op, idx) => {
        if (!op) return;
        const opName = getOpName(op);
        const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : 0);

        if ([80, 81, 82, 83, 84, 85, 104, 105, 134, 135, 136, 137, 138, 140, 144, 148, 151, 153, 156, 172, 196].includes(opCode) ||
            opName.includes('Constant') || opName.includes('Expression') || opName.includes('Variable') || opName.includes('Attribute')) {
            const id = getOpId(op);
            if (id !== null) {
                usageInfo.definedVarIds.add(id);
                if (!usageInfo.refMap.has(id)) {
                    usageInfo.refMap.set(id, []);
                }
            }
        }
    });

    if (usageInfo.definedVarIds.size === 0) return usageInfo;

    function extractReferencedVarIds(op) {
        const refIds = [];
        const opId = getOpId(op);
        const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : 0);
        const opName = getOpName(op);

        const floatBuf = new Float32Array(1);
        const intView = new Int32Array(floatBuf.buffer);

        function scanFloatBitsArray(arr) {
            if (!arr) return;
            let int32Arr = null;
            if (arr instanceof Float32Array) {
                int32Arr = new Int32Array(arr.buffer, arr.byteOffset, arr.length);
            } else if (arr instanceof Int32Array || arr instanceof Uint32Array) {
                int32Arr = arr;
            }

            const len = arr.length || 0;
            for (let i = 0; i < len; i++) {
                let b = 0;
                if (int32Arr) {
                    b = int32Arr[i];
                } else {
                    const raw = arr[i];
                    if (typeof raw === 'bigint') {
                        b = Number(raw);
                    } else if (typeof raw === 'number') {
                        if (Number.isInteger(raw)) {
                            b = raw;
                        } else {
                            floatBuf[0] = raw;
                            b = intView[0];
                        }
                    }
                }

                if ((b & 0x7f800000) === 0x7f800000 && (b & 0x7fffff) !== 0) {
                    const refId = b & 0x3fffff;
                    if (usageInfo.definedVarIds.has(refId) && !refIds.includes(refId)) {
                        refIds.push(refId);
                    }
                }
            }
        }

        scanFloatBitsArray(op.mBits || op.bits || op.srcExpression);
        scanFloatBitsArray(op.mOutputPath || op.mPathBits || op.pathBits || op.mData || op.data || op.mFloatData || op.floatData || op.mBuffer);

        if (opCode === 144 || opCode === 82 || opName.includes('IntegerExpression')) {
            const mask = Number(op.mMask ?? op.mask ?? 0);
            const vals = op.mValues ?? op.values ?? op.srcExpression;
            if (Array.isArray(vals)) {
                for (let i = 0; i < vals.length; i++) {
                    const vNum = typeof vals[i] === 'bigint' ? Number(vals[i]) : vals[i];
                    if (((1 << i) & mask) !== 0 && vNum < 0x10000) {
                        if (usageInfo.definedVarIds.has(vNum) && !refIds.includes(vNum)) {
                            refIds.push(vNum);
                        }
                    }
                }
            }
        }

        if (opCode === 134 || opName.includes('ColorExpression')) {
            const color1 = Number(op.mColor1 ?? op.color1 ?? op.colorId ?? op.mColorId ?? 0);
            const color2 = Number(op.mColor2 ?? op.color2 ?? 0);
            if (color1 && usageInfo.definedVarIds.has(color1) && !refIds.includes(color1)) refIds.push(color1);
            if (color2 && usageInfo.definedVarIds.has(color2) && !refIds.includes(color2)) refIds.push(color2);
        }

        for (const key in op) {
            if (key === 'mId' || key === 'id' || key === 'OP_CODE' || key === 'mOpCode' || key.startsWith('_')) {
                continue;
            }
            const rawVal = op[key];
            if (typeof rawVal === 'number' || typeof rawVal === 'bigint') {
                const numVal = typeof rawVal === 'bigint' ? Number(rawVal) : rawVal;
                let b = 0;
                if (!Number.isInteger(numVal)) {
                    floatBuf[0] = numVal;
                    b = intView[0];
                } else {
                    b = numVal;
                }

                if ((b & 0x7f800000) === 0x7f800000 && (b & 0x7fffff) !== 0) {
                    const refId = b & 0x3fffff;
                    if (usageInfo.definedVarIds.has(refId) && !refIds.includes(refId)) {
                        refIds.push(refId);
                    }
                } else if (numVal !== opId && (key.endsWith('Id') || key.endsWith('ID') || key.includes('Var') || key.includes('Color') || key.includes('Text') || key.includes('Path') || key.includes('Length') || key.includes('Anim') || key.includes('Shader') || key.includes('Font'))) {
                    if (usageInfo.definedVarIds.has(numVal) && !refIds.includes(numVal)) {
                        refIds.push(numVal);
                    }
                }
            }
        }

        if (currentBuffer && op._byteStart !== undefined && op._byteEnd !== undefined) {
            try {
                const view = new DataView(currentBuffer);
                const start = op._byteStart + 1;
                const end = Math.min(currentBuffer.byteLength - 4, op._byteEnd - 4);
                for (let pos = start; pos <= end; pos++) {
                    const bBE = view.getInt32(pos, false);
                    if ((bBE & 0x7f800000) === 0x7f800000 && (bBE & 0x7fffff) !== 0) {
                        const refId = bBE & 0x3fffff;
                        if (usageInfo.definedVarIds.has(refId) && !refIds.includes(refId)) {
                            refIds.push(refId);
                        }
                    }
                    const bLE = view.getInt32(pos, true);
                    if ((bLE & 0x7f800000) === 0x7f800000 && (bLE & 0x7fffff) !== 0) {
                        const refId = bLE & 0x3fffff;
                        if (usageInfo.definedVarIds.has(refId) && !refIds.includes(refId)) {
                            refIds.push(refId);
                        }
                    }
                }
            } catch (e) {}
        }

        return refIds;
    }

    const varDependencies = new Map();

    allOps.forEach((op, idx) => {
        if (!op) return;
        const opName = getOpName(op);
        const opId = getOpId(op);
        const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : 0);

        const refIds = extractReferencedVarIds(op);

        if (opId !== null && usageInfo.definedVarIds.has(opId)) {
            varDependencies.set(opId, refIds);
        }

        refIds.forEach(targetVarId => {
            const targetNum = typeof targetVarId === 'bigint' ? Number(targetVarId) : targetVarId;
            if (usageInfo.definedVarIds.has(targetNum)) {
                const list = usageInfo.refMap.get(targetNum);
                if (list && !list.some(r => r.idx === idx)) {
                    list.push({ idx, op, opName, opId, opCode });
                }
            }
        });
    });

    const reachableVarIds = new Set();
    const queue = [];

    allOps.forEach((op, idx) => {
        if (!op) return;
        const opName = getOpName(op);
        const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : 0);
        const isScalarVarDef = [80, 81, 82, 83, 84, 85, 104, 105, 134, 135, 136, 137, 138, 140, 144, 148, 151, 153, 156, 172, 196].includes(opCode) ||
                        ((opName.includes('Constant') || opName.includes('Expression') || opName.includes('Variable') || opName.includes('Attribute')) && opCode !== 123 && opCode !== 160 && !opName.includes('Path'));

        if (!isScalarVarDef) {
            const refIds = extractReferencedVarIds(op);
            refIds.forEach(id => {
                const numId = typeof id === 'bigint' ? Number(id) : id;
                if (usageInfo.definedVarIds.has(numId) && !reachableVarIds.has(numId)) {
                    reachableVarIds.add(numId);
                    queue.push(numId);
                }
            });
        }
    });

    if (state) {
        usageInfo.definedVarIds.forEach(varId => {
            const listeners = typeof state.getListeners === 'function' ? state.getListeners(varId) : null;
            if (listeners && listeners.length > 0) {
                const list = usageInfo.refMap.get(varId);
                if (list) {
                    list.push({ idx: -1, op: null, opName: 'State Listener / Binding', opId: varId, opCode: 0 });
                }
            }
        });
    }

    while (queue.length > 0) {
        const currentVarId = queue.shift();
        const deps = varDependencies.get(currentVarId);
        if (deps && deps.length > 0) {
            deps.forEach(depId => {
                const depNum = typeof depId === 'bigint' ? Number(depId) : depId;
                if (usageInfo.definedVarIds.has(depNum) && !reachableVarIds.has(depNum)) {
                    reachableVarIds.add(depNum);
                    queue.push(depNum);
                }
            });
        }
    }

    usageInfo.definedVarIds.forEach(varId => {
        if (!reachableVarIds.has(varId)) {
            usageInfo.unusedVarIds.add(varId);
        }
    });

    return usageInfo;
}

export function getUnusedVariableDefIds(doc, ops) {
    const currentParsedOps = window.currentParsedOps;
    return getVariableUsageInfo(doc, ops || currentParsedOps).unusedVarIds;
}

export function getReferencingOpsForVarId(doc, targetVarId, ops) {
    const currentParsedOps = window.currentParsedOps;
    const info = getVariableUsageInfo(doc, ops || currentParsedOps);
    return info.refMap.get(targetVarId) || [];
}

export function renderReferencingOpsHtml(opId) {
    const currentDocument = window.currentDocument;
    const currentParsedOps = window.currentParsedOps;
    const escapeHtml = typeof window.escapeHtml === 'function' ? window.escapeHtml : (s => s);
    if (opId === null || opId === undefined || (!currentDocument && (!currentParsedOps || currentParsedOps.length === 0))) return '';
    const usageInfo = getVariableUsageInfo(currentDocument, currentParsedOps);
    const refOps = usageInfo.refMap.get(opId) || [];
    const isUnusedIsland = usageInfo.unusedVarIds.has(opId);

    if (refOps.length === 0) {
        return `<div style="font-size:0.75rem; color:var(--accent-amber); margin-bottom:6px; padding:4px 8px; background:rgba(251,191,36,0.1); border-radius:4px; border:1px solid rgba(251,191,36,0.25);">⚠️ <strong>Unused Variable Definition:</strong> Variable #${opId} is defined here but never referenced elsewhere in this document.</div>`;
    }

    if (isUnusedIsland) {
        const listHtml = refOps.map(ref => `
            <span onclick="event.stopPropagation(); ${ref.idx >= 0 ? `toggleCommandExpand(${ref.idx}, ${ref.opId}); const el = document.getElementById('cmdCard-${ref.idx}'); if(el) el.scrollIntoView({behavior:'smooth', block:'nearest'});` : ''}" style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; background:rgba(249,115,22,0.18); border:1px solid rgba(249,115,22,0.45); border-radius:4px; color:#f97316; font-size:0.72rem; font-family:var(--code-font); cursor:pointer; margin:2px;" title="${ref.idx >= 0 ? `Click to scroll to operation #${ref.idx + 1}` : ''}">
                ${ref.idx >= 0 ? `#${ref.idx + 1}` : '⚡'} <strong>${escapeHtml(ref.opName)}</strong> ${ref.opId !== null && ref.idx >= 0 ? `[ID: ${ref.opId}]` : ''}
            </span>
        `).join('');

        return `
            <div style="font-size:0.75rem; color:var(--text-primary); margin-bottom:6px; padding:6px 10px; background:rgba(249,115,22,0.09); border-radius:4px; border:1px solid rgba(249,115,22,0.35);">
                <div style="font-weight:600; color:#f97316; margin-bottom:4px; display:flex; align-items:center; gap:4px;">🏝️ <strong>Unused Island (Dead Code Chain):</strong> Referenced by ${refOps.length} ${refOps.length === 1 ? 'expression' : 'expressions'}, but this entire chain is never reached by layout, draw, or modifier operations.</div>
                <div style="display:flex; flex-wrap:wrap; gap:2px;">${listHtml}</div>
            </div>
        `;
    }

    const listHtml = refOps.map(ref => `
        <span onclick="event.stopPropagation(); ${ref.idx >= 0 ? `toggleCommandExpand(${ref.idx}, ${ref.opId}); const el = document.getElementById('cmdCard-${ref.idx}'); if(el) el.scrollIntoView({behavior:'smooth', block:'nearest'});` : ''}" style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.35); border-radius:4px; color:var(--accent-blue); font-size:0.72rem; font-family:var(--code-font); cursor:pointer; margin:2px; transition:background 0.15s ease;" onmouseover="this.style.background='rgba(56,189,248,0.3)'" onmouseout="this.style.background='rgba(56,189,248,0.15)'" title="${ref.idx >= 0 ? `Click to scroll to operation #${ref.idx + 1}` : 'Active State Listener / Event Binding'}">
            ${ref.idx >= 0 ? `#${ref.idx + 1}` : '⚡'} <strong>${escapeHtml(ref.opName)}</strong> ${ref.opId !== null && ref.idx >= 0 ? `[ID: ${ref.opId}]` : ''}
        </span>
    `).join('');
    return `
        <div style="font-size:0.75rem; color:var(--text-primary); margin-bottom:6px; padding:6px 10px; background:rgba(56,189,248,0.06); border-radius:4px; border:1px solid rgba(56,189,248,0.25);">
            <div style="font-weight:600; color:var(--accent-blue); margin-bottom:4px; display:flex; align-items:start; gap:4px;">🔗 <strong>Referenced By (${refOps.length} ${refOps.length === 1 ? 'operation' : 'operations'}):</strong></div>
            <div style="display:flex; flex-wrap:wrap; gap:2px;">${listHtml}</div>
        </div>
    `;
}

export function intBitsToFloat(b) {
    if (typeof b !== 'number') return 0;
    const buf = new ArrayBuffer(4);
    new Int32Array(buf)[0] = b | 0;
    return new Float32Array(buf)[0];
}

export function getFloatProp(op, ...names) {
    for (const name of names) {
        if (op && op[name] !== undefined && op[name] !== null) {
            const v = op[name];
            if (typeof v === 'number') {
                if (Number.isInteger(v) && (v > 100000000 || v < -100000000)) {
                    const f = intBitsToFloat(v);
                    if (!isNaN(f)) return f;
                }
                return v;
            }
        }
    }
    return 0;
}

export function formatNumber(v) {
    if (typeof v !== 'number' || isNaN(v)) return 'NaN';
    return Number.isInteger(v) ? v.toString() : v.toFixed(2);
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

export function getDimensionModifierInfo(op) {
    if (!op) return null;
    const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? -1);
    const opName = getOpName(op);
    const isWidth = opCode === 16 || opName === 'WidthModifier' || opName === 'WidthModifierOperation';
    const isHeight = opCode === 67 || opName === 'HeightModifier' || opName === 'HeightModifierOperation';
    if (!isWidth && !isHeight) return null;

    const type = op.mType ?? op.type ?? 0;
    const rawVal = getFloatProp(op, 'mOutValue', 'outValue', 'mValue', 'value', 'mWidth', 'width', 'mHeight', 'height');
    const val = (typeof rawVal === 'number' && !isNaN(rawVal)) ? rawVal : (type === 1 ? 1.0 : 0);
    const typeInfo = DIMENSION_MODIFIER_TYPES[type] || { name: `TYPE_${type}`, label: `Type ${type}`, unit: '', desc: 'Custom dimension constraint' };

    return {
        dimension: isWidth ? 'Width' : 'Height',
        type,
        typeName: typeInfo.name,
        typeLabel: typeInfo.label,
        typeDesc: typeInfo.desc,
        unit: typeInfo.unit,
        value: val,
        rawVal
    };
}

export function prettyPrintWidthModifier(op) {
    const info = getDimensionModifierInfo(op);
    if (!info) return 'WidthModifier';
    const { type, typeName, value } = info;

    if (type === 1) {
        return value > 0 && value !== 1 && !isNaN(value) ? `fillMaxWidth(${formatNumber(value)}) [FILL: 1]` : 'fillMaxWidth [FILL: 1]';
    } else if (type === 2) {
        return 'wrapContentWidth [WRAP: 2]';
    } else if (type === 3) {
        return `weight(${formatNumber(value)}) [WEIGHT: 3]`;
    } else if (type === 4) {
        return 'minIntrinsicWidth [INTRINSIC_MIN: 4]';
    } else if (type === 5) {
        return 'maxIntrinsicWidth [INTRINSIC_MAX: 5]';
    } else if (type === 6) {
        return `${formatNumber(value)} dp [EXACT_DP: 6]`;
    } else if (type === 7) {
        return 'fillParentMaxWidth [7]';
    } else if (type === 8) {
        return 'fillParentMaxHeight [8]';
    } else {
        if (typeof value === 'number' && value > 0 && value < 0x40000000 && value % 1 === 0 && value >= 40) {
            const varName = getSystemVarName(value);
            if (varName) return `${varName} [EXACT: 0]`;
        }
        return `${formatNumber(value)} px [EXACT: 0]`;
    }
}

export function prettyPrintHeightModifier(op) {
    const info = getDimensionModifierInfo(op);
    if (!info) return 'HeightModifier';
    const { type, typeName, value } = info;

    if (type === 1) {
        return value > 0 && value !== 1 && !isNaN(value) ? `fillMaxHeight(${formatNumber(value)}) [FILL: 1]` : 'fillMaxHeight [FILL: 1]';
    } else if (type === 2) {
        return 'wrapContentHeight [WRAP: 2]';
    } else if (type === 3) {
        return `weight(${formatNumber(value)}) [WEIGHT: 3]`;
    } else if (type === 4) {
        return 'minIntrinsicHeight [INTRINSIC_MIN: 4]';
    } else if (type === 5) {
        return 'maxIntrinsicHeight [INTRINSIC_MAX: 5]';
    } else if (type === 6) {
        return `${formatNumber(value)} dp [EXACT_DP: 6]`;
    } else if (type === 7) {
        return 'fillParentMaxWidth [7]';
    } else if (type === 8) {
        return 'fillParentMaxHeight [8]';
    } else {
        if (typeof value === 'number' && value > 0 && value < 0x40000000 && value % 1 === 0 && value >= 40) {
            const varName = getSystemVarName(value);
            if (varName) return `${varName} [EXACT: 0]`;
        }
        return `${formatNumber(value)} px [EXACT: 0]`;
    }
}

export function renderDimensionModifierDetailsHtml(op, idx) {
    const info = getDimensionModifierInfo(op);
    if (!info) return '';

    return `
        <div style="background:rgba(0,0,0,0.25); border:1px solid var(--border-color); border-left:3px solid var(--accent-blue); border-radius:6px; padding:8px 10px; margin-top:6px; font-size:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <div style="font-weight:700; color:var(--accent-blue); display:flex; align-items:center; gap:6px;">
                    <span>📏</span> ${info.dimension}Modifier Constraint
                </div>
                <span class="badge" style="background:rgba(56,189,248,0.15); color:var(--accent-blue); font-size:0.65rem; font-family:var(--code-font);">
                    ${info.typeName} (${info.type})
                </span>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px 12px; margin-bottom:6px;">
                <div>
                    <span style="color:var(--text-secondary);">Constraint Mode:</span>
                    <strong style="color:var(--text-primary);">${info.typeName} (Enum ${info.type})</strong>
                </div>
                <div>
                    <span style="color:var(--text-secondary);">Value:</span>
                    <strong style="color:var(--text-primary); font-family:var(--code-font);">${info.value}${info.unit ? ` ${info.unit}` : ''}</strong>
                </div>
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted); padding:4px 6px; background:rgba(255,255,255,0.02); border-radius:4px; border:1px solid rgba(255,255,255,0.04);">
                💡 <strong>Meaning:</strong> ${info.typeDesc}
            </div>
        </div>
    `;
}

export function prettyPrintPaddingModifier(op) {
    const l = getFloatProp(op, 'mLeftValue', 'leftValue', 'mLeft', 'left');
    const t = getFloatProp(op, 'mTopValue', 'topValue', 'mTop', 'top');
    const r = getFloatProp(op, 'mRightValue', 'rightValue', 'mRight', 'right');
    const b = getFloatProp(op, 'mBottomValue', 'bottomValue', 'mBottom', 'bottom');

    if (l === t && t === r && r === b) {
        return `${formatNumber(l)} dp`;
    } else if (l === r && t === b) {
        return `H: ${formatNumber(l)}, V: ${formatNumber(t)} dp`;
    } else {
        return `L: ${formatNumber(l)}, T: ${formatNumber(t)}, R: ${formatNumber(r)}, B: ${formatNumber(b)} dp`;
    }
}

export function prettyPrintFloatConstant(op) {
    const val = getFloatProp(op, 'mValue', 'value');
    return formatNumber(val);
}

export function prettyPrintColorConstant(op) {
    const rawColor = op.mColor ?? op.color ?? 0;
    const argb = rawColor >>> 0;
    const a = ((argb >>> 24) & 0xFF) / 255;
    const r = (argb >>> 16) & 0xFF;
    const g = (argb >>> 8) & 0xFF;
    const b = argb & 0xFF;
    const hex = argb.toString(16).padStart(8, '0').toUpperCase();
    const cssColor = `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    return `<span style="display:inline-block; width:12px; height:12px; border-radius:2px; background-color:${cssColor}; border:1px solid rgba(255,255,255,0.4); vertical-align:middle; margin-right:4px; box-shadow:0 0 2px rgba(0,0,0,0.5);"></span>#${hex}`;
}

export function prettyPrintNamedVariable(op) {
    const currentDocument = window.currentDocument;
    let name = op.mVarName ?? op.varName ?? op.mName ?? op.name ?? op.mText ?? '';
    
    if (typeof name === 'number' && currentDocument && typeof currentDocument.getText === 'function') {
        const textResolved = currentDocument.getText(name);
        if (textResolved) name = textResolved;
    }
    if (!name && op.mTextId !== undefined && currentDocument && typeof currentDocument.getText === 'function') {
        name = currentDocument.getText(op.mTextId) || '';
    }

    if (name) {
        return `"${name}"`;
    }
    return '';
}

export function prettyPrintLoop(op) {
    const idxId = op.mIndexId ?? op.indexId ?? 0;
    const from = getFloatProp(op, 'mFrom', 'from');
    const until = getFloatProp(op, 'mUntil', 'until');
    const step = getFloatProp(op, 'mStep', 'step');
    return `for (index #${idxId} = ${formatNumber(from)}; < ${formatNumber(until)}; += ${formatNumber(step)})`;
}

export function prettyPrintTextFromFloat(op) {
    const textId = op.mId ?? op.id ?? op.mTextId ?? op.textId ?? 0;
    const val = getFloatProp(op, 'mValue', 'value');
    const valId = op.mValueId ?? op.valueId ?? null;
    const after = op.mDigitsAfter ?? op.digitsAfter ?? 0;
    const valStr = valId !== null ? (getSystemVarName(valId) || `var_${valId}`) : formatNumber(val);
    return `text #${textId} = formatFloat(${valStr}, decimals=${after})`;
}

export function prettyPrintTextLookup(op) {
    const textId = op.mTextId ?? op.textId ?? op.mId ?? op.id ?? 0;
    const dataId = op.mDataSetId ?? op.dataSetId ?? op.mArrayId ?? op.arrayId ?? 0;
    const idxVal = op.mIndexId ?? op.indexId ?? op.mIndex ?? op.index ?? 0;
    const idxStr = typeof idxVal === 'number' && idxVal < 10000 ? `#${idxVal}` : formatNumber(idxVal);
    return `text #${textId} = lookup(array #${dataId}, index ${idxStr})`;
}

export function prettyPrintTextMerge(op) {
    const textId = op.mTextId ?? op.textId ?? op.mId ?? op.id ?? 0;
    const s1 = op.mSrcId1 ?? op.srcId1 ?? op.mTextId1 ?? op.textId1 ?? 0;
    const s2 = op.mSrcId2 ?? op.srcId2 ?? op.mTextId2 ?? op.textId2 ?? 0;
    return `text #${textId} = concat(text #${s1}, text #${s2})`;
}

export function prettyPrintTextLength(op) {
    const lenId = op.mLengthId ?? op.lengthId ?? op.mId ?? op.id ?? 0;
    const textId = op.mTextId ?? op.textId ?? 0;
    return `int #${lenId} = length(text #${textId})`;
}

export function prettyPrintLongConstant(op) {
    const val = op.mValue ?? op.value ?? 0;
    return `${val}L`;
}

export function prettyPrintTimeAttribute(op) {
    const id = op.mId ?? op.id ?? 0;
    const timeId = op.mTimeId ?? op.timeId ?? 0;
    const type = op.mType ?? op.type ?? 0;
    const args = op.mArgs ?? op.args ?? op.params ?? [];

    const TIME_TYPES = {
        0: 'Seconds from Now (sec)',
        1: 'Minutes from Now (min)',
        2: 'Hours from Now (hr)',
        3: 'Seconds from Arg (sec)',
        4: 'Minutes from Arg (min)',
        5: 'Hours from Arg (hr)',
        6: 'Second of Minute (0–59)',
        7: 'Minute of Hour (0–59)',
        8: 'Hour of Day (0–23)',
        9: 'Day of Month (1–31)',
        10: 'Month of Year (0–11)',
        11: 'Day of Week (0–6)',
        12: 'Year',
        14: 'Seconds from Load (sec)',
        15: 'Day of Year (1–366)'
    };

    const typeName = TIME_TYPES[type] || `Attribute #${type}`;
    const timeRefName = getSystemVarName(timeId) || (timeId > 0 ? `var #${timeId}` : null);
    const refStr = timeRefName ? ` derived from ${timeRefName}` : '';
    const argsStr = Array.isArray(args) && args.length > 0 ? ` [args: ${args.join(', ')}]` : '';

    return `${typeName}${refStr}${argsStr}`;
}

export function prettyPrintTheme(op) {
    const theme = op.mTheme ?? op.THEME ?? op.theme ?? -1;
    switch (theme) {
        case -3: return 'Light Mode ☀️ (LIGHT)';
        case -2: return 'Dark Mode 🌙 (DARK)';
        case 0: return 'System Default ⚙️ (SYSTEM)';
        case -1: return 'Unspecified (UNSPECIFIED)';
        default: return `Theme #${theme}`;
    }
}

export function prettyPrintColorTheme(op) {
    const id = op.mId ?? op.id ?? 0;
    const lightVal = op.mLightModeFallback ?? op.lightModeFallback ?? 0;
    const darkVal = op.mDarkModeFallback ?? op.darkModeFallback ?? 0;
    
    function makeSwatch(c) {
        const argb = c >>> 0;
        const a = ((argb >>> 24) & 0xFF) / 255;
        const r = (argb >>> 16) & 0xFF;
        const g = (argb >>> 8) & 0xFF;
        const b = argb & 0xFF;
        const hex = argb.toString(16).padStart(8, '0').toUpperCase();
        const cssColor = `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
        return `<span style="display:inline-block; width:12px; height:12px; border-radius:2px; background-color:${cssColor}; border:1px solid rgba(255,255,255,0.4); vertical-align:middle; margin-right:3px; box-shadow:0 0 2px rgba(0,0,0,0.5);"></span>#${hex}`;
    }

    return `ColorTheme #${id} (Light: ${makeSwatch(lightVal)}, Dark: ${makeSwatch(darkVal)})`;
}

export function prettyPrintColorExpression(op) {
    const id = op.mId ?? op.id ?? 0;
    const mode = (op.mMode ?? op.mode ?? 0) & 255;
    
    function fmtColor(c) {
        if (typeof c === 'number' && (c > 0 || c < 0)) {
            const argb = c >>> 0;
            const hex = argb.toString(16).padStart(8, '0').toUpperCase();
            const a = ((argb >>> 24) & 0xFF) / 255;
            const r = (argb >>> 16) & 0xFF;
            const g = (argb >>> 8) & 0xFF;
            const b = argb & 0xFF;
            const css = `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
            return `<span style="display:inline-block; width:10px; height:10px; border-radius:2px; background-color:${css}; border:1px solid rgba(255,255,255,0.4); vertical-align:middle; margin-right:2px;"></span>#${hex}`;
        }
        return `#${c}`;
    }

    function fmtVal(v) {
        if (typeof v === 'number') {
            if (v > 40 && v < 0x40000000 && Number.isInteger(v)) {
                return getSystemVarName(v) || `var_${v}`;
            }
            return formatNumber(v);
        }
        return String(v);
    }

    const c1 = op.mColor1 ?? op.color1 ?? op.param2 ?? 0;
    const c2 = op.mColor2 ?? op.color2 ?? op.param3 ?? 0;
    const tween = op.mOutTween ?? getFloatProp(op, 'mTween', 'tween', 'param4');

    switch (mode) {
        case 0:
            return `blend(${fmtColor(c1)}, ${fmtColor(c2)}, tween=${formatNumber(tween)})`;
        case 1:
            return `blend(color #${c1}, ${fmtColor(c2)}, tween=${formatNumber(tween)})`;
        case 2:
            return `blend(${fmtColor(c1)}, color #${c2}, tween=${formatNumber(tween)})`;
        case 3:
            return `blend(color #${c1}, color #${c2}, tween=${formatNumber(tween)})`;
        case 4:
            return `hsv(h=${fmtVal(c1)}, s=${fmtVal(c2)}, v=${fmtVal(tween)})`;
        case 5:
        case 6: {
            const r = fmtVal(c1);
            const g = fmtVal(c2);
            const b = fmtVal(tween);
            return `argb(r=${r}, g=${g}, b=${b})`;
        }
        default:
            return `colorBlend(mode=${mode})`;
    }
}

export function prettyPrintHeader(op) {
    if (!op) return '';
    const maj = op.mMajorVersion ?? op.majorVersion ?? 1;
    const min = op.mMinorVersion ?? op.minorVersion ?? 0;
    const patch = op.mPatchVersion ?? op.patchVersion ?? 0;
    const w = op.mWidth ?? op.width ?? (typeof op.getWidth === 'function' ? op.getWidth() : null);
    const h = op.mHeight ?? op.height ?? (typeof op.getHeight === 'function' ? op.getHeight() : null);
    const caps = op.mCapabilities ?? op.mProfiles ?? op.capabilities ?? 0;

    let parts = [];
    parts.push(`v${maj}.${min}.${patch}`);
    if (w !== null && h !== null && !isNaN(w) && !isNaN(h)) {
        parts.push(`${Math.round(w)} × ${Math.round(h)} px`);
    }
    if (caps) {
        parts.push(`Caps: 0x${caps.toString(16).toUpperCase()}`);
    }
    return parts.join(' | ');
}

export function parsePathDataOp(op) {
    if (!op) return null;
    const data = op.mOutputPath || op.mFloatPath || op.pathData || op.mPathBits || op.pathBits || op.mData || op.data || op.mBits || op.bits || op.srcExpression || op.mSrcExpression || [];
    if (!data || data.length === 0) return null;

    const isTypedIntArray = data instanceof Int32Array || data instanceof Uint32Array;
    const isTypedFloatArray = data instanceof Float32Array;

    function isNaNBits(bits) {
        return (bits & 0x7f800000) === 0x7f800000 && (bits & 0x7fffff) !== 0;
    }
    function idFromBits(bits) {
        return bits & 0x3fffff;
    }

    function floatToIntBits(f) {
        const buf = new ArrayBuffer(4);
        new Float32Array(buf)[0] = f;
        return new Int32Array(buf)[0];
    }

    function getBits(val) {
        if (typeof val === 'bigint') val = Number(val);
        if (typeof val !== 'number') return 0;
        if (isTypedIntArray) return val | 0;
        if (isTypedFloatArray) return floatToIntBits(val);
        if (Number.isNaN(val)) return floatToIntBits(val);
        if (Number.isInteger(val) && (val > 1000000 || val < -1000000)) return val | 0;
        return floatToIntBits(val);
    }

    function getFloat(val) {
        if (typeof val === 'bigint') val = Number(val);
        if (typeof val !== 'number') return 0;
        if (isTypedFloatArray) return Number.isNaN(val) ? 0 : val;
        const bits = getBits(val);
        if (isNaNBits(bits)) {
            const varId = idFromBits(bits);
            const resolved = typeof window !== 'undefined' ? window.currentPlayer?.mRemoteComposeState?.getFloat(varId) : undefined;
            return (typeof resolved === 'number' && !Number.isNaN(resolved)) ? resolved : 0;
        }
        return intBitsToFloat(bits);
    }

    function fmtCoord(val) {
        const bits = getBits(val);
        if (isNaNBits(bits)) {
            const varId = idFromBits(bits);
            return getSystemVarName(varId) || `var_${varId}`;
        }
        const f = getFloat(val);
        return formatNumber(f);
    }

    let i = 0;
    const path = new Path2D();
    let d = '';
    const coords = [];
    const segments = [];
    let cmdCount = 0;

    while (i < data.length) {
        const raw = data[i];
        const bits = getBits(raw);
        let cmd = isNaNBits(bits) ? idFromBits(bits) : (typeof raw === 'number' && !isTypedIntArray && raw >= 10 && raw <= 16 ? raw : idFromBits(bits));
        if (cmd >= 3145728 && cmd <= 3145728 + 6) {
            cmd = 10 + (cmd - 3145728);
        }
        if (cmd >= 0 && cmd <= 6) {
            cmd = 10 + cmd;
        }

        switch (cmd) {
            case 10: { // MOVE: 1 verb + 2 coords
                i++;
                if (i + 1 >= data.length) { i = data.length; break; }
                const xBits = data[i];
                const yBits = data[i+1];
                const x = getFloat(xBits);
                const y = getFloat(yBits);
                path.moveTo(x, y);
                d += `M ${x} ${y} `;
                coords.push({x, y});
                segments.push({ type: 'MoveTo', str: `MoveTo(${fmtCoord(xBits)}, ${fmtCoord(yBits)})` });
                cmdCount++;
                i += 2;
                break;
            }
            case 11: { // LINE: 1 verb + 2 dummy slots + 2 coords
                i += 3;
                if (i + 1 >= data.length) { i = data.length; break; }
                const xBits = data[i];
                const yBits = data[i+1];
                const x = getFloat(xBits);
                const y = getFloat(yBits);
                path.lineTo(x, y);
                d += `L ${x} ${y} `;
                coords.push({x, y});
                segments.push({ type: 'LineTo', str: `LineTo(${fmtCoord(xBits)}, ${fmtCoord(yBits)})` });
                cmdCount++;
                i += 2;
                break;
            }
            case 12: { // QUAD: 1 verb + 2 dummy slots + 4 coords
                i += 3;
                if (i + 3 >= data.length) { i = data.length; break; }
                const x1Bits = data[i];
                const y1Bits = data[i+1];
                const x2Bits = data[i+2];
                const y2Bits = data[i+3];
                const x1 = getFloat(x1Bits);
                const y1 = getFloat(y1Bits);
                const x2 = getFloat(x2Bits);
                const y2 = getFloat(y2Bits);
                path.quadraticCurveTo(x1, y1, x2, y2);
                d += `Q ${x1} ${y1} ${x2} ${y2} `;
                coords.push({x: x1, y: y1}, {x: x2, y: y2});
                segments.push({ type: 'QuadTo', str: `QuadTo(${fmtCoord(x1Bits)}, ${fmtCoord(y1Bits)}, ${fmtCoord(x2Bits)}, ${fmtCoord(y2Bits)})` });
                cmdCount++;
                i += 4;
                break;
            }
            case 13: { // CONIC: 1 verb + 2 dummy slots + 5 params (x1, y1, x2, y2, weight)
                i += 3;
                if (i + 4 >= data.length) { i = data.length; break; }
                const x1Bits = data[i];
                const y1Bits = data[i+1];
                const x2Bits = data[i+2];
                const y2Bits = data[i+3];
                const wBits = data[i+4];
                const x1 = getFloat(x1Bits);
                const y1 = getFloat(y1Bits);
                const x2 = getFloat(x2Bits);
                const y2 = getFloat(y2Bits);
                path.quadraticCurveTo(x1, y1, x2, y2);
                d += `Q ${x1} ${y1} ${x2} ${y2} `;
                coords.push({x: x1, y: y1}, {x: x2, y: y2});
                segments.push({ type: 'ConicTo', str: `ConicTo(${fmtCoord(x1Bits)}, ${fmtCoord(y1Bits)}, ${fmtCoord(x2Bits)}, ${fmtCoord(y2Bits)}, w=${fmtCoord(wBits)})` });
                cmdCount++;
                i += 5;
                break;
            }
            case 14: { // CUBIC: 1 verb + 2 dummy slots + 6 coords
                i += 3;
                if (i + 5 >= data.length) { i = data.length; break; }
                const x1Bits = data[i];
                const y1Bits = data[i+1];
                const x2Bits = data[i+2];
                const y2Bits = data[i+3];
                const x3Bits = data[i+4];
                const y3Bits = data[i+5];
                const x1 = getFloat(x1Bits);
                const y1 = getFloat(y1Bits);
                const x2 = getFloat(x2Bits);
                const y2 = getFloat(y2Bits);
                const x3 = getFloat(x3Bits);
                const y3 = getFloat(y3Bits);
                path.bezierCurveTo(x1, y1, x2, y2, x3, y3);
                d += `C ${x1} ${y1} ${x2} ${y2} ${x3} ${y3} `;
                coords.push({x: x1, y: y1}, {x: x2, y: y2}, {x: x3, y: y3});
                segments.push({ type: 'CubicTo', str: `CubicTo(${fmtCoord(x1Bits)}, ${fmtCoord(y1Bits)}, ${fmtCoord(x2Bits)}, ${fmtCoord(y2Bits)}, ${fmtCoord(x3Bits)}, ${fmtCoord(y3Bits)})` });
                cmdCount++;
                i += 6;
                break;
            }
            case 15: { // CLOSE: 1 verb
                path.closePath();
                d += `Z `;
                segments.push({ type: 'Close', str: 'Close' });
                cmdCount++;
                i++;
                break;
            }
            case 16: { // DONE: end of path
                i = data.length;
                break;
            }
            default: {
                i++;
                break;
            }
        }
    }

    if (coords.length === 0 && segments.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    coords.forEach(c => {
        if (c.x < minX) minX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.x > maxX) maxX = c.x;
        if (c.y > maxY) maxY = c.y;
    });
    if (minX === Infinity) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

    return {
        path,
        d: d.trim(),
        cmdCount,
        segments,
        minX, minY, maxX, maxY,
        w: maxX - minX,
        h: maxY - minY
    };
}

export function drawPathDataPreviewCanvas(canvasId, op) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const parsed = parsePathDataOp(op);
    if (!parsed) return;

    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    const pw = parsed.w || 1;
    const ph = parsed.h || 1;
    const padding = 16;
    const scale = Math.min((cw - padding * 2) / pw, (ch - padding * 2) / ph);

    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(parsed.minX + pw / 2), -(parsed.minY + ph / 2));

    // Semi-transparent Fill
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fill(parsed.path);

    // Glowing Stroke
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(1, 2 / scale);
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 4;
    ctx.stroke(parsed.path);

    ctx.restore();
}

export function prettyPrintPathAppend(op) {
    if (!op) return '';
    const id = op.mId ?? op.id ?? op.pathId ?? op.mPathId ?? 0;
    const data = op.mData || op.data || op.mPathBits || op.pathBits || op.mOutputPath || [];
    const parsed = parsePathDataOp({ mOutputPath: data });
    
    if (!parsed || !parsed.segments || parsed.segments.length === 0) {
        return `Path #${id} += ${data.length} floats`;
    }

    const segs = parsed.segments;
    const maxInline = 3;
    const inlineParts = segs.slice(0, maxInline).map(s => s.str);
    let result = `Path #${id} += ${inlineParts.join(' ➔ ')}`;
    if (segs.length > maxInline) {
        result += ` <span style="opacity:0.75; font-size:0.85em; color:var(--text-muted);">(+${segs.length - maxInline} more)</span>`;
    }
    return result;
}

export function prettyPrintPathCreate(op) {
    if (!op) return '';
    const id = op.mId ?? op.id ?? 0;
    const x = op.mStartX ?? op.startX ?? op.v1 ?? 0;
    const y = op.mStartY ?? op.startY ?? op.v2 ?? 0;
    function fmt(v) {
        if (typeof v === 'number') {
            if (v > 40 && v < 0x40000000 && Number.isInteger(v)) return getSystemVarName(v) || `var_${v}`;
            return formatNumber(v);
        }
        return String(v);
    }
    return `create Path #${id} (start: x=${fmt(x)}, y=${fmt(y)})`;
}

export function prettyPrintPathTween(op) {
    if (!op) return '';
    const outId = op.mOutId ?? op.outId ?? op.mId ?? op.id ?? 0;
    const p1 = op.mPathId1 ?? op.pathId1 ?? op.path1Id ?? 0;
    const p2 = op.mPathId2 ?? op.pathId2 ?? op.path2Id ?? 0;
    const tw = op.mTween ?? op.tween ?? 0;
    function fmt(v) {
        if (typeof v === 'number') {
            if (v > 40 && v < 0x40000000 && Number.isInteger(v)) return getSystemVarName(v) || `var_${v}`;
            return formatNumber(v);
        }
        return String(v);
    }
    return `Path #${outId} = tween(Path #${p1} ➔ Path #${p2}, fraction=${fmt(tw)})`;
}

export function prettyPrintPathData(op) {
    if (!op) return '';
    const id = getOpId(op) ?? 0;
    const parsed = parsePathDataOp(op);
    if (!parsed) return `Path #${id}`;
    return `Path #${id} (${parsed.cmdCount} cmds, ${parsed.w.toFixed(0)}×${parsed.h.toFixed(0)})`;
}

export function prettyPrintPathCombine(op) {
    if (!op) return '';
    const id = op.mOutId ?? op.mId ?? op.id ?? 0;
    const p1 = op.mPathId1 ?? op.mPath1 ?? op.path1 ?? op.path1Id ?? 0;
    const p2 = op.mPathId2 ?? op.mPath2 ?? op.path2 ?? op.path2Id ?? 0;
    const mode = op.mOperation ?? op.mMode ?? op.mode ?? 0;
    const modes = ['Difference', 'Intersect', 'ReverseDifference', 'Union', 'XOR'];
    const modeStr = modes[mode] || `mode_${mode}`;
    return `Path #${id} = combine(Path #${p1} ${modeStr} Path #${p2})`;
}

export function prettyPrintDrawPath(op) {
    if (!op) return '';
    const pId = op.mPathId ?? op.pathId ?? op.mId ?? op.id ?? 0;
    const start = op.mStart ?? op.start ?? 0;
    const end = op.mEnd ?? op.end ?? 1;
    if (start !== 0 || end !== 1) {
        return `draw Path #${pId} (range: ${(start*100).toFixed(0)}%–${(end*100).toFixed(0)}%)`;
    }
    return `draw Path #${pId}`;
}

export function prettyPrintDrawTweenPath(op) {
    if (!op) return '';
    const p1 = op.mPath1Id ?? op.path1Id ?? op.pathId1 ?? 0;
    const p2 = op.mPath2Id ?? op.path2Id ?? op.pathId2 ?? 0;
    const tw = op.mTween ?? op.tween ?? 0;
    function fmt(v) {
        if (typeof v === 'number') {
            if (v > 40 && v < 0x40000000 && Number.isInteger(v)) return getSystemVarName(v) || `var_${v}`;
            return formatNumber(v);
        }
        return String(v);
    }
    return `draw tween(Path #${p1} ➔ Path #${p2}, fraction=${fmt(tw)})`;
}

export function prettyPrintMatrixFromPath(op) {
    if (!op) return '';
    const pId = op.mPathId ?? op.pathId ?? 0;
    const pct = op.mPercent ?? op.percent ?? 0;
    const vOff = op.mVOffset ?? op.vOffset ?? 0;
    function fmt(v) {
        if (typeof v === 'number') {
            if (v > 40 && v < 0x40000000 && Number.isInteger(v)) return getSystemVarName(v) || `var_${v}`;
            return formatNumber(v);
        }
        return String(v);
    }
    return `matrixFromPath(Path #${pId}, pos=${fmt(pct)}, vOffset=${fmt(vOff)})`;
}

export function prettyPrintPathExpression(op) {
    if (!op) return '';
    const id = op.mId ?? op.id ?? 0;
    return `PathExpression #${id}`;
}

export function getCoreTextParameters(op, doc) {
    if (!op) return null;
    const currentDocument = doc || (typeof window !== 'undefined' ? window.currentDocument : null);

    // 1. Text content & ID
    const textId = op.mTextId ?? op.textId ?? -1;
    let text = op.mText ?? op.text ?? '';
    if (!text && textId !== -1 && currentDocument && typeof currentDocument.getText === 'function') {
        text = currentDocument.getText(textId) || '';
    }

    // 2. Font Size & Weight
    let fontSize = 16;
    if (op.mFontSizeValue !== undefined && !isNaN(op.mFontSizeValue)) {
        fontSize = op.mFontSizeValue;
    } else if (op.mFontSize !== undefined) {
        fontSize = isNaNBits(op.mFontSize) ? 16 : intBitsToFloat(op.mFontSize);
    }
    const minFontSize = op.mMinFontSize ?? -1;
    const maxFontSize = op.mMaxFontSize ?? -1;

    let fontWeight = 400;
    if (op.mFontWeightValue !== undefined && !isNaN(op.mFontWeightValue)) {
        fontWeight = Math.round(op.mFontWeightValue);
    } else if (op.mFontWeight !== undefined) {
        fontWeight = isNaNBits(op.mFontWeight) ? 400 : Math.round(intBitsToFloat(op.mFontWeight));
    }
    let fontWeightName = 'Regular (400)';
    if (fontWeight <= 150) fontWeightName = `Thin (${fontWeight})`;
    else if (fontWeight <= 250) fontWeightName = `Extra Light (${fontWeight})`;
    else if (fontWeight <= 350) fontWeightName = `Light (${fontWeight})`;
    else if (fontWeight <= 450) fontWeightName = `Regular (${fontWeight})`;
    else if (fontWeight <= 550) fontWeightName = `Medium (${fontWeight})`;
    else if (fontWeight <= 650) fontWeightName = `Semi Bold (${fontWeight})`;
    else if (fontWeight <= 750) fontWeightName = `Bold (${fontWeight})`;
    else if (fontWeight <= 850) fontWeightName = `Extra Bold (${fontWeight})`;
    else fontWeightName = `Black (${fontWeight})`;

    const fontStyle = op.mFontStyle ?? op.fontStyle ?? 0;
    const fontStyleName = fontStyle === 1 ? 'Italic' : 'Normal';

    // 3. Font Family
    const fontFamilyId = op.mFontFamilyId ?? op.fontFamilyId ?? -1;
    let fontFamily = 'Default';
    if (fontFamilyId !== -1 && currentDocument && typeof currentDocument.getText === 'function') {
        const resolvedFamily = currentDocument.getText(fontFamilyId);
        if (resolvedFamily) fontFamily = resolvedFamily;
    } else if (op.mType !== undefined && op.mType !== -1) {
        const types = ['Default', 'Sans-Serif', 'Serif', 'Monospace'];
        if (types[op.mType]) fontFamily = types[op.mType];
    }

    // 4. Font Axis (Variable Fonts)
    const fontAxis = op.mFontAxis ?? null;
    const fontAxisValues = op.mFontAxisValues ?? null;

    // 5. Color
    const colorId = op.mColorId ?? op.colorId ?? -1;
    const rawColor = op.mColorValue ?? op.mColor ?? op.color ?? 0;
    const argb = rawColor >>> 0;
    const a = ((argb >>> 24) & 0xFF) / 255;
    const r = (argb >>> 16) & 0xFF;
    const g = (argb >>> 8) & 0xFF;
    const b = argb & 0xFF;
    const colorHex = '#' + argb.toString(16).padStart(8, '0').toUpperCase();
    const cssColor = `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    const isDynamicColor = colorId !== -1;

    // 6. Alignment
    const textAlign = (op.mTextAlignValue ?? op.mTextAlign ?? op.textAlign ?? 1) & 0xFFFF;
    const alignMap = { 1: 'Left', 2: 'Right', 3: 'Center', 4: 'Justify', 5: 'Start', 6: 'End' };
    const textAlignName = alignMap[textAlign] || `Align (${textAlign})`;

    // 7. Overflow & Lines
    const overflow = op.mOverflow ?? op.overflow ?? 1;
    const overflowMap = { 1: 'Clip', 2: 'Visible', 3: 'Ellipsis', 4: 'Start Ellipsis', 5: 'Middle Ellipsis' };
    const overflowName = overflowMap[overflow] || `Overflow (${overflow})`;

    const maxLines = op.mMaxLines ?? op.maxLines ?? 2147483647;
    const maxLinesStr = maxLines >= 2147483647 ? 'Unlimited (∞)' : `${maxLines}`;

    // 8. Line Height & Letter Spacing
    const letterSpacing = op.mLetterSpacing ?? op.letterSpacing ?? 0;
    const lineHeightAdd = op.mLineHeightAdd ?? op.lineHeightAdd ?? 0;
    const lineHeightMultiplier = op.mLineHeightMultiplier ?? op.lineHeightMultiplier ?? 1;

    // 9. Advanced Typography
    const lineBreakStrategy = op.mLineBreakStrategy ?? op.lineBreakStrategy ?? 0;
    const lbMap = { 0: 'Simple', 1: 'High Quality', 2: 'Balanced' };
    const lineBreakName = lbMap[lineBreakStrategy] || `Strategy (${lineBreakStrategy})`;

    const hyphenationFrequency = op.mHyphenationFrequency ?? op.hyphenationFrequency ?? 0;
    const hyMap = { 0: 'None', 1: 'Normal', 2: 'Full', 3: 'Normal Fast', 4: 'Full Fast' };
    const hyphenationName = hyMap[hyphenationFrequency] || `Hyphenation (${hyphenationFrequency})`;

    const justificationMode = op.mJustificationMode ?? op.justificationMode ?? 0;
    const justMap = { 0: 'None', 1: 'Inter-Word', 2: 'Inter-Character' };
    const justificationName = justMap[justificationMode] || `Mode (${justificationMode})`;

    // 10. Decorations & Flags
    const underline = Boolean(op.mUnderline ?? op.underline);
    const strikethrough = Boolean(op.mStrikethrough ?? op.strikethrough);
    const autosize = Boolean(op.mAutosize ?? op.autosize);
    const flags = op.mFlags ?? op.flags ?? 0;
    const componentId = typeof op.getComponentId === 'function' ? op.getComponentId() : (op.mComponentId ?? null);
    const animationId = op.mAnimationId ?? op.animationId ?? -1;

    return {
        text,
        textId,
        fontSize,
        minFontSize,
        maxFontSize,
        fontWeight,
        fontWeightName,
        fontStyle,
        fontStyleName,
        fontFamily,
        fontFamilyId,
        fontAxis,
        fontAxisValues,
        colorHex,
        cssColor,
        isDynamicColor,
        colorId,
        textAlign,
        textAlignName,
        overflow,
        overflowName,
        maxLines,
        maxLinesStr,
        letterSpacing,
        lineHeightAdd,
        lineHeightMultiplier,
        lineBreakStrategy,
        lineBreakName,
        hyphenationFrequency,
        hyphenationName,
        justificationMode,
        justificationName,
        underline,
        strikethrough,
        autosize,
        flags,
        componentId,
        animationId
    };
}

export function prettyPrintCoreText(op, doc) {
    if (!op) return '';
    const currentDoc = doc || (typeof window !== 'undefined' ? window.currentDocument : null);
    const params = getCoreTextParameters(op, currentDoc);
    if (!params) return '';
    const parts = [];
    if (params.text) parts.push(`"${params.text}"`);
    parts.push(`${params.fontSize}sp`);
    if (params.fontWeight !== 400) parts.push(`w${params.fontWeight}`);
    if (params.fontStyle === 1) parts.push('italic');
    if (params.textAlignName !== 'Left' && params.textAlignName !== 'Start') parts.push(params.textAlignName);
    if (params.maxLines < 2147483647) parts.push(`max ${params.maxLines}L`);
    return parts.join(', ');
}

export function renderCoreTextDetailsHtml(op, idx, doc) {
    if (!op) return '';
    const currentDoc = doc || (typeof window !== 'undefined' ? window.currentDocument : null);
    const params = getCoreTextParameters(op, currentDoc);
    if (!params) return '';

    const escapeHtml = typeof window !== 'undefined' && typeof window.escapeHtml === 'function' ? window.escapeHtml : (s => String(s));

    return `
        <div style="margin-top:8px; background:rgba(0,0,0,0.25); border:1px solid rgba(56,189,248,0.25); border-radius:6px; padding:10px 12px; display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:1rem;">🔤</span>
                    <strong style="color:var(--accent-blue); font-size:0.82rem;">CoreText Parameters</strong>
                    ${params.componentId !== null ? `<span class="badge" style="background:rgba(56,189,248,0.15); color:var(--accent-blue); font-size:0.65rem;">CID: ${params.componentId}</span>` : ''}
                    ${params.textId !== -1 ? `<span class="badge" style="background:rgba(234,179,8,0.15); color:var(--accent-amber); font-size:0.65rem;">TextID: ${params.textId}</span>` : ''}
                </div>
                <div style="display:flex; gap:4px; align-items:center;">
                    ${params.autosize ? `<span class="badge" style="background:rgba(16,185,129,0.15); color:var(--accent-emerald); font-size:0.65rem;">⚡ Autosize</span>` : ''}
                    ${params.underline ? `<span class="badge" style="background:rgba(168,85,247,0.15); color:var(--accent-purple); font-size:0.65rem;"><u>U</u> Underline</span>` : ''}
                    ${params.strikethrough ? `<span class="badge" style="background:rgba(239,68,68,0.15); color:#f87171; font-size:0.65rem;"><s>S</s> Strike</span>` : ''}
                </div>
            </div>

            <!-- Text Content Preview -->
            ${params.text ? `
                <div style="background:rgba(0,0,0,0.3); border-radius:4px; padding:6px 10px; border-left:3px solid var(--accent-amber);">
                    <div style="font-size:0.68rem; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:2px;">Text String (${params.text.length} chars)</div>
                    <div style="font-size:0.85rem; color:var(--text-primary); font-family:var(--code-font); font-style:italic;">"${escapeHtml(params.text)}"</div>
                </div>
            ` : ''}

            <!-- 4-column Parameter Grid -->
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:6px; font-size:0.75rem;">
                <!-- Font & Typography -->
                <div style="background:rgba(255,255,255,0.03); padding:6px 8px; border-radius:4px;">
                    <div style="color:var(--text-muted); font-size:0.68rem; font-weight:600; margin-bottom:4px;">🔤 TYPOGRAPHY</div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <div><span style="color:var(--text-secondary);">Size:</span> <strong>${params.fontSize} sp</strong> ${params.minFontSize > 0 || params.maxFontSize > 0 ? `<span style="color:var(--text-muted); font-size:0.65rem;">(${params.minFontSize > 0 ? params.minFontSize : 'min'}..${params.maxFontSize > 0 ? params.maxFontSize : 'max'})</span>` : ''}</div>
                        <div><span style="color:var(--text-secondary);">Weight:</span> <strong>${params.fontWeightName}</strong></div>
                        <div><span style="color:var(--text-secondary);">Style:</span> <strong>${params.fontStyleName}</strong></div>
                        <div><span style="color:var(--text-secondary);">Family:</span> <strong>${escapeHtml(params.fontFamily)}</strong> ${params.fontFamilyId !== -1 ? `<span style="color:var(--text-muted); font-size:0.65rem;">(ID: ${params.fontFamilyId})</span>` : ''}</div>
                    </div>
                </div>

                <!-- Color & Styling -->
                <div style="background:rgba(255,255,255,0.03); padding:6px 8px; border-radius:4px;">
                    <div style="color:var(--text-muted); font-size:0.68rem; font-weight:600; margin-bottom:4px;">🎨 COLOR & APPEARANCE</div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="color:var(--text-secondary);">Color:</span>
                            <span style="display:inline-block; width:12px; height:12px; border-radius:2px; background-color:${params.cssColor}; border:1px solid rgba(255,255,255,0.4);"></span>
                            <strong style="font-family:var(--code-font);">${params.colorHex}</strong>
                        </div>
                        <div><span style="color:var(--text-secondary);">Dynamic Color:</span> <strong>${params.isDynamicColor ? `Yes (Var #${params.colorId})` : 'No (Static)'}</strong></div>
                        <div><span style="color:var(--text-secondary);">Letter Spacing:</span> <strong>${params.letterSpacing !== 0 ? `${params.letterSpacing} sp` : 'Default (0)'}</strong></div>
                        <div><span style="color:var(--text-secondary);">Line Height:</span> <strong>${params.lineHeightMultiplier}× ${params.lineHeightAdd !== 0 ? `+ ${params.lineHeightAdd} dp` : ''}</strong></div>
                    </div>
                </div>

                <!-- Alignment & Layout -->
                <div style="background:rgba(255,255,255,0.03); padding:6px 8px; border-radius:4px;">
                    <div style="color:var(--text-muted); font-size:0.68rem; font-weight:600; margin-bottom:4px;">📐 ALIGNMENT & FLOW</div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <div><span style="color:var(--text-secondary);">Align:</span> <strong>${params.textAlignName}</strong></div>
                        <div><span style="color:var(--text-secondary);">Overflow:</span> <strong>${params.overflowName}</strong></div>
                        <div><span style="color:var(--text-secondary);">Max Lines:</span> <strong>${params.maxLinesStr}</strong></div>
                        <div><span style="color:var(--text-secondary);">Break Strategy:</span> <strong>${params.lineBreakName}</strong></div>
                    </div>
                </div>

                <!-- Advanced & Hyphenation -->
                <div style="background:rgba(255,255,255,0.03); padding:6px 8px; border-radius:4px;">
                    <div style="color:var(--text-muted); font-size:0.68rem; font-weight:600; margin-bottom:4px;">⚙️ ADVANCED</div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <div><span style="color:var(--text-secondary);">Hyphenation:</span> <strong>${params.hyphenationName}</strong></div>
                        <div><span style="color:var(--text-secondary);">Justification:</span> <strong>${params.justificationName}</strong></div>
                        ${params.animationId !== -1 ? `<div><span style="color:var(--text-secondary);">Anim ID:</span> <strong>${params.animationId}</strong></div>` : ''}
                        ${params.flags !== 0 ? `<div><span style="color:var(--text-secondary);">Flags:</span> <strong>0x${params.flags.toString(16)}</strong></div>` : ''}
                        ${params.fontAxis && params.fontAxis.length > 0 ? `<div><span style="color:var(--text-secondary);">Font Axes:</span> <strong>${params.fontAxis.length} axes</strong></div>` : ''}
                    </div>
                </div>
        </div>
    `;
}

export function getLayoutAlignmentInfo(op) {
    if (!op) return null;

    const hPos = op.mHorizontalPositioning ?? op.horizontalPositioning ?? op.mHorizontalAlignment ?? op.horizontalAlignment ?? null;
    const vPos = op.mVerticalPositioning ?? op.verticalPositioning ?? op.mVerticalAlignment ?? op.verticalAlignment ?? null;
    const spacedBy = op.mSpacedBy ?? op.spacedBy ?? op.mSpacing ?? op.spacing ?? op.mHorizontalSpacing ?? op.mVerticalSpacing ?? null;

    if (hPos === null && vPos === null && spacedBy === null) {
        if (op.mAlignment !== undefined) {
            return {
                hPos: null,
                vPos: null,
                hName: null,
                vName: null,
                alignment: op.mAlignment,
                spacedBy: null
            };
        }
        return null;
    }

    const posMap = {
        1: 'Start',
        2: 'Center',
        3: 'End',
        4: 'Top',
        5: 'Bottom',
        6: 'SpaceBetween',
        7: 'SpaceEvenly',
        8: 'SpaceAround'
    };

    const hName = typeof hPos === 'number' ? (posMap[hPos] || `H:${hPos}`) : (typeof hPos === 'string' ? hPos : null);
    const vName = typeof vPos === 'number' ? (posMap[vPos] || `V:${vPos}`) : (typeof vPos === 'string' ? vPos : null);

    return {
        hPos,
        vPos,
        hName,
        vName,
        spacedBy: typeof spacedBy === 'number' ? spacedBy : null
    };
}

export function prettyPrintLayoutAlignment(op) {
    const align = getLayoutAlignmentInfo(op);
    if (!align) return '';
    const parts = [];
    if (align.hName) parts.push(`H: ${align.hName}`);
    if (align.vName) parts.push(`V: ${align.vName}`);
    if (align.spacedBy !== null && align.spacedBy !== undefined) parts.push(`spacedBy: ${align.spacedBy}dp`);
    return parts.join(', ');
}

export function renderLayoutAlignmentDetailsHtml(op, idx) {
    const align = getLayoutAlignmentInfo(op);
    if (!align || (!align.hName && !align.vName && align.spacedBy === null)) return '';

    return `
        <div style="margin-top:6px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.25); border-radius:6px; padding:8px 10px; display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="font-weight:700; font-size:0.75rem; color:var(--accent-blue); display:flex; align-items:center; gap:4px;">
                    <span>📐</span> Layout Alignment &amp; Positioning
                </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:6px; font-size:0.75rem;">
                <div style="background:rgba(0,0,0,0.2); padding:4px 8px; border-radius:4px;">
                    <span style="color:var(--text-secondary);">Horizontal:</span>
                    <strong style="color:var(--text-primary); margin-left:4px;">${align.hName || 'Default'}</strong>
                </div>
                <div style="background:rgba(0,0,0,0.2); padding:4px 8px; border-radius:4px;">
                    <span style="color:var(--text-secondary);">Vertical:</span>
                    <strong style="color:var(--text-primary); margin-left:4px;">${align.vName || 'Default'}</strong>
                </div>
                ${align.spacedBy !== null && align.spacedBy !== undefined ? `
                    <div style="background:rgba(0,0,0,0.2); padding:4px 8px; border-radius:4px;">
                        <span style="color:var(--text-secondary);">Spacing:</span>
                        <strong style="color:var(--text-primary); margin-left:4px;">${align.spacedBy} dp</strong>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

export function renderCommandsList(ops, u8) {
    const container = document.getElementById('commandsListContainer');
    const unusedBadge = document.getElementById('unusedVarBadge');
    const currentDocument = window.currentDocument;
    const escapeHtml = typeof window.escapeHtml === 'function' ? window.escapeHtml : (s => String(s));

    if (!ops || ops.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:32px; color:var(--text-muted);">No operations found.</div>`;
        if (unusedBadge) unusedBadge.style.display = 'none';
        return;
    }

    window.currentParsedOps = ops;
    const analysis = getUnusedIslandsAnalysis(currentDocument);
    const { unusedIslandSet, removableOpSet, removableOpsCount, graphData } = analysis;

    if (unusedBadge) {
        if (removableOpsCount > 0) {
            unusedBadge.style.display = 'inline-flex';
            unusedBadge.textContent = `⚠️ ${removableOpsCount} Removable Op${removableOpsCount === 1 ? '' : 's'}`;
            unusedBadge.title = `${unusedIslandSet.size} unused expression island nodes (${removableOpsCount} operations can be safely removed without affecting rendering)`;
        } else {
            unusedBadge.style.display = 'none';
        }
    }

    const depths = new Array(ops.length).fill(0);
    let runningDepth = 0;
    ops.forEach((op, idx) => {
        const opName = getOpName(op);
        const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : 0);
        if (opCode === 214 || opName === 'ContainerEnd') {
            runningDepth = Math.max(0, runningDepth - 1);
            depths[idx] = runningDepth;
        } else if (isContainerOp(op) || [200, 201, 202, 203, 204, 205, 207, 59].includes(opCode)) {
            depths[idx] = runningDepth;
            runningDepth++;
        } else {
            depths[idx] = runningDepth;
        }
    });

    let items = ops.map((op, idx) => {
        const startOff = op._byteStart ?? 0;
        const endOff = op._byteEnd ?? 0;
        const sizeB = endOff > startOff ? endOff - startOff : 0;
        return { op, idx, startOff, endOff, sizeB, depth: depths[idx] };
    });

    if (cmdSortMode === 'sizeDesc') {
        items.sort((a, b) => b.sizeB - a.sizeB || a.idx - b.idx);
    } else if (cmdSortMode === 'sizeAsc') {
        items.sort((a, b) => a.sizeB - b.sizeB || a.idx - b.idx);
    }

    let html = '';

    items.forEach(({ op, idx, startOff, endOff, sizeB, depth }) => {
        const opName = getOpName(op);
        const opId = getOpId(op);
        const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : 0);
        const hexCode = '0x' + opCode.toString(16).padStart(2, '0').toUpperCase();
        const desc = typeof op.deepToString === 'function' ? op.deepToString("") : (op.toString ? op.toString() : "");

        const isVarDef = [80, 81, 82, 83, 84, 85, 104, 105, 134, 135, 136, 137, 138, 140, 144, 148, 151, 153, 156, 172, 196].includes(opCode) || opName.includes('Constant') || opName.includes('Expression') || opName.includes('Variable') || opName.includes('Attribute');
        const isUnusedOp = removableOpSet.has(op);

        let isIslandUnused = false;
        let isDirectUnused = false;
        if (isUnusedOp) {
            const node = opId !== null && graphData && graphData.nodeMap ? graphData.nodeMap.get(`var_${opId}`) : null;
            const isReferencedByOtherNodes = node && node.outputs && node.outputs.length > 0;
            if (isReferencedByOtherNodes) {
                isIslandUnused = true;
            } else {
                isDirectUnused = true;
            }
        }

        let itemDepth = cmdSortMode === 'position' ? depth : 0;

        let exprPrettyStr = '';
        if (opCode === 81 || opName === 'FloatExpression') {
            const bits = op.mBits || op.bits || op.srcExpression;
            if (bits) exprPrettyStr = prettyPrintFloatExpression(bits);
        } else if (opCode === 144 || opCode === 82 || opName.includes('IntegerExpression')) {
            const mask = op.mMask ?? op.mask ?? 0;
            const vals = op.mValues ?? op.values ?? op.srcExpression;
            if (vals) exprPrettyStr = prettyPrintIntegerExpression(mask, vals);
        } else if (opCode === 80 || opName === 'FloatConstant') {
            exprPrettyStr = prettyPrintFloatConstant(op);
        } else if (opCode === 84 || opName === 138 || opName === 'ColorConstant') {
            exprPrettyStr = prettyPrintColorConstant(op);
        } else if (opCode === 85 || opName === 137 || opName === 'NamedVariable') {
            exprPrettyStr = prettyPrintNamedVariable(op);
        } else if (opCode === 215 || opName === 'Loop' || opName === 'LoopOperation') {
            exprPrettyStr = prettyPrintLoop(op);
        } else if (opCode === 135 || opName === 105 || opName.includes('TextFromFloat')) {
            exprPrettyStr = prettyPrintTextFromFloat(op);
        } else if (opCode === 151 || opName === 153 || opName.includes('TextLookup')) {
            exprPrettyStr = prettyPrintTextLookup(op);
        } else if (opCode === 136 || opName === 104 || opName.includes('TextMerge')) {
            exprPrettyStr = prettyPrintTextMerge(op);
        } else if (opCode === 156 || opName.includes('TextLength')) {
            exprPrettyStr = prettyPrintTextLength(op);
        } else if (opCode === 148 || opName === 'LongConstant') {
            exprPrettyStr = prettyPrintLongConstant(op);
        } else if (opCode === 172 || opName.includes('TimeAttribute')) {
            exprPrettyStr = prettyPrintTimeAttribute(op);
        } else if (opCode === 63 || opName === 'Theme') {
            exprPrettyStr = prettyPrintTheme(op);
        } else if (opCode === 196 || opName === 'ColorTheme') {
            exprPrettyStr = prettyPrintColorTheme(op);
        } else if (opCode === 134 || opName === 'ColorExpression') {
            exprPrettyStr = prettyPrintColorExpression(op);
        } else if (opCode === 16 || opName === 'WidthModifier' || opName === 'WidthModifierOperation') {
            exprPrettyStr = prettyPrintWidthModifier(op);
        } else if (opCode === 67 || opName === 'HeightModifier' || opName === 'HeightModifierOperation') {
            exprPrettyStr = prettyPrintHeightModifier(op);
        } else if (opCode === 58 || opName === 'PaddingModifier' || opName === 'PaddingModifierOperation') {
            exprPrettyStr = prettyPrintPaddingModifier(op);
        } else if (opCode === 0 || opName === 'Header') {
            exprPrettyStr = prettyPrintHeader(op);
        } else if (opCode === 123 || opName === 'PathData') {
            exprPrettyStr = prettyPrintPathData(op);
        } else if (opCode === 160 || opName.includes('PathAppend')) {
            exprPrettyStr = prettyPrintPathAppend(op);
        } else if (opCode === 159 || opName.includes('PathCreate')) {
            exprPrettyStr = prettyPrintPathCreate(op);
        } else if (opCode === 158 || opName.includes('PathTween')) {
            exprPrettyStr = prettyPrintPathTween(op);
        } else if (opCode === 175 || opName.includes('PathCombine')) {
            exprPrettyStr = prettyPrintPathCombine(op);
        } else if (opCode === 124 || opName === 'DrawPath') {
            exprPrettyStr = prettyPrintDrawPath(op);
        } else if (opCode === 125 || opName === 'DrawTweenPath') {
            exprPrettyStr = prettyPrintDrawTweenPath(op);
        } else if (opCode === 181 || opName.includes('MatrixFromPath')) {
            exprPrettyStr = prettyPrintMatrixFromPath(op);
        } else if (opCode === 193 || opName.includes('PathExpression')) {
            exprPrettyStr = prettyPrintPathExpression(op);
        } else if (opCode === 239 || opCode === 208 || opName === 'CoreText' || opName === 'TextLayout') {
            exprPrettyStr = prettyPrintCoreText(op);
        } else if (isContainerOp(op) || [200, 202, 203, 204, 217, 230, 233, 237, 238, 240].includes(opCode) || opName.includes('Layout') || opName.includes('Row') || opName.includes('Column') || opName.includes('Box')) {
            exprPrettyStr = prettyPrintLayoutAlignment(op);
        }

        const textSnippet = op.mText || (op.mTextId ? currentDocument?.getText(op.mTextId) : null);
        let unusedBadgeHtml = '';
        if (isIslandUnused) {
            unusedBadgeHtml = `<span class="badge" style="background:rgba(249,115,22,0.25); color:#f97316; font-size:0.65rem; border:1px solid rgba(249,115,22,0.5);" title="Unused Island Op: Referenced by other expressions, but this entire chain is never reached by any layout, draw, or modifier operation">🏝️ Unused Island</span>`;
        } else if (isDirectUnused) {
            unusedBadgeHtml = `<span class="badge" style="background:rgba(251,191,36,0.2); color:var(--accent-amber); font-size:0.65rem; border:1px solid rgba(251,191,36,0.4);" title="Unused Def: This operation is defined here but never reaches any layout, draw, or modifier operation">⚠️ Unused Def</span>`;
        }

        const isExpanded = expandedCmdIndices.has(idx);

        if (cmdDisplayCompact) {
            const indentPrefix = '│ '.repeat(itemDepth);
            let rowStyle = '';
            if (isIslandUnused) {
                rowStyle = 'background:rgba(249,115,22,0.14); border-left:3px solid #f97316;';
            } else if (isDirectUnused) {
                rowStyle = 'background:rgba(251,191,36,0.12); border-left:3px solid var(--accent-amber);';
            }

            let bytesHex = '';
            if (isExpanded && u8 && endOff > startOff && endOff <= u8.length) {
                const slice = u8.subarray(startOff, Math.min(endOff, u8.length));
                bytesHex = Array.from(slice).map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
            }

            html += `
                <div class="command-compact-wrapper" id="cmdWrapper-${idx}">
                    <div class="command-compact-row ${isUnusedOp ? 'unused-var-def-row' : ''} ${isExpanded ? 'expanded' : ''}" id="cmdCard-${idx}" style="${rowStyle}" onclick="selectCommandCard(${idx}, ${opId})" ondblclick="toggleCommandExpand(${idx}, ${opId})">
                        <div class="cmd-compact-left">
                            <span onclick="event.stopPropagation(); toggleCommandExpand(${idx}, ${opId})" style="font-size:0.65rem; color:var(--text-muted); cursor:pointer; width:12px; display:inline-block; user-select:none;" title="Click to toggle details">${isExpanded ? '▼' : '▶'}</span>
                            <span class="cmd-idx">#${idx + 1}</span>
                            ${itemDepth > 0 ? `<span class="cmd-indent-guide">${escapeHtml(indentPrefix)}</span>` : ''}
                            <span class="op-badge" style="${opCode === 214 ? 'background:rgba(251,251,251,0.06); color:var(--text-muted);' : ''}">${hexCode}</span>
                            <span class="op-name" style="${opCode === 214 ? 'color:var(--text-muted); font-style:italic;' : ''}">${opName}</span>
                            ${opId !== undefined && opId !== null && opCode !== 214 ? `<span style="font-size:0.72rem; color:var(--accent-emerald);">[ID: ${opId}]</span>` : ''}
                            ${(opCode === 101 || opName === 'BitmapData') ? `<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-size:0.68rem;">🖼️ ${op.mWidth ?? op.width ?? '?'}×${op.mHeight ?? op.height ?? '?'} px</span>` : ''}
                            ${([44, 48, 49, 66, 149, 190].includes(opCode) || (opName.includes('Bitmap') && opCode !== 101)) && (op.mImageId !== undefined || op.imageId !== undefined || op.mBitmapId !== undefined) ? `<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; font-size:0.68rem;">🖼️ Bmp #${op.mImageId ?? op.imageId ?? op.mBitmapId}</span>` : ''}
                            ${exprPrettyStr ? `<span style="font-size:0.75rem; color:var(--accent-blue); font-family:var(--code-font); font-weight:500; display:inline-flex; align-items:center; gap:4px;">= ${exprPrettyStr}</span>` : ''}
                            ${textSnippet && opCode !== 239 && opCode !== 208 && opName !== 'CoreText' && opName !== 'TextLayout' ? `<span style="font-size:0.75rem; color:var(--accent-amber); font-style:italic;">"${escapeHtml(textSnippet)}"</span>` : ''}
                            ${unusedBadgeHtml}
                        </div>
                        <span class="op-offset">Off ${startOff}–${endOff} (${sizeB} B)</span>
                    </div>
                    ${isExpanded ? `
                        <div class="command-card-inline-detail" style="margin-left:${Math.min(itemDepth * 16 + 24, 120)}px; margin-bottom:8px; margin-top:4px; padding:10px 12px; background:var(--bg-card); border:1px solid var(--border-color); border-left:3px solid ${isIslandUnused ? '#f97316' : 'var(--accent-blue)'}; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.3);">
                            <div class="command-header" style="margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                                <div style="font-weight:600; font-size:0.8rem; color:${isIslandUnused ? '#f97316' : 'var(--accent-blue)'};">🔍 Detailed View (${opName} #${idx + 1})</div>
                                <span class="op-offset" style="font-size:0.72rem; color:var(--text-secondary);">Binary Offset: ${startOff}–${endOff} (${sizeB} Bytes)</span>
                            </div>
                            ${desc ? `<div class="op-detail" style="font-family:var(--code-font); font-size:0.8rem; color:var(--text-primary); margin-bottom:6px; background:rgba(0,0,0,0.2); padding:6px 8px; border-radius:4px; white-space:pre-wrap; word-break:break-word;">${escapeHtml(desc)}</div>` : ''}
                            ${opCode === 101 || opName === 'BitmapData' ? renderBitmapDataPreviewHtml(op, idx) : ''}
                            ${([44, 48, 49, 66, 149, 190, 234].includes(opCode) || (opName.includes('Bitmap') && opCode !== 101) || opName === 'ImageLayout' || (op.mBitmapId !== undefined && op.mBitmapId !== -1)) ? renderDrawBitmapReferenceHtml(op, idx) : ''}
                            ${(opCode === 239 || opCode === 208 || opName === 'CoreText' || opName === 'TextLayout' || (op.mTextId !== undefined && op.mTextId !== -1)) ? renderCoreTextDetailsHtml(op, idx) : ''}
                            ${renderLayoutAlignmentDetailsHtml(op, idx)}
                            ${renderDimensionModifierDetailsHtml(op, idx)}
                            ${opCode === 123 || opName === 'PathData' ? renderPathDataPreviewHtml(op, idx) : ''}
                            ${opCode === 175 || opName === 'PathCombine' ? renderPathCombinePreviewHtml(op, idx) : ''}
                            ${exprPrettyStr ? `<div style="font-size:0.78rem; color:var(--accent-blue); margin-bottom:6px; padding:4px 8px; background:rgba(56,189,248,0.08); border-radius:4px; border:1px solid rgba(56,189,248,0.25); font-family:var(--code-font); display:flex; align-items:center; gap:6px;">🧮 <strong>Expression:</strong> = ${exprPrettyStr}</div>` : ''}
                            ${isVarDef && opId !== null ? renderReferencingOpsHtml(opId) : ''}
                            ${bytesHex ? `<div class="op-bytes" style="font-family:var(--code-font); font-size:0.72rem; color:var(--text-muted); word-break:break-all;"><span>HEX:</span> ${bytesHex}</div>` : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        } else {
            let bytesHex = '';
            if (u8 && endOff > startOff && endOff <= u8.length) {
                const slice = u8.subarray(startOff, Math.min(endOff, u8.length));
                bytesHex = Array.from(slice).map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
            }
            let cardStyle = '';
            if (isIslandUnused) {
                cardStyle = 'background:rgba(249,115,22,0.12); border-color:rgba(249,115,22,0.55); box-shadow:0 0 8px rgba(249,115,22,0.2);';
            } else if (isDirectUnused) {
                cardStyle = 'background:rgba(251,191,36,0.1); border-color:rgba(251,191,36,0.5); box-shadow:0 0 8px rgba(251,191,36,0.15);';
            }

            html += `
                <div class="command-card ${isUnusedOp ? 'unused-var-def-row' : ''}" id="cmdCard-${idx}" style="${cardStyle}" onclick="selectCommandCard(${idx}, ${opId})">
                    <div class="command-header">
                        <div class="command-op">
                            <span class="cmd-idx">#${idx + 1}</span>
                            <span class="op-badge">${hexCode}</span>
                            <span class="op-name">${opName}</span>
                            ${opId !== undefined && opId !== null ? `<span style="font-size:0.75rem; color:var(--accent-emerald);">[ID: ${opId}]</span>` : ''}
                            ${unusedBadgeHtml}
                        </div>
                        <span class="op-offset">Off ${startOff}–${endOff} (${sizeB} B)</span>
                    </div>
                    ${desc ? `<div class="op-detail">${escapeHtml(desc)}</div>` : ''}
                    ${opCode === 101 || opName === 'BitmapData' ? renderBitmapDataPreviewHtml(op, idx) : ''}
                    ${([44, 48, 49, 66, 149, 190, 234].includes(opCode) || (opName.includes('Bitmap') && opCode !== 101) || opName === 'ImageLayout' || (op.mBitmapId !== undefined && op.mBitmapId !== -1)) ? renderDrawBitmapReferenceHtml(op, idx) : ''}
                    ${(opCode === 239 || opCode === 208 || opName === 'CoreText' || opName === 'TextLayout' || (op.mTextId !== undefined && op.mTextId !== -1)) ? renderCoreTextDetailsHtml(op, idx) : ''}
                    ${renderLayoutAlignmentDetailsHtml(op, idx)}
                    ${renderDimensionModifierDetailsHtml(op, idx)}
                    ${opCode === 123 || opName === 'PathData' ? renderPathDataPreviewHtml(op, idx) : ''}
                    ${opCode === 175 || opName === 'PathCombine' ? renderPathCombinePreviewHtml(op, idx) : ''}
                    ${exprPrettyStr ? `<div style="font-size:0.78rem; color:var(--accent-blue); margin-top:6px; padding:4px 8px; background:rgba(56,189,248,0.08); border-radius:4px; border:1px solid rgba(56,189,248,0.25); font-family:var(--code-font);">🧮 <strong>Expression:</strong> = ${exprPrettyStr}</div>` : ''}
                    ${isVarDef && opId !== null ? `<div style="margin-top:6px;">${renderReferencingOpsHtml(opId)}</div>` : ''}
                    ${bytesHex ? `<div class="op-bytes"><span>HEX:</span> ${bytesHex}</div>` : ''}
                </div>
            `;
        }
    });

    container.innerHTML = html;
    filterCommands();
}

export function toggleCommandExpand(idx, opId) {
    selectCommandCard(idx, opId);
    if (cmdDisplayCompact) {
        if (expandedCmdIndices.has(idx)) {
            expandedCmdIndices.delete(idx);
        } else {
            expandedCmdIndices.add(idx);
        }
        const currentParsedOps = window.currentParsedOps;
        const currentBuffer = window.currentBuffer;
        const u8 = currentBuffer ? new Uint8Array(currentBuffer) : null;
        renderCommandsList(currentParsedOps, u8);
    }
}

/**
 * Finds the index in allOps (or window.currentParsedOps) corresponding to a component or operation.
 * Matches by direct object identity, wrapped op/component, componentId, textId, bitmapId,
 * operation/variable ID, byte offset, or deep representation.
 */
export function findMatchingCommandIndex(op, opId = null, allOps = null) {
    const ops = allOps || (typeof window !== 'undefined' ? window.currentParsedOps : null);
    if (!ops || !Array.isArray(ops) || ops.length === 0) return -1;
    if (!op && (opId === null || opId === undefined)) return -1;

    // 1. Direct Object Identity
    if (op && typeof op === 'object') {
        const directIdx = ops.indexOf(op);
        if (directIdx >= 0) return directIdx;

        for (const prop of ['op', 'mOp', 'component', 'mComponent', 'sourceOp']) {
            if (op[prop] && typeof op[prop] === 'object') {
                const subIdx = ops.indexOf(op[prop]);
                if (subIdx >= 0) return subIdx;
            }
        }
    }

    // 2. Component ID Match
    const cid = typeof op?.getComponentId === 'function' ? op.getComponentId() : (op?.mComponentId ?? op?.componentId ?? (typeof opId === 'number' ? opId : null));
    if (cid !== null && cid !== undefined) {
        const targetName = op ? getOpName(op) : '';
        const targetOpCode = op?.OP_CODE ?? op?.constructor?.OP_CODE ?? null;

        // 2a. Match exact component type/name and cid
        for (let i = 0; i < ops.length; i++) {
            const o = ops[i];
            const oCid = typeof o.getComponentId === 'function' ? o.getComponentId() : (o.mComponentId ?? o.componentId ?? null);
            if (oCid === cid) {
                if (targetOpCode !== null && (o.OP_CODE === targetOpCode || o.constructor?.OP_CODE === targetOpCode)) return i;
                const oName = getOpName(o);
                if (targetName && (oName === targetName || (targetName.includes('Text') && oName.includes('Text')) || (targetName.includes('Box') && oName.includes('Box')))) return i;
            }
        }

        // 2b. Match any container/component operation or ComponentStart with same cid
        for (let i = 0; i < ops.length; i++) {
            const o = ops[i];
            const oCid = typeof o.getComponentId === 'function' ? o.getComponentId() : (o.mComponentId ?? o.componentId ?? null);
            if (oCid === cid && (isContainerOp(o) || isComponentOp(o) || o.OP_CODE === 2 || o.OP_CODE === 200 || getOpName(o).includes('Layout') || getOpName(o).includes('Text'))) return i;
        }

        // 2c. Match any op with same cid or mCurrentId
        for (let i = 0; i < ops.length; i++) {
            const o = ops[i];
            const oCid = typeof o.getComponentId === 'function' ? o.getComponentId() : (o.mComponentId ?? o.componentId ?? o.mCurrentId ?? null);
            if (oCid === cid) return i;
        }
    }

    // 3. Text ID Match (for CoreText, TextLayout, DrawText)
    const textId = op?.mTextId ?? op?.textId ?? null;
    if (textId !== null && textId !== undefined && textId !== -1) {
        for (let i = 0; i < ops.length; i++) {
            const o = ops[i];
            if ((o.mTextId === textId || o.textId === textId) && (getOpName(o).includes('Text') || o.OP_CODE === 239 || o.OP_CODE === 208 || o.OP_CODE === 43)) return i;
        }
    }

    // 4. Bitmap ID Match (for ImageLayout, DrawBitmap)
    const bmpId = op?.mBitmapId ?? op?.bitmapId ?? op?.mImageId ?? op?.imageId ?? null;
    if (bmpId !== null && bmpId !== undefined && bmpId !== -1) {
        for (let i = 0; i < ops.length; i++) {
            const o = ops[i];
            if ((o.mBitmapId === bmpId || o.bitmapId === bmpId || o.mImageId === bmpId || o.imageId === bmpId) && (getOpName(o).includes('Image') || o.OP_CODE === 204 || o.OP_CODE === 44)) return i;
        }
    }

    // 5. Operation / Variable ID Match
    const rawId = typeof op?.getId === 'function' ? op.getId() : (op?.mId ?? op?.mVarId ?? op?.varId ?? (typeof opId === 'number' ? opId : null));
    if (rawId !== null && rawId !== undefined && rawId !== 0) {
        for (let i = 0; i < ops.length; i++) {
            const o = ops[i];
            if (getOpId(o) === rawId || o.mId === rawId || o.mVarId === rawId) return i;
        }
    }

    // 6. Byte offset match
    if (op?._byteStart !== undefined) {
        for (let i = 0; i < ops.length; i++) {
            if (ops[i]._byteStart !== undefined && ops[i]._byteStart === op._byteStart) return i;
        }
    }

    // 7. Deep string representation match fallback
    if (typeof op?.deepToString === 'function') {
        const str = op.deepToString('');
        for (let i = 0; i < ops.length; i++) {
            if (typeof ops[i].deepToString === 'function' && ops[i].deepToString('') === str) return i;
        }
    }

    return -1;
}

export function selectCommandCard(idx, opId, options = {}) {
    const currentParsedOps = window.currentParsedOps;
    const currentDocument = window.currentDocument;
    const restorePanel = typeof window.restorePanel === 'function' ? window.restorePanel : (() => {});
    const buildExpressionGraphModel = typeof window.buildExpressionGraphModel === 'function' ? window.buildExpressionGraphModel : (() => ({ nodes: [] }));
    const selectExprGraphNode = typeof window.selectExprGraphNode === 'function' ? window.selectExprGraphNode : (() => {});

    document.querySelectorAll('.command-card, .command-compact-row').forEach(c => c.classList.remove('selected'));
    const card = document.getElementById(`cmdCard-${idx}`);
    if (card) {
        card.classList.add('selected');
        if (options.scrollTo !== false) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // Sync selection to Expression Dependency Graph (Pane 9)
    if (options.source !== 'exprGraph' && currentParsedOps && currentParsedOps[idx]) {
        const targetOp = currentParsedOps[idx];
        let exprGraphData = window.exprGraphData;
        if (!exprGraphData || !exprGraphData.nodes || exprGraphData.nodes.length === 0) {
            if (currentDocument) exprGraphData = buildExpressionGraphModel(currentDocument);
        }
        if (exprGraphData && exprGraphData.nodes) {
            const matchedNode = exprGraphData.nodes.find(n => (n.op && n.op === targetOp) || (n.varId !== null && opId !== null && opId !== undefined && n.varId === opId));
            if (matchedNode) {
                if (options.focusGraph) {
                    restorePanel('pane9');
                }
                selectExprGraphNode(matchedNode.id, { source: 'cmdList', scrollTo: true });
            }
        }
    }

    // Sync selection to Binary Treemap & Allocation Visualizer (Pane 10)
    if (options.source !== 'treemap' && typeof window.highlightTreemapOp === 'function') {
        window.highlightTreemapOp(idx);
    }
}

export function onCmdSearchInput() {
    const input = document.getElementById('cmdSearchInput');
    const clearBtn = document.getElementById('cmdSearchClearBtn');
    if (input && clearBtn) {
        clearBtn.style.display = input.value.trim().length > 0 ? 'block' : 'none';
    }
    filterCommands();
}

export function clearCmdSearch() {
    const input = document.getElementById('cmdSearchInput');
    const clearBtn = document.getElementById('cmdSearchClearBtn');
    if (input) {
        input.value = '';
        input.focus();
    }
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }
    filterCommands();
}

export function filterUnusedVarsOnly() {
    const input = document.getElementById('cmdSearchInput');
    if (!input) return;
    if (input.value.toLowerCase().trim() === 'unused') {
        input.value = '';
    } else {
        input.value = 'unused';
    }
    onCmdSearchInput();
}

export function filterCommands() {
    const searchEl = document.getElementById('cmdSearchInput');
    if (!searchEl) return;
    const query = searchEl.value.toLowerCase().trim();
    document.querySelectorAll('.command-card, .command-compact-row').forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(query) ? '' : 'none';
    });
}

// Auto-expose exported functions to window for HTML inline event handlers
window.getOpId = getOpId;
window.getEffectiveChildren = getEffectiveChildren;
window.findMatchingCommandIndex = findMatchingCommandIndex;
window.toggleCmdDisplayMode = toggleCmdDisplayMode;
window.changeCmdSortMode = changeCmdSortMode;
window.renderPathDataPreviewHtml = renderPathDataPreviewHtml;
window.renderPathCombinePreviewHtml = renderPathCombinePreviewHtml;
window.renderBitmapDataPreviewHtml = renderBitmapDataPreviewHtml;
window.renderDrawBitmapReferenceHtml = renderDrawBitmapReferenceHtml;
window.getOpBitmapDataUrl = getOpBitmapDataUrl;
window.uint8ArrayToDataUrl = uint8ArrayToDataUrl;
window.prettyPrintPathData = prettyPrintPathData;
window.getVariableUsageInfo = getVariableUsageInfo;
window.getUnusedVariableDefIds = getUnusedVariableDefIds;
window.getReferencingOpsForVarId = getReferencingOpsForVarId;
window.renderReferencingOpsHtml = renderReferencingOpsHtml;
window.renderCommandsList = renderCommandsList;
window.toggleCommandExpand = toggleCommandExpand;
window.selectCommandCard = selectCommandCard;
window.onCmdSearchInput = onCmdSearchInput;
window.clearCmdSearch = clearCmdSearch;
window.filterUnusedVarsOnly = filterUnusedVarsOnly;
window.filterCommands = filterCommands;

