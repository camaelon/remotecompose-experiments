#pragma once
#include <cstdint>
#include <vector>
#include <string>
#include <cstring>
#include <cmath>

namespace rccore {

class WireBuffer;
class RemoteContext;
class Operation;

class PaintBundle {
public:
    // Paint tags
    static constexpr int TEXT_SIZE       = 1;
    static constexpr int COLOR           = 4;
    static constexpr int STROKE_WIDTH    = 5;
    static constexpr int STROKE_MITER    = 6;
    static constexpr int STROKE_CAP      = 7;
    static constexpr int STYLE           = 8;
    static constexpr int SHADER          = 9;
    static constexpr int IMAGE_FILTER_QUALITY = 10;
    static constexpr int GRADIENT        = 11;
    static constexpr int ALPHA           = 12;
    static constexpr int COLOR_FILTER    = 13;
    static constexpr int ANTI_ALIAS      = 14;
    static constexpr int STROKE_JOIN     = 15;
    static constexpr int TYPEFACE        = 16;
    static constexpr int FILTER_BITMAP   = 17;
    static constexpr int BLEND_MODE      = 18;
    static constexpr int COLOR_ID        = 19;
    static constexpr int COLOR_FILTER_ID = 20;
    static constexpr int CLEAR_COLOR_FILTER = 21;
    static constexpr int SHADER_MATRIX   = 22;
    static constexpr int FONT_AXIS       = 23;
    static constexpr int TEXTURE         = 24;
    static constexpr int PATH_EFFECT     = 25;
    static constexpr int FALLBACK_TYPEFACE = 26;

    // Blend modes
    static constexpr int BLEND_MODE_CLEAR      = 0;
    static constexpr int BLEND_MODE_SRC         = 1;
    static constexpr int BLEND_MODE_DST         = 2;
    static constexpr int BLEND_MODE_SRC_OVER    = 3;
    static constexpr int BLEND_MODE_DST_OVER    = 4;
    static constexpr int BLEND_MODE_SRC_IN      = 5;
    static constexpr int BLEND_MODE_DST_IN      = 6;
    static constexpr int BLEND_MODE_SRC_OUT     = 7;
    static constexpr int BLEND_MODE_DST_OUT     = 8;
    static constexpr int BLEND_MODE_SRC_ATOP    = 9;
    static constexpr int BLEND_MODE_DST_ATOP    = 10;
    static constexpr int BLEND_MODE_XOR         = 11;
    static constexpr int BLEND_MODE_PLUS        = 12;
    static constexpr int BLEND_MODE_MODULATE    = 13;
    static constexpr int BLEND_MODE_SCREEN      = 14;
    static constexpr int BLEND_MODE_OVERLAY     = 15;
    static constexpr int BLEND_MODE_DARKEN      = 16;
    static constexpr int BLEND_MODE_LIGHTEN     = 17;
    static constexpr int BLEND_MODE_COLOR_DODGE = 18;
    static constexpr int BLEND_MODE_COLOR_BURN  = 19;
    static constexpr int BLEND_MODE_HARD_LIGHT  = 20;
    static constexpr int BLEND_MODE_SOFT_LIGHT  = 21;
    static constexpr int BLEND_MODE_DIFFERENCE  = 22;
    static constexpr int BLEND_MODE_EXCLUSION   = 23;
    static constexpr int BLEND_MODE_MULTIPLY    = 24;
    static constexpr int BLEND_MODE_HUE         = 25;
    static constexpr int BLEND_MODE_SATURATION  = 26;
    static constexpr int BLEND_MODE_COLOR       = 27;
    static constexpr int BLEND_MODE_LUMINOSITY  = 28;
    static constexpr int BLEND_MODE_NULL        = 29;
    static constexpr int PORTER_MODE_ADD        = 30;

    // Styles
    static constexpr int STYLE_FILL            = 0;
    static constexpr int STYLE_STROKE          = 1;
    static constexpr int STYLE_FILL_AND_STROKE = 2;

    // Gradient types
    static constexpr int LINEAR_GRADIENT = 0;
    static constexpr int RADIAL_GRADIENT = 1;
    static constexpr int SWEEP_GRADIENT  = 2;

    // Font
    static constexpr int FONT_NORMAL      = 0;
    static constexpr int FONT_BOLD        = 1;
    static constexpr int FONT_ITALIC      = 2;
    static constexpr int FONT_BOLD_ITALIC = 3;
    static constexpr int FONT_TYPE_DEFAULT    = 0;
    static constexpr int FONT_TYPE_SANS_SERIF = 1;
    static constexpr int FONT_TYPE_SERIF      = 2;
    static constexpr int FONT_TYPE_MONOSPACE  = 3;

    void readBundle(WireBuffer& buf);

    // Returns the resolved array (mOutArray if populated, else mArray).
    const std::vector<int32_t>& getData() const {
        return mOutArray.empty() ? mArray : mOutArray;
    }

    // Returns the original (unresolved) array.
    const std::vector<int32_t>& getRawData() const { return mArray; }

    int size() const { return static_cast<int>(getData().size()); }

    // ── Variable support for PaintBundle ─────────────────────────────

    // Scan mArray for NaN-encoded variable references, register listeners.
    // 'owner' is the Operation that owns this PaintBundle.
    void registerVars(RemoteContext& context, Operation* owner);

    // Copy mArray → mOutArray, resolve NaN floats and color IDs.
    void updateVariables(RemoteContext& context);

    // Programmatic construction (for layout modifiers painting)
    void addTag(int tag, int value) {
        mArray.push_back(tag);
        mArray.push_back(value);
    }
    // For tags that encode value in upper 16 bits (STYLE, STROKE_CAP, ANTI_ALIAS, etc.)
    void addUpperTag(int tag, int value) {
        mArray.push_back(tag | (value << 16));
    }
    void addTagFloat(int tag, float value) {
        mArray.push_back(tag);
        mArray.push_back(floatToIntBits(value));
    }
    void reset() { mArray.clear(); mOutArray.clear(); }

    static float intBitsToFloat(int32_t bits) {
        float f;
        memcpy(&f, &bits, sizeof(f));
        return f;
    }

    static int32_t floatToIntBits(float f) {
        int32_t i;
        memcpy(&i, &f, sizeof(i));
        return i;
    }

private:
    // Helper: resolve a float variable. If bits encode NaN, return context.getFloat(id).
    static int32_t fixFloatVar(int32_t val, RemoteContext& context);

    std::vector<int32_t> mArray;    // Original data with NaN-encoded variable IDs
    std::vector<int32_t> mOutArray; // Resolved data with actual float/color values
};

} // namespace rccore
