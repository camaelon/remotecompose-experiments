/**
 * RemoteCompose TypeScript Serializer
 * -----------------------------------
 * Auto-generated from RemoteCompose Wire Format Specification.
 * Do not edit directly; regenerate using generate_typescript_serializer.py.
 */

export class WireBufferWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number = 0;

  constructor(initialCapacity: number = 8192) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  private ensureCapacity(additional: number): void {
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

  public getOffset(): number { return this.offset; }
  public writeByte(val: number): void { this.ensureCapacity(1); this.buffer[this.offset++] = val & 0xff; }
  public writeShort(val: number): void { this.ensureCapacity(2); this.view.setInt16(this.offset, val, false); this.offset += 2; }
  public writeInt(val: number): void { this.ensureCapacity(4); this.view.setInt32(this.offset, val, false); this.offset += 4; }
  public writeLong(val: bigint | number): void { this.ensureCapacity(8); this.view.setBigInt64(this.offset, BigInt(val), false); this.offset += 8; }
  public writeFloat(val: number): void { this.ensureCapacity(4); this.view.setFloat32(this.offset, val, false); this.offset += 4; }
  public writeDouble(val: number): void { this.ensureCapacity(8); this.view.setFloat64(this.offset, val, false); this.offset += 8; }
  public writeBoolean(val: boolean): void { this.writeByte(val ? 1 : 0); }

  public writeUTF8(str: string): void {
    if (!str) { this.writeShort(0); return; }
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    this.writeShort(bytes.length);
    this.ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  public writeByteArray(arr: number[] | Uint8Array): void {
    this.writeInt(arr.length);
    this.ensureCapacity(arr.length);
    if (arr instanceof Uint8Array) this.buffer.set(arr, this.offset);
    else for (let i = 0; i < arr.length; i++) this.buffer[this.offset + i] = arr[i] & 0xff;
    this.offset += arr.length;
  }

  public writeShortArray(arr: number[]): void { this.writeInt(arr.length); for (const v of arr) this.writeShort(v); }
  public writeIntArray(arr: number[]): void { this.writeInt(arr.length); for (const v of arr) this.writeInt(v); }
  public writeFloatArray(arr: number[]): void { this.writeInt(arr.length); for (const v of arr) this.writeFloat(v); }
  public writeStringArray(arr: string[]): void { this.writeInt(arr.length); for (const s of arr) this.writeUTF8(s); }

  public toUint8Array(): Uint8Array { return this.buffer.slice(0, this.offset); }
  public toBase64(): string {
    const bytes = this.toUint8Array();
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  }
}

export function parseColor(colorStr: string): number {
  if (!colorStr) return 0xff000000;
  if (colorStr.startsWith('#')) {
    let hex = colorStr.substring(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 6) hex = 'FF' + hex;
    return parseInt(hex, 16) | 0;
  }
  return 0xff000000;
}

export enum Alignment {
  CENTER = 0,
  LEFT = 1,
  RIGHT = 2,
}

export enum Placement {
  OUTSIDE = 0,
  INSIDE = 1,
}

export enum Opcode {
  Header = 0,
  ComponentStart = 2,
  AnimationSpec = 14,
  WidthModifierOperation = 16,
  ClipPath = 38,
  ClipRect = 39,
  PaintData = 40,
  DrawRect = 42,
  DrawText = 43,
  DrawBitmap = 44,
  ShaderData = 45,
  DrawCircle = 46,
  DrawLine = 47,
  DrawBitmapFontText = 48,
  DrawBitmapFontTextOnPath = 49,
  DrawRoundRect = 51,
  DrawSector = 52,
  DrawTextOnPath = 53,
  RoundedClipRectModifierOperation = 54,
  BackgroundModifierOperation = 55,
  DrawOval = 56,
  DrawTextOnCircle = 57,
  PaddingModifierOperation = 58,
  ClickModifier = 59,
  Theme = 63,
  ClickArea = 64,
  RootContentBehavior = 65,
  DrawBitmapInt = 66,
  HeightModifierOperation = 67,
  FloatConstant = 80,
  FloatExpression = 81,
  MultiClickModifier = 83,
  Custom = 93,
  BitmapData = 101,
  TextData = 102,
  RootContentDescription = 103,
  BorderModifierOperation = 107,
  ClipRectModifierOperation = 108,
  PathData = 123,
  DrawPath = 124,
  DrawTweenPath = 125,
  MatrixScale = 126,
  MatrixTranslate = 127,
  MatrixSkew = 128,
  MatrixRotate = 129,
  MatrixSave = 130,
  MatrixRestore = 131,
  DrawTextAnchored = 133,
  ColorExpression = 134,
  TextFromFloat = 135,
  TextMerge = 136,
  NamedVariable = 137,
  ColorConstant = 138,
  DrawContent = 139,
  IntegerConstant = 140,
  PlaySound = 141,
  ReferencedOperations = 142,
  BooleanConstant = 143,
  IntegerExpression = 144,
  DataMapIds = 145,
  IdListData = 146,
  FloatListData = 147,
  LongConstant = 148,
  DrawBitmapScaled = 149,
  ComponentValue = 150,
  TextLookup = 151,
  DrawArc = 152,
  TextLookupInt = 153,
  DataMapLookup = 154,
  TextMeasure = 155,
  TextLength = 156,
  TouchExpression = 157,
  PathTween = 158,
  PathCreate = 159,
  PathAppend = 160,
  ParticlesCreate = 161,
  ParticlesLoop = 163,
  ImpulseOperation = 164,
  ImpulseProcess = 165,
  FunctionCall = 166,
  BitmapFontData = 167,
  FunctionDefine = 168,
  SoundData = 169,
  TextAttribute = 170,
  ImageAttribute = 171,
  TimeAttribute = 172,
  CanvasOperations = 173,
  DrawContentOperation = 174,
  PathCombine = 175,
  FitBoxLayout = 176,
  HapticFeedback = 177,
  ConditionalOperations = 178,
  DebugMessage = 179,
  ColorAttribute = 180,
  MatrixFromPath = 181,
  TextSubtext = 182,
  BitmapTextMeasure = 183,
  DrawBitmapTextAnchored = 184,
  Rem = 185,
  MatrixConstant = 186,
  MatrixExpression = 187,
  MatrixVectorMath = 188,
  FontData = 189,
  DrawToBitmap = 190,
  WakeIn = 191,
  IdLookup = 192,
  PathExpression = 193,
  ParticlesCompare = 194,
  ColorTheme = 196,
  DataDynamicListFloat = 197,
  UpdateDynamicFloatList = 198,
  TextTransform = 199,
  RootLayout = 200,
  LayoutContent = 201,
  BoxLayout = 202,
  RowLayout = 203,
  ColumnLayout = 204,
  CanvasLayout = 205,
  SoundExpression = 206,
  CanvasContent = 207,
  TextLayout = 208,
  HostAction = 209,
  HostNamedAction = 210,
  ComponentVisibilityOperation = 211,
  ValueIntegerChangeActionOperation = 212,
  ValueStringChangeActionOperation = 213,
  ContainerEnd = 214,
  Loop = 215,
  HostActionMetadata = 216,
  StateLayout = 217,
  ValueIntegerExpressionChangeActionOperation = 218,
  TouchModifier = 219,
  TouchUpModifier = 220,
  OffsetModifierOperation = 221,
  ValueFloatChangeActionOperation = 222,
  ZIndexModifierOperation = 223,
  GraphicsLayerModifierOperation = 224,
  TouchCancelModifier = 225,
  ScrollModifierOperation = 226,
  ValueFloatExpressionChangeActionOperation = 227,
  MarqueeModifierOperation = 228,
  RippleModifier = 229,
  CollapsibleRow = 230,
  WidthInModifierOperation = 231,
  HeightInModifierOperation = 232,
  CollapsibleColumn = 233,
  ImageLayout = 234,
  CollapsiblePriorityModifierOperation = 235,
  RunAction = 236,
  AlignByModifierOperation = 237,
  LayoutCompute = 238,
  CoreText = 239,
  FlowLayout = 240,
  Skip = 241,
  TextStyle = 242,
  DimensionConstraintsModifierOperation = 243,
  PatternForEach = 244,
  IncludeReferencedOperations = 245,
  PatternDefine = 246,
  PatternInflation = 247,
  PatternArgument = 248,
  PatternBlock = 249,
  CoreSemantics = 250,
  ExtensionRangeReserved4 = 251,
  ExtensionRangeReserved3 = 252,
  ExtensionRangeReserved2 = 253,
  ExtensionRangeReserved1 = 254,
  ExtendedOpcode = 255,
}

export interface HeaderArgs {
  width?: number;
  height?: number;
  density?: number;
  capabilities?: number | bigint;
  tags?: number[];
  values?: any[];
}

export interface ComponentStartArgs {
  type?: number;
  componentId?: number;
  width?: number;
  height?: number;
}

export interface AnimationSpecArgs {
  animationId?: number;
  motionDuration?: number;
  motionEasingType?: number;
  visibilityDuration?: number;
  visibilityEasingType?: number;
  enterAnimation?: number;
  exitAnimation?: number;
}

export interface WidthModifierOperationArgs {
  type?: number;
  value?: number;
}

export interface ClipPathArgs {
  id?: number;
}

export interface ClipRectArgs {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

export interface PaintDataArgs {
  paint?: Record<string, any>;
}

export interface DrawRectArgs {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

export interface DrawTextArgs {
  textId?: number;
  start?: number;
  end?: number;
  contextStart?: number;
  contextEnd?: number;
  x?: number;
  y?: number;
  rtl?: boolean;
}

export interface DrawBitmapArgs {
  imageId?: number;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  descriptionId?: number;
}

export interface ShaderDataArgs {
  shaderId?: number;
  shaderType?: number;
  floatParams?: Record<string, any>;
  intParams?: Record<string, any>;
  stringParams?: Record<string, any>;
}

export interface DrawCircleArgs {
  centerX?: number;
  centerY?: number;
  radius?: number;
}

export interface DrawLineArgs {
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
}

export interface DrawBitmapFontTextArgs {
  textId?: number;
  bitmapFontId?: number;
  start?: number;
  end?: number;
  x?: number;
  y?: number;
}

export interface DrawBitmapFontTextOnPathArgs {
  textId?: number;
  bitmapFontID?: number;
  pathID?: number;
  start?: number;
  end?: number;
  yAdj?: number;
  glyphSpacing?: number;
}

export interface DrawRoundRectArgs {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  rx?: number;
  ry?: number;
}

export interface DrawSectorArgs {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  startAngle?: number;
  sweepAngle?: number;
}

export interface DrawTextOnPathArgs {
  textId?: number;
  pathId?: number;
  hOffset?: number;
  vOffset?: number;
}

export interface RoundedClipRectModifierOperationArgs {
  topStart?: number;
  topEnd?: number;
  bottomStart?: number;
  bottomEnd?: number;
}

export interface BackgroundModifierOperationArgs {
  flags?: number;
  colorId?: number;
  reserve1?: number;
  reserve2?: number;
  r?: number;
  g?: number;
  b?: number;
  a?: number;
  shapeType?: number;
}

export interface DrawOvalArgs {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

export interface DrawTextOnCircleArgs {
  textId?: number;
  centerX?: number;
  centerY?: number;
  radius?: number;
  startAngle?: number;
  warpRadiusOffset?: number;
  alignment?: number;
  placement?: number;
}

export interface PaddingModifierOperationArgs {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

export interface ClickModifierArgs {
}

export interface ThemeArgs {
  THEME?: number;
}

export interface ClickAreaArgs {
  id?: number;
  contentDescription?: number;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  metadata?: number;
}

export interface RootContentBehaviorArgs {
  scroll?: number;
  alignment?: number;
  sizing?: number;
  mode?: number;
}

export interface DrawBitmapIntArgs {
  imageId?: number;
  srcLeft?: number;
  srcTop?: number;
  srcRight?: number;
  srcBottom?: number;
  dstLeft?: number;
  dstTop?: number;
  dstRight?: number;
  dstBottom?: number;
  cdId?: number;
}

export interface HeightModifierOperationArgs {
  type?: number;
  value?: number;
}

export interface FloatConstantArgs {
  id?: number;
  value?: number;
}

export interface FloatExpressionArgs {
  id?: number;
  value?: number[];
  animation?: number[];
}

export interface MultiClickModifierArgs {
  clickType?: number;
}

export interface CustomArgs {
  COMPONENT_ID?: number;
  ANIMATION_ID?: number;
  CONFIG_ID?: number;
  PROPERTIES_COUNT?: number;
}

export interface BitmapDataArgs {
  imageId?: number;
  widthAndType?: number;
  heightAndEncoding?: number;
  bitmap?: number[] | Uint8Array;
}

export interface TextDataArgs {
  textId?: number;
  text?: string;
}

export interface RootContentDescriptionArgs {
  id?: number;
}

export interface BorderModifierOperationArgs {
  flags?: number;
  colorId?: number;
  reserve1?: number;
  reserve2?: number;
  borderWidth?: number;
  roundedCorner?: number;
  r?: number;
  g?: number;
  b?: number;
  a?: number;
  shapeType?: number;
}

export interface ClipRectModifierOperationArgs {
}

export interface PathDataArgs {
  idAndWinding?: number;
  length?: number;
  pathData?: number[];
}

export interface DrawPathArgs {
  id?: number;
}

export interface DrawTweenPathArgs {
  path1Id?: number;
  path2Id?: number;
  tween?: number;
  start?: number;
  stop?: number;
}

export interface MatrixScaleArgs {
  scaleX?: number;
  scaleY?: number;
  pivotX?: number;
  pivotY?: number;
}

export interface MatrixTranslateArgs {
  dx?: number;
  dy?: number;
}

export interface MatrixSkewArgs {
  skewX?: number;
  skewY?: number;
}

export interface MatrixRotateArgs {
  rotate?: number;
  pivotX?: number;
  pivotY?: number;
}

export interface MatrixSaveArgs {
}

export interface MatrixRestoreArgs {
}

export interface DrawTextAnchoredArgs {
  textId?: number;
  x?: number;
  y?: number;
  panX?: number;
  panY?: number;
  flags?: number;
}

export interface ColorExpressionArgs {
  id?: number;
  mode?: number;
  color1?: number;
  color2?: number;
  tween?: number;
}

export interface TextFromFloatArgs {
  id?: number;
  value?: number;
  digitsBefore?: number;
  digitsAfter?: number;
  flags?: number;
}

export interface TextMergeArgs {
  textId?: number;
  srcId1?: number;
  srcId2?: number;
}

export interface NamedVariableArgs {
  varId?: number;
  varType?: number;
  name?: string;
}

export interface ColorConstantArgs {
  colorId?: number;
  color?: number;
}

export interface DrawContentArgs {
}

export interface IntegerConstantArgs {
  id?: number;
  value?: number;
}

export interface PlaySoundArgs {
  soundExpressionId?: number;
}

export interface ReferencedOperationsArgs {
  id?: number;
}

export interface BooleanConstantArgs {
  id?: number;
  value?: boolean;
}

export interface IntegerExpressionArgs {
  id?: number;
  mask?: number;
  value?: number[];
}

export interface DataMapIdsArgs {
  id?: number;
  keys?: string[];
  types?: number[] | Uint8Array;
  values?: number[];
}

export interface IdListDataArgs {
  id?: number;
  ids?: number[];
}

export interface FloatListDataArgs {
  id?: number;
  value?: number[];
}

export interface LongConstantArgs {
  id?: number;
  value?: number | bigint;
}

export interface DrawBitmapScaledArgs {
  imageId?: number;
  srcLeft?: number;
  srcTop?: number;
  srcRight?: number;
  srcBottom?: number;
  dstLeft?: number;
  dstTop?: number;
  dstRight?: number;
  dstBottom?: number;
  scaleType?: number;
  scaleFactor?: number;
  cdId?: number;
}

export interface ComponentValueArgs {
  type?: number;
  componentId?: number;
  valueId?: number;
}

export interface TextLookupArgs {
  textId?: number;
  dataSetId?: number;
  index?: number;
}

export interface DrawArcArgs {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  startAngle?: number;
  sweepAngle?: number;
}

export interface TextLookupIntArgs {
  textId?: number;
  dataSetId?: number;
  indexId?: number;
}

export interface DataMapLookupArgs {
  id?: number;
  dataMapId?: number;
  stringId?: number;
}

export interface TextMeasureArgs {
  id?: number;
  textId?: number;
  type?: number;
}

export interface TextLengthArgs {
  lengthId?: number;
  textId?: number;
}

export interface TouchExpressionArgs {
  id?: number;
  value?: number;
  min?: number;
  max?: number;
  velocityId?: number;
  touchEffects?: number;
  exp?: number[];
  touchMode?: number;
  touchSpec?: number[];
  easingSpec?: number[];
}

export interface PathTweenArgs {
  outId?: number;
  pathId1?: number;
  pathId2?: number;
  tween?: number;
}

export interface PathCreateArgs {
  id?: number;
  startX?: number;
  startY?: number;
}

export interface PathAppendArgs {
  id?: number;
  data?: number[];
}

export interface ParticlesCreateArgs {
  id?: number;
  particleIds?: number[];
  initialValues?: number[][];
  flags?: number;
}

export interface ParticlesLoopArgs {
  id?: number;
  params?: number[];
  values?: number[][];
}

export interface ImpulseOperationArgs {
  duration?: number;
  startAt?: number;
}

export interface ImpulseProcessArgs {
}

export interface FunctionCallArgs {
  id?: number;
  argLen?: number;
  values?: number[];
}

export interface BitmapFontDataArgs {
  fontId?: number;
  glyphs?: any[];
  metadata?: Record<string, any>;
}

export interface FunctionDefineArgs {
  id?: number;
  varLen?: number;
  varId?: number[];
}

export interface SoundDataArgs {
  soundId?: number;
  data?: number[] | Uint8Array;
}

export interface TextAttributeArgs {
  id?: number;
  textId?: number;
  type?: number;
}

export interface ImageAttributeArgs {
  id?: number;
  imageId?: number;
  type?: number;
  params?: number[];
}

export interface TimeAttributeArgs {
  id?: number;
  timeId?: number;
  type?: number;
  params?: number[];
}

export interface CanvasOperationsArgs {
}

export interface DrawContentOperationArgs {
}

export interface PathCombineArgs {
  id?: number;
  path1?: number;
  path2?: number;
  mode?: number;
}

export interface FitBoxLayoutArgs {
  componentId?: number;
  animationId?: number;
  horizontalPositioning?: number;
  verticalPositioning?: number;
}

export interface HapticFeedbackArgs {
  hapticFeedbackType?: number;
}

export interface ConditionalOperationsArgs {
  condition?: number;
  v1?: number;
  v2?: number;
}

export interface DebugMessageArgs {
  textId?: number;
  value?: number;
  flags?: number;
}

export interface ColorAttributeArgs {
  id?: number;
  colorId?: number;
  type?: number;
}

export interface MatrixFromPathArgs {
  pathId?: number;
  percent?: number;
  vOffset?: number;
  flags?: number;
}

export interface TextSubtextArgs {
  textId?: number;
  srcId1?: number;
  start?: number;
  len?: number;
}

export interface BitmapTextMeasureArgs {
  textId?: number;
  bitmapFontId?: number;
  start?: number;
  end?: number;
  glyphSpacing?: number;
}

export interface DrawBitmapTextAnchoredArgs {
  textId?: number;
  bitmapFontID?: number;
  start?: number;
  end?: number;
  x?: number;
  y?: number;
  panX?: number;
  panY?: number;
}

export interface RemArgs {
  text?: string;
}

export interface MatrixConstantArgs {
  matrixId?: number;
  type?: number;
  values?: number[];
}

export interface MatrixExpressionArgs {
  matrixId?: number;
  type?: number;
  expression?: number[];
}

export interface MatrixVectorMathArgs {
  type?: number;
  outputs?: number[];
  matrixId?: number;
  inputs?: number[];
}

export interface FontDataArgs {
  fontId?: number;
  type?: number;
  fontData?: number[] | Uint8Array;
}

export interface DrawToBitmapArgs {
  bitmapId?: number;
  mode?: number;
  color?: number;
}

export interface WakeInArgs {
  wake?: number;
}

export interface IdLookupArgs {
  id?: number;
  lookupId?: number;
  value?: number;
}

export interface PathExpressionArgs {
  id?: number;
  flags?: number;
  min?: number;
  max?: number;
  count?: number;
  lenX?: number;
  expressionX?: number[];
  lenY?: number;
  expressionY?: number[];
}

export interface ParticlesCompareArgs {
  id?: number;
  compOp?: number;
  val1?: number;
  val2?: number;
  array1?: number[];
  array2?: number[][];
  array3?: number[][];
}

export interface ColorThemeArgs {
  id?: number;
  groupId?: number;
  lightMode?: number;
  darkMode?: number;
  lightModeFallback?: number;
  darkModeFallback?: number;
}

export interface DataDynamicListFloatArgs {
  id?: number;
  length?: number;
}

export interface UpdateDynamicFloatListArgs {
  arrayId?: number;
  index?: number;
  value?: number;
}

export interface TextTransformArgs {
  textId?: number;
  srcId1?: number;
  start?: number;
  len?: number;
  operation?: number;
}

export interface RootLayoutArgs {
  componentId?: number;
}

export interface LayoutContentArgs {
  componentId?: number;
}

export interface BoxLayoutArgs {
  COMPONENT_ID?: number;
  ANIMATION_ID?: number;
  HORIZONTAL_POSITIONING?: number;
  VERTICAL_POSITIONING?: number;
}

export interface RowLayoutArgs {
  componentId?: number;
  animationId?: number;
  horizontalPositioning?: number;
  verticalPositioning?: number;
  spacedBy?: number;
}

export interface ColumnLayoutArgs {
  componentId?: number;
  animationId?: number;
  horizontalPositioning?: number;
  verticalPositioning?: number;
  spacedBy?: number;
}

export interface CanvasLayoutArgs {
  componentId?: number;
  animationId?: number;
}

export interface SoundExpressionArgs {
  id?: number;
  leftVolume?: number;
  rightVolume?: number;
  rate?: number;
  paramsLength?: number;
  params?: number[];
}

export interface CanvasContentArgs {
  COMPONENT_ID?: number;
}

export interface TextLayoutArgs {
  componentId?: number;
  animationId?: number;
  textId?: number;
  color?: number;
  fontSize?: number;
  fontStyle?: number;
  fontWeight?: number;
  fontFamilyId?: number;
  textAlign?: number;
  overflow?: number;
  maxLines?: number;
}

export interface HostActionArgs {
  ACTION_ID?: number;
}

export interface HostNamedActionArgs {
  textId?: number;
  type?: number;
  valueId?: number;
}

export interface ComponentVisibilityOperationArgs {
  visibilityId?: number;
}

export interface ValueIntegerChangeActionOperationArgs {
  targetValueId?: number;
  value?: number;
}

export interface ValueStringChangeActionOperationArgs {
  targetValueId?: number;
  valueId?: number;
}

export interface ContainerEndArgs {
}

export interface LoopArgs {
  indexId?: number;
  from?: number;
  step?: number;
  until?: number;
}

export interface HostActionMetadataArgs {
  ACTION_ID?: number;
  METADATA?: number;
}

export interface StateLayoutArgs {
  componentId?: number;
  animationId?: number;
  horizontalPositioning?: number;
  verticalPositioning?: number;
  indexId?: number;
}

export interface ValueIntegerExpressionChangeActionOperationArgs {
  targetValueId?: number | bigint;
  valueExpressionId?: number | bigint;
}

export interface TouchModifierArgs {
}

export interface TouchUpModifierArgs {
}

export interface OffsetModifierOperationArgs {
  x?: number;
  y?: number;
}

export interface ValueFloatChangeActionOperationArgs {
  targetValueId?: number;
  value?: number;
}

export interface ZIndexModifierOperationArgs {
  value?: number;
}

export interface GraphicsLayerModifierOperationArgs {
  map?: Record<string, any>;
}

export interface TouchCancelModifierArgs {
}

export interface ScrollModifierOperationArgs {
  direction?: number;
  position?: number;
  max?: number;
  notchMax?: number;
}

export interface ValueFloatExpressionChangeActionOperationArgs {
  targetValueId?: number;
  valueExpressionId?: number;
}

export interface MarqueeModifierOperationArgs {
  iterations?: number;
  animationMode?: number;
  repeatDelayMillis?: number;
  initialDelayMillis?: number;
  spacing?: number;
  velocity?: number;
}

export interface RippleModifierArgs {
}

export interface CollapsibleRowArgs {
  componentId?: number;
  animationId?: number;
  horizontalPositioning?: number;
  verticalPositioning?: number;
  spacedBy?: number;
}

export interface WidthInModifierOperationArgs {
  min?: number;
  max?: number;
}

export interface HeightInModifierOperationArgs {
  min?: number;
  max?: number;
}

export interface CollapsibleColumnArgs {
  componentId?: number;
  animationId?: number;
  horizontalPositioning?: number;
  verticalPositioning?: number;
  spacedBy?: number;
}

export interface ImageLayoutArgs {
  componentId?: number;
  animationId?: number;
  bitmapId?: number;
  scaleType?: number;
  alpha?: number;
}

export interface CollapsiblePriorityModifierOperationArgs {
  orientation?: number;
  priority?: number;
}

export interface RunActionArgs {
}

export interface AlignByModifierOperationArgs {
  line?: number;
  flags?: number;
}

export interface LayoutComputeArgs {
  type?: number;
  boundsId?: number;
  animateChanges?: boolean;
}

export interface CoreTextArgs {
}

export interface FlowLayoutArgs {
  componentId?: number;
  animationId?: number;
  horizontalPositioning?: number;
  verticalPositioning?: number;
  spacedBy?: number;
  maxItemsInEachRow?: number;
  maxLines?: number;
}

export interface SkipArgs {
  Condition?: number;
  Value?: number;
  Length?: number;
}

export interface TextStyleArgs {
}

export interface DimensionConstraintsModifierOperationArgs {
  type?: number;
  min?: number;
  max?: number;
}

export interface PatternForEachArgs {
  collectionId?: number;
  localItemId?: number;
  skipLength?: number;
}

export interface IncludeReferencedOperationsArgs {
  ID?: number;
}

export interface PatternDefineArgs {
  id?: number;
  paramIds?: number[];
  skipLength?: number;
}

export interface PatternInflationArgs {
  id?: number;
  argIds?: number[];
}

export interface PatternArgumentArgs {
  paramIndex?: number;
}

export interface PatternBlockArgs {
  paramIndex?: number;
}

export interface CoreSemanticsArgs {
  contentDescriptionId?: number;
  role?: number;
  textId?: number;
  stateDescriptionId?: number;
  mode?: number;
  enabled?: boolean;
  clickable?: boolean;
}

export interface ExtensionRangeReserved4Args {
}

export interface ExtensionRangeReserved3Args {
}

export interface ExtensionRangeReserved2Args {
}

export interface ExtensionRangeReserved1Args {
}

export interface ExtendedOpcodeArgs {
}

export function encodeHeader(writer: WireBufferWriter, args: HeaderArgs = {}): void {
  const width = (args.width as number) ?? 400;
  const height = (args.height as number) ?? 400;
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

export function encodeComponentStart(writer: WireBufferWriter, args: ComponentStartArgs = {}): void {
  writer.writeByte(2);
  writer.writeInt(args.type ?? 0);
  writer.writeInt(args.componentId ?? 0);
  writer.writeFloat(args.width ?? 0);
  writer.writeFloat(args.height ?? 0);
}

export function encodeAnimationSpec(writer: WireBufferWriter, args: AnimationSpecArgs = {}): void {
  writer.writeByte(14);
  writer.writeInt(args.animationId ?? 0);
  writer.writeFloat(args.motionDuration ?? 0);
  writer.writeInt(args.motionEasingType ?? 0);
  writer.writeFloat(args.visibilityDuration ?? 0);
  writer.writeInt(args.visibilityEasingType ?? 0);
  writer.writeInt(args.enterAnimation ?? 0);
  writer.writeInt(args.exitAnimation ?? 0);
}

export function encodeWidthModifierOperation(writer: WireBufferWriter, args: WidthModifierOperationArgs = {}): void {
  writer.writeByte(16);
  writer.writeInt(args.type ?? 0);
  writer.writeFloat(args.value ?? 0);
}

export function encodeClipPath(writer: WireBufferWriter, args: ClipPathArgs = {}): void {
  writer.writeByte(38);
  writer.writeInt(args.id ?? 0);
}

export function encodeClipRect(writer: WireBufferWriter, args: ClipRectArgs = {}): void {
  writer.writeByte(39);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
}

export function encodePaintData(writer: WireBufferWriter, args: PaintDataArgs = {}): void {
  writer.writeByte(40);
  writer.writeInt(0);
}

export function encodeDrawRect(writer: WireBufferWriter, args: DrawRectArgs = {}): void {
  writer.writeByte(42);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
}

export function encodeDrawText(writer: WireBufferWriter, args: DrawTextArgs = {}): void {
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

export function encodeDrawBitmap(writer: WireBufferWriter, args: DrawBitmapArgs = {}): void {
  writer.writeByte(44);
  writer.writeInt(args.imageId ?? 0);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
  writer.writeInt(args.descriptionId ?? 0);
}

export function encodeShaderData(writer: WireBufferWriter, args: ShaderDataArgs = {}): void {
  writer.writeByte(45);
  writer.writeInt(args.shaderId ?? 0);
  writer.writeInt(args.shaderType ?? 0);
  writer.writeInt(0);
  writer.writeInt(0);
  writer.writeInt(0);
}

export function encodeDrawCircle(writer: WireBufferWriter, args: DrawCircleArgs = {}): void {
  writer.writeByte(46);
  writer.writeFloat(args.centerX ?? 0);
  writer.writeFloat(args.centerY ?? 0);
  writer.writeFloat(args.radius ?? 0);
}

export function encodeDrawLine(writer: WireBufferWriter, args: DrawLineArgs = {}): void {
  writer.writeByte(47);
  writer.writeFloat(args.startX ?? 0);
  writer.writeFloat(args.startY ?? 0);
  writer.writeFloat(args.endX ?? 0);
  writer.writeFloat(args.endY ?? 0);
}

export function encodeDrawBitmapFontText(writer: WireBufferWriter, args: DrawBitmapFontTextArgs = {}): void {
  writer.writeByte(48);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.bitmapFontId ?? 0);
  writer.writeInt(args.start ?? 0);
  writer.writeInt(args.end ?? 0);
  writer.writeFloat(args.x ?? 0);
  writer.writeFloat(args.y ?? 0);
}

export function encodeDrawBitmapFontTextOnPath(writer: WireBufferWriter, args: DrawBitmapFontTextOnPathArgs = {}): void {
  writer.writeByte(49);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.bitmapFontID ?? 0);
  writer.writeInt(args.pathID ?? 0);
  writer.writeInt(args.start ?? 0);
  writer.writeInt(args.end ?? 0);
  writer.writeFloat(args.yAdj ?? 0);
  writer.writeFloat(args.glyphSpacing ?? 0);
}

export function encodeDrawRoundRect(writer: WireBufferWriter, args: DrawRoundRectArgs = {}): void {
  writer.writeByte(51);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
  writer.writeFloat(args.rx ?? 0);
  writer.writeFloat(args.ry ?? 0);
}

export function encodeDrawSector(writer: WireBufferWriter, args: DrawSectorArgs = {}): void {
  writer.writeByte(52);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
  writer.writeFloat(args.startAngle ?? 0);
  writer.writeFloat(args.sweepAngle ?? 0);
}

export function encodeDrawTextOnPath(writer: WireBufferWriter, args: DrawTextOnPathArgs = {}): void {
  writer.writeByte(53);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.pathId ?? 0);
  writer.writeFloat(args.hOffset ?? 0);
  writer.writeFloat(args.vOffset ?? 0);
}

export function encodeRoundedClipRectModifierOperation(writer: WireBufferWriter, args: RoundedClipRectModifierOperationArgs = {}): void {
  writer.writeByte(54);
  writer.writeFloat(args.topStart ?? 0);
  writer.writeFloat(args.topEnd ?? 0);
  writer.writeFloat(args.bottomStart ?? 0);
  writer.writeFloat(args.bottomEnd ?? 0);
}

export function encodeBackgroundModifierOperation(writer: WireBufferWriter, args: BackgroundModifierOperationArgs = {}): void {
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

export function encodeDrawOval(writer: WireBufferWriter, args: DrawOvalArgs = {}): void {
  writer.writeByte(56);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
}

export function encodeDrawTextOnCircle(writer: WireBufferWriter, args: DrawTextOnCircleArgs = {}): void {
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

export function encodePaddingModifierOperation(writer: WireBufferWriter, args: PaddingModifierOperationArgs = {}): void {
  writer.writeByte(58);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
}

export function encodeClickModifier(writer: WireBufferWriter, args: ClickModifierArgs = {}): void {
  writer.writeByte(59);
}

export function encodeTheme(writer: WireBufferWriter, args: ThemeArgs = {}): void {
  writer.writeByte(63);
  writer.writeInt(args.THEME ?? 0);
}

export function encodeClickArea(writer: WireBufferWriter, args: ClickAreaArgs = {}): void {
  writer.writeByte(64);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.contentDescription ?? 0);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
  writer.writeInt(args.metadata ?? 0);
}

export function encodeRootContentBehavior(writer: WireBufferWriter, args: RootContentBehaviorArgs = {}): void {
  writer.writeByte(65);
  writer.writeInt(args.scroll ?? 0);
  writer.writeInt(args.alignment ?? 0);
  writer.writeInt(args.sizing ?? 0);
  writer.writeInt(args.mode ?? 0);
}

export function encodeDrawBitmapInt(writer: WireBufferWriter, args: DrawBitmapIntArgs = {}): void {
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

export function encodeHeightModifierOperation(writer: WireBufferWriter, args: HeightModifierOperationArgs = {}): void {
  writer.writeByte(67);
  writer.writeInt(args.type ?? 0);
  writer.writeFloat(args.value ?? 0);
}

export function encodeFloatConstant(writer: WireBufferWriter, args: FloatConstantArgs = {}): void {
  writer.writeByte(80);
  writer.writeInt(args.id ?? 0);
  writer.writeFloat(args.value ?? 0);
}

export function encodeFloatExpression(writer: WireBufferWriter, args: FloatExpressionArgs = {}): void {
  writer.writeByte(81);
  writer.writeInt(args.id ?? 0);
  writer.writeFloatArray(args.value ?? []);
  writer.writeFloatArray(args.animation ?? []);
}

export function encodeMultiClickModifier(writer: WireBufferWriter, args: MultiClickModifierArgs = {}): void {
  writer.writeByte(83);
  writer.writeInt(args.clickType ?? 0);
}

export function encodeCustom(writer: WireBufferWriter, args: CustomArgs = {}): void {
  writer.writeByte(93);
  writer.writeInt(args.COMPONENT_ID ?? 0);
  writer.writeInt(args.ANIMATION_ID ?? 0);
  writer.writeInt(args.CONFIG_ID ?? 0);
  writer.writeInt(args.PROPERTIES_COUNT ?? 0);
}

export function encodeBitmapData(writer: WireBufferWriter, args: BitmapDataArgs = {}): void {
  writer.writeByte(101);
  writer.writeInt(args.imageId ?? 0);
  writer.writeInt(args.widthAndType ?? 0);
  writer.writeInt(args.heightAndEncoding ?? 0);
  writer.writeByteArray(args.bitmap ?? []);
}

export function encodeTextData(writer: WireBufferWriter, args: TextDataArgs = {}): void {
  writer.writeByte(102);
  writer.writeInt(args.textId ?? 0);
  writer.writeUTF8(args.text ?? '');
}

export function encodeRootContentDescription(writer: WireBufferWriter, args: RootContentDescriptionArgs = {}): void {
  writer.writeByte(103);
  writer.writeInt(args.id ?? 0);
}

export function encodeBorderModifierOperation(writer: WireBufferWriter, args: BorderModifierOperationArgs = {}): void {
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

export function encodeClipRectModifierOperation(writer: WireBufferWriter, args: ClipRectModifierOperationArgs = {}): void {
  writer.writeByte(108);
}

export function encodePathData(writer: WireBufferWriter, args: PathDataArgs = {}): void {
  writer.writeByte(123);
  writer.writeInt(args.idAndWinding ?? 0);
  writer.writeInt(args.length ?? 0);
  writer.writeFloatArray(args.pathData ?? []);
}

export function encodeDrawPath(writer: WireBufferWriter, args: DrawPathArgs = {}): void {
  writer.writeByte(124);
  writer.writeInt(args.id ?? 0);
}

export function encodeDrawTweenPath(writer: WireBufferWriter, args: DrawTweenPathArgs = {}): void {
  writer.writeByte(125);
  writer.writeInt(args.path1Id ?? 0);
  writer.writeInt(args.path2Id ?? 0);
  writer.writeFloat(args.tween ?? 0);
  writer.writeFloat(args.start ?? 0);
  writer.writeFloat(args.stop ?? 0);
}

export function encodeMatrixScale(writer: WireBufferWriter, args: MatrixScaleArgs = {}): void {
  writer.writeByte(126);
  writer.writeFloat(args.scaleX ?? 0);
  writer.writeFloat(args.scaleY ?? 0);
  writer.writeFloat(args.pivotX ?? 0);
  writer.writeFloat(args.pivotY ?? 0);
}

export function encodeMatrixTranslate(writer: WireBufferWriter, args: MatrixTranslateArgs = {}): void {
  writer.writeByte(127);
  writer.writeFloat(args.dx ?? 0);
  writer.writeFloat(args.dy ?? 0);
}

export function encodeMatrixSkew(writer: WireBufferWriter, args: MatrixSkewArgs = {}): void {
  writer.writeByte(128);
  writer.writeFloat(args.skewX ?? 0);
  writer.writeFloat(args.skewY ?? 0);
}

export function encodeMatrixRotate(writer: WireBufferWriter, args: MatrixRotateArgs = {}): void {
  writer.writeByte(129);
  writer.writeFloat(args.rotate ?? 0);
  writer.writeFloat(args.pivotX ?? 0);
  writer.writeFloat(args.pivotY ?? 0);
}

export function encodeMatrixSave(writer: WireBufferWriter, args: MatrixSaveArgs = {}): void {
  writer.writeByte(130);
}

export function encodeMatrixRestore(writer: WireBufferWriter, args: MatrixRestoreArgs = {}): void {
  writer.writeByte(131);
}

export function encodeDrawTextAnchored(writer: WireBufferWriter, args: DrawTextAnchoredArgs = {}): void {
  writer.writeByte(133);
  writer.writeInt(args.textId ?? 0);
  writer.writeFloat(args.x ?? 0);
  writer.writeFloat(args.y ?? 0);
  writer.writeFloat(args.panX ?? 0);
  writer.writeFloat(args.panY ?? 0);
  writer.writeInt(args.flags ?? 0);
}

export function encodeColorExpression(writer: WireBufferWriter, args: ColorExpressionArgs = {}): void {
  writer.writeByte(134);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.mode ?? 0);
  writer.writeInt(args.color1 ?? 0);
  writer.writeInt(args.color2 ?? 0);
  writer.writeFloat(args.tween ?? 0);
}

export function encodeTextFromFloat(writer: WireBufferWriter, args: TextFromFloatArgs = {}): void {
  writer.writeByte(135);
  writer.writeInt(args.id ?? 0);
  writer.writeFloat(args.value ?? 0);
  writer.writeShort(args.digitsBefore ?? 0);
  writer.writeShort(args.digitsAfter ?? 0);
  writer.writeInt(args.flags ?? 0);
}

export function encodeTextMerge(writer: WireBufferWriter, args: TextMergeArgs = {}): void {
  writer.writeByte(136);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.srcId1 ?? 0);
  writer.writeInt(args.srcId2 ?? 0);
}

export function encodeNamedVariable(writer: WireBufferWriter, args: NamedVariableArgs = {}): void {
  writer.writeByte(137);
  writer.writeInt(args.varId ?? 0);
  writer.writeInt(args.varType ?? 0);
  writer.writeUTF8(args.name ?? '');
}

export function encodeColorConstant(writer: WireBufferWriter, args: ColorConstantArgs = {}): void {
  writer.writeByte(138);
  writer.writeInt(args.colorId ?? 0);
  writer.writeInt(args.color ?? 0);
}

export function encodeDrawContent(writer: WireBufferWriter, args: DrawContentArgs = {}): void {
  writer.writeByte(139);
}

export function encodeIntegerConstant(writer: WireBufferWriter, args: IntegerConstantArgs = {}): void {
  writer.writeByte(140);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.value ?? 0);
}

export function encodePlaySound(writer: WireBufferWriter, args: PlaySoundArgs = {}): void {
  writer.writeByte(141);
  writer.writeInt(args.soundExpressionId ?? 0);
}

export function encodeReferencedOperations(writer: WireBufferWriter, args: ReferencedOperationsArgs = {}): void {
  writer.writeByte(142);
  writer.writeInt(args.id ?? 0);
}

export function encodeBooleanConstant(writer: WireBufferWriter, args: BooleanConstantArgs = {}): void {
  writer.writeByte(143);
  writer.writeInt(args.id ?? 0);
  writer.writeBoolean(args.value ?? false);
}

export function encodeIntegerExpression(writer: WireBufferWriter, args: IntegerExpressionArgs = {}): void {
  writer.writeByte(144);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.mask ?? 0);
  writer.writeIntArray(args.value ?? []);
}

export function encodeDataMapIds(writer: WireBufferWriter, args: DataMapIdsArgs = {}): void {
  writer.writeByte(145);
  writer.writeInt(args.id ?? 0);
  writer.writeStringArray(args.keys ?? []);
  writer.writeByteArray(args.types ?? []);
  writer.writeIntArray(args.values ?? []);
}

export function encodeIdListData(writer: WireBufferWriter, args: IdListDataArgs = {}): void {
  writer.writeByte(146);
  writer.writeInt(args.id ?? 0);
  writer.writeIntArray(args.ids ?? []);
}

export function encodeFloatListData(writer: WireBufferWriter, args: FloatListDataArgs = {}): void {
  writer.writeByte(147);
  writer.writeInt(args.id ?? 0);
  writer.writeFloatArray(args.value ?? []);
}

export function encodeLongConstant(writer: WireBufferWriter, args: LongConstantArgs = {}): void {
  writer.writeByte(148);
  writer.writeInt(args.id ?? 0);
  writer.writeLong(args.value ?? 0);
}

export function encodeDrawBitmapScaled(writer: WireBufferWriter, args: DrawBitmapScaledArgs = {}): void {
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

export function encodeComponentValue(writer: WireBufferWriter, args: ComponentValueArgs = {}): void {
  writer.writeByte(150);
  writer.writeInt(args.type ?? 0);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.valueId ?? 0);
}

export function encodeTextLookup(writer: WireBufferWriter, args: TextLookupArgs = {}): void {
  writer.writeByte(151);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.dataSetId ?? 0);
  writer.writeFloat(args.index ?? 0);
}

export function encodeDrawArc(writer: WireBufferWriter, args: DrawArcArgs = {}): void {
  writer.writeByte(152);
  writer.writeFloat(args.left ?? 0);
  writer.writeFloat(args.top ?? 0);
  writer.writeFloat(args.right ?? 0);
  writer.writeFloat(args.bottom ?? 0);
  writer.writeFloat(args.startAngle ?? 0);
  writer.writeFloat(args.sweepAngle ?? 0);
}

export function encodeTextLookupInt(writer: WireBufferWriter, args: TextLookupIntArgs = {}): void {
  writer.writeByte(153);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.dataSetId ?? 0);
  writer.writeInt(args.indexId ?? 0);
}

export function encodeDataMapLookup(writer: WireBufferWriter, args: DataMapLookupArgs = {}): void {
  writer.writeByte(154);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.dataMapId ?? 0);
  writer.writeInt(args.stringId ?? 0);
}

export function encodeTextMeasure(writer: WireBufferWriter, args: TextMeasureArgs = {}): void {
  writer.writeByte(155);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.type ?? 0);
}

export function encodeTextLength(writer: WireBufferWriter, args: TextLengthArgs = {}): void {
  writer.writeByte(156);
  writer.writeInt(args.lengthId ?? 0);
  writer.writeInt(args.textId ?? 0);
}

export function encodeTouchExpression(writer: WireBufferWriter, args: TouchExpressionArgs = {}): void {
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

export function encodePathTween(writer: WireBufferWriter, args: PathTweenArgs = {}): void {
  writer.writeByte(158);
  writer.writeInt(args.outId ?? 0);
  writer.writeInt(args.pathId1 ?? 0);
  writer.writeInt(args.pathId2 ?? 0);
  writer.writeFloat(args.tween ?? 0);
}

export function encodePathCreate(writer: WireBufferWriter, args: PathCreateArgs = {}): void {
  writer.writeByte(159);
  writer.writeInt(args.id ?? 0);
  writer.writeFloat(args.startX ?? 0);
  writer.writeFloat(args.startY ?? 0);
}

export function encodePathAppend(writer: WireBufferWriter, args: PathAppendArgs = {}): void {
  writer.writeByte(160);
  writer.writeInt(args.id ?? 0);
  writer.writeFloatArray(args.data ?? []);
}

export function encodeParticlesCreate(writer: WireBufferWriter, args: ParticlesCreateArgs = {}): void {
  writer.writeByte(161);
  writer.writeInt(args.id ?? 0);
  writer.writeIntArray(args.particleIds ?? []);
  writer.writeInt(0);
  writer.writeInt(args.flags ?? 0);
}

export function encodeParticlesLoop(writer: WireBufferWriter, args: ParticlesLoopArgs = {}): void {
  writer.writeByte(163);
  writer.writeInt(args.id ?? 0);
  writer.writeFloatArray(args.params ?? []);
  writer.writeInt(0);
}

export function encodeImpulseOperation(writer: WireBufferWriter, args: ImpulseOperationArgs = {}): void {
  writer.writeByte(164);
  writer.writeFloat(args.duration ?? 0);
  writer.writeFloat(args.startAt ?? 0);
}

export function encodeImpulseProcess(writer: WireBufferWriter, args: ImpulseProcessArgs = {}): void {
  writer.writeByte(165);
}

export function encodeFunctionCall(writer: WireBufferWriter, args: FunctionCallArgs = {}): void {
  writer.writeByte(166);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.argLen ?? 0);
  writer.writeFloatArray(args.values ?? []);
}

export function encodeBitmapFontData(writer: WireBufferWriter, args: BitmapFontDataArgs = {}): void {
  writer.writeByte(167);
  writer.writeInt(args.fontId ?? 0);
  writer.writeInt(0);
  writer.writeInt(0);
}

export function encodeFunctionDefine(writer: WireBufferWriter, args: FunctionDefineArgs = {}): void {
  writer.writeByte(168);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.varLen ?? 0);
  writer.writeIntArray(args.varId ?? []);
}

export function encodeSoundData(writer: WireBufferWriter, args: SoundDataArgs = {}): void {
  writer.writeByte(169);
  writer.writeInt(args.soundId ?? 0);
  writer.writeByteArray(args.data ?? []);
}

export function encodeTextAttribute(writer: WireBufferWriter, args: TextAttributeArgs = {}): void {
  writer.writeByte(170);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.textId ?? 0);
  writer.writeShort(args.type ?? 0);
}

export function encodeImageAttribute(writer: WireBufferWriter, args: ImageAttributeArgs = {}): void {
  writer.writeByte(171);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.imageId ?? 0);
  writer.writeShort(args.type ?? 0);
  writer.writeIntArray(args.params ?? []);
}

export function encodeTimeAttribute(writer: WireBufferWriter, args: TimeAttributeArgs = {}): void {
  writer.writeByte(172);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.timeId ?? 0);
  writer.writeShort(args.type ?? 0);
  writer.writeIntArray(args.params ?? []);
}

export function encodeCanvasOperations(writer: WireBufferWriter, args: CanvasOperationsArgs = {}): void {
  writer.writeByte(173);
}

export function encodeDrawContentOperation(writer: WireBufferWriter, args: DrawContentOperationArgs = {}): void {
  writer.writeByte(174);
}

export function encodePathCombine(writer: WireBufferWriter, args: PathCombineArgs = {}): void {
  writer.writeByte(175);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.path1 ?? 0);
  writer.writeInt(args.path2 ?? 0);
  writer.writeByte(args.mode ?? 0);
}

export function encodeFitBoxLayout(writer: WireBufferWriter, args: FitBoxLayoutArgs = {}): void {
  writer.writeByte(176);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
}

export function encodeHapticFeedback(writer: WireBufferWriter, args: HapticFeedbackArgs = {}): void {
  writer.writeByte(177);
  writer.writeInt(args.hapticFeedbackType ?? 0);
}

export function encodeConditionalOperations(writer: WireBufferWriter, args: ConditionalOperationsArgs = {}): void {
  writer.writeByte(178);
  writer.writeByte(args.condition ?? 0);
  writer.writeFloat(args.v1 ?? 0);
  writer.writeFloat(args.v2 ?? 0);
}

export function encodeDebugMessage(writer: WireBufferWriter, args: DebugMessageArgs = {}): void {
  writer.writeByte(179);
  writer.writeInt(args.textId ?? 0);
  writer.writeFloat(args.value ?? 0);
  writer.writeInt(args.flags ?? 0);
}

export function encodeColorAttribute(writer: WireBufferWriter, args: ColorAttributeArgs = {}): void {
  writer.writeByte(180);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.colorId ?? 0);
  writer.writeShort(args.type ?? 0);
}

export function encodeMatrixFromPath(writer: WireBufferWriter, args: MatrixFromPathArgs = {}): void {
  writer.writeByte(181);
  writer.writeInt(args.pathId ?? 0);
  writer.writeFloat(args.percent ?? 0);
  writer.writeFloat(args.vOffset ?? 0);
  writer.writeInt(args.flags ?? 0);
}

export function encodeTextSubtext(writer: WireBufferWriter, args: TextSubtextArgs = {}): void {
  writer.writeByte(182);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.srcId1 ?? 0);
  writer.writeFloat(args.start ?? 0);
  writer.writeFloat(args.len ?? 0);
}

export function encodeBitmapTextMeasure(writer: WireBufferWriter, args: BitmapTextMeasureArgs = {}): void {
  writer.writeByte(183);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.bitmapFontId ?? 0);
  writer.writeInt(args.start ?? 0);
  writer.writeInt(args.end ?? 0);
  writer.writeFloat(args.glyphSpacing ?? 0);
}

export function encodeDrawBitmapTextAnchored(writer: WireBufferWriter, args: DrawBitmapTextAnchoredArgs = {}): void {
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

export function encodeRem(writer: WireBufferWriter, args: RemArgs = {}): void {
  writer.writeByte(185);
  writer.writeUTF8(args.text ?? '');
}

export function encodeMatrixConstant(writer: WireBufferWriter, args: MatrixConstantArgs = {}): void {
  writer.writeByte(186);
  writer.writeInt(args.matrixId ?? 0);
  writer.writeInt(args.type ?? 0);
  writer.writeFloatArray(args.values ?? []);
}

export function encodeMatrixExpression(writer: WireBufferWriter, args: MatrixExpressionArgs = {}): void {
  writer.writeByte(187);
  writer.writeInt(args.matrixId ?? 0);
  writer.writeInt(args.type ?? 0);
  writer.writeFloatArray(args.expression ?? []);
}

export function encodeMatrixVectorMath(writer: WireBufferWriter, args: MatrixVectorMathArgs = {}): void {
  writer.writeByte(188);
  writer.writeShort(args.type ?? 0);
  writer.writeIntArray(args.outputs ?? []);
  writer.writeInt(args.matrixId ?? 0);
  writer.writeFloatArray(args.inputs ?? []);
}

export function encodeFontData(writer: WireBufferWriter, args: FontDataArgs = {}): void {
  writer.writeByte(189);
  writer.writeInt(args.fontId ?? 0);
  writer.writeInt(args.type ?? 0);
  writer.writeByteArray(args.fontData ?? []);
}

export function encodeDrawToBitmap(writer: WireBufferWriter, args: DrawToBitmapArgs = {}): void {
  writer.writeByte(190);
  writer.writeInt(args.bitmapId ?? 0);
  writer.writeInt(args.mode ?? 0);
  writer.writeInt(args.color ?? 0);
}

export function encodeWakeIn(writer: WireBufferWriter, args: WakeInArgs = {}): void {
  writer.writeByte(191);
  writer.writeFloat(args.wake ?? 0);
}

export function encodeIdLookup(writer: WireBufferWriter, args: IdLookupArgs = {}): void {
  writer.writeByte(192);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.lookupId ?? 0);
  writer.writeFloat(args.value ?? 0);
}

export function encodePathExpression(writer: WireBufferWriter, args: PathExpressionArgs = {}): void {
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

export function encodeParticlesCompare(writer: WireBufferWriter, args: ParticlesCompareArgs = {}): void {
  writer.writeByte(194);
  writer.writeInt(args.id ?? 0);
  writer.writeShort(args.compOp ?? 0);
  writer.writeFloat(args.val1 ?? 0);
  writer.writeFloat(args.val2 ?? 0);
  writer.writeFloatArray(args.array1 ?? []);
  writer.writeInt(0);
  writer.writeInt(0);
}

export function encodeColorTheme(writer: WireBufferWriter, args: ColorThemeArgs = {}): void {
  writer.writeByte(196);
  writer.writeInt(args.id ?? 0);
  writer.writeInt(args.groupId ?? 0);
  writer.writeShort(args.lightMode ?? 0);
  writer.writeShort(args.darkMode ?? 0);
  writer.writeInt(args.lightModeFallback ?? 0);
  writer.writeInt(args.darkModeFallback ?? 0);
}

export function encodeDataDynamicListFloat(writer: WireBufferWriter, args: DataDynamicListFloatArgs = {}): void {
  writer.writeByte(197);
  writer.writeInt(args.id ?? 0);
  writer.writeFloat(args.length ?? 0);
}

export function encodeUpdateDynamicFloatList(writer: WireBufferWriter, args: UpdateDynamicFloatListArgs = {}): void {
  writer.writeByte(198);
  writer.writeInt(args.arrayId ?? 0);
  writer.writeFloat(args.index ?? 0);
  writer.writeFloat(args.value ?? 0);
}

export function encodeTextTransform(writer: WireBufferWriter, args: TextTransformArgs = {}): void {
  writer.writeByte(199);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.srcId1 ?? 0);
  writer.writeFloat(args.start ?? 0);
  writer.writeFloat(args.len ?? 0);
  writer.writeInt(args.operation ?? 0);
}

export function encodeRootLayout(writer: WireBufferWriter, args: RootLayoutArgs = {}): void {
  writer.writeByte(200);
  writer.writeInt(args.componentId ?? 0);
}

export function encodeLayoutContent(writer: WireBufferWriter, args: LayoutContentArgs = {}): void {
  writer.writeByte(201);
  writer.writeInt(args.componentId ?? 0);
}

export function encodeBoxLayout(writer: WireBufferWriter, args: BoxLayoutArgs = {}): void {
  writer.writeByte(202);
  writer.writeInt(args.COMPONENT_ID ?? 0);
  writer.writeInt(args.ANIMATION_ID ?? 0);
  writer.writeInt(args.HORIZONTAL_POSITIONING ?? 0);
  writer.writeInt(args.VERTICAL_POSITIONING ?? 0);
}

export function encodeRowLayout(writer: WireBufferWriter, args: RowLayoutArgs = {}): void {
  writer.writeByte(203);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeFloat(args.spacedBy ?? 0);
}

export function encodeColumnLayout(writer: WireBufferWriter, args: ColumnLayoutArgs = {}): void {
  writer.writeByte(204);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeFloat(args.spacedBy ?? 0);
}

export function encodeCanvasLayout(writer: WireBufferWriter, args: CanvasLayoutArgs = {}): void {
  writer.writeByte(205);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
}

export function encodeSoundExpression(writer: WireBufferWriter, args: SoundExpressionArgs = {}): void {
  writer.writeByte(206);
  writer.writeInt(args.id ?? 0);
  writer.writeFloat(args.leftVolume ?? 0);
  writer.writeFloat(args.rightVolume ?? 0);
  writer.writeFloat(args.rate ?? 0);
  writer.writeInt(args.paramsLength ?? 0);
  writer.writeFloatArray(args.params ?? []);
}

export function encodeCanvasContent(writer: WireBufferWriter, args: CanvasContentArgs = {}): void {
  writer.writeByte(207);
  writer.writeInt(args.COMPONENT_ID ?? 0);
}

export function encodeTextLayout(writer: WireBufferWriter, args: TextLayoutArgs = {}): void {
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

export function encodeHostAction(writer: WireBufferWriter, args: HostActionArgs = {}): void {
  writer.writeByte(209);
  writer.writeInt(args.ACTION_ID ?? 0);
}

export function encodeHostNamedAction(writer: WireBufferWriter, args: HostNamedActionArgs = {}): void {
  writer.writeByte(210);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.type ?? 0);
  writer.writeInt(args.valueId ?? 0);
}

export function encodeComponentVisibilityOperation(writer: WireBufferWriter, args: ComponentVisibilityOperationArgs = {}): void {
  writer.writeByte(211);
  writer.writeInt(args.visibilityId ?? 0);
}

export function encodeValueIntegerChangeActionOperation(writer: WireBufferWriter, args: ValueIntegerChangeActionOperationArgs = {}): void {
  writer.writeByte(212);
  writer.writeInt(args.targetValueId ?? 0);
  writer.writeInt(args.value ?? 0);
}

export function encodeValueStringChangeActionOperation(writer: WireBufferWriter, args: ValueStringChangeActionOperationArgs = {}): void {
  writer.writeByte(213);
  writer.writeInt(args.targetValueId ?? 0);
  writer.writeInt(args.valueId ?? 0);
}

export function encodeContainerEnd(writer: WireBufferWriter, args: ContainerEndArgs = {}): void {
  writer.writeByte(214);
}

export function encodeLoop(writer: WireBufferWriter, args: LoopArgs = {}): void {
  writer.writeByte(215);
  writer.writeInt(args.indexId ?? 0);
  writer.writeFloat(args.from ?? 0);
  writer.writeFloat(args.step ?? 0);
  writer.writeFloat(args.until ?? 0);
}

export function encodeHostActionMetadata(writer: WireBufferWriter, args: HostActionMetadataArgs = {}): void {
  writer.writeByte(216);
  writer.writeInt(args.ACTION_ID ?? 0);
  writer.writeInt(args.METADATA ?? 0);
}

export function encodeStateLayout(writer: WireBufferWriter, args: StateLayoutArgs = {}): void {
  writer.writeByte(217);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeInt(args.indexId ?? 0);
}

export function encodeValueIntegerExpressionChangeActionOperation(writer: WireBufferWriter, args: ValueIntegerExpressionChangeActionOperationArgs = {}): void {
  writer.writeByte(218);
  writer.writeLong(args.targetValueId ?? 0);
  writer.writeLong(args.valueExpressionId ?? 0);
}

export function encodeTouchModifier(writer: WireBufferWriter, args: TouchModifierArgs = {}): void {
  writer.writeByte(219);
}

export function encodeTouchUpModifier(writer: WireBufferWriter, args: TouchUpModifierArgs = {}): void {
  writer.writeByte(220);
}

export function encodeOffsetModifierOperation(writer: WireBufferWriter, args: OffsetModifierOperationArgs = {}): void {
  writer.writeByte(221);
  writer.writeFloat(args.x ?? 0);
  writer.writeFloat(args.y ?? 0);
}

export function encodeValueFloatChangeActionOperation(writer: WireBufferWriter, args: ValueFloatChangeActionOperationArgs = {}): void {
  writer.writeByte(222);
  writer.writeInt(args.targetValueId ?? 0);
  writer.writeFloat(args.value ?? 0);
}

export function encodeZIndexModifierOperation(writer: WireBufferWriter, args: ZIndexModifierOperationArgs = {}): void {
  writer.writeByte(223);
  writer.writeFloat(args.value ?? 0);
}

export function encodeGraphicsLayerModifierOperation(writer: WireBufferWriter, args: GraphicsLayerModifierOperationArgs = {}): void {
  writer.writeByte(224);
  writer.writeInt(0);
}

export function encodeTouchCancelModifier(writer: WireBufferWriter, args: TouchCancelModifierArgs = {}): void {
  writer.writeByte(225);
}

export function encodeScrollModifierOperation(writer: WireBufferWriter, args: ScrollModifierOperationArgs = {}): void {
  writer.writeByte(226);
  writer.writeInt(args.direction ?? 0);
  writer.writeFloat(args.position ?? 0);
  writer.writeFloat(args.max ?? 0);
  writer.writeFloat(args.notchMax ?? 0);
}

export function encodeValueFloatExpressionChangeActionOperation(writer: WireBufferWriter, args: ValueFloatExpressionChangeActionOperationArgs = {}): void {
  writer.writeByte(227);
  writer.writeInt(args.targetValueId ?? 0);
  writer.writeInt(args.valueExpressionId ?? 0);
}

export function encodeMarqueeModifierOperation(writer: WireBufferWriter, args: MarqueeModifierOperationArgs = {}): void {
  writer.writeByte(228);
  writer.writeInt(args.iterations ?? 0);
  writer.writeInt(args.animationMode ?? 0);
  writer.writeFloat(args.repeatDelayMillis ?? 0);
  writer.writeFloat(args.initialDelayMillis ?? 0);
  writer.writeFloat(args.spacing ?? 0);
  writer.writeFloat(args.velocity ?? 0);
}

export function encodeRippleModifier(writer: WireBufferWriter, args: RippleModifierArgs = {}): void {
  writer.writeByte(229);
}

export function encodeCollapsibleRow(writer: WireBufferWriter, args: CollapsibleRowArgs = {}): void {
  writer.writeByte(230);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeFloat(args.spacedBy ?? 0);
}

export function encodeWidthInModifierOperation(writer: WireBufferWriter, args: WidthInModifierOperationArgs = {}): void {
  writer.writeByte(231);
  writer.writeFloat(args.min ?? 0);
  writer.writeFloat(args.max ?? 0);
}

export function encodeHeightInModifierOperation(writer: WireBufferWriter, args: HeightInModifierOperationArgs = {}): void {
  writer.writeByte(232);
  writer.writeFloat(args.min ?? 0);
  writer.writeFloat(args.max ?? 0);
}

export function encodeCollapsibleColumn(writer: WireBufferWriter, args: CollapsibleColumnArgs = {}): void {
  writer.writeByte(233);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeFloat(args.spacedBy ?? 0);
}

export function encodeImageLayout(writer: WireBufferWriter, args: ImageLayoutArgs = {}): void {
  writer.writeByte(234);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.bitmapId ?? 0);
  writer.writeInt(args.scaleType ?? 0);
  writer.writeFloat(args.alpha ?? 0);
}

export function encodeCollapsiblePriorityModifierOperation(writer: WireBufferWriter, args: CollapsiblePriorityModifierOperationArgs = {}): void {
  writer.writeByte(235);
  writer.writeInt(args.orientation ?? 0);
  writer.writeFloat(args.priority ?? 0);
}

export function encodeRunAction(writer: WireBufferWriter, args: RunActionArgs = {}): void {
  writer.writeByte(236);
}

export function encodeAlignByModifierOperation(writer: WireBufferWriter, args: AlignByModifierOperationArgs = {}): void {
  writer.writeByte(237);
  writer.writeFloat(args.line ?? 0);
  writer.writeInt(args.flags ?? 0);
}

export function encodeLayoutCompute(writer: WireBufferWriter, args: LayoutComputeArgs = {}): void {
  writer.writeByte(238);
  writer.writeInt(args.type ?? 0);
  writer.writeInt(args.boundsId ?? 0);
  writer.writeBoolean(args.animateChanges ?? false);
}

export function encodeCoreText(writer: WireBufferWriter, args: CoreTextArgs = {}): void {
  writer.writeByte(239);
}

export function encodeFlowLayout(writer: WireBufferWriter, args: FlowLayoutArgs = {}): void {
  writer.writeByte(240);
  writer.writeInt(args.componentId ?? 0);
  writer.writeInt(args.animationId ?? 0);
  writer.writeInt(args.horizontalPositioning ?? 0);
  writer.writeInt(args.verticalPositioning ?? 0);
  writer.writeFloat(args.spacedBy ?? 0);
  writer.writeInt(args.maxItemsInEachRow ?? 0);
  writer.writeInt(args.maxLines ?? 0);
}

export function encodeSkip(writer: WireBufferWriter, args: SkipArgs = {}): void {
  writer.writeByte(241);
  writer.writeShort(args.Condition ?? 0);
  writer.writeInt(args.Value ?? 0);
  writer.writeInt(args.Length ?? 0);
}

export function encodeTextStyle(writer: WireBufferWriter, args: TextStyleArgs = {}): void {
  writer.writeByte(242);
}

export function encodeDimensionConstraintsModifierOperation(writer: WireBufferWriter, args: DimensionConstraintsModifierOperationArgs = {}): void {
  writer.writeByte(243);
  writer.writeByte(args.type ?? 0);
  writer.writeFloat(args.min ?? 0);
  writer.writeFloat(args.max ?? 0);
}

export function encodePatternForEach(writer: WireBufferWriter, args: PatternForEachArgs = {}): void {
  writer.writeByte(244);
  writer.writeInt(args.collectionId ?? 0);
  writer.writeInt(args.localItemId ?? 0);
  writer.writeInt(args.skipLength ?? 0);
}

export function encodeIncludeReferencedOperations(writer: WireBufferWriter, args: IncludeReferencedOperationsArgs = {}): void {
  writer.writeByte(245);
  writer.writeInt(args.ID ?? 0);
}

export function encodePatternDefine(writer: WireBufferWriter, args: PatternDefineArgs = {}): void {
  writer.writeByte(246);
  writer.writeInt(args.id ?? 0);
  writer.writeIntArray(args.paramIds ?? []);
  writer.writeInt(args.skipLength ?? 0);
}

export function encodePatternInflation(writer: WireBufferWriter, args: PatternInflationArgs = {}): void {
  writer.writeByte(247);
  writer.writeInt(args.id ?? 0);
  writer.writeIntArray(args.argIds ?? []);
}

export function encodePatternArgument(writer: WireBufferWriter, args: PatternArgumentArgs = {}): void {
  writer.writeByte(248);
  writer.writeInt(args.paramIndex ?? 0);
}

export function encodePatternBlock(writer: WireBufferWriter, args: PatternBlockArgs = {}): void {
  writer.writeByte(249);
  writer.writeInt(args.paramIndex ?? 0);
}

export function encodeCoreSemantics(writer: WireBufferWriter, args: CoreSemanticsArgs = {}): void {
  writer.writeByte(250);
  writer.writeInt(args.contentDescriptionId ?? 0);
  writer.writeByte(args.role ?? 0);
  writer.writeInt(args.textId ?? 0);
  writer.writeInt(args.stateDescriptionId ?? 0);
  writer.writeInt(args.mode ?? 0);
  writer.writeBoolean(args.enabled ?? false);
  writer.writeBoolean(args.clickable ?? false);
}

export function encodeExtensionRangeReserved4(writer: WireBufferWriter, args: ExtensionRangeReserved4Args = {}): void {
  writer.writeByte(251);
}

export function encodeExtensionRangeReserved3(writer: WireBufferWriter, args: ExtensionRangeReserved3Args = {}): void {
  writer.writeByte(252);
}

export function encodeExtensionRangeReserved2(writer: WireBufferWriter, args: ExtensionRangeReserved2Args = {}): void {
  writer.writeByte(253);
}

export function encodeExtensionRangeReserved1(writer: WireBufferWriter, args: ExtensionRangeReserved1Args = {}): void {
  writer.writeByte(254);
}

export function encodeExtendedOpcode(writer: WireBufferWriter, args: ExtendedOpcodeArgs = {}): void {
  writer.writeByte(255);
}

export interface RemoteDocumentJSON {
  header?: Record<string, any>;
  root: Record<string, any>;
  resources?: Record<string, any>;
}

export class RemoteComposeSerializer {
  private autoId: number = -1;

  private nextComponentId(): number {
    this.autoId--;
    return this.autoId;
  }

  public serialize(doc: RemoteDocumentJSON | string): Uint8Array {
    const json: RemoteDocumentJSON = typeof doc === 'string' ? JSON.parse(doc) : doc;
    const writer = new WireBufferWriter();

    this.autoId = -1;

    const header = json.header || {};
    encodeHeader(writer, {
      width: header.width ?? 400,
      height: header.height ?? 400,
      density: 1.0,
      capabilities: BigInt(header.profiles ?? 771),
    });

    const rootId = this.nextComponentId();
    writer.writeByte(200);
    writer.writeInt(rootId);

    if (json.root) {
      this.compileComponent(json.root, writer);
    }

    encodeContainerEnd(writer);

    return writer.toUint8Array();
  }

  private compileComponent(node: Record<string, any>, writer: WireBufferWriter): void {
    const canvasId = this.nextComponentId();
    writer.writeByte(205);
    writer.writeInt(canvasId);
    writer.writeInt(-1);
    encodeContainerEnd(writer);
  }
}
