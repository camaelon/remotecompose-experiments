/*
 * d3scene — render a 3D scene script with the C++ software renderer.
 *
 * Consumes the same scene scripts as the Java oracle (players/3d-oracle/scenes) and the
 * TypeScript harness, so all three renderers are driven from one input and any difference is a
 * port bug rather than a difference in setup.
 *
 * PNG is written directly rather than through an image library, for the reason recorded in
 * 3D_PLAN.md: the TypeScript harness went through node-canvas, whose premultiplied ImageData
 * silently corrupted every pixel with alpha != 255 and produced 1456 phantom failures.
 */
#include "rccore/d3/Paint3DContext.h"
#include "rccore/d3/Primitive3D.h"
#include "rccore/d3/SoftwarePaint3DContext.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <zlib.h>

using namespace rccore::d3;

namespace {

std::vector<std::string> split(const std::string& s, char sep) {
    std::vector<std::string> out;
    std::string cur;
    std::istringstream in(s);
    while (std::getline(in, cur, sep)) out.push_back(cur);
    return out;
}

std::vector<std::string> tokens(const std::string& line) {
    std::vector<std::string> out;
    std::istringstream in(line);
    std::string t;
    while (in >> t) out.push_back(t);
    return out;
}

std::vector<float> floatsCsv(const std::string& s) {
    std::vector<float> out;
    for (const std::string& p : split(s, ',')) {
        if (!p.empty()) out.push_back(std::strtof(p.c_str(), nullptr));
    }
    return out;
}

/** Axis-aligned cube of edge 2*s as six independent quads. Matches Oracle.java's cube(). */
struct CubeMesh {
    std::vector<int32_t> idx;
    std::vector<float> verts, normals, uv;
};

CubeMesh makeCube(float s) {
    const float faces[6][3] = {{0,0,1},{0,0,-1},{1,0,0},{-1,0,0},{0,1,0},{0,-1,0}};
    CubeMesh c;
    c.verts.resize(6 * 4 * 3);
    c.normals.resize(6 * 4 * 3);
    c.uv.resize(6 * 4 * 2);
    c.idx.resize(6 * 6);
    for (int f = 0; f < 6; f++) {
        float nx = faces[f][0], ny = faces[f][1], nz = faces[f][2];
        float ax, ay, az, bx, by, bz;
        if (nz != 0) { ax = nz; ay = 0; az = 0; bx = 0; by = 1; bz = 0; }
        else if (nx != 0) { ax = 0; ay = 0; az = -nx; bx = 0; by = 1; bz = 0; }
        else { ax = 1; ay = 0; az = 0; bx = 0; by = 0; bz = -ny; }
        const float corner[4][2] = {{-1,-1},{1,-1},{1,1},{-1,1}};
        for (int k = 0; k < 4; k++) {
            int vi = (f * 4 + k) * 3;
            float u = corner[k][0], v = corner[k][1];
            c.verts[vi] = (nx + ax * u + bx * v) * s;
            c.verts[vi + 1] = (ny + ay * u + by * v) * s;
            c.verts[vi + 2] = (nz + az * u + bz * v) * s;
            c.normals[vi] = nx; c.normals[vi + 1] = ny; c.normals[vi + 2] = nz;
            c.uv[(f * 4 + k) * 2] = (u + 1) * 0.5f;
            c.uv[(f * 4 + k) * 2 + 1] = (v + 1) * 0.5f;
        }
        int b = f * 4, o = f * 6;
        c.idx[o] = b; c.idx[o+1] = b+1; c.idx[o+2] = b+2;
        c.idx[o+3] = b; c.idx[o+4] = b+2; c.idx[o+5] = b+3;
    }
    return c;
}

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
        raw.push_back(0);   // filter type 0 (none) per scanline
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
    be32(ihdr, (uint32_t) w);
    be32(ihdr, (uint32_t) h);
    ihdr.push_back(8);    // bit depth
    ihdr.push_back(6);    // color type RGBA
    ihdr.push_back(0); ihdr.push_back(0); ihdr.push_back(0);
    chunk(out, "IHDR", ihdr);
    chunk(out, "IDAT", comp);
    chunk(out, "IEND", {});

    std::ofstream f(path, std::ios::binary);
    if (!f) return false;
    f.write((const char*) out.data(), (std::streamsize) out.size());
    return f.good();
}

int matrixSub(const std::string& n) {
    if (n == "identity") return M3_IDENTITY;
    if (n == "translate") return M3_TRANSLATE;
    if (n == "scale") return M3_SCALE;
    if (n == "rotate") return M3_ROTATE_AXIS;
    if (n == "multiply") return M3_MULTIPLY;
    throw std::runtime_error("bad matrix sub: " + n);
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::cerr << "usage: d3scene <scene.txt> <out.png>\n";
        return 2;
    }
    SoftwarePaint3DContext ctx;
    int w = 256, h = 256;
    ctx.setSize(w, h);

    std::ifstream in(argv[1]);
    if (!in) { std::cerr << "cannot open " << argv[1] << "\n"; return 2; }
    std::string line;
    while (std::getline(in, line)) {
        // trim
        size_t a = line.find_first_not_of(" \t\r\n");
        if (a == std::string::npos) continue;
        size_t b = line.find_last_not_of(" \t\r\n");
        line = line.substr(a, b - a + 1);
        if (line.empty() || line[0] == '#') continue;
        std::vector<std::string> t = tokens(line);

        if (t[0] == "size") {
            w = std::stoi(t[1]); h = std::stoi(t[2]);
            ctx.setSize(w, h);
        } else if (t[0] == "color") {
            ctx.setBaseColorArgb((int32_t)(uint32_t) std::stoul(t[1], nullptr, 16));
        } else if (t[0] == "clearDepth") {
            ctx.clearDepth3D();
        } else if (t[0] == "camera") {
            int proj = (t[1] == "ortho") ? PROJECTION_ORTHO : PROJECTION_PERSPECTIVE;
            size_t bar = 0;
            while (bar < t.size() && t[bar] != "|") bar++;
            std::vector<float> p, v;
            for (size_t i = 2; i < bar; i++) p.push_back(std::strtof(t[i].c_str(), nullptr));
            for (size_t i = bar + 1; i < t.size(); i++)
                v.push_back(std::strtof(t[i].c_str(), nullptr));
            ctx.setCamera3D(proj, p, v);
        } else if (t[0] == "matrix") {
            std::vector<float> args;
            for (size_t i = 2; i < t.size(); i++)
                args.push_back(std::strtof(t[i].c_str(), nullptr));
            ctx.matrix3Op(matrixSub(t[1]), args);
        } else if (t[0] == "lights") {
            int n = (int)(t.size() - 1) / 6;
            std::vector<int> types(n);
            std::vector<int32_t> colors(n);
            std::vector<float> params(n * 4);
            for (int i = 0; i < n; i++) {
                size_t base = 1 + (size_t) i * 6;
                types[i] = (t[base] == "point") ? LIGHT_POINT : LIGHT_DIRECTIONAL;
                colors[i] = (int32_t)(uint32_t) std::stoul(t[base + 1], nullptr, 16);
                for (int k = 0; k < 4; k++)
                    params[i * 4 + k] = std::strtof(t[base + 2 + k].c_str(), nullptr);
            }
            ctx.setLights3D(types, colors, params);
        } else if (t[0] == "material") {
            ctx.setMaterial3D(std::strtof(t[1].c_str(), nullptr),
                              std::strtof(t[2].c_str(), nullptr));
        } else if (t[0] == "depthBias") {
            ctx.setDepthBias3D(std::strtof(t[1].c_str(), nullptr),
                               std::strtof(t[2].c_str(), nullptr));
        } else if (t[0] == "draw") {
            ctx.drawMesh3D(std::stoi(t[1]), std::stoi(t[2]));
        } else if (t[0] == "mesh") {
            int id = std::stoi(t[1]);
            if (t[2] == "cube") {
                CubeMesh c = makeCube(t.size() > 3 ? std::strtof(t[3].c_str(), nullptr) : 1.f);
                ctx.defineMesh3D(id, c.idx, c.verts, c.normals, c.uv);
            } else if (t[2] == "tri") {
                ctx.defineMesh3D(id, {0, 1, 2},
                                 {-1, -1, 0, 1, -1, 0, 0, 1, 0}, {}, {});
            } else if (t[2] == "prim") {
                int ptype = std::stoi(t[3]);
                float segs = std::strtof(t[4].c_str(), nullptr);
                int pflags = std::stoi(t[5]);
                std::vector<std::vector<float>> chans;
                for (size_t c = 6; c < t.size(); c++) chans.push_back(floatsCsv(t[c]));
                MeshData m = buildPrimitive(ptype, segs, pflags, chans);
                ctx.defineMesh3D(id, m.indices, m.verts, m.normals, m.uv);
            } else if (t[2] == "raw") {
                std::vector<int32_t> idx;
                std::vector<float> verts, norms;
                for (size_t k = 3; k < t.size(); k++) {
                    size_t c = t[k].find(':');
                    std::string key = t[k].substr(0, c);
                    for (const std::string& s : split(t[k].substr(c + 1), ',')) {
                        if (s.empty()) continue;
                        if (key == "i") idx.push_back(std::stoi(s));
                        else if (key == "v") verts.push_back(std::strtof(s.c_str(), nullptr));
                        else norms.push_back(std::strtof(s.c_str(), nullptr));
                    }
                }
                ctx.defineMesh3D(id, idx, verts, norms, {});
            } else {
                std::cerr << "unknown mesh kind: " << t[2] << "\n";
                return 2;
            }
        } else {
            // An unknown command is a scene-script bug, not something to skip: a typo that
            // drops a draw call renders an empty image that still "passes".
            std::cerr << "unknown scene command: " << t[0] << "\n";
            return 2;
        }
    }

    if (!writePng(argv[2], ctx.colorBuffer(), w, h)) {
        std::cerr << "failed to write " << argv[2] << "\n";
        return 1;
    }
    std::cout << "wrote " << argv[2] << " (" << w << "x" << h << ")\n";
    return 0;
}
