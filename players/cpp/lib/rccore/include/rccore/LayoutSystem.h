#pragma once
#include <unordered_map>
#include <vector>
#include <algorithm>
#include <cmath>

namespace rccore {

class Operation;
class RemoteContext;
class PaintContext;

// ── Dimension types (matching Java DimensionModifierOperation.Type) ─
enum class DimType {
    EXACT = 0,
    FILL = 1,
    WRAP = 2,
    WEIGHT = 3,
    INTRINSIC_MIN = 4,
    INTRINSIC_MAX = 5,
    EXACT_DP = 6,
    FILL_PARENT_MAX_WIDTH = 7,
    FILL_PARENT_MAX_HEIGHT = 8,
};

// ── Positioning constants ────────────────────────────────────────────
constexpr int POS_START = 1;
constexpr int POS_CENTER = 2;
constexpr int POS_END = 3;
constexpr int POS_TOP = 4;
constexpr int POS_BOTTOM = 5;
constexpr int POS_SPACE_BETWEEN = 6;
constexpr int POS_SPACE_EVENLY = 7;
constexpr int POS_SPACE_AROUND = 8;

// ── Visibility constants ─────────────────────────────────────────────
constexpr int VIS_GONE = 0;
constexpr int VIS_VISIBLE = 1;
constexpr int VIS_INVISIBLE = 2;

// ── ComponentMeasure ─────────────────────────────────────────────────
struct ComponentMeasure {
    int id = -1;
    float x = 0, y = 0, w = 0, h = 0;
    int visibility = VIS_VISIBLE;

    bool isGone() const { return visibility == VIS_GONE; }
    bool isVisible() const { return visibility == VIS_VISIBLE; }
};

// ── MeasurePass ──────────────────────────────────────────────────────
class MeasurePass {
public:
    void clear() { mMap.clear(); }

    ComponentMeasure& get(int componentId) {
        auto it = mMap.find(componentId);
        if (it == mMap.end()) {
            ComponentMeasure m;
            m.id = componentId;
            mMap[componentId] = m;
            return mMap[componentId];
        }
        return it->second;
    }

    bool contains(int id) const { return mMap.count(id) > 0; }

private:
    std::unordered_map<int, ComponentMeasure> mMap;
};

// ── LayoutCompute info (per-child modifier) ─────────────────────────
struct LayoutComputeInfo {
    int type = 0;        // 0 = TYPE_MEASURE, 1 = TYPE_POSITION
    int boundsId = 0;    // ID of DataDynamicListFloat
    Operation* op = nullptr;  // the LayoutCompute operation (has child expressions)
};

// ── LayoutState: common state for layout containers ──────────────────
struct LayoutState {
    // Sizing from modifiers
    DimType widthType = DimType::WRAP;
    float widthValue = 0;
    DimType heightType = DimType::WRAP;
    float heightValue = 0;

    // Accumulated padding from modifiers
    float paddingLeft = 0, paddingTop = 0, paddingRight = 0, paddingBottom = 0;

    // WidthIn/HeightIn constraints
    float widthInMin = -1, widthInMax = -1;
    float heightInMin = -1, heightInMax = -1;

    // Background modifier (for painting)
    float bgR = 0, bgG = 0, bgB = 0, bgA = 0;
    int bgColorId = 0;
    int bgFlags = 0;
    int bgShape = 0;
    bool hasBg = false;

    // Border modifier
    float borderWidth = 0, borderCorner = 0;
    float borderR = 0, borderG = 0, borderB = 0, borderA = 0;
    int borderColorId = 0;
    int borderFlags = 0;
    int borderShape = 0;
    bool hasBorder = false;

    // Offset modifier
    float offsetX = 0, offsetY = 0;
    bool hasOffset = false;

    // Clip modifiers
    bool hasClipRect = false;
    bool hasRoundedClipRect = false;
    float clipTopStart = 0, clipTopEnd = 0, clipBottomStart = 0, clipBottomEnd = 0;

    // Scroll modifier
    bool hasScroll = false;
    int scrollDirection = 0; // 0 = vertical, 1 = horizontal (matches Java)
    float scrollPosition = 0; // NaN-encoded variable reference
    float scrollMaxNan = 0;   // NaN-encoded ID for max scroll variable
    float scrollNotchNan = 0; // NaN-encoded ID for notch/content dimension variable
    // Computed during scroll-aware measurement
    float scrollContentDimension = 0;
    float scrollHostDimension = 0;

    // Extracted layout children
    std::vector<Operation*> layoutChildren;

    // Canvas draw operations (to run directly in PAINT mode)
    std::vector<Operation*> canvasOps;

    // CanvasContent component IDs (to inherit parent canvas dimensions)
    std::vector<int> canvasContentIds;

    // All data/expression operations (to run in DATA mode)
    std::vector<Operation*> dataOps;

    // LayoutCompute modifiers (expression-driven custom measure/position)
    std::vector<LayoutComputeInfo> measureComputes;   // TYPE_MEASURE (0)
    std::vector<LayoutComputeInfo> positionComputes;   // TYPE_POSITION (1)

    // AlignBy modifier (baseline alignment in Rows)
    float alignByLine = 0;  // NaN-encoded baseline ID or literal value
    bool hasAlignBy = false;

    bool inflated = false;
};

} // namespace rccore
