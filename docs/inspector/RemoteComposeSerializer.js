/**
 * RemoteCompose JavaScript Serializer Runtime
 * --------------------------------------------
 * Auto-generated from RemoteCompose Wire Format Specification.
 * Do not edit directly; regenerate using generate_typescript_serializer.py.
 */

(function(global) {

class WireBufferWriter {
  constructor(initialCapacity = 8192) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
    this.offset = 0;
  }

  ensureCapacity(additional) {
    if (this.offset + additional > this.buffer.length) {
      let newCap = this.buffer.length * 2;
      while (this.offset + additional > newCap) {
        newCap *= 2;
      }
      const newBuf = new Uint8Array(newCap);
      newBuf.set(this.buffer);
      this.buffer = newBuf;
      this.view = new DataView(this.buffer.buffer);
    }
  }

  getOffset() {
    return this.offset;
  }

  writeByte(val) {
    this.ensureCapacity(1);
    this.buffer[this.offset++] = val & 0xff;
  }

  writeShort(val) {
    this.ensureCapacity(2);
    this.view.setInt16(this.offset, val, false);
    this.offset += 2;
  }

  writeInt(val) {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, val, false);
    this.offset += 4;
  }

  writeLong(val) {
    this.ensureCapacity(8);
    this.view.setBigInt64(this.offset, BigInt(val), false);
    this.offset += 8;
  }

  writeFloat(val) {
    this.ensureCapacity(4);
    this.view.setFloat32(this.offset, val, false);
    this.offset += 4;
  }

  writeDouble(val) {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, val, false);
    this.offset += 8;
  }

  writeBoolean(val) {
    this.writeByte(val ? 1 : 0);
  }

  writeUTF8(str) {
    if (!str) {
      this.writeInt(0);
      return;
    }
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    this.writeInt(bytes.length);
    this.ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  writeByteArray(arr) {
    this.writeInt(arr.length);
    this.ensureCapacity(arr.length);
    if (arr instanceof Uint8Array) {
      this.buffer.set(arr, this.offset);
    } else {
      for (let i = 0; i < arr.length; i++) {
        this.buffer[this.offset + i] = arr[i] & 0xff;
      }
    }
    this.offset += arr.length;
  }

  writeShortArray(arr) {
    this.writeInt(arr.length);
    for (const v of arr) this.writeShort(v);
  }

  writeIntArray(arr) {
    this.writeInt(arr.length);
    for (const v of arr) this.writeInt(v);
  }

  writeFloatArray(arr) {
    this.writeInt(arr.length);
    for (const v of arr) this.writeFloat(v);
  }

  writeStringArray(arr) {
    this.writeInt(arr.length);
    for (const s of arr) this.writeUTF8(s);
  }

  toUint8Array() {
    return this.buffer.slice(0, this.offset);
  }

  toBase64() {
    const bytes = this.toUint8Array();
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  }
}

function parseColor(colorStr) {
  if (!colorStr) return 0xff000000;
  if (typeof colorStr === 'number') return colorStr;
  if (colorStr.startsWith('#')) {
    let hex = colorStr.substring(1);
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    if (hex.length === 6) {
      hex = 'FF' + hex;
    }
    return parseInt(hex, 16) | 0;
  }
  return 0xff000000;
}

function parseSvgPathToFloats(pathStr) {
  if (!pathStr || typeof pathStr !== 'string') return [];
  const floats = [];
  const commands = pathStr.match(/[MmZzLlHhVvCcSsQqTtAa][^MmZzLlHhVvCcSsQqTtAa]*/g) || [];
  
  function asNan(id) {
    const bits = (id & 0x00ffffff) | 0xff800000;
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, bits, false);
    return view.getFloat32(0, false);
  }

  for (const cmdStr of commands) {
    const trimmed = cmdStr.trim();
    if (!trimmed) continue;
    const cmd = trimmed.charAt(0);
    const valStr = trimmed.substring(1).trim();
    const values = valStr ? valStr.split(/[\s,]+/).map(Number).filter(n => !isNaN(n)) : [];

    if (cmd === 'M' || cmd === 'm') {
      floats.push(asNan(10)); // MOVE = 10
      floats.push(values[0] || 0, values[1] || 0);
    } else if (cmd === 'L' || cmd === 'l') {
      for (let i = 0; i < values.length; i += 2) {
        floats.push(asNan(11)); // LINE = 11
        floats.push(values[i] || 0, values[i + 1] || 0);
      }
    } else if (cmd === 'Q' || cmd === 'q') {
      for (let i = 0; i < values.length; i += 4) {
        floats.push(asNan(12)); // QUADRATIC = 12
        floats.push(values[i] || 0, values[i + 1] || 0, values[i + 2] || 0, values[i + 3] || 0);
      }
    } else if (cmd === 'C' || cmd === 'c') {
      for (let i = 0; i < values.length; i += 6) {
        floats.push(asNan(14)); // CUBIC = 14
        floats.push(values[i] || 0, values[i + 1] || 0, values[i + 2] || 0, values[i + 3] || 0, values[i + 4] || 0, values[i + 5] || 0);
      }
    } else if (cmd === 'Z' || cmd === 'z') {
      floats.push(asNan(15)); // CLOSE = 15
    }
  }
  return floats;
}

function writePaintBundle(writer, paintObj) {
  if (!paintObj) return;
  const entries = [];

  if (paintObj.color !== undefined) {
    entries.push(4);
    entries.push(parseColor(paintObj.color));
  }
  if (paintObj.strokeWidth !== undefined || paintObj.width !== undefined) {
    const w = Number(paintObj.strokeWidth ?? paintObj.width);
    entries.push(5);
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, w, false);
    entries.push(view.getInt32(0, false));
  }
  if (paintObj.strokeCap !== undefined) {
    const cap = String(paintObj.strokeCap).toLowerCase();
    let capVal = 0;
    if (cap === 'round') capVal = 1;
    else if (cap === 'square') capVal = 2;
    entries.push(7);
    entries.push(capVal);
  }
  if (paintObj.style !== undefined) {
    const style = String(paintObj.style).toLowerCase();
    let styleVal = 0;
    if (style === 'stroke') styleVal = 1;
    else if (style === 'fillandstroke') styleVal = 2;
    entries.push(8);
    entries.push(styleVal);
  }
  if (paintObj.strokeJoin !== undefined) {
    const join = String(paintObj.strokeJoin).toLowerCase();
    let joinVal = 0;
    if (join === 'round') joinVal = 1;
    else if (join === 'bevel') joinVal = 2;
    entries.push(15);
    entries.push(joinVal);
  }
  if (paintObj.alpha !== undefined) {
    const a = Number(paintObj.alpha);
    entries.push(12);
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, a, false);
    entries.push(view.getInt32(0, false));
  }

  writer.writeByte(40);
  writer.writeInt(entries.length);
  for (const val of entries) {
    writer.writeInt(val);
  }
}

class ExpressionCompiler {
  static OPERATORS = {
    '+': { prec: 1, opId: 1 },
    '-': { prec: 1, opId: 2 },
    '*': { prec: 2, opId: 3 },
    '/': { prec: 2, opId: 4 },
    '%': { prec: 2, opId: 5 },
  };

  static FUNCTIONS = {
    sin: 18, cos: 19, tan: 20, asin: 21, acos: 22, atan: 23, atan2: 24,
    sqrt: 9, abs: 10, sign: 11, exp: 13, floor: 14, log10: 15, log: 16,
    round: 17, min: 6, max: 7, pow: 8, ceil: 31, clamp: 27, lerp: 49,
  };

  static SYSTEM_VARS = {
    'continuousSec': 1, 'timeInSec': 2, 'timeInMin': 3, 'timeInHr': 4,
    'windowWidth': 5, 'windowHeight': 6, 'componentWidth': 7, 'componentHeight': 8,
    'touchX': 13, 'touchY': 14, 'fontSize': 33, 'time': 1,
  };

  static compileToBits(exprStr) {
    const tokens = this.tokenize(exprStr);
    const rpn = this.shuntingYard(tokens);
    const bits = [];
    const RPN_OFFSET = 3211264; // 0x310000

    for (const token of rpn) {
      if (token.type === 'NUMBER') {
        const view = new DataView(new ArrayBuffer(4));
        view.setFloat32(0, token.value, false);
        bits.push(view.getInt32(0, false));
      } else if (token.type === 'VAR') {
        const sysId = this.SYSTEM_VARS[token.value];
        const varId = sysId ?? 1;
        bits.push((varId & 0x00ffffff) | 0xff800000);
      } else if (token.type === 'OP') {
        const opInfo = this.OPERATORS[token.value];
        if (opInfo) {
          bits.push(((RPN_OFFSET + opInfo.opId) & 0x00ffffff) | 0xff800000);
        }
      } else if (token.type === 'FUNC') {
        const funcId = this.FUNCTIONS[token.value] ?? 18;
        bits.push(((RPN_OFFSET + funcId) & 0x00ffffff) | 0xff800000);
      }
    }
    return bits;
  }

  static tokenize(expr) {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
      const char = expr[i];
      if (/\s/.test(char)) { i++; continue; }
      if (/[0-9.]/.test(char)) {
        let numStr = '';
        while (i < expr.length && /[0-9.]/.test(expr[i])) numStr += expr[i++];
        tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
        continue;
      }
      if (/[a-zA-Z_@$]/.test(char)) {
        let ident = '';
        while (i < expr.length && /[a-zA-Z0-9_()@$]/.test(expr[i])) ident += expr[i++];
        const cleaned = ident.replace('()', '').replace(/^[@$]/, '').replace('vars.', '');
        if (this.FUNCTIONS[cleaned]) {
          tokens.push({ type: 'FUNC', value: cleaned });
        } else {
          tokens.push({ type: 'VAR', value: cleaned });
        }
        continue;
      }
      if (this.OPERATORS[char]) {
        tokens.push({ type: 'OP', value: char });
        i++;
        continue;
      }
      if (char === '(' || char === ')') {
        tokens.push({ type: 'PAREN', value: char });
        i++;
        continue;
      }
      i++;
    }
    return tokens;
  }

  static shuntingYard(tokens) {
    const output = [];
    const stack = [];

    for (const token of tokens) {
      if (token.type === 'NUMBER' || token.type === 'VAR') {
        output.push(token);
      } else if (token.type === 'FUNC') {
        stack.push(token);
      } else if (token.type === 'OP') {
        while (
          stack.length > 0 &&
          stack[stack.length - 1].type === 'OP' &&
          this.OPERATORS[stack[stack.length - 1].value].prec >= this.OPERATORS[token.value].prec
        ) {
          output.push(stack.pop());
        }
        stack.push(token);
      } else if (token.type === 'PAREN' && token.value === '(') {
        stack.push(token);
      } else if (token.type === 'PAREN' && token.value === ')') {
        while (stack.length > 0 && stack[stack.length - 1].value !== '(') {
          output.push(stack.pop());
        }
        if (stack.length > 0 && stack[stack.length - 1].value === '(') {
          stack.pop();
        }
        if (stack.length > 0 && stack[stack.length - 1].type === 'FUNC') {
          output.push(stack.pop());
        }
      }
    }
    while (stack.length > 0) output.push(stack.pop());
    return output;
  }
}

const Opcode = {
  Header: 0,
  ComponentStart: 2,
  AnimationSpec: 14,
  WidthModifierOperation: 16,
  ClipPath: 38,
  ClipRect: 39,
  PaintData: 40,
  DrawRect: 42,
  DrawText: 43,
  DrawBitmap: 44,
  ShaderData: 45,
  DrawCircle: 46,
  DrawLine: 47,
  DrawBitmapFontText: 48,
  DrawBitmapFontTextOnPath: 49,
  DrawRoundRect: 51,
  DrawSector: 52,
  DrawTextOnPath: 53,
  RoundedClipRectModifierOperation: 54,
  BackgroundModifierOperation: 55,
  DrawOval: 56,
  DrawTextOnCircle: 57,
  PaddingModifierOperation: 58,
  ClickModifier: 59,
  Theme: 63,
  ClickArea: 64,
  RootContentBehavior: 65,
  DrawBitmapInt: 66,
  HeightModifierOperation: 67,
  FloatConstant: 80,
  FloatExpression: 81,
  MultiClickModifier: 83,
  Custom: 93,
  BitmapData: 101,
  TextData: 102,
  RootContentDescription: 103,
  BorderModifierOperation: 107,
  ClipRectModifierOperation: 108,
  PathData: 123,
  DrawPath: 124,
  DrawTweenPath: 125,
  MatrixScale: 126,
  MatrixTranslate: 127,
  MatrixSkew: 128,
  MatrixRotate: 129,
  MatrixSave: 130,
  MatrixRestore: 131,
  DrawTextAnchored: 133,
  ColorExpression: 134,
  TextFromFloat: 135,
  TextMerge: 136,
  NamedVariable: 137,
  ColorConstant: 138,
  DrawContent: 139,
  IntegerConstant: 140,
  PlaySound: 141,
  ReferencedOperations: 142,
  BooleanConstant: 143,
  IntegerExpression: 144,
  DataMapIds: 145,
  IdListData: 146,
  FloatListData: 147,
  LongConstant: 148,
  DrawBitmapScaled: 149,
  ComponentValue: 150,
  TextLookup: 151,
  DrawArc: 152,
  TextLookupInt: 153,
  DataMapLookup: 154,
  TextMeasure: 155,
  TextLength: 156,
  TouchExpression: 157,
  PathTween: 158,
  PathCreate: 159,
  PathAppend: 160,
  ParticlesCreate: 161,
  ParticlesLoop: 163,
  ImpulseOperation: 164,
  ImpulseProcess: 165,
  FunctionCall: 166,
  BitmapFontData: 167,
  FunctionDefine: 168,
  SoundData: 169,
  TextAttribute: 170,
  ImageAttribute: 171,
  TimeAttribute: 172,
  CanvasOperations: 173,
  DrawContentOperation: 174,
  PathCombine: 175,
  FitBoxLayout: 176,
  HapticFeedback: 177,
  ConditionalOperations: 178,
  DebugMessage: 179,
  ColorAttribute: 180,
  MatrixFromPath: 181,
  TextSubtext: 182,
  BitmapTextMeasure: 183,
  DrawBitmapTextAnchored: 184,
  Rem: 185,
  MatrixConstant: 186,
  MatrixExpression: 187,
  MatrixVectorMath: 188,
  FontData: 189,
  DrawToBitmap: 190,
  WakeIn: 191,
  IdLookup: 192,
  PathExpression: 193,
  ParticlesCompare: 194,
  ColorTheme: 196,
  DataDynamicListFloat: 197,
  UpdateDynamicFloatList: 198,
  TextTransform: 199,
  RootLayout: 200,
  LayoutContent: 201,
  BoxLayout: 202,
  RowLayout: 203,
  ColumnLayout: 204,
  CanvasLayout: 205,
  SoundExpression: 206,
  CanvasContent: 207,
  TextLayout: 208,
  HostAction: 209,
  HostNamedAction: 210,
  ComponentVisibilityOperation: 211,
  ValueIntegerChangeActionOperation: 212,
  ValueStringChangeActionOperation: 213,
  ContainerEnd: 214,
  Loop: 215,
  HostActionMetadata: 216,
  StateLayout: 217,
  ValueIntegerExpressionChangeActionOperation: 218,
  TouchModifier: 219,
  TouchUpModifier: 220,
  OffsetModifierOperation: 221,
  ValueFloatChangeActionOperation: 222,
  ZIndexModifierOperation: 223,
  GraphicsLayerModifierOperation: 224,
  TouchCancelModifier: 225,
  ScrollModifierOperation: 226,
  ValueFloatExpressionChangeActionOperation: 227,
  MarqueeModifierOperation: 228,
  RippleModifier: 229,
  CollapsibleRow: 230,
  WidthInModifierOperation: 231,
  HeightInModifierOperation: 232,
  CollapsibleColumn: 233,
  ImageLayout: 234,
  CollapsiblePriorityModifierOperation: 235,
  RunAction: 236,
  AlignByModifierOperation: 237,
  LayoutCompute: 238,
  CoreText: 239,
  FlowLayout: 240,
  Skip: 241,
  TextStyle: 242,
  DimensionConstraintsModifierOperation: 243,
  PatternForEach: 244,
  IncludeReferencedOperations: 245,
  PatternDefine: 246,
  PatternInflation: 247,
  PatternArgument: 248,
  PatternBlock: 249,
  CoreSemantics: 250,
  ExtensionRangeReserved4: 251,
  ExtensionRangeReserved3: 252,
  ExtensionRangeReserved2: 253,
  ExtensionRangeReserved1: 254,
  ExtendedOpcode: 255,
};

function encodeHeader(writer, args = {}) {
  const width = args.width ?? 400;
  const height = args.height ?? 400;
  const profiles = args.capabilities ? Number(args.capabilities) : 0;
  writer.writeByte(0);
  writer.writeInt(0x048C0001);
  writer.writeInt(0);
  writer.writeInt(0);
  let entryCount = profiles ? 3 : 2;
  writer.writeInt(entryCount);
  writer.writeShort(5); writer.writeShort(4); writer.writeInt(width);
  writer.writeShort(6); writer.writeShort(4); writer.writeInt(height);
  if (profiles) { writer.writeShort(14); writer.writeShort(4); writer.writeInt(profiles); }
}

function encodeComponentStart(writer, args = {}) {
  writer.writeByte(2);
  writer.writeInt(args.type ?? 0);
  writer.writeInt(args.componentId ?? 0);
  writer.writeFloat(args.width ?? 0);
  writer.writeFloat(args.height ?? 0);
}

function encodeAnimationSpec(writer, args = {}) {
  writer.writeByte(14);
  writer.writeInt(args.animationId ?? 0);
  writer.writeFloat(args.motionDuration ?? 0);
  writer.writeInt(args.motionEasingType ?? 0);
  writer.writeFloat(args.visibilityDuration ?? 0);
  writer.writeInt(args.visibilityEasingType ?? 0);
  writer.writeInt(args.enterAnimation ?? 0);
  writer.writeInt(args.exitAnimation ?? 0);
}

function encodeWidthModifierOperation(writer, args = {}) {
  writer.writeByte(16);
  writer.writeInt(args.type ?? 0);
  writer.writeFloat(args.value ?? 0);
}

function encodeClipPath(writer, args = {}) {
  writer.writeByte(38);
  writer.writeInt(args.id ?? 0);
}

function encodeClipRect(writer, args = {}) {
  writer.writeByte(39);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
}

function encodePaintData(writer, args = {}) {
  writer.writeByte(40);
  writer.writeInt(0);
}

function encodeDrawRect(writer, args = {}) {
  writer.writeByte(42);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
}

function encodeDrawText(writer, args = {}) {
  writer.writeByte(43);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.start ?? 0);
  writer.writeInt(args.end ?? 0);
  writer.writeInt(args.contextStart ?? 0);
  writer.writeInt(args.contextEnd ?? 0);
  writer.writeFloat(args.x ?? 0);
  writer.writeFloat(args.y ?? 0);
  writer.writeBoolean(args.rtl ?? false);
}

function encodeDrawBitmap(writer, args = {}) {
  writer.writeByte(44);
  writer.writeInt(args.imageId ?? 0);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
  writer.writeInt(args.descriptionId ?? 0);
}

function encodeShaderData(writer, args = {}) {
  writer.writeByte(45);
  writer.writeInt(args.shaderId ?? 0);
  writer.writeInt(args.shaderType ?? 0);
  writer.writeInt(0);
  writer.writeInt(0);
  writer.writeInt(0);
}

function encodeDrawCircle(writer, args = {}) {
  writer.writeByte(46);
  writer.writeFloat(args.centerX ?? 0);
  writer.writeFloat(args.centerY ?? 0);
  writer.writeFloat(args.radius ?? 0);
}

function encodeDrawLine(writer, args = {}) {
  writer.writeByte(47);
  writer.writeFloat(args.startX ?? 0);
  writer.writeFloat(args.startY ?? 0);
  writer.writeFloat(args.endX ?? 0);
  writer.writeFloat(args.endY ?? 0);
}

function encodeDrawBitmapFontText(writer, args = {}) {
  writer.writeByte(48);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.bitmapFontId ?? 0);
  writer.writeInt(args.start ?? 0);
  writer.writeInt(args.end ?? 0);
  writer.writeFloat(args.x ?? 0);
  writer.writeFloat(args.y ?? 0);
}

function encodeDrawBitmapFontTextOnPath(writer, args = {}) {
  writer.writeByte(49);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.bitmapFontID ?? 0);
  writer.writeInt(args.pathID ?? 0);
  writer.writeInt(args.start ?? 0);
  writer.writeInt(args.end ?? 0);
  writer.writeFloat(args.yAdj ?? 0);
  writer.writeFloat(args.glyphSpacing ?? 0);
}

function encodeDrawRoundRect(writer, args = {}) {
  writer.writeByte(51);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
  writer.writeFloat(args.rx ?? 0);
  writer.writeFloat(args.ry ?? 0);
}

function encodeDrawSector(writer, args = {}) {
  writer.writeByte(52);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
  writer.writeFloat(args.startAngle ?? 0);
  writer.writeFloat(args.sweepAngle ?? 0);
}

function encodeDrawTextOnPath(writer, args = {}) {
  writer.writeByte(53);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.pathId ?? 0);
  writer.writeFloat(args.hOffset ?? 0);
  writer.writeFloat(args.vOffset ?? 0);
}

function encodeRoundedClipRectModifierOperation(writer, args = {}) {
  writer.writeByte(54);
  writer.writeFloat(args.topStart ?? 0);
  writer.writeFloat(args.topEnd ?? 0);
  writer.writeFloat(args.bottomStart ?? 0);
  writer.writeFloat(args.bottomEnd ?? 0);
}

function encodeBackgroundModifierOperation(writer, args = {}) {
  writer.writeByte(55);
  writer.writeInt(args.flags ?? 0);
  writer.writeInt(args.colorId ?? 0);
  writer.writeInt(args.reserve1 ?? 0);
  writer.writeInt(args.reserve2 ?? 0);
  writer.writeFloat(args.r ?? 0);
  writer.writeFloat(args.g ?? 0);
  writer.writeFloat(args.b ?? 0);
  writer.writeFloat(args.a ?? 0);
  writer.writeInt(args.shapeType ?? 0);
}

function encodeDrawOval(writer, args = {}) {
  writer.writeByte(56);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
}

function encodeDrawTextOnCircle(writer, args = {}) {
  writer.writeByte(57);
  writer.writeInt(args.textId ?? 0);
  writer.writeFloat(args.centerX ?? 0);
  writer.writeFloat(args.centerY ?? 0);
  writer.writeFloat(args.radius ?? 0);
  writer.writeFloat(args.startAngle ?? 0);
  writer.writeFloat(args.warpRadiusOffset ?? 0);
  writer.writeInt(args.alignment ?? 0);
  writer.writeInt(args.placement ?? 0);
}

function encodePaddingModifierOperation(writer, args = {}) {
  writer.writeByte(58);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
}

function encodeClickModifier(writer, args = {}) {
  writer.writeByte(59);
}

function encodeTheme(writer, args = {}) {
  writer.writeByte(63);
  writer.writeInt(args.THEME ?? 0);
}

function encodeClickArea(writer, args = {}) {
  writer.writeByte(64);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.contentDescription ?? 0);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
  writer.writeInt(args.metadata ?? 0);
}

function encodeRootContentBehavior(writer, args = {}) {
  writer.writeByte(65);
  writer.writeInt(args.scroll ?? 0);
  writer.writeInt(args.alignment ?? 0);
  writer.writeInt(args.sizing ?? 0);
  writer.writeInt(args.mode ?? 0);
}

function encodeDrawBitmapInt(writer, args = {}) {
  writer.writeByte(66);
  writer.writeInt(args.imageId ?? 0);
  writer.writeInt(args.srcLeft ?? 0);
  writer.writeInt(args.srcTop ?? 0);
  writer.writeInt(args.srcRight ?? 0);
  writer.writeInt(args.srcBottom ?? 0);
  writer.writeInt(args.dstLeft ?? 0);
  writer.writeInt(args.dstTop ?? 0);
  writer.writeInt(args.dstRight ?? 0);
  writer.writeInt(args.dstBottom ?? 0);
  writer.writeInt(args.cdId ?? 0);
}

function encodeHeightModifierOperation(writer, args = {}) {
  writer.writeByte(67);
  writer.writeInt(args.type ?? 0);
  writer.writeFloat(args.value ?? 0);
}

function encodeFloatConstant(writer, args = {}) {
  writer.writeByte(80);
  writer.writeInt(args.id ?? 0);
  writer.writeFloat(args.value ?? 0);
}

function encodeFloatExpression(writer, args = {}) {
  const expr = args.srcExpression ?? args.expression ?? args.value ?? args.bits ?? [];
  const anim = args.animation ?? [];
  const exprLen = expr.length;
  const animLen = anim.length;
  const packed = (exprLen & 0xffff) | ((animLen & 0xffff) << 16);
  writer.writeByte(81);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(packed);
  for (let i = 0; i < exprLen; i++) writer.writeInt(expr[i]);
  for (let i = 0; i < animLen; i++) writer.writeFloat(anim[i]);
}

function encodeMultiClickModifier(writer, args = {}) {
  writer.writeByte(83);
  writer.writeInt(args.clickType ?? 0);
}

function encodeCustom(writer, args = {}) {
  writer.writeByte(93);
  writer.writeInt(args.COMPONENT_ID ?? 0);
  writer.writeInt(args.ANIMATION_ID ?? 0);
  writer.writeInt(args.CONFIG_ID ?? 0);
  writer.writeInt(args.PROPERTIES_COUNT ?? 0);
}

function encodeBitmapData(writer, args = {}) {
  writer.writeByte(101);
  writer.writeInt(args.imageId ?? 0);
  writer.writeInt(args.widthAndType ?? 0);
  writer.writeInt(args.heightAndEncoding ?? 0);
  writer.writeByteArray(args.bitmap ?? []);
}

function encodeTextData(writer, args = {}) {
  writer.writeByte(102);
  writer.writeInt(args.textId ?? 0);
  writer.writeUTF8(args.text ?? '');
}

function encodeRootContentDescription(writer, args = {}) {
  writer.writeByte(103);
  writer.writeInt(args.id ?? 0);
}

function encodeBorderModifierOperation(writer, args = {}) {
  writer.writeByte(107);
  writer.writeInt(args.flags ?? 0);
  writer.writeInt(args.colorId ?? 0);
  writer.writeInt(args.reserve1 ?? 0);
  writer.writeInt(args.reserve2 ?? 0);
  writer.writeFloat(args.borderWidth ?? 0);
  writer.writeFloat(args.roundedCorner ?? 0);
  writer.writeFloat(args.r ?? 0);
  writer.writeFloat(args.g ?? 0);
  writer.writeFloat(args.b ?? 0);
  writer.writeFloat(args.a ?? 0);
  writer.writeInt(args.shapeType ?? 0);
}

function encodeClipRectModifierOperation(writer, args = {}) {
  writer.writeByte(108);
}

function encodePathData(writer, args = {}) {
  writer.writeByte(123);
  writer.writeInt(args.idAndWinding ?? 0);
  writer.writeInt(args.length ?? 0);
  writer.writeFloatArray(args.pathData ?? []);
}

function encodeDrawPath(writer, args = {}) {
  writer.writeByte(124);
  writer.writeInt(args.id ?? 0);
}

function encodeDrawTweenPath(writer, args = {}) {
  writer.writeByte(125);
  writer.writeInt(args.path1Id ?? 0);
  writer.writeInt(args.path2Id ?? 0);
  writer.writeFloat(args.tween ?? 0);
  writer.writeFloat(args.start ?? 0);
  writer.writeFloat(args.stop ?? 0);
}

function encodeMatrixScale(writer, args = {}) {
  writer.writeByte(126);
  writer.writeFloat(args.scaleX ?? 0);
  writer.writeFloat(args.scaleY ?? 0);
  writer.writeFloat(args.pivotX ?? 0);
  writer.writeFloat(args.pivotY ?? 0);
}

function encodeMatrixTranslate(writer, args = {}) {
  writer.writeByte(127);
  writer.writeFloat(args.dx ?? 0);
  writer.writeFloat(args.dy ?? 0);
}

function encodeMatrixSkew(writer, args = {}) {
  writer.writeByte(128);
  writer.writeFloat(args.skewX ?? 0);
  writer.writeFloat(args.skewY ?? 0);
}

function encodeMatrixRotate(writer, args = {}) {
  writer.writeByte(129);
  writer.writeFloat(args.rotate ?? 0);
  writer.writeFloat(args.pivotX ?? 0);
  writer.writeFloat(args.pivotY ?? 0);
}

function encodeMatrixSave(writer, args = {}) {
  writer.writeByte(130);
}

function encodeMatrixRestore(writer, args = {}) {
  writer.writeByte(131);
}

function encodeDrawTextAnchored(writer, args = {}) {
  writer.writeByte(133);
  writer.writeInt(args.textId ?? 0);
  writer.writeFloat(args.x ?? 0);
  writer.writeFloat(args.y ?? 0);
  writer.writeFloat(args.panX ?? 0);
  writer.writeFloat(args.panY ?? 0);
  writer.writeInt(args.flags ?? 0);
}

function encodeColorExpression(writer, args = {}) {
  writer.writeByte(134);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.mode ?? 0);
  writer.writeInt(args.color1 ?? 0);
  writer.writeInt(args.color2 ?? 0);
  writer.writeFloat(args.tween ?? 0);
}

function encodeTextFromFloat(writer, args = {}) {
  writer.writeByte(135);
  writer.writeInt(args.id ?? 0);
  writer.writeFloat(args.value ?? 0);
  writer.writeShort(args.digitsBefore ?? 0);
  writer.writeShort(args.digitsAfter ?? 0);
  writer.writeInt(args.flags ?? 0);
}

function encodeTextMerge(writer, args = {}) {
  writer.writeByte(136);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.srcId1 ?? 0);
  writer.writeInt(args.srcId2 ?? 0);
}

function encodeNamedVariable(writer, args = {}) {
  writer.writeByte(137);
  writer.writeInt(args.varId ?? 0);
  writer.writeInt(args.varType ?? 0);
  writer.writeUTF8(args.name ?? '');
}

function encodeColorConstant(writer, args = {}) {
  writer.writeByte(138);
  writer.writeInt(args.colorId ?? 0);
  writer.writeInt(args.color ?? 0);
}

function encodeDrawContent(writer, args = {}) {
  writer.writeByte(139);
}

function encodeIntegerConstant(writer, args = {}) {
  writer.writeByte(140);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.value ?? 0);
}

function encodePlaySound(writer, args = {}) {
  writer.writeByte(141);
  writer.writeInt(args.soundExpressionId ?? 0);
}

function encodeReferencedOperations(writer, args = {}) {
  writer.writeByte(142);
  writer.writeInt(args.id ?? 0);
}

function encodeBooleanConstant(writer, args = {}) {
  writer.writeByte(143);
  writer.writeInt(args.id ?? 0);
  writer.writeBoolean(args.value ?? false);
}

function encodeIntegerExpression(writer, args = {}) {
  writer.writeByte(144);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.mask ?? 0);
  writer.writeIntArray(args.value ?? []);
}

function encodeDataMapIds(writer, args = {}) {
  writer.writeByte(145);
  writer.writeInt(args.id ?? 0);
  writer.writeStringArray(args.keys ?? []);
  writer.writeByteArray(args.types ?? []);
  writer.writeIntArray(args.values ?? []);
}

function encodeIdListData(writer, args = {}) {
  writer.writeByte(146);
  writer.writeInt(args.id ?? 0);
  writer.writeIntArray(args.ids ?? []);
}

function encodeFloatListData(writer, args = {}) {
  writer.writeByte(147);
  writer.writeInt(args.id ?? 0);
  writer.writeFloatArray(args.value ?? []);
}

function encodeLongConstant(writer, args = {}) {
  writer.writeByte(148);
  writer.writeInt(args.id ?? 0);
  writer.writeLong(args.value ?? 0);
}

function encodeDrawBitmapScaled(writer, args = {}) {
  writer.writeByte(149);
  writer.writeInt(args.imageId ?? 0);
  writer.writeFloat(args.srcLeft ?? 0);
  writer.writeFloat(args.srcTop ?? 0);
  writer.writeFloat(args.srcRight ?? 0);
  writer.writeFloat(args.srcBottom ?? 0);
  writer.writeFloat(args.dstLeft ?? 0);
  writer.writeFloat(args.dstTop ?? 0);
  writer.writeFloat(args.dstRight ?? 0);
  writer.writeFloat(args.dstBottom ?? 0);
  writer.writeInt(args.scaleType ?? 0);
  writer.writeFloat(args.scaleFactor ?? 0);
  writer.writeInt(args.cdId ?? 0);
}

function encodeComponentValue(writer, args = {}) {
  writer.writeByte(150);
  writer.writeInt(args.type ?? 0);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.valueId ?? 0);
}

function encodeTextLookup(writer, args = {}) {
  writer.writeByte(151);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.dataSetId ?? 0);
  writer.writeFloat(args.index ?? 0);
}

function encodeDrawArc(writer, args = {}) {
  writer.writeByte(152);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
  writer.writeFloat(args.startAngle ?? 0);
  writer.writeFloat(args.sweepAngle ?? 0);
}

function encodeTextLookupInt(writer, args = {}) {
  writer.writeByte(153);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.dataSetId ?? 0);
  writer.writeInt(args.indexId ?? 0);
}

function encodeDataMapLookup(writer, args = {}) {
  writer.writeByte(154);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.dataMapId ?? 0);
  writer.writeInt(args.stringId ?? 0);
}

function encodeTextMeasure(writer, args = {}) {
  writer.writeByte(155);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.type ?? 0);
}

function encodeTextLength(writer, args = {}) {
  writer.writeByte(156);
  writer.writeInt(args.lengthId ?? 0);
  writer.writeInt(args.textId ?? 0);
}

function encodeTouchExpression(writer, args = {}) {
  writer.writeByte(157);
  writer.writeInt(args.id ?? 0);
  writer.writeFloat(args.value ?? 0);
  writer.writeFloat(args.min ?? 0);
  writer.writeFloat(args.max ?? 0);
  writer.writeFloat(args.velocityId ?? 0);
  writer.writeInt(args.touchEffects ?? 0);
  writer.writeFloatArray(args.exp ?? []);
  writer.writeInt(args.touchMode ?? 0);
  writer.writeFloatArray(args.touchSpec ?? []);
  writer.writeFloatArray(args.easingSpec ?? []);
}

function encodePathTween(writer, args = {}) {
  writer.writeByte(158);
  writer.writeInt(args.outId ?? 0);
  writer.writeInt(args.pathId1 ?? 0);
  writer.writeInt(args.pathId2 ?? 0);
  writer.writeFloat(args.tween ?? 0);
}

function encodePathCreate(writer, args = {}) {
  writer.writeByte(159);
  writer.writeInt(args.id ?? 0);
  writer.writeFloat(args.startX ?? 0);
  writer.writeFloat(args.startY ?? 0);
}

function encodePathAppend(writer, args = {}) {
  writer.writeByte(160);
  writer.writeInt(args.id ?? 0);
  writer.writeFloatArray(args.data ?? []);
}

function encodeParticlesCreate(writer, args = {}) {
  writer.writeByte(161);
  writer.writeInt(args.id ?? 0);
  writer.writeIntArray(args.particleIds ?? []);
  writer.writeInt(0);
  writer.writeInt(args.flags ?? 0);
}

function encodeParticlesLoop(writer, args = {}) {
  writer.writeByte(163);
  writer.writeInt(args.id ?? 0);
  writer.writeFloatArray(args.params ?? []);
  writer.writeInt(0);
}

function encodeImpulseOperation(writer, args = {}) {
  writer.writeByte(164);
  writer.writeFloat(args.duration ?? 0);
  writer.writeFloat(args.startAt ?? 0);
}

function encodeImpulseProcess(writer, args = {}) {
  writer.writeByte(165);
}

function encodeFunctionCall(writer, args = {}) {
  writer.writeByte(166);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.argLen ?? 0);
  writer.writeFloatArray(args.values ?? []);
}

function encodeBitmapFontData(writer, args = {}) {
  writer.writeByte(167);
  writer.writeInt(args.fontId ?? 0);
  writer.writeInt(0);
  writer.writeInt(0);
}

function encodeFunctionDefine(writer, args = {}) {
  writer.writeByte(168);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.varLen ?? 0);
  writer.writeIntArray(args.varId ?? []);
}

function encodeSoundData(writer, args = {}) {
  writer.writeByte(169);
  writer.writeInt(args.soundId ?? 0);
  writer.writeByteArray(args.data ?? []);
}

function encodeTextAttribute(writer, args = {}) {
  writer.writeByte(170);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.textId ?? 0);
  writer.writeShort(args.type ?? 0);
}

function encodeImageAttribute(writer, args = {}) {
  writer.writeByte(171);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.imageId ?? 0);
  writer.writeShort(args.type ?? 0);
  writer.writeIntArray(args.params ?? []);
}

function encodeTimeAttribute(writer, args = {}) {
  writer.writeByte(172);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.timeId ?? 0);
  writer.writeShort(args.type ?? 0);
  writer.writeIntArray(args.params ?? []);
}

function encodeCanvasOperations(writer, args = {}) {
  writer.writeByte(173);
}

function encodeDrawContentOperation(writer, args = {}) {
  writer.writeByte(174);
}

function encodePathCombine(writer, args = {}) {
  writer.writeByte(175);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.path1 ?? 0);
  writer.writeInt(args.path2 ?? 0);
  writer.writeByte(args.mode ?? 0);
}

function encodeFitBoxLayout(writer, args = {}) {
  writer.writeByte(176);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
}

function encodeHapticFeedback(writer, args = {}) {
  writer.writeByte(177);
  writer.writeInt(args.hapticFeedbackType ?? 0);
}

function encodeConditionalOperations(writer, args = {}) {
  writer.writeByte(178);
  writer.writeByte(args.condition ?? 0);
  writer.writeFloat(args.v1 ?? 0);
  writer.writeFloat(args.v2 ?? 0);
}

function encodeDebugMessage(writer, args = {}) {
  writer.writeByte(179);
  writer.writeInt(args.textId ?? 0);
  writer.writeFloat(args.value ?? 0);
  writer.writeInt(args.flags ?? 0);
}

function encodeColorAttribute(writer, args = {}) {
  writer.writeByte(180);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.colorId ?? 0);
  writer.writeShort(args.type ?? 0);
}

function encodeMatrixFromPath(writer, args = {}) {
  writer.writeByte(181);
  writer.writeInt(args.pathId ?? 0);
  writer.writeFloat(args.percent ?? 0);
  writer.writeFloat(args.vOffset ?? 0);
  writer.writeInt(args.flags ?? 0);
}

function encodeTextSubtext(writer, args = {}) {
  writer.writeByte(182);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.srcId1 ?? 0);
  writer.writeFloat(args.start ?? 0);
  writer.writeFloat(args.len ?? 0);
}

function encodeBitmapTextMeasure(writer, args = {}) {
  writer.writeByte(183);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.bitmapFontId ?? 0);
  writer.writeInt(args.start ?? 0);
  writer.writeInt(args.end ?? 0);
  writer.writeFloat(args.glyphSpacing ?? 0);
}

function encodeDrawBitmapTextAnchored(writer, args = {}) {
  writer.writeByte(184);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.bitmapFontID ?? 0);
  writer.writeFloat(args.start ?? 0);
  writer.writeFloat(args.end ?? 0);
  writer.writeFloat(args.x ?? 0);
  writer.writeFloat(args.y ?? 0);
  writer.writeFloat(args.panX ?? 0);
  writer.writeFloat(args.panY ?? 0);
}

function encodeRem(writer, args = {}) {
  writer.writeByte(185);
  writer.writeUTF8(args.text ?? '');
}

function encodeMatrixConstant(writer, args = {}) {
  writer.writeByte(186);
  writer.writeInt(args.matrixId ?? 0);
  writer.writeInt(args.type ?? 0);
  writer.writeFloatArray(args.values ?? []);
}

function encodeMatrixExpression(writer, args = {}) {
  writer.writeByte(187);
  writer.writeInt(args.matrixId ?? 0);
  writer.writeInt(args.type ?? 0);
  writer.writeFloatArray(args.expression ?? []);
}

function encodeMatrixVectorMath(writer, args = {}) {
  writer.writeByte(188);
  writer.writeShort(args.type ?? 0);
  writer.writeIntArray(args.outputs ?? []);
  writer.writeInt(args.matrixId ?? 0);
  writer.writeFloatArray(args.inputs ?? []);
}

function encodeFontData(writer, args = {}) {
  writer.writeByte(189);
  writer.writeInt(args.fontId ?? 0);
  writer.writeInt(args.type ?? 0);
  writer.writeByteArray(args.fontData ?? []);
}

function encodeDrawToBitmap(writer, args = {}) {
  writer.writeByte(190);
  writer.writeInt(args.bitmapId ?? 0);
  writer.writeInt(args.mode ?? 0);
  writer.writeInt(args.color ?? 0);
}

function encodeWakeIn(writer, args = {}) {
  writer.writeByte(191);
  writer.writeFloat(args.wake ?? 0);
}

function encodeIdLookup(writer, args = {}) {
  writer.writeByte(192);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.lookupId ?? 0);
  writer.writeFloat(args.value ?? 0);
}

function encodePathExpression(writer, args = {}) {
  writer.writeByte(193);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.flags ?? 0);
  writer.writeFloat(args.min ?? 0);
  writer.writeFloat(args.max ?? 0);
  writer.writeFloat(args.count ?? 0);
  writer.writeInt(args.lenX ?? 0);
  writer.writeFloatArray(args.expressionX ?? []);
  writer.writeInt(args.lenY ?? 0);
  writer.writeFloatArray(args.expressionY ?? []);
}

function encodeParticlesCompare(writer, args = {}) {
  writer.writeByte(194);
  writer.writeInt(args.id ?? 0);
  writer.writeShort(args.compOp ?? 0);
  writer.writeFloat(args.val1 ?? 0);
  writer.writeFloat(args.val2 ?? 0);
  writer.writeFloatArray(args.array1 ?? []);
  writer.writeInt(0);
  writer.writeInt(0);
}

function encodeColorTheme(writer, args = {}) {
  writer.writeByte(196);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.groupId ?? 0);
  writer.writeShort(args.lightMode ?? 0);
  writer.writeShort(args.darkMode ?? 0);
  writer.writeInt(args.lightModeFallback ?? 0);
  writer.writeInt(args.darkModeFallback ?? 0);
}

function encodeDataDynamicListFloat(writer, args = {}) {
  writer.writeByte(197);
  writer.writeInt(args.id ?? 0);
  writer.writeFloat(args.length ?? 0);
}

function encodeUpdateDynamicFloatList(writer, args = {}) {
  writer.writeByte(198);
  writer.writeInt(args.arrayId ?? 0);
  writer.writeFloat(args.index ?? 0);
  writer.writeFloat(args.value ?? 0);
}

function encodeTextTransform(writer, args = {}) {
  writer.writeByte(199);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.srcId1 ?? 0);
  writer.writeFloat(args.start ?? 0);
  writer.writeFloat(args.len ?? 0);
  writer.writeInt(args.operation ?? 0);
}

function encodeRootLayout(writer, args = {}) {
  writer.writeByte(200);
  writer.writeInt(args.componentId ?? 0);
}

function encodeLayoutContent(writer, args = {}) {
  writer.writeByte(201);
  writer.writeInt(args.componentId ?? 0);
}

function encodeBoxLayout(writer, args = {}) {
  writer.writeByte(202);
  writer.writeInt(args.COMPONENT_ID ?? 0);
  writer.writeInt(args.ANIMATION_ID ?? 0);
  writer.writeInt(args.HORIZONTAL_POSITIONING ?? 0);
  writer.writeInt(args.VERTICAL_POSITIONING ?? 0);
}

function encodeRowLayout(writer, args = {}) {
  writer.writeByte(203);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeFloat(args.spacedBy ?? 0);
}

function encodeColumnLayout(writer, args = {}) {
  writer.writeByte(204);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeFloat(args.spacedBy ?? 0);
}

function encodeCanvasLayout(writer, args = {}) {
  writer.writeByte(205);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
}

function encodeSoundExpression(writer, args = {}) {
  writer.writeByte(206);
  writer.writeInt(args.id ?? 0);
  writer.writeFloat(args.leftVolume ?? 0);
  writer.writeFloat(args.rightVolume ?? 0);
  writer.writeFloat(args.rate ?? 0);
  writer.writeInt(args.paramsLength ?? 0);
  writer.writeFloatArray(args.params ?? []);
}

function encodeCanvasContent(writer, args = {}) {
  writer.writeByte(207);
  writer.writeInt(args.COMPONENT_ID ?? 0);
}

function encodeTextLayout(writer, args = {}) {
  writer.writeByte(208);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.color ?? 0);
  writer.writeFloat(args.fontSize ?? 0);
  writer.writeInt(args.fontStyle ?? 0);
  writer.writeFloat(args.fontWeight ?? 0);
  writer.writeInt(args.fontFamilyId ?? 0);
  writer.writeInt(args.textAlign ?? 0);
  writer.writeInt(args.overflow ?? 0);
  writer.writeInt(args.maxLines ?? 0);
}

function encodeHostAction(writer, args = {}) {
  writer.writeByte(209);
  writer.writeInt(args.ACTION_ID ?? 0);
}

function encodeHostNamedAction(writer, args = {}) {
  writer.writeByte(210);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.type ?? 0);
  writer.writeInt(args.valueId ?? 0);
}

function encodeComponentVisibilityOperation(writer, args = {}) {
  writer.writeByte(211);
  writer.writeInt(args.visibilityId ?? 0);
}

function encodeValueIntegerChangeActionOperation(writer, args = {}) {
  writer.writeByte(212);
  writer.writeInt(args.targetValueId ?? 0);
  writer.writeInt(args.value ?? 0);
}

function encodeValueStringChangeActionOperation(writer, args = {}) {
  writer.writeByte(213);
  writer.writeInt(args.targetValueId ?? 0);
  writer.writeInt(args.valueId ?? 0);
}

function encodeContainerEnd(writer, args = {}) {
  writer.writeByte(214);
}

function encodeLoop(writer, args = {}) {
  writer.writeByte(215);
  writer.writeInt(args.indexId ?? 0);
  writer.writeFloat(args.from ?? 0);
  writer.writeFloat(args.step ?? 0);
  writer.writeFloat(args.until ?? 0);
}

function encodeHostActionMetadata(writer, args = {}) {
  writer.writeByte(216);
  writer.writeInt(args.ACTION_ID ?? 0);
  writer.writeInt(args.METADATA ?? 0);
}

function encodeStateLayout(writer, args = {}) {
  writer.writeByte(217);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeInt(args.indexId ?? 0);
}

function encodeValueIntegerExpressionChangeActionOperation(writer, args = {}) {
  writer.writeByte(218);
  writer.writeLong(args.targetValueId ?? 0);
  writer.writeLong(args.valueExpressionId ?? 0);
}

function encodeTouchModifier(writer, args = {}) {
  writer.writeByte(219);
}

function encodeTouchUpModifier(writer, args = {}) {
  writer.writeByte(220);
}

function encodeOffsetModifierOperation(writer, args = {}) {
  writer.writeByte(221);
  writer.writeFloat(args.x ?? 0);
  writer.writeFloat(args.y ?? 0);
}

function encodeValueFloatChangeActionOperation(writer, args = {}) {
  writer.writeByte(222);
  writer.writeInt(args.targetValueId ?? 0);
  writer.writeFloat(args.value ?? 0);
}

function encodeZIndexModifierOperation(writer, args = {}) {
  writer.writeByte(223);
  writer.writeFloat(args.value ?? 0);
}

function encodeGraphicsLayerModifierOperation(writer, args = {}) {
  writer.writeByte(224);
  writer.writeInt(0);
}

function encodeTouchCancelModifier(writer, args = {}) {
  writer.writeByte(225);
}

function encodeScrollModifierOperation(writer, args = {}) {
  writer.writeByte(226);
  writer.writeInt(args.direction ?? 0);
  writer.writeFloat(args.position ?? 0);
  writer.writeFloat(args.max ?? 0);
  writer.writeFloat(args.notchMax ?? 0);
}

function encodeValueFloatExpressionChangeActionOperation(writer, args = {}) {
  writer.writeByte(227);
  writer.writeInt(args.targetValueId ?? 0);
  writer.writeInt(args.valueExpressionId ?? 0);
}

function encodeMarqueeModifierOperation(writer, args = {}) {
  writer.writeByte(228);
  writer.writeInt(args.iterations ?? 0);
  writer.writeInt(args.animationMode ?? 0);
  writer.writeFloat(args.repeatDelayMillis ?? 0);
  writer.writeFloat(args.initialDelayMillis ?? 0);
  writer.writeFloat(args.spacing ?? 0);
  writer.writeFloat(args.velocity ?? 0);
}

function encodeRippleModifier(writer, args = {}) {
  writer.writeByte(229);
}

function encodeCollapsibleRow(writer, args = {}) {
  writer.writeByte(230);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeFloat(args.spacedBy ?? 0);
}

function encodeWidthInModifierOperation(writer, args = {}) {
  writer.writeByte(231);
  writer.writeFloat(args.min ?? 0);
  writer.writeFloat(args.max ?? 0);
}

function encodeHeightInModifierOperation(writer, args = {}) {
  writer.writeByte(232);
  writer.writeFloat(args.min ?? 0);
  writer.writeFloat(args.max ?? 0);
}

function encodeCollapsibleColumn(writer, args = {}) {
  writer.writeByte(233);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeFloat(args.spacedBy ?? 0);
}

function encodeImageLayout(writer, args = {}) {
  writer.writeByte(234);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.bitmapId ?? 0);
  writer.writeInt(args.scaleType ?? 0);
  writer.writeFloat(args.alpha ?? 0);
}

function encodeCollapsiblePriorityModifierOperation(writer, args = {}) {
  writer.writeByte(235);
  writer.writeInt(args.orientation ?? 0);
  writer.writeFloat(args.priority ?? 0);
}

function encodeRunAction(writer, args = {}) {
  writer.writeByte(236);
}

function encodeAlignByModifierOperation(writer, args = {}) {
  writer.writeByte(237);
  writer.writeFloat(args.line ?? 0);
  writer.writeInt(args.flags ?? 0);
}

function encodeLayoutCompute(writer, args = {}) {
  writer.writeByte(238);
  writer.writeInt(args.type ?? 0);
  writer.writeInt(args.boundsId ?? 0);
  writer.writeBoolean(args.animateChanges ?? false);
}

function encodeCoreText(writer, args = {}) {
  writer.writeByte(239);
}

function encodeFlowLayout(writer, args = {}) {
  writer.writeByte(240);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeFloat(args.spacedBy ?? 0);
  writer.writeInt(args.maxItemsInEachRow ?? 0);
  writer.writeInt(args.maxLines ?? 0);
}

function encodeSkip(writer, args = {}) {
  writer.writeByte(241);
  writer.writeShort(args.Condition ?? 0);
  writer.writeInt(args.Value ?? 0);
  writer.writeInt(args.Length ?? 0);
}

function encodeTextStyle(writer, args = {}) {
  writer.writeByte(242);
}

function encodeDimensionConstraintsModifierOperation(writer, args = {}) {
  writer.writeByte(243);
  writer.writeByte(args.type ?? 0);
  writer.writeFloat(args.min ?? 0);
  writer.writeFloat(args.max ?? 0);
}

function encodePatternForEach(writer, args = {}) {
  writer.writeByte(244);
  writer.writeInt(args.collectionId ?? 0);
  writer.writeInt(args.localItemId ?? 0);
  writer.writeInt(args.skipLength ?? 0);
}

function encodeIncludeReferencedOperations(writer, args = {}) {
  writer.writeByte(245);
  writer.writeInt(args.ID ?? 0);
}

function encodePatternDefine(writer, args = {}) {
  writer.writeByte(246);
  writer.writeInt(args.id ?? 0);
  writer.writeIntArray(args.paramIds ?? []);
  writer.writeInt(args.skipLength ?? 0);
}

function encodePatternInflation(writer, args = {}) {
  writer.writeByte(247);
  writer.writeInt(args.id ?? 0);
  writer.writeIntArray(args.argIds ?? []);
}

function encodePatternArgument(writer, args = {}) {
  writer.writeByte(248);
  writer.writeInt(args.paramIndex ?? 0);
}

function encodePatternBlock(writer, args = {}) {
  writer.writeByte(249);
  writer.writeInt(args.paramIndex ?? 0);
}

function encodeCoreSemantics(writer, args = {}) {
  writer.writeByte(250);
  writer.writeInt(args.contentDescriptionId ?? 0);
  writer.writeInt(args.role ?? 0);
  writer.writeBoolean(args.clickable ?? false);
}

function encodeExtensionRangeReserved4(writer, args = {}) {
  writer.writeByte(251);
}

function encodeExtensionRangeReserved3(writer, args = {}) {
  writer.writeByte(252);
}

function encodeExtensionRangeReserved2(writer, args = {}) {
  writer.writeByte(253);
}

function encodeExtensionRangeReserved1(writer, args = {}) {
  writer.writeByte(254);
}

function encodeExtendedOpcode(writer, args = {}) {
  writer.writeByte(255);
}

class RemoteComposeSerializer {
  constructor() {
    this.varRegistry = new Map();
    this.nextVarId = 1;
    this.autoId = -1;
  }

  nextComponentId() {
    this.autoId--;
    return this.autoId;
  }

  resolveFloatValue(val) {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const cleaned = val.replace(/^[@$]/, '').replace('vars.', '');
      let varId = this.varRegistry.get(cleaned);
      if (!varId) {
        varId = this.nextVarId++;
        this.varRegistry.set(cleaned, varId);
      }
      const bits = (varId & 0x00ffffff) | 0xff800000;
      const view = new DataView(new ArrayBuffer(4));
      view.setInt32(0, bits, false);
      return view.getFloat32(0, false);
    }
    return 0;
  }

  resolvePathId(pathObj, writer) {
    if (typeof pathObj === 'number') return pathObj;
    if (typeof pathObj === 'string') {
      const pathId = this.nextVarId++;
      const floats = parseSvgPathToFloats(pathObj);
      encodePathData(writer, { idAndWinding: pathId, floatPath: floats });
      return pathId;
    }
    return 1;
  }

  serialize(doc) {
    const json = typeof doc === 'string' ? JSON.parse(doc) : doc;
    const writer = new WireBufferWriter();

    this.varRegistry.clear();
    this.nextVarId = 1;
    this.autoId = -1;

    // Pass 1: Header (Opcode 0) - MUST BE AT OFFSET 0!
    const header = json.header || {};
    encodeHeader(writer, {
      width: header.width ?? 400,
      height: header.height ?? 400,
      density: 1.0,
      capabilities: BigInt(header.profiles ?? 771),
    });

    // Pass 2: Global Resource & Variable Scan (Opcodes after Header)
    this.scanResources(json, writer);

    // Pass 3: Root Layout (Opcode 200)
    const rootId = this.nextComponentId();
    writer.writeByte(200);
    writer.writeInt(rootId);

    // Component Hierarchy & Canvas Commands
    if (json.root) {
      this.compileComponent(json.root, writer);
    }

    // Root ContainerEnd (Opcode 214)
    encodeContainerEnd(writer);

    return writer.toUint8Array();
  }

  serializeToBase64(doc) {
    const bytes = this.serialize(doc);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  }

  scanResources(json, writer) {
    const processVar = (v) => {
      if (typeof v === 'object' && v && v.name && v.value !== undefined) {
        if (!this.varRegistry.has(v.name)) {
          const varId = this.nextVarId++;
          this.varRegistry.set(v.name, varId);
          if (typeof v.value === 'string' && /[a-zA-Z_()]/.test(v.value)) {
            const bits = ExpressionCompiler.compileToBits(v.value);
            encodeFloatExpression(writer, { id: varId, srcExpression: bits });
          } else if (typeof v.value === 'number') {
            encodeFloatConstant(writer, { id: varId, value: v.value });
          }
        }
      }
    };

    const traverse = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.variable) processVar(obj.variable);
      if (obj.type === 'variable' || obj.variableName) processVar(obj);
      if (Array.isArray(obj)) {
        for (const item of obj) traverse(item);
      } else {
        for (const key of Object.keys(obj)) {
          traverse(obj[key]);
        }
      }
    };

    if (json.resources && Array.isArray(json.resources.variables)) {
      for (const v of json.resources.variables) processVar(v);
    }
    traverse(json.root);
  }

  compileComponent(node, writer) {
    let rawType = node.type || 'box';
    if (!node.type) {
      const keys = Object.keys(node);
      for (const k of keys) {
        if (['box', 'column', 'row', 'flow', 'fitbox', 'fitBox', 'text', 'coretext', 'coreText', 'canvas', 'spacer', 'bitmap', 'global', 'custom'].includes(k)) {
          rawType = k;
          break;
        }
      }
    }
    const type = rawType.toLowerCase();

    if (type === 'coretext' || type === 'text' || node.coretext || node.text) {
      const textNode = node.coretext || node.text || node;
      const textStr = typeof textNode === 'string' ? textNode : (textNode.text || '');
      const textId = this.nextVarId++;
      encodeTextData(writer, { textId, text: textStr });
      encodeDrawText(writer, {
        textId,
        color: parseColor(textNode.color || '#38bdf8'),
        textSize: textNode.textSize || 18,
      });
      return;
    }

    if (type === 'canvas' || node.canvas) {
      const canvasId = this.nextComponentId();
      writer.writeByte(205); // CanvasLayout Opcode 205
      writer.writeInt(canvasId);
      writer.writeInt(-1);   // animId

      const modifiers = node.modifiers || (node.canvas && node.canvas.modifiers);
      if (Array.isArray(modifiers)) {
        for (const mod of modifiers) this.compileModifier(mod, writer);
      }

      writer.writeByte(201); // LayoutComponentContent Opcode 201
      writer.writeInt(this.nextComponentId());

      writer.writeByte(207); // CanvasContent Opcode 207
      writer.writeInt(this.nextComponentId());

      const commands = node.commands || (node.canvas && node.canvas.commands);
      if (Array.isArray(commands)) {
        for (const cmd of commands) this.compileCanvasCommand(cmd, writer);
      }

      encodeContainerEnd(writer);
      encodeContainerEnd(writer);
      encodeContainerEnd(writer);
      return;
    }

    if (type === 'column' || type === 'columnlayout') {
      writer.writeByte(204); // ColumnLayout Opcode 204
      writer.writeInt(this.nextComponentId());
      writer.writeInt(-1);
      writer.writeInt(0);
      writer.writeInt(0);
      writer.writeFloat(0);
    } else if (type === 'row' || type === 'rowlayout') {
      writer.writeByte(203); // RowLayout Opcode 203
      writer.writeInt(this.nextComponentId());
      writer.writeInt(-1);
      writer.writeInt(0);
      writer.writeInt(0);
      writer.writeFloat(0);
    } else {
      writer.writeByte(202); // BoxLayout Opcode 202
      writer.writeInt(this.nextComponentId());
      writer.writeInt(-1);
      writer.writeInt(0);
      writer.writeInt(0);
    }

    const modifiers = node.modifiers || (node[rawType] && node[rawType].modifiers);
    if (Array.isArray(modifiers)) {
      for (const mod of modifiers) this.compileModifier(mod, writer);
    }

    writer.writeByte(201); // LayoutContent Opcode 201
    writer.writeInt(this.nextComponentId());

    const children = node.children || (node[rawType] && node[rawType].children);
    if (Array.isArray(children)) {
      for (const child of children) this.compileComponent(child, writer);
    }

    encodeContainerEnd(writer);
    encodeContainerEnd(writer);
  }

  compileModifier(mod, writer) {
    if (typeof mod === 'string') {
      if (mod === 'fillMaxWidth') encodeWidthModifierOperation(writer, { type: 1, value: NaN });
      else if (mod === 'fillMaxHeight') encodeHeightModifierOperation(writer, { type: 1, value: NaN });
      else if (mod === 'fillMaxSize') {
        encodeWidthModifierOperation(writer, { type: 1, value: NaN });
        encodeHeightModifierOperation(writer, { type: 1, value: NaN });
      }
      return;
    }

    const mType = (mod.type || '').toLowerCase();
    if (mType === 'padding' || mod.padding !== undefined) {
      let p = mod.padding;
      let l = mod.l ?? mod.left ?? mod.all ?? (typeof p === 'number' ? p : 0);
      let t = mod.t ?? mod.top ?? mod.all ?? (typeof p === 'number' ? p : 0);
      let r = mod.r ?? mod.right ?? mod.all ?? (typeof p === 'number' ? p : 0);
      let b = mod.b ?? mod.bottom ?? mod.all ?? (typeof p === 'number' ? p : 0);
      encodePaddingModifierOperation(writer, { left: l, top: t, right: r, bottom: b });
    } else if (mType === 'background' || mod.background !== undefined) {
      const colorVal = mod.c ?? mod.color ?? mod.background;
      const colorInt = (typeof colorVal === 'object' && colorVal && colorVal.$ref) ? 0xff0f172a : parseColor(colorVal || '#000000');
      const a = (colorInt >>> 24) & 0xff;
      const r = (colorInt >>> 16) & 0xff;
      const g = (colorInt >>> 8) & 0xff;
      const b = colorInt & 0xff;
      encodeBackgroundModifierOperation(writer, { flags: 0, colorId: 0, reserve1: 0, reserve2: 0, r, g, b, a, shapeType: 0 });
    } else if (mType === 'width' || mod.width !== undefined) {
      const v = mod.v ?? mod.width ?? mod.val;
      if (v === 'FILL') encodeWidthModifierOperation(writer, { type: 1, value: NaN });
      else encodeWidthModifierOperation(writer, { type: 0, value: Number(v) });
    } else if (mType === 'height' || mod.height !== undefined) {
      const v = mod.v ?? mod.height ?? mod.val;
      if (v === 'FILL') encodeHeightModifierOperation(writer, { type: 1, value: NaN });
      else encodeHeightModifierOperation(writer, { type: 0, value: Number(v) });
    } else if (mType === 'border' || mod.border !== undefined) {
      const bObj = mod.border || mod;
      const colorVal = bObj.color ?? '#000000';
      const colorInt = parseColor(colorVal);
      const a = ((colorInt >>> 24) & 0xff) / 255;
      const r = ((colorInt >>> 16) & 0xff) / 255;
      const g = ((colorInt >>> 8) & 0xff) / 255;
      const b = (colorInt & 0xff) / 255;
      encodeBorderModifierOperation(writer, {
        flags: 0,
        colorId: 0,
        reserve1: 0,
        reserve2: 0,
        r, g, b, a,
        borderWidth: bObj.width ?? 1,
        cornerRadius: bObj.cornerRadius ?? 0,
        shapeType: 0
      });
    } else if (mType === 'click' || mod.click !== undefined) {
      const cId = mod.id ?? (mod.click && mod.click.id) ?? 0;
      encodeClickModifier(writer, { id: cId });
      encodeContainerEnd(writer);
    }
  }

  compileCanvasCommand(cmd, writer) {
    if (cmd.variable) {
      // Variables are compiled in scanResources
      return;
    }
    if (cmd.setColor) {
      writePaintBundle(writer, { color: cmd.setColor.color });
    } else if (cmd.setStrokeWidth) {
      writePaintBundle(writer, { strokeWidth: cmd.setStrokeWidth.width ?? cmd.setStrokeWidth.strokeWidth });
    } else if (cmd.setStyle) {
      writePaintBundle(writer, { style: cmd.setStyle.style });
    } else if (cmd.setPaint || cmd.paintData || cmd.paint) {
      const p = cmd.setPaint || cmd.paintData || cmd.paint;
      writePaintBundle(writer, p);
    } else if (cmd.drawCircle) {
      encodeDrawCircle(writer, {
        centerX: this.resolveFloatValue(cmd.drawCircle.centerX ?? cmd.drawCircle.cx ?? cmd.drawCircle.x ?? 0),
        centerY: this.resolveFloatValue(cmd.drawCircle.centerY ?? cmd.drawCircle.cy ?? cmd.drawCircle.y ?? 0),
        radius: this.resolveFloatValue(cmd.drawCircle.radius ?? cmd.drawCircle.r ?? 10)
      });
    } else if (cmd.drawRect) {
      encodeDrawRect(writer, {
        left: this.resolveFloatValue(cmd.drawRect.left ?? cmd.drawRect.x ?? 0),
        top: this.resolveFloatValue(cmd.drawRect.top ?? cmd.drawRect.y ?? 0),
        right: this.resolveFloatValue(cmd.drawRect.right ?? (cmd.drawRect.width ? cmd.drawRect.left + cmd.drawRect.width : 100)),
        bottom: this.resolveFloatValue(cmd.drawRect.bottom ?? (cmd.drawRect.height ? cmd.drawRect.top + cmd.drawRect.height : 100))
      });
    } else if (cmd.drawRoundRect || cmd.draw_round_rect) {
      const rr = cmd.drawRoundRect || cmd.draw_round_rect;
      encodeDrawRoundRect(writer, {
        left: this.resolveFloatValue(rr.left ?? rr.x ?? 0),
        top: this.resolveFloatValue(rr.top ?? rr.y ?? 0),
        right: this.resolveFloatValue(rr.right ?? (rr.width ? rr.left + rr.width : 100)),
        bottom: this.resolveFloatValue(rr.bottom ?? (rr.height ? rr.top + rr.height : 100)),
        rx: this.resolveFloatValue(rr.rx ?? rr.radius ?? 10),
        ry: this.resolveFloatValue(rr.ry ?? rr.radius ?? 10)
      });
    } else if (cmd.drawOval) {
      encodeDrawOval(writer, {
        left: cmd.drawOval.left ?? 0,
        top: cmd.drawOval.top ?? 0,
        right: cmd.drawOval.right ?? 100,
        bottom: cmd.drawOval.bottom ?? 100,
      });
    } else if (cmd.drawArc) {
      encodeDrawArc(writer, {
        left: cmd.drawArc.left ?? 0,
        top: cmd.drawArc.top ?? 0,
        right: cmd.drawArc.right ?? 100,
        bottom: cmd.drawArc.bottom ?? 100,
        startAngle: cmd.drawArc.startAngle ?? 0,
        sweepAngle: cmd.drawArc.sweepAngle ?? 90,
      });
    } else if (cmd.drawLine) {
      encodeDrawLine(writer, {
        x1: this.resolveFloatValue(cmd.drawLine.x1 ?? 0),
        y1: this.resolveFloatValue(cmd.drawLine.y1 ?? 0),
        x2: this.resolveFloatValue(cmd.drawLine.x2 ?? 100),
        y2: this.resolveFloatValue(cmd.drawLine.y2 ?? 100)
      });
    } else if (cmd.drawTweenPath) {
      const dtp = cmd.drawTweenPath;
      const p1Id = this.resolvePathId(dtp.path1, writer);
      const p2Id = this.resolvePathId(dtp.path2, writer);
      const tweenVal = this.resolveFloatValue(dtp.tween);
      encodeDrawTweenPath(writer, {
        path1Id: p1Id,
        path2Id: p2Id,
        tween: tweenVal,
        start: dtp.start ?? 0,
        stop: dtp.stop ?? 1,
      });
    } else if (cmd.drawPath) {
      const pId = this.resolvePathId(cmd.drawPath.path || cmd.drawPath, writer);
      encodeDrawPath(writer, { pathId: pId });
    } else if (cmd.drawText) {
      const textStr = cmd.drawText.text || '';
      let textId = cmd.drawText.textId || 0;
      if (textStr) {
        textId = this.nextVarId++;
        encodeTextData(writer, { textId, text: textStr });
      }
      encodeDrawText(writer, {
        textId: textId,
        x: cmd.drawText.x ?? 0,
        y: cmd.drawText.y ?? 0,
      });
    } else if (cmd.save) {
      encodeMatrixSave(writer, {});
      if (Array.isArray(cmd.save.commands)) {
        for (const subCmd of cmd.save.commands) {
          this.compileCanvasCommand(subCmd, writer);
        }
      }
      encodeMatrixRestore(writer, {});
    } else if (cmd.skew || cmd.matrixSkew || cmd.matrix_skew) {
      const sk = cmd.skew || cmd.matrixSkew || cmd.matrix_skew;
      encodeMatrixSkew(writer, {
        skewX: this.resolveFloatValue(sk.skewX ?? sk.dx ?? sk.x ?? 0),
        skewY: this.resolveFloatValue(sk.skewY ?? sk.dy ?? sk.y ?? 0),
      });
    } else if (cmd.translate || cmd.matrixTranslate || cmd.matrix_translate) {
      const tr = cmd.translate || cmd.matrixTranslate || cmd.matrix_translate;
      encodeMatrixTranslate(writer, {
        dx: this.resolveFloatValue(tr.dx ?? tr.x ?? 0),
        dy: this.resolveFloatValue(tr.dy ?? tr.y ?? 0),
      });
    } else if (cmd.scale || cmd.matrixScale || cmd.matrix_scale) {
      const sc = cmd.scale || cmd.matrixScale || cmd.matrix_scale;
      encodeMatrixScale(writer, {
        scaleX: this.resolveFloatValue(sc.scaleX ?? sc.sx ?? sc.x ?? 1),
        scaleY: this.resolveFloatValue(sc.scaleY ?? sc.sy ?? sc.y ?? 1),
      });
    } else if (cmd.rotate || cmd.matrixRotate || cmd.matrix_rotate) {
      const rt = cmd.rotate || cmd.matrixRotate || cmd.matrix_rotate;
      encodeMatrixRotate(writer, {
        rotate: this.resolveFloatValue(rt.rotate ?? rt.angle ?? rt.a ?? 0),
        pivotX: this.resolveFloatValue(rt.pivotX ?? rt.cx ?? rt.px ?? 0),
        pivotY: this.resolveFloatValue(rt.pivotY ?? rt.cy ?? rt.py ?? 0),
      });
    } else if (cmd.restore || cmd.matrixRestore || cmd.matrix_restore) {
      encodeMatrixRestore(writer, {});
    } else if (cmd.clipRect) {
      encodeClipRect(writer, { left: cmd.clipRect.left ?? 0, top: cmd.clipRect.top ?? 0, right: cmd.clipRect.right ?? 100, bottom: cmd.clipRect.bottom ?? 100 });
    }
  }
}

global.WireBufferWriter = WireBufferWriter;
global.ExpressionCompiler = ExpressionCompiler;
global.RemoteComposeSerializer = RemoteComposeSerializer;
global.parseColor = parseColor;

})(typeof window !== 'undefined' ? window : globalThis);
