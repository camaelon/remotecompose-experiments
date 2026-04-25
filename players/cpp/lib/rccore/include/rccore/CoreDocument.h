#pragma once
#include "rccore/Operation.h"
#include "rccore/RemoteContext.h"
#include <vector>
#include <memory>

namespace rccore {

class WireBuffer;

class CoreDocument {
public:
    static constexpr int DOCUMENT_API_LEVEL = 8;

    CoreDocument() = default;

    // Parse from binary
    bool initFromBuffer(WireBuffer& buffer);

    // Register variable listeners (call once after initFromBuffer)
    void registerListeners(RemoteContext& context);

    // Two-pass execution
    // theme: -1=UNSPECIFIED (no filtering), -3=LIGHT, -2=DARK
    void applyDataOperations(RemoteContext& context, int theme = -3);
    void paint(RemoteContext& context, int theme = -3);

    // Time variables: populate system time variables into context.
    // If fixedTimeMs > 0, use that epoch-millis instead of real clock.
    void updateTimeVariables(RemoteContext& context);

    // Set a fixed time (epoch milliseconds) for deterministic rendering.
    // 0 = use real system clock.
    void setFixedTimeMs(int64_t ms) { mFixedTimeMs = ms; }

    // Touch dispatch — routes events to registered TouchListener operations
    void touchDown(RemoteContext& context, float x, float y);
    void touchDrag(RemoteContext& context, float x, float y);
    void touchUp(RemoteContext& context, float x, float y, float dx, float dy);

    // Accessors
    int getWidth() const { return mWidth; }
    int getHeight() const { return mHeight; }
    void setWidth(int w) { mWidth = w; }
    void setHeight(int h) { mHeight = h; }
    const std::vector<std::unique_ptr<Operation>>& getOperations() const { return mOperations; }

    // Content behavior (set by RootContentBehavior operation)
    void setRootContentBehavior(int scroll, int alignment, int sizing, int mode) {
        mContentScroll = scroll;
        mContentAlignment = alignment;
        mContentSizing = sizing;
        mContentMode = mode;
    }

    // Content sizing/scale constants (matching Java RootContentBehavior)
    static constexpr int SIZING_SCALE = 2;
    static constexpr int SCALE_INSIDE = 1;
    static constexpr int SCALE_FILL_WIDTH = 2;
    static constexpr int SCALE_FILL_HEIGHT = 3;
    static constexpr int SCALE_FIT = 4;
    static constexpr int SCALE_CROP = 5;
    static constexpr int SCALE_FILL_BOUNDS = 6;
    static constexpr int ALIGNMENT_TOP = 1;
    static constexpr int ALIGNMENT_VERTICAL_CENTER = 2;
    static constexpr int ALIGNMENT_BOTTOM = 4;
    static constexpr int ALIGNMENT_START = 0x10;
    static constexpr int ALIGNMENT_HORIZONTAL_CENTER = 0x20;
    static constexpr int ALIGNMENT_END = 0x40;

private:
    void applyOperations(RemoteContext& context,
                         std::vector<std::unique_ptr<Operation>>& ops,
                         int theme = -3);
    void registerListenersRecursive(RemoteContext& context,
                                     std::vector<std::unique_ptr<Operation>>& ops);
    void computeScale(float w, float h, float* scaleOutput);
    void computeTranslate(float w, float h, float sx, float sy, float* translateOutput);

    std::vector<std::unique_ptr<Operation>> mOperations;
    int mWidth = 600;
    int mHeight = 600;
    int mMajorVersion = 0;
    int mMinorVersion = 0;
    int mPatchVersion = 0;
    int64_t mCapabilities = 0;
    int64_t mFixedTimeMs = 0;
    int mContentScroll = 0;
    int mContentAlignment = 0;
    int mContentSizing = 0;
    int mContentMode = 0;
};

} // namespace rccore
