#include "rccore/Operations.h"
#include "rccore/operations/Header.h"
#include "rccore/operations/DrawOperations.h"
#include "rccore/operations/AdvancedOperations.h"
#include "rccore/operations/LayoutOperations.h"

namespace rccore {

std::unordered_map<int, ReaderFn> Operations::sReaders;
std::unordered_map<int, std::string> Operations::sNames;
bool Operations::sInitialized = false;

// Skip system info defaults — pin to the highest baseline we know about
// (v7 androidx) so docs targeting the latest features are accepted by
// default. Override at runtime via Skip::setSystemInfo() if needed.
int Skip::sLibraryApiLevel = 7;
int Skip::sProfile = 0;

void Operations::registerReader(int opcode, const std::string& name, ReaderFn fn) {
    sReaders[opcode] = fn;
    sNames[opcode] = name;
}

ReaderFn Operations::getReader(int opcode) {
    if (!sInitialized) init();
    auto it = sReaders.find(opcode);
    return it != sReaders.end() ? it->second : nullptr;
}

std::string Operations::getName(int opcode) {
    if (!sInitialized) init();
    auto it = sNames.find(opcode);
    return it != sNames.end() ? it->second : "UNKNOWN_" + std::to_string(opcode);
}

void Operations::init() {
    if (sInitialized) return;
    sInitialized = true;

    // ── Protocol & data ────────────────────────────────────────────────
    registerReader(HEADER, "HEADER", Header::read);
    registerReader(DATA_TEXT, "DATA_TEXT", TextData::read);
    registerReader(DATA_BITMAP, "DATA_BITMAP", BitmapData::read);
    registerReader(PATH_DATA, "PATH_DATA", PathDataOp::read);
    registerReader(DATA_FLOAT, "DATA_FLOAT", FloatConstant::read);
    registerReader(DATA_INT, "DATA_INT", IntegerConstant::read);
    registerReader(DATA_BOOLEAN, "DATA_BOOLEAN", BooleanConstant::read);
    registerReader(DATA_LONG, "DATA_LONG", LongConstant::read);
    registerReader(COLOR_CONSTANT, "COLOR_CONSTANT", ColorConstant::read);
    registerReader(NAMED_VARIABLE, "NAMED_VARIABLE", NamedVariable::read);
    registerReader(SHADER_DATA, "SHADER_DATA", ShaderData::read);

    // ── Expressions ────────────────────────────────────────────────────
    registerReader(ANIMATED_FLOAT, "ANIMATED_FLOAT", FloatExpression::read);
    registerReader(COLOR_EXPRESSION, "COLOR_EXPRESSIONS", ColorExpressionOp::read);
    registerReader(INTEGER_EXPRESSION, "IntegerExpression", IntegerExpressionOp::read);
    registerReader(TOUCH_EXPRESSION, "TouchExpression", TouchExpressionOp::read);

    // ── Text operations ────────────────────────────────────────────────
    registerReader(TEXT_FROM_FLOAT, "TextFromFloat", TextFromFloat::read);
    registerReader(TEXT_MERGE, "TextMerge", TextMerge::read);
    registerReader(TEXT_LOOKUP, "TEXT_LOOKUP", TextLookupOp::read);
    registerReader(TEXT_TRANSFORM, "TextTransform", TextTransformOp::read);
    registerReader(COMPONENT_VALUE, "COMPONENT_VALUE", ComponentValueOp::read);

    // ── Data collections ───────────────────────────────────────────────
    registerReader(DATA_LIST_FLOAT, "DataListFloat", DataListFloat::read);
    registerReader(DATA_LIST_IDS, "DataListIds", DataListIds::read);
    registerReader(DATA_DYNAMIC_LIST_FLOAT, "DataDynamicListFloat", DataDynamicListFloat::read);
    registerReader(UPDATE_DYNAMIC_FLOAT_LIST, "UPDATE_DYNAMIC_FLOAT_LIST", UpdateDynamicFloatListOp::read);

    // ── Paint ──────────────────────────────────────────────────────────
    registerReader(PAINT_VALUES, "PAINT_VALUES", PaintValues::read);

    // ── Draw ───────────────────────────────────────────────────────────
    registerReader(DRAW_RECT, "DRAW_RECT", DrawRect::read);
    registerReader(DRAW_CIRCLE, "DRAW_CIRCLE", DrawCircle::read);
    registerReader(DRAW_LINE, "DRAW_LINE", DrawLine::read);
    registerReader(DRAW_OVAL, "DRAW_OVAL", DrawOval::read);
    registerReader(DRAW_ROUND_RECT, "DRAW_ROUND_RECT", DrawRoundRect::read);
    registerReader(DRAW_SECTOR, "DRAW_SECTOR", DrawSector::read);
    registerReader(DRAW_ARC, "DRAW_ARC", DrawArc::read);
    registerReader(DRAW_PATH, "DRAW_PATH", DrawPath::read);
    registerReader(DRAW_TWEEN_PATH, "DRAW_TWEEN_PATH", DrawTweenPath::read);
    registerReader(DRAW_BITMAP, "DRAW_BITMAP", DrawBitmap::read);
    registerReader(DRAW_BITMAP_INT, "DRAW_BITMAP_INT", DrawBitmapInt::read);
    registerReader(DRAW_BITMAP_SCALED, "DRAW_BITMAP_SCALED", DrawBitmapScaled::read);
    registerReader(DRAW_TEXT_RUN, "DRAW_TEXT_RUN", DrawTextRun::read);
    registerReader(DRAW_TEXT_ANCHORED, "DRAW_TEXT_ANCHOR", DrawTextAnchored::read);
    registerReader(DRAW_TEXT_ON_PATH, "DRAW_TEXT_ON_PATH", DrawTextOnPath::read);
    registerReader(DRAW_CONTENT, "DrawContent", DrawContentOp::read);
    registerReader(CANVAS_OPERATIONS, "CanvasOperations", CanvasOperationsOp::read);

    // ── Clip ───────────────────────────────────────────────────────────
    registerReader(CLIP_RECT, "CLIP_RECT", ClipRectOp::read);
    registerReader(CLIP_PATH, "CLIP_PATH", ClipPathOp::read);

    // ── Matrix ─────────────────────────────────────────────────────────
    registerReader(MATRIX_SAVE, "MATRIX_SAVE", MatrixSave::read);
    registerReader(MATRIX_RESTORE, "MATRIX_RESTORE", MatrixRestore::read);
    registerReader(MATRIX_SCALE, "MATRIX_SCALE", MatrixScale::read);
    registerReader(MATRIX_TRANSLATE, "MATRIX_TRANSLATE", MatrixTranslate::read);
    registerReader(MATRIX_ROTATE, "MATRIX_ROTATE", MatrixRotate::read);
    registerReader(MATRIX_SKEW, "MATRIX_SKEW", MatrixSkew::read);
    registerReader(MATRIX_FROM_PATH, "MATRIX_FROM_PATH", MatrixFromPathOp::read);
    registerReader(MATRIX_CONSTANT, "MATRIX_CONSTANT", MatrixConstantOp::read);
    registerReader(MATRIX_EXPRESSION, "MatrixExpression", MatrixExpressionOp::read);
    registerReader(MATRIX_VECTOR_MATH, "MatrixVectorMath", MatrixVectorMathOp::read);

    // ── Path operations ────────────────────────────────────────────────
    registerReader(PATH_TWEEN, "PATH_TWEEN", PathTweenOp::read);
    registerReader(PATH_CREATE, "PATH_CREATE", PathCreateOp::read);
    registerReader(PATH_APPEND, "PathAppend", PathAppendOp::read);
    registerReader(PATH_EXPRESSION, "PathExpression", PathExpressionOp::read);
    registerReader(PATH_COMBINE, "PATH_COMBINE", PathCombineOp::read);

    // ── Layout containers ──────────────────────────────────────────────
    registerReader(CONTAINER_END, "CONTAINER_END", ContainerEnd::read);
    registerReader(LAYOUT_ROOT, "LAYOUT_ROOT", LayoutRoot::read);
    registerReader(LAYOUT_COMPONENT_CONTENT, "LayoutComponentContent", LayoutComponentContent::read);
    registerReader(LAYOUT_BOX, "LAYOUT_BOX", LayoutBox::read);
    registerReader(LAYOUT_ROW, "LAYOUT_ROW", LayoutRow::read);
    registerReader(LAYOUT_COLUMN, "LAYOUT_COLUMN", LayoutColumn::read);
    registerReader(LAYOUT_CANVAS, "LAYOUT_CANVAS", LayoutCanvas::read);
    registerReader(CANVAS_CONTENT, "CanvasContent", CanvasContent::read);
    registerReader(LAYOUT_STATE, "StateLayout", StateLayout::read);
    registerReader(LAYOUT_TEXT, "LAYOUT_TEXT", LayoutText::read);
    registerReader(239, "CoreText", CoreTextOp::read);  // CoreText uses 239
    registerReader(LAYOUT_FLOW, "LAYOUT_FLOW", LayoutFlow::read);
    registerReader(LAYOUT_COMPUTE, "LAYOUT_COMPUTE", LayoutCompute::read);
    registerReader(LOOP_OPERATION, "LoopOperation", LoopOperationOp::read);
    registerReader(CONDITIONAL_OPERATIONS, "ConditionalOperations", ConditionalOp::read);

    // ── Modifiers ──────────────────────────────────────────────────────
    registerReader(MODIFIER_WIDTH, "MODIFIER_WIDTH", ModifierWidth::read);
    registerReader(MODIFIER_HEIGHT, "MODIFIER_HEIGHT", ModifierHeight::read);
    registerReader(MODIFIER_BACKGROUND, "MODIFIER_BACKGROUND", ModifierBackground::read);
    registerReader(MODIFIER_BORDER, "MODIFIER_BORDER", ModifierBorder::read);
    registerReader(MODIFIER_PADDING, "MODIFIER_PADDING", ModifierPadding::read);
    registerReader(MODIFIER_CLICK, "MODIFIER_CLICK", ModifierClick::read);
    registerReader(MODIFIER_MULTI_CLICK, "MODIFIER_MULTI_CLICK", ModifierMultiClick::read);
    registerReader(MODIFIER_DIMENSION_CONSTRAINTS, "MODIFIER_DIMENSION_CONSTRAINTS",
                   ModifierDimensionConstraints::read);
    registerReader(MODIFIER_CLIP_RECT, "ClipRectModifierOperation", ModifierClipRect::read);
    registerReader(MODIFIER_ROUNDED_CLIP_RECT, "RoundedClipRectModifierOperation", ModifierRoundedClipRect::read);
    registerReader(MODIFIER_VISIBILITY, "MODIFIER_VISIBILITY", ModifierVisibility::read);
    registerReader(MODIFIER_ALIGN_BY, "MODIFIER_ALIGN_BY", ModifierAlignBy::read);
    registerReader(MODIFIER_WIDTH_IN, "MODIFIER_WIDTH_IN", ModifierWidthIn::read);
    registerReader(MODIFIER_HEIGHT_IN, "MODIFIER_HEIGHT_IN", ModifierHeightIn::read);
    registerReader(MODIFIER_OFFSET, "MODIFIER_OFFSET", ModifierOffset::read);
    registerReader(MODIFIER_ZINDEX, "MODIFIER_ZINDEX", ModifierZIndex::read);
    registerReader(MODIFIER_TOUCH_DOWN, "MODIFIER_TOUCH_DOWN", ModifierTouchDown::read);
    registerReader(MODIFIER_TOUCH_UP, "MODIFIER_TOUCH_UP", ModifierTouchUp::read);
    registerReader(MODIFIER_TOUCH_CANCEL, "MODIFIER_TOUCH_CANCEL", ModifierTouchCancel::read);
    registerReader(MODIFIER_SCROLL, "ScrollModifierOperation", ModifierScroll::read);
    registerReader(MODIFIER_RIPPLE, "MODIFIER_RIPPLE", ModifierRipple::read);
    registerReader(ANIMATION_SPEC, "ANIMATION_SPEC", AnimationSpec::read);

    // ── Other ──────────────────────────────────────────────────────────
    registerReader(THEME, "THEME", ThemeOp::read);
    registerReader(ROOT_CONTENT_DESCRIPTION, "ROOT_CONTENT_DESCRIPTION", RootContentDescription::read);
    registerReader(CLICK_AREA, "CLICK_AREA", ClickArea::read);
    registerReader(ROOT_CONTENT_BEHAVIOR, "ROOT_CONTENT_BEHAVIOR", RootContentBehavior::read);
    registerReader(DEBUG_MESSAGE, "DEBUG_MESSAGE", DebugMessageOp::read);
    registerReader(COLOR_THEME, "COLOR_THEME", ColorThemeOp::read);

    // ── Actions ────────────────────────────────────────────────────────
    registerReader(HOST_ACTION, "HOST_ACTION", HostActionOp::read);
    registerReader(HOST_ACTION_LIST, "HostActionList", HostActionListOp::read);
    registerReader(HOST_SCROLL_ACTION, "HostActionMetadataOperation", HostActionMetadataOp::read);
    registerReader(VALUE_FLOAT_CHANGE, "ValueFloatExpressionChangeActionOperation", ValueFloatChangeOp::read);
    registerReader(VALUE_INTEGER_CHANGE, "VALUE_INTEGER_CHANGE_ACTION", ValueIntChangeOp::read);
    registerReader(VALUE_STRING_CHANGE, "VALUE_STRING_CHANGE_ACTION", ValueStringChangeOp::read);
    registerReader(VALUE_BOOLEAN_CHANGE, "ValueBooleanChange", ValueBooleanChangeOp::read);
    registerReader(VALUE_LONG_CHANGE, "ValueLongChange", ValueLongChangeOp::read);
    registerReader(RUN_ACTION, "RUN_ACTION", RunActionOp::read);

    // ── Additional operations ────────────────────────────────────────
    registerReader(170, "TextAttribute", TextAttributeOp::read);
    registerReader(MODIFIER_GRAPHICS_LAYER, "GraphicsLayerModifier", ModifierGraphicsLayer::read);
    registerReader(DATA_MAP_IDS, "DataMapIds", DataMapIdsOp::read);
    registerReader(DATA_MAP_LOOKUP, "DataMapLookup", DataMapLookupOp::read);
    registerReader(TEXT_MEASURE, "TextMeasure", TextMeasureOp::read);
    registerReader(TEXT_LENGTH, "TextLength", TextLengthOp::read);
    registerReader(TEXT_SUBTEXT, "TextSubtext", TextSubtextOp::read);
    registerReader(ID_LOOKUP, "IdLookup", IdLookupOp::read);
    registerReader(PARTICLES_CREATE, "ParticlesCreate", ParticlesCreateOp::read);
    registerReader(PARTICLES_LOOP, "ParticlesLoop", ParticlesLoopOp::read);
    registerReader(PARTICLES_COMPARE, "ParticlesCompare", ParticlesCompareOp::read);
    registerReader(IMPULSE_OPERATION, "ImpulseOperation", ImpulseOperationOp::read);
    registerReader(IMPULSE_PROCESS, "ImpulseProcess", ImpulseProcessOp::read);
    registerReader(DRAW_TO_BITMAP, "DrawToBitmap", DrawToBitmapOp::read);
    registerReader(COLLAPSIBLE_ROW_LAYOUT, "CollapsibleRowLayout", CollapsibleRowLayout::read);
    registerReader(COLLAPSIBLE_COLUMN_LAYOUT, "CollapsibleColumnLayout", CollapsibleColumnLayout::read);
    registerReader(FIT_BOX_LAYOUT, "FitBoxLayout", FitBoxLayout::read);
    registerReader(DRAW_CONTENT_MODIFIER, "DrawContentModifier", DrawContentModifierOp::read);
    registerReader(MODIFIER_COLLAPSIBLE_PRIORITY, "MODIFIER_COLLAPSIBLE_PRIORITY", ModifierCollapsiblePriority::read);
    registerReader(MODIFIER_MARQUEE, "MarqueeModifier", ModifierMarquee::read);
    registerReader(LAYOUT_IMAGE, "LAYOUT_IMAGE", LayoutImage::read);

    // ── Attribute extraction ─────────────────────────────────────────────
    registerReader(ATTRIBUTE_COLOR, "ATTRIBUTE_COLOR", ColorAttributeOp::read);
    registerReader(ATTRIBUTE_IMAGE, "ATTRIBUTE_IMAGE", ImageAttributeOp::read);
    registerReader(172, "TIME_ATTRIBUTE", TimeAttributeOp::read);

    // ── Bitmap font ─────────────────────────────────────────────────────
    registerReader(DATA_BITMAP_FONT, "DATA_BITMAP_FONT", BitmapFontDataOp::read);
    registerReader(DRAW_BITMAP_FONT_TEXT_RUN, "DRAW_BITMAP_FONT_TEXT_RUN", DrawBitmapFontTextOp::read);

    // ── Stubs (parse-only, no rendering effect) ────────────────────────
    registerReader(HAPTIC_FEEDBACK, "HAPTIC_FEEDBACK", HapticFeedbackOp::read);
    registerReader(WAKE_IN, "WAKE_IN", WakeInOp::read);

    // ── New baseline ops since 2026-03-16 ───────────────────────────────
    registerReader(SKIP, "SKIP", Skip::read);
    registerReader(TEXT_STYLE, "TEXT_STYLE", TextStyleOp::read);
}

} // namespace rccore
