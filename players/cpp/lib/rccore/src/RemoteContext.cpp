#include "rccore/RemoteContext.h"
#include "rccore/PaintContext.h"
#include "rccore/Operation.h"

#include <algorithm>
#include <chrono>

namespace rccore {

void RemoteContext::loadText(int id, const std::string& text) {
    mTexts[id] = text;
    notifyListeners(id);
    if (mPaintContext) {
        mPaintContext->loadText(id, text);
    }
}

std::string RemoteContext::getText(int id) const {
    auto it = mTexts.find(id);
    return it != mTexts.end() ? it->second : "";
}

void RemoteContext::loadBitmap(int imageId, int widthAndType,
                               int heightAndEncoding,
                               const std::vector<uint8_t>& data) {
    // Store bitmap dimensions for ImageAttribute lookups
    int w = (widthAndType > 0xFFFF) ? (widthAndType & 0xFFFF) : widthAndType;
    int h = (heightAndEncoding > 0xFFFF) ? (heightAndEncoding & 0xFFFF) : heightAndEncoding;
    mBitmapDims[imageId] = {w, h};

    if (mPaintContext) {
        mPaintContext->loadBitmap(imageId, widthAndType, heightAndEncoding, data);
    }
}

void RemoteContext::loadPathData(int instanceId, int winding,
                                  const std::vector<float>& path) {
    if (mPaintContext) {
        mPaintContext->loadPathData(instanceId, winding, path);
    }
}

void RemoteContext::appendPathData(int instanceId,
                                    const std::vector<float>& path) {
    if (mPaintContext) {
        mPaintContext->appendPathData(instanceId, path);
    }
}

void RemoteContext::header(int majorVersion, int minorVersion,
                            int patchVersion, int width, int height,
                            int64_t capabilities) {
    // Store document dimensions but do NOT overwrite viewport dimensions.
    // In Java, the player sets mWidth/mHeight from the actual view size;
    // the header only records the document's intrinsic size.
    // The host (rc2image) sets mWidth/mHeight before calling paint().

    // Record document load time if not already set
    if (mDocLoadTime == 0) {
        auto now = std::chrono::system_clock::now();
        mDocLoadTime = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()).count();
    }
}

void RemoteContext::needsRepaint() {
    if (mPaintContext) {
        mPaintContext->needsRepaint();
    }
}

// ── Default Material Design system colors (blue-toned baseline) ──────

// Helper to convert 0xAARRGGBB uint32 to signed int (Java color format)
static constexpr int C(uint32_t c) { return static_cast<int>(c); }

// Static table of default system colors.
// Based on Material Design 3 baseline with blue seed color, matching the
// typical Android 12+ default palette when no dynamic colors are available.
static const std::unordered_map<std::string, int>& getDefaultColorTable() {
    static const std::unordered_map<std::string, int> table = {
        // ── system_accent1 (Primary Blue tonal palette) ──
        {"system_accent1_0",    C(0xFFFFFFFF)},
        {"system_accent1_10",   C(0xFF001B3E)},
        {"system_accent1_50",   C(0xFF002D6A)},
        {"system_accent1_100",  C(0xFF0042A0)},
        {"system_accent1_200",  C(0xFF1A60CC)},
        {"system_accent1_300",  C(0xFF4C82E8)},
        {"system_accent1_400",  C(0xFF6D9CFF)},
        {"system_accent1_500",  C(0xFF99B8FF)},
        {"system_accent1_600",  C(0xFFADC6FF)},
        {"system_accent1_700",  C(0xFFC5DEFF)},
        {"system_accent1_800",  C(0xFFDBE9FF)},
        {"system_accent1_900",  C(0xFFEEF0FF)},
        {"system_accent1_1000", C(0xFF000000)},

        // ── system_accent2 (Secondary muted blue tonal palette) ──
        {"system_accent2_0",    C(0xFFFFFFFF)},
        {"system_accent2_10",   C(0xFF0F1B2B)},
        {"system_accent2_50",   C(0xFF1E2D42)},
        {"system_accent2_100",  C(0xFF34455A)},
        {"system_accent2_200",  C(0xFF4C5D73)},
        {"system_accent2_300",  C(0xFF65768C)},
        {"system_accent2_400",  C(0xFF7E90A7)},
        {"system_accent2_500",  C(0xFF99ABC2)},
        {"system_accent2_600",  C(0xFFB3C5DD)},
        {"system_accent2_700",  C(0xFFCFE1FA)},
        {"system_accent2_800",  C(0xFFDDE8FF)},
        {"system_accent2_900",  C(0xFFEEF0FF)},
        {"system_accent2_1000", C(0xFF000000)},

        // ── system_accent3 (Tertiary mauve/lavender tonal palette) ──
        {"system_accent3_0",    C(0xFFFFFFFF)},
        {"system_accent3_10",   C(0xFF2B1641)},
        {"system_accent3_50",   C(0xFF3E2858)},
        {"system_accent3_100",  C(0xFF563F70)},
        {"system_accent3_200",  C(0xFF6E578A)},
        {"system_accent3_300",  C(0xFF8870A4)},
        {"system_accent3_400",  C(0xFFA38AC0)},
        {"system_accent3_500",  C(0xFFBEA4DC)},
        {"system_accent3_600",  C(0xFFDABFF9)},
        {"system_accent3_700",  C(0xFFF0DDFF)},
        {"system_accent3_800",  C(0xFFF8ECFF)},
        {"system_accent3_900",  C(0xFFFFFBFF)},
        {"system_accent3_1000", C(0xFF000000)},

        // ── system_neutral1 (Neutral tonal palette) ──
        {"system_neutral1_0",    C(0xFFFFFFFF)},
        {"system_neutral1_10",   C(0xFF1A1C1E)},
        {"system_neutral1_50",   C(0xFF2E3133)},
        {"system_neutral1_100",  C(0xFF45484A)},
        {"system_neutral1_200",  C(0xFF5D6062)},
        {"system_neutral1_300",  C(0xFF76797B)},
        {"system_neutral1_400",  C(0xFF909396)},
        {"system_neutral1_500",  C(0xFFABADB0)},
        {"system_neutral1_600",  C(0xFFC6C8CB)},
        {"system_neutral1_700",  C(0xFFE2E3E7)},
        {"system_neutral1_800",  C(0xFFF1F0F4)},
        {"system_neutral1_900",  C(0xFFFDFCFF)},
        {"system_neutral1_1000", C(0xFF000000)},

        // ── system_neutral2 (Neutral variant tonal palette) ──
        {"system_neutral2_0",    C(0xFFFFFFFF)},
        {"system_neutral2_10",   C(0xFF191C22)},
        {"system_neutral2_50",   C(0xFF2D3038)},
        {"system_neutral2_100",  C(0xFF44474F)},
        {"system_neutral2_200",  C(0xFF5C5F67)},
        {"system_neutral2_300",  C(0xFF757780)},
        {"system_neutral2_400",  C(0xFF8F919A)},
        {"system_neutral2_500",  C(0xFFA9ABB4)},
        {"system_neutral2_600",  C(0xFFC5C6D0)},
        {"system_neutral2_700",  C(0xFFE1E2EC)},
        {"system_neutral2_800",  C(0xFFF0F0FA)},
        {"system_neutral2_900",  C(0xFFFDFBFF)},
        {"system_neutral2_1000", C(0xFF000000)},

        // ── system_error (Error red tonal palette) ──
        {"system_error_0",    C(0xFFFFFFFF)},
        {"system_error_10",   C(0xFF410002)},
        {"system_error_50",   C(0xFF5C0004)},
        {"system_error_100",  C(0xFF790008)},
        {"system_error_200",  C(0xFF93000A)},
        {"system_error_300",  C(0xFFBA1A1A)},
        {"system_error_400",  C(0xFFDE3730)},
        {"system_error_500",  C(0xFFFF5449)},
        {"system_error_600",  C(0xFFFF897D)},
        {"system_error_700",  C(0xFFFFB4AB)},
        {"system_error_800",  C(0xFFFFDAD6)},
        {"system_error_900",  C(0xFFFFF8F7)},
        {"system_error_1000", C(0xFF000000)},

        // ── Semantic colors ──
        {"system_on_surface_light",          C(0xFF1A1C1E)},
        {"system_on_surface_dark",           C(0xFFE2E3E7)},
        {"system_on_surface_variant_light",  C(0xFF44474F)},
        {"system_on_surface_variant_dark",   C(0xFFC5C6D0)},
        {"system_on_surface_disabled",       C(0x611A1C1E)},
        {"system_surface_light",             C(0xFFFDFCFF)},
        {"system_surface_dark",              C(0xFF1A1C1E)},
        {"system_surface_disabled",          C(0x1F1A1C1E)},
        {"system_surface_variant_light",     C(0xFFE1E2EC)},
        {"system_surface_variant_dark",      C(0xFF44474F)},
        {"system_surface_bright_light",      C(0xFFFDFCFF)},
        {"system_surface_bright_dark",       C(0xFF37393E)},
        {"system_surface_dim_light",         C(0xFFDDD9DD)},
        {"system_surface_dim_dark",          C(0xFF1A1C1E)},
        {"system_surface_container_lowest_light",  C(0xFFFFFFFF)},
        {"system_surface_container_lowest_dark",   C(0xFF0E1012)},
        {"system_surface_container_low_light",     C(0xFFF7F2F7)},
        {"system_surface_container_low_dark",      C(0xFF1E2024)},
        {"system_surface_container_light",         C(0xFFF1ECF0)},
        {"system_surface_container_dark",          C(0xFF222528)},
        {"system_surface_container_high_light",    C(0xFFEBE6EA)},
        {"system_surface_container_high_dark",     C(0xFF2D3033)},
        {"system_surface_container_highest_light", C(0xFFE5E1E5)},
        {"system_surface_container_highest_dark",  C(0xFF383B3E)},
        {"system_background_light",          C(0xFFFDFCFF)},
        {"system_background_dark",           C(0xFF1A1C1E)},
        {"system_on_background_light",       C(0xFF1A1C1E)},
        {"system_on_background_dark",        C(0xFFE2E3E7)},
        {"system_primary_light",             C(0xFF1A60CC)},
        {"system_primary_dark",              C(0xFFADC6FF)},
        {"system_primary_container_light",   C(0xFFDBE9FF)},
        {"system_primary_container_dark",    C(0xFF0042A0)},
        {"system_on_primary_light",          C(0xFFFFFFFF)},
        {"system_on_primary_dark",           C(0xFF002D6A)},
        {"system_on_primary_container_light", C(0xFF001B3E)},
        {"system_on_primary_container_dark",  C(0xFFDBE9FF)},
        {"system_on_primary_fixed",          C(0xFF001B3E)},
        {"system_on_primary_fixed_variant",  C(0xFF0042A0)},
        {"system_primary_fixed",             C(0xFFDBE9FF)},
        {"system_primary_fixed_dim",         C(0xFFADC6FF)},
        {"system_secondary_light",           C(0xFF4C5D73)},
        {"system_secondary_dark",            C(0xFFB3C5DD)},
        {"system_secondary_container_light", C(0xFFDDE8FF)},
        {"system_secondary_container_dark",  C(0xFF34455A)},
        {"system_on_secondary_light",        C(0xFFFFFFFF)},
        {"system_on_secondary_dark",         C(0xFF1E2D42)},
        {"system_on_secondary_container_light", C(0xFF0F1B2B)},
        {"system_on_secondary_container_dark",  C(0xFFDDE8FF)},
        {"system_on_secondary_fixed",        C(0xFF0F1B2B)},
        {"system_on_secondary_fixed_variant", C(0xFF34455A)},
        {"system_secondary_fixed",           C(0xFFDDE8FF)},
        {"system_secondary_fixed_dim",       C(0xFFB3C5DD)},
        {"system_tertiary_light",            C(0xFF6E578A)},
        {"system_tertiary_dark",             C(0xFFDABFF9)},
        {"system_tertiary_container_light",  C(0xFFF8ECFF)},
        {"system_tertiary_container_dark",   C(0xFF563F70)},
        {"system_on_tertiary_light",         C(0xFFFFFFFF)},
        {"system_on_tertiary_dark",          C(0xFF3E2858)},
        {"system_on_tertiary_container_light", C(0xFF2B1641)},
        {"system_on_tertiary_container_dark",  C(0xFFF8ECFF)},
        {"system_on_tertiary_fixed",         C(0xFF2B1641)},
        {"system_on_tertiary_fixed_variant", C(0xFF563F70)},
        {"system_tertiary_fixed",            C(0xFFF8ECFF)},
        {"system_tertiary_fixed_dim",        C(0xFFDABFF9)},
        {"system_error_light",               C(0xFFBA1A1A)},
        {"system_error_dark",                C(0xFFFFB4AB)},
        {"system_error_container_light",     C(0xFFFFDAD6)},
        {"system_error_container_dark",      C(0xFF93000A)},
        {"system_on_error_light",            C(0xFFFFFFFF)},
        {"system_on_error_dark",             C(0xFF690005)},
        {"system_on_error_container_light",  C(0xFF410002)},
        {"system_on_error_container_dark",   C(0xFFFFDAD6)},
        {"system_outline_light",             C(0xFF757780)},
        {"system_outline_dark",              C(0xFF8F919A)},
        {"system_outline_variant_light",     C(0xFFC5C6D0)},
        {"system_outline_variant_dark",      C(0xFF44474F)},
        {"system_outline_disabled",          C(0x1F1A1C1E)},
        {"system_control_activated_light",   C(0xFF1A60CC)},
        {"system_control_activated_dark",    C(0xFFADC6FF)},
        {"system_control_normal_light",      C(0xFF76797B)},
        {"system_control_normal_dark",       C(0xFF909396)},
        {"system_control_highlight_light",   C(0x291A1C1E)},
        {"system_control_highlight_dark",    C(0x29E2E3E7)},
        {"system_palette_key_color_primary_light",          C(0xFF1A60CC)},
        {"system_palette_key_color_primary_dark",           C(0xFF6D9CFF)},
        {"system_palette_key_color_secondary_light",        C(0xFF4C5D73)},
        {"system_palette_key_color_secondary_dark",         C(0xFF7E90A7)},
        {"system_palette_key_color_tertiary_light",         C(0xFF6E578A)},
        {"system_palette_key_color_tertiary_dark",          C(0xFFA38AC0)},
        {"system_palette_key_color_neutral_light",          C(0xFF5D6062)},
        {"system_palette_key_color_neutral_dark",           C(0xFF909396)},
        {"system_palette_key_color_neutral_variant_light",  C(0xFF5C5F67)},
        {"system_palette_key_color_neutral_variant_dark",   C(0xFF8F919A)},

        // ── Text colors ──
        {"system_text_hint_inverse_light",   C(0x80000000)},
        {"system_text_hint_inverse_dark",    C(0x80FFFFFF)},
        {"system_text_primary_inverse_light", C(0xFF000000)},
        {"system_text_primary_inverse_dark",  C(0xFFFFFFFF)},
        {"system_text_primary_inverse_disable_only_light", C(0x80000000)},
        {"system_text_primary_inverse_disable_only_dark",  C(0x80FFFFFF)},
        {"system_text_secondary_and_tertiary_inverse_light", C(0xB3000000)},
        {"system_text_secondary_and_tertiary_inverse_dark",  C(0xB3FFFFFF)},
        {"system_text_secondary_and_tertiary_inverse_disabled_light", C(0x80000000)},
        {"system_text_secondary_and_tertiary_inverse_disabled_dark",  C(0x80FFFFFF)},

        // ── Legacy Holo colors ──
        {"holo_blue_bright",  C(0xFF00DDFF)},
        {"holo_blue_dark",    C(0xFF0099CC)},
        {"holo_blue_light",   C(0xFF33B5E5)},
        {"holo_green_dark",   C(0xFF669900)},
        {"holo_green_light",  C(0xFF99CC00)},
        {"holo_orange_dark",  C(0xFFFF8800)},
        {"holo_orange_light", C(0xFFFFBB33)},
        {"holo_purple",       C(0xFFAA66CC)},
        {"holo_red_dark",     C(0xFFCC0000)},
        {"holo_red_light",    C(0xFFFF4444)},
        {"background_dark",   C(0xFF000000)},
        {"background_light",  C(0xFFFFFFFF)},
        {"black",             C(0xFF000000)},
        {"darker_gray",       C(0xFFAAAAAA)},
        {"tab_indicator_text", C(0xFF808080)},
    };
    return table;
}

bool RemoteContext::getDefaultSystemColor(const std::string& name, int& outColor) {
    const auto& table = getDefaultColorTable();
    auto it = table.find(name);
    if (it != table.end()) {
        outColor = it->second;
        return true;
    }
    return false;
}

void RemoteContext::registerNamedColor(int id, const std::string& colorName) {
    // Strip "color." prefix if present (names come in as "color.system_accent1_500")
    std::string lookupName = colorName;
    if (lookupName.size() > 6 && lookupName.substr(0, 6) == "color.") {
        lookupName = lookupName.substr(6);
    }

    int defaultColor;
    if (getDefaultSystemColor(lookupName, defaultColor)) {
        overrideColor(id, defaultColor);
    }
}

// ── Variable listener system ─────────────────────────────────────────

void RemoteContext::listensTo(int variableId, Operation* op) {
    if (!op) return;
    auto& listeners = mVarListeners[variableId];
    // Avoid duplicates
    if (std::find(listeners.begin(), listeners.end(), op) == listeners.end()) {
        listeners.push_back(op);
    }
}

void RemoteContext::notifyListeners(int variableId) {
    auto it = mVarListeners.find(variableId);
    if (it == mVarListeners.end()) return;
    for (Operation* op : it->second) {
        op->markDirty();
    }
}

int RemoteContext::getRepaintDelay() const {
    // If anything listens to continuous time → repaint every frame
    if (hasListeners(ID_CONTINUOUS_SEC) || hasListeners(ID_ANIMATION_TIME)
        || hasListeners(ID_ANIMATION_DELTA_TIME)) {
        return 1;
    }
    // If listening to seconds → repaint ~every second
    if (hasListeners(ID_TIME_IN_SEC) || hasListeners(ID_EPOCH_SECOND)) {
        return 1000;
    }
    // If listening to minutes → repaint ~every minute
    if (hasListeners(ID_TIME_IN_MIN)) {
        return 60000;
    }
    // If listening to hours → repaint ~every hour
    if (hasListeners(ID_TIME_IN_HR)) {
        return 3600000;
    }
    return -1; // Static content, no repaint needed
}

} // namespace rccore
