// rc2image-native — the Skia-free twin of rc2image.
//
// Same engine, same arguments, same output format; the only difference is the paint backend:
// rcnative's CoreGraphicsPaintContext instead of rcskia's SkiaPaintContext. It exists so the
// two backends can be diffed pixel for pixel on the desktop, which is a great deal faster
// than comparing screenshots of two apps on a phone.
//
// Two deliberate differences from rc2image:
//   - No RcDocumentHost, so embedded "rc:<file>" sub-documents do not resolve. That host is
//     a rcskia class; a document that embeds another renders the outer one only.
//   - The bitmap context is y-up, so the paint context is constructed with yDown=false and
//     flips it itself. A UIView drawRect context is the other case.

#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rcnative/CoreGraphicsPaintContext.h"

#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>
#include <CoreFoundation/CoreFoundation.h>

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

static bool writePng(const char* path, CGContextRef bmp) {
    CGImageRef img = CGBitmapContextCreateImage(bmp);
    if (!img) return false;
    CFStringRef s = CFStringCreateWithCString(nullptr, path, kCFStringEncodingUTF8);
    CFURLRef url = CFURLCreateWithFileSystemPath(nullptr, s, kCFURLPOSIXPathStyle, false);
    CFRelease(s);
    if (!url) { CGImageRelease(img); return false; }
    CGImageDestinationRef dst = CGImageDestinationCreateWithURL(url, CFSTR("public.png"), 1, nullptr);
    CFRelease(url);
    if (!dst) { CGImageRelease(img); return false; }
    CGImageDestinationAddImage(dst, img, nullptr);
    const bool ok = CGImageDestinationFinalize(dst);
    CFRelease(dst);
    CGImageRelease(img);
    return ok;
}

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: rc2image-native input.rcd output.png [width height]"
                     " [--time epoch_ms] [--anim seconds]\n";
        return 1;
    }

    const char* inputPath = argv[1];
    const char* outputPath = argv[2];
    int overrideWidth = 0, overrideHeight = 0;
    int64_t fixedTimeMs = 0;
    float animTimeSec = -1.0f;

    int i = 3;
    while (i < argc) {
        if (std::strcmp(argv[i], "--time") == 0 && i + 1 < argc) {
            fixedTimeMs = std::atoll(argv[i + 1]);
            i += 2;
        } else if (std::strcmp(argv[i], "--anim") == 0 && i + 1 < argc) {
            animTimeSec = std::atof(argv[i + 1]);
            i += 2;
        } else if (overrideWidth == 0 && i + 1 < argc && std::atoi(argv[i]) > 0) {
            overrideWidth = std::atoi(argv[i]);
            overrideHeight = std::atoi(argv[i + 1]);
            i += 2;
        } else {
            i++;
        }
    }

    std::ifstream ifs(inputPath, std::ios::binary);
    if (!ifs) {
        std::cerr << "Error: cannot open " << inputPath << "\n";
        return 1;
    }
    std::vector<uint8_t> data((std::istreambuf_iterator<char>(ifs)),
                              std::istreambuf_iterator<char>());
    ifs.close();
    if (data.empty()) {
        std::cerr << "Error: empty file\n";
        return 1;
    }

    rccore::WireBuffer buffer(data.data(), data.size());
    rccore::CoreDocument doc;
    if (!doc.initFromBuffer(buffer)) {
        std::cerr << "Error: failed to parse " << inputPath << "\n";
        return 1;
    }
    if (fixedTimeMs > 0) doc.setFixedTimeMs(fixedTimeMs);

    int width = overrideWidth > 0 ? overrideWidth : doc.getWidth();
    int height = overrideHeight > 0 ? overrideHeight : doc.getHeight();
    if (width <= 0) width = 600;
    if (height <= 0) height = 600;

    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    CGContextRef bmp = CGBitmapContextCreate(
        nullptr, width, height, 8, 0, cs,
        kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);
    CGColorSpaceRelease(cs);
    if (!bmp) {
        std::cerr << "Error: failed to create bitmap context\n";
        return 1;
    }
    // White background, matching rc2image and the TS renderer.
    CGContextSetRGBFillColor(bmp, 1, 1, 1, 1);
    CGContextFillRect(bmp, CGRectMake(0, 0, width, height));

    rccore::RemoteContext context;
    // yDown=false: a bare bitmap context is y-up and the backend flips it.
    rcnative::CoreGraphicsPaintContext paintCtx(context, bmp, (float) width, (float) height, false);
    context.setPaintContext(&paintCtx);
    context.setDocument(&doc);
    context.mWidth = (float) width;
    context.mHeight = (float) height;

    doc.registerListeners(context);
    if (animTimeSec >= 0.0f) {
        context.overrideFloat(rccore::RemoteContext::ID_ANIMATION_TIME, animTimeSec);
    }
    doc.applyDataOperations(context, -2);   // THEME_DARK

    // RC_FRAMES: an Impulse-driven document runs only its init block on the first pass, so a
    // single-frame capture of a particle document is legitimately empty rather than broken.
    int frames = 1;
    if (const char* f = std::getenv("RC_FRAMES")) frames = std::max(1, std::atoi(f));
    int sweep = 0;
    if (const char* s = std::getenv("RC_ANIM_SWEEP")) sweep = std::max(0, std::atoi(s));
    if (sweep > 1 && animTimeSec >= 0.0f) {
        for (int n = 0; n < sweep; n++) {
            float t = animTimeSec * (float) n / (float) (sweep - 1);
            context.overrideFloat(rccore::RemoteContext::ID_ANIMATION_TIME, t);
            doc.paint(context, -2);
        }
    } else {
        for (int n = 0; n < frames; n++) doc.paint(context, -2);
    }

    if (!writePng(outputPath, bmp)) {
        std::cerr << "Error: cannot write " << outputPath << "\n";
        CGContextRelease(bmp);
        return 1;
    }
    CGContextRelease(bmp);

    std::cout << "Success: " << inputPath << " -> " << outputPath
              << " (" << width << "x" << height << ")\n";
    return 0;
}
