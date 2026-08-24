/*
 * rc3d — render a real .rc document's 3D pass with the C++ player and write it to PNG.
 *
 * Unlike d3scene, which drives the renderer from a scene script, this goes through the whole
 * pipeline: WireBuffer -> CoreDocument -> the ten registered 3D operations -> Paint3D. That is
 * what makes it an end-to-end check rather than an engine check — it exercises decoding,
 * variable resolution and per-frame regeneration on documents authored as JSON.
 *
 *   rc3d doc.rc out.png [--width N] [--height N] [--frames N]
 *
 * Only the 3D surface is implemented. The 2D calls are no-ops, so the output is the 3D colour
 * buffer alone: exactly what the TypeScript player composites onto its canvas, and therefore
 * directly comparable.
 */
#include "rccore/CoreDocument.h"
#include "rccore/PaintBundle.h"
#include "rccore/PaintContext.h"
#include "rccore/RemoteContext.h"
#include "rccore/WireBuffer.h"
#include "rccore/d3/HeadlessPaint3DContext.h"
#include "rccore/d3/SoftwarePaint3DContext.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
#include <zlib.h>

using namespace rccore;

namespace {

// The headless 3D PaintContext is shared with tools/d3scene; see the header.
using Headless3DPaintContext = d3::HeadlessPaint3DContext;

// PNG writing: direct, for the reason in 3D_PLAN.md — an image library that premultiplies
// alpha silently corrupts every pixel whose alpha is not 255.
uint32_t crcTable[256];
bool crcReady = false;
uint32_t crc32of(const uint8_t* buf, size_t len) {
    if (!crcReady) {
        for (uint32_t n = 0; n < 256; n++) {
            uint32_t c = n;
            for (int k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
            crcTable[n] = c;
        }
        crcReady = true;
    }
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >> 8);
    return c ^ 0xFFFFFFFFu;
}
void be32(std::vector<uint8_t>& v, uint32_t x) {
    v.push_back((uint8_t)(x >> 24)); v.push_back((uint8_t)(x >> 16));
    v.push_back((uint8_t)(x >> 8)); v.push_back((uint8_t) x);
}
void chunk(std::vector<uint8_t>& out, const char* type, const std::vector<uint8_t>& data) {
    be32(out, (uint32_t) data.size());
    std::vector<uint8_t> body(type, type + 4);
    body.insert(body.end(), data.begin(), data.end());
    out.insert(out.end(), body.begin(), body.end());
    be32(out, crc32of(body.data(), body.size()));
}
bool writePng(const std::string& path, const std::vector<int32_t>& argb, int w, int h) {
    std::vector<uint8_t> raw;
    raw.reserve((size_t)(w * 4 + 1) * h);
    for (int y = 0; y < h; y++) {
        raw.push_back(0);
        for (int x = 0; x < w; x++) {
            int32_t p = argb[(size_t) y * w + x];
            raw.push_back((uint8_t)((p >> 16) & 0xFF));
            raw.push_back((uint8_t)((p >> 8) & 0xFF));
            raw.push_back((uint8_t)(p & 0xFF));
            raw.push_back((uint8_t)((p >> 24) & 0xFF));
        }
    }
    uLongf destLen = compressBound((uLong) raw.size());
    std::vector<uint8_t> comp(destLen);
    if (compress2(comp.data(), &destLen, raw.data(), (uLong) raw.size(), 9) != Z_OK) return false;
    comp.resize(destLen);
    std::vector<uint8_t> out = {0x89,'P','N','G',0x0D,0x0A,0x1A,0x0A};
    std::vector<uint8_t> ihdr;
    be32(ihdr, (uint32_t) w); be32(ihdr, (uint32_t) h);
    ihdr.push_back(8); ihdr.push_back(6);
    ihdr.push_back(0); ihdr.push_back(0); ihdr.push_back(0);
    chunk(out, "IHDR", ihdr);
    chunk(out, "IDAT", comp);
    chunk(out, "IEND", {});
    std::ofstream f(path, std::ios::binary);
    if (!f) return false;
    f.write((const char*) out.data(), (std::streamsize) out.size());
    return f.good();
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::cerr << "usage: rc3d <doc.rc> <out.png> [--width N] [--height N] [--frames N]\n";
        return 2;
    }
    auto flag = [&](const char* name, int dflt) {
        for (int i = 3; i + 1 < argc; i++)
            if (std::string(argv[i]) == std::string("--") + name) return std::atoi(argv[i + 1]);
        return dflt;
    };
    std::ifstream in(argv[1], std::ios::binary);
    if (!in) { std::cerr << "cannot open " << argv[1] << "\n"; return 2; }
    std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(in)),
                               std::istreambuf_iterator<char>());
    WireBuffer buffer(bytes.data(), bytes.size());
    CoreDocument doc;
    if (!doc.initFromBuffer(buffer)) { std::cerr << "failed to parse\n"; return 1; }

    int w = flag("width", doc.getWidth() > 0 ? doc.getWidth() : 400);
    int h = flag("height", doc.getHeight() > 0 ? doc.getHeight() : 400);
    int frames = flag("frames", 1);
    doc.setWidth(w);
    doc.setHeight(h);

    RemoteContext context;
    Headless3DPaintContext pc(context, w, h);
    context.setPaintContext(&pc);
    doc.registerListeners(context);
    doc.applyDataOperations(context);
    // Pin the clock so a render is reproducible and comparable across players. Without this
    // continuousSec() reads wall time and two players never agree on anything animated.
    float at = (float) flag("time", 0);
    for (int f = 0; f < frames; f++) {
        context.loadFloat(RemoteContext::ID_ANIMATION_TIME, at);
        context.loadFloat(RemoteContext::ID_CONTINUOUS_SEC, at);
        context.loadFloat(RemoteContext::ID_TIME_IN_SEC, at);
        doc.paint(context);
    }
    if (!writePng(argv[2], pc.engine().colorBuffer(), w, h)) {
        std::cerr << "failed to write " << argv[2] << "\n";
        return 1;
    }
    std::cout << "wrote " << argv[2] << " (" << w << "x" << h << ")\n";
    return 0;
}
