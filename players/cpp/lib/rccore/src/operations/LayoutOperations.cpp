#include <set>
#include "rccore/operations/LayoutOperations.h"
#include "rccore/easing/CubicEasing.h"
#include "rccore/operations/AdvancedOperations.h"
#include "rccore/LayoutSystem.h"
#include "rccore/RemoteContext.h"
#include "rccore/PaintContext.h"
#include "rccore/PaintBundle.h"
#include "rccore/CustomComponentHost.h"
#include "rccore/Utils.h"
#include "rccore/animation/LayoutAnimation.h"
#include "rccore/CoreDocument.h"

#include <algorithm>
#include <limits>
#include <cmath>
#include <cstdio>
#include <memory>

// Debug layout tracing (set to 1 for verbose output)
#define LAYOUT_DEBUG 0

#if LAYOUT_DEBUG
#define LTRACE(...) fprintf(stderr, __VA_ARGS__)
#else
#define LTRACE(...) ((void)0)
#endif

namespace rccore {

// ── Density behaviour of the layout pass in progress ───────────────────
// Set by LayoutRoot::apply from the document's DOC_DENSITY_BEHAVIOR. With DENSITY_BEHAVIOR_DP
// (2) the reference multiplies exact sizes, padding, spacedBy, border, rounded clip, offset
// and constant font sizes by the density (DimensionModifierOperation, PaddingModifierOperation,
// RowLayout/ColumnLayout/FlowLayout, BorderModifierOperation, RoundedClipRectModifierOperation,
// OffsetModifierOperation, CoreText/TextLayout.updateVariables). EXACT_DP sizes always scale,
// and widthIn/heightIn scale unless the behaviour is PIXELS (DimensionInModifierOperation).
static float gDpScale = 1.0f;     // the density under DENSITY_BEHAVIOR_DP, otherwise 1
static float gDensity = 1.0f;     // the display density
static int gDensityBehavior = 0;

static float dimScale(DimType t) {
    return t == DimType::EXACT_DP ? gDensity : gDpScale;
}
static float dimInScale(float v) {
    return (gDensityBehavior != 1 && v != -1.0f) ? v * gDensity : v;
}

// ── Modifier variable support ──────────────────────────────────────────

void ModifierWidth::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(width, context, this);
}
void ModifierWidth::updateVariables(RemoteContext& context) {
    // Only EXACT/EXACT_DP carry a variable reference. For FILL the value is a fraction
    // of the parent and NaN means "no fraction"; resolving it as a variable id would
    // turn every fractional fill into a full one.
    if (type == 0 /* EXACT */ || type == 6 /* EXACT_DP */) {
        oWidth = Utils::resolveFloat(width, context);
    } else {
        oWidth = width;
    }
}

void ModifierHeight::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(height, context, this);
}
void ModifierHeight::updateVariables(RemoteContext& context) {
    if (type == 0 /* EXACT */ || type == 6 /* EXACT_DP */) {
        oHeight = Utils::resolveFloat(height, context);
    } else {
        oHeight = height;
    }
}

void ModifierPadding::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(left, context, this);
    Utils::registerFloatVar(top, context, this);
    Utils::registerFloatVar(right, context, this);
    Utils::registerFloatVar(bottom, context, this);
}
void ModifierPadding::updateVariables(RemoteContext& context) {
    oLeft = Utils::resolveFloat(left, context);
    oTop = Utils::resolveFloat(top, context);
    oRight = Utils::resolveFloat(right, context);
    oBottom = Utils::resolveFloat(bottom, context);
}

void ModifierBackground::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(r, context, this);
    Utils::registerFloatVar(g, context, this);
    Utils::registerFloatVar(b, context, this);
    Utils::registerFloatVar(a, context, this);
}
void ModifierBackground::updateVariables(RemoteContext& context) {
    oR = Utils::resolveFloat(r, context);
    oG = Utils::resolveFloat(g, context);
    oB = Utils::resolveFloat(b, context);
    oA = Utils::resolveFloat(a, context);
}

void ModifierBorder::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(borderWidth, context, this);
    Utils::registerFloatVar(roundedCorner, context, this);
    Utils::registerFloatVar(r, context, this);
    Utils::registerFloatVar(g, context, this);
    Utils::registerFloatVar(b, context, this);
    Utils::registerFloatVar(a, context, this);
}
void ModifierBorder::updateVariables(RemoteContext& context) {
    oBorderWidth = Utils::resolveFloat(borderWidth, context);
    oRoundedCorner = Utils::resolveFloat(roundedCorner, context);
    oR = Utils::resolveFloat(r, context);
    oG = Utils::resolveFloat(g, context);
    oB = Utils::resolveFloat(b, context);
    oA = Utils::resolveFloat(a, context);
}

void ModifierRoundedClipRect::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(topStart, context, this);
    Utils::registerFloatVar(topEnd, context, this);
    Utils::registerFloatVar(bottomStart, context, this);
    Utils::registerFloatVar(bottomEnd, context, this);
}
void ModifierRoundedClipRect::updateVariables(RemoteContext& context) {
    oTopStart = Utils::resolveFloat(topStart, context);
    oTopEnd = Utils::resolveFloat(topEnd, context);
    oBottomStart = Utils::resolveFloat(bottomStart, context);
    oBottomEnd = Utils::resolveFloat(bottomEnd, context);
}

void ModifierWidthIn::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(min, context, this);
    Utils::registerFloatVar(max, context, this);
}
void ModifierWidthIn::updateVariables(RemoteContext& context) {
    oMin = Utils::resolveFloat(min, context);
    oMax = Utils::resolveFloat(max, context);
}

void ModifierHeightIn::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(min, context, this);
    Utils::registerFloatVar(max, context, this);
}
void ModifierHeightIn::updateVariables(RemoteContext& context) {
    oMin = Utils::resolveFloat(min, context);
    oMax = Utils::resolveFloat(max, context);
}

void ModifierOffset::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(x, context, this);
    Utils::registerFloatVar(y, context, this);
}
void ModifierOffset::updateVariables(RemoteContext& context) {
    oX = Utils::resolveFloat(x, context);
    oY = Utils::resolveFloat(y, context);
}

void ModifierScroll::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(position, context, this);
    Utils::registerFloatVar(max, context, this);
    Utils::registerFloatVar(notchMax, context, this);
}
void ModifierScroll::updateVariables(RemoteContext& context) {
    oPosition = Utils::resolveFloat(position, context);
    oMax = Utils::resolveFloat(max, context);
    oNotchMax = Utils::resolveFloat(notchMax, context);
}

// ── Layout container variable support ──────────────────────────────────

void LayoutRow::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(spacedBy, context, this);
    for (auto& child : mChildren) {
        if (child->isVariableSupport()) child->registerListening(context);
    }
}
void LayoutRow::updateVariables(RemoteContext& context) {
    oSpacedBy = Utils::resolveFloat(spacedBy, context);
}

void LayoutColumn::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(spacedBy, context, this);
    for (auto& child : mChildren) {
        if (child->isVariableSupport()) child->registerListening(context);
    }
}
void LayoutColumn::updateVariables(RemoteContext& context) {
    oSpacedBy = Utils::resolveFloat(spacedBy, context);
}

void LayoutFlow::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(spacedBy, context, this);
    for (auto& child : mChildren) {
        if (child->isVariableSupport()) child->registerListening(context);
    }
}
void LayoutFlow::updateVariables(RemoteContext& context) {
    oSpacedBy = Utils::resolveFloat(spacedBy, context);
}

// ── Layout text variable support ───────────────────────────────────────

void LayoutText::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(fontSize, context, this);
    Utils::registerFloatVar(fontWeight, context, this);
    for (auto& child : mChildren) {
        if (child->isVariableSupport()) child->registerListening(context);
    }
}
void LayoutText::updateVariables(RemoteContext& context) {
    oFontSize = Utils::resolveFloat(fontSize, context);
    oFontWeight = Utils::resolveFloat(fontWeight, context);
}

void CoreTextOp::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(fontSize, context, this);
    Utils::registerFloatVar(fontWeight, context, this);
    for (auto& child : mChildren) {
        if (child->isVariableSupport()) child->registerListening(context);
    }
}
void CoreTextOp::updateVariables(RemoteContext& context) {
    oFontSize = Utils::resolveFloat(fontSize, context);
    oFontWeight = Utils::resolveFloat(fontWeight, context);
}

// ── Layout helper: classify a child op as a modifier ─────────────────
static bool isModifierOp(const Operation* op) {
    int oc = op->opcode();
    return oc == 16 || oc == 67 || oc == 55 || oc == 107 || oc == 58 ||
           oc == 59 || oc == 108 || oc == 54 || oc == 211 || oc == 237 ||
           oc == 231 || oc == 232 || oc == 221 || oc == 223 || oc == 219 ||
           oc == 220 || oc == 225 || oc == 226 || oc == 229 || oc == 14 ||
           oc == 224 || oc == 235 || oc == 228 || oc == 238 || oc == 174 ||
           // 243 MODIFIER_DIMENSION_CONSTRAINTS (requiredWidthIn/requiredHeightIn) and
           // 250 ACCESSIBILITY_SEMANTICS are modifiers too. Omitting them here meant
           // the switch below never saw them: 243's constraints were silently dropped.
           oc == 243 || oc == 250;
}

static bool isLayoutComponent(const Operation* op) {
    int oc = op->opcode();
    // 208 (LAYOUT_TEXT) is included — Java treats it as a layout component.
    return oc == 200 || oc == 202 || oc == 203 || oc == 204 || oc == 205 ||
           oc == 207 || oc == 208 || oc == 217 || oc == 239 || oc == 240 ||
           oc == 176 || oc == 230 || oc == 233 || oc == 234 || oc == 93;
}

static bool isContentWrapper(const Operation* op) {
    return op->opcode() == 201 || op->opcode() == 207;
}

// ── Inflate: categorize children into modifiers and layout children ──
static void inflateLayout(Operation* self, LayoutState& ls) {
    if (ls.inflated) return;
    ls.inflated = true;
    ls.layoutChildren.clear();
    ls.canvasOps.clear();
    ls.dataOps.clear();
    ls.canvasContentIds.clear();
    ls.layoutContentIds.clear();
    ls.padBeforeWidth = 0;
    ls.padBeforeHeight = 0;
    ls.ripple = nullptr;
    ls.graphicsLayer = nullptr;
    ls.paintMods.clear();
    ls.animSpec = nullptr;
    ls.hasCollapsePriority = false;
    bool sawWidth = false;
    bool sawHeight = false;

    LTRACE("    inflate op=%d, %d children\n", self->opcode(), (int)self->mChildren.size());
    for (auto& childPtr : self->mChildren) {
        Operation* child = childPtr.get();
        if (isModifierOp(child)) {
            // Extract modifier data
            switch (child->opcode()) {
                case 211: { // ModifierVisibility
                    ls.visibilityId = static_cast<ModifierVisibility*>(child)->visibilityId;
                    break;
                }
                case 16: { // ModifierWidth
                    auto* mw = static_cast<ModifierWidth*>(child);
                    ls.widthType = static_cast<DimType>(mw->type);
                    // An exact width keeps its variable reference, resolved at each measure:
                    // inflate runs once, so the resolved oWidth would freeze a width driven by
                    // an expression at whatever it was on the first frame.
                    ls.widthValue = (mw->type == 0 || mw->type == 6) ? mw->width : mw->oWidth;
                    sawWidth = true;
                    break;
                }
                case 67: { // ModifierHeight
                    sawHeight = true;
                    auto* mh = static_cast<ModifierHeight*>(child);
                    ls.heightType = static_cast<DimType>(mh->type);
                    ls.heightValue = (mh->type == 0 || mh->type == 6) ? mh->height : mh->oHeight;   // see width
                    break;
                }
                case 58: { // ModifierPadding
                    auto* mp = static_cast<ModifierPadding*>(child);
                    const float pl = mp->oLeft * gDpScale, pt = mp->oTop * gDpScale;
                    const float pr = mp->oRight * gDpScale, pb = mp->oBottom * gDpScale;
                    if (!sawWidth)  ls.padBeforeWidth  += pl + pr;
                    if (!sawHeight) ls.padBeforeHeight += pt + pb;
                    ls.paddingLeft += pl;
                    ls.paddingTop += pt;
                    ls.paddingRight += pr;
                    ls.paddingBottom += pb;
                    ls.paintMods.push_back({child, pl, pt, pr, pb});
                    break;
                }
                case 55: { // ModifierBackground
                    ls.paintMods.push_back({child});
                    auto* mb = static_cast<ModifierBackground*>(child);
                    ls.hasBg = true;
                    ls.bgFlags = mb->flags;
                    ls.bgColorId = mb->colorId;
                    ls.bgR = mb->oR; ls.bgG = mb->oG;
                    ls.bgB = mb->oB; ls.bgA = mb->oA;
                    ls.bgShape = mb->shapeType;
                    break;
                }
                case 107: { // ModifierBorder
                    ls.paintMods.push_back({child});
                    auto* mb = static_cast<ModifierBorder*>(child);
                    ls.hasBorder = true;
                    ls.borderFlags = mb->flags;
                    ls.borderColorId = mb->colorId;
                    ls.borderWidth = mb->oBorderWidth * gDpScale;
                    ls.borderCorner = mb->oRoundedCorner * gDpScale;
                    ls.borderR = mb->oR; ls.borderG = mb->oG;
                    ls.borderB = mb->oB; ls.borderA = mb->oA;
                    ls.borderShape = mb->shapeType;
                    break;
                }
                case 231: { // ModifierWidthIn
                    auto* m = static_cast<ModifierWidthIn*>(child);
                    ls.widthInMin = dimInScale(m->oMin);
                    ls.widthInMax = dimInScale(m->oMax);
                    break;
                }
                case 232: { // ModifierHeightIn
                    auto* m = static_cast<ModifierHeightIn*>(child);
                    ls.heightInMin = dimInScale(m->oMin);
                    ls.heightInMax = dimInScale(m->oMax);
                    break;
                }
                case 243: { // ModifierDimensionConstraints
                    // What `requiredWidthIn` / `requiredHeightIn` compile to. The op was
                    // read but never consumed here, so the constraints were dropped and
                    // a component sized only by them wrapped to nothing.
                    auto* m = static_cast<ModifierDimensionConstraints*>(child);
                    if (m->constraintType == ModifierDimensionConstraints::HORIZONTAL
                        || m->constraintType
                               == ModifierDimensionConstraints::REQUIRED_HORIZONTAL) {
                        ls.widthInMin = m->minVal;
                        ls.widthInMax = m->maxVal;
                        ls.widthInRequired = m->constraintType
                                == ModifierDimensionConstraints::REQUIRED_HORIZONTAL;
                    } else {
                        ls.heightInMin = m->minVal;
                        ls.heightInMax = m->maxVal;
                        ls.heightInRequired = m->constraintType
                                == ModifierDimensionConstraints::REQUIRED_VERTICAL;
                    }
                    break;
                }
                case 229: // ModifierRipple
                    ls.ripple = child;
                    ls.paintMods.push_back({child});
                    break;
                case 59:  // ModifierClick: its click ripple is painted in modifier order
                case 83:  // ModifierMultiClick
                    ls.paintMods.push_back({child});
                    break;
                case 14: // AnimationSpec
                    ls.animSpec = child;
                    break;
                case 235: { // ModifierCollapsiblePriority
                    auto* cp = static_cast<ModifierCollapsiblePriority*>(child);
                    ls.hasCollapsePriority = true;
                    ls.collapseOrientation = cp->orientation;
                    ls.collapsePriority = cp->priority;
                    break;
                }
                case 221: { // ModifierOffset
                    ls.paintMods.push_back({child});
                    auto* m = static_cast<ModifierOffset*>(child);
                    ls.hasOffset = true;
                    // The variable itself (or the constant), resolved at paint: with the layout
                    // cached across frames, a resolved value would hold the offset still.
                    ls.offsetX = m->x;
                    ls.offsetY = m->y;
                    break;
                }
                case 224: { // GraphicsLayerModifier — opacity + blur
                    auto* m = static_cast<ModifierGraphicsLayer*>(child);
                    ls.glAlpha = m->alpha;
                    ls.hasGlAlpha = true;
                    ls.graphicsLayer = m;
                    if (m->hasBlur) {
                        ls.hasGlBlur = true;
                        ls.glBlurX = m->blurX;
                        ls.glBlurY = m->blurY;
                    }
                    break;
                }
                case 108: { // ClipRectModifier
                    ls.paintMods.push_back({child});
                    ls.hasClipRect = true;
                    break;
                }
                case 54: { // RoundedClipRectModifier
                    ls.paintMods.push_back({child});
                    auto* m = static_cast<ModifierRoundedClipRect*>(child);
                    ls.hasRoundedClipRect = true;
                    ls.clipTopStart = m->oTopStart * gDpScale;
                    ls.clipTopEnd = m->oTopEnd * gDpScale;
                    ls.clipBottomStart = m->oBottomStart * gDpScale;
                    ls.clipBottomEnd = m->oBottomEnd * gDpScale;
                    break;
                }
                case 226: { // ScrollModifier
                    auto* m = static_cast<ModifierScroll*>(child);
                    ls.hasScroll = true;
                    ls.scrollDirection = m->direction;
                    ls.scrollPosition = m->position; // may be NaN-encoded
                    ls.scrollMaxNan = m->max;        // original NaN-encoded max scroll var ID
                    ls.scrollNotchNan = m->notchMax;  // original NaN-encoded content dim var ID
                    ls.scrollOp = m;
                    break;
                }
                case 237: { // ModifierAlignBy
                    auto* m = static_cast<ModifierAlignBy*>(child);
                    ls.hasAlignBy = true;
                    ls.alignByLine = m->line;
                    break;
                }
                case 238: { // LayoutCompute
                    auto* lc = static_cast<LayoutCompute*>(child);
                    LayoutComputeInfo info;
                    info.type = lc->type;
                    info.boundsId = lc->boundsId;
                    info.op = child;
                    if (lc->type == 0) {  // TYPE_MEASURE
                        ls.measureComputes.push_back(info);
                    } else {  // TYPE_POSITION
                        ls.positionComputes.push_back(info);
                    }
                    break;
                }
                default:
                    break;
            }
            // Also collect data ops from modifier containers (click, touch)
            if (child->isContainer()) {
                int coc = child->opcode();
                if (coc != 59 && coc != 83 && coc != 219 && coc != 220 && coc != 225) {
                    for (auto& sub : child->mChildren) {
                        ls.dataOps.push_back(sub.get());
                    }
                }
            }
        } else if (isContentWrapper(child)) {
            // LayoutComponentContent or CanvasContent - children are the real layout children
            LTRACE("      content wrapper opcode=%d with %d subs\n", child->opcode(), (int)child->mChildren.size());
            // Register this wrapper's componentId for dimension lookups
            if (child->opcode() == 201) {
                auto* lcc = static_cast<LayoutComponentContent*>(child);
                if (lcc->componentId != 0) {
                    ls.layoutContentIds.push_back(lcc->componentId);
                    LTRACE("      initial LCC cid=%d registered\n", lcc->componentId);
                }
            }
            // Use a stack to handle nested LayoutComponentContent wrappers
            std::vector<Operation*> contentStack;
            contentStack.push_back(child);
            while (!contentStack.empty()) {
                Operation* wrapper = contentStack.back();
                contentStack.pop_back();
                // If wrapper IS a CanvasContent, its children are draw/data ops
                bool wrapperIsCanvas = (wrapper->opcode() == 207);
                if (wrapperIsCanvas) {
                    auto* cc = static_cast<CanvasContent*>(wrapper);
                    if (cc->componentId != 0) {
                        ls.canvasContentIds.push_back(cc->componentId);
                    }
                }
                for (auto& sub : wrapper->mChildren) {
                    if (sub->opcode() == 207) {
                        // CanvasContent: its children are draw operations
                        auto* cc = static_cast<CanvasContent*>(sub.get());
                        if (cc->componentId != 0) {
                            ls.canvasContentIds.push_back(cc->componentId);
                        }
                        LTRACE("        canvas content cid=%d with %d ops\n", cc->componentId, (int)sub->mChildren.size());
                        for (auto& canvasChild : sub->mChildren) {
                            ls.canvasOps.push_back(canvasChild.get());
                        }
                    } else if (sub->opcode() == 201) {
                        // Nested LayoutComponentContent - process its children too
                        auto* lcc = static_cast<LayoutComponentContent*>(sub.get());
                        if (lcc->componentId != 0) {
                            ls.layoutContentIds.push_back(lcc->componentId);
                        }
                        LTRACE("        nested content wrapper cid=%d with %d subs\n", lcc->componentId, (int)sub->mChildren.size());
                        contentStack.push_back(sub.get());
                    } else if (sub->opcode() == 142) {
                        // REFERENCED_OPERATIONS at its definition site: neither laid out nor
                        // drawn. The reference's LayoutComponentContent.getComponents takes
                        // only direct Component children, and ReferencedOperations.apply just
                        // registers the group; IncludeReferencedOperations re-reads its bytes
                        // where it is included.
                    } else if (isLayoutComponent(sub.get())) {
                        LTRACE("        layout child opcode=%d\n", sub->opcode());
                        ls.layoutChildren.push_back(sub.get());
                    } else if (wrapperIsCanvas || self->opcode() == 205) {
                        // Direct children of CanvasContent, or any content wrapper
                        // inside a CanvasLayout → canvas ops (paint during PAINT pass)
                        ls.canvasOps.push_back(sub.get());
                    } else {
                        ls.dataOps.push_back(sub.get());
                    }
                }
            }
        } else {
            // Data operations (TextData, constants, expressions, etc.)
            ls.dataOps.push_back(child);
        }
    }
}

// ── Resolve a potentially NaN-encoded float variable ─────────────────
// Set during the layout-animation pass: a state layout (index may flip) or an in-flight layout
// animation means the layout can't be cached this frame.
//
// Per thread. They are cleared at the start of a layout pass and read at the end, so they
// belong to *a* pass, not to the process: a second thread laying out another document (a
// thumbnail, a PDF page) would otherwise clear them mid-pass and the first document would
// cache a layout that is still moving.
thread_local bool sSawStateLayout = false;
thread_local bool sSawActiveAnim = false;

static void collapseChildren(const LayoutState& ls, RemoteContext& ctx, MeasurePass& measure,
                             float avail, int axis);
static void unhide(Operation* child, RemoteContext& ctx, MeasurePass& measure);
static void collapsedWrapSize(const LayoutState& ls, RemoteContext& ctx, MeasurePass& measure,
                              int axis, float availMain, bool hasHWrap, bool hasVWrap,
                              float& measuredW, float& measuredH);
static void measureCollapsibleChildren(const LayoutState& ls, PaintContext* pc, RemoteContext& ctx,
                                       MeasurePass& measure, int axis, float mainMax,
                                       float crossMax, float& measuredW, float& measuredH,
                                       bool hasHWrap, bool hasVWrap);

static float resolveVar(float v, const RemoteContext& ctx) {
    if (Utils::isVariable(v)) {
        return ctx.getFloat(Utils::idFromNan(v));
    }
    return v;
}

// ── Apply LayoutCompute modifier (Java LayoutComputeOperation.applyToMeasure) ──
static void applyLayoutCompute(const LayoutComputeInfo& info, RemoteContext& ctx,
                                ComponentMeasure& childM, const ComponentMeasure& parentM) {
    // Write current bounds into the DataDynamicListFloat.
    // Use getFloatListMutable to update in-place if it exists (created during DATA pass),
    // otherwise create it via loadFloatList.
    auto* existing = ctx.getFloatListMutable(info.boundsId);
    if (existing && existing->size() >= 6) {
        (*existing)[0] = childM.x;
        (*existing)[1] = childM.y;
        (*existing)[2] = childM.w;
        (*existing)[3] = childM.h;
        (*existing)[4] = parentM.w;
        (*existing)[5] = parentM.h;
    } else {
        std::vector<float> bounds = {childM.x, childM.y, childM.w, childM.h, parentM.w, parentM.h};
        ctx.loadFloatList(info.boundsId, bounds);
    }

    // Run child expressions — skip DataDynamicListFloat (opcode 197) which would
    // recreate the list with zeros, overwriting the bounds we just wrote.
    LTRACE("  applyLayoutCompute type=%d boundsId=%d children=%d bounds=[%.1f,%.1f,%.1f,%.1f,%.1f,%.1f]\n",
           info.type, info.boundsId, (int)info.op->mChildren.size(),
           childM.x, childM.y, childM.w, childM.h, parentM.w, parentM.h);
    for (auto& childOp : info.op->mChildren) {
        if (childOp->opcode() == 197) continue;  // Skip DataDynamicListFloat
        if (childOp->isVariableSupport()) {
            childOp->updateVariables(ctx);
        }
        childOp->apply(ctx);
        LTRACE("    ran op %d (%s)\n", childOp->opcode(), childOp->name().c_str());
    }

    // Read back modified values
    const auto* result = ctx.getFloatList(info.boundsId);
    if (!result || result->size() < 4) return;

    switch (info.type) {
        case 0:  // TYPE_MEASURE
            childM.w = (*result)[2];
            childM.h = (*result)[3];
            break;
        case 1:  // TYPE_POSITION
            childM.x = (*result)[0];
            childM.y = (*result)[1];
            break;
        default:
            childM.x = (*result)[0];
            childM.y = (*result)[1];
            childM.w = (*result)[2];
            childM.h = (*result)[3];
            break;
    }
}

// ── Text wrapping helper ──────────────────────────────────────────────
struct TextLine { int start, end; };

// Convert a UTF-8 byte offset into a UTF-16 code-unit index. wrapText works in bytes,
// but drawTextRun takes UTF-16 char indices (Java string semantics); a multi-byte
// character (e.g. the "•" bullet) would otherwise shift every wrapped line.
static int utf8ByteToUtf16Index(const std::string& s, int byteOff) {
    int units = 0, i = 0;
    int n = (int)s.size();
    if (byteOff > n) byteOff = n;
    while (i < byteOff) {
        unsigned char c = (unsigned char)s[i];
        int len = 1;
        uint32_t cp = c;
        if (c >= 0xF0) { len = 4; cp = c & 0x07; }
        else if (c >= 0xE0) { len = 3; cp = c & 0x0F; }
        else if (c >= 0xC0) { len = 2; cp = c & 0x1F; }
        for (int k = 1; k < len && i + k < n; k++) cp = (cp << 6) | ((unsigned char)s[i + k] & 0x3F);
        units += (cp >= 0x10000) ? 2 : 1;   // astral chars are a surrogate pair
        i += len;
    }
    return units;
}

static std::vector<TextLine> wrapText(PaintContext* pc, const std::string& text,
                                       float fontSize, float maxWidth) {
    std::vector<TextLine> lines;
    int n = (int)text.size();
    if (n == 0 || maxWidth <= 0) { lines.push_back({0, n}); return lines; }

    // Quick check: fits in one line?
    float fullW = pc ? pc->measureTextWidth(text, fontSize) : fontSize * 0.6f * n;
    if (fullW <= maxWidth) { lines.push_back({0, n}); return lines; }

    int lineStart = 0;
    int lastWordEnd = 0;
    float lineWidth = 0;
    int i = 0;

    while (i < n) {
        // Skip spaces
        while (i < n && text[i] == ' ') i++;
        if (i >= n) break;

        // Find word end
        int wordStart = i;
        while (i < n && text[i] != ' ' && text[i] != '\n') i++;
        int wordEnd = i;

        float wordW = pc ? pc->measureTextWidth(text.substr(wordStart, wordEnd - wordStart), fontSize)
                         : fontSize * 0.6f * (wordEnd - wordStart);
        float spaceW = (lineWidth > 0) ? (pc ? pc->measureTextWidth(" ", fontSize) : fontSize * 0.3f) : 0;

        if (lineWidth + spaceW + wordW > maxWidth && lineWidth > 0) {
            // Wrap: emit current line
            lines.push_back({lineStart, lastWordEnd});
            lineStart = wordStart;
            lineWidth = wordW;
        } else {
            lineWidth += spaceW + wordW;
        }
        lastWordEnd = wordEnd;

        // Handle newline
        if (i < n && text[i] == '\n') {
            lines.push_back({lineStart, i});
            i++;
            lineStart = i;
            lineWidth = 0;
            lastWordEnd = i;
        }
    }

    if (lineStart < n || lines.empty()) {
        lines.push_back({lineStart, n});
    }
    return lines;
}

// ── Compute modifier-defined width (padding + exact size) ────────────
// Java: returns padding + value for EXACT/EXACT_DP, just padding otherwise.
static float computeModifierDefinedWidth(const LayoutState& ls, const RemoteContext& ctx) {
    // Only padding declared *before* the size modifier adds to it — the reference walks
    // the modifier list and breaks at the size modifier, which is Compose's ordering
    // rule. Using total padding here makes `.width(200).padding(30)` 260 wide instead
    // of 200 with 140 of content.
    if (ls.widthType == DimType::EXACT || ls.widthType == DimType::EXACT_DP) {
        return ls.padBeforeWidth + resolveVar(ls.widthValue, ctx) * dimScale(ls.widthType);
    }
    return ls.paddingLeft + ls.paddingRight;
}

static float computeModifierDefinedHeight(const LayoutState& ls, const RemoteContext& ctx) {
    if (ls.heightType == DimType::EXACT || ls.heightType == DimType::EXACT_DP) {
        return ls.padBeforeHeight + resolveVar(ls.heightValue, ctx) * dimScale(ls.heightType);
    }
    return ls.paddingTop + ls.paddingBottom;
}

// ── Forward declarations for layout functions ────────────────────────
static void measureComponent(Operation* op, PaintContext* pc, RemoteContext& ctx,
                             float minW, float maxW, float minH, float maxH,
                             MeasurePass& measure);

static void layoutComponent(Operation* op, RemoteContext& ctx, MeasurePass& measure);

static void paintComponent(Operation* op, RemoteContext& ctx);
static void measureStateLayout(Operation* op, PaintContext* pc, RemoteContext& ctx,
                               float minW, float maxW, float minH, float maxH,
                               MeasurePass& measure);
static void layoutStateLayout(Operation* op, RemoteContext& ctx, MeasurePass& measure);
static void paintLayoutComponent(Operation* op, RemoteContext& ctx, MeasurePass& measure);

// ── Per-document layout cache ────────────────────────────────────────
#include <unordered_map>
// Owned by the RemoteContext so it lives exactly as long as the
// document (no stale reuse across docs, no leak). Holds the persistent LayoutState per op, the
// measured bounds (MeasurePass), and the set of variables the layout actually read. That lets a
// paint SKIP the whole measure/layout pass when no layout input changed — matching the androidx
// RootLayoutComponent.mNeedsMeasure gate — while still painting every frame (so paint-time
// offset/alpha/colour animations are unaffected).
struct LayoutCache {
    std::unordered_map<Operation*, LayoutState> states;
    MeasurePass measure;
    bool laid = false;
    bool hasStateLayout = false;   // sticky: doc has a StateLayout → keep re-laying out
    bool animating = false;        // a layout animation was in flight last measure
    float w = -1.0f, h = -1.0f;
    uint64_t epoch = 0;            // RemoteContext.mLayoutEpoch at the last layout
    float dpScale = 1.0f, density = 1.0f;   // the density scales the states were inflated with
};

static LayoutCache& cacheFor(RemoteContext& ctx) {
    if (!ctx.mLayoutCache) ctx.mLayoutCache = std::make_shared<LayoutCache>();
    return *static_cast<LayoutCache*>(ctx.mLayoutCache.get());
}

static LayoutState& getLS(RemoteContext& ctx, Operation* op) {
    return cacheFor(ctx).states[op];
}

// ── Get the component ID for any layout operation ────────────────────
static int getComponentId(const Operation* op) {
    switch (op->opcode()) {
        case 200: return static_cast<const LayoutRoot*>(op)->componentId;
        case 202: return static_cast<const LayoutBox*>(op)->componentId;
        case 203: return static_cast<const LayoutRow*>(op)->componentId;
        case 204: return static_cast<const LayoutColumn*>(op)->componentId;
        case 205: return static_cast<const LayoutCanvas*>(op)->componentId;
        case 208: return static_cast<const LayoutText*>(op)->componentId;
        case 239: return static_cast<const CoreTextOp*>(op)->componentId;
        case 240: return static_cast<const LayoutFlow*>(op)->componentId;
        case 176: return static_cast<const FitBoxLayout*>(op)->componentId;
        case 230: return static_cast<const CollapsibleRowLayout*>(op)->componentId;
        case 233: return static_cast<const CollapsibleColumnLayout*>(op)->componentId;
        case 217: return static_cast<const StateLayout*>(op)->componentId;
        case 234: return static_cast<const LayoutImage*>(op)->componentId;
        case 93:  return static_cast<const LayoutCustom*>(op)->componentId;
        default: return -1;
    }
}
// Resolve a component's visibility from its modifier every measure pass. The reference
// re-evaluates unconditionally (ComponentVisibilityOperation.evaluateInLayout) and maps
// anything it cannot resolve to GONE, which is what makes a document that switches
// between mutually exclusive branches show exactly one of them.
static bool gLayoutAnimationEnabled = true;
static void applyVisibility(const LayoutState& ls, RemoteContext& ctx, ComponentMeasure& m) {
    m.holdExit = false;
    if (ls.visibilityId < 0) return;
    int v = ctx.getInteger(ls.visibilityId);
    m.visibility = (v == VIS_VISIBLE) ? VIS_VISIBLE
                 : (v == VIS_INVISIBLE) ? VIS_INVISIBLE
                 : VIS_GONE;
    // An exit with SEQUENCE BEFORE plays before the layout changes: while the component is
    // still on screen it keeps its place (measured visible), the animation pass turning it
    // GONE at those bounds; the layout closes up once it is off.
    auto* as = static_cast<AnimationSpec*>(ls.animSpec);
    if (m.visibility != VIS_VISIBLE && as && ((as->exitAnimation >> 8) & 0xFF) == 1
        && gLayoutAnimationEnabled && ctx.getDocument()) {
        auto& store = ctx.getDocument()->animStore();
        auto it = store.find(m.id);
        if (it != store.end() && it->second.hasLive && it->second.live.isVisible()) {
            m.visibility = VIS_VISIBLE;
            m.holdExit = true;
        }
    }
}


// ── Measure a text component ─────────────────────────────────────────
// ── Letter spacing and line spacing (CoreText P_LETTER_SPACING / P_LINE_HEIGHT_*) ──
// As Android's TextPaint.setLetterSpacing: every character's advance grows by the spacing
// (in em), half before it and half after. As StaticLayout.setLineSpacing(add, multiplier):
// each line but the last is (height × multiplier + add) tall.
static int utf8Count(const std::string& s) {
    int n = 0;
    for (unsigned char c : s) if ((c & 0xC0) != 0x80) n++;
    return n;
}
static float lineGap(float lineH, float add, float mul) {
    return lineH * (mul - 1.0f) + add;   // the extra space below every line but the last
}
static constexpr int kSpacedTextId = INT32_MIN + 0x2027;   // scratch text slot
static void drawSpaced(PaintContext* pc, const std::string& s, float x, float y, float fsize,
                       float lsPx) {
    int i = 0;
    for (size_t b = 0; b < s.size(); i++) {
        size_t e = b + 1;
        while (e < s.size() && ((unsigned char)s[e] & 0xC0) == 0x80) e++;
        float px = x + pc->measureTextWidth(s.substr(0, b), fsize) + lsPx * (i + 0.5f);
        std::string ch = s.substr(b, e - b);
        pc->loadText(kSpacedTextId, ch);
        int units = utf8ByteToUtf16Index(ch, (int) ch.size());
        pc->drawTextRun(kSpacedTextId, 0, units, 0, units, px, y, false);
        b = e;
    }
}

static void measureText(Operation* op, PaintContext* pc, RemoteContext& ctx,
                        float minW, float maxW, float minH, float maxH,
                        MeasurePass& measure) {
    int cid = getComponentId(op);
    auto& m = measure.get(cid);
    auto& ls = getLS(ctx, op);
    inflateLayout(op, ls);

    int tid = 0;
    float fsize = 16;
    int col = 0;
    int maxLines = INT32_MAX;
    int mWeight = 400, mStyle = 0, mFamilyId = 0;
    float lsEm = 0, lhAdd = 0, lhMul = 1;
    if (op->opcode() == 208) {
        auto* lt = static_cast<LayoutText*>(op);
        tid = lt->textId;
        fsize = lt->oFontSize;
        col = lt->color;
        maxLines = lt->maxLines;
        mWeight = (int)lt->fontWeight; mStyle = lt->fontStyle; mFamilyId = lt->fontFamilyId;
    } else {
        auto* ct = static_cast<CoreTextOp*>(op);
        tid = ct->textId;
        fsize = ct->oFontSize;
        col = ct->color;
        maxLines = ct->maxLines;
        mWeight = (int)ct->fontWeight; mStyle = ct->fontStyle; mFamilyId = ct->fontFamilyId;
        lsEm = ct->letterSpacing; lhAdd = ct->lineHeightAdd; lhMul = ct->lineHeightMultiplier;
    }
    if (maxLines <= 0) maxLines = INT32_MAX;

    // Resolve NaN-encoded variable references (fallback for unresolved). A constant size is
    // in dp under DENSITY_BEHAVIOR_DP; a variable one is used as is (CoreText.updateVariables).
    {
        float rawSize = op->opcode() == 208 ? static_cast<LayoutText*>(op)->fontSize
                                            : static_cast<CoreTextOp*>(op)->fontSize;
        fsize = resolveVar(fsize, ctx);
        if (!std::isnan(rawSize)) fsize *= gDpScale;
    }
    if (fsize <= 0 || std::isnan(fsize)) fsize = 16;

    // Measure with the same typeface used for painting (weight/italic/family) so
    // bold/italic/named-family/monospace spans get the right widths. A named family (e.g.
    // "Futura") is resolved by the font manager; generic keywords map to a fontType.
    bool styledMeasure = false;
    std::string famName;
    int fType = 0;
    if (mFamilyId > 0) {
        famName = ctx.getText(mFamilyId);
        if (famName == "monospace") fType = 3;
        else if (famName == "serif") fType = 2;
        else if (famName == "sans-serif" || famName == "sans") fType = 1;
        else if (!famName.empty()) fType = -1;   // a named family
    }
    if (pc && (fType == -1 || mWeight != 400 || mStyle == 1 || fType > 0)) {
        pc->savePaint();
        if (fType == -1) {
            pc->applyTypefaceByName(famName, mWeight > 0 ? mWeight : 400, mStyle == 1);
        } else {
            PaintBundle tf;
            tf.addTypeface(mWeight > 0 ? mWeight : 400, mStyle == 1, fType != 0 ? fType : 1);
            pc->applyPaint(tf);
        }
        styledMeasure = true;
    }
    struct MeasureGuard {
        PaintContext* pc; bool on;
        ~MeasureGuard() { if (on) pc->restorePaint(); }
    } guard{pc, styledMeasure};

    std::string text = ctx.getText(tid);
    const float lsPx = lsEm * fsize;
    float textW = (pc ? pc->measureTextWidth(text, fsize) : fsize * 0.6f * text.size())
                  + lsPx * utf8Count(text);
    float lineH = pc ? pc->measureTextHeight(text, fsize) : fsize * 1.2f;
    // Capture the baseline with this component's own typeface applied (the guard is
    // still active here), so getAlignByValue can align mixed styles on one baseline.
    ls.textBaseline = ls.paddingTop + (pc ? pc->measureTextAscent(text, fsize)
                                          : fsize * 0.8f);
    ls.hasTextBaseline = true;
    LTRACE("    measureText cid=%d tid=%d text='%.20s' fsize=%.1f textW=%.1f lineH=%.1f maxW=%.1f maxH=%.1f\n",
           cid, tid, text.c_str(), fsize, textW, lineH, maxW, maxH);

    // Check if text needs wrapping within the available width or has embedded newlines
    float contentMaxW = maxW - ls.paddingLeft - ls.paddingRight;
    float textH = lineH;
    bool hasNewlines = (text.find('\n') != std::string::npos);
    // The reference wraps only when the text overflows AND more than one line is
    // allowed (TextLayout: `textWidth > maxWidth && mMaxLines > 1 && maxWidth > 0`),
    // or when a newline forces it. Wrapping regardless of maxLines made every
    // `maxLines: 1` text twice as tall as it is on the device.
    if (contentMaxW > 0 && ((textW > contentMaxW && maxLines > 1) || hasNewlines)) {
        auto wrappedLines = wrapText(pc, text, fsize,
                                     contentMaxW > 0 ? contentMaxW : 1e9f);
        if ((int) wrappedLines.size() > maxLines) {
            wrappedLines.resize(maxLines);
        }
        textH = lineH * wrappedLines.size()
                + lineGap(lineH, lhAdd, lhMul) * (float)(wrappedLines.size() - 1);
        // Compute actual max line width for proper sizing
        float maxLineW = 0;
        for (auto& line : wrappedLines) {
            std::string lineStr = text.substr(line.start, line.end - line.start);
            float lw = (pc ? pc->measureTextWidth(lineStr, fsize) : fsize * 0.6f * lineStr.size())
                       + lsPx * utf8Count(lineStr);
            maxLineW = std::max(maxLineW, lw);
        }
        textW = std::min(maxLineW, contentMaxW > 0 ? contentMaxW : maxLineW);
    }

    float measuredW = textW + ls.paddingLeft + ls.paddingRight;
    float measuredH = textH + ls.paddingTop + ls.paddingBottom;

    // Apply width/height modifiers. EXACT values may be NaN-boxed expressions
    // (e.g. an animated height); resolve them before use. A FILL fraction that is
    // still NaN after resolution means "fill completely".
    if (ls.widthType == DimType::EXACT || ls.widthType == DimType::EXACT_DP) {
        measuredW = resolveVar(ls.widthValue, ctx) * dimScale(ls.widthType) + ls.padBeforeWidth;
    } else if (ls.widthType == DimType::FILL) {
        float wv = resolveVar(ls.widthValue, ctx);
        measuredW = std::isnan(wv) ? maxW : maxW * wv;
    }

    if (ls.heightType == DimType::EXACT || ls.heightType == DimType::EXACT_DP) {
        measuredH = resolveVar(ls.heightValue, ctx) * dimScale(ls.heightType) + ls.padBeforeHeight;
    } else if (ls.heightType == DimType::FILL) {
        float hv = resolveVar(ls.heightValue, ctx);
        measuredH = std::isnan(hv) ? maxH : maxH * hv;
    }

    measuredW = std::max(measuredW, minW);
    measuredW = std::min(measuredW, maxW);
    measuredH = std::max(measuredH, minH);
    measuredH = std::min(measuredH, maxH);

    applyVisibility(ls, ctx, m);
    m.w = measuredW;
    m.h = measuredH;
    LTRACE("    measureText DONE cid=%d w=%.1f h=%.1f (text='%.20s' fsize=%.1f)\n", cid, m.w, m.h, text.c_str(), fsize);
}

// ── Min intrinsic size (Component.minIntrinsicWidth / minIntrinsicHeight) ──
// Text: its unconstrained size. A row sums its children's widths (a column their heights)
// and takes the largest on the other axis; any other layout takes the largest child. Each is
// at least what its modifiers define (padding plus an exact size).
static void minIntrinsicSize(Operation* op, PaintContext* pc, RemoteContext& ctx,
                             MeasurePass& measure, float& w, float& h) {
    int oc = op->opcode();
    if (oc == 208 || oc == 239) {
        measureComponent(op, pc, ctx, 0, 1e9f, 0, 1e9f, measure);
        auto& cm = measure.get(getComponentId(op));
        w = cm.w; h = cm.h;
        return;
    }
    auto& ls = getLS(ctx, op);
    inflateLayout(op, ls);
    if (oc == 230 || oc == 233) {
        // CollapsibleRow/ColumnLayout.minIntrinsicWidth/Height (FEATURE_PRIORITY_FIX, on by
        // default): the modifier-defined size plus the child that stays last (the highest
        // priority number, the first on ties); an exact size is just itself.
        int axis = oc == 230 ? 0 : 1;
        Operation* last = nullptr;
        float best = 0.0f;
        for (auto* child : ls.layoutChildren) {
            auto& cls = getLS(ctx, child);
            inflateLayout(child, cls);
            float p = (cls.hasCollapsePriority && cls.collapseOrientation == axis)
                          ? cls.collapsePriority : std::numeric_limits<float>::max();
            if (!last || p > best) { last = child; best = p; }
        }
        float iw = 0.0f, ih = 0.0f;
        if (last) minIntrinsicSize(last, pc, ctx, measure, iw, ih);
        auto exact = [](DimType t) { return t == DimType::EXACT || t == DimType::EXACT_DP; };
        w = computeModifierDefinedWidth(ls, ctx) + (exact(ls.widthType) ? 0.0f : iw);
        h = computeModifierDefinedHeight(ls, ctx) + (exact(ls.heightType) ? 0.0f : ih);
        return;
    }
    float cw = 0.0f, ch = 0.0f;
    bool row = oc == 203 || oc == 230, column = oc == 204 || oc == 233;
    for (auto* child : ls.layoutChildren) {
        float iw = 0.0f, ih = 0.0f;
        minIntrinsicSize(child, pc, ctx, measure, iw, ih);
        cw = row ? cw + iw : std::max(cw, iw);
        ch = column ? ch + ih : std::max(ch, ih);
    }
    float mw = computeModifierDefinedWidth(ls, ctx), mh = computeModifierDefinedHeight(ls, ctx);
    w = std::max(mw, cw);
    h = std::max(mh, ch);
}

// ── Measure a layout manager (Box, Row, Column, etc.) ────────────────
// Ported from Java LayoutManager.measure_v1_1_0()
static void measureLayoutManager(Operation* op, PaintContext* pc, RemoteContext& ctx,
                                 float minW, float maxW, float minH, float maxH,
                                 MeasurePass& measure) {
    int cid = getComponentId(op);
    auto& m = measure.get(cid);
    auto& ls = getLS(ctx, op);
    inflateLayout(op, ls);

    // STEP 1: Start with modifier-defined dimensions, clamped to maxWidth/maxHeight
    float measuredW = std::min(maxW, computeModifierDefinedWidth(ls, ctx));
    float measuredH = std::min(maxH, computeModifierDefinedHeight(ls, ctx));

    // STEP 3: Apply widthIn/heightIn constraints to min/max (Java step 3)
    if (ls.widthInMin >= 0) minW = std::max(minW, ls.widthInMin);
    if (ls.widthInMax >= 0) maxW = std::min(maxW, ls.widthInMax);
    if (ls.heightInMin >= 0) minH = std::max(minH, ls.heightInMin);
    if (ls.heightInMax >= 0) maxH = std::min(maxH, ls.heightInMax);

    // STEP 4: Compute inset dimensions (available space inside padding)
    float insetMaxW = maxW - ls.paddingLeft - ls.paddingRight;
    float insetMaxH = maxH - ls.paddingTop - ls.paddingBottom;

    // STEP 5-6: Determine sizing mode
    bool hasHWrap = false;
    bool hasVWrap = false;

    // RowLayout.isInHorizontalFill / ColumnLayout.isInVerticalFill: a row (or flow) with a
    // horizontally weighted child fills horizontally, a column with a vertically weighted
    // child fills vertically, whatever its own size modifier says (an exact size, whose
    // value is not a fraction, fills completely).
    bool weightFillW = false, weightFillH = false;
    {
        int o = op->opcode();
        bool rowish = o == 203 || o == 230 || o == 240, colish = o == 204 || o == 233;
        if (rowish || colish) {
            for (auto* child : ls.layoutChildren) {
                if (!isLayoutComponent(child)) continue;
                auto& cls = getLS(ctx, child);
                inflateLayout(child, cls);
                if (rowish && cls.widthType == DimType::WEIGHT) weightFillW = true;
                if (colish && cls.heightType == DimType::WEIGHT) weightFillH = true;
            }
        }
    }
    if (weightFillW && ls.widthType != DimType::FILL) {
        measuredW = maxW;
        minW = insetMaxW;
    } else if (ls.widthType == DimType::FILL) {
        // A fill may carry a fraction of the parent; NaN means fill completely.
        float wv = resolveVar(ls.widthValue, ctx);
        measuredW = std::isnan(wv) ? maxW : maxW * wv;
        minW = std::isnan(wv) ? insetMaxW
                              : measuredW - ls.paddingLeft - ls.paddingRight;
    } else if (ls.widthType != DimType::WEIGHT) {
        // max then min, as the reference: a widthIn minimum above the parent's maximum
        // gives the maximum (std::clamp is undefined when min > max).
        measuredW = std::min(std::max(measuredW, minW), maxW);
        hasHWrap = (ls.widthType == DimType::WRAP);
        // Measure version 2 tightening: non-WRAP gets exact inset
        if (!hasHWrap) {
            insetMaxW = measuredW - ls.paddingLeft - ls.paddingRight;
        }
    }

    if (weightFillH && ls.heightType != DimType::FILL) {
        measuredH = maxH;
        minH = insetMaxH;
    } else if (ls.heightType == DimType::FILL) {
        float hv = resolveVar(ls.heightValue, ctx);
        measuredH = std::isnan(hv) ? maxH : maxH * hv;
        minH = std::isnan(hv) ? insetMaxH
                              : measuredH - ls.paddingTop - ls.paddingBottom;
    } else if (ls.heightType != DimType::WEIGHT) {
        measuredH = std::min(std::max(measuredH, minH), maxH);
        hasVWrap = (ls.heightType == DimType::WRAP);
        // Measure version 2 tightening
        if (!hasVWrap) {
            insetMaxH = measuredH - ls.paddingTop - ls.paddingBottom;
        }
    }

    // STEP 7: If min == max, force to that exact value
    if (minW == maxW) measuredW = maxW;
    if (minH == maxH) measuredH = maxH;

    // Measure children based on layout type
    int oc = op->opcode();
    float wrapW = 0, wrapH = 0;
    // A collapsible row or column measures its children afresh each time (the reference's
    // computeVisibleChildren(fresh = true) clears the GONE it gave them): what an earlier
    // measure in this frame dropped is not gone for good (EXAMPLES_FINDINGS U39).
    if (oc == 230 || oc == 233) for (auto* child : ls.layoutChildren) unhide(child, ctx, measure);

    if (oc == 240) {
        // FlowLayout: wrap children into rows based on available width
        float spacedBy = static_cast<LayoutFlow*>(op)->spacedBy * gDpScale;

        // Inflate and measure all children first
        for (auto* child : ls.layoutChildren) {
            auto& childLS = getLS(ctx, child);
            inflateLayout(child, childLS);
            measureComponent(child, pc, ctx, 0, insetMaxW, 0, insetMaxH, measure);
        }

        // Segment children into rows based on available width
        // WEIGHT children use their WidthIn minimum for segmentation (matching TS)
        std::vector<std::vector<Operation*>> rows;
        rows.push_back({});
        float currentRowWidth = 0;

        for (auto* child : ls.layoutChildren) {
            auto& cm = measure.get(getComponentId(child));
            if (cm.isGone()) {
                rows.back().push_back(child);
                continue;
            }
            float childW = 0;
            auto& childLS = getLS(ctx, child);
            if (childLS.widthType == DimType::WEIGHT) {
                // Use minimum WidthIn width for WEIGHT children
                if (childLS.widthInMin > 0) {
                    childW = childLS.widthInMin;
                }
            } else {
                childW = cm.w;
            }
            if (currentRowWidth + childW > insetMaxW && !rows.back().empty()) {
                rows.push_back({});
                currentRowWidth = 0;
            }
            rows.back().push_back(child);
            currentRowWidth += childW;
        }

        // Calculate wrapW/wrapH from rows
        for (auto& row : rows) {
            float rowW = 0, rowH = 0;
            int rowVisible = 0;
            for (auto* child : row) {
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) {
                    rowW += cm.w;
                    rowH = std::max(rowH, cm.h);
                    rowVisible++;
                }
            }
            if (rowVisible > 1) rowW += spacedBy * (rowVisible - 1);
            wrapW = std::max(wrapW, rowW);
            wrapH += rowH;
        }
    } else if (oc == 203 || oc == 230) {
        // Row: children laid out horizontally
        float spacedBy = 0;
        if (oc == 203) spacedBy = static_cast<LayoutRow*>(op)->spacedBy * gDpScale;
        else if (oc == 230) spacedBy = static_cast<CollapsibleRowLayout*>(op)->spacedBy * gDpScale;

        // Check for WEIGHT width children (two-pass measurement)
        float totalWeights = 0;
        bool hasWeights = false;
        int totalChildCount = 0;
        for (auto* child : ls.layoutChildren) {
            auto& childLS = getLS(ctx, child);
            inflateLayout(child, childLS);
            if (childLS.widthType == DimType::WEIGHT) {
                hasWeights = true;
                totalWeights += childLS.widthValue;
            }
            totalChildCount++;
        }

        float currentMaxW = insetMaxW;
        int visibleCount = 0;

        if (hasWeights && totalWeights > 0) {
            // Pass 1: measure non-WEIGHT children first
            for (auto* child : ls.layoutChildren) {
                auto& childLS = getLS(ctx, child);
                if (childLS.widthType == DimType::WEIGHT) continue;
                measureComponent(child, pc, ctx, 0, currentMaxW, 0, insetMaxH, measure);
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) {
                    wrapW += cm.w;
                    wrapH = std::max(wrapH, cm.h);
                    currentMaxW -= cm.w;
                    visibleCount++;
                }
            }
            // Account for gaps between all visible children
            int weightChildCount = 0;
            for (auto* child : ls.layoutChildren) {
                auto& childLS = getLS(ctx, child);
                if (childLS.widthType == DimType::WEIGHT) weightChildCount++;
            }

            // remaining = insetMaxW - non_weight_total (no gap subtraction, matching TS)
            float remainingW = std::max(0.0f, insetMaxW - wrapW);

            // Pass 2: distribute remaining space to WEIGHT children proportionally
            for (auto* child : ls.layoutChildren) {
                auto& childLS = getLS(ctx, child);
                if (childLS.widthType != DimType::WEIGHT) continue;
                float childW = (childLS.widthValue / totalWeights) * remainingW;
                measureComponent(child, pc, ctx, childW, childW, 0, insetMaxH, measure);
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) {
                    wrapW += cm.w;
                    wrapH = std::max(wrapH, cm.h);
                    visibleCount++;
                }
            }
        } else {
            // No weights: measure all children sequentially
            for (auto* child : ls.layoutChildren) {
                measureComponent(child, pc, ctx, 0, currentMaxW, 0, insetMaxH, measure);
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) {
                    wrapW += cm.w;
                    wrapH = std::max(wrapH, cm.h);
                    currentMaxW -= cm.w;
                    visibleCount++;
                }
            }
        }
        if (visibleCount > 1) wrapW += spacedBy * (visibleCount - 1);
    } else if (oc == 204 || oc == 233) {
        // Column: children laid out vertically
        float spacedBy = 0;
        if (oc == 204) spacedBy = static_cast<LayoutColumn*>(op)->spacedBy * gDpScale;
        else if (oc == 233) spacedBy = static_cast<CollapsibleColumnLayout*>(op)->spacedBy * gDpScale;

        // Check for WEIGHT height children (two-pass measurement)
        float totalWeights = 0;
        bool hasWeights = false;
        int weightChildCount = 0;
        for (auto* child : ls.layoutChildren) {
            auto& childLS = getLS(ctx, child);
            inflateLayout(child, childLS);
            if (childLS.heightType == DimType::WEIGHT) {
                hasWeights = true;
                totalWeights += childLS.heightValue;
                weightChildCount++;
            }
        }

        int visibleCount = 0;

        if (hasWeights && totalWeights > 0) {
            // Pass 1: measure non-WEIGHT children first
            for (auto* child : ls.layoutChildren) {
                auto& childLS = getLS(ctx, child);
                if (childLS.heightType == DimType::WEIGHT) continue;
                measureComponent(child, pc, ctx, 0, insetMaxW, 0, insetMaxH, measure);
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) {
                    wrapW = std::max(wrapW, cm.w);
                    wrapH += cm.h;
                    visibleCount++;
                }
            }
            // remaining = insetMaxH - non_weight_total (no gap subtraction, matching TS)
            float remainingH = std::max(0.0f, insetMaxH - wrapH);

            // Pass 2: distribute remaining height proportionally
            for (auto* child : ls.layoutChildren) {
                auto& childLS = getLS(ctx, child);
                if (childLS.heightType != DimType::WEIGHT) continue;
                float childH = (childLS.heightValue / totalWeights) * remainingH;
                measureComponent(child, pc, ctx, 0, insetMaxW, childH, childH, measure);
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) {
                    wrapW = std::max(wrapW, cm.w);
                    wrapH += cm.h;
                    visibleCount++;
                }
            }
        } else {
            // No weights: measure all children sequentially
            for (auto* child : ls.layoutChildren) {
                measureComponent(child, pc, ctx, 0, insetMaxW, 0, insetMaxH, measure);
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) {
                    wrapW = std::max(wrapW, cm.w);
                    wrapH += cm.h;
                    visibleCount++;
                }
            }
        }
        if (visibleCount > 1) wrapH += spacedBy * (visibleCount - 1);
    } else {
        // Box/Canvas/FitBox: children overlaid
        // Create a pseudo parent measure for LayoutCompute
        ComponentMeasure parentM;
        parentM.w = insetMaxW;
        parentM.h = insetMaxH;
        for (auto* child : ls.layoutChildren) {
            measureComponent(child, pc, ctx, 0, insetMaxW, 0, insetMaxH, measure);
            auto& cm = measure.get(getComponentId(child));
            // Apply LayoutCompute TYPE_MEASURE modifiers (stored on CHILD's LayoutState)
            auto& childLS = getLS(ctx, child);
            for (auto& lci : childLS.measureComputes) {
                applyLayoutCompute(lci, ctx, cm, parentM);
            }
            if (!cm.isGone()) {
                wrapW = std::max(wrapW, cm.w);
                wrapH = std::max(wrapH, cm.h);
            }
        }
    }

    // STEP 8: Apply wrap sizes (Java)
    // The maximum is enforced here already (the reference does it after the wrap, in
    // STEP 10), because the children are re-measured below at the final size: a collapsible
    // column held to a heightIn maximum drops what does not fit in it.
    if (hasHWrap) {
        measuredW = wrapW + ls.paddingLeft + ls.paddingRight;
        measuredW = std::min(std::max(measuredW, minW), maxW);
    }
    if (hasVWrap) {
        measuredH = wrapH + ls.paddingTop + ls.paddingBottom;
        measuredH = std::min(std::max(measuredH, minH), maxH);
    }

    // Scroll-aware measurement (matching Java LayoutManager.measure_v1_1_0 scroll logic)
    // When a scroll modifier is present, re-measure children with unbounded dimension
    // on the scroll axis to discover the full content size.
    if (ls.hasScroll) {
        bool isVertical = (ls.scrollDirection == 0);
        float hostW = std::min(measuredW, maxW) - ls.paddingLeft - ls.paddingRight;
        float hostH = std::min(measuredH, maxH) - ls.paddingTop - ls.paddingBottom;

        // Measure children with Float.MAX_VALUE on the scroll axis
        float unboundW = isVertical ? hostW : 1e9f;
        float unboundH = isVertical ? 1e9f : hostH;

        float contentW = 0, contentH = 0;
        if (oc == 203 || oc == 230) {
            // Row: sum widths
            for (auto* child : ls.layoutChildren) {
                measureComponent(child, pc, ctx, 0, unboundW, 0, unboundH, measure);
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) { contentW += cm.w; contentH = std::max(contentH, cm.h); }
            }
        } else if (oc == 204 || oc == 233) {
            // Column: sum heights
            for (auto* child : ls.layoutChildren) {
                measureComponent(child, pc, ctx, 0, unboundW, 0, unboundH, measure);
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) { contentW = std::max(contentW, cm.w); contentH += cm.h; }
            }
        } else {
            // Box/Canvas: max of children
            for (auto* child : ls.layoutChildren) {
                measureComponent(child, pc, ctx, 0, unboundW, 0, unboundH, measure);
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) { contentW = std::max(contentW, cm.w); contentH = std::max(contentH, cm.h); }
            }
        }

        if (isVertical) {
            ls.scrollHostDimension = hostH;
            ls.scrollContentDimension = contentH;
        } else {
            ls.scrollHostDimension = hostW;
            ls.scrollContentDimension = contentW;
        }
    }

    // Always re-measure children with the final available space (matching TS computeSize)
    {
        float childMaxW = std::max(0.0f, measuredW - ls.paddingLeft - ls.paddingRight);
        float childMaxH = std::max(0.0f, measuredH - ls.paddingTop - ls.paddingBottom);

        // For scroll containers, use the unbounded content dimension
        if (ls.hasScroll) {
            if (ls.scrollDirection == 0) {
                // Vertical scroll: children get full content height
                childMaxH = std::max(childMaxH, ls.scrollContentDimension);
            } else {
                // Horizontal scroll: children get full content width
                childMaxW = std::max(childMaxW, ls.scrollContentDimension);
            }
        }

        // Re-measure children with final container dimensions (matching TS computeSize)
        if (oc == 203 || oc == 230) {
            if (oc == 230) {
                measureCollapsibleChildren(ls, pc, ctx, measure, 0, childMaxW, childMaxH,
                                           measuredW, measuredH, hasHWrap, hasVWrap);
            } else {
                // Row: as the column below, a WEIGHT child gets its share of what the others
                // leave, as the reference's RowLayout does (childMinWidth = weight * max /
                // total). Measured at a minimum of 0 it was only as wide as its padding, and a
                // wrapping text inside it then overflowed and was dropped (a collapsibleColumn
                // with weight and padding in a row drew nothing: EXAMPLES_FINDINGS U39).
                float totalWeights = 0;
                bool hasWeights = false;
                float totalNonWeightW = 0;
                float mw = childMaxW;
                // A GONE weighted child takes no part in the distribution (it is 0 wide).
                auto goneWeighted = [&](Operation* child) {
                    int cid = getComponentId(child);
                    return cid != -1 && measure.contains(cid) && measure.get(cid).isGone();
                };
                for (auto* child : ls.layoutChildren) {
                    auto& childLS = getLS(ctx, child);
                    if (childLS.widthType == DimType::WEIGHT && !goneWeighted(child)) {
                        hasWeights = true;
                        totalWeights += childLS.widthValue;
                    } else {
                        measureComponent(child, pc, ctx, 0, mw, 0, childMaxH, measure);
                        auto& cm = measure.get(getComponentId(child));
                        if (!cm.isGone()) {
                            mw -= cm.w;
                            totalNonWeightW += cm.w;
                        }
                    }
                }
                if (hasWeights && totalWeights > 0) {
                    mw = childMaxW;
                    for (auto* child : ls.layoutChildren) {
                        auto& childLS = getLS(ctx, child);
                        if (childLS.widthType == DimType::WEIGHT && !goneWeighted(child)) {
                            float wW = std::max(0.0f, childMaxW - totalNonWeightW) * childLS.widthValue / totalWeights;
                            measureComponent(child, pc, ctx, wW, wW, 0, childMaxH, measure);
                        } else {
                            measureComponent(child, pc, ctx, 0, mw, 0, childMaxH, measure);
                        }
                        auto& cm = measure.get(getComponentId(child));
                        if (!cm.isGone()) mw -= cm.w;
                    }
                }
            }
        } else if (oc == 204 || oc == 233) {
            // Column: handle WEIGHT children (matching TS Column.computeSize)
            float totalWeights = 0;
            bool hasWeights = false;
            float totalNonWeightH = 0;
            float mh = childMaxH;

            for (auto* child : ls.layoutChildren) {
                auto& childLS = getLS(ctx, child);
                if (childLS.heightType == DimType::WEIGHT) {
                    hasWeights = true;
                    totalWeights += childLS.heightValue;
                } else {
                    measureComponent(child, pc, ctx, 0, childMaxW, 0, mh, measure);
                    auto& cm = measure.get(getComponentId(child));
                    if (!cm.isGone()) {
                        mh -= cm.h;
                        totalNonWeightH += cm.h;
                    }
                }
            }
            if (hasWeights && totalWeights > 0) {
                // Re-measure all children with weight distribution
                mh = childMaxH;
                for (auto* child : ls.layoutChildren) {
                    auto& childLS = getLS(ctx, child);
                    if (childLS.heightType == DimType::WEIGHT) {
                        float wH = (childMaxH - totalNonWeightH) * childLS.heightValue / totalWeights;
                        measureComponent(child, pc, ctx, 0, childMaxW, wH, wH, measure);
                    } else {
                        measureComponent(child, pc, ctx, 0, childMaxW, 0, mh, measure);
                    }
                    auto& cm = measure.get(getComponentId(child));
                    if (!cm.isGone()) mh -= cm.h;
                }
            } else {
                // Already measured non-weight children above; if no weights, we're done
                // But need to re-measure with sequential remaining height
                mh = childMaxH;
                for (auto* child : ls.layoutChildren) {
                    measureComponent(child, pc, ctx, 0, childMaxW, 0, mh, measure);
                    auto& cm = measure.get(getComponentId(child));
                    if (!cm.isGone()) mh -= cm.h;
                }
            }
            if (oc == 233) {
                measureCollapsibleChildren(ls, pc, ctx, measure, 1, childMaxH, childMaxW,
                                           measuredW, measuredH, hasHWrap, hasVWrap);
            }
        } else if (oc == 176) {
            // FitBoxLayout.computeWrapSizePriorityFix (FEATURE_PRIORITY_FIX is on by default):
            // the first child, in order, whose min intrinsic size fits and which, measured
            // from that minimum up to the box, still fits, is shown; every other child is GONE.
            bool found = false;
            for (auto* child : ls.layoutChildren) {
                unhide(child, ctx, measure);
                auto& cm = measure.get(getComponentId(child));
                if (!found) {
                    float iw = 0.0f, ih = 0.0f;
                    minIntrinsicSize(child, pc, ctx, measure, iw, ih);
                    if (iw <= childMaxW + 0.5f && ih <= childMaxH + 0.5f) {
                        measureComponent(child, pc, ctx, iw, childMaxW, ih, childMaxH, measure);
                        auto& cm2 = measure.get(getComponentId(child));
                        if (!cm2.isGone() && cm2.w <= childMaxW + 0.5f
                            && cm2.h <= childMaxH + 0.5f) {
                            found = true;
                            continue;
                        }
                    }
                }
                cm.visibility = VIS_GONE;
            }
        } else {
            // Box/Canvas/FlowLayout: simple re-measure
            ComponentMeasure parentM;
            parentM.w = childMaxW;
            parentM.h = childMaxH;
            for (auto* child : ls.layoutChildren) {
                measureComponent(child, pc, ctx, 0, childMaxW, 0, childMaxH, measure);
                // Apply LayoutCompute TYPE_MEASURE modifiers (stored on CHILD)
                auto& childLS = getLS(ctx, child);
                if (!childLS.measureComputes.empty()) {
                    auto& cm = measure.get(getComponentId(child));
                    for (auto& lci : childLS.measureComputes) {
                        applyLayoutCompute(lci, ctx, cm, parentM);
                    }
                }
            }
        }
    }

    // STEP 10: Enforce the constraints one more time (Java; ENFORCE_CONSTRAINTS, the default
    // measure version): the min, then the max — so a widthIn minimum above the parent's
    // maximum gives the maximum — then a required widthIn/heightIn, which may exceed it.
    measuredW = std::max(measuredW, minW);
    measuredH = std::max(measuredH, minH);
    measuredW = std::min(measuredW, maxW);
    measuredH = std::min(measuredH, maxH);
    if (ls.widthInRequired)
        measuredW = std::max(ls.widthInMin, std::min(measuredW, ls.widthInMax));
    if (ls.heightInRequired)
        measuredH = std::max(ls.heightInMin, std::min(measuredH, ls.heightInMax));

    // (A canvas used to keep its exact height past the parent's maximum here, for tall
    // drawings in a scroll viewport. The reference clamps it like any component — a scroll
    // host measures its children unbounded, so the clamp never bites there — and a widget
    // resized smaller must get a smaller canvas, not one drawn past its box: U40.)

    applyVisibility(ls, ctx, m);
    m.w = measuredW;
    m.h = measuredH;
    LTRACE("  measureLayout DONE cid=%d opcode=%d w=%.1f h=%.1f wrapW=%.1f wrapH=%.1f hasHWrap=%d hasVWrap=%d\n",
           cid, op->opcode(), m.w, m.h, wrapW, wrapH, hasHWrap, hasVWrap);
}

// ── Compute AlignBy baseline value for a child component ─────────────
// Returns the baseline offset (distance from top of component to baseline).
// For text components: uses font metrics approximation.
// For non-text components with AlignBy: returns 0.
static float getAlignByValue(Operation* child, RemoteContext& ctx, PaintContext* pc) {
    auto& childLS = getLS(ctx, child);
    if (!childLS.hasAlignBy) return 0;

    float line = childLS.alignByLine;
    int oc = child->opcode();

    // Check if line is NaN-encoded (baseline ID or variable reference)
    if (std::isnan(line)) {
        int id = Utils::idFromNan(line);
        // AlignByModifierOperation: ID_FIRST_BASELINE = 1, ID_LAST_BASELINE = 2
        if (id == 1 || id == 2) {
            // Prefer the baseline captured during measureText — it was measured with
            // this component's own typeface (bold/italic/monospace), which the shared
            // paint here is not, so re-measuring would ignore per-span metrics.
            if (childLS.hasTextBaseline) return childLS.textBaseline;
            // Fallback: measure ascent with whatever font is currently active.
            if (oc == 208 || oc == 239) {
                float fsize = 16;
                int tid = 0;
                if (oc == 208) {
                    auto* lt = static_cast<LayoutText*>(child);
                    fsize = lt->oFontSize;
                    tid = lt->textId;
                } else {
                    auto* ct = static_cast<CoreTextOp*>(child);
                    fsize = ct->oFontSize;
                    tid = ct->textId;
                }
                fsize = resolveVar(fsize, ctx);
                if (fsize <= 0 || std::isnan(fsize)) fsize = 16;
                // Baseline = actual font ascent from metrics
                std::string text = ctx.getText(tid);
                float ascent = pc ? pc->measureTextAscent(text, fsize) : fsize;
                return ascent;
            }
            return 0;
        }
        // Other NaN-encoded variable reference
        if (Utils::isVariable(line)) {
            return ctx.getFloat(Utils::idFromNan(line));
        }
        return 0;
    }
    // Literal value
    return line;
}

// ── Layout a manager: position children ──────────────────────────────
static void layoutManager(Operation* op, RemoteContext& ctx, MeasurePass& measure) {
    int cid = getComponentId(op);
    auto& selfM = measure.get(cid);
    auto& ls = getLS(ctx, op);

    float selfW = selfM.w - ls.paddingLeft - ls.paddingRight;
    float selfH = selfM.h - ls.paddingTop - ls.paddingBottom;

    int oc = op->opcode();

    auto* pc = ctx.getPaintContext();

    if (oc == 240) {
        // FlowLayout: position children in wrapped rows
        int hPos = static_cast<LayoutFlow*>(op)->horizontal;
        int vPos = static_cast<LayoutFlow*>(op)->vertical;
        float spacedBy = static_cast<LayoutFlow*>(op)->spacedBy * gDpScale;

        // Segment children into rows (WEIGHT children use WidthIn min, matching TS)
        std::vector<std::vector<Operation*>> rows;
        rows.push_back({});
        float currentRowWidth = 0;
        for (auto* child : ls.layoutChildren) {
            auto& cm = measure.get(getComponentId(child));
            if (cm.isGone()) {
                rows.back().push_back(child);
                continue;
            }
            float childW = 0;
            auto& childLS = getLS(ctx, child);
            if (childLS.widthType == DimType::WEIGHT) {
                if (childLS.widthInMin > 0) {
                    childW = childLS.widthInMin;
                }
            } else {
                childW = cm.w;
            }
            if (currentRowWidth + childW > selfW && !rows.back().empty()) {
                rows.push_back({});
                currentRowWidth = 0;
            }
            rows.back().push_back(child);
            currentRowWidth += childW;
        }

        // Calculate total rows height for vertical positioning
        float rowsHeight = 0;
        for (auto& row : rows) {
            float rowH = 0;
            for (auto* child : row) {
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) rowH = std::max(rowH, cm.h);
            }
            rowsHeight += rowH;
        }

        float posY = 0;
        switch (vPos) {
            case POS_CENTER: posY = (selfH - rowsHeight) / 2; break;
            case POS_BOTTOM: case POS_END: posY = selfH - rowsHeight; break;
            default: posY = 0; break;
        }

        for (auto& row : rows) {
            // Per-row weight redistribution (matching Java RowLayout.internalLayoutMeasure)
            {
                bool rowHasWeights = false;
                float rowTotalWeights = 0;
                float rowNonWeightW = 0;
                for (auto* child : row) {
                    auto& cm = measure.get(getComponentId(child));
                    if (cm.isGone()) continue;
                    auto& childLS = getLS(ctx, child);
                    if (childLS.widthType == DimType::WEIGHT) {
                        rowHasWeights = true;
                        rowTotalWeights += childLS.widthValue;
                    } else {
                        rowNonWeightW += cm.w;
                    }
                }
                if (rowHasWeights && rowTotalWeights > 0) {
                    float rowAvail = selfW - rowNonWeightW;
                    for (auto* child : row) {
                        auto& childLS = getLS(ctx, child);
                        if (childLS.widthType != DimType::WEIGHT) continue;
                        auto& cm = measure.get(getComponentId(child));
                        if (cm.isGone()) continue;
                        float childW = (childLS.widthValue * rowAvail) / rowTotalWeights;
                        if (childLS.widthInMin >= 0) childW = std::max(childLS.widthInMin, childW);
                        if (childLS.widthInMax >= 0) childW = std::min(childLS.widthInMax, childW);
                        cm.w = childW;
                        measureComponent(child, pc, ctx, childW, childW, cm.h, cm.h, measure);
                    }
                }
            }

            float rowH = 0, rowW = 0;
            int rowVisible = 0;
            for (auto* child : row) {
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) {
                    rowH = std::max(rowH, cm.h);
                    rowW += cm.w;
                    rowVisible++;
                }
            }
            if (rowVisible > 1) rowW += spacedBy * (rowVisible - 1);

            // Calculate starting X for this row (matching Java RowLayout positioning)
            float rowChildSum = rowW - spacedBy * std::max(0, rowVisible - 1);
            float tx = 0;
            float gap = 0;
            switch (hPos) {
                case POS_START: tx = 0; break;
                case POS_CENTER: tx = (selfW - rowW) / 2; break;
                case POS_END: tx = selfW - rowW; break;
                case POS_SPACE_BETWEEN:
                    if (rowVisible > 1) gap = (selfW - rowChildSum) / (rowVisible - 1);
                    else tx = (selfW - rowChildSum) / 2;
                    break;
                case POS_SPACE_EVENLY:
                    if (rowVisible > 0) gap = (selfW - rowChildSum) / (rowVisible + 1);
                    tx = gap;
                    break;
                case POS_SPACE_AROUND:
                    if (rowVisible > 0) gap = (selfW - rowChildSum) / rowVisible;
                    tx = gap / 2;
                    break;
                default: break;
            }

            // AlignBy baseline within this row: align children on a common baseline
            // (the reason alignByBaseline exists — wrapped inline-styled text keeps a
            // consistent baseline even when spans differ in metrics).
            bool rowHasAlignBy = false;
            float rowMaxAlignBy = 0;
            for (auto* child : row) {
                auto& cm = measure.get(getComponentId(child));
                if (cm.isGone()) continue;
                if (getLS(ctx, child).hasAlignBy) {
                    rowHasAlignBy = true;
                    rowMaxAlignBy = std::max(rowMaxAlignBy, getAlignByValue(child, ctx, pc));
                }
            }

            for (auto* child : row) {
                auto& cm = measure.get(getComponentId(child));
                if (cm.isGone()) continue;
                float alignByOffset = (rowHasAlignBy && getLS(ctx, child).hasAlignBy)
                                          ? getAlignByValue(child, ctx, pc) : 0;
                // Within-row vertical alignment (matching TS)
                float ty = 0;
                switch (vPos) {
                    case POS_CENTER:
                        ty = rowHasAlignBy ? (rowMaxAlignBy - alignByOffset)
                                           : (rowH - cm.h) / 2;
                        break;
                    case POS_BOTTOM: case POS_END:
                        // rowH is already the max child height, so the bottom-aligned
                        // baseline block reduces to the same per-child offset.
                        ty = rowHasAlignBy ? (rowMaxAlignBy - alignByOffset)
                                           : (rowH - cm.h);
                        break;
                    default:
                        ty = rowHasAlignBy ? (rowMaxAlignBy - alignByOffset) : 0;
                        break;
                }
                cm.x = tx;
                cm.y = posY + ty;
                tx += cm.w;
                if (hPos == POS_SPACE_BETWEEN || hPos == POS_SPACE_AROUND || hPos == POS_SPACE_EVENLY) {
                    tx += gap;
                }
                tx += spacedBy;
                layoutComponent(child, ctx, measure);
            }
            posY += rowH;
        }
    } else if (oc == 203 || oc == 230) {
        // Row: position children horizontally
        int hPos = 0, vPos = 0;
        float spacedBy = 0;
        if (oc == 203) {
            hPos = static_cast<LayoutRow*>(op)->horizontal;
            vPos = static_cast<LayoutRow*>(op)->vertical;
            spacedBy = static_cast<LayoutRow*>(op)->spacedBy * gDpScale;
        } else {
            hPos = static_cast<CollapsibleRowLayout*>(op)->horizontal;
            vPos = static_cast<CollapsibleRowLayout*>(op)->vertical;
            spacedBy = static_cast<CollapsibleRowLayout*>(op)->spacedBy * gDpScale;
        }

        // Weight redistribution (matching TS internalLayoutMeasure)
        {
            bool hasWeights = false;
            float totalWeights = 0;
            float nonWeightWidth = 0;
            for (auto* child : ls.layoutChildren) {
                auto& cm = measure.get(getComponentId(child));
                if (cm.isGone()) continue;
                auto& childLS = getLS(ctx, child);
                if (childLS.widthType == DimType::WEIGHT) {
                    hasWeights = true;
                    totalWeights += childLS.widthValue;
                } else {
                    nonWeightWidth += cm.w;
                }
            }
            if (hasWeights && totalWeights > 0) {
                float availableSpace = selfW - nonWeightWidth;
                for (auto* child : ls.layoutChildren) {
                    auto& childLS = getLS(ctx, child);
                    if (childLS.widthType != DimType::WEIGHT) continue;
                    auto& cm = measure.get(getComponentId(child));
                    if (cm.isGone()) continue;
                    float childWidth = (childLS.widthValue * availableSpace) / totalWeights;
                    // Apply WidthIn constraints
                    if (childLS.widthInMin >= 0) childWidth = std::max(childLS.widthInMin, childWidth);
                    if (childLS.widthInMax >= 0) childWidth = std::min(childLS.widthInMax, childWidth);
                    cm.w = childWidth;
                    measureComponent(child, pc, ctx, childWidth, childWidth, cm.h, cm.h, measure);
                }
            }
        }

        // Calculate total children width
        float totalW = 0;
        int visibleCount = 0;
        for (auto* child : ls.layoutChildren) {
            auto& cm = measure.get(getComponentId(child));
            if (!cm.isGone()) {
                totalW += cm.w;
                visibleCount++;
            }
        }
        totalW += spacedBy * std::max(0, visibleCount - 1);

        // Calculate starting X based on horizontal positioning
        // Java: for SPACE_*, compute gap from sum of child widths (not including spacedBy)
        float childrenWidthSum = totalW - spacedBy * std::max(0, visibleCount - 1);
        float startX = 0;
        float gap = 0;
        switch (hPos) {
            case POS_START: startX = 0; break;
            case POS_CENTER: startX = (selfW - totalW) / 2; break;
            case POS_END: startX = selfW - totalW; break;
            case POS_SPACE_BETWEEN:
                if (visibleCount > 1) gap = (selfW - childrenWidthSum) / (visibleCount - 1);
                else startX = (selfW - childrenWidthSum) / 2;  // Java: center single child
                break;
            case POS_SPACE_EVENLY:
                if (visibleCount > 0) gap = (selfW - childrenWidthSum) / (visibleCount + 1);
                startX = gap;
                break;
            case POS_SPACE_AROUND:
                if (visibleCount > 0) gap = (selfW - childrenWidthSum) / visibleCount;
                startX = gap / 2;
                break;
            default: break;
        }

        // AlignBy baseline: collect max baseline value across children
        bool hasAlignBy = false;
        float maxAlignByValue = 0;
        float childrenHeight = 0;
        for (auto* child : ls.layoutChildren) {
            auto& cm = measure.get(getComponentId(child));
            if (cm.isGone()) continue;
            childrenHeight = std::max(childrenHeight, cm.h);
            auto& childLS = getLS(ctx, child);
            if (childLS.hasAlignBy) {
                hasAlignBy = true;
                float abv = getAlignByValue(child, ctx, pc);
                maxAlignByValue = std::max(maxAlignByValue, abv);
            }
        }

        float tx = startX;
        for (auto* child : ls.layoutChildren) {
            auto& cm = measure.get(getComponentId(child));

            float alignByOffset = 0;
            if (hasAlignBy) {
                auto& childLS = getLS(ctx, child);
                if (childLS.hasAlignBy) {
                    alignByOffset = getAlignByValue(child, ctx, pc);
                }
            }

            float ty = 0;
            switch (vPos) {
                case POS_TOP: case POS_START:
                    ty = 0;
                    if (hasAlignBy) ty += maxAlignByValue - alignByOffset;
                    break;
                case POS_CENTER:
                    // Per-child centring (matches Java RowLayout.java:514).
                    // The childrenHeight (max of all children) is only used
                    // when alignBy is in play, so the whole row of children
                    // is centred together as a baseline-aligned block.
                    if (hasAlignBy) {
                        ty = (selfH - childrenHeight) / 2;
                        ty += maxAlignByValue - alignByOffset;
                    } else {
                        ty = (selfH - cm.h) / 2;
                    }
                    break;
                case POS_BOTTOM: case POS_END:
                    ty = selfH - cm.h;
                    if (hasAlignBy) {
                        ty = selfH - childrenHeight;
                        ty += maxAlignByValue - alignByOffset;
                    }
                    break;
                default: ty = 0; break;
            }
            cm.x = tx;
            cm.y = ty;
            // RowLayout positions a GONE child too (where the next one goes), and lays it
            // out, but does not advance past it.
            if (cm.isGone()) { layoutComponent(child, ctx, measure); continue; }
            tx += cm.w;
            // Java: both mSpacedBy and distribution gap are added
            if (hPos == POS_SPACE_BETWEEN || hPos == POS_SPACE_AROUND || hPos == POS_SPACE_EVENLY) {
                tx += gap;
            }
            tx += spacedBy;  // mSpacedBy is always added (Java line ~517)
            layoutComponent(child, ctx, measure);
        }
    } else if (oc == 204 || oc == 233) {
        // Column: position children vertically
        int hPos = 0, vPos = 0;
        float spacedBy = 0;
        if (oc == 204) {
            hPos = static_cast<LayoutColumn*>(op)->horizontal;
            vPos = static_cast<LayoutColumn*>(op)->vertical;
            spacedBy = static_cast<LayoutColumn*>(op)->spacedBy * gDpScale;
        } else {
            hPos = static_cast<CollapsibleColumnLayout*>(op)->horizontal;
            vPos = static_cast<CollapsibleColumnLayout*>(op)->vertical;
            spacedBy = static_cast<CollapsibleColumnLayout*>(op)->spacedBy * gDpScale;
        }

        // Weight redistribution (matching TS internalLayoutMeasure)
        {
            bool hasWeights = false;
            float totalWeights = 0;
            float nonWeightHeight = 0;
            for (auto* child : ls.layoutChildren) {
                auto& cm = measure.get(getComponentId(child));
                if (cm.isGone()) continue;
                auto& childLS = getLS(ctx, child);
                if (childLS.heightType == DimType::WEIGHT) {
                    hasWeights = true;
                    totalWeights += childLS.heightValue;
                } else {
                    nonWeightHeight += cm.h;
                }
            }
            if (hasWeights && totalWeights > 0) {
                float availableSpace = selfH - nonWeightHeight;
                for (auto* child : ls.layoutChildren) {
                    auto& childLS = getLS(ctx, child);
                    if (childLS.heightType != DimType::WEIGHT) continue;
                    auto& cm = measure.get(getComponentId(child));
                    if (cm.isGone()) continue;
                    float childHeight = (childLS.heightValue * availableSpace) / totalWeights;
                    // Apply HeightIn constraints
                    if (childLS.heightInMin >= 0) childHeight = std::max(childLS.heightInMin, childHeight);
                    if (childLS.heightInMax >= 0) childHeight = std::min(childLS.heightInMax, childHeight);
                    cm.h = childHeight;
                    measureComponent(child, pc, ctx, cm.w, cm.w, childHeight, childHeight, measure);
                }
            }
        }

        float totalH = 0;
        int visibleCount = 0;
        for (auto* child : ls.layoutChildren) {
            auto& cm = measure.get(getComponentId(child));
            if (!cm.isGone()) {
                totalH += cm.h;
                visibleCount++;
            }
        }
        totalH += spacedBy * std::max(0, visibleCount - 1);

        // Java: for SPACE_*, compute gap from sum of child heights (not including spacedBy)
        float childrenHeightSum = totalH - spacedBy * std::max(0, visibleCount - 1);
        float startY = 0;
        float gap = 0;
        switch (vPos) {
            case POS_TOP: case POS_START: startY = 0; break;
            case POS_CENTER: startY = (selfH - totalH) / 2; break;
            case POS_BOTTOM: case POS_END: startY = selfH - totalH; break;
            case POS_SPACE_BETWEEN:
                if (visibleCount > 1) gap = (selfH - childrenHeightSum) / (visibleCount - 1);
                else startY = (selfH - childrenHeightSum) / 2;  // Java: center single child
                break;
            case POS_SPACE_EVENLY:
                if (visibleCount > 0) gap = (selfH - childrenHeightSum) / (visibleCount + 1);
                startY = gap;
                break;
            case POS_SPACE_AROUND:
                if (visibleCount > 0) gap = (selfH - childrenHeightSum) / visibleCount;
                startY = gap / 2;
                break;
            default: break;
        }

        float ty = startY;
        for (auto* child : ls.layoutChildren) {
            auto& cm = measure.get(getComponentId(child));

            float tx = 0;
            switch (hPos) {
                case POS_START: tx = 0; break;
                case POS_CENTER: tx = (selfW - cm.w) / 2; break;
                case POS_END: tx = selfW - cm.w; break;
                default: tx = 0; break;
            }
            cm.x = tx;
            cm.y = ty;
            // ColumnLayout positions a GONE child too, without advancing past it.
            if (cm.isGone()) { layoutComponent(child, ctx, measure); continue; }
            ty += cm.h;
            if (vPos == POS_SPACE_BETWEEN || vPos == POS_SPACE_AROUND || vPos == POS_SPACE_EVENLY) {
                ty += gap;
            }
            ty += spacedBy;
            layoutComponent(child, ctx, measure);
        }
    } else {
        // Box/Canvas/FitBox/StateLayout: position all children by alignment
        int hPos = 0, vPos = 0;
        if (oc == 202) {
            hPos = static_cast<LayoutBox*>(op)->horizontal;
            vPos = static_cast<LayoutBox*>(op)->vertical;
        } else if (oc == 176) {
            // FitBoxLayout.internalLayoutMeasure positions the shown child by its own
            // horizontal/vertical positioning, like a box.
            hPos = static_cast<FitBoxLayout*>(op)->horizontal;
            vPos = static_cast<FitBoxLayout*>(op)->vertical;
        } else if (oc == 217) {
            hPos = static_cast<StateLayout*>(op)->horizontalPositioning;
            vPos = static_cast<StateLayout*>(op)->verticalPositioning;
        }

        // Parent measure for LayoutCompute
        ComponentMeasure parentM;
        parentM.w = selfW;
        parentM.h = selfH;

        // BoxLayout positions every child, GONE ones included.
        for (auto* child : ls.layoutChildren) {
            auto& cm = measure.get(getComponentId(child));

            float tx = 0, ty = 0;
            switch (hPos) {
                case POS_START: tx = 0; break;
                case POS_CENTER: tx = (selfW - cm.w) / 2; break;
                case POS_END: tx = selfW - cm.w; break;
                default: tx = 0; break;
            }
            switch (vPos) {
                case POS_TOP: ty = 0; break;
                case POS_CENTER: ty = (selfH - cm.h) / 2; break;
                case POS_BOTTOM: ty = selfH - cm.h; break;
                default: ty = 0; break;
            }
            cm.x = tx;
            cm.y = ty;

            // Apply LayoutCompute TYPE_POSITION modifiers (stored on CHILD's LayoutState)
            auto& childLS = getLS(ctx, child);
            for (auto& lci : childLS.positionComputes) {
                applyLayoutCompute(lci, ctx, cm, parentM);
            }

            layoutComponent(child, ctx, measure);
        }
    }

    // Write scroll max/notch variables to context (matching Java ScrollModifierOperation.layout())
    if (ls.hasScroll) {
        float maxScroll = std::max(0.0f, ls.scrollContentDimension - ls.scrollHostDimension);
        if (ls.scrollOp) {
            auto* so = static_cast<ModifierScroll*>(ls.scrollOp);
            so->maxScroll = maxScroll;
            so->scrollOffset = std::min(so->scrollOffset, maxScroll);
        }
        if (Utils::isVariable(ls.scrollMaxNan)) {
            ctx.loadFloat(Utils::idFromNan(ls.scrollMaxNan), maxScroll);
        }
        if (Utils::isVariable(ls.scrollNotchNan)) {
            ctx.loadFloat(Utils::idFromNan(ls.scrollNotchNan), ls.scrollContentDimension);
        }
    }
}

// ── StateLayout (217) ────────────────────────────────────────────────
// Port of StateLayout.java. Only the current state (the child at the index the variable
// holds) is measured, with the constraints the StateLayout was given -- its own modifiers
// play no part in its size -- and the StateLayout takes that state's size. The other states
// are GONE and are neither measured nor laid out again: they keep the bounds they were last
// laid out at (their modifier-defined size, at 0,0, if never).
//
// Components carrying an animation id (an ANIMATION_SPEC modifier, or the component's own
// animationId) are shared across states: when the state changes, the one in the new state
// starts from the bounds its counterpart in the previous state was shown at, so it moves and
// resizes into place, while the previous state's other children are kept on screen for their
// exit (fade) animation (layoutStateLayout / the 217 branch of paintLayoutComponent).

static int getOpAnimationId(const Operation* op) {
    switch (op->opcode()) {
        case 202: return static_cast<const LayoutBox*>(op)->animationId;
        case 203: return static_cast<const LayoutRow*>(op)->animationId;
        case 204: return static_cast<const LayoutColumn*>(op)->animationId;
        case 205: return static_cast<const LayoutCanvas*>(op)->animationId;
        case 208: return static_cast<const LayoutText*>(op)->animationId;
        case 239: return static_cast<const CoreTextOp*>(op)->animationId;
        case 240: return static_cast<const LayoutFlow*>(op)->animationId;
        case 176: return static_cast<const FitBoxLayout*>(op)->animationId;
        case 230: return static_cast<const CollapsibleRowLayout*>(op)->animationId;
        case 233: return static_cast<const CollapsibleColumnLayout*>(op)->animationId;
        case 217: return static_cast<const StateLayout*>(op)->animationId;
        default: return -1;
    }
}

// Component.mAnimationId: the ANIMATION_SPEC modifier's id when it has one (inflate), else
// the id the component was declared with.
static int animationIdOf(Operation* op, RemoteContext& ctx) {
    auto& ls = getLS(ctx, op);
    inflateLayout(op, ls);
    if (ls.animSpec) return static_cast<AnimationSpec*>(ls.animSpec)->animationId;
    int a = getOpAnimationId(op);
    return a == 0 ? -1 : a;
}

static void collectAnimated(Operation* op, RemoteContext& ctx, std::vector<Operation*>& out) {
    if (getComponentId(op) == -1) return;
    if (animationIdOf(op, ctx) != -1) out.push_back(op);
    auto& ls = getLS(ctx, op);
    for (auto* child : ls.layoutChildren) collectAnimated(child, ctx, out);
}

// The bounds LayoutComponent.inflate gives a component before it is ever measured: its
// modifier-defined size (the paddings before its size modifier plus an exact size; a fill is
// 0), at 0,0. A state that was never shown keeps these.
static void seedUnmeasured(Operation* op, RemoteContext& ctx, MeasurePass& measure) {
    int cid = getComponentId(op);
    if (cid == -1) return;
    auto& ls = getLS(ctx, op);
    inflateLayout(op, ls);
    if (!measure.contains(cid)) {
        auto& m = measure.get(cid);
        auto exact = [](DimType t) { return t == DimType::EXACT || t == DimType::EXACT_DP; };
        float w = exact(ls.widthType) ? resolveVar(ls.widthValue, ctx) * dimScale(ls.widthType) : 0.0f;
        float h = exact(ls.heightType) ? resolveVar(ls.heightValue, ctx) * dimScale(ls.heightType) : 0.0f;
        m.x = 0; m.y = 0;
        m.w = ls.padBeforeWidth + w;
        m.h = ls.padBeforeHeight + h;
        m.visibility = VIS_VISIBLE;
    }
    for (auto* child : ls.layoutChildren) seedUnmeasured(child, ctx, measure);
}

static Operation* stateAt(const LayoutState& ls, int idx) {
    if (ls.layoutChildren.empty()) return nullptr;
    if (idx >= 0 && idx < (int)ls.layoutChildren.size()) return ls.layoutChildren[idx];
    return ls.layoutChildren[0];   // getLayout: the first child when the index is out of range
}

static void measureStateLayout(Operation* op, PaintContext* pc, RemoteContext& ctx,
                               float minW, float maxW, float minH, float maxH,
                               MeasurePass& measure) {
    auto* sl = static_cast<StateLayout*>(op);
    int cid = getComponentId(op);
    auto& ls = getLS(ctx, op);
    inflateLayout(op, ls);
    auto& self = measure.get(cid);
    if (ls.layoutChildren.empty()) { self.w = 0; self.h = 0; return; }

    // The index moves at paint (stateLayoutReadIndex), as StateLayout.paint does, so a new
    // state is measured on the frame after the one that saw the variable change. The first
    // index is taken as is (the reference starts from state 0 and switches on its first
    // paint, which with animations on plays the first state's exit).
    if (!sl->indexInitialized) {
        sl->indexInitialized = true;
        sl->currentIndex = sl->previousIndex = sl->indexId != 0 ? ctx.getInteger(sl->indexId) : 0;
    }
    Operation* layout = stateAt(ls, sl->currentIndex);
    Operation* previous = stateAt(ls, sl->previousIndex);

    // The states not shown: GONE, at the bounds they had (inflate's when never laid out).
    // The previous state stays up for the length of the transition.
    for (auto* pane : ls.layoutChildren) {
        if (pane == layout) continue;
        seedUnmeasured(pane, ctx, measure);
        if (!(sl->inTransition && pane == previous) && getComponentId(pane) != getComponentId(layout))
            measure.get(getComponentId(pane)).visibility = VIS_GONE;
    }

    int paneId = getComponentId(layout);
    measure.get(paneId).visibility = VIS_VISIBLE;      // layout.setVisibility(VISIBLE)
    measureComponent(layout, pc, ctx, minW, maxW, minH, maxH, measure);

    // statePaintedComponents: per animation id, its component in each state.
    std::unordered_map<int, std::vector<Operation*>> painted;
    std::vector<std::vector<Operation*>> animatedIn(ls.layoutChildren.size());
    for (size_t i = 0; i < ls.layoutChildren.size(); i++) {
        collectAnimated(ls.layoutChildren[i], ctx, animatedIn[i]);
        for (auto* c : animatedIn[i]) {
            auto& v = painted[animationIdOf(c, ctx)];
            if (v.empty()) v.assign(ls.layoutChildren.size(), nullptr);
            v[i] = c;
        }
    }
    int curPos = -1, prevPos = -1;
    for (size_t i = 0; i < ls.layoutChildren.size(); i++) {
        if (ls.layoutChildren[i] == layout) curPos = (int)i;
        if (ls.layoutChildren[i] == previous) prevPos = (int)i;
    }

    // In a transition, a shared component of the new state starts from the bounds its
    // counterpart was shown at (c.setX(prev.getX()) ..., mFirstLayout = false).
    static thread_local LayoutAnimStore sDetached;
    LayoutAnimStore& store = ctx.getDocument() ? ctx.getDocument()->animStore() : sDetached;
    if (sl->inTransition && curPos != prevPos && prevPos >= 0) {
        for (auto* c : animatedIn[curPos]) {
            auto& v = painted[animationIdOf(c, ctx)];
            Operation* prev = v[prevPos];
            if (!prev || prev == c) continue;
            auto pit = store.find(getComponentId(prev));
            if (pit == store.end() || !pit->second.hasLive) continue;
            auto& st = store[getComponentId(c)];
            if (st.hasLive && st.live.isVisible() && st.animating) continue;   // already moving
            st.hasLive = true;
            st.live = pit->second.live;
            st.live.id = getComponentId(c);
            st.live.visibility = VIS_VISIBLE;
            st.animating = false;
            st.lastChange = -1e9;
        }
    }

    // Recopy to the animation ids: the reference keeps the measure of each animated component
    // of the current state in the same MeasurePass as the components, keyed by the animation
    // id, so a component whose id equals an animation id gets that measure too. (The copies
    // to the same component in the other states are made at layout, layoutStateLayout.)
    for (auto* c : animatedIn[curPos]) {
        int aid = animationIdOf(c, ctx);
        auto& own = measure.get(getComponentId(c));
        own.visibility = VIS_VISIBLE;
        ComponentMeasure cm = own;
        auto& am = measure.get(aid);
        am.x = cm.x; am.y = cm.y; am.w = cm.w; am.h = cm.h; am.visibility = VIS_VISIBLE;
    }

    // The previous state's children not in the new one are GONE (at their bounds).
    if (prevPos >= 0 && prevPos != curPos) {
        // A component whose id is also in the new state shares its measure (the reference's
        // MeasurePass is keyed by id), and the new state's one wins: the reference re-measures
        // that subtree on its own once its state is laid out.
        std::vector<int> curIds;
        std::vector<Operation*> stack{layout};
        while (!stack.empty()) {
            auto* o = stack.back(); stack.pop_back();
            curIds.push_back(getComponentId(o));
            for (auto* k : getLS(ctx, o).layoutChildren) stack.push_back(k);
        }
        auto& pls = getLS(ctx, previous);
        for (auto* c : pls.layoutChildren) {
            if (std::find(curIds.begin(), curIds.end(), getComponentId(c)) != curIds.end()) continue;
            int aid = animationIdOf(c, ctx);
            bool inNew = false;
            if (aid != -1) {
                auto it = painted.find(aid);
                inNew = it != painted.end() && it->second[curPos] != nullptr;
            }
            int ccid = getComponentId(c);
            if (!inNew && ccid != -1) measure.get(ccid).visibility = VIS_GONE;
        }
    }

    const auto& pm = measure.get(paneId);
    self.x = pm.x; self.y = pm.y; self.w = pm.w; self.h = pm.h;
    self.visibility = pm.visibility;
    sl->measuredIndex = sl->currentIndex;
}

static void layoutStateLayout(Operation* op, RemoteContext& ctx, MeasurePass& measure) {
    auto* sl = static_cast<StateLayout*>(op);
    auto& ls = getLS(ctx, op);
    Operation* layout = stateAt(ls, sl->currentIndex);
    if (!layout) return;
    const auto& self = measure.get(getComponentId(op));
    auto& lm = measure.get(getComponentId(layout));
    lm.w = self.w; lm.h = self.h; lm.visibility = self.visibility;
    lm.x = 0; lm.y = 0;
    layoutComponent(layout, ctx, measure);

    // Every component sharing an animation id with one of the current state takes its
    // measure (measured at exactly that size), but only shows it once laid out, which
    // StateLayout.layout does in a transition for the animated direct children of the
    // previous state. (The reference makes the copies in measure, where its children are
    // already positioned; here positions come from the layout above.)
    Operation* previous = stateAt(ls, sl->previousIndex);
    if (!sl->inTransition || !previous || previous == layout) return;
    std::vector<int> relaid;
    for (auto* c : getLS(ctx, previous).layoutChildren) {
        int aid = animationIdOf(c, ctx);
        if (aid != -1) relaid.push_back(aid);
    }
    if (relaid.empty()) return;
    std::vector<Operation*> current;
    collectAnimated(layout, ctx, current);
    std::vector<Operation*> others;
    for (auto* pane : ls.layoutChildren)
        if (pane != layout) collectAnimated(pane, ctx, others);
    auto* pc = ctx.getPaintContext();
    for (auto* c : current) {
        int aid = animationIdOf(c, ctx);
        if (std::find(relaid.begin(), relaid.end(), aid) == relaid.end()) continue;
        ComponentMeasure cm = measure.get(getComponentId(c));
        for (auto* ac : others) {
            if (animationIdOf(ac, ctx) != aid) continue;
            auto& m2 = measure.get(getComponentId(ac));
            m2.x = cm.x; m2.y = cm.y; m2.w = cm.w; m2.h = cm.h; m2.visibility = VIS_VISIBLE;
            measureComponent(ac, pc, ctx, cm.w, cm.w, cm.h, cm.h, measure);
            m2.x = cm.x; m2.y = cm.y;
            layoutComponent(ac, ctx, measure);
        }
    }
}

// ── Generic measure dispatcher ───────────────────────────────────────
static void measureComponent(Operation* op, PaintContext* pc, RemoteContext& ctx,
                             float minW, float maxW, float minH, float maxH,
                             MeasurePass& measure) {
    int oc = op->opcode();
    if (oc == 208 || oc == 239) {
        measureText(op, pc, ctx, minW, maxW, minH, maxH, measure);
    } else if (oc == 217) {
        measureStateLayout(op, pc, ctx, minW, maxW, minH, maxH, measure);
    } else if (isLayoutComponent(op)) {
        measureLayoutManager(op, pc, ctx, minW, maxW, minH, maxH, measure);
    }
}



// ── Generic layout dispatcher ────────────────────────────────────────
static void layoutComponent(Operation* op, RemoteContext& ctx, MeasurePass& measure) {
    if (op->opcode() == 217) {
        layoutStateLayout(op, ctx, measure);
    } else if (isLayoutComponent(op) && op->opcode() != 208 && op->opcode() != 239) {
        layoutManager(op, ctx, measure);
    }
}

// ── Store measured dimensions in RemoteContext for COMPONENT_VALUE ────
static LayoutOverflowCounts gLayoutOverflow;
static std::set<int> gLayoutOverflowIds;
static bool gCountLayoutOverflow = false;   // only the settled layout counts, not a bounds animation in flight
LayoutOverflowCounts layoutOverflowCounts() { return gLayoutOverflow; }
void resetLayoutOverflowCounts() { gLayoutOverflow = LayoutOverflowCounts{}; gLayoutOverflowIds.clear(); }

static void storeMeasuredDimensions(Operation* op, RemoteContext& ctx, MeasurePass& measure) {
    int cid = getComponentId(op);
    auto& ls = getLS(ctx, op);

    if (cid != -1 && measure.contains(cid)) {
        auto& m = measure.get(cid);
        // Store outer dimensions for the component itself
        ctx.setComponentDimension(cid, m.w, m.h, m.x, m.y);
        {
            float ox = ls.paddingLeft, oy = ls.paddingTop;
            if (ls.hasOffset) {
                auto res = [&](float v) { return std::isnan(v) ? ctx.getFloat(Utils::idFromNan(v)) : v; };
                ox += res(ls.offsetX); oy += res(ls.offsetY);
            }
            ctx.setComponentContent(cid, ox, oy, m.isVisible());
        }
        LTRACE("    storeDim cid=%d w=%.1f h=%.1f x=%.1f y=%.1f\n", cid, m.w, m.h, m.x, m.y);

        // Also store inner dimensions (after padding) for canvas content IDs
        // These are separate components that should have the content area dimensions
        float innerW = std::max(0.0f, m.w - ls.paddingLeft - ls.paddingRight);
        float innerH = std::max(0.0f, m.h - ls.paddingTop - ls.paddingBottom);
        // A visible child placed past the content box, unless this scrolls (the reference
        // clips nothing: it is drawn cut off, which a renderer's report should say).
        if (gCountLayoutOverflow && !ls.hasScroll && m.isVisible()) {
            // Past the parent's outer edge (a child spilling into the parent's own padding is
            // still drawn: nothing clips at the content box). Children sit at the content
            // origin, so the room to the edge is the size less the leading padding.
            float roomW = m.w - ls.paddingLeft, roomH = m.h - ls.paddingTop;
            // A collapsible layout ignores its own padding when it sizes its children (they
            // get the full width): the usual cause of a child past its edge, worth naming.
            bool paddedCollapsible = (op->opcode() == 230 || op->opcode() == 233)
                && (ls.paddingLeft > 0 || ls.paddingRight > 0 || ls.paddingTop > 0 || ls.paddingBottom > 0);
            for (auto* child : ls.layoutChildren) {
                int ccid = getComponentId(child);
                if (ccid == -1 || !measure.contains(ccid)) continue;
                auto& c = measure.get(ccid);
                // A collapsible layout that dropped every child goes GONE by itself (its own
                // visibility modifier did not ask for it): the layout removed the content.
                if (c.isGone() && (child->opcode() == 230 || child->opcode() == 233)) {
                    auto& cls = getLS(ctx, child);
                    inflateLayout(child, cls);
                    bool asked = cls.visibilityId >= 0 && ctx.getInteger(cls.visibilityId) != 1;
                    if (!asked && !cls.layoutChildren.empty() && gLayoutOverflowIds.insert(ccid).second) {
                        gLayoutOverflow.zeroSize++;
                        if (gLayoutOverflow.zeroSizeExamples.size() < 6) {
                            char buf[240];
                            std::snprintf(buf, sizeof buf, "%s#%d in %s#%d %.0fx%.0f (a collapsible layout that dropped every child: none fit)",
                                child->name().c_str(), ccid, op->name().c_str(), cid, roomW, roomH);
                            gLayoutOverflow.zeroSizeExamples.push_back(buf);
                        }
                    }
                    continue;
                }
                if (!c.isVisible()) continue;
                if (c.w <= 0.5f || c.h <= 0.5f) {
                    // No size at all: a weight with nothing left to share (or next to a
                    // widthIn/heightIn), a collapsible that dropped every child. A size asked
                    // to be 0 (a size: 0 canvas holding global commands) is intended.
                    auto& cls = getLS(ctx, child);
                    inflateLayout(child, cls);
                    // Intended: an exact size (0 as asked, or clamped by a 0 parent reported on
                    // its own), or a wrap with nothing inside (a spacer box). Starved: a weight
                    // or fill given nothing, or a wrap around children that all went.
                    auto intendedZero = [&](DimType t) {
                        return t == DimType::EXACT || t == DimType::EXACT_DP
                            || (t == DimType::WRAP && cls.layoutChildren.empty());
                    };
                    bool intended = (c.w > 0.5f || intendedZero(cls.widthType))
                                 && (c.h > 0.5f || intendedZero(cls.heightType));
                    if (!intended && roomW > 0.5f && roomH > 0.5f && gLayoutOverflowIds.insert(ccid).second) {
                        gLayoutOverflow.zeroSize++;
                        if (gLayoutOverflow.zeroSizeExamples.size() < 6) {
                            char buf[240];
                            const char* why = (c.w <= 0.5f && cls.widthType == DimType::WEIGHT) || (c.h <= 0.5f && cls.heightType == DimType::WEIGHT)
                                ? " (a weight: nothing left to share, or combined with widthIn/heightIn)"
                                : (child->opcode() == 230 || child->opcode() == 233) ? " (a collapsible layout that dropped every child)" : "";
                            std::snprintf(buf, sizeof buf, "%s#%d %.0fx%.0f in %s#%d %.0fx%.0f%s",
                                child->name().c_str(), ccid, c.w, c.h, op->name().c_str(), cid, roomW, roomH, why);
                            gLayoutOverflow.zeroSizeExamples.push_back(buf);
                        }
                    }
                    continue;
                }
                float right = c.x + c.w - roomW, bottom = c.y + c.h - roomH;
                // A few pixels are font-metric rounding or a label's trailing space, not a cut
                // worth a warning: past 8 px and 5% of the box.
                float tolW = std::max(8.0f, roomW * 0.05f), tolH = std::max(8.0f, roomH * 0.05f);
                if (right > tolW || bottom > tolH || c.x < -tolW || c.y < -tolH) {
                    if (gLayoutOverflowIds.insert(ccid).second) {
                        gLayoutOverflow.components++;
                        if (gLayoutOverflow.examples.size() < 6) {
                            char buf[400];
                            std::snprintf(buf, sizeof buf, "%s#%d %.0fx%.0f at %.0f,%.0f in %s#%d %.0fx%.0f: %s%.0f px%s",
                                child->name().c_str(), ccid, c.w, c.h, c.x, c.y, op->name().c_str(), cid, innerW, innerH,
                                bottom > tolH ? "below by " : right > tolW ? "past the right by " : "before the start by ",
                                bottom > tolH ? bottom : right > tolW ? right : -std::min(c.x, c.y),
                                paddedCollapsible ? " (the parent is a collapsible layout with its own padding, which it ignores for its children: move the padding to a box around it)" : "");
                            gLayoutOverflow.examples.push_back(buf);
                        }
                    }
                }
            }
        }
        // A LayoutComponentContent id (what componentWidth() in a child's modifier names)
        // reads the component's full size in the reference (ANM-02: a spacer of
        // @go * (componentWidth() - 22) inside a track padded by 22), not its inner one.
        for (int lcid : ls.layoutContentIds) ctx.setComponentDimension(lcid, m.w, m.h, m.x, m.y);
        for (int ccid : ls.canvasContentIds) {
            ctx.setComponentDimension(ccid, innerW, innerH, m.x, m.y);
            LTRACE("    storeDim canvasContent cid=%d w=%.1f h=%.1f\n", ccid, innerW, innerH);
        }
    }

    // A StateLayout's current state last, so that where states share ids its bounds (and
    // visibility, which is what hit testing reads) are the ones kept.
    Operation* cur = op->opcode() == 217
        ? stateAt(ls, static_cast<StateLayout*>(op)->measuredIndex) : nullptr;
    for (auto* child : ls.layoutChildren) {
        if (child != cur) storeMeasuredDimensions(child, ctx, measure);
    }
    if (cur) storeMeasuredDimensions(cur, ctx, measure);
}

// ── Paint background modifier ────────────────────────────────────────
static int modifierColor(int flags, int colorId, float r, float g, float b, float a,
                         RemoteContext& ctx) {
    if (flags == 2) return ctx.getColor(colorId);   // COLOR_REF
    int ia = std::clamp((int)(a * 255), 0, 255);
    int ir = std::clamp((int)(r * 255), 0, 255);
    int ig = std::clamp((int)(g * 255), 0, 255);
    int ib = std::clamp((int)(b * 255), 0, 255);
    return (ia << 24) | (ir << 16) | (ig << 8) | ib;
}

// BackgroundModifierOperation.paint: a rectangle or a circle (any other shape draws nothing)
// at the size the modifier was laid out at.
static void paintBackground(const ModifierBackground* mb, PaintContext* pc, RemoteContext& ctx,
                            float w, float h) {
    if (!pc) return;
    pc->savePaint();
    PaintBundle paint;
    paint.addUpperTag(PaintBundle::STYLE, PaintBundle::STYLE_FILL);
    paint.addTag(PaintBundle::COLOR,
                 modifierColor(mb->flags, mb->colorId, mb->oR, mb->oG, mb->oB, mb->oA, ctx));
    pc->applyPaint(paint);
    if (mb->shapeType == 0) {
        pc->drawRect(0, 0, w, h);
    } else if (mb->shapeType == 1) {
        pc->drawCircle(w / 2.0f, h / 2.0f, std::min(w, h) / 2.0f);
    }
    pc->restorePaint();
}

// A child a collapsible layout or a fit box hid last frame comes back visible before it is
// measured again — the measure is cached across frames, and its own visibility modifier (if
// any) is re-applied by the measure itself.
static void unhide(Operation* child, RemoteContext& ctx, MeasurePass& measure) {
    int cid = getComponentId(child);
    if (cid == -1) return;
    auto& cls = getLS(ctx, child);
    inflateLayout(child, cls);
    if (cls.visibilityId < 0) measure.get(cid).visibility = VIS_VISIBLE;
}

// ── Collapsible row / column ─────────────────────────────────────────
// CollapsibleRowLayout.computeVisibleChildren: the children, already measured at their own
// size, are taken highest priority first and kept while they fit in `avail`; the first that
// does not fit, and every one after it, is GONE. Spacing is not counted, as in the reference.
// The order is CollapsiblePriority.sortWithPriorities: a child without a priority for this
// axis counts as Float.MAX_VALUE, and the list is sorted (stably, by Java's List.sort) with
// the comparator (int) (p2 - p1) -- so priorities less than 1 apart tie and keep document
// order. Java's TimSort on fewer than 32 elements is a binary insertion sort after the
// leading run; it is reproduced here so a non-transitive tie orders the same way.
static int javaPriorityCompare(float p1, float p2) {
    float d = p2 - p1;
    if (std::isnan(d)) return 0;
    if (d >= 2147483647.0f) return INT32_MAX;
    if (d <= -2147483648.0f) return INT32_MIN;
    return (int)d;
}

template <typename T, typename Cmp>
static void javaSmallSort(std::vector<T>& a, Cmp cmp) {
    int n = (int)a.size();
    if (n < 2) return;
    // countRunAndMakeAscending
    int runHi = 1;
    if (cmp(a[runHi++], a[0]) < 0) {
        while (runHi < n && cmp(a[runHi], a[runHi - 1]) < 0) runHi++;
        std::reverse(a.begin(), a.begin() + runHi);
    } else {
        while (runHi < n && cmp(a[runHi], a[runHi - 1]) >= 0) runHi++;
    }
    // binarySort
    for (int start = runHi; start < n; start++) {
        T pivot = a[start];
        int left = 0, right = start;
        while (left < right) {
            int mid = (left + right) >> 1;
            if (cmp(pivot, a[mid]) < 0) right = mid; else left = mid + 1;
        }
        for (int k = start; k > left; k--) a[k] = a[k - 1];
        a[left] = pivot;
    }
}

static void collapseChildren(const LayoutState& ls, RemoteContext& ctx, MeasurePass& measure,
                             float avail, int axis) {
    std::vector<std::pair<float, Operation*>> kids;
    bool hasPriorities = false;
    for (auto* child : ls.layoutChildren) {
        auto& cls = getLS(ctx, child);
        if (cls.hasCollapsePriority) hasPriorities = true;
        float p = (cls.hasCollapsePriority && cls.collapseOrientation == axis)
                      ? cls.collapsePriority : std::numeric_limits<float>::max();
        kids.push_back({p, child});
    }
    if (hasPriorities)
        javaSmallSort(kids, [](const auto& a, const auto& b) {
            return javaPriorityCompare(a.first, b.first);
        });
    float used = 0.0f;
    bool overflow = false;
    for (auto& [p, child] : kids) {
        int cid = getComponentId(child);
        if (!measure.contains(cid)) continue;
        auto& cm = measure.get(cid);
        if (overflow || cm.isGone()) { cm.visibility = VIS_GONE; continue; }
        float size = axis == 0 ? cm.w : cm.h;
        if (used + size > avail) { cm.visibility = VIS_GONE; overflow = true; }
        else used += size;
    }
}

// The size a collapsible row (axis 0) / column (axis 1) wraps to once it has settled. The
// reference measures the children, drops what overflows, and on the next frame (its children
// keep the GONE it gave them, see Component.setVisibility / getMeasureVisibility) wraps to
// what is left: the cross axis to the largest child kept, the main axis to the sum of the kept
// children, at most `availMain`, without the spacing (computeVisibleChildren's
// size.setWidth(Math.min(maxWidth, childrenWidth))). The children keep the measure they had.
static void collapsedWrapSize(const LayoutState& ls, RemoteContext& ctx, MeasurePass& measure,
                              int axis, float availMain, bool hasHWrap, bool hasVWrap,
                              float& measuredW, float& measuredH) {
    float mainSum = 0.0f, crossMax = 0.0f;
    for (auto* child : ls.layoutChildren) {
        int cid = getComponentId(child);
        if (cid == -1 || !measure.contains(cid)) continue;
        auto& cm = measure.get(cid);
        if (cm.isGone()) continue;
        mainSum += axis == 0 ? cm.w : cm.h;
        crossMax = std::max(crossMax, axis == 0 ? cm.h : cm.w);
    }
    float mainSize = std::min(availMain, mainSum);
    if (axis == 0) {
        if (hasHWrap) measuredW = mainSize + ls.paddingLeft + ls.paddingRight;
        if (hasVWrap) measuredH = crossMax + ls.paddingTop + ls.paddingBottom;
    } else {
        if (hasVWrap) measuredH = mainSize + ls.paddingTop + ls.paddingBottom;
        if (hasHWrap) measuredW = crossMax + ls.paddingLeft + ls.paddingRight;
    }
}

// CollapsibleRowLayout / CollapsibleColumnLayout.computeVisibleChildren, as the reference
// runs it within a frame and settles on the next:
//  1. every child, visible again, is measured at its own size along the main axis
//     (Float.MAX_VALUE; a weighted child or a nested collapsible of the same kind gets what
//     the children before it left), then what overflows `mainMax` is dropped;
//  2. internalLayoutMeasure measures the children again against the measured size (padding
//     included, as m.getW()/m.getH()), the dropped ones staying GONE and no longer taking
//     space from the ones after them, and drops again;
//  3. the next frame wraps to what is left (collapsedWrapSize).
static void measureCollapsibleChildren(const LayoutState& ls, PaintContext* pc, RemoteContext& ctx,
                                       MeasurePass& measure, int axis, float mainMax,
                                       float crossMax, float& measuredW, float& measuredH,
                                       bool hasHWrap, bool hasVWrap) {
    const int sameKind = axis == 0 ? 230 : 233;
    auto measureAll = [&](float mMax, float cMax, const std::vector<char>* dropped) {
        float cur = mMax;
        for (size_t i = 0; i < ls.layoutChildren.size(); i++) {
            auto* child = ls.layoutChildren[i];
            auto& cls = getLS(ctx, child);
            bool weighted = (axis == 0 ? cls.widthType : cls.heightType) == DimType::WEIGHT;
            float lim = (child->opcode() == sameKind || weighted)
                            ? cur : std::numeric_limits<float>::max();
            if (axis == 0) measureComponent(child, pc, ctx, 0, lim, 0, cMax, measure);
            else measureComponent(child, pc, ctx, 0, cMax, 0, lim, measure);
            int cid = getComponentId(child);
            if (cid == -1) continue;
            auto& cm = measure.get(cid);
            if (dropped && (*dropped)[i]) cm.visibility = VIS_GONE;
            if (!cm.isGone()) cur -= axis == 0 ? cm.w : cm.h;
        }
    };
    for (auto* child : ls.layoutChildren) unhide(child, ctx, measure);
    measureAll(mainMax, crossMax, nullptr);
    collapseChildren(ls, ctx, measure, mainMax, axis);
    std::vector<char> dropped(ls.layoutChildren.size(), 0);
    for (size_t i = 0; i < ls.layoutChildren.size(); i++) {
        int cid = getComponentId(ls.layoutChildren[i]);
        dropped[i] = cid != -1 && measure.contains(cid) && measure.get(cid).isGone();
    }
    float fullMain = axis == 0 ? measuredW : measuredH;
    float fullCross = axis == 0 ? measuredH : measuredW;
    measureAll(fullMain, fullCross, &dropped);
    collapseChildren(ls, ctx, measure, mainMax, axis);
    collapsedWrapSize(ls, ctx, measure, axis, mainMax, hasHWrap, hasVWrap, measuredW, measuredH);
}

// ── Paint ripple modifier ────────────────────────────────────────────
// RippleModifierOperation.paint: from the touch point a circle grows to the component's
// larger side in half a second while it fades from translucent white to nothing over one,
// both on the standard cubic curve, clipped to the component (and any rounded clip before).
// ClickModifierOperation and MultiClickModifier paint the same ripple from a click (in the
// component's own coordinates and full size, the paddings backed out).
static void paintRippleAt(float& start, float rx, float ry, PaintContext* pc, RemoteContext& ctx,
                          float w, float h) {
    if (start < 0.0f || !pc) return;
    float progress = ctx.getFloat(RemoteContext::ID_ANIMATION_TIME) - start;   // over 1 s
    if (progress > 1.0f || progress < 0.0f) { start = -1.0f; return; }
    ctx.needsRepaint();
    static CubicEasing ease(Easing::CUBIC_STANDARD);
    float tween = ease.get(progress);
    float tweenRadius = ease.get(std::min(1.0f, progress / 0.5f));
    auto mix = [&](int a, int b) { return (int)std::lround(a + (b - a) * tween); };
    int col = (mix(180, 0) << 24) | (mix(250, 200) << 16) | (mix(250, 200) << 8) | mix(250, 200);
    pc->matrixSave();
    pc->clipRect(0, 0, w, h);
    pc->savePaint();
    PaintBundle paint;
    paint.addUpperTag(PaintBundle::STYLE, PaintBundle::STYLE_FILL);
    paint.addTag(PaintBundle::COLOR, col);
    pc->applyPaint(paint);
    pc->drawCircle(rx, ry, std::max(w, h) * tweenRadius);
    pc->restorePaint();
    pc->matrixRestore();
}

static void paintRipple(const LayoutState& ls, PaintContext* pc, RemoteContext& ctx,
                        float w, float h) {
    auto* r = static_cast<ModifierRipple*>(ls.ripple);
    if (r) paintRippleAt(r->start, r->x, r->y, pc, ctx, w, h);
}

// ── Paint border modifier ────────────────────────────────────────────
// BorderModifierOperation.paint. The legacy drawing (first reserved int 0) strokes centred on
// the bounds; the default one insets the stroke by half its width (shrinking the corner radii)
// and fills the shape when the border is at least half the smaller side.
static void paintBorder(const ModifierBorder* mb, PaintContext* pc, RemoteContext& ctx,
                        float w, float h) {
    if (!pc) return;
    const float bw = mb->oBorderWidth * gDpScale;
    const float corner = mb->oRoundedCorner * gDpScale;
    const bool legacy = mb->reserve1 == 0;
    pc->savePaint();
    PaintBundle paint;
    paint.addTag(PaintBundle::COLOR,
                 modifierColor(mb->flags, mb->colorId, mb->oR, mb->oG, mb->oB, mb->oA, ctx));
    float size = mb->shapeType == 1 ? std::min(w, h) / 2.0f : corner;
    if (!legacy && bw >= std::min(w, h) / 2.0f) {
        paint.addUpperTag(PaintBundle::STYLE, PaintBundle::STYLE_FILL);
        pc->applyPaint(paint);
        if (mb->shapeType == 0) pc->drawRect(0, 0, w, h);
        else pc->drawRoundRect(0, 0, w, h, size, size);
    } else {
        paint.addUpperTag(PaintBundle::STYLE, PaintBundle::STYLE_STROKE);
        paint.addTagFloat(PaintBundle::STROKE_WIDTH, bw);
        pc->applyPaint(paint);
        float hs = legacy ? 0.0f : bw / 2.0f;
        if (mb->shapeType == 0) {
            pc->drawRect(hs, hs, w - hs, h - hs);
        } else {
            float rr = std::max(0.0f, size - hs);
            pc->drawRoundRect(hs, hs, w - hs, h - hs, rr, rr);
        }
    }
    pc->restorePaint();
}

// ── Paint a layout component with transforms ─────────────────────────
// ── Text painting: wrapping, maxLines, clip and ellipsis ─────────────
// CoreText.paintingComponent / textLayout: the text is wrapped only when it overflows and more
// than one line is allowed (or a newline forces it); at most maxLines lines are drawn; with
// any overflow but VISIBLE the text is clipped to the content box; and an ELLIPSIS overflow
// (3 end, 4 start, 5 middle) ends the last shown line with "…" when text was cut, as
// StaticLayout's ellipsize does. An end ellipsis also drops the lines that do not fit the
// height (textLayout lowers maxLines until the layout fits).
static constexpr int kEllipsisTextId = INT32_MIN + 0x2026;   // scratch text slot

static std::vector<int> utf8Boundaries(const std::string& s, int from, int to) {
    std::vector<int> b;
    for (int i = from; i < to; i++) {
        if ((static_cast<unsigned char>(s[i]) & 0xC0) != 0x80) b.push_back(i);
    }
    b.push_back(to);
    return b;
}

static std::string ellipsize(PaintContext* pc, const std::string& text, int from, int to,
                             float fsize, float width, int mode) {
    static const std::string kDots = "\xE2\x80\xA6";   // U+2026
    while (from < to && text[from] == ' ') from++;
    while (to > from && text[to - 1] == ' ') to--;
    auto b = utf8Boundaries(text, from, to);
    int nChars = (int) b.size() - 1;
    auto prefix = [&](int k) { return text.substr(from, b[k] - from); };
    auto suffix = [&](int k) { return text.substr(b[nChars - k], to - b[nChars - k]); };
    auto fits = [&](const std::string& str) { return pc->measureTextWidth(str, fsize) <= width; };
    if (mode == 4) {                      // START: "…" + the longest suffix that fits
        int k = nChars;
        while (k > 0 && !fits(kDots + suffix(k))) k--;
        return kDots + suffix(k);
    }
    if (mode == 5) {                      // MIDDLE: head + "…" + tail, the tail as long or shorter
        int total = nChars;
        while (total > 0) {
            int head = (total + 1) / 2, tail = total / 2;
            std::string t = prefix(head) + kDots + suffix(tail);
            if (fits(t)) return t;
            total--;
        }
        return kDots;
    }
    int k = nChars;                       // END: the longest prefix that fits, then "…"
    while (k > 0 && !fits(prefix(k) + kDots)) k--;
    std::string head = prefix(k);
    while (!head.empty() && head.back() == ' ') head.pop_back();
    return head + kDots;
}

// What the last paint could not fit, for a renderer's report (rc2image's `text` section):
// texts that lost lines to maxLines, texts drawn or cut past their box, and texts that end
// in an ellipsis by design. Reset by the host before a frame.
static TextOverflowCounts gTextOverflow;
void resetTextOverflowCounts() { gTextOverflow = TextOverflowCounts{}; }
TextOverflowCounts textOverflowCounts() { return gTextOverflow; }

static void paintTextLines(PaintContext* pc, int tid, const std::string& text, float fsize,
                           float contentW, float contentH, float lineH, float fullW,
                           float ascent, int tAlign, int maxLines, int overflow,
                           float lsPx = 0.0f, float lhAdd = 0.0f, float lhMul = 1.0f) {
    if (maxLines <= 0) maxLines = INT32_MAX;
    const float lineStep = lineH + lineGap(lineH, lhAdd, lhMul);
    const bool ellipsis = overflow == 3 || overflow == 4 || overflow == 5;
    const bool hasNewlines = text.find('\n') != std::string::npos;
    std::vector<TextLine> lines;
    if (contentW > 0 && ((fullW > contentW && maxLines > 1) || hasNewlines)) {
        lines = wrapText(pc, text, fsize, contentW);
    } else {
        lines.push_back({0, (int) text.size()});
    }
    bool truncated = false;
    if ((int) lines.size() > maxLines) { lines.resize(maxLines); truncated = true; }
    if (overflow == 3 && lineH > 0 && contentH > 0 && lines.size() > 1) {
        int fit = std::max(1, (int) std::floor((contentH - lineH) / lineStep + 1.01f));
        if ((int) lines.size() > fit) { lines.resize(fit); truncated = true; }
    }

    // Java clips whenever overflow is not VISIBLE; here only when the text measurably
    // overflows, since a fallback font (CJK, emoji) can draw a little wider than it measured.
    const float textH = lineH + lineStep * (float)(lines.size() - 1);
    bool overflows = truncated || fullW > contentW + 0.5f || textH > contentH + 0.5f;
    float widest = 0.0f;   // the widest line as painted, for the overflow count below
    const bool clip = overflow != 2 && overflows;
    if (clip) { pc->matrixSave(); pc->clipRect(0, 0, contentW, contentH); }
    for (size_t li = 0; li < lines.size(); li++) {
        const auto& line = lines[li];
        if (line.start >= line.end) continue;
        const bool last = li + 1 == lines.size();
        std::string lineStr = text.substr(line.start, line.end - line.start);
        float lineW = lines.size() == 1
                ? fullW : pc->measureTextWidth(lineStr, fsize) + lsPx * utf8Count(lineStr);
        bool cut = ellipsis && last && contentW > 0 && (truncated || lineW > contentW + 0.5f);
        std::string drawn;
        if (cut) {
            // An end ellipsis runs on from this line through the rest of the text.
            int to = overflow == 3 ? (int) text.size() : line.end;
            if (overflow == 3 && hasNewlines) {
                size_t nl = text.find('\n', line.start);
                if (nl != std::string::npos) to = (int) nl;
            }
            drawn = ellipsize(pc, text, line.start, to, fsize, contentW, overflow);
            lineW = pc->measureTextWidth(drawn, fsize) + lsPx * utf8Count(drawn);
        }
        widest = std::max(widest, lineW);
        float x = 0;
        if (tAlign == 3) x = (contentW - lineW) / 2;                  // CENTER
        else if (tAlign == 2 || tAlign == 6) x = contentW - lineW;    // RIGHT / END
        float y = ascent + lineStep * (float) li;
        if (lsPx != 0.0f) {
            drawSpaced(pc, cut ? drawn : lineStr, x, y, fsize, lsPx);
        } else if (cut) {
            pc->loadText(kEllipsisTextId, drawn);
            int units = utf8ByteToUtf16Index(drawn, (int) drawn.size());
            pc->drawTextRun(kEllipsisTextId, 0, units, 0, units, x, y, false);
        } else {
            // wrapText gives byte offsets; drawTextRun wants UTF-16 indices.
            int cs = utf8ByteToUtf16Index(text, line.start);
            int ce = utf8ByteToUtf16Index(text, line.end);
            pc->drawTextRun(tid, cs, ce, cs, ce, x, y, false);
        }
    }
    // The count uses the lines as painted (fullW is the unwrapped width: a wrapped text is
    // not cut just because it wrapped).
    if (truncated || widest > contentW + 0.5f || textH > contentH + 0.5f) {
        const char* kind = ellipsis ? "ellipsized" : truncated ? "truncated" : "clipped";
        if (ellipsis) gTextOverflow.ellipsized++;
        else if (truncated) gTextOverflow.truncated++;
        else gTextOverflow.clipped++;
        if (gTextOverflow.examples.size() < 6) gTextOverflow.examples.push_back({kind, text.substr(0, 48)});
    }
    if (clip) pc->matrixRestore();
}

static void paintLayoutComponent(Operation* op, RemoteContext& ctx, MeasurePass& measure) {
    auto* pc = ctx.getPaintContext();
    if (!pc) return;

    int cid = getComponentId(op);
    auto& m = measure.get(cid);
    auto& ls = getLS(ctx, op);

    // GONE components are not rendered. During a StateLayout transition the exiting
    // state is kept VISIBLE (with a fading alpha) by the animation pass, so only a
    // settled-GONE component is skipped here.
    // Component.paint: `if (isGone() || isInvisible()) return;` — an INVISIBLE component
    // keeps its space but draws nothing (nor do its children).
    if (m.isGone() || m.visibility == VIS_INVISIBLE) return;

    // A CUSTOM enter/exit animation: the visibility function draws the component this frame
    // (AnimateMeasure.executeCustomAnimation), from the parent's origin, with
    // (progress, w, h, x, y, id); its DrawContent draws the component as usual.
    if (m.customFn != -1) {
        int fnId = m.customFn;
        float progress = m.customProgress;
        auto* fn = dynamic_cast<FunctionDefineOp*>(ctx.getObject(fnId));
        m.customFn = -1;
        if (!fn) { paintLayoutComponent(op, ctx, measure); measure.get(cid).customFn = fnId; return; }
        const float x = std::floor(m.x), y = std::floor(m.y);
        const float w = std::ceil(m.x - x + m.w), h = std::ceil(m.y - y + m.h);
        const float vals[6] = {progress, w, h, x, y, (float)cid};
        std::vector<float> saved;
        for (size_t i = 0; i < fn->args.size() && i < 6; i++) {
            saved.push_back(ctx.getFloat(fn->args[i]));
            ctx.loadFloat(fn->args[i], vals[i]);
        }
        // DrawContent.paint: saveLayer with the current paint (its alpha), then the component.
        std::function<void()> draw = [&]() {
            float a = pc->currentPaintAlpha();
            const auto& cm = measure.get(cid);
            bool layer = a < 0.999f;
            if (layer) pc->saveLayerAlpha(std::max(0.0f, a), cm.x, cm.y, cm.x + cm.w, cm.y + cm.h);
            paintLayoutComponent(op, ctx, measure);
            if (layer) pc->restoreLayer();
        };
        auto* prevHook = DrawContentOp::sDrawComponent;
        DrawContentOp::sDrawComponent = &draw;
        pc->matrixSave();
        pc->savePaint();
        {
            PaintBundle paint;   // black, opaque, fill, as the reference resets it
            paint.addUpperTag(PaintBundle::STYLE, PaintBundle::STYLE_FILL);
            paint.addTag(PaintBundle::COLOR, (int)0xFF000000);
            pc->applyPaint(paint);
        }
        fn->execute(ctx);
        pc->restorePaint();
        pc->matrixRestore();
        DrawContentOp::sDrawComponent = prevHook;
        for (size_t i = 0; i < saved.size(); i++) ctx.loadFloat(fn->args[i], saved[i]);
        measure.get(cid).customFn = fnId;
        return;
    }

    // ParticleAnimation.animate: the component itself is not drawn; 20 light grey discs at
    // random places over its start bounds fade out, drift down by 1% of its height and grow.
    // The reference draws its positions from Math.random() once per component; here they
    // come from a generator seeded by the component id, so a render is reproducible.
    if (m.particle >= 0.0f) {
        const float progress = m.particle;
        uint32_t seed = 0x9E3779B9u ^ (uint32_t)cid;
        auto rnd = [&]() {
            seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
            return (seed >> 8) / 16777216.0f;
        };
        pc->matrixSave();
        pc->savePaint();
        for (int i = 0; i < 20; i++) {
            float px = rnd(), py = rnd(), pr = rnd();
            PaintBundle paint;   // reset: fill
            paint.addUpperTag(PaintBundle::STYLE, PaintBundle::STYLE_FILL);
            int a = (int)std::lround(200.0f * (1.0f - progress));
            a = std::max(0, std::min(255, a));
            paint.addTag(PaintBundle::COLOR, (int)(((uint32_t)a << 24) | 0xDCDCDCu));
            pc->applyPaint(paint);
            float dx = m.x + m.w * px;
            float dy = m.y + m.h * py + progress * 0.01f * m.h;
            float dr = (m.h + 60.0f) * 0.15f * pr + 30.0f * progress;
            pc->drawCircle(dx, dy, dr);
        }
        pc->restorePaint();
        pc->matrixRestore();
        return;
    }

    LTRACE("  paint cid=%d opcode=%d pos=(%.1f,%.1f) size=(%.1f,%.1f) bg=%d children=%d\n",
           cid, op->opcode(), m.x, m.y, m.w, m.h, ls.hasBg, (int)ls.layoutChildren.size());

    // Save transform state
    pc->matrixSave();
    pc->savePaint();

    // Opacity: combine the layout-animation alpha (enter/exit fades) with an explicit
    // graphicsLayer alpha modifier (which may be an expression). Wrap the component in
    // an alpha layer while it is not fully opaque.
    float effAlpha = m.alpha;
    if (ls.hasGlAlpha) {
        float ga = resolveVar(ls.glAlpha, ctx);
        if (!std::isnan(ga)) effAlpha *= std::max(0.0f, std::min(1.0f, ga));
    }
    // graphicsLayer transform (as Android's RenderNode, and the TypeScript player): translated,
    // then rotated and scaled about the transform origin (a fraction of the size, default
    // the centre). It moves the drawing only, not the layout or the hit area.
    if (auto* gl = static_cast<ModifierGraphicsLayer*>(ls.graphicsLayer)) {
        auto val = [&](float v, float d) { float r = resolveVar(v, ctx); return std::isnan(r) ? d : r; };
        float sx = val(gl->scaleX, 1.0f), sy = val(gl->scaleY, 1.0f), rz = val(gl->rotationZ, 0.0f);
        float tx = val(gl->translationX, 0.0f) * gDpScale, ty = val(gl->translationY, 0.0f) * gDpScale;
        float px = m.x + val(gl->originX, 0.5f) * m.w, py = m.y + val(gl->originY, 0.5f) * m.h;
        if (tx != 0.0f || ty != 0.0f) pc->matrixTranslate(tx, ty);
        if (rz != 0.0f) pc->matrixRotate(rz, px, py);
        if (sx != 1.0f || sy != 1.0f) pc->matrixScale(sx, sy, px, py);
    }
    // An enter/exit effect: a slide moves the component, ROTATE spins and scales it about its
    // centre (AnimateMeasure.paint).
    if (m.effTx != 0.0f || m.effTy != 0.0f) pc->matrixTranslate(m.effTx, m.effTy);
    if (m.effRot != 0.0f || m.effScale != 1.0f) {
        const float px = m.x + m.w / 2.0f, py = m.y + m.h / 2.0f;
        if (m.effRot != 0.0f) pc->matrixRotate(m.effRot, px, py);
        if (m.effScale != 1.0f) pc->matrixScale(m.effScale, m.effScale, px, py);
    }
    bool animLayer = m.isVisible() && effAlpha < 0.999f;
    if (animLayer) {
        pc->saveLayerAlpha(effAlpha, m.x, m.y, m.x + m.w, m.y + m.h);
    }
    // graphicsLayer blur render effect: wrap the component's drawing in a blurred layer.
    bool blurLayer = ls.hasGlBlur && (ls.glBlurX > 0.0f || ls.glBlurY > 0.0f) && m.isVisible();
    if (blurLayer) {
        pc->saveLayerWithBlur(ls.glBlurX, ls.glBlurY, m.x, m.y, m.x + m.w, m.y + m.h);
    }

    // Translate to component position
    pc->matrixTranslate(m.x, m.y);
    ctx.pushTranslate(m.x, m.y);
    // Where this component sits in the document; the canvas touch bounds and POS_ROOT_X/Y
    // use it. mTranslateX/Y then follows the padding and scroll below, so a child's origin
    // includes them (Java getLocationInWindow).
    const float rootX = ctx.mTranslateX, rootY = ctx.mTranslateY;
    int contentPushed = 0;


    // A scroll container clips at its full bounds unless a clip modifier says otherwise.
    if (ls.hasScroll && !ls.hasRoundedClipRect && !ls.hasClipRect) {
        pc->clipRect(0, 0, m.w, m.h);
    }

    // ComponentModifiers.paint: the modifiers in list order. Each padding translates by its
    // start/top and shrinks the size the decorators after it are laid out at
    // (ComponentModifiers.layout), so a padding before a background is a margin and a clip
    // after a padding is inset. The paddings' translation is then backed out, and the
    // content is placed at the summed padding.
    int offsetsPushed = 0;
    {
        float tx = 0.0f, ty = 0.0f;
        float dw = m.w, dh = m.h;
        // StateLayout.paint paints its states only, not its own modifiers.
        static const std::vector<LayoutState::PaintMod> kNoMods;
        for (auto& pm : op->opcode() == 217 ? kNoMods : ls.paintMods) {
            switch (pm.op->opcode()) {
                case 58:   // padding
                    pc->matrixTranslate(pm.l, pm.t);
                    tx += pm.l; ty += pm.t;
                    dw -= pm.l + pm.r; dh -= pm.t + pm.b;
                    break;
                case 55:   // background
                    paintBackground(static_cast<ModifierBackground*>(pm.op), pc, ctx, dw, dh);
                    break;
                case 107:  // border
                    paintBorder(static_cast<ModifierBorder*>(pm.op), pc, ctx, dw, dh);
                    break;
                case 108:  // clip rect
                    pc->clipRect(0, 0, dw, dh);
                    break;
                case 54: { // rounded clip rect
                    auto* rc = static_cast<ModifierRoundedClipRect*>(pm.op);
                    pc->roundedClipRect(dw, dh, rc->oTopStart * gDpScale, rc->oTopEnd * gDpScale,
                                        rc->oBottomStart * gDpScale, rc->oBottomEnd * gDpScale);
                    break;
                }
                case 221: { // offset: a translate that stays for the content
                    // Resolved as ModifierOffset::updateVariables resolves them (any NaN is a
                    // reference), not with resolveVar, which leaves system ids 10–40
                    // unresolved — and a NaN offset translates the component off the page.
                    auto* mo = static_cast<ModifierOffset*>(pm.op);
                    auto res = [&](float v) {
                        return std::isnan(v) ? ctx.getFloat(Utils::idFromNan(v)) : v;
                    };
                    float ox = res(mo->x) * gDpScale;
                    float oy = res(mo->y) * gDpScale;
                    pc->matrixTranslate(ox, oy);
                    ctx.pushTranslate(ox, oy);
                    offsetsPushed++;
                    break;
                }
                case 229:  // ripple
                    paintRipple(ls, pc, ctx, dw, dh);
                    break;
                case 59: { // click: ComponentModifiers.paint backs the paddings out for it
                    auto* c = static_cast<ModifierClick*>(pm.op);
                    pc->matrixTranslate(-tx, -ty);
                    paintRippleAt(c->rippleStart, c->rippleX, c->rippleY, pc, ctx, m.w, m.h);
                    pc->matrixTranslate(tx, ty);
                    break;
                }
                case 83: {
                    auto* c = static_cast<ModifierMultiClick*>(pm.op);
                    pc->matrixTranslate(-tx, -ty);
                    paintRippleAt(c->rippleStart, c->rippleX, c->rippleY, pc, ctx, m.w, m.h);
                    pc->matrixTranslate(tx, ty);
                    break;
                }
                default:
                    break;
            }
        }
        pc->matrixTranslate(ls.paddingLeft - tx, ls.paddingTop - ty);
        ctx.pushTranslate(ls.paddingLeft, ls.paddingTop);
        contentPushed++;
        // A canvas's content sits at the padding; its POS_ROOT_X/Y reads this.
        for (int id : ls.canvasContentIds) ctx.setComponentRoot(id, ctx.mTranslateX, ctx.mTranslateY);
    }

    // Apply scroll translation (direction: 0=vertical, 1=horizontal, matching Java)
    if (ls.hasScroll) {
        // A variable position is driven by the document (its TouchExpression); a constant one
        // is ignored and the modifier's own drag offset is used (ScrollModifierOperation keeps
        // mScrollX/Y itself when the position is not a variable).
        float scrollPos = Utils::isVariable(ls.scrollPosition) || !ls.scrollOp
                ? resolveVar(ls.scrollPosition, ctx)
                : static_cast<ModifierScroll*>(ls.scrollOp)->scrollOffset;
        if (ls.scrollDirection == 0) {
            pc->matrixTranslate(0, -scrollPos);  // vertical scroll
            ctx.pushTranslate(0, -scrollPos);
        } else {
            pc->matrixTranslate(-scrollPos, 0);  // horizontal scroll
            ctx.pushTranslate(-scrollPos, 0);
        }
        contentPushed++;
    }

    // Paint children
    int oc = op->opcode();
    if (oc == 208 || oc == 239) {
        // Text component: draw text
        int tid = 0;
        float fsize = 16;
        int col = 0;
        int colId = -1;
        int tAlign = 1; // TEXT_ALIGN_LEFT
        int fWeight = 400, fStyle = 0, fFamilyId = 0;
        int tMaxLines = INT32_MAX, tOverflow = 1;
        float tLetterSpacing = 0, tLineAdd = 0, tLineMul = 1;
        if (oc == 208) {
            auto* lt = static_cast<LayoutText*>(op);
            tMaxLines = lt->maxLines; tOverflow = lt->overflow;
            tid = lt->textId; fsize = lt->fontSize; col = lt->color;
            tAlign = lt->textAlign & 0xFFFF;
            fWeight = (int)resolveVar(lt->fontWeight, ctx); fStyle = lt->fontStyle;
            fFamilyId = lt->fontFamilyId;
        } else {
            auto* ct = static_cast<CoreTextOp*>(op);
            tMaxLines = ct->maxLines; tOverflow = ct->overflow;
            tLetterSpacing = ct->letterSpacing;
            tLineAdd = ct->lineHeightAdd; tLineMul = ct->lineHeightMultiplier;
            tid = ct->textId; fsize = ct->fontSize; col = ct->color;
            colId = ct->colorId;
            tAlign = ct->textAlign & 0xFFFF;
            fWeight = (int)resolveVar(ct->fontWeight, ctx); fStyle = ct->fontStyle;
            fFamilyId = ct->fontFamilyId;
        }
        // Font family: generic keywords map to a FONT_TYPE (1 sans / 2 serif / 3 mono);
        // anything else is a named system family resolved by the font manager.
        int fFamily = 0;
        std::string fFamName;
        if (fFamilyId > 0) {
            fFamName = ctx.getText(fFamilyId);
            if (fFamName == "monospace") fFamily = 3;
            else if (fFamName == "serif") fFamily = 2;
            else if (fFamName == "sans-serif" || fFamName == "sans") fFamily = 1;
            else if (!fFamName.empty()) fFamily = -1;   // a named family
        }

        // Resolve NaN-encoded variable references; a constant size is dp under DP behaviour
        const bool constSize = !std::isnan(fsize);
        fsize = resolveVar(fsize, ctx);
        if (constSize) fsize *= gDpScale;
        if (fsize <= 0 || std::isnan(fsize)) fsize = 16;

        // Resolve color
        int resolvedColor = col;
        if (colId >= 0) {
            resolvedColor = ctx.getColor(colId);
        }

        std::string text = ctx.getText(tid);
        if (!text.empty()) {
            pc->savePaint();
            PaintBundle textPaint;
            textPaint.addTagFloat(PaintBundle::TEXT_SIZE, fsize);
            textPaint.addTag(PaintBundle::COLOR, resolvedColor);
            // Apply weight / italic / family. For default-family styled text use the
            // sans-serif family list — CoreText ignores weight/slant for a null family.
            if (fFamily >= 0 && (fWeight != 400 || fStyle == 1 || fFamily != 0)) {
                int effType = fFamily != 0 ? fFamily : 1;
                textPaint.addTypeface(fWeight > 0 ? fWeight : 400, fStyle == 1, effType);
            }
            pc->applyPaint(textPaint);
            // A named system family is resolved on top of the applied paint.
            if (fFamily == -1) {
                pc->applyTypefaceByName(fFamName, fWeight > 0 ? fWeight : 400, fStyle == 1);
            }

            float contentW = m.w - ls.paddingLeft - ls.paddingRight;
            float contentH = m.h - ls.paddingTop - ls.paddingBottom;
            float lineH = pc->measureTextHeight(text, fsize);
            const float lsPx = tLetterSpacing * fsize;
            float fullW = pc->measureTextWidth(text, fsize) + lsPx * utf8Count(text);
            float ascent = pc->measureTextAscent(text, fsize);
            paintTextLines(pc, tid, text, fsize, contentW, contentH, lineH, fullW, ascent,
                           tAlign, tMaxLines, tOverflow, lsPx, tLineAdd, tLineMul);
            pc->restorePaint();
        }
    } else if (oc == 93) {
        // Custom component: delegate drawing to the platform host (e.g. video). The
        // canvas is already translated to the content box; hand it (0,0)..(w,h).
        auto* cu = static_cast<LayoutCustom*>(op);
        auto* host = ctx.getCustomHost();
        float cw = m.w - ls.paddingLeft - ls.paddingRight;
        float ch = m.h - ls.paddingTop - ls.paddingBottom;
        if (host) {
            std::string config = cu->configId >= 0 ? ctx.getText(cu->configId) : std::string();
            host->drawCustom(cu->componentId, config, pc, cw, ch,
                             ctx.getAnimationTime());
        }
    } else if (oc == 217) {
        // StateLayout.paint: the index variable is read here; a new value starts a transition,
        // laid out from the next frame on.
        {
            auto* sl = static_cast<StateLayout*>(op);
            int idx = sl->indexId != 0 ? ctx.getInteger(sl->indexId) : 0;
            if (sl->indexInitialized && idx != sl->currentIndex) {
                sl->previousIndex = sl->currentIndex;
                sl->currentIndex = idx;
                sl->inTransition = true;
                ctx.needsRepaint();
            }
        }
        // StateLayout.paint: during a transition, first the previous state's children that
        // are not in the new one (by paint id: the animation id, else the component id), so
        // they can play their exit animation; then the current state.
        ctx.pushCanvasBounds(rootX, rootY, m.w, m.h);
        auto* sl = static_cast<StateLayout*>(op);
        Operation* cur = stateAt(ls, sl->measuredIndex);
        Operation* prev = stateAt(ls, sl->previousIndex);
        if (sl->inTransition && prev && prev != cur) {
            auto paintId = [&](Operation* c) {
                int a = animationIdOf(c, ctx);
                return a != -1 ? a : getComponentId(c);
            };
            std::vector<int> curIds;
            for (auto* c : getLS(ctx, cur).layoutChildren) curIds.push_back(paintId(c));
            const auto& pm = measure.get(getComponentId(prev));
            pc->matrixSave();
            pc->matrixTranslate(pm.x, pm.y);
            ctx.pushTranslate(pm.x, pm.y);
            for (auto* c : getLS(ctx, prev).layoutChildren) {
                if (std::find(curIds.begin(), curIds.end(), paintId(c)) == curIds.end())
                    paintLayoutComponent(c, ctx, measure);
            }
            ctx.popTranslate();
            pc->matrixRestore();
        }
        if (cur) paintLayoutComponent(cur, ctx, measure);
    } else {
        // Push canvas bounds for touch hit-testing (uses current translate position)
        ctx.pushCanvasBounds(rootX, rootY, m.w, m.h);

        // Execute canvas draw operations BEFORE children (matching TS order)
        if (!ls.canvasOps.empty()) {
            LTRACE("    executing %d canvas ops (mode=%d)\n", (int)ls.canvasOps.size(), (int)ctx.getMode());
            for (size_t ci = 0; ci < ls.canvasOps.size(); ci++) {
                auto* canvasOp = ls.canvasOps[ci];
                // Resolve mOut fields for paint ops inside the layout tree
                if (canvasOp->isVariableSupport()) {
                    canvasOp->updateVariables(ctx);
                }
                LTRACE("      canvasOp[%d] opcode=%d name=%s isPaint=%d\n",
                       (int)ci, canvasOp->opcode(), canvasOp->name().c_str(), canvasOp->isPaintOperation());
                ctx.incrementOpCount();
                canvasOp->apply(ctx);
            }
        }

        // Layout manager: paint children at their positioned locations
        for (auto* child : ls.layoutChildren) {
            paintLayoutComponent(child, ctx, measure);
        }
    }

    ctx.popCanvasBounds();
    pc->restorePaint();
    if (blurLayer) pc->restoreLayer();   // LIFO: blur pushed after alpha
    if (animLayer) pc->restoreLayer();
    pc->matrixRestore();
    for (int i = 0; i < contentPushed; i++) ctx.popTranslate();
    for (int i = 0; i < offsetsPushed; i++) ctx.popTranslate();
    ctx.popTranslate();
}

// ── Layout animation pass ────────────────────────────────────────────
// After layout has produced target bounds in `measure`, walk the tree and blend
// each component toward its target (position/size/opacity) over time, rewriting
// the measure with the values to actually paint this frame. Static content
// measures identically every frame, so this is a no-op there.
void setLayoutAnimationEnabled(bool enabled) { gLayoutAnimationEnabled = enabled; }
bool isLayoutAnimationEnabled() { return gLayoutAnimationEnabled; }

// How an ancestor's visibility bears on a component's own animation.
//  ANIM_NORMAL  — every ancestor is shown: animate as measured.
//  ANIM_HIDDEN  — an ancestor is GONE and not fading: the component is not on screen, so its
//                 bounds are no position anyone saw. Forget them; when the ancestor appears the
//                 component appears in place with it instead of sliding in from wherever the
//                 hidden measure put it (the top-left corner, for a label in a state swapped in).
//  ANIM_FROZEN  — an ancestor is fading out: hold the component where it was shown.
enum AnimAncestry { ANIM_NORMAL, ANIM_HIDDEN, ANIM_FROZEN };

// While a StateLayout's previous state is animated, the ids also in its current state: those
// components share one measure with the current state's, which alone animates it.
static thread_local const std::vector<int>* sSkipIds = nullptr;
// The parent's own animation spec (inherited by a child without one) and size (slides move
// by it), while its children are animated.
static thread_local AnimationSpec* sParentSpec = nullptr;
static thread_local float sParentW = 0.0f, sParentH = 0.0f;

static void animateLayoutTree(Operation* op, RemoteContext& ctx, MeasurePass& measure,
                              double timeSec, AnimAncestry ancestry = ANIM_NORMAL) {
    int cid = getComponentId(op);
    if (sSkipIds && cid != -1
        && std::find(sSkipIds->begin(), sSkipIds->end(), cid) != sSkipIds->end()) return;
    AnimAncestry childAncestry = ancestry;
    if (cid != -1 && measure.contains(cid) && ancestry != ANIM_NORMAL) {
        static thread_local LayoutAnimStore sDetachedStoreH;
        LayoutAnimStore& store = ctx.getDocument() ? ctx.getDocument()->animStore()
                                                   : sDetachedStoreH;
        if (ancestry == ANIM_HIDDEN) {
            store.erase(cid);
        } else {
            auto it = store.find(cid);
            if (it != store.end() && it->second.hasLive) measure.get(cid) = it->second.live;
        }
    } else if (cid != -1 && measure.contains(cid)) {
        AnimSpecParams spec;
        // The component's own spec when it has one, else its parent's (LayoutComponent.inflate
        // hands a layout's spec to the children that have none): durations on the wire are
        // milliseconds.
        auto* as = static_cast<AnimationSpec*>(getLS(ctx, op).animSpec);
        if (!as) as = sParentSpec;
        if (as) {
            spec.motionDuration = as->motionDuration / 1000.0f;
            spec.visDuration = as->visibilityDuration / 1000.0f;
            spec.motionEasing = as->motionEasingType;
            spec.visEasing = as->visibilityEasingType;
            spec.enter = static_cast<AnimEffect>(as->enterAnimation & 0xFF);
            spec.exit = static_cast<AnimEffect>(as->exitAnimation & 0xFF);
            spec.enterSequence = (as->enterAnimation >> 8) & 0xFF;
            spec.exitSequence = (as->exitAnimation >> 8) & 0xFF;
            spec.enterFunctionId = as->enterFunctionId;
            spec.exitFunctionId = as->exitFunctionId;
        }
        ComponentMeasure& m = measure.get(cid);
        // The store belongs to the document being laid out. A context with no document
        // (measuring in isolation) gets a scratch one — per thread, so two threads measuring
        // at once do not share one.
        static thread_local LayoutAnimStore sDetachedStore;
        LayoutAnimStore& store = ctx.getDocument() ? ctx.getDocument()->animStore()
                                                   : sDetachedStore;
        const bool held = m.holdExit;
        if (held) m.visibility = VIS_GONE;   // held in the layout, leaving the screen
        const bool targetVisible = m.isVisible();
        if (animUpdate(store, cid, m, timeSec, gLayoutAnimationEnabled, spec, sParentW, sParentH))
            sSawActiveAnim = true;   // still animating → layout depends on animationTime
        else if (held)
            // The held exit (SEQUENCE BEFORE) ended in this pass, which measured the component
            // still in place: measure once more so the layout closes up (and the siblings
            // move into the gap), as the reference re-measures when the hold is released.
            sSawActiveAnim = true;
        if (!targetVisible) childAncestry = m.isVisible() ? ANIM_FROZEN : ANIM_HIDDEN;
    }
    if (op->opcode() == 217) sSawStateLayout = true;   // index can flip → keep re-laying out
    auto& ls = getLS(ctx, op);

    // A StateLayout's transition lasts while anything in it still animates
    // (checkEndOfTransition); then the previous state goes.
    const bool saw = sSawActiveAnim;
    if (op->opcode() == 217) sSawActiveAnim = false;
    AnimationSpec* savedSpec = sParentSpec;
    const float savedPW = sParentW, savedPH = sParentH;
    sParentSpec = static_cast<AnimationSpec*>(ls.animSpec);
    if (cid != -1 && measure.contains(cid)) {
        sParentW = measure.get(cid).w;
        sParentH = measure.get(cid).h;
    }
    {
        // A StateLayout animates its current state, and its previous one during a transition;
        // the others are not on screen (and may share ids with the current one). The current
        // state goes last, so that where ids are shared its bounds are the ones kept.
        auto* sl = op->opcode() == 217 ? static_cast<StateLayout*>(op) : nullptr;
        Operation* cur = sl ? stateAt(ls, sl->measuredIndex) : nullptr;
        Operation* prev = sl && sl->inTransition ? stateAt(ls, sl->previousIndex) : nullptr;
        std::vector<int> curIds;
        if (sl && prev && cur) {
            std::vector<Operation*> stack{cur};
            while (!stack.empty()) {
                auto* o = stack.back(); stack.pop_back();
                curIds.push_back(getComponentId(o));
                for (auto* k : getLS(ctx, o).layoutChildren) stack.push_back(k);
            }
        }
        for (auto* child : ls.layoutChildren) {
            if (sl && (child == cur || child != prev)) continue;
            const auto* savedSkip = sSkipIds;
            if (sl) sSkipIds = &curIds;
            animateLayoutTree(child, ctx, measure, timeSec, childAncestry);
            sSkipIds = savedSkip;
        }
        if (cur) animateLayoutTree(cur, ctx, measure, timeSec, childAncestry);
    }
    sParentSpec = savedSpec;
    sParentW = savedPW; sParentH = savedPH;
    if (op->opcode() == 217) {
        auto* sl = static_cast<StateLayout*>(op);
        if (sl->inTransition && !sSawActiveAnim) {
            sl->inTransition = false;
            Operation* prev = stateAt(ls, sl->previousIndex);
            Operation* cur = stateAt(ls, sl->currentIndex);
            int pid = prev ? getComponentId(prev) : -1;
            if (prev && prev != cur && pid != getComponentId(cur)) {
                measure.get(pid).visibility = VIS_GONE;
                // It leaves the screen: shown again later, it enters (fades in).
                static thread_local LayoutAnimStore sDetachedE;
                LayoutAnimStore& store = ctx.getDocument() ? ctx.getDocument()->animStore() : sDetachedE;
                auto it = store.find(pid);
                if (it != store.end()) it->second.live.visibility = VIS_GONE;
            }
        }
        if (sl->inTransition) sSawActiveAnim = true;   // keep the frames coming
        sSawActiveAnim = sSawActiveAnim || saw;
    }
}

// ── Run data operations for a layout tree ────────────────────────────
static void applyDataOps(Operation* op, RemoteContext& ctx) {
    auto& ls = getLS(ctx, op);
    inflateLayout(op, ls);

    // Run own data operations
    for (auto* dataOp : ls.dataOps) {
        ctx.incrementOpCount();
        dataOp->apply(ctx);
    }

    // Run canvas ops in data mode too (they may contain expressions, text data)
    for (auto* canvasOp : ls.canvasOps) {
        if (canvasOp->isVariableSupport() && canvasOp->isDirty()) {
            canvasOp->updateVariables(ctx);
        }
        ctx.incrementOpCount();
        canvasOp->apply(ctx);
        canvasOp->markNotDirty();
    }

    // Recurse into layout children
    for (auto* child : ls.layoutChildren) {
        applyDataOps(child, ctx);
    }
}

// ═════════════════════════════════════════════════════════════════════
// Operation apply() implementations
// ═════════════════════════════════════════════════════════════════════

void LayoutRoot::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::DATA) {
        // In DATA mode, run all data operations in the tree
        for (auto& child : mChildren) {
            child->apply(context);
        }
        return;
    }

    if (context.getMode() != ContextMode::PAINT) return;
    auto* pc = context.getPaintContext();
    if (!pc) return;

    // Density behaviour for this pass (restored on exit: a nested document may lay out
    // inside our paint). A change of scale invalidates every inflated layout state.
    struct DensityScope {
        float s, d; int b;
        DensityScope() : s(gDpScale), d(gDensity), b(gDensityBehavior) {}
        ~DensityScope() { gDpScale = s; gDensity = d; gDensityBehavior = b; }
    } densityScope;
    gDensity = (context.mDensity > 0 && !std::isnan(context.mDensity)) ? context.mDensity : 1.0f;
    gDensityBehavior = context.mDensityBehavior;
    gDpScale = gDensityBehavior == 2 ? gDensity : 1.0f;
    {
        auto& cache = cacheFor(context);
        if (cache.dpScale != gDpScale || cache.density != gDensity) {
            cache.states.clear();
            cache.laid = false;
            cache.dpScale = gDpScale;
            cache.density = gDensity;
        }
    }

    LTRACE("LayoutRoot::apply PAINT mode, canvas=%.0fx%.0f\n", context.mWidth, context.mHeight);
    context.setComponentDimension(componentId, context.mWidth, context.mHeight, 0, 0);

    // Collect ALL layout children, including those inside LayoutComponentContent
    // wrappers (TS RootLayoutComponent processes all content wrappers transparently)
    std::vector<Operation*> layoutChildren;
    std::vector<Operation*> rootDataOps;
    std::vector<Operation*> rootCanvasOps;
    for (auto& child : mChildren) {
        LTRACE("  LayoutRoot child: opcode=%d isLayout=%d isWrapper=%d\n",
               child->opcode(), isLayoutComponent(child.get()), isContentWrapper(child.get()));
        if (isLayoutComponent(child.get())) {
            layoutChildren.push_back(child.get());
        } else if (isContentWrapper(child.get())) {
            // Process LayoutComponentContent/CanvasContent wrappers to find nested
            // layout children (matching inflateLayout content wrapper handling)
            std::vector<Operation*> contentStack;
            contentStack.push_back(child.get());
            LTRACE("  Processing content wrapper opcode=%d with %d children\n",
                   child->opcode(), (int)child->mChildren.size());
            while (!contentStack.empty()) {
                Operation* wrapper = contentStack.back();
                contentStack.pop_back();
                bool wrapperIsCanvas = (wrapper->opcode() == 207);
                LTRACE("    wrapper opcode=%d children=%d\n", wrapper->opcode(), (int)wrapper->mChildren.size());
                for (auto& sub : wrapper->mChildren) {
                    LTRACE("      sub opcode=%d isLayout=%d\n", sub->opcode(), isLayoutComponent(sub.get()));
                    if (sub->opcode() == 207) {
                        // CanvasContent: its children are draw operations
                        for (auto& canvasChild : sub->mChildren) {
                            rootCanvasOps.push_back(canvasChild.get());
                        }
                    } else if (sub->opcode() == 201) {
                        // Nested LayoutComponentContent
                        contentStack.push_back(sub.get());
                    } else if (isLayoutComponent(sub.get())) {
                        layoutChildren.push_back(sub.get());
                    } else {
                        rootDataOps.push_back(sub.get());
                    }
                }
            }
        }
    }
    if (layoutChildren.empty()) {
        LTRACE("  No layout children found, falling back to direct apply\n");
        for (auto& child : mChildren) {
            child->apply(context);
        }
        return;
    }

    float maxW = context.mWidth;
    float maxH = context.mHeight;
    LayoutCache& cache = cacheFor(context);
    MeasurePass& measure = cache.measure;

    // Re-measure only when a *layout* input changed — mirroring androidx's mNeedsMeasure gate.
    // The layout epoch bumps whenever any non-clock variable changes value, so a static or
    // settled slide keeps its cached layout and only re-paints; paint-time animations (a scroll
    // offset, a fade alpha, a colour) that DO move bump the epoch and re-lay-out while moving.
    // (The CoreDocument DATA pass ran before this, so mLayoutEpoch already reflects this frame.)
    bool needMeasure = !cache.laid || cache.w != maxW || cache.h != maxH
                       || cache.hasStateLayout || cache.animating
                       || cache.epoch != context.mLayoutEpoch;

    if (needMeasure) {
        // Full measure/layout, exactly as the un-cached path did (fresh per-op state so
        // inflateLayout — gated on ls.inflated — re-reads every modifier this pass).
        cache.states.clear();
        sSawStateLayout = false;
        sSawActiveAnim = false;
        resetLayoutOverflowCounts();

        context.setMode(ContextMode::DATA);
        for (auto* op : rootDataOps) { context.incrementOpCount(); op->apply(context); }
        for (auto* op : rootCanvasOps) { context.incrementOpCount(); op->apply(context); }
        context.setMode(ContextMode::PAINT);

        // Two passes: pass 1 establishes dimensions; the DATA pass in between publishes them as
        // COMPONENT_VALUEs; pass 2 re-layouts so LayoutCompute expressions that read those work.
        for (auto* layoutChild : layoutChildren) {
            context.setMode(ContextMode::DATA);
            applyDataOps(layoutChild, context);
            context.setMode(ContextMode::PAINT);

            measureComponent(layoutChild, pc, context, 0, maxW, 0, maxH, measure);
            layoutComponent(layoutChild, context, measure);
            storeMeasuredDimensions(layoutChild, context, measure);

            context.setMode(ContextMode::DATA);
            applyDataOps(layoutChild, context);
            context.setMode(ContextMode::PAINT);

            layoutComponent(layoutChild, context, measure);
            gCountLayoutOverflow = true;    // the settled layout: what a host would show
            storeMeasuredDimensions(layoutChild, context, measure);
            gCountLayoutOverflow = false;
        }

        // Layout-animation pass: blend measured bounds toward targets over time.
        double animTime = context.getAnimationTime();
        for (auto* layoutChild : layoutChildren) {
            animateLayoutTree(layoutChild, context, measure, animTime);
            // The bounds shown, mid-animation included, are the component's bounds (the
            // reference's Component.layout applies the AnimateMeasure before
            // updateComponentValues).
            storeMeasuredDimensions(layoutChild, context, measure);
        }

        cache.hasStateLayout = cache.hasStateLayout || sSawStateLayout;
        cache.animating = sSawActiveAnim;
        if (sSawActiveAnim) context.needsRepaint();   // the next frame moves it on
        cache.epoch = context.mLayoutEpoch;   // snapshot: re-lay-out when a non-clock var moves
        cache.laid = true;
        cache.w = maxW;
        cache.h = maxH;
    } else {
        // Cached: still evaluate expressions so the paint reads current offset/alpha/colour
        // (the measure/layout itself is reused).
        context.setMode(ContextMode::DATA);
        for (auto* op : rootDataOps) { context.incrementOpCount(); op->apply(context); }
        for (auto* op : rootCanvasOps) { context.incrementOpCount(); op->apply(context); }
        for (auto* layoutChild : layoutChildren) applyDataOps(layoutChild, context);
        context.setMode(ContextMode::PAINT);
    }

    // Paint every frame, from the (possibly cached) layout.
    pc->matrixSave();
    pc->savePaint();
    pc->clipRect(0, 0, maxW, maxH);
    for (auto* layoutChild : layoutChildren) {
        paintLayoutComponent(layoutChild, context, measure);
    }
    pc->restorePaint();
    pc->matrixRestore();
}

// Helper: apply children with updateVariables (matching TS Component behavior)
static void applyChildrenWithUpdate(std::vector<std::unique_ptr<Operation>>& children, RemoteContext& context) {
    for (auto& child : children) {
        if (child->isVariableSupport()) {
            child->updateVariables(context);
        }
        child->apply(context);
    }
}

void LayoutComponentContent::apply(RemoteContext& context) {
    applyChildrenWithUpdate(mChildren, context);
}

void LayoutBox::apply(RemoteContext& context) {
    applyChildrenWithUpdate(mChildren, context);
}

void LayoutRow::apply(RemoteContext& context) {
    applyChildrenWithUpdate(mChildren, context);
}

void LayoutColumn::apply(RemoteContext& context) {
    applyChildrenWithUpdate(mChildren, context);
}

void LayoutCanvas::apply(RemoteContext& context) {
    // Push canvas bounds for per-component touch hit-testing.
    // COMPONENT_WIDTH/HEIGHT are set by modifiers before children run.
    float w = context.getFloat(RemoteContext::ID_COMPONENT_WIDTH);
    float h = context.getFloat(RemoteContext::ID_COMPONENT_HEIGHT);
    context.pushCanvasBounds(w, h);
    applyChildrenWithUpdate(mChildren, context);
    context.popCanvasBounds();
}

void CanvasContent::apply(RemoteContext& context) {
    applyChildrenWithUpdate(mChildren, context);
}

void ModifierScroll::apply(RemoteContext& context) {
    applyChildrenWithUpdate(mChildren, context);
}

void LayoutText::apply(RemoteContext& context) {
    // Standalone text (not in layout tree)
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) {
            std::string text = context.getText(textId);
            if (!text.empty()) {
                pc->savePaint();
                PaintBundle textPaint;
                textPaint.addTagFloat(PaintBundle::TEXT_SIZE, fontSize);
                textPaint.addTag(PaintBundle::COLOR, color);
                pc->applyPaint(textPaint);
                pc->drawTextAnchored(textId, 0, fontSize, 0, 0, 0);
                pc->restorePaint();
            }
        }
    }
    for (auto& child : mChildren) {
        child->apply(context);
    }
}

void CoreTextOp::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) {
            std::string text = context.getText(textId);
            if (!text.empty()) {
                pc->savePaint();
                PaintBundle textPaint;
                textPaint.addTagFloat(PaintBundle::TEXT_SIZE, fontSize);
                textPaint.addTag(PaintBundle::COLOR, color);
                pc->applyPaint(textPaint);
                pc->drawTextAnchored(textId, 0, fontSize, 0, 0, 0);
                pc->restorePaint();
            }
        }
    }
    for (auto& child : mChildren) {
        child->apply(context);
    }
}

void LayoutFlow::apply(RemoteContext& context) {
    applyChildrenWithUpdate(mChildren, context);
}

void LoopOperationOp::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(from, context, this);
    Utils::registerFloatVar(step, context, this);
    Utils::registerFloatVar(until, context, this);
    for (auto& child : mChildren) {
        if (child->isVariableSupport()) child->registerListening(context);
    }
}

void StateLayout::registerListening(RemoteContext& context) {
    for (auto& child : mChildren) {
        if (child->isVariableSupport()) child->registerListening(context);
    }
}

void StateLayout::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::DATA) {
        for (auto& child : mChildren) {
            child->apply(context);
        }
        return;
    }

    if (context.getMode() != ContextMode::PAINT) return;

    // Resolve the index from the integer state
    int currentIndex = 0;
    if (indexId != 0) {
        currentIndex = context.getInteger(indexId);
    }

    // Find the layout children and render only the one at the current index
    auto& ls = getLS(context, this);
    int childIdx = 0;
    for (auto* child : ls.layoutChildren) {
        if (childIdx == currentIndex) {
            if (child->isVariableSupport()) {
                child->updateVariables(context);
            }
            child->apply(context);
            break;
        }
        childIdx++;
    }

    // Also apply non-layout children (data ops, modifiers, etc.)
    for (auto* child : ls.canvasOps) {
        child->apply(context);
    }
}

void LoopOperationOp::apply(RemoteContext& context) {
    // Match TS: in DATA mode, apply children once to register variables, then return
    if (context.getMode() == ContextMode::DATA) {
        for (auto& child : mChildren) {
            child->apply(context);
        }
        return;
    }

    // PAINT mode: resolve loop bounds and iterate
    // Plain NaN tests, matching LoopOperation.updateVariables in the reference. The same
    // substitution as in ConditionalOp above: Utils::isVariable rejects ids 10..40, so a
    // loop bound reading one of those system variables kept its raw NaN and the loop then
    // ran zero times, or forever, depending which bound it was.
    float fromVal = std::isnan(from) ? context.getFloat(Utils::idFromNan(from)) : from;
    float stepVal = std::isnan(step) ? context.getFloat(Utils::idFromNan(step)) : step;
    float untilVal = std::isnan(until) ? context.getFloat(Utils::idFromNan(until)) : until;

    if (stepVal <= 0 || !std::isfinite(fromVal) || !std::isfinite(untilVal) || !std::isfinite(stepVal)) return;
    int maxIter = 10000;

    if (indexId == 0) {
        for (float i = fromVal; i < untilVal && maxIter > 0; i += stepVal, maxIter--) {
            for (auto& child : mChildren) {
                child->apply(context);
            }
        }
    } else {
        for (float i = fromVal; i < untilVal && maxIter > 0; i += stepVal, maxIter--) {
            context.loadFloat(indexId, i);
            for (auto& child : mChildren) {
                if (child->isVariableSupport()) {
                    child->updateVariables(context);
                }
                child->apply(context);
            }
        }
    }
}

void ConditionalOp::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(a, context, this);
    Utils::registerFloatVar(b, context, this);
    for (auto& child : mChildren) {
        if (child->isVariableSupport()) child->registerListening(context);
    }
}

void ConditionalOp::apply(RemoteContext& context) {
    // Outside PAINT, run the children anyway.
    //
    // The condition gates DRAWING, not data. A nested op that DEFINES something - an
    // ANIMATED_FLOAT for an expression, a DATA_TEXT for a string - has to execute in the data
    // pass or its id is never populated, and the writer puts those definitions wherever the
    // value is first used, which for a value only referenced inside a branch is inside the
    // branch. Returning early here meant such a definition never ran at all: the id resolved
    // to nothing and the op that used it drew off-screen, silently.
    //
    // This was visible as a drawRect with VARIABLE coordinates inside a conditional rendering
    // nothing while the same rect with literal coordinates rendered fine, and while the same
    // variable coordinates outside a conditional also rendered fine. The TypeScript player
    // draws all three, which is what says this is the defect and not the document.
    //
    // Safe because every draw op already gates its own apply() on PAINT, so running them in
    // the data pass paints nothing.
    if (context.getMode() != ContextMode::PAINT) {
        for (auto& child : mChildren) {
            if (child->isVariableSupport()) child->updateVariables(context);
            child->apply(context);
        }
        return;
    }

    // Update children's variables first (TS does this before evaluating condition)
    for (auto& child : mChildren) {
        if (child->isVariableSupport()) {
            child->updateVariables(context);
        }
    }

    // A PLAIN NaN test, not Utils::isVariable. The reference resolves these operands with
    // `Float.isNaN(mVarA) ? context.getFloat(...)` — any NaN-boxed id resolves.
    // Utils::isVariable additionally rejects ids 10..40 (`id > 40 || id < 10`), which is
    // correct for whatever that helper is for but silently wrong here: it covers weekDay
    // (11), dayOfMonth (12), dayOfYear (34), year (35) and the whole touch/sensor range.
    // Those operands were left as raw NaN, and since every comparison against NaN is
    // false, the conditional never ran — for ANY value. A ladder testing `weekDay eq 1`
    // through `eq 7` fired on none of them, while `calendarMonth eq 10` (id 9, under the
    // threshold) worked in the same document.
    float aVal = std::isnan(a) ? context.getFloat(Utils::idFromNan(a)) : a;
    float bVal = std::isnan(b) ? context.getFloat(Utils::idFromNan(b)) : b;

    bool condition = false;
    switch (type) {
        case 0: condition = (aVal == bVal); break;
        case 1: condition = (aVal != bVal); break;
        case 2: condition = (aVal < bVal); break;
        case 3: condition = (aVal <= bVal); break;
        case 4: condition = (aVal > bVal); break;
        case 5: condition = (aVal >= bVal); break;
        default: break;
    }
    if (condition) {
        for (auto& child : mChildren) {
            child->apply(context);
        }
    }
}

} // namespace rccore
