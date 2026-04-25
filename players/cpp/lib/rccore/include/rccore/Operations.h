#pragma once
#include "rccore/Operation.h"
#include <unordered_map>
#include <functional>

namespace rccore {

class Operations {
public:
    // Opcodes - matching Java Operations.java
    static constexpr int HEADER = 0;
    static constexpr int COMPONENT_START = 2;
    static constexpr int ANIMATION_SPEC = 14;
    static constexpr int MODIFIER_WIDTH = 16;
    static constexpr int CLIP_PATH = 38;
    static constexpr int CLIP_RECT = 39;
    static constexpr int PAINT_VALUES = 40;
    static constexpr int DRAW_RECT = 42;
    static constexpr int DRAW_TEXT_RUN = 43;
    static constexpr int DRAW_BITMAP = 44;
    static constexpr int SHADER_DATA = 45;
    static constexpr int DRAW_CIRCLE = 46;
    static constexpr int DRAW_LINE = 47;
    static constexpr int DRAW_BITMAP_FONT_TEXT_RUN = 48;
    static constexpr int DRAW_ROUND_RECT = 51;
    static constexpr int DRAW_SECTOR = 52;
    static constexpr int DRAW_TEXT_ON_PATH = 53;
    static constexpr int MODIFIER_ROUNDED_CLIP_RECT = 54;
    static constexpr int MODIFIER_BACKGROUND = 55;
    static constexpr int DRAW_OVAL = 56;
    static constexpr int DRAW_TEXT_ON_CIRCLE = 57;
    static constexpr int MODIFIER_PADDING = 58;
    static constexpr int MODIFIER_CLICK = 59;
    static constexpr int MODIFIER_MULTI_CLICK = 83;
    static constexpr int THEME = 63;
    static constexpr int CLICK_AREA = 64;
    static constexpr int ROOT_CONTENT_BEHAVIOR = 65;
    static constexpr int DRAW_BITMAP_INT = 66;
    static constexpr int MODIFIER_HEIGHT = 67;
    static constexpr int DATA_FLOAT = 80;
    static constexpr int ANIMATED_FLOAT = 81;
    static constexpr int DATA_BITMAP = 101;
    static constexpr int DATA_TEXT = 102;
    static constexpr int ROOT_CONTENT_DESCRIPTION = 103;
    static constexpr int MODIFIER_BORDER = 107;
    static constexpr int MODIFIER_CLIP_RECT = 108;
    static constexpr int PATH_DATA = 123;
    static constexpr int DRAW_PATH = 124;
    static constexpr int DRAW_TWEEN_PATH = 125;
    static constexpr int MATRIX_SCALE = 126;
    static constexpr int MATRIX_TRANSLATE = 127;
    static constexpr int MATRIX_SKEW = 128;
    static constexpr int MATRIX_ROTATE = 129;
    static constexpr int MATRIX_SAVE = 130;
    static constexpr int MATRIX_RESTORE = 131;
    static constexpr int DRAW_TEXT_ANCHORED = 133;
    static constexpr int COLOR_EXPRESSION = 134;
    static constexpr int TEXT_FROM_FLOAT = 135;
    static constexpr int TEXT_MERGE = 136;
    static constexpr int NAMED_VARIABLE = 137;
    static constexpr int COLOR_CONSTANT = 138;
    static constexpr int DRAW_CONTENT = 139;
    static constexpr int DATA_INT = 140;
    static constexpr int DATA_BOOLEAN = 143;
    static constexpr int INTEGER_EXPRESSION = 144;
    static constexpr int DATA_MAP_IDS = 145;
    static constexpr int DATA_LIST_IDS = 146;
    static constexpr int DATA_LIST_FLOAT = 147;
    static constexpr int DATA_LONG = 148;
    static constexpr int DRAW_BITMAP_SCALED = 149;
    static constexpr int COMPONENT_VALUE = 150;
    static constexpr int TEXT_LOOKUP = 151;
    static constexpr int DRAW_ARC = 152;
    static constexpr int TEXT_LOOKUP_INT = 153;
    static constexpr int DATA_MAP_LOOKUP = 154;
    static constexpr int TEXT_MEASURE = 155;
    static constexpr int TEXT_LENGTH = 156;
    static constexpr int TOUCH_EXPRESSION = 157;
    static constexpr int PATH_TWEEN = 158;
    static constexpr int PATH_CREATE = 159;
    static constexpr int PATH_APPEND = 160;
    static constexpr int PARTICLES_CREATE = 161;
    static constexpr int PARTICLES_LOOP = 163;
    static constexpr int IMPULSE_OPERATION = 164;
    static constexpr int IMPULSE_PROCESS = 165;
    static constexpr int DATA_BITMAP_FONT = 167;
    static constexpr int ATTRIBUTE_IMAGE = 171;
    static constexpr int ATTRIBUTE_COLOR = 180;
    static constexpr int CANVAS_OPERATIONS = 173;
    static constexpr int DRAW_CONTENT_MODIFIER = 174;
    static constexpr int PATH_COMBINE = 175;
    static constexpr int FIT_BOX_LAYOUT = 176;
    static constexpr int HAPTIC_FEEDBACK = 177;
    static constexpr int CONDITIONAL_OPERATIONS = 178;
    static constexpr int DEBUG_MESSAGE = 179;
    static constexpr int MATRIX_FROM_PATH = 181;
    static constexpr int TEXT_SUBTEXT = 182;
    static constexpr int MATRIX_CONSTANT = 186;
    static constexpr int MATRIX_EXPRESSION = 187;
    static constexpr int MATRIX_VECTOR_MATH = 188;
    static constexpr int DRAW_TO_BITMAP = 190;
    static constexpr int WAKE_IN = 191;
    static constexpr int ID_LOOKUP = 192;
    static constexpr int PATH_EXPRESSION = 193;
    static constexpr int PARTICLES_COMPARE = 194;
    static constexpr int COLOR_THEME = 196;
    static constexpr int DATA_DYNAMIC_LIST_FLOAT = 197;
    static constexpr int UPDATE_DYNAMIC_FLOAT_LIST = 198;
    static constexpr int TEXT_TRANSFORM = 199;
    static constexpr int LAYOUT_ROOT = 200;
    static constexpr int LAYOUT_COMPONENT_CONTENT = 201;
    static constexpr int LAYOUT_BOX = 202;
    static constexpr int LAYOUT_ROW = 203;
    static constexpr int LAYOUT_COLUMN = 204;
    static constexpr int LAYOUT_CANVAS = 205;
    static constexpr int CANVAS_CONTENT = 207;
    static constexpr int LAYOUT_TEXT = 208;
    static constexpr int HOST_ACTION = 209;
    static constexpr int HOST_ACTION_LIST = 210;
    static constexpr int MODIFIER_VISIBILITY = 211;
    static constexpr int VALUE_INTEGER_CHANGE = 212;
    static constexpr int VALUE_STRING_CHANGE = 213;
    static constexpr int CONTAINER_END = 214;
    static constexpr int LOOP_OPERATION = 215;
    static constexpr int HOST_SCROLL_ACTION = 216;
    static constexpr int LAYOUT_STATE = 217;
    static constexpr int VALUE_LONG_CHANGE = 218;
    static constexpr int MODIFIER_TOUCH_DOWN = 219;
    static constexpr int MODIFIER_TOUCH_UP = 220;
    static constexpr int MODIFIER_OFFSET = 221;
    static constexpr int VALUE_FLOAT_CHANGE = 222;
    static constexpr int MODIFIER_ZINDEX = 223;
    static constexpr int MODIFIER_GRAPHICS_LAYER = 224;
    static constexpr int MODIFIER_TOUCH_CANCEL = 225;
    static constexpr int MODIFIER_SCROLL = 226;
    static constexpr int VALUE_BOOLEAN_CHANGE = 227;
    static constexpr int MODIFIER_MARQUEE = 228;
    static constexpr int MODIFIER_RIPPLE = 229;
    static constexpr int COLLAPSIBLE_ROW_LAYOUT = 230;
    static constexpr int MODIFIER_WIDTH_IN = 231;
    static constexpr int MODIFIER_HEIGHT_IN = 232;
    static constexpr int COLLAPSIBLE_COLUMN_LAYOUT = 233;
    static constexpr int LAYOUT_IMAGE = 234;
    static constexpr int MODIFIER_COLLAPSIBLE_PRIORITY = 235;
    static constexpr int RUN_ACTION = 236;
    static constexpr int MODIFIER_ALIGN_BY = 237;
    static constexpr int LAYOUT_COMPUTE = 238;
    static constexpr int LAYOUT_FLOW = 240;
    static constexpr int SKIP = 241;
    static constexpr int TEXT_STYLE = 242;
    static constexpr int MODIFIER_DIMENSION_CONSTRAINTS = 243;

    static void init();
    static ReaderFn getReader(int opcode);
    static std::string getName(int opcode);

private:
    static void registerReader(int opcode, const std::string& name, ReaderFn fn);

    static std::unordered_map<int, ReaderFn> sReaders;
    static std::unordered_map<int, std::string> sNames;
    static bool sInitialized;
};

} // namespace rccore
