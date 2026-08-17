#pragma once
// Java's java.lang.Math semantics for the transcendentals the 3D engine uses.
//
// Java's Math.sqrt/sin/cos/pow/floor/ceil take and return `double`, always. A float argument is
// widened first and the result narrowed afterwards. C++ overload resolution does the opposite:
// `std::sqrt(floatExpr)` picks sqrtf and computes in single precision, which is a *different
// number*.
//
// This is not hypothetical. The tube's chord-length knots are `Math.sqrt(dx*dx + dy*dy + dz*dz)`
// with float components assigned to a double; calling sqrtf there changed the knot spacing,
// which moved every spline sample by a ULP or two and put 7 pixels wrong in two scenes. Every
// transcendental in this engine goes through these wrappers so the overload can never be picked
// by accident.

#include <cmath>

namespace rccore::d3 {

inline double jsqrt(double x) { return std::sqrt(x); }
inline double jsin(double x) { return std::sin(x); }
inline double jcos(double x) { return std::cos(x); }
inline double jpow(double x, double y) { return std::pow(x, y); }
inline double jfloor(double x) { return std::floor(x); }
inline double jceil(double x) { return std::ceil(x); }
inline double jhypot(double x, double y) { return std::hypot(x, y); }

} // namespace rccore::d3
