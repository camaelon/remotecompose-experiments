#pragma once
#include <string>
#include <sstream>
#include <cmath>
#include <cstring>
#include <iomanip>

namespace rccore {

inline std::string formatFloat(float f) {
    if (std::isnan(f)) return "NaN";
    if (std::isinf(f)) return f > 0 ? "Infinity" : "-Infinity";
    // Match Java's Float.toString() behavior
    std::ostringstream ss;
    if (f == 0.0f) {
        // Check for negative zero
        uint32_t bits;
        memcpy(&bits, &f, sizeof(bits));
        if (bits & 0x80000000) {
            return "-0.0";
        }
        return "0.0";
    }
    // Java Float.toString uses enough digits to uniquely identify the float
    ss << f;
    std::string s = ss.str();
    // Ensure it has a decimal point
    if (s.find('.') == std::string::npos && s.find('e') == std::string::npos
        && s.find('E') == std::string::npos) {
        s += ".0";
    }
    return s;
}

} // namespace rccore
