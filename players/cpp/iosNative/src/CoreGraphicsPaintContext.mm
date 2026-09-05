#include "rcnative/CoreGraphicsPaintContext.h"

#include "rccore/RemoteContext.h"
#include "rccore/Utils.h"
#include "rccore/d3/Paint3DContext.h"   // MODE_* constants

#include <CoreText/CoreText.h>
#include <ImageIO/ImageIO.h>

#include <cmath>

namespace rcnative {

using rccore::PaintBundle;

// ── construction ─────────────────────────────────────────────────────────

CoreGraphicsPaintContext::CoreGraphicsPaintContext(rccore::RemoteContext& context,
                                                   CGContextRef cg,
                                                   float widthPx, float heightPx, bool yDown)
    : rccore::PaintContext(context), mCG(cg), mWidth(widthPx), mHeight(heightPx) {
    CGContextRetain(mCG);
    // RemoteCompose is y-down. A bare CGBitmapContext is y-up and needs flipping; a
    // UIView drawRect context has already been flipped by UIKit and must not be flipped
    // again. Text compensates locally in both cases — see drawTextAnchored.
    if (!yDown) {
        CGContextTranslateCTM(mCG, 0, heightPx);
        CGContextScaleCTM(mCG, 1, -1);
    }
    CGContextSetShouldAntialias(mCG, true);
}

CoreGraphicsPaintContext::~CoreGraphicsPaintContext() {
    for (auto& kv : mPaths) CGPathRelease(kv.second);
    for (auto& kv : mImages) CGImageRelease(kv.second);
    CGContextRelease(mCG);
}

// ── paint plumbing ───────────────────────────────────────────────────────

static inline void rgba(uint32_t argb, CGFloat out[4]) {
    out[0] = ((argb >> 16) & 0xFF) / 255.0;
    out[1] = ((argb >> 8) & 0xFF) / 255.0;
    out[2] = (argb & 0xFF) / 255.0;
    out[3] = ((argb >> 24) & 0xFF) / 255.0;
}

void CoreGraphicsPaintContext::setFillColor() {
    CGFloat c[4];
    rgba(mPaint.color, c);
    CGContextSetRGBFillColor(mCG, c[0], c[1], c[2], c[3]);
    CGContextSetRGBStrokeColor(mCG, c[0], c[1], c[2], c[3]);
}

void CoreGraphicsPaintContext::setStroke() {
    CGContextSetLineWidth(mCG, mPaint.strokeWidth);
    CGContextSetMiterLimit(mCG, mPaint.miter);
    CGContextSetLineCap(mCG, mPaint.cap == 1 ? kCGLineCapRound
                             : mPaint.cap == 2 ? kCGLineCapSquare : kCGLineCapButt);
    CGContextSetLineJoin(mCG, mPaint.join == 1 ? kCGLineJoinRound
                              : mPaint.join == 2 ? kCGLineJoinBevel : kCGLineJoinMiter);
}

void CoreGraphicsPaintContext::paintCurrentPath() {
    setFillColor();
    if (mPaint.hasGradient) {
        // CG has no shader object on the paint. A gradient fill is therefore: clip to the
        // shape, then draw the gradient through the clip. The save/restore keeps the clip
        // from leaking — this is the one place the backend must balance a gsave itself.
        CGContextSaveGState(mCG);
        if (mPaint.fill) CGContextClip(mCG); else CGContextReplacePathWithStrokedPath(mCG), CGContextClip(mCG);

        CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
        std::vector<CGFloat> comps;
        comps.reserve(mPaint.gradColors.size() * 4);
        for (uint32_t c : mPaint.gradColors) {
            CGFloat v[4]; rgba(c, v);
            comps.insert(comps.end(), v, v + 4);
        }
        std::vector<CGFloat> locs(mPaint.gradStops.begin(), mPaint.gradStops.end());
        CGGradientRef g = CGGradientCreateWithColorComponents(
            cs, comps.data(), locs.empty() ? nullptr : locs.data(),
            mPaint.gradColors.size());
        if (g) {
            CGPoint a = CGPointMake(mPaint.gradPts[0], mPaint.gradPts[1]);
            CGPoint b = CGPointMake(mPaint.gradPts[2], mPaint.gradPts[3]);
            if (mPaint.gradientType == 1) {
                CGFloat r = std::hypot(b.x - a.x, b.y - a.y);
                CGContextDrawRadialGradient(mCG, g, a, 0, a, r,
                    kCGGradientDrawsBeforeStartLocation | kCGGradientDrawsAfterEndLocation);
            } else {
                // Linear. A sweep gradient has no CG primitive and needs a CGShading with
                // a callback; not implemented yet, so it degrades to linear rather than
                // drawing nothing.
                CGContextDrawLinearGradient(mCG, g, a, b,
                    kCGGradientDrawsBeforeStartLocation | kCGGradientDrawsAfterEndLocation);
            }
            CGGradientRelease(g);
        }
        CGColorSpaceRelease(cs);
        CGContextRestoreGState(mCG);
        return;
    }
    if (mPaint.fill) {
        CGContextFillPath(mCG);
    } else {
        setStroke();
        CGContextStrokePath(mCG);
    }
}

void CoreGraphicsPaintContext::applyPaint(const PaintBundle& bundle) {
    // A paint bundle is a DELTA: it carries only what it changes and everything else stays
    // as the previous bundle left it. So nothing is cleared here — the same contract the
    // Skia backend documents. reset() is what drops state between frames.
    const auto& arr = bundle.getData();
    int i = 0, len = bundle.size();

    auto resolveFloat = [&](int32_t bits) -> float {
        float f = PaintBundle::intBitsToFloat(bits);
        if (std::isnan(f)) f = mContext.getFloat(rccore::Utils::idFromNan(f));
        return f;
    };

    while (i < len) {
        int32_t cmd = arr[i++];
        int tag = cmd & 0xFFFF;
        int upper = (cmd >> 16) & 0xFFFF;
        switch (tag) {
            case PaintBundle::TEXT_SIZE:    mPaint.textSize   = resolveFloat(arr[i++]); break;
            case PaintBundle::STROKE_WIDTH: mPaint.strokeWidth= resolveFloat(arr[i++]); break;
            case PaintBundle::STROKE_MITER: mPaint.miter      = resolveFloat(arr[i++]); break;
            case PaintBundle::COLOR:
            case PaintBundle::COLOR_ID:     mPaint.color = (uint32_t)arr[i++]; break;
            case PaintBundle::STROKE_CAP:   mPaint.cap  = upper; break;
            case PaintBundle::STROKE_JOIN:  mPaint.join = upper; break;
            case PaintBundle::STYLE:        mPaint.fill = (upper == 0); break;
            case PaintBundle::ALPHA: {
                float a = resolveFloat(arr[i++]);
                uint32_t al = (uint32_t)std::lround(std::fmin(1.f, std::fmax(0.f, a)) * 255.f);
                mPaint.color = (mPaint.color & 0x00FFFFFF) | (al << 24);
                break;
            }
            case PaintBundle::GRADIENT: {
                // Layout mirrors the writer: type in the upper half, then colour count,
                // colours, stop count, stops, then the geometry.
                mPaint.hasGradient = true;
                mPaint.gradientType = upper;
                int n = arr[i++] & 0xFFFF;
                mPaint.gradColors.clear();
                for (int k = 0; k < n && i < len; k++) mPaint.gradColors.push_back((uint32_t)arr[i++]);
                int ns = (i < len) ? arr[i++] : 0;
                mPaint.gradStops.clear();
                for (int k = 0; k < ns && i < len; k++) mPaint.gradStops.push_back(resolveFloat(arr[i++]));
                for (int k = 0; k < 4 && i < len; k++) mPaint.gradPts[k] = resolveFloat(arr[i++]);
                if (i < len) i++;   // tileMode
                break;
            }
            // Not yet handled. Skipping the payload rather than guessing its width would
            // desynchronise the rest of the bundle, so these consume one word each — which
            // matches every fixed-width tag above. SHADER is the one that matters and needs
            // Metal; see README.
            case PaintBundle::SHADER:
            case PaintBundle::COLOR_FILTER:
            case PaintBundle::COLOR_FILTER_ID:
            case PaintBundle::BLEND_MODE:
            case PaintBundle::ANTI_ALIAS:
            case PaintBundle::FILTER_BITMAP:
            case PaintBundle::IMAGE_FILTER_QUALITY:
                i++;
                break;
            default:
                // Unknown tag: stop rather than walk off the end misinterpreting payloads.
                i = len;
                break;
        }
    }
}

void CoreGraphicsPaintContext::savePaint()    { mPaintStack.push(mPaint); }
void CoreGraphicsPaintContext::restorePaint() {
    if (!mPaintStack.empty()) { mPaint = mPaintStack.top(); mPaintStack.pop(); }
}

// ── transform ────────────────────────────────────────────────────────────

void CoreGraphicsPaintContext::matrixSave()    { CGContextSaveGState(mCG); }
void CoreGraphicsPaintContext::matrixRestore() { CGContextRestoreGState(mCG); }
void CoreGraphicsPaintContext::matrixTranslate(float dx, float dy) {
    CGContextTranslateCTM(mCG, dx, dy);
}
void CoreGraphicsPaintContext::matrixScale(float sx, float sy, float cx, float cy) {
    CGContextTranslateCTM(mCG, cx, cy);
    CGContextScaleCTM(mCG, sx, sy);
    CGContextTranslateCTM(mCG, -cx, -cy);
}
void CoreGraphicsPaintContext::matrixRotate(float degrees, float cx, float cy) {
    CGContextTranslateCTM(mCG, cx, cy);
    CGContextRotateCTM(mCG, degrees * (float)M_PI / 180.0f);
    CGContextTranslateCTM(mCG, -cx, -cy);
}
void CoreGraphicsPaintContext::matrixSkew(float sx, float sy) {
    CGContextConcatCTM(mCG, CGAffineTransformMake(1, sy, sx, 1, 0, 0));
}

// ── clipping ─────────────────────────────────────────────────────────────

void CoreGraphicsPaintContext::clipRect(float l, float t, float r, float b) {
    CGContextClipToRect(mCG, CGRectMake(l, t, r - l, b - t));
}

void CoreGraphicsPaintContext::clipPath(int pathId, int regionOp) {
    CGPathRef p = pathFor(pathId);
    if (!p) return;
    CGContextAddPath(mCG, p);
    CGContextClip(mCG);   // regionOp beyond intersect needs path booleans; see README
}

void CoreGraphicsPaintContext::roundedClipRect(float w, float h, float ts, float te,
                                               float bs, float be) {
    CGMutablePathRef p = CGPathCreateMutable();
    CGPathAddRoundedRect(p, nullptr, CGRectMake(0, 0, w, h),
                         std::fmax(ts, bs), std::fmax(te, be));
    CGContextAddPath(mCG, p);
    CGContextClip(mCG);
    CGPathRelease(p);
}

// ── 2D drawing ───────────────────────────────────────────────────────────

void CoreGraphicsPaintContext::drawRect(float l, float t, float r, float b) {
    CGContextBeginPath(mCG);
    CGContextAddRect(mCG, CGRectMake(l, t, r - l, b - t));
    paintCurrentPath();
}

void CoreGraphicsPaintContext::drawCircle(float cx, float cy, float radius) {
    CGContextBeginPath(mCG);
    CGContextAddEllipseInRect(mCG, CGRectMake(cx - radius, cy - radius, radius * 2, radius * 2));
    paintCurrentPath();
}

void CoreGraphicsPaintContext::drawOval(float l, float t, float r, float b) {
    CGContextBeginPath(mCG);
    CGContextAddEllipseInRect(mCG, CGRectMake(l, t, r - l, b - t));
    paintCurrentPath();
}

void CoreGraphicsPaintContext::drawLine(float x1, float y1, float x2, float y2) {
    CGContextBeginPath(mCG);
    CGContextMoveToPoint(mCG, x1, y1);
    CGContextAddLineToPoint(mCG, x2, y2);
    setFillColor();
    setStroke();
    CGContextStrokePath(mCG);
}

void CoreGraphicsPaintContext::drawRoundRect(float l, float t, float r, float b,
                                             float rx, float ry) {
    CGMutablePathRef p = CGPathCreateMutable();
    CGPathAddRoundedRect(p, nullptr, CGRectMake(l, t, r - l, b - t), rx, ry);
    CGContextBeginPath(mCG);
    CGContextAddPath(mCG, p);
    paintCurrentPath();
    CGPathRelease(p);
}

/** Shared by arc and sector; a sector closes through the centre, an arc does not. */
static void addArc(CGContextRef cg, float l, float t, float r, float b,
                   float startDeg, float sweepDeg, bool toCentre) {
    CGFloat cx = (l + r) * 0.5f, cy = (t + b) * 0.5f;
    CGFloat rx = (r - l) * 0.5f, ry = (b - t) * 0.5f;
    CGContextBeginPath(cg);
    CGContextSaveGState(cg);
    CGContextTranslateCTM(cg, cx, cy);
    CGContextScaleCTM(cg, rx, ry == 0 ? 1 : ry);
    if (toCentre) CGContextMoveToPoint(cg, 0, 0);
    CGContextAddArc(cg, 0, 0, 1,
                    startDeg * (CGFloat)M_PI / 180.0,
                    (startDeg + sweepDeg) * (CGFloat)M_PI / 180.0,
                    sweepDeg < 0);
    if (toCentre) CGContextClosePath(cg);
    CGContextRestoreGState(cg);
}

void CoreGraphicsPaintContext::drawArc(float l, float t, float r, float b,
                                       float start, float sweep) {
    addArc(mCG, l, t, r, b, start, sweep, false);
    setFillColor(); setStroke();
    CGContextStrokePath(mCG);
}

void CoreGraphicsPaintContext::drawSector(float l, float t, float r, float b,
                                          float start, float sweep) {
    addArc(mCG, l, t, r, b, start, sweep, true);
    paintCurrentPath();
}

// ── paths ────────────────────────────────────────────────────────────────

CGPathRef CoreGraphicsPaintContext::pathFor(int id) const {
    auto it = mPaths.find(id);
    return it == mPaths.end() ? nullptr : it->second;
}

void CoreGraphicsPaintContext::drawPath(int pathId, float start, float end) {
    CGPathRef p = pathFor(pathId);
    if (!p) return;
    // start/end trim the path by fraction. Untrimmed is the common case; trimming needs an
    // arclength walk, which is not implemented yet.
    CGContextBeginPath(mCG);
    CGContextAddPath(mCG, p);
    paintCurrentPath();
}

void CoreGraphicsPaintContext::loadPathData(int instanceId, int winding,
                                            const std::vector<float>& path) {
    auto it = mPaths.find(instanceId);
    if (it != mPaths.end()) { CGPathRelease(it->second); mPaths.erase(it); }
    CGMutablePathRef p = CGPathCreateMutable();
    mPaths[instanceId] = p;
    appendPathData(instanceId, path);
}

void CoreGraphicsPaintContext::appendPathData(int instanceId, const std::vector<float>& path) {
    auto it = mPaths.find(instanceId);
    if (it == mPaths.end()) return;
    CGMutablePathRef p = it->second;
    // Verb tags arrive NaN-encoded, coordinates as plain floats — the same encoding the
    // writer produces for DATA_PATH.
    size_t i = 0;
    while (i < path.size()) {
        float v = path[i];
        if (!std::isnan(v)) { i++; continue; }
        int verb = rccore::Utils::idFromNan(v);
        i++;
        switch (verb) {
            case 0: if (i + 1 < path.size()) { CGPathMoveToPoint(p, nullptr, path[i], path[i+1]); i += 2; } break;
            case 1: if (i + 1 < path.size()) { CGPathAddLineToPoint(p, nullptr, path[i], path[i+1]); i += 2; } break;
            case 2: if (i + 3 < path.size()) { CGPathAddQuadCurveToPoint(p, nullptr, path[i], path[i+1], path[i+2], path[i+3]); i += 4; } break;
            case 3: if (i + 5 < path.size()) { CGPathAddCurveToPoint(p, nullptr, path[i], path[i+1], path[i+2], path[i+3], path[i+4], path[i+5]); i += 6; } break;
            case 4: CGPathCloseSubpath(p); break;
            default: i = path.size(); break;
        }
    }
}

// Path tweening and boolean ops need geometry Core Graphics does not provide. Skia supplies
// SkPathOps for the latter. Left unimplemented rather than approximated, so a document that
// uses them is visibly missing rather than subtly wrong.
void CoreGraphicsPaintContext::drawTweenPath(int, int, float, float, float) {}
void CoreGraphicsPaintContext::tweenPath(int, int, int, float) {}

// ── text (Core Text) ─────────────────────────────────────────────────────

void CoreGraphicsPaintContext::loadText(int id, const std::string& text) { mTexts[id] = text; }

std::string CoreGraphicsPaintContext::getText(int id) {
    auto it = mTexts.find(id);
    return it == mTexts.end() ? std::string() : it->second;
}

/** A CTLine for `s` at the current paint's size. Caller releases. */
static CTLineRef makeLine(const std::string& s, float size, uint32_t color) {
    CFStringRef str = CFStringCreateWithBytes(nullptr, (const UInt8*)s.data(),
                                              s.size(), kCFStringEncodingUTF8, false);
    if (!str) return nullptr;
    CTFontRef font = CTFontCreateWithName(CFSTR("Helvetica"), size, nullptr);
    CGFloat c[4]; rgba(color, c);
    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    CGColorRef col = CGColorCreate(cs, c);
    CFStringRef keys[] = { kCTFontAttributeName, kCTForegroundColorAttributeName };
    CFTypeRef vals[] = { font, col };
    CFDictionaryRef attrs = CFDictionaryCreate(nullptr, (const void**)keys, (const void**)vals, 2,
                                               &kCFTypeDictionaryKeyCallBacks,
                                               &kCFTypeDictionaryValueCallBacks);
    CFAttributedStringRef as = CFAttributedStringCreate(nullptr, str, attrs);
    CTLineRef line = CTLineCreateWithAttributedString(as);
    CFRelease(as); CFRelease(attrs); CGColorRelease(col);
    CGColorSpaceRelease(cs); CFRelease(font); CFRelease(str);
    return line;
}

void CoreGraphicsPaintContext::drawTextAnchored(int textId, float x, float y,
                                                float panX, float panY, int flags) {
    std::string s = getText(textId);
    if (s.empty()) return;
    CTLineRef line = makeLine(s, mPaint.textSize, mPaint.color);
    if (!line) return;
    CGFloat asc = 0, desc = 0, lead = 0;
    double w = CTLineGetTypographicBounds(line, &asc, &desc, &lead);
    // panX/panY are -1..1 anchors: -1 is start/top, 0 centre, +1 end/bottom.
    CGFloat tx = x - (CGFloat)((panX + 1.0f) * 0.5f) * (CGFloat)w;
    CGFloat ty = y + (CGFloat)((1.0f - panY) * 0.5f) * (asc + desc) - desc;

    CGContextSaveGState(mCG);
    // Undo the document-space y-flip locally, or glyphs render upside down.
    CGContextTranslateCTM(mCG, tx, ty);
    CGContextScaleCTM(mCG, 1, -1);
    CGContextSetTextPosition(mCG, 0, 0);
    CTLineDraw(line, mCG);
    CGContextRestoreGState(mCG);
    CFRelease(line);
}

void CoreGraphicsPaintContext::drawTextRun(int textId, int start, int end,
                                           int, int, float x, float y, bool) {
    std::string s = getText(textId);
    if (s.empty()) return;
    int b = start >= 0 ? start : 0;
    int e = end >= 0 ? std::min<int>(end, (int)s.size()) : (int)s.size();
    if (e <= b) return;
    std::string sub = s.substr(b, e - b);
    CTLineRef line = makeLine(sub, mPaint.textSize, mPaint.color);
    if (!line) return;
    CGContextSaveGState(mCG);
    CGContextTranslateCTM(mCG, x, y);
    CGContextScaleCTM(mCG, 1, -1);
    CGContextSetTextPosition(mCG, 0, 0);
    CTLineDraw(line, mCG);
    CGContextRestoreGState(mCG);
    CFRelease(line);
}

// Needs per-glyph transforms along an arclength walk (Skia uses SkRSXform). Not yet.
void CoreGraphicsPaintContext::drawTextOnPath(int, int, float, float) {}

float CoreGraphicsPaintContext::measureTextWidth(const std::string& text, float fontSize) {
    if (text.empty()) return 0;
    CTLineRef line = makeLine(text, fontSize, 0xFF000000);
    if (!line) return 0;
    double w = CTLineGetTypographicBounds(line, nullptr, nullptr, nullptr);
    CFRelease(line);
    return (float)w;
}

float CoreGraphicsPaintContext::measureTextHeight(const std::string& text, float fontSize) {
    if (text.empty()) return 0;
    CTLineRef line = makeLine(text, fontSize, 0xFF000000);
    if (!line) return fontSize * 1.2f;
    CGFloat asc = 0, desc = 0, lead = 0;
    CTLineGetTypographicBounds(line, &asc, &desc, &lead);
    CFRelease(line);
    return (float)(asc + desc + lead);
}

float CoreGraphicsPaintContext::measureTextAscent(const std::string& text, float fontSize) {
    if (text.empty()) return fontSize;
    CTLineRef line = makeLine(text, fontSize, 0xFF000000);
    if (!line) return fontSize;
    CGFloat asc = 0, desc = 0, lead = 0;
    CTLineGetTypographicBounds(line, &asc, &desc, &lead);
    CFRelease(line);
    return (float)asc;
}

// ── bitmaps ──────────────────────────────────────────────────────────────

void CoreGraphicsPaintContext::loadBitmap(int imageId, int, int,
                                          const std::vector<uint8_t>& data) {
    auto it = mImages.find(imageId);
    if (it != mImages.end()) { CGImageRelease(it->second); mImages.erase(it); }
    if (data.empty()) return;
    CFDataRef cf = CFDataCreate(nullptr, data.data(), data.size());
    if (!cf) return;
    CGImageSourceRef src = CGImageSourceCreateWithData(cf, nullptr);
    if (src) {
        CGImageRef img = CGImageSourceCreateImageAtIndex(src, 0, nullptr);
        if (img) mImages[imageId] = img;
        CFRelease(src);
    }
    CFRelease(cf);
}

void CoreGraphicsPaintContext::drawBitmap(int imageId, float l, float t, float r, float b) {
    auto it = mImages.find(imageId);
    if (it == mImages.end()) return;
    CGContextSaveGState(mCG);
    // CGContextDrawImage draws y-up; the context is already flipped, so flip back over the
    // destination rect to keep the image upright.
    CGContextTranslateCTM(mCG, l, t);
    CGContextTranslateCTM(mCG, 0, (b - t));
    CGContextScaleCTM(mCG, 1, -1);
    CGContextDrawImage(mCG, CGRectMake(0, 0, r - l, b - t), it->second);
    CGContextRestoreGState(mCG);
}

void CoreGraphicsPaintContext::drawBitmapInt(int imageId, int sl, int st, int sr, int sb,
                                             int dl, int dt, int dr, int db, int) {
    auto it = mImages.find(imageId);
    if (it == mImages.end()) return;
    CGImageRef sub = CGImageCreateWithImageInRect(
        it->second, CGRectMake(sl, st, sr - sl, sb - st));
    if (!sub) return;
    CGContextSaveGState(mCG);
    CGContextTranslateCTM(mCG, dl, dt);
    CGContextTranslateCTM(mCG, 0, (db - dt));
    CGContextScaleCTM(mCG, 1, -1);
    CGContextDrawImage(mCG, CGRectMake(0, 0, dr - dl, db - dt), sub);
    CGContextRestoreGState(mCG);
    CGImageRelease(sub);
}

// ── frame reset ──────────────────────────────────────────────────────────

void CoreGraphicsPaintContext::reset() {
    // Called once per frame by CoreDocument::paint. Dropping paint state here is what stops
    // it leaking between frames — the same role SkPaint::reset plays in the Skia backend.
    mPaint = Paint{};
    while (!mPaintStack.empty()) mPaintStack.pop();
}

// ── 3D ───────────────────────────────────────────────────────────────────
//
// Transform, lighting and rasterization all live in rccore's SoftwarePaint3DContext, which
// touches no graphics library at all. This backend only has to size its buffer, hand the ops
// through, and composite the result — which is why dropping Skia cost nothing in 3D.

using rccore::d3::SoftwarePaint3DContext;

rccore::d3::SoftwarePaint3DContext* CoreGraphicsPaintContext::Native3D::ensure() {
    // Size to the document's OWN coordinate space, not the device surface: the buffer is blit
    // at (0,0) under the live transform, so its scene centres on (w/2, h/2) of whatever it is
    // sized to. For a nested embed the sub-document's context carries the sub-document's size,
    // and matching it here centres the scene in the embed box.
    int w = (int) std::lround(mOwner.getContext().mWidth);
    int h = (int) std::lround(mOwner.getContext().mHeight);
    if (w <= 0 || h <= 0) { w = (int) std::lround(mOwner.mWidth); h = (int) std::lround(mOwner.mHeight); }
    if (w <= 0 || h <= 0) return nullptr;
    if (!mSized || mCtx.width() != w || mCtx.height() != h) {
        mCtx.setSize(w, h);
        // setSize does not clear the depth buffer's contents meaningfully for a first draw;
        // clearing here keeps the first mesh from being rejected against stale memory.
        mCtx.clearDepth3D();
        mSized = true;
    }
    return &mCtx;
}

void CoreGraphicsPaintContext::Native3D::blit() {
    if (!mSized) return;
    const std::vector<int32_t>& px = mCtx.colorBuffer();
    const int w = mCtx.width(), h = mCtx.height();
    if (w <= 0 || h <= 0 || (int) px.size() < w * h) return;

    // The rasterizer writes unpremultiplied ARGB packed into an int32. Little-endian byte
    // order with alpha-first is exactly that layout, so the buffer transfers with no
    // conversion pass. Unpremultiplied is legal for a CGImage (it is not for a
    // CGBitmapContext, which is why the texture path below has to undo premultiplication).
    CGDataProviderRef provider =
        CGDataProviderCreateWithData(nullptr, px.data(), (size_t) w * h * 4, nullptr);
    if (!provider) return;
    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    CGImageRef img = CGImageCreate(
        w, h, 8, 32, (size_t) w * 4, cs,
        kCGImageAlphaFirst | kCGBitmapByteOrder32Little,
        provider, nullptr, false, kCGRenderingIntentDefault);
    CGColorSpaceRelease(cs);
    CGDataProviderRelease(provider);
    if (!img) return;

    CGContextSaveGState(mOwner.mCG);
    // CGContextDrawImage draws y-up and the context is y-down, so flip back over the
    // destination rect — the same compensation drawBitmap makes.
    CGContextTranslateCTM(mOwner.mCG, 0, h);
    CGContextScaleCTM(mOwner.mCG, 1, -1);
    CGContextDrawImage(mOwner.mCG, CGRectMake(0, 0, w, h), img);
    CGContextRestoreGState(mOwner.mCG);
    CGImageRelease(img);
}

void CoreGraphicsPaintContext::Native3D::defineMesh3D(int id,
                                                      const std::vector<int32_t>& indices,
                                                      const std::vector<float>& verts,
                                                      const std::vector<float>& normals,
                                                      const std::vector<float>& uv) {
    if (auto* c = ensure()) c->defineMesh3D(id, indices, verts, normals, uv);
}

void CoreGraphicsPaintContext::Native3D::setCamera3D(int projection,
                                                     const std::vector<float>& projParams,
                                                     const std::vector<float>& viewParams) {
    if (auto* c = ensure()) c->setCamera3D(projection, projParams, viewParams);
}

void CoreGraphicsPaintContext::Native3D::matrix3Op(int sub, const std::vector<float>& args) {
    if (auto* c = ensure()) c->matrix3Op(sub, args);
}

void CoreGraphicsPaintContext::Native3D::drawMesh3D(int meshId, int mode) {
    auto* c = ensure();
    if (!c) return;
    // Base colour comes from the live paint, as the reference reads mPaint.getColor().
    c->setBaseColorArgb((int32_t) mOwner.mPaint.color);

    const int backend = mode >> 1;
    const bool smooth = (mode & rccore::d3::MODE_SMOOTH_MASK) != 0;
    // Wireframe is depth-buffer based and so software-only whatever the backend bits say.
    if (backend == rccore::d3::MODE_BACKEND_CANVAS && !smooth
            && (mode & rccore::d3::MODE_WIREFRAME) == 0) {
        drawMesh3DCanvas(meshId);
        return;
    }
    // Software, and the fallback for every backend this player does not implement — canvas
    // smooth included, since CG cannot interpolate colour across a triangle.
    c->drawMesh3D(meshId, mode);
    blit();
}

void CoreGraphicsPaintContext::Native3D::clearDepth3D() {
    if (auto* c = ensure()) c->clearDepth3D();
}

void CoreGraphicsPaintContext::Native3D::setLights3D(const std::vector<int>& types,
                                                     const std::vector<int32_t>& colors,
                                                     const std::vector<float>& params) {
    if (auto* c = ensure()) c->setLights3D(types, colors, params);
}

void CoreGraphicsPaintContext::Native3D::drawMesh3DCanvas(int meshId) {
    auto* c = ensure();
    if (!c) return;
    auto& cm = mCanvasMesh;
    const int n = c->buildCanvasVertices(meshId, cm, /*smooth=*/false);
    if (n < 3) return;

    // No blit: the triangles go straight onto the CG context, so they composite with the 2D
    // content by CG's rules and pick up antialiasing. That is the point of the backend, and
    // also why it has no depth buffer — ordering is the painter's sort buildCanvasVertices
    // already applied, which is why the loop must not be reordered.
    CGContextSaveGState(mOwner.mCG);
    // Antialiasing OFF, which is not a shortcut. Adjacent triangles share an edge, and two
    // antialiased half-covered edges composite to a visible light seam along every shared
    // edge — the mesh ends up drawn in a net of hairlines. Skia's drawVertices has no such
    // seam because it rasterizes the mesh as one primitive, and it does not antialias vertex
    // meshes either, so turning it off is both the fix and the closer match.
    CGContextSetShouldAntialias(mOwner.mCG, false);
    for (int t = 0; t + 2 < n; t += 3) {
        // Flat shading gives all three vertices the same colour, so vertex 0 is the face's.
        CGFloat rgbaC[4];
        rgba((uint32_t) cm.colors[t], rgbaC);
        CGContextSetRGBFillColor(mOwner.mCG, rgbaC[0], rgbaC[1], rgbaC[2], rgbaC[3]);
        CGContextBeginPath(mOwner.mCG);
        CGContextMoveToPoint(mOwner.mCG, cm.positions[t * 2], cm.positions[t * 2 + 1]);
        CGContextAddLineToPoint(mOwner.mCG, cm.positions[t * 2 + 2], cm.positions[t * 2 + 3]);
        CGContextAddLineToPoint(mOwner.mCG, cm.positions[t * 2 + 4], cm.positions[t * 2 + 5]);
        CGContextClosePath(mOwner.mCG);
        CGContextFillPath(mOwner.mCG);
    }
    CGContextRestoreGState(mOwner.mCG);
}

void CoreGraphicsPaintContext::Native3D::setTexture3D(int bitmapId) {
    auto* c = ensure();
    if (!c) return;
    auto it = mOwner.mImages.find(bitmapId);
    if (it == mOwner.mImages.end() || !it->second) { c->setTextureData({}, 0, 0); return; }
    CGImageRef img = it->second;
    const int w = (int) CGImageGetWidth(img), h = (int) CGImageGetHeight(img);
    if (w <= 0 || h <= 0) { c->setTextureData({}, 0, 0); return; }

    std::vector<int32_t> pixels((size_t) w * h, 0);
    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    // A CGBitmapContext cannot be unpremultiplied, so draw premultiplied and undo it below —
    // the rasterizer's texel maths expects straight alpha.
    CGContextRef bmp = CGBitmapContextCreate(
        pixels.data(), w, h, 8, (size_t) w * 4, cs,
        kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);
    CGColorSpaceRelease(cs);
    if (!bmp) { c->setTextureData({}, 0, 0); return; }
    CGContextDrawImage(bmp, CGRectMake(0, 0, w, h), img);
    CGContextRelease(bmp);

    for (auto& p : pixels) {
        const uint32_t v = (uint32_t) p;
        const uint32_t a = v >> 24;
        if (a == 0) { p = 0; continue; }
        if (a == 255) continue;
        uint32_t r = ((v >> 16) & 0xFF) * 255 / a;
        uint32_t g = ((v >> 8) & 0xFF) * 255 / a;
        uint32_t b = (v & 0xFF) * 255 / a;
        if (r > 255) r = 255;
        if (g > 255) g = 255;
        if (b > 255) b = 255;
        p = (int32_t) ((a << 24) | (r << 16) | (g << 8) | b);
    }
    c->setTextureData(pixels, w, h);
}

void CoreGraphicsPaintContext::Native3D::setMaterial3D(float specStrength, float shininess) {
    if (auto* c = ensure()) c->setMaterial3D(specStrength, shininess);
}

void CoreGraphicsPaintContext::Native3D::setDepthBias3D(float constant, float slope) {
    if (auto* c = ensure()) c->setDepthBias3D(constant, slope);
}

} // namespace rcnative
