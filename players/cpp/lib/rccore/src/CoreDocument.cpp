#include "rccore/CoreDocument.h"
#include "rccore/Loom.h"
#include "rccore/WireBuffer.h"
#include "rccore/Operations.h"
#include "rccore/PaintContext.h"
#include "rccore/operations/Header.h"
#include "rccore/operations/DrawOperations.h"
#include "rccore/operations/AdvancedOperations.h"
#include "rccore/operations/LayoutOperations.h"
#include "rccore/animation/LayoutAnimation.h"
#include "rccore/Utils.h"
#include <algorithm>
#include <stdexcept>
#include <chrono>
#include <ctime>
#include <cmath>
#include <cstdlib>
#include <cstdio>

namespace rccore {

// Theme constants (matching Java Theme class)
static constexpr int THEME_UNSPECIFIED = -1;
static constexpr int THEME_DARK = -2;
static constexpr int THEME_LIGHT = -3;

bool CoreDocument::initFromBuffer(WireBuffer& buffer) {
    Operations::init();
    mOperations.clear();
    // Re-init of this document: drop its layout-animation state so component ids
    // can't carry stale bounds and trigger spurious transitions. Other documents'
    // stores are theirs and are left alone.
    mAnimStore.clear();
    mScrollCaptures.clear();

    // CoreDocument.initFromBuffer: the id counter for pattern inflation starts 10 above the
    // largest VariableProvider id (from START_VARIABLE_ID + 1 = 43), so inflated ids are the
    // reference's exactly.
    int maxId = 43;
    if (!readOperationTree(buffer, mOperations, &maxId)) return false;
    mCurrentId = maxId + 10;

    // Expand every template call (Loom), as LoomManager.expandAll does after nesting.
    expandLoom(mOperations, *this);

    // Extract dimensions from header if present
    if (!mOperations.empty()) {
        auto* header = dynamic_cast<Header*>(mOperations[0].get());
        if (header) {
            mWidth = header->width;
            mHeight = header->height;
            mMajorVersion = header->majorVersion;
            mMinorVersion = header->minorVersion;
            mPatchVersion = header->patchVersion;
            mCapabilities = header->capabilities;
            // Header.DOC_DENSITY_BEHAVIOR
            auto db = header->headerMap.find(27);
            if (db != header->headerMap.end() && std::holds_alternative<int32_t>(db->second))
                mDensityBehavior = std::get<int32_t>(db->second);
        }
    }
    return true;
}

// ── Loom ───────────────────────────────────────────────────────────────

void CoreDocument::prunePatternDefinitions(
        std::vector<std::unique_ptr<Operation>>& ops) {
    for (auto& op : ops) {
        if (!op) continue;
        // 246 MACRO_DEFINE, 249 MACRO_BLOCK: bodies belong to a call site, not here.
        if (op->opcode() == 246 || op->opcode() == 249) {
            op->mChildren.clear();
            continue;
        }
        if (!op->mChildren.empty()) {
            prunePatternDefinitions(op->mChildren);
        }
    }
}

// ── Listener registration ─────────────────────────────────────────────

void CoreDocument::registerListeners(RemoteContext& context) {
    context.clearListeners();
    context.mDensityBehavior = mDensityBehavior;
    registerListenersRecursive(context, mOperations);
    if (!std::getenv("RC_NO_PAINT_ONLY")) context.classifyPaintOnlyVars();   // env: A/B the layout cache
}

void CoreDocument::registerListenersRecursive(
        RemoteContext& context, std::vector<std::unique_ptr<Operation>>& ops) {
    for (auto& op : ops) {
        if (op->isVariableSupport()) {
            op->registerListening(context);
        }
        // Recurse into container children
        if (!op->mChildren.empty()) {
            registerListenersRecursive(context, op->mChildren);
        }
    }
}

// ── Time variables ────────────────────────────────────────────────────

void CoreDocument::updateTimeVariables(RemoteContext& context) {
    int64_t ms;
    if (mFixedTimeMs >= 0) {
        ms = mFixedTimeMs;
    } else {
        ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                 std::chrono::system_clock::now().time_since_epoch()).count();
    }

    // Convert epoch-millis to local time components (matching TS RemoteClock)
    time_t sec = static_cast<time_t>(ms / 1000);
    int millisOfSecond = static_cast<int>(ms % 1000);
    struct tm local;
#ifdef _WIN32
    localtime_s(&local, &sec);
#else
    localtime_r(&sec, &local);
#endif

    int year = local.tm_year + 1900;
    int month = local.tm_mon + 1;           // 1-12
    int dayOfMonth = local.tm_mday;
    int hour = local.tm_hour;
    int minute = local.tm_min;
    int second = local.tm_sec;

    // Day of week: Java 1=Monday..7=Sunday; tm_wday 0=Sunday..6=Saturday
    int dayOfWeek = local.tm_wday == 0 ? 7 : local.tm_wday;

    // Day of year (1-based)
    int dayOfYear = local.tm_yday + 1;

    // UTC offset in seconds
    // tm_gmtoff is seconds east of UTC on most POSIX systems
#ifdef _WIN32
    long gmtoff = 0;
    _get_timezone(&gmtoff);
    gmtoff = -gmtoff;
#elif defined(ESP_PLATFORM)
    // newlib's struct tm has no tm_gmtoff; _timezone is seconds WEST of UTC (set by tzset).
    long gmtoff = -_timezone + (local.tm_isdst > 0 ? 3600 : 0);
#else
    long gmtoff = local.tm_gmtoff;
#endif

    float continuousSec = static_cast<float>(minute * 60 + second)
                        + millisOfSecond * 1E-3f;
    float timeInSec = static_cast<float>(minute * 60 + second);
    float timeInMin = static_cast<float>(hour * 60 + minute);

    context.loadFloat(RemoteContext::ID_OFFSET_TO_UTC, static_cast<float>(gmtoff));
    context.loadFloat(RemoteContext::ID_CONTINUOUS_SEC, continuousSec);
    context.loadInteger(RemoteContext::ID_EPOCH_SECOND, static_cast<int>(ms / 1000));
    context.loadFloat(RemoteContext::ID_TIME_IN_SEC, timeInSec);
    context.loadFloat(RemoteContext::ID_TIME_IN_MIN, timeInMin);
    context.loadFloat(RemoteContext::ID_TIME_IN_HR, static_cast<float>(hour));
    context.loadFloat(RemoteContext::ID_CALENDAR_MONTH, static_cast<float>(month));
    context.loadFloat(RemoteContext::ID_DAY_OF_MONTH, static_cast<float>(dayOfMonth));
    context.loadFloat(RemoteContext::ID_WEEK_DAY, static_cast<float>(dayOfWeek));
    context.loadFloat(RemoteContext::ID_DAY_OF_YEAR, static_cast<float>(dayOfYear));
    context.loadFloat(RemoteContext::ID_YEAR, static_cast<float>(year));
    context.loadFloat(RemoteContext::ID_API_LEVEL, static_cast<float>(DOCUMENT_API_LEVEL));

    // Animation time: seconds since the first frame, not since the epoch. This is what the
    // reference player feeds in (RemoteComposeView computes (now - mStart) * 1e-9), and what a
    // document expects — it starts near zero and advances, so sin(animationTime) is a wave
    // rather than an arbitrary phase.
    //
    // Always written, never guarded. A host that wants to drive the clock itself calls
    // overrideFloat, which makes these loads no-ops for the id; guarding on "has someone set
    // this yet" instead would latch on the first frame and freeze time.
    if (mAnimationStartMs < 0) {
        mAnimationStartMs = ms;
    }
    float animationTime = static_cast<float>(ms - mAnimationStartMs) / 1000.0f;
    context.loadFloat(RemoteContext::ID_ANIMATION_TIME, animationTime);
    context.loadFloat(RemoteContext::ID_ANIMATION_DELTA_TIME,
                      animationTime - mLastAnimationTime);
    mLastAnimationTime = animationTime;
}

// ── Data pass ─────────────────────────────────────────────────────────

void CoreDocument::applyDataOperations(RemoteContext& context, int theme) {
    context.setMode(ContextMode::DATA);
    context.setTheme(THEME_UNSPECIFIED);
    context.setPaintTheme(theme);
    context.loadFloat(RemoteContext::ID_WINDOW_WIDTH, context.mWidth);
    context.loadFloat(RemoteContext::ID_WINDOW_HEIGHT, context.mHeight);
    context.loadFloat(RemoteContext::ID_DENSITY, context.mDensity);
    context.mDensityBehavior = mDensityBehavior;
    context.loadFloat(RemoteContext::ID_FONT_SIZE, 14.0f * context.mDensity);
    updateTimeVariables(context);
    applyOperations(context, mOperations, theme);
    context.setMode(ContextMode::UNSET);
}

// ── Paint pass ────────────────────────────────────────────────────────

void CoreDocument::paint(RemoteContext& context, int theme) {
    mClickAreas.clear();
    auto* pc = context.getPaintContext();
    if (!pc) return;

    pc->clearNeedsRepaint();
    pc->reset();

    // DATA pass: re-evaluate dirty data operations
    context.setMode(ContextMode::DATA);
    context.setTheme(THEME_UNSPECIFIED);
    context.setPaintTheme(theme);
    // When content scaling is active, expressions must use the document's intrinsic
    // dimensions so the canvas scale transform correctly maps content to the window.
    // This matches Java where setWidth() (which updates WINDOW_WIDTH) is only called
    // in the non-scaling branch.
    if (mContentSizing == SIZING_SCALE) {
        context.loadFloat(RemoteContext::ID_WINDOW_WIDTH, static_cast<float>(mWidth));
        context.loadFloat(RemoteContext::ID_WINDOW_HEIGHT, static_cast<float>(mHeight));
    } else {
        context.loadFloat(RemoteContext::ID_WINDOW_WIDTH, context.mWidth);
        context.loadFloat(RemoteContext::ID_WINDOW_HEIGHT, context.mHeight);
    }
    updateTimeVariables(context);
    applyOperations(context, mOperations, theme);
    context.setMode(ContextMode::UNSET);

    // PAINT pass: execute paint operations
    context.setMode(ContextMode::PAINT);
    context.setTheme(THEME_UNSPECIFIED);
    context.setPaintTheme(theme);

    // Save canvas state so content scaling transforms don't accumulate across frames
    pc->matrixSave();

    // Content scaling: if SIZING_SCALE, apply translate + scale before painting
    if (mContentSizing == SIZING_SCALE) {
        float scaleOutput[2] = {1.0f, 1.0f};
        computeScale(context.mWidth, context.mHeight, scaleOutput);
        float sw = scaleOutput[0];
        float sh = scaleOutput[1];
        float translateOutput[2] = {0.0f, 0.0f};
        computeTranslate(context.mWidth, context.mHeight, sw, sh, translateOutput);
        pc->matrixTranslate(translateOutput[0], translateOutput[1]);
        pc->matrixScale(sw, sh, 0.0f, 0.0f);
    } else {
        mWidth = static_cast<int>(context.mWidth);
        mHeight = static_cast<int>(context.mHeight);
    }

    applyOperations(context, mOperations, theme);

    // Restore canvas state
    pc->matrixRestore();
    context.setMode(ContextMode::UNSET);
}

// ── Operation dispatch ────────────────────────────────────────────────

void CoreDocument::applyOperations(RemoteContext& context,
                                    std::vector<std::unique_ptr<Operation>>& ops,
                                    int theme) {
    for (auto& op : ops) {
        // Theme filtering
        bool shouldApply = true;
        if (theme != THEME_UNSPECIFIED) {
            int currentTheme = context.getTheme();
            bool isThemeOp = (dynamic_cast<ThemeOp*>(op.get()) != nullptr);
            shouldApply = isThemeOp
                       || currentTheme == theme
                       || currentTheme == THEME_UNSPECIFIED;
        }

        if (shouldApply) {
            // If the operation supports variables and is dirty, update cached values
            if (op->isVariableSupport() && op->isDirty()) {
                op->updateVariables(context);
            }
            context.incrementOpCount();
            op->apply(context);
            op->markNotDirty();
        }
    }
}

// ── Touch dispatch ────────────────────────────────────────────────────

// Where a component's children sit, in the coordinates of its own origin: inside its
// padding, shifted by its scroll as paintComponent translates them (the position variable
// when the scroll is document-driven, the modifier's own drag offset otherwise). Java's
// getLocationInWindow(forSelf=false) adds getScrollX/Y for the same reason; without the
// scroll, taps on a scrolled list landed on the items that were there before the scroll.
static void childOrigin(RemoteContext& context, const Operation* op,
                        const RemoteContext::ComponentDim* dim, float& ox, float& oy) {
    if (!dim) return;
    ox += dim->padX;
    oy += dim->padY;
    for (const auto& child : op->mChildren) {
        if (child->opcode() != Operations::MODIFIER_SCROLL) continue;
        auto* s = static_cast<const ModifierScroll*>(child.get());
        float pos = Utils::isVariable(s->position)
                ? context.getFloat(Utils::idFromNan(s->position)) : s->scrollOffset;
        if (s->direction == 0) oy -= pos; else ox -= pos;
    }
}

static bool rippleRecursive(RemoteContext& context, const std::vector<std::unique_ptr<Operation>>& ops,
                            float x, float y, float parentX, float parentY);

// Every visible component under (x, y) whose scroll modifier has a constant position takes
// the touch, as Component.onTouchDown hands it to each TouchHandler of each component that
// contains the point. A variable position is scrolled by its TouchExpression instead.
static void collectScrollTargets(RemoteContext& context,
                                 const std::vector<std::unique_ptr<Operation>>& ops,
                                 float x, float y, float parentX, float parentY,
                                 std::vector<ModifierScroll*>& out) {
    for (const auto& op : ops) {
        int cid = op->getOpComponentId();
        const RemoteContext::ComponentDim* dim = cid != -1 ? context.getComponentDimension(cid) : nullptr;
        if (cid != -1 && !dim) continue;
        if (dim && !dim->visible) continue;
        float absX = dim ? parentX + dim->x : parentX, absY = dim ? parentY + dim->y : parentY;
        if (dim && x >= absX && x <= absX + dim->w && y >= absY && y <= absY + dim->h) {
            for (const auto& child : op->mChildren) {
                if (child->opcode() != Operations::MODIFIER_SCROLL) continue;
                auto* s = static_cast<ModifierScroll*>(child.get());
                if (!Utils::isVariable(s->position)) out.push_back(s);
            }
        }
        if (!op->mChildren.empty()) {
            float ox = absX, oy = absY;
            childOrigin(context, op.get(), dim, ox, oy);
            collectScrollTargets(context, op->mChildren, x, y, ox, oy, out);
        }
    }
}

void CoreDocument::touchDown(RemoteContext& context, float x, float y) {
    context.loadFloat(RemoteContext::ID_TOUCH_POS_X, x);
    context.loadFloat(RemoteContext::ID_TOUCH_POS_Y, y);
    for (auto* op : context.getTouchListeners()) {
        auto* touch = dynamic_cast<TouchExpressionOp*>(op);
        if (touch) {
            touch->touchDown(context, x, y);
        }
    }
    mScrollCaptures.clear();
    collectScrollTargets(context, mOperations, x, y, 0, 0, mScrollCaptures);
    for (auto* s : mScrollCaptures) {
        s->touching = true;
        s->touchDownX = x;
        s->touchDownY = y;
        s->initialScroll = s->scrollOffset;
    }
    rippleRecursive(context, mOperations, x, y, 0, 0);
}

// The topmost visible component under (x, y) that carries a ripple starts one there — the
// reference's RippleModifierOperation.onTouchDown. Same walk as onClickRecursive.
static bool rippleRecursive(RemoteContext& context, const std::vector<std::unique_ptr<Operation>>& ops,
                            float x, float y, float parentX, float parentY) {
    for (auto it = ops.rbegin(); it != ops.rend(); ++it) {
        const auto& op = *it;
        int cid = op->getOpComponentId();
        const RemoteContext::ComponentDim* dim = cid != -1 ? context.getComponentDimension(cid) : nullptr;
        if (cid != -1 && !dim) continue;
        if (dim && !dim->visible) continue;
        float absX = dim ? parentX + dim->x : parentX, absY = dim ? parentY + dim->y : parentY;
        float ox = absX, oy = absY;
        childOrigin(context, op.get(), dim, ox, oy);
        if (!op->mChildren.empty() && rippleRecursive(context, op->mChildren, x, y, ox, oy))
            return true;
        if (!dim || x < absX || x > absX + dim->w || y < absY || y > absY + dim->h) continue;
        for (const auto& child : op->mChildren) {
            if (child->opcode() == Operations::MODIFIER_RIPPLE) {
                auto* r = static_cast<ModifierRipple*>(child.get());
                r->start = context.getFloat(RemoteContext::ID_ANIMATION_TIME);
                r->x = x - absX;
                r->y = y - absY;
                context.needsRepaint();
                return true;
            }
        }
    }
    return false;
}

void CoreDocument::touchDrag(RemoteContext& context, float x, float y) {
    context.loadFloat(RemoteContext::ID_TOUCH_POS_X, x);
    context.loadFloat(RemoteContext::ID_TOUCH_POS_Y, y);
    for (auto* op : context.getTouchListeners()) {
        auto* touch = dynamic_cast<TouchExpressionOp*>(op);
        if (touch) {
            touch->touchDrag(context, x, y);
        }
    }
    // ScrollModifierOperation.onTouchDrag: mScrollY = max(-maxY, min(0, initial + dy)).
    for (auto* s : mScrollCaptures) {
        if (!s->touching) continue;
        float d = s->direction == 0 ? y - s->touchDownY : x - s->touchDownX;
        s->scrollOffset = std::max(0.0f, std::min(s->maxScroll, s->initialScroll - d));
        context.needsRepaint();
    }
}

void CoreDocument::touchUp(RemoteContext& context, float x, float y,
                            float dx, float dy) {
    context.loadFloat(RemoteContext::ID_TOUCH_POS_X, x);
    context.loadFloat(RemoteContext::ID_TOUCH_POS_Y, y);
    context.loadFloat(RemoteContext::ID_TOUCH_VEL_X, dx);
    context.loadFloat(RemoteContext::ID_TOUCH_VEL_Y, dy);
    for (auto* op : context.getTouchListeners()) {
        auto* touch = dynamic_cast<TouchExpressionOp*>(op);
        if (touch) {
            touch->touchUp(context, x, y, dx, dy);
        }
    }
    for (auto* s : mScrollCaptures) s->touching = false;
    mScrollCaptures.clear();
}

// ── Content scaling ──────────────────────────────────────────────────

void CoreDocument::computeScale(float w, float h, float* scaleOutput) {
    float contentScaleX = 1.0f;
    float contentScaleY = 1.0f;
    if (mContentSizing == SIZING_SCALE) {
        float scaleX, scaleY, scale;
        switch (mContentMode) {
            case SCALE_INSIDE:
                scaleX = w / mWidth;
                scaleY = h / mHeight;
                scale = std::min(1.0f, std::min(scaleX, scaleY));
                contentScaleX = scale;
                contentScaleY = scale;
                break;
            case SCALE_FIT:
                scaleX = w / mWidth;
                scaleY = h / mHeight;
                scale = std::min(scaleX, scaleY);
                contentScaleX = scale;
                contentScaleY = scale;
                break;
            case SCALE_FILL_WIDTH:
                scale = w / mWidth;
                contentScaleX = scale;
                contentScaleY = scale;
                break;
            case SCALE_FILL_HEIGHT:
                scale = h / mHeight;
                contentScaleX = scale;
                contentScaleY = scale;
                break;
            case SCALE_CROP:
                scaleX = w / mWidth;
                scaleY = h / mHeight;
                scale = std::max(scaleX, scaleY);
                contentScaleX = scale;
                contentScaleY = scale;
                break;
            case SCALE_FILL_BOUNDS:
                contentScaleX = w / mWidth;
                contentScaleY = h / mHeight;
                break;
        }
    }
    scaleOutput[0] = contentScaleX;
    scaleOutput[1] = contentScaleY;
}

void CoreDocument::computeTranslate(float w, float h,
                                     float contentScaleX, float contentScaleY,
                                     float* translateOutput) {
    int horizontalContentAlignment = mContentAlignment & 0xF0;
    int verticalContentAlignment = mContentAlignment & 0xF;
    float translateX = 0.0f;
    float translateY = 0.0f;
    float contentWidth = mWidth * contentScaleX;
    float contentHeight = mHeight * contentScaleY;

    switch (horizontalContentAlignment) {
        case ALIGNMENT_START:
            break;
        case ALIGNMENT_HORIZONTAL_CENTER:
            translateX = (w - contentWidth) / 2.0f;
            break;
        case ALIGNMENT_END:
            translateX = w - contentWidth;
            break;
    }
    switch (verticalContentAlignment) {
        case ALIGNMENT_TOP:
            break;
        case ALIGNMENT_VERTICAL_CENTER:
            translateY = (h - contentHeight) / 2.0f;
            break;
        case ALIGNMENT_BOTTOM:
            translateY = h - contentHeight;
            break;
    }

    translateOutput[0] = translateX;
    translateOutput[1] = translateY;
}

void CoreDocument::addClickArea(int id, const std::string& contentDescription, float left, float top, float right, float bottom, const std::string& metadata) {
    mClickAreas.push_back({id, contentDescription, left, top, right, bottom, metadata});
}

// The states of a StateLayout, in order (its layout-component children, through a content
// wrapper), and whether `op` is one of them other than the shown one: StateLayout.onClick
// hands a click to the current state only. The test matters when states share ids, as then
// they share one set of bounds.
static void collectStates(Operation* op, std::vector<Operation*>& out) {
    for (auto& c : op->mChildren) {
        if (c->opcode() == 201) collectStates(c.get(), out);
        else if (c->getOpComponentId() != -1) out.push_back(c.get());
    }
}

static bool isHiddenState(Operation* parent, Operation* op) {
    if (!parent || parent->opcode() != 217) return false;
    std::vector<Operation*> states;
    collectStates(parent, states);
    if (states.empty()) return false;
    int idx = static_cast<StateLayout*>(parent)->measuredIndex;
    Operation* cur = idx >= 0 && idx < (int)states.size() ? states[idx] : states[0];
    return std::find(states.begin(), states.end(), op) != states.end() && op != cur;
}

static bool onClickRecursive(RemoteContext& context, const std::vector<std::unique_ptr<Operation>>& ops, float x, float y, float parentX, float parentY, Operation* parent = nullptr) {
    for (auto it = ops.rbegin(); it != ops.rend(); ++it) {
        const auto& op = *it;
        if (isHiddenState(parent, op.get())) continue;
        int cid = op->getOpComponentId();
        if (cid != -1) {
            auto* dim = context.getComponentDimension(cid);
            if (dim && !dim->visible) continue;     // GONE / INVISIBLE: neither it nor its children
            if (dim) {
                float absX = parentX + dim->x;
                float absY = parentY + dim->y;
                
                // Component.onClick: a tap outside this component reaches none of its
                // children (a scrolled-away row is not hit through what covers it).
                if (x < absX || x > absX + dim->w || y < absY || y > absY + dim->h) continue;

                // Children first (back to front), from their origin: inside this one's
                // padding and shifted by its scroll.
                if (!op->mChildren.empty()) {
                    float ox = absX, oy = absY;
                    childOrigin(context, op.get(), dim, ox, oy);
                    if (onClickRecursive(context, op->mChildren, x, y, ox, oy, op.get())) {
                        return true;
                    }
                }

                {
                    for (const auto& child : op->mChildren) {
                        if (child->opcode() == 59) { // MODIFIER_CLICK
                            // ClickModifierOperation.onClick: a ripple from the click point
                            // when animations are on, then the actions.
                            if (isLayoutAnimationEnabled()) {
                                auto* c = static_cast<ModifierClick*>(child.get());
                                c->rippleStart = context.getFloat(RemoteContext::ID_ANIMATION_TIME);
                                c->rippleX = x - absX;
                                c->rippleY = y - absY;
                            }
                            for (const auto& action : child->mChildren) {
                                action->runAction(context, x, y);
                            }
                            context.needsRepaint();
                            return true;
                        } else if (child->opcode() == 83) { // MODIFIER_MULTI_CLICK
                            auto* mc = dynamic_cast<ModifierMultiClick*>(child.get());
                            if (mc && mc->clickType == 0) {
                                if (isLayoutAnimationEnabled()) {
                                    mc->rippleStart = context.getFloat(RemoteContext::ID_ANIMATION_TIME);
                                    mc->rippleX = x - absX;
                                    mc->rippleY = y - absY;
                                }
                                for (const auto& action : child->mChildren) {
                                    action->runAction(context, x, y);
                                }
                                context.needsRepaint();
                                return true;
                            }
                        }
                    }
                }
            } else {
            }
        } else {
            if (!op->mChildren.empty()) {
                if (onClickRecursive(context, op->mChildren, x, y, parentX, parentY, parent)) {
                    return true;
                }
            }
        }
    }
    return false;
}

bool CoreDocument::onClick(RemoteContext& context, float windowX, float windowY) {
    float docX = windowX;
    float docY = windowY;

    if (mContentSizing == SIZING_SCALE) {
        float scaleOutput[2] = {1.0f, 1.0f};
        computeScale(context.mWidth, context.mHeight, scaleOutput);
        float sw = scaleOutput[0];
        float sh = scaleOutput[1];
        float translateOutput[2] = {0.0f, 0.0f};
        computeTranslate(context.mWidth, context.mHeight, sw, sh, translateOutput);

        if (sw != 0.0f && sh != 0.0f) {
            docX = (windowX - translateOutput[0]) / sw;
            docY = (windowY - translateOutput[1]) / sh;
        }
    } else {
        if (context.mWidth > 0 && context.mHeight > 0) {
            docX = windowX * mWidth / context.mWidth;
            docY = windowY * mHeight / context.mHeight;
        }
    }

    for (const auto& area : mClickAreas) {
        if (docX >= area.left && docX <= area.right && docY >= area.top && docY <= area.bottom) {
            return performClick(context, area.id, area.metadata);
        }
    }
    return onClickRecursive(context, mOperations, docX, docY, 0, 0);
}

static bool applyActionsRecursive(RemoteContext& context,
                                  const std::vector<std::unique_ptr<Operation>>& ops,
                                  int id, float x, float y) {
    for (const auto& op : ops) {
        int cid = op->getOpComponentId();
        if (cid == id) {
            for (const auto& child : op->mChildren) {
                if (child->opcode() == 59) { // MODIFIER_CLICK
                    for (const auto& action : child->mChildren) {
                        action->runAction(context, x, y);
                    }
                } else if (child->opcode() == 83) { // MODIFIER_MULTI_CLICK
                    auto* mc = dynamic_cast<ModifierMultiClick*>(child.get());
                    if (mc && mc->clickType == 0) {
                        for (const auto& action : child->mChildren) {
                            action->runAction(context, x, y);
                        }
                    }
                }
            }
            context.needsRepaint();
            return true;
        }

        if (!op->mChildren.empty()) {
            if (applyActionsRecursive(context, op->mChildren, id, x, y)) {
                return true;
            }
        }
    }
    return false;
}

bool CoreDocument::performClick(RemoteContext& context, int id, const std::string& metadata) {
    // A click area names a component rather than a point, so the actions get the area's
    // centre as their coordinates.
    for (const auto& area : mClickAreas) {
        if (area.id == id) {
            return applyActionsRecursive(context, mOperations, id,
                                         (area.left + area.right) * 0.5f,
                                         (area.top + area.bottom) * 0.5f);
        }
    }
    return applyActionsRecursive(context, mOperations, id, 0.0f, 0.0f);
}

} // namespace rccore
