#include "rccore/operations/LayoutOperations.h"
#include "rccore/operations/AdvancedOperations.h"
#include "rccore/LayoutSystem.h"
#include "rccore/RemoteContext.h"
#include "rccore/PaintContext.h"
#include "rccore/PaintBundle.h"
#include "rccore/Utils.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

// Debug layout tracing (set to 1 for verbose output)
#define LAYOUT_DEBUG 0

#if LAYOUT_DEBUG
#define LTRACE(...) fprintf(stderr, __VA_ARGS__)
#else
#define LTRACE(...) ((void)0)
#endif

namespace rccore {

// ── Modifier variable support ──────────────────────────────────────────

void ModifierWidth::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(width, context, this);
}
void ModifierWidth::updateVariables(RemoteContext& context) {
    oWidth = Utils::resolveFloat(width, context);
}

void ModifierHeight::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(height, context, this);
}
void ModifierHeight::updateVariables(RemoteContext& context) {
    oHeight = Utils::resolveFloat(height, context);
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
           oc == 224 || oc == 235 || oc == 228 || oc == 238 || oc == 174;
}

static bool isLayoutComponent(const Operation* op) {
    int oc = op->opcode();
    // 208 (LAYOUT_TEXT) is included — Java treats it as a layout component.
    return oc == 200 || oc == 202 || oc == 203 || oc == 204 || oc == 205 ||
           oc == 207 || oc == 208 || oc == 217 || oc == 239 || oc == 240 ||
           oc == 176 || oc == 230 || oc == 233 || oc == 234;
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

    LTRACE("    inflate op=%d, %d children\n", self->opcode(), (int)self->mChildren.size());
    for (auto& childPtr : self->mChildren) {
        Operation* child = childPtr.get();
        if (isModifierOp(child)) {
            // Extract modifier data
            switch (child->opcode()) {
                case 16: { // ModifierWidth
                    auto* mw = static_cast<ModifierWidth*>(child);
                    ls.widthType = static_cast<DimType>(mw->type);
                    ls.widthValue = mw->oWidth;
                    break;
                }
                case 67: { // ModifierHeight
                    auto* mh = static_cast<ModifierHeight*>(child);
                    ls.heightType = static_cast<DimType>(mh->type);
                    ls.heightValue = mh->oHeight;
                    break;
                }
                case 58: { // ModifierPadding
                    auto* mp = static_cast<ModifierPadding*>(child);
                    ls.paddingLeft += mp->oLeft;
                    ls.paddingTop += mp->oTop;
                    ls.paddingRight += mp->oRight;
                    ls.paddingBottom += mp->oBottom;
                    break;
                }
                case 55: { // ModifierBackground
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
                    auto* mb = static_cast<ModifierBorder*>(child);
                    ls.hasBorder = true;
                    ls.borderFlags = mb->flags;
                    ls.borderColorId = mb->colorId;
                    ls.borderWidth = mb->oBorderWidth;
                    ls.borderCorner = mb->oRoundedCorner;
                    ls.borderR = mb->oR; ls.borderG = mb->oG;
                    ls.borderB = mb->oB; ls.borderA = mb->oA;
                    ls.borderShape = mb->shapeType;
                    break;
                }
                case 231: { // ModifierWidthIn
                    auto* m = static_cast<ModifierWidthIn*>(child);
                    ls.widthInMin = m->oMin;
                    ls.widthInMax = m->oMax;
                    break;
                }
                case 232: { // ModifierHeightIn
                    auto* m = static_cast<ModifierHeightIn*>(child);
                    ls.heightInMin = m->oMin;
                    ls.heightInMax = m->oMax;
                    break;
                }
                case 221: { // ModifierOffset
                    auto* m = static_cast<ModifierOffset*>(child);
                    ls.hasOffset = true;
                    ls.offsetX = m->oX;
                    ls.offsetY = m->oY;
                    break;
                }
                case 108: { // ClipRectModifier
                    ls.hasClipRect = true;
                    break;
                }
                case 54: { // RoundedClipRectModifier
                    auto* m = static_cast<ModifierRoundedClipRect*>(child);
                    ls.hasRoundedClipRect = true;
                    ls.clipTopStart = m->oTopStart;
                    ls.clipTopEnd = m->oTopEnd;
                    ls.clipBottomStart = m->oBottomStart;
                    ls.clipBottomEnd = m->oBottomEnd;
                    break;
                }
                case 226: { // ScrollModifier
                    auto* m = static_cast<ModifierScroll*>(child);
                    ls.hasScroll = true;
                    ls.scrollDirection = m->direction;
                    ls.scrollPosition = m->position; // may be NaN-encoded
                    ls.scrollMaxNan = m->max;        // original NaN-encoded max scroll var ID
                    ls.scrollNotchNan = m->notchMax;  // original NaN-encoded content dim var ID
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
                for (auto& sub : child->mChildren) {
                    ls.dataOps.push_back(sub.get());
                }
            }
        } else if (isContentWrapper(child)) {
            // LayoutComponentContent or CanvasContent - children are the real layout children
            LTRACE("      content wrapper opcode=%d with %d subs\n", child->opcode(), (int)child->mChildren.size());
            // Register this wrapper's componentId for dimension lookups
            if (child->opcode() == 201) {
                auto* lcc = static_cast<LayoutComponentContent*>(child);
                if (lcc->componentId != 0) {
                    ls.canvasContentIds.push_back(lcc->componentId);
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
                            ls.canvasContentIds.push_back(lcc->componentId);
                        }
                        LTRACE("        nested content wrapper cid=%d with %d subs\n", lcc->componentId, (int)sub->mChildren.size());
                        contentStack.push_back(sub.get());
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
static float computeModifierDefinedWidth(const LayoutState& ls) {
    float pw = ls.paddingLeft + ls.paddingRight;
    if (ls.widthType == DimType::EXACT || ls.widthType == DimType::EXACT_DP) {
        return pw + ls.widthValue;
    }
    return pw;
}

static float computeModifierDefinedHeight(const LayoutState& ls) {
    float ph = ls.paddingTop + ls.paddingBottom;
    if (ls.heightType == DimType::EXACT || ls.heightType == DimType::EXACT_DP) {
        return ph + ls.heightValue;
    }
    return ph;
}

// ── Forward declarations for layout functions ────────────────────────
static void measureComponent(Operation* op, PaintContext* pc, RemoteContext& ctx,
                             float minW, float maxW, float minH, float maxH,
                             MeasurePass& measure);

static void layoutComponent(Operation* op, RemoteContext& ctx, MeasurePass& measure);

static void paintComponent(Operation* op, RemoteContext& ctx);

// ── Get LayoutState for a layout operation ───────────────────────────
// We store LayoutState as part of the Operation by using a static map.
// (Alternatively, we could add LayoutState to each class, but this avoids
//  modifying the header for all layout types.)
#include <unordered_map>
static std::unordered_map<Operation*, LayoutState>& getLayoutStates() {
    static std::unordered_map<Operation*, LayoutState> sStates;
    return sStates;
}

static LayoutState& getLS(Operation* op) {
    auto& states = getLayoutStates();
    return states[op];
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
        default: return -1;
    }
}

// ── Measure a text component ─────────────────────────────────────────
static void measureText(Operation* op, PaintContext* pc, RemoteContext& ctx,
                        float minW, float maxW, float minH, float maxH,
                        MeasurePass& measure) {
    int cid = getComponentId(op);
    auto& m = measure.get(cid);
    auto& ls = getLS(op);
    inflateLayout(op, ls);

    int tid = 0;
    float fsize = 16;
    int col = 0;
    if (op->opcode() == 208) {
        auto* lt = static_cast<LayoutText*>(op);
        tid = lt->textId;
        fsize = lt->oFontSize;
        col = lt->color;
    } else {
        auto* ct = static_cast<CoreTextOp*>(op);
        tid = ct->textId;
        fsize = ct->oFontSize;
        col = ct->color;
    }

    // Resolve NaN-encoded variable references (fallback for unresolved)
    fsize = resolveVar(fsize, ctx);
    if (fsize <= 0 || std::isnan(fsize)) fsize = 16;

    std::string text = ctx.getText(tid);
    float textW = pc ? pc->measureTextWidth(text, fsize) : fsize * 0.6f * text.size();
    float lineH = pc ? pc->measureTextHeight(text, fsize) : fsize * 1.2f;
    LTRACE("    measureText cid=%d tid=%d text='%.20s' fsize=%.1f textW=%.1f lineH=%.1f maxW=%.1f maxH=%.1f\n",
           cid, tid, text.c_str(), fsize, textW, lineH, maxW, maxH);

    // Check if text needs wrapping within the available width or has embedded newlines
    float contentMaxW = maxW - ls.paddingLeft - ls.paddingRight;
    float textH = lineH;
    bool hasNewlines = (text.find('\n') != std::string::npos);
    if (contentMaxW > 0 && (textW > contentMaxW || hasNewlines)) {
        auto wrappedLines = wrapText(pc, text, fsize,
                                     contentMaxW > 0 ? contentMaxW : 1e9f);
        textH = lineH * wrappedLines.size();
        // Compute actual max line width for proper sizing
        float maxLineW = 0;
        for (auto& line : wrappedLines) {
            std::string lineStr = text.substr(line.start, line.end - line.start);
            float lw = pc ? pc->measureTextWidth(lineStr, fsize) : fsize * 0.6f * lineStr.size();
            maxLineW = std::max(maxLineW, lw);
        }
        textW = std::min(maxLineW, contentMaxW > 0 ? contentMaxW : maxLineW);
    }

    float measuredW = textW + ls.paddingLeft + ls.paddingRight;
    float measuredH = textH + ls.paddingTop + ls.paddingBottom;

    // Apply width/height modifiers
    if (ls.widthType == DimType::EXACT || ls.widthType == DimType::EXACT_DP) {
        measuredW = ls.widthValue + ls.paddingLeft + ls.paddingRight;
    } else if (ls.widthType == DimType::FILL) {
        measuredW = maxW;
    }

    if (ls.heightType == DimType::EXACT || ls.heightType == DimType::EXACT_DP) {
        measuredH = ls.heightValue + ls.paddingTop + ls.paddingBottom;
    } else if (ls.heightType == DimType::FILL) {
        measuredH = maxH;
    }

    measuredW = std::max(measuredW, minW);
    measuredW = std::min(measuredW, maxW);
    measuredH = std::max(measuredH, minH);
    measuredH = std::min(measuredH, maxH);

    m.w = measuredW;
    m.h = measuredH;
    LTRACE("    measureText DONE cid=%d w=%.1f h=%.1f (text='%.20s' fsize=%.1f)\n", cid, m.w, m.h, text.c_str(), fsize);
}

// ── Measure a layout manager (Box, Row, Column, etc.) ────────────────
// Ported from Java LayoutManager.measure_v1_1_0()
static void measureLayoutManager(Operation* op, PaintContext* pc, RemoteContext& ctx,
                                 float minW, float maxW, float minH, float maxH,
                                 MeasurePass& measure) {
    int cid = getComponentId(op);
    auto& m = measure.get(cid);
    auto& ls = getLS(op);
    inflateLayout(op, ls);

    // STEP 1: Start with modifier-defined dimensions, clamped to maxWidth/maxHeight
    float measuredW = std::min(maxW, computeModifierDefinedWidth(ls));
    float measuredH = std::min(maxH, computeModifierDefinedHeight(ls));

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

    if (ls.widthType == DimType::FILL) {
        measuredW = maxW;
        minW = insetMaxW;  // Java: children get full width
    } else if (ls.widthType != DimType::WEIGHT) {
        measuredW = std::clamp(measuredW, minW, maxW);
        hasHWrap = (ls.widthType == DimType::WRAP);
        // Measure version 2 tightening: non-WRAP gets exact inset
        if (!hasHWrap) {
            insetMaxW = measuredW - ls.paddingLeft - ls.paddingRight;
        }
    }

    if (ls.heightType == DimType::FILL) {
        measuredH = maxH;
        minH = insetMaxH;  // Java: children get full height
    } else if (ls.heightType != DimType::WEIGHT) {
        measuredH = std::clamp(measuredH, minH, maxH);
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

    if (oc == 240) {
        // FlowLayout: wrap children into rows based on available width
        float spacedBy = static_cast<LayoutFlow*>(op)->spacedBy;

        // Inflate and measure all children first
        for (auto* child : ls.layoutChildren) {
            auto& childLS = getLS(child);
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
            auto& childLS = getLS(child);
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
        if (oc == 203) spacedBy = static_cast<LayoutRow*>(op)->spacedBy;
        else if (oc == 230) spacedBy = static_cast<CollapsibleRowLayout*>(op)->spacedBy;

        // Check for WEIGHT width children (two-pass measurement)
        float totalWeights = 0;
        bool hasWeights = false;
        int totalChildCount = 0;
        for (auto* child : ls.layoutChildren) {
            auto& childLS = getLS(child);
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
                auto& childLS = getLS(child);
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
                auto& childLS = getLS(child);
                if (childLS.widthType == DimType::WEIGHT) weightChildCount++;
            }

            // remaining = insetMaxW - non_weight_total (no gap subtraction, matching TS)
            float remainingW = std::max(0.0f, insetMaxW - wrapW);

            // Pass 2: distribute remaining space to WEIGHT children proportionally
            for (auto* child : ls.layoutChildren) {
                auto& childLS = getLS(child);
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
        if (oc == 204) spacedBy = static_cast<LayoutColumn*>(op)->spacedBy;
        else if (oc == 233) spacedBy = static_cast<CollapsibleColumnLayout*>(op)->spacedBy;

        // Check for WEIGHT height children (two-pass measurement)
        float totalWeights = 0;
        bool hasWeights = false;
        int weightChildCount = 0;
        for (auto* child : ls.layoutChildren) {
            auto& childLS = getLS(child);
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
                auto& childLS = getLS(child);
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
                auto& childLS = getLS(child);
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
            auto& childLS = getLS(child);
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
    if (hasHWrap) {
        measuredW = wrapW + ls.paddingLeft + ls.paddingRight;
        measuredW = std::max(measuredW, minW);
    }
    if (hasVWrap) {
        measuredH = wrapH + ls.paddingTop + ls.paddingBottom;
        measuredH = std::max(measuredH, minH);
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
            // Row: simple sequential pass - no special weight handling here
            // (weight redistribution happens in layoutManager positioning pass)
            float mw = childMaxW;
            for (auto* child : ls.layoutChildren) {
                measureComponent(child, pc, ctx, 0, mw, 0, childMaxH, measure);
                auto& cm = measure.get(getComponentId(child));
                if (!cm.isGone()) mw -= cm.w;
            }
        } else if (oc == 204 || oc == 233) {
            // Column: handle WEIGHT children (matching TS Column.computeSize)
            float totalWeights = 0;
            bool hasWeights = false;
            float totalNonWeightH = 0;
            float mh = childMaxH;

            for (auto* child : ls.layoutChildren) {
                auto& childLS = getLS(child);
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
                    auto& childLS = getLS(child);
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
        } else {
            // Box/Canvas/FitBox/FlowLayout: simple re-measure
            ComponentMeasure parentM;
            parentM.w = childMaxW;
            parentM.h = childMaxH;
            for (auto* child : ls.layoutChildren) {
                measureComponent(child, pc, ctx, 0, childMaxW, 0, childMaxH, measure);
                // Apply LayoutCompute TYPE_MEASURE modifiers (stored on CHILD)
                auto& childLS = getLS(child);
                if (!childLS.measureComputes.empty()) {
                    auto& cm = measure.get(getComponentId(child));
                    for (auto& lci : childLS.measureComputes) {
                        applyLayoutCompute(lci, ctx, cm, parentM);
                    }
                }
            }
        }
    }

    // STEP 10: Enforce min constraints one more time (Java)
    measuredW = std::max(measuredW, minW);
    measuredH = std::max(measuredH, minH);

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
    auto& childLS = getLS(child);
    if (!childLS.hasAlignBy) return 0;

    float line = childLS.alignByLine;
    int oc = child->opcode();

    // Check if line is NaN-encoded (baseline ID or variable reference)
    if (std::isnan(line)) {
        int id = Utils::idFromNan(line);
        // ID 36 = FIRST_BASELINE, ID 37 = LAST_BASELINE
        if (id == 36 || id == 37) {
            // Text component: compute baseline from font metrics
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
    auto& ls = getLS(op);

    float selfW = selfM.w - ls.paddingLeft - ls.paddingRight;
    float selfH = selfM.h - ls.paddingTop - ls.paddingBottom;

    int oc = op->opcode();

    auto* pc = ctx.getPaintContext();

    if (oc == 240) {
        // FlowLayout: position children in wrapped rows
        int hPos = static_cast<LayoutFlow*>(op)->horizontal;
        int vPos = static_cast<LayoutFlow*>(op)->vertical;
        float spacedBy = static_cast<LayoutFlow*>(op)->spacedBy;

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
            auto& childLS = getLS(child);
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
                    auto& childLS = getLS(child);
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
                        auto& childLS = getLS(child);
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

            for (auto* child : row) {
                auto& cm = measure.get(getComponentId(child));
                if (cm.isGone()) continue;
                // Within-row vertical alignment (matching TS)
                float ty = 0;
                switch (vPos) {
                    case POS_CENTER: ty = (rowH - cm.h) / 2; break;
                    case POS_BOTTOM: case POS_END: ty = rowH - cm.h; break;
                    default: ty = 0; break;
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
            spacedBy = static_cast<LayoutRow*>(op)->spacedBy;
        } else {
            hPos = static_cast<CollapsibleRowLayout*>(op)->horizontal;
            vPos = static_cast<CollapsibleRowLayout*>(op)->vertical;
            spacedBy = static_cast<CollapsibleRowLayout*>(op)->spacedBy;
        }

        // Weight redistribution (matching TS internalLayoutMeasure)
        {
            bool hasWeights = false;
            float totalWeights = 0;
            float nonWeightWidth = 0;
            for (auto* child : ls.layoutChildren) {
                auto& cm = measure.get(getComponentId(child));
                if (cm.isGone()) continue;
                auto& childLS = getLS(child);
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
                    auto& childLS = getLS(child);
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
            auto& childLS = getLS(child);
            if (childLS.hasAlignBy) {
                hasAlignBy = true;
                float abv = getAlignByValue(child, ctx, pc);
                maxAlignByValue = std::max(maxAlignByValue, abv);
            }
        }

        float tx = startX;
        for (auto* child : ls.layoutChildren) {
            auto& cm = measure.get(getComponentId(child));
            if (cm.isGone()) continue;

            float alignByOffset = 0;
            if (hasAlignBy) {
                auto& childLS = getLS(child);
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
            spacedBy = static_cast<LayoutColumn*>(op)->spacedBy;
        } else {
            hPos = static_cast<CollapsibleColumnLayout*>(op)->horizontal;
            vPos = static_cast<CollapsibleColumnLayout*>(op)->vertical;
            spacedBy = static_cast<CollapsibleColumnLayout*>(op)->spacedBy;
        }

        // Weight redistribution (matching TS internalLayoutMeasure)
        {
            bool hasWeights = false;
            float totalWeights = 0;
            float nonWeightHeight = 0;
            for (auto* child : ls.layoutChildren) {
                auto& cm = measure.get(getComponentId(child));
                if (cm.isGone()) continue;
                auto& childLS = getLS(child);
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
                    auto& childLS = getLS(child);
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
            if (cm.isGone()) continue;

            float tx = 0;
            switch (hPos) {
                case POS_START: tx = 0; break;
                case POS_CENTER: tx = (selfW - cm.w) / 2; break;
                case POS_END: tx = selfW - cm.w; break;
                default: tx = 0; break;
            }
            cm.x = tx;
            cm.y = ty;
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
        } else if (oc == 217) {
            hPos = static_cast<StateLayout*>(op)->horizontalPositioning;
            vPos = static_cast<StateLayout*>(op)->verticalPositioning;
        }

        // Parent measure for LayoutCompute
        ComponentMeasure parentM;
        parentM.w = selfW;
        parentM.h = selfH;

        for (auto* child : ls.layoutChildren) {
            auto& cm = measure.get(getComponentId(child));
            if (cm.isGone()) continue;

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
            auto& childLS = getLS(child);
            for (auto& lci : childLS.positionComputes) {
                applyLayoutCompute(lci, ctx, cm, parentM);
            }

            layoutComponent(child, ctx, measure);
        }
    }

    // Write scroll max/notch variables to context (matching Java ScrollModifierOperation.layout())
    if (ls.hasScroll) {
        float maxScroll = std::max(0.0f, ls.scrollContentDimension - ls.scrollHostDimension);
        if (Utils::isVariable(ls.scrollMaxNan)) {
            ctx.loadFloat(Utils::idFromNan(ls.scrollMaxNan), maxScroll);
        }
        if (Utils::isVariable(ls.scrollNotchNan)) {
            ctx.loadFloat(Utils::idFromNan(ls.scrollNotchNan), ls.scrollContentDimension);
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
    } else if (isLayoutComponent(op)) {
        measureLayoutManager(op, pc, ctx, minW, maxW, minH, maxH, measure);
    }
}

// ── Generic layout dispatcher ────────────────────────────────────────
static void layoutComponent(Operation* op, RemoteContext& ctx, MeasurePass& measure) {
    if (isLayoutComponent(op) && op->opcode() != 208 && op->opcode() != 239) {
        layoutManager(op, ctx, measure);
    }
}

// ── Store measured dimensions in RemoteContext for COMPONENT_VALUE ────
static void storeMeasuredDimensions(Operation* op, RemoteContext& ctx, MeasurePass& measure) {
    int cid = getComponentId(op);
    auto& ls = getLS(op);

    if (cid != -1 && measure.contains(cid)) {
        auto& m = measure.get(cid);
        // Store outer dimensions for the component itself
        ctx.setComponentDimension(cid, m.w, m.h, m.x, m.y);
        LTRACE("    storeDim cid=%d w=%.1f h=%.1f x=%.1f y=%.1f\n", cid, m.w, m.h, m.x, m.y);

        // Also store inner dimensions (after padding) for canvas content IDs
        // These are separate components that should have the content area dimensions
        float innerW = std::max(0.0f, m.w - ls.paddingLeft - ls.paddingRight);
        float innerH = std::max(0.0f, m.h - ls.paddingTop - ls.paddingBottom);
        for (int ccid : ls.canvasContentIds) {
            ctx.setComponentDimension(ccid, innerW, innerH, m.x, m.y);
            LTRACE("    storeDim canvasContent cid=%d w=%.1f h=%.1f\n", ccid, innerW, innerH);
        }
    }

    for (auto* child : ls.layoutChildren) {
        storeMeasuredDimensions(child, ctx, measure);
    }
}

// ── Paint background modifier ────────────────────────────────────────
static void paintBackground(const LayoutState& ls, PaintContext* pc, RemoteContext& ctx,
                            float w, float h) {
    if (!ls.hasBg || !pc) return;

    pc->savePaint();
    PaintBundle paint;
    // Set fill style and color
    paint.addUpperTag(PaintBundle::STYLE, PaintBundle::STYLE_FILL);
    if (ls.bgFlags == 2) {
        // COLOR_REF: use color ID from context
        int col = ctx.getColor(ls.bgColorId);
        paint.addTag(PaintBundle::COLOR, col);
    } else {
        int a = std::clamp((int)(ls.bgA * 255), 0, 255);
        int r = std::clamp((int)(ls.bgR * 255), 0, 255);
        int g = std::clamp((int)(ls.bgG * 255), 0, 255);
        int b = std::clamp((int)(ls.bgB * 255), 0, 255);
        int col = (a << 24) | (r << 16) | (g << 8) | b;
        paint.addTag(PaintBundle::COLOR, col);
    }
    pc->applyPaint(paint);
    pc->drawRect(0, 0, w, h);
    pc->restorePaint();
}

// ── Paint border modifier ────────────────────────────────────────────
static void paintBorder(const LayoutState& ls, PaintContext* pc, RemoteContext& ctx,
                        float w, float h) {
    if (!ls.hasBorder || !pc) return;

    pc->savePaint();
    PaintBundle paint;
    paint.addUpperTag(PaintBundle::STYLE, PaintBundle::STYLE_STROKE);
    paint.addTagFloat(PaintBundle::STROKE_WIDTH, ls.borderWidth);
    if (ls.borderFlags == 2) {
        // COLOR_REF: use color ID from context
        int col = ctx.getColor(ls.borderColorId);
        paint.addTag(PaintBundle::COLOR, col);
    } else {
        int a = std::clamp((int)(ls.borderA * 255), 0, 255);
        int r = std::clamp((int)(ls.borderR * 255), 0, 255);
        int g = std::clamp((int)(ls.borderG * 255), 0, 255);
        int b = std::clamp((int)(ls.borderB * 255), 0, 255);
        int col = (a << 24) | (r << 16) | (g << 8) | b;
        paint.addTag(PaintBundle::COLOR, col);
    }
    pc->applyPaint(paint);
    if (ls.borderCorner > 0) {
        pc->drawRoundRect(0, 0, w, h, ls.borderCorner, ls.borderCorner);
    } else {
        pc->drawRect(0, 0, w, h);
    }
    pc->restorePaint();
}

// ── Paint a layout component with transforms ─────────────────────────
static void paintLayoutComponent(Operation* op, RemoteContext& ctx, MeasurePass& measure) {
    auto* pc = ctx.getPaintContext();
    if (!pc) return;

    int cid = getComponentId(op);
    auto& m = measure.get(cid);
    auto& ls = getLS(op);

    LTRACE("  paint cid=%d opcode=%d pos=(%.1f,%.1f) size=(%.1f,%.1f) bg=%d children=%d\n",
           cid, op->opcode(), m.x, m.y, m.w, m.h, ls.hasBg, (int)ls.layoutChildren.size());

    // Save transform state
    pc->matrixSave();
    pc->savePaint();

    // Translate to component position
    pc->matrixTranslate(m.x, m.y);
    ctx.pushTranslate(m.x, m.y);

    // Apply offset modifier
    if (ls.hasOffset) {
        float ox = resolveVar(ls.offsetX, ctx);
        float oy = resolveVar(ls.offsetY, ctx);
        pc->matrixTranslate(ox, oy);
        ctx.pushTranslate(ox, oy);
    }

    // Apply clip modifiers (TS only clips when a modifier is present)
    if (ls.hasRoundedClipRect) {
        pc->roundedClipRect(m.w, m.h, ls.clipTopStart, ls.clipTopEnd,
                            ls.clipBottomStart, ls.clipBottomEnd);
    } else if (ls.hasClipRect) {
        pc->clipRect(0, 0, m.w, m.h);
    } else if (ls.hasScroll) {
        // Scroll containers must clip to prevent overflow
        pc->clipRect(0, 0, m.w, m.h);
    }

    // Paint background
    paintBackground(ls, pc, ctx, m.w, m.h);

    // Paint border
    paintBorder(ls, pc, ctx, m.w, m.h);

    // Translate for padding
    pc->matrixTranslate(ls.paddingLeft, ls.paddingTop);

    // Apply scroll translation (direction: 0=vertical, 1=horizontal, matching Java)
    if (ls.hasScroll) {
        float scrollPos = resolveVar(ls.scrollPosition, ctx);
        if (ls.scrollDirection == 0) {
            pc->matrixTranslate(0, -scrollPos);  // vertical scroll
        } else {
            pc->matrixTranslate(-scrollPos, 0);  // horizontal scroll
        }
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
        if (oc == 208) {
            auto* lt = static_cast<LayoutText*>(op);
            tid = lt->textId; fsize = lt->fontSize; col = lt->color;
            tAlign = lt->textAlign & 0xFFFF;
        } else {
            auto* ct = static_cast<CoreTextOp*>(op);
            tid = ct->textId; fsize = ct->fontSize; col = ct->color;
            colId = ct->colorId;
            tAlign = ct->textAlign & 0xFFFF;
        }

        // Resolve NaN-encoded variable references
        fsize = resolveVar(fsize, ctx);
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
            pc->applyPaint(textPaint);

            float contentW = m.w - ls.paddingLeft - ls.paddingRight;
            float lineH = pc->measureTextHeight(text, fsize);
            float fullW = pc->measureTextWidth(text, fsize);

            // Compute textAlign X offset (1=LEFT, 2=RIGHT, 3=CENTER, 5=START, 6=END)
            float textX = 0;
            if (tAlign == 3) { // CENTER
                textX = (contentW - fullW) / 2;
            } else if (tAlign == 2 || tAlign == 6) { // RIGHT or END
                textX = contentW - fullW;
            }

            float ascent = pc->measureTextAscent(text, fsize);

            if (contentW > 0 && fullW > contentW) {
                // Draw wrapped text line by line
                auto wrappedLines = wrapText(pc, text, fsize, contentW);
                for (size_t li = 0; li < wrappedLines.size(); li++) {
                    auto& line = wrappedLines[li];
                    if (line.start < line.end) {
                        pc->drawTextRun(tid, line.start, line.end, line.start, line.end,
                                        0, ascent + lineH * (float)li, false);
                    }
                }
            } else {
                // Single line: draw at baseline with alignment offset
                // Use drawTextRun (not drawTextAnchored) since position is already computed
                pc->drawTextRun(tid, 0, (int)text.size(), 0, (int)text.size(),
                                textX, ascent, false);
            }
            pc->restorePaint();
        }
    } else {
        // Push canvas bounds for touch hit-testing (uses current translate position)
        ctx.pushCanvasBounds(m.w, m.h);

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
    pc->matrixRestore();
    if (ls.hasOffset) ctx.popTranslate();
    ctx.popTranslate();
}

// ── Run data operations for a layout tree ────────────────────────────
static void applyDataOps(Operation* op, RemoteContext& ctx) {
    auto& ls = getLS(op);
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

    LTRACE("LayoutRoot::apply PAINT mode, canvas=%.0fx%.0f\n", context.mWidth, context.mHeight);

    // Clear layout state cache for fresh measurement
    getLayoutStates().clear();

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
    MeasurePass measure;

    // Run root-level data ops from content wrappers (expressions, constants, etc.)
    if (!rootDataOps.empty() || !rootCanvasOps.empty()) {
        context.setMode(ContextMode::DATA);
        for (auto* op : rootDataOps) {
            context.incrementOpCount();
            op->apply(context);
        }
        for (auto* op : rootCanvasOps) {
            context.incrementOpCount();
            op->apply(context);
        }
        context.setMode(ContextMode::PAINT);
    }

    // Process each layout child: data → measure → layout → store dims → data again → paint
    // Two passes: first pass establishes dimensions, second pass uses COMPONENT_VALUE results
    for (auto* layoutChild : layoutChildren) {
        LTRACE("  processing layout child opcode=%d\n", layoutChild->opcode());

        // Run data operations before layout
        context.setMode(ContextMode::DATA);
        applyDataOps(layoutChild, context);
        context.setMode(ContextMode::PAINT);

        // Pass 1: Measure and layout to establish component dimensions
        LTRACE("  measure maxW=%.0f maxH=%.0f\n", maxW, maxH);
        measureComponent(layoutChild, pc, context, 0, maxW, 0, maxH, measure);

        int cid = getComponentId(layoutChild);
        auto& cm = measure.get(cid);
        LTRACE("  measured: cid=%d w=%.1f h=%.1f\n", cid, cm.w, cm.h);

        // Layout (LayoutCompute modifiers run here, but COMPONENT_VALUE may not be set yet)
        layoutComponent(layoutChild, context, measure);

        // Store measured dimensions in context for COMPONENT_VALUE resolution
        storeMeasuredDimensions(layoutChild, context, measure);

        // Re-run DATA pass so COMPONENT_VALUE ops load actual dimensions
        context.setMode(ContextMode::DATA);
        applyDataOps(layoutChild, context);
        context.setMode(ContextMode::PAINT);

        // Pass 2: Re-layout now that COMPONENT_VALUE variables have correct dimensions.
        // This allows LayoutCompute expressions that reference COMPONENT_VALUE to work.
        layoutComponent(layoutChild, context, measure);
        storeMeasuredDimensions(layoutChild, context, measure);
    }

    // Paint all layout children
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
    auto& ls = getLS(this);
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
    float fromVal = Utils::isVariable(from) ? context.getFloat(Utils::idFromNan(from)) : from;
    float stepVal = Utils::isVariable(step) ? context.getFloat(Utils::idFromNan(step)) : step;
    float untilVal = Utils::isVariable(until) ? context.getFloat(Utils::idFromNan(until)) : until;

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
    // TS ConditionalOperations only operates during PAINT (via paint() method)
    // No apply() override in TS, so DATA mode does nothing
    if (context.getMode() != ContextMode::PAINT) return;

    // Update children's variables first (TS does this before evaluating condition)
    for (auto& child : mChildren) {
        if (child->isVariableSupport()) {
            child->updateVariables(context);
        }
    }

    float aVal = Utils::isVariable(a) ? context.getFloat(Utils::idFromNan(a)) : a;
    float bVal = Utils::isVariable(b) ? context.getFloat(Utils::idFromNan(b)) : b;

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
