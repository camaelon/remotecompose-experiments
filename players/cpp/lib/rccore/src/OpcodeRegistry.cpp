#include "rccore/OpcodeRegistry.h"

namespace rccore {

std::unordered_map<int, OpSpec> OpcodeRegistry::sSpecs;
bool OpcodeRegistry::sInitialized = false;

void OpcodeRegistry::reg(OpSpec spec) {
    sSpecs[spec.opcode] = std::move(spec);
}

const OpSpec* OpcodeRegistry::get(int opcode) {
    if (!sInitialized) init();
    auto it = sSpecs.find(opcode);
    return it != sSpecs.end() ? &it->second : nullptr;
}

void OpcodeRegistry::init() {
    if (sInitialized) return;
    sInitialized = true;

    using FT = FieldType;

    // Protocol & Data
    reg({0, "HEADER", {{"major", FT::INT}, {"minor", FT::INT}, {"patch", FT::INT},
        {"width", FT::INT}, {"height", FT::INT}, {"capabilities", FT::LONG}}, true, false});
    reg({102, "DATA_TEXT", {{"textId", FT::INT}, {"text", FT::UTF8}}});
    reg({80, "DATA_FLOAT", {{"id", FT::INT}, {"value", FT::FLOAT}}});
    reg({81, "ANIMATED_FLOAT", {{"id", FT::INT}, {"animationLen", FT::SHORT},
        {"expressionLen", FT::SHORT}, {"expression", FT::FLOAT_ARRAY},
        {"animation", FT::FLOAT_ARRAY_BASE64}}, false, true});
    reg({140, "DATA_INT", {{"id", FT::INT}, {"value", FT::INT}}});
    reg({148, "DATA_LONG", {{"id", FT::INT}, {"value", FT::LONG}}});
    reg({143, "DATA_BOOLEAN", {{"id", FT::INT}, {"value", FT::BOOLEAN}}});
    reg({101, "DATA_BITMAP", {{"imageId", FT::INT}, {"widthAndType", FT::INT},
        {"heightAndEncoding", FT::INT}, {"bitmap", FT::BUFFER}}});
    reg({167, "DATA_BITMAP_FONT", {{"id", FT::INT}, {"versionAndNumGlyphs", FT::INT}}, true, false});
    reg({63, "THEME", {{"theme", FT::INT}}});
    reg({64, "CLICK_AREA", {{"id", FT::INT}, {"contentDescriptionId", FT::INT},
        {"left", FT::FLOAT}, {"top", FT::FLOAT}, {"right", FT::FLOAT}, {"bottom", FT::FLOAT},
        {"metadataId", FT::INT}}});
    reg({103, "ROOT_CONTENT_DESCRIPTION", {{"contentDescriptionId", FT::INT}}});
    reg({137, "NAMED_VARIABLE", {{"varId", FT::INT}, {"varType", FT::INT}, {"name", FT::UTF8}}});

    // Basic Draw Commands
    reg({42, "DRAW_RECT", {{"left", FT::FLOAT}, {"top", FT::FLOAT},
        {"right", FT::FLOAT}, {"bottom", FT::FLOAT}}});
    reg({47, "DRAW_LINE", {{"x1", FT::FLOAT}, {"y1", FT::FLOAT},
        {"x2", FT::FLOAT}, {"y2", FT::FLOAT}}});
    reg({46, "DRAW_CIRCLE", {{"centerX", FT::FLOAT}, {"centerY", FT::FLOAT},
        {"radius", FT::FLOAT}}});
    reg({56, "DRAW_OVAL", {{"left", FT::FLOAT}, {"top", FT::FLOAT},
        {"right", FT::FLOAT}, {"bottom", FT::FLOAT}}});
    reg({51, "DRAW_ROUND_RECT", {{"left", FT::FLOAT}, {"top", FT::FLOAT},
        {"right", FT::FLOAT}, {"bottom", FT::FLOAT},
        {"radiusX", FT::FLOAT}, {"radiusY", FT::FLOAT}}});
    reg({152, "DRAW_ARC", {{"left", FT::FLOAT}, {"top", FT::FLOAT},
        {"right", FT::FLOAT}, {"bottom", FT::FLOAT},
        {"startAngle", FT::FLOAT}, {"sweepAngle", FT::FLOAT}}});
    reg({52, "DRAW_SECTOR", {{"left", FT::FLOAT}, {"top", FT::FLOAT},
        {"right", FT::FLOAT}, {"bottom", FT::FLOAT},
        {"startAngle", FT::FLOAT}, {"sweepAngle", FT::FLOAT}}});
    reg({44, "DRAW_BITMAP", {{"imageId", FT::INT}, {"left", FT::FLOAT}, {"top", FT::FLOAT},
        {"right", FT::FLOAT}, {"bottom", FT::FLOAT}, {"descriptionId", FT::INT}}});
    reg({66, "DRAW_BITMAP_INT", {{"imageId", FT::INT},
        {"srcLeft", FT::INT}, {"srcTop", FT::INT}, {"srcRight", FT::INT}, {"srcBottom", FT::INT},
        {"dstLeft", FT::INT}, {"dstTop", FT::INT}, {"dstRight", FT::INT}, {"dstBottom", FT::INT},
        {"contentDescriptionId", FT::INT}}});
    reg({149, "DRAW_BITMAP_SCALED", {{"imageId", FT::INT},
        {"srcLeft", FT::FLOAT}, {"srcTop", FT::FLOAT}, {"srcRight", FT::FLOAT}, {"srcBottom", FT::FLOAT},
        {"dstLeft", FT::FLOAT}, {"dstTop", FT::FLOAT}, {"dstRight", FT::FLOAT}, {"dstBottom", FT::FLOAT},
        {"scaleType", FT::INT}, {"scaleFactor", FT::FLOAT}, {"descriptionId", FT::INT}}});
    reg({43, "DRAW_TEXT_RUN", {{"textId", FT::INT}, {"start", FT::INT}, {"end", FT::INT},
        {"contextStart", FT::INT}, {"contextEnd", FT::INT},
        {"x", FT::FLOAT}, {"y", FT::FLOAT}, {"rtl", FT::BOOLEAN}}});
    reg({48, "DRAW_BITMAP_FONT_TEXT_RUN", {{"textId", FT::INT}}, true, false});
    reg({53, "DRAW_TEXT_ON_PATH", {{"textId", FT::INT}, {"pathId", FT::INT},
        {"hOffset", FT::FLOAT}, {"vOffset", FT::FLOAT}}});
    reg({57, "DRAW_TEXT_ON_CIRCLE", {{"textId", FT::INT}, {"centerX", FT::FLOAT},
        {"centerY", FT::FLOAT}, {"radius", FT::FLOAT}, {"startAngle", FT::FLOAT},
        {"warpRadiusOffset", FT::FLOAT}, {"alignment", FT::BYTE}, {"placement", FT::BYTE}}});
    reg({133, "DRAW_TEXT_ANCHOR", {{"textId", FT::INT}, {"x", FT::FLOAT}, {"y", FT::FLOAT},
        {"panX", FT::FLOAT}, {"panY", FT::FLOAT}, {"flags", FT::INT}}});
    reg({125, "DRAW_TWEEN_PATH", {{"path1Id", FT::INT}, {"path2Id", FT::INT},
        {"tween", FT::FLOAT}, {"start", FT::FLOAT}, {"stop", FT::FLOAT}}});
    reg({124, "DRAW_PATH", {{"pathId", FT::INT}}});
    reg({38, "CLIP_PATH", {{"pathId", FT::INT}}});
    reg({39, "CLIP_RECT", {{"left", FT::FLOAT}, {"top", FT::FLOAT},
        {"right", FT::FLOAT}, {"bottom", FT::FLOAT}}});
    reg({40, "PAINT_VALUES", {{"length", FT::INT}}, true, false});

    // Matrix
    reg({127, "MATRIX_TRANSLATE", {{"dx", FT::FLOAT}, {"dy", FT::FLOAT}}});
    reg({126, "MATRIX_SCALE", {{"scaleX", FT::FLOAT}, {"scaleY", FT::FLOAT},
        {"centerX", FT::FLOAT}, {"centerY", FT::FLOAT}}});
    reg({129, "MATRIX_ROTATE", {{"angle", FT::FLOAT}, {"centerX", FT::FLOAT},
        {"centerY", FT::FLOAT}}});
    reg({128, "MATRIX_SKEW", {{"skewX", FT::FLOAT}, {"skewY", FT::FLOAT}}});
    reg({130, "MATRIX_SAVE", {}});
    reg({131, "MATRIX_RESTORE", {}});
    reg({186, "MATRIX_CONSTANT", {{"id", FT::INT}, {"type", FT::INT}}, true, false});

    // Path
    reg({158, "PATH_TWEEN", {{"outId", FT::INT}, {"pathId1", FT::INT},
        {"pathId2", FT::INT}, {"tween", FT::FLOAT}}});
    reg({159, "PATH_CREATE", {{"id", FT::INT}, {"startX", FT::FLOAT}, {"startY", FT::FLOAT}}});

    // Layout Components
    reg({200, "LAYOUT_ROOT", {{"componentId", FT::INT}}});
    reg({2, "COMPONENT_START", {{"type", FT::INT}, {"componentId", FT::INT},
        {"x", FT::FLOAT}, {"y", FT::FLOAT}}});
    reg({202, "LAYOUT_BOX", {{"componentId", FT::INT}, {"animationId", FT::INT},
        {"horizontal", FT::INT}, {"vertical", FT::INT}}});
    reg({204, "LAYOUT_COLUMN", {{"componentId", FT::INT}, {"animationId", FT::INT},
        {"horizontal", FT::INT}, {"vertical", FT::INT}, {"spacedBy", FT::FLOAT}}});
    reg({203, "LAYOUT_ROW", {{"componentId", FT::INT}, {"animationId", FT::INT},
        {"horizontal", FT::INT}, {"vertical", FT::INT}, {"spacedBy", FT::FLOAT}}});
    reg({240, "LAYOUT_FLOW", {{"componentId", FT::INT}, {"animationId", FT::INT},
        {"horizontal", FT::INT}, {"vertical", FT::INT}, {"spacedBy", FT::FLOAT}}});
    reg({208, "LAYOUT_TEXT", {{"componentId", FT::INT}, {"animationId", FT::INT},
        {"textId", FT::INT}, {"color", FT::INT}, {"fontSize", FT::FLOAT},
        {"fontStyle", FT::INT}, {"fontWeight", FT::FLOAT}, {"fontFamilyId", FT::INT},
        {"textAlign", FT::INT}, {"overflow", FT::INT}, {"maxLines", FT::INT}}});
    reg({234, "LAYOUT_IMAGE", {{"componentId", FT::INT}, {"animationId", FT::INT},
        {"bitmapId", FT::INT}, {"scaleType", FT::INT}, {"alpha", FT::FLOAT}}});
    reg({205, "LAYOUT_CANVAS", {{"componentId", FT::INT}, {"animationId", FT::INT}}});
    reg({214, "CONTAINER_END", {}});

    // Modifiers
    reg({58, "MODIFIER_PADDING", {{"left", FT::FLOAT}, {"top", FT::FLOAT},
        {"right", FT::FLOAT}, {"bottom", FT::FLOAT}}});
    reg({16, "MODIFIER_WIDTH", {{"type", FT::INT}, {"width", FT::FLOAT}}});
    reg({67, "MODIFIER_HEIGHT", {{"type", FT::INT}, {"height", FT::FLOAT}}});
    reg({231, "MODIFIER_WIDTH_IN", {{"min", FT::FLOAT}, {"max", FT::FLOAT}}});
    reg({232, "MODIFIER_HEIGHT_IN", {{"min", FT::FLOAT}, {"max", FT::FLOAT}}});
    reg({235, "MODIFIER_COLLAPSIBLE_PRIORITY", {{"priority", FT::INT}}});
    reg({211, "MODIFIER_VISIBILITY", {{"visibilityId", FT::INT}}});
    reg({221, "MODIFIER_OFFSET", {{"x", FT::FLOAT}, {"y", FT::FLOAT}}});
    reg({223, "MODIFIER_ZINDEX", {{"zIndex", FT::FLOAT}}});
    reg({55, "MODIFIER_BACKGROUND", {{"flags", FT::INT}, {"colorId", FT::INT},
        {"reserve1", FT::INT}, {"reserve2", FT::INT},
        {"r", FT::FLOAT}, {"g", FT::FLOAT}, {"b", FT::FLOAT}, {"a", FT::FLOAT},
        {"shapeType", FT::INT}}});
    reg({107, "MODIFIER_BORDER", {{"flags", FT::INT}, {"colorId", FT::INT},
        {"reserve1", FT::INT}, {"reserve2", FT::INT},
        {"borderWidth", FT::FLOAT}, {"roundedCorner", FT::FLOAT},
        {"r", FT::FLOAT}, {"g", FT::FLOAT}, {"b", FT::FLOAT}, {"a", FT::FLOAT},
        {"shapeType", FT::INT}}});
    reg({237, "MODIFIER_ALIGN_BY", {{"line", FT::FLOAT}, {"flags", FT::INT}}});
    reg({238, "LAYOUT_COMPUTE", {{"type", FT::INT}, {"boundsId", FT::INT},
        {"animateChanges", FT::BOOLEAN}}});
    reg({229, "MODIFIER_RIPPLE", {}});
    reg({59, "MODIFIER_CLICK", {}});
    reg({219, "MODIFIER_TOUCH_DOWN", {}});
    reg({220, "MODIFIER_TOUCH_UP", {}});
    reg({225, "MODIFIER_TOUCH_CANCEL", {}});

    // Actions
    reg({236, "RUN_ACTION", {}});
    reg({209, "HOST_ACTION", {{"actionId", FT::INT}}});
    reg({222, "VALUE_FLOAT_CHANGE_ACTION", {{"targetValueId", FT::INT}, {"value", FT::FLOAT}}});
    reg({212, "VALUE_INTEGER_CHANGE_ACTION", {{"targetValueId", FT::INT}, {"value", FT::INT}}});
    reg({213, "VALUE_STRING_CHANGE_ACTION", {{"targetValueId", FT::INT}, {"value", FT::UTF8}}});

    // Colors
    reg({138, "COLOR_CONSTANT", {{"id", FT::INT}, {"color", FT::INT}}});
    reg({134, "COLOR_EXPRESSIONS", {{"id", FT::INT}, {"p1", FT::INT}, {"p2", FT::INT},
        {"p3", FT::INT}, {"p4", FT::INT}}, true, false});

    // Other Utilities
    reg({14, "ANIMATION_SPEC", {{"animationId", FT::INT}, {"motionDuration", FT::FLOAT},
        {"motionEasingType", FT::INT}, {"visibilityDuration", FT::FLOAT},
        {"visibilityEasingType", FT::INT}, {"enterAnimation", FT::INT},
        {"exitAnimation", FT::INT}}});
    reg({198, "UPDATE_DYNAMIC_FLOAT_LIST", {{"id", FT::INT}, {"index", FT::FLOAT},
        {"value", FT::FLOAT}}});
    reg({151, "TEXT_LOOKUP", {{"id", FT::INT}, {"dataSet", FT::INT}, {"index", FT::FLOAT}}});
    reg({153, "TEXT_LOOKUP_INT", {{"id", FT::INT}, {"dataSet", FT::INT}, {"index", FT::INT}}});
    reg({154, "DATA_MAP_LOOKUP", {{"id", FT::INT}, {"dataMapId", FT::INT}, {"stringId", FT::INT}}});
    reg({155, "TEXT_MEASURE", {{"id", FT::INT}, {"textId", FT::INT}, {"mode", FT::INT}}});
    reg({156, "TEXT_LENGTH", {{"id", FT::INT}, {"textId", FT::INT}}});
    reg({182, "TEXT_SUBTEXT", {{"textId", FT::INT}, {"srcId1", FT::INT},
        {"start", FT::FLOAT}, {"len", FT::FLOAT}}});
    reg({150, "COMPONENT_VALUE", {{"type", FT::INT}, {"componentId", FT::INT}, {"id", FT::INT}}});
    reg({179, "DEBUG_MESSAGE", {{"textId", FT::INT}, {"value", FT::FLOAT}, {"flags", FT::INT}}});
    reg({177, "HAPTIC_FEEDBACK", {{"type", FT::INT}}});
    reg({191, "WAKE_IN", {{"wake", FT::FLOAT}}});
    reg({196, "COLOR_THEME", {{"id", FT::INT}, {"groupId", FT::INT},
        {"lightModeIndex", FT::SHORT}, {"darkModeIndex", FT::SHORT},
        {"lightModeFallback", FT::INT}, {"darkModeFallback", FT::INT}}});
    reg({175, "PATH_COMBINE", {{"outId", FT::INT}, {"pathId1", FT::INT},
        {"pathId2", FT::INT}, {"operation", FT::BYTE}}});
    reg({181, "MATRIX_FROM_PATH", {{"pathId", FT::INT}, {"percent", FT::FLOAT},
        {"vOffset", FT::FLOAT}, {"flags", FT::INT}}});
}

} // namespace rccore
