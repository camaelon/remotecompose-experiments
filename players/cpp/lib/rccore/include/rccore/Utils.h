#pragma once
#include <cstdint>
#include <cmath>
#include <cstring>
#include <string>
#include <sstream>
#include <iomanip>
#include <algorithm>

namespace rccore {

class RemoteContext;
class Operation;

class Utils {
public:
    // ── Variable resolution helpers ──────────────────────────────────
    // Resolve a float: if NaN-encoded variable ID, return context value; else as-is.
    static float resolveFloat(float v, RemoteContext& context);

    // Register listener if float is a NaN-encoded variable ID.
    static void registerFloatVar(float v, RemoteContext& context, Operation* owner);

    static float asNan(int v) {
        int32_t bits = v | static_cast<int32_t>(0xFF800000);
        float f;
        memcpy(&f, &bits, sizeof(f));
        return f;
    }

    static int idFromNan(float value) {
        int32_t b;
        memcpy(&b, &value, sizeof(b));
        return b & 0x3FFFFF;
    }

    static bool isVariable(float v) {
        if (std::isnan(v)) {
            int id = idFromNan(v);
            if (id == 0) return false;
            return id > 40 || id < 10;
        }
        return false;
    }

    static float intBitsToFloat(int bits) {
        float f;
        memcpy(&f, &bits, sizeof(f));
        return f;
    }

    static int floatToRawIntBits(float f) {
        int bits;
        memcpy(&bits, &f, sizeof(bits));
        return bits;
    }

    static int clampByte(int c) {
        return std::max(0, std::min(255, c));
    }

    static int toARGB(float alpha, float red, float green, float blue) {
        int a = (int)(alpha * 255.0f + 0.5f);
        int r = (int)(red * 255.0f + 0.5f);
        int g = (int)(green * 255.0f + 0.5f);
        int b = (int)(blue * 255.0f + 0.5f);
        return (clampByte(a) << 24) | (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
    }

    static int hsvToRgb(float hue, float saturation, float value) {
        int h = (int)(hue * 6);
        float f = hue * 6 - h;
        int p = (int)(0.5f + 255 * value * (1 - saturation));
        int q = (int)(0.5f + 255 * value * (1 - f * saturation));
        int t = (int)(0.5f + 255 * value * (1 - (1 - f) * saturation));
        int v = (int)(0.5f + 255 * value);
        switch (h) {
            case 0: return (int)0xFF000000 | (v << 16) | (t << 8) | p;
            case 1: return (int)0xFF000000 | (q << 16) | (v << 8) | p;
            case 2: return (int)0xFF000000 | (p << 16) | (v << 8) | t;
            case 3: return (int)0xFF000000 | (p << 16) | (q << 8) | v;
            case 4: return (int)0xFF000000 | (t << 16) | (p << 8) | v;
            case 5: return (int)0xFF000000 | (v << 16) | (p << 8) | q;
            default: return (int)0xFF000000;
        }
    }

    static int interpolateColor(int c1, int c2, float t) {
        if (std::isnan(t) || t == 0.0f) return c1;
        if (t == 1.0f) return c2;

        // Gamma-correct interpolation (sRGB gamma ~2.2)
        auto toLinear = [](int ch) -> float { return std::pow(ch / 255.0f, 2.2f); };
        auto toSRGB = [](float v) -> int { return clampByte((int)(std::pow(v, 1.0f/2.2f) * 255.0f)); };

        float c1a = ((c1 >> 24) & 0xFF) / 255.0f;
        float c1r = toLinear((c1 >> 16) & 0xFF);
        float c1g = toLinear((c1 >> 8) & 0xFF);
        float c1b = toLinear(c1 & 0xFF);

        float c2a = ((c2 >> 24) & 0xFF) / 255.0f;
        float c2r = toLinear((c2 >> 16) & 0xFF);
        float c2g = toLinear((c2 >> 8) & 0xFF);
        float c2b = toLinear(c2 & 0xFF);

        int a = clampByte((int)((c1a + t * (c2a - c1a)) * 255.0f));
        int r = toSRGB(c1r + t * (c2r - c1r));
        int g = toSRGB(c1g + t * (c2g - c1g));
        int b = toSRGB(c1b + t * (c2b - c1b));

        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    static std::string colorInt(int color) {
        std::ostringstream ss;
        ss << "0x" << std::setfill('0') << std::setw(8) << std::hex << (unsigned int)color;
        return ss.str();
    }
};

} // namespace rccore
