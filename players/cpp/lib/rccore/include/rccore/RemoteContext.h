#pragma once
#include <cstdint>
#include <string>
#include <memory>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace rccore {

class PaintContext;
class CoreDocument;
class Operation;
class ShaderData;

enum class ContextMode { UNSET, DATA, PAINT };

class RemoteContext {
public:
    RemoteContext() = default;
    virtual ~RemoteContext() = default;

    // ── System variable IDs ──────────────────────────────────────────
    static constexpr int ID_CONTINUOUS_SEC      = 1;
    static constexpr int ID_TIME_IN_SEC         = 2;
    static constexpr int ID_TIME_IN_MIN         = 3;
    static constexpr int ID_TIME_IN_HR          = 4;
    static constexpr int ID_WINDOW_WIDTH        = 5;
    static constexpr int ID_WINDOW_HEIGHT       = 6;
    static constexpr int ID_COMPONENT_WIDTH     = 7;
    static constexpr int ID_COMPONENT_HEIGHT    = 8;
    static constexpr int ID_CALENDAR_MONTH      = 9;
    static constexpr int ID_OFFSET_TO_UTC       = 10;
    static constexpr int ID_WEEK_DAY            = 11;
    static constexpr int ID_DAY_OF_MONTH        = 12;
    static constexpr int ID_TOUCH_POS_X         = 13;
    static constexpr int ID_TOUCH_POS_Y         = 14;
    static constexpr int ID_TOUCH_VEL_X         = 15;
    static constexpr int ID_TOUCH_VEL_Y         = 16;
    static constexpr int ID_DENSITY             = 27;
    static constexpr int ID_API_LEVEL           = 28;
    static constexpr int ID_ANIMATION_TIME      = 30;
    static constexpr int ID_ANIMATION_DELTA_TIME = 31;
    static constexpr int ID_EPOCH_SECOND        = 32;
    static constexpr int ID_FONT_SIZE           = 33;
    static constexpr int ID_DAY_OF_YEAR         = 34;
    static constexpr int ID_YEAR                = 35;

    // Mode
    ContextMode getMode() const { return mMode; }
    void setMode(ContextMode mode) { mMode = mode; }

    // Dimensions
    float mWidth = 0;
    float mHeight = 0;

    // Display density (SDPI / 160). Default 1.0 (matching TS behavior when no DOC_DENSITY_AT_GENERATION).
    float mDensity = 1.0f;

    // Paint context
    void setPaintContext(PaintContext* pc) { mPaintContext = pc; }
    PaintContext* getPaintContext() { return mPaintContext; }

    // Animation time (seconds since animation start)
    float getAnimationTime() const { return getFloat(ID_ANIMATION_TIME); }

    // Signal that a repaint is needed (delegates to PaintContext)
    void needsRepaint();

    // Document
    void setDocument(CoreDocument* doc) { mDocument = doc; }
    CoreDocument* getDocument() { return mDocument; }

    // Theme (block filtering — set by ThemeOp to gate operations)
    int getTheme() const { return mTheme; }
    void setTheme(int theme) { mTheme = theme; }

    // Paint theme (color scheme — LIGHT=-3 or DARK=-2, used by ColorTheme)
    int getPaintTheme() const { return mPaintTheme; }
    void setPaintTheme(int theme) { mPaintTheme = theme; }

    // Debug
    int mDebug = 0;
    bool isVisualDebug() const { return mDebug == 2; }

    // ── Variable stores (with listener notification) ─────────────────

    void loadFloat(int id, float value) {
        mFloats[id] = value;
        mIntegers[id] = static_cast<int>(value);
        notifyListeners(id);
    }
    float getFloat(int id) const {
        auto it = mFloats.find(id);
        return it != mFloats.end() ? it->second : 0.0f;
    }

    void loadInteger(int id, int value) {
        mIntegers[id] = value;
        mFloats[id] = static_cast<float>(value);
        notifyListeners(id);
    }
    int getInteger(int id) const {
        auto it = mIntegers.find(id);
        return it != mIntegers.end() ? it->second : 0;
    }

    void loadLong(int id, int64_t value) {
        mLongs[id] = value;
        notifyListeners(id);
    }
    int64_t getLong(int id) const {
        auto it = mLongs.find(id);
        return it != mLongs.end() ? it->second : 0;
    }

    void loadBoolean(int id, bool value) {
        mBooleans[id] = value;
        notifyListeners(id);
    }
    bool getBoolean(int id) const {
        auto it = mBooleans.find(id);
        return it != mBooleans.end() ? it->second : false;
    }

    void loadColor(int id, int color) {
        if (mColorOverrides.count(id)) return;  // Don't overwrite themed colors
        mColors[id] = color;
        notifyListeners(id);
    }
    void overrideColor(int id, int color) {
        mColors[id] = color;
        mColorOverrides.insert(id);
        notifyListeners(id);
    }
    int getColor(int id) const {
        auto it = mColors.find(id);
        return it != mColors.end() ? it->second : 0;
    }

    // Register a named color variable and apply default system color if known
    void registerNamedColor(int id, const std::string& colorName);

    // Look up a default Material Design system color by name.
    // Returns true and sets outColor if found, false otherwise.
    static bool getDefaultSystemColor(const std::string& name, int& outColor);

    // Float list store (for expressions with array ops)
    void loadFloatList(int id, const std::vector<float>& data) { mFloatLists[id] = data; }
    const std::vector<float>* getFloatList(int id) const {
        auto it = mFloatLists.find(id);
        return it != mFloatLists.end() ? &it->second : nullptr;
    }
    std::vector<float>* getFloatListMutable(int id) {
        auto it = mFloatLists.find(id);
        return it != mFloatLists.end() ? &it->second : nullptr;
    }

    // Generic object store (for cross-operation references like ParticlesCreate → ParticlesLoop)
    void putObject(int id, Operation* op) { mObjects[id] = op; }
    Operation* getObject(int id) const {
        auto it = mObjects.find(id);
        return it != mObjects.end() ? it->second : nullptr;
    }

    // Object matrix store (for MatrixConstant/MatrixExpression → MatrixVectorMath)
    void putObjectMatrix(int id, const std::vector<float>& values) { mObjectMatrices[id] = values; }
    const std::vector<float>* getObjectMatrix(int id) const {
        auto it = mObjectMatrices.find(id);
        return it != mObjectMatrices.end() ? &it->second : nullptr;
    }

    // Text store (delegated to paint context for actual storage)
    void loadText(int id, const std::string& text);
    std::string getText(int id) const;

    // Bitmap store (delegated to paint context)
    void loadBitmap(int imageId, int widthAndType, int heightAndEncoding,
                    const std::vector<uint8_t>& data);

    // Bitmap dimension lookup (populated during loadBitmap)
    struct BitmapDim { int width = 0, height = 0; };
    const BitmapDim* getBitmapDim(int imageId) const {
        auto it = mBitmapDims.find(imageId);
        return it != mBitmapDims.end() ? &it->second : nullptr;
    }

    // Path store (delegated to paint context)
    void loadPathData(int instanceId, int winding, const std::vector<float>& path);
    void appendPathData(int instanceId, const std::vector<float>& path);

    // Shader store
    void loadShader(int id, ShaderData* shader) { mShaders[id] = shader; }
    ShaderData* getShader(int id) const {
        auto it = mShaders.find(id);
        return it != mShaders.end() ? it->second : nullptr;
    }

    // Document load time (epoch milliseconds, used by TimeAttribute)
    int64_t getDocLoadTime() const { return mDocLoadTime; }
    void setDocLoadTime(int64_t millis) { mDocLoadTime = millis; }

    // Header
    void header(int majorVersion, int minorVersion, int patchVersion,
                int width, int height, int64_t capabilities);

    // Component dimension storage (for COMPONENT_VALUE resolution after layout)
    struct ComponentDim { float w = 0, h = 0, x = 0, y = 0; };
    void setComponentDimension(int componentId, float w, float h, float x = 0, float y = 0) {
        mComponentDims[componentId] = {w, h, x, y};
    }
    const ComponentDim* getComponentDimension(int componentId) const {
        auto it = mComponentDims.find(componentId);
        return it != mComponentDims.end() ? &it->second : nullptr;
    }
    void clearComponentDimensions() { mComponentDims.clear(); }

    // ── Variable listener system ─────────────────────────────────────

    // Register that 'op' depends on variable 'variableId'.
    // When that variable changes, op will be marked dirty.
    void listensTo(int variableId, Operation* op);

    // Check whether any operation listens to a given variable ID.
    bool hasListeners(int variableId) const {
        auto it = mVarListeners.find(variableId);
        return it != mVarListeners.end() && !it->second.empty();
    }

    // Clear all listener registrations (for re-init).
    void clearListeners() { mVarListeners.clear(); mTouchListeners.clear(); }

    // ── Touch listener system ────────────────────────────────────────
    void addTouchListener(Operation* op) { mTouchListeners.push_back(op); }
    const std::vector<Operation*>& getTouchListeners() const { return mTouchListeners; }

    // ── Repaint scheduling ───────────────────────────────────────────

    // Returns milliseconds until next repaint is needed, or -1 for no repaint.
    // 1 = repaint every frame (continuous animation).
    int getRepaintDelay() const;

    // Op count (safety)
    void incrementOpCount() { mOpCount++; }
    int getLastOpCount() { int c = mOpCount; mOpCount = 0; return c; }

private:
    void notifyListeners(int variableId);

    ContextMode mMode = ContextMode::UNSET;
    PaintContext* mPaintContext = nullptr;
    CoreDocument* mDocument = nullptr;
    int mTheme = 0;
    int mPaintTheme = -3;  // Default LIGHT (matches Java/TS)
    int mOpCount = 0;
    int64_t mDocLoadTime = 0;

    std::unordered_map<int, float> mFloats;
    std::unordered_map<int, int> mIntegers;
    std::unordered_map<int, int64_t> mLongs;
    std::unordered_map<int, bool> mBooleans;
    std::unordered_map<int, int> mColors;
    std::unordered_set<int> mColorOverrides;  // IDs overridden by system theme defaults
    std::unordered_map<int, std::string> mTexts;
    std::unordered_map<int, std::vector<float>> mFloatLists;
    std::unordered_map<int, std::vector<float>> mObjectMatrices;
    std::unordered_map<int, Operation*> mObjects;
    std::unordered_map<int, ComponentDim> mComponentDims;
    std::unordered_map<int, ShaderData*> mShaders;
    std::unordered_map<int, BitmapDim> mBitmapDims;

    // Variable → list of operations listening to it
    std::unordered_map<int, std::vector<Operation*>> mVarListeners;

    // Operations registered as touch listeners (e.g. TouchExpressionOp)
    std::vector<Operation*> mTouchListeners;

public:
    // Current canvas/component bounds stack — pushed when entering a canvas,
    // popped when leaving. Touch expressions capture their bounds from here
    // during apply() to enable per-component hit-testing.
    // Canvas bounds for per-component touch hit-testing.
    // Tracks cumulative translation so touch (in window coords) maps to components.
    struct CanvasBounds { float x = 0, y = 0, w = 0, h = 0; };
    void pushCanvasBounds(float w, float h) {
        float x = mTranslateX;
        float y = mTranslateY;
        mCanvasBoundsStack.push_back({x, y, w, h});
    }
    void popCanvasBounds() {
        if (!mCanvasBoundsStack.empty()) mCanvasBoundsStack.pop_back();
    }
    const CanvasBounds& currentCanvasBounds() const {
        static const CanvasBounds defaultBounds{0, 0, 99999, 99999};
        return mCanvasBoundsStack.empty() ? defaultBounds : mCanvasBoundsStack.back();
    }

    // Cumulative translation tracking (updated by layout when offset/translate applied)
    float mTranslateX = 0, mTranslateY = 0;
    void pushTranslate(float dx, float dy) {
        mTranslateStack.push_back({mTranslateX, mTranslateY});
        mTranslateX += dx;
        mTranslateY += dy;
    }
    void popTranslate() {
        if (!mTranslateStack.empty()) {
            auto& prev = mTranslateStack.back();
            mTranslateX = prev.first;
            mTranslateY = prev.second;
            mTranslateStack.pop_back();
        }
    }
private:
    std::vector<CanvasBounds> mCanvasBoundsStack;
    std::vector<std::pair<float,float>> mTranslateStack;
};

} // namespace rccore
