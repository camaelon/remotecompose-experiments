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
    // Opacity applied at paint time. Driven by the layout-animation subsystem
    // (enter/exit fades); 1.0 for everything not currently fading.
    float alpha = 1.0f;
    // The enter/exit effect drawn this frame (AnimateMeasure.paint): a translation (slides),
    // a rotation and scale about the centre (ROTATE), or a custom visibility function run
    // with this progress (customFn != -1). Paint-time only, like alpha.
    float effTx = 0.0f, effTy = 0.0f, effRot = 0.0f, effScale = 1.0f;
    int customFn = -1;
    // An exit drawn as ParticleAnimation (PARTICLE, and any exit effect AnimateMeasure.paint
    // has no case for): its visibility progress, -1 when not.
    float particle = -1.0f;
    float customProgress = 0.0f;
    // GONE, but kept in the layout for the length of its exit animation (an exit SEQUENCE
    // BEFORE: Component.isHoldingLayoutForBeforeAnimation).
    bool holdExit = false;

    bool isGone() const { return visibility == VIS_GONE; }
    bool isVisible() const { return visibility == VIS_VISIBLE; }

    bool sameBounds(const ComponentMeasure& o) const {
        return x == o.x && y == o.y && w == o.w && h == o.h && visibility == o.visibility;
    }
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
    // Padding declared *before* the size modifier — the only padding that adds to
    // an explicit width/height. The reference stops walking modifiers at the size
    // modifier, so `.width(200).padding(30)` is 200 wide with 140 of content while
    // `.padding(30).width(200)` is 260 wide. That is Compose's modifier-order rule.
    float padBeforeWidth = 0, padBeforeHeight = 0;
    // Id of the integer variable driving this component's visibility, or -1.
    // Resolved on every measure, as the reference does in
    // ComponentVisibilityOperation.evaluateInLayout — a value that is never
    // written resolves to GONE.
    int visibilityId = -1;

    // WidthIn/HeightIn constraints
    float widthInMin = -1, widthInMax = -1;
    float heightInMin = -1, heightInMax = -1;
    // requiredWidthIn / requiredHeightIn (DimensionConstraints REQUIRED_*): re-applied after
    // the parent's maximum, so they may exceed it (applyWidthConstraints).
    bool widthInRequired = false, heightInRequired = false;

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
    Operation* ripple = nullptr;     // the component's ModifierRipple, if it has one
    Operation* animSpec = nullptr;   // its ANIMATION_SPEC modifier (14), if it has one
    // MODIFIER_COLLAPSIBLE_PRIORITY (235): how long it stays in a collapsible row/column.
    bool hasCollapsePriority = false;
    int collapseOrientation = 0;     // 0 horizontal, 1 vertical
    float collapsePriority = 0.0f;

    // GraphicsLayer opacity (attrId 11); may be a NaN-encoded expression variable.
    float glAlpha = 1.0f;
    bool hasGlAlpha = false;
    Operation* graphicsLayer = nullptr;   // its GraphicsLayerModifier (224), for the transform
    // GraphicsLayer blur render effect (attrId 17/18).
    float glBlurX = 0.0f, glBlurY = 0.0f;
    bool hasGlBlur = false;

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
    Operation* scrollOp = nullptr; // the ModifierScroll (holds the drag offset)
    // Computed during scroll-aware measurement
    float scrollContentDimension = 0;
    float scrollHostDimension = 0;

    // Extracted layout children
    std::vector<Operation*> layoutChildren;

    // Canvas draw operations (to run directly in PAINT mode)
    std::vector<Operation*> canvasOps;

    // CanvasContent component IDs (to inherit parent canvas dimensions)
    std::vector<int> canvasContentIds;
    std::vector<int> layoutContentIds;   // LayoutComponentContent ids: the full size

    // All data/expression operations (to run in DATA mode)
    std::vector<Operation*> dataOps;

    // LayoutCompute modifiers (expression-driven custom measure/position)
    std::vector<LayoutComputeInfo> measureComputes;   // TYPE_MEASURE (0)
    std::vector<LayoutComputeInfo> positionComputes;   // TYPE_POSITION (1)

    // AlignBy modifier (baseline alignment in Rows)
    float alignByLine = 0;  // NaN-encoded baseline ID or literal value
    bool hasAlignBy = false;

    // Text baseline (distance from the component top to the text baseline), captured
    // during measureText with the component's own typeface applied. Used to align
    // mixed-style text on a common baseline (see getAlignByValue).
    float textBaseline = 0;
    bool hasTextBaseline = false;

    // The modifiers that paint or move the canvas, in list order (padding, background,
    // border, clip, rounded clip, offset, ripple). ComponentModifiers.paint walks them in
    // order: each padding translates by its start/top and shrinks the size the later
    // decorators are laid out at, so a padding before a background is a margin.
    struct PaintMod {
        Operation* op = nullptr;
        float l = 0, t = 0, r = 0, b = 0;   // a padding's insets (px), else 0
    };
    std::vector<PaintMod> paintMods;

    bool inflated = false;
};

// Text the last paint could not fit (see paintTextLines): a renderer resets the counts
// before a frame and reports them after it.
struct TextOverflowCounts {
    int truncated = 0;    // lines lost to maxLines (no ellipsis)
    int clipped = 0;      // wider or taller than the box, cut at its edge or drawn past it
    int ellipsized = 0;   // ends in an ellipsis: overflow by design
    // The first few, so a report can name them: {kind, the text's start}.
    std::vector<std::pair<std::string, std::string>> examples;
};
void resetTextOverflowCounts();
TextOverflowCounts textOverflowCounts();

// Children the last layout placed past their parent's content box (a drawing taller than
// the widget it sits in), distinct, with the first few named. Reset by the layout itself.
struct LayoutOverflowCounts {
    int components = 0;
    std::vector<std::string> examples;   // "Canvas#-12 88x88 at 14,14 in 332x80: 22 px below"
    // Visible children the settled layout gave no size (a weight next to a widthIn, a
    // collapsible that dropped everything), except ones asked to be 0 (a size: 0 canvas).
    int zeroSize = 0;
    std::vector<std::string> zeroSizeExamples;   // "CanvasLayout#-12 0x88 in Row#-5 (weight)"
};
LayoutOverflowCounts layoutOverflowCounts();
void resetLayoutOverflowCounts();

} // namespace rccore
