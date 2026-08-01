#include "rccore/CoreDocument.h"
#include "rccore/WireBuffer.h"
#include "rccore/Operations.h"
#include "rccore/PaintContext.h"
#include "rccore/operations/Header.h"
#include "rccore/operations/DrawOperations.h"
#include "rccore/operations/AdvancedOperations.h"
#include "rccore/operations/LayoutOperations.h"
#include <stdexcept>
#include <chrono>
#include <ctime>
#include <cmath>

namespace rccore {

// Theme constants (matching Java Theme class)
static constexpr int THEME_UNSPECIFIED = -1;
static constexpr int THEME_DARK = -2;
static constexpr int THEME_LIGHT = -3;

bool CoreDocument::initFromBuffer(WireBuffer& buffer) {
    Operations::init();
    mOperations.clear();

    // Stack of container operations being built
    std::vector<Operation*> containerStack;

    while (buffer.available()) {
        int opcode = buffer.readByte();

        // ContainerEnd pops the stack
        if (opcode == 214) { // CONTAINER_END
            if (!containerStack.empty()) {
                containerStack.pop_back();
            }
            continue;
        }

        auto reader = Operations::getReader(opcode);
        if (!reader) {
            // Unknown opcode - skip to end
            return false;
        }

        // Read the operation into a temp vector
        std::vector<std::unique_ptr<Operation>> temp;
        reader(buffer, temp);

        for (auto& op : temp) {
            bool isContainer = op->isContainer();
            Operation* rawPtr = op.get();

            if (containerStack.empty()) {
                mOperations.push_back(std::move(op));
            } else {
                containerStack.back()->addChild(std::move(op));
            }

            if (isContainer) {
                containerStack.push_back(rawPtr);
            }
        }
    }

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
        }
    }
    return true;
}

// ── Listener registration ─────────────────────────────────────────────

void CoreDocument::registerListeners(RemoteContext& context) {
    context.clearListeners();
    registerListenersRecursive(context, mOperations);
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
    if (mFixedTimeMs > 0) {
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
}

// ── Data pass ─────────────────────────────────────────────────────────

void CoreDocument::applyDataOperations(RemoteContext& context, int theme) {
    context.setMode(ContextMode::DATA);
    context.setTheme(THEME_UNSPECIFIED);
    context.setPaintTheme(theme);
    context.loadFloat(RemoteContext::ID_WINDOW_WIDTH, context.mWidth);
    context.loadFloat(RemoteContext::ID_WINDOW_HEIGHT, context.mHeight);
    context.loadFloat(RemoteContext::ID_DENSITY, context.mDensity);
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

void CoreDocument::touchDown(RemoteContext& context, float x, float y) {
    context.loadFloat(RemoteContext::ID_TOUCH_POS_X, x);
    context.loadFloat(RemoteContext::ID_TOUCH_POS_Y, y);
    for (auto* op : context.getTouchListeners()) {
        auto* touch = dynamic_cast<TouchExpressionOp*>(op);
        if (touch) {
            touch->touchDown(context, x, y);
        }
    }
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

static bool onClickRecursive(RemoteContext& context, const std::vector<std::unique_ptr<Operation>>& ops, float x, float y, float parentX, float parentY) {
    for (auto it = ops.rbegin(); it != ops.rend(); ++it) {
        const auto& op = *it;
        int cid = op->getOpComponentId();
        if (cid != -1) {
            auto* dim = context.getComponentDimension(cid);
            if (dim) {
                float absX = parentX + dim->x;
                float absY = parentY + dim->y;
                printf("[CLICK] LayoutComponent cid=%d name=%s pos(%.1f, %.1f) size(%.1f, %.1f) target(%.1f, %.1f)\n",
                       cid, op->name().c_str(), absX, absY, dim->w, dim->h, x, y);
                
                // Check children first (back to front)
                if (!op->mChildren.empty()) {
                    if (onClickRecursive(context, op->mChildren, x, y, absX, absY)) {
                        return true;
                    }
                }
                
                // Check component bounds
                if (x >= absX && x <= absX + dim->w && y >= absY && y <= absY + dim->h) {
                    printf("[CLICK] Bounds Matched for cid=%d!\n", cid);
                    for (const auto& child : op->mChildren) {
                        if (child->opcode() == 59) { // MODIFIER_CLICK
                            printf("[CLICK] Executing MODIFIER_CLICK for cid=%d\n", cid);
                            for (const auto& action : child->mChildren) {
                                printf("[CLICK] Applying action %s\n", action->name().c_str());
                                action->apply(context);
                            }
                            context.needsRepaint();
                            return true;
                        } else if (child->opcode() == 83) { // MODIFIER_MULTI_CLICK
                            auto* mc = dynamic_cast<ModifierMultiClick*>(child.get());
                            if (mc && mc->clickType == 0) {
                                printf("[CLICK] Executing MODIFIER_MULTI_CLICK single-click for cid=%d\n", cid);
                                for (const auto& action : child->mChildren) {
                                    printf("[CLICK] Applying action %s\n", action->name().c_str());
                                    action->apply(context);
                                }
                                context.needsRepaint();
                                return true;
                            }
                        }
                    }
                }
            } else {
                printf("[CLICK] LayoutComponent cid=%d has NO dimensions cached!\n", cid);
            }
        } else {
            if (!op->mChildren.empty()) {
                if (onClickRecursive(context, op->mChildren, x, y, parentX, parentY)) {
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
        printf("[CLICK] SIZING_SCALE: win(%.1f, %.1f) doc(%.1f, %.1f) sw=%.3f sh=%.3f tx=%.1f ty=%.1f\n",
               windowX, windowY, docX, docY, sw, sh, translateOutput[0], translateOutput[1]);
    } else {
        if (context.mWidth > 0 && context.mHeight > 0) {
            docX = windowX * mWidth / context.mWidth;
            docY = windowY * mHeight / context.mHeight;
        }
        printf("[CLICK] OTHER: win(%.1f, %.1f) doc(%.1f, %.1f) docSize(%d, %d) winSize(%.1f, %.1f)\n",
               windowX, windowY, docX, docY, mWidth, mHeight, context.mWidth, context.mHeight);
    }

    for (const auto& area : mClickAreas) {
        printf("[CLICK] Checking ClickArea left=%.1f top=%.1f right=%.1f bottom=%.1f cdId=%d\n",
               area.left, area.top, area.right, area.bottom, area.id);
        if (docX >= area.left && docX <= area.right && docY >= area.top && docY <= area.bottom) {
            printf("[CLICK] ClickArea Matched! id=%d\n", area.id);
            return performClick(context, area.id, area.metadata);
        }
    }
    return onClickRecursive(context, mOperations, docX, docY, 0, 0);
}

static bool applyActionsRecursive(RemoteContext& context, const std::vector<std::unique_ptr<Operation>>& ops, int id) {
    for (const auto& op : ops) {
        int cid = op->getOpComponentId();
        if (cid == id) {
            for (const auto& child : op->mChildren) {
                if (child->opcode() == 59) { // MODIFIER_CLICK
                    for (const auto& action : child->mChildren) {
                        action->apply(context);
                    }
                } else if (child->opcode() == 83) { // MODIFIER_MULTI_CLICK
                    auto* mc = dynamic_cast<ModifierMultiClick*>(child.get());
                    if (mc && mc->clickType == 0) {
                        for (const auto& action : child->mChildren) {
                            action->apply(context);
                        }
                    }
                }
            }
            context.needsRepaint();
            return true;
        }

        if (!op->mChildren.empty()) {
            if (applyActionsRecursive(context, op->mChildren, id)) {
                return true;
            }
        }
    }
    return false;
}

bool CoreDocument::performClick(RemoteContext& context, int id, const std::string& metadata) {
    return applyActionsRecursive(context, mOperations, id);
}

} // namespace rccore
