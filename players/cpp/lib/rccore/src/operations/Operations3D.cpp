#include "rccore/operations/Operations3D.h"

#include "rccore/ExpressionEvaluator.h"
#include "rccore/PaintContext.h"
#include "rccore/RemoteContext.h"
#include "rccore/Utils.h"
#include "rccore/d3/JavaMath.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>

namespace rccore {
namespace {

// Guards against a malformed or hostile document allocating unbounded buffers.
constexpr int MAX_INDICES = 600000;
constexpr int MAX_VERTS_FLOATS = 3 * 200000;
constexpr int MAX_LIGHTS = 32;
constexpr int MAX_CHANNELS = 8;
constexpr int MAX_EXPR = 4096;
constexpr int MAX_GROUP = 8;
constexpr int MAX_GRID = 1024;

std::vector<float> readFloats(WireBuffer& b, int max, const char* what) {
    int len = b.readInt();
    if (len < 0 || len > max) throw std::runtime_error(std::string(what) + ": bad length");
    std::vector<float> v((size_t) len);
    for (int i = 0; i < len; i++) v[i] = b.readFloat();
    return v;
}

void resolveInto(RemoteContext& ctx, const std::vector<float>& src, std::vector<float>& dst) {
    dst.resize(src.size());
    for (size_t i = 0; i < src.size(); i++) dst[i] = Utils::resolveFloat(src[i], ctx);
}

void listenAll(RemoteContext& ctx, const std::vector<float>& src, Operation* self) {
    for (float v : src) Utils::registerFloatVar(v, ctx, self);
}

/**
 * A token that must be resolved to its current value before evaluation.
 *
 * Operators, array references and the vector opcodes are all NaN-boxed too, and must survive
 * untouched — Utils::isVariable does not distinguish them, so resolving an expression with it
 * turns every operator into `getFloat(id)` and the program into a list of constants. That is
 * exactly what happened to the height-field surface: it rendered as a flat plane because
 * `sin(u*3) * cos(v*3)` had been flattened to literals.
 */
bool isResolvableToken(float v) {
    if (!std::isnan(v)) return false;
    if (ExpressionEvaluator::isMathOperator(v)) return false;
    if (d3::isVectorOp(v)) return false;
    return Utils::isVariable(v);
}

void resolveExpr(RemoteContext& ctx, const std::vector<float>& src, std::vector<float>& dst) {
    dst.resize(src.size());
    for (size_t i = 0; i < src.size(); i++) {
        dst[i] = isResolvableToken(src[i]) ? ctx.getFloat(Utils::idFromNan(src[i])) : src[i];
    }
}

void listenExpr(RemoteContext& ctx, const std::vector<float>& src, Operation* self) {
    for (float v : src) if (isResolvableToken(v)) ctx.listensTo(Utils::idFromNan(v), self);
}

Paint3D* p3d(RemoteContext& ctx) {
    if (ctx.getMode() != ContextMode::PAINT) return nullptr;
    PaintContext* pc = ctx.getPaintContext();
    return pc ? pc->asPaint3D() : nullptr;
}

std::string fmt(float v) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%g", v);
    return buf;
}

} // namespace

// ── DefineMesh3D ──────────────────────────────────────────────────────
std::vector<Field> DefineMesh3D::fields() const {
    return {{"id", "INT", std::to_string(id)},
            {"triangles", "INT", std::to_string(indices.size() / 3)},
            {"vertices", "INT", std::to_string(verts.size() / 3)},
            {"hasNormals", "INT", std::to_string(normals.empty() ? 0 : 1)}};
}

void DefineMesh3D::apply(RemoteContext& context) {
    if (Paint3D* p = p3d(context)) p->defineMesh3D(id, indices, verts, normals, uv);
}

void DefineMesh3D::read(WireBuffer& b, std::vector<std::unique_ptr<Operation>>& ops) {
    auto op = std::make_unique<DefineMesh3D>();
    op->id = b.readInt();
    int idxLen = b.readInt();
    if (idxLen < 0 || idxLen > MAX_INDICES || (idxLen % 3) != 0)
        throw std::runtime_error("DefineMesh3D: bad indices length");
    op->indices.resize((size_t) idxLen);
    for (int i = 0; i < idxLen; i++) op->indices[i] = b.readInt();
    int vertLen = b.readInt();
    if (vertLen < 0 || vertLen > MAX_VERTS_FLOATS || (vertLen % 3) != 0)
        throw std::runtime_error("DefineMesh3D: bad verts length");
    op->verts.resize((size_t) vertLen);
    for (int i = 0; i < vertLen; i++) op->verts[i] = b.readFloat();
    int normLen = b.readInt();
    if (normLen != 0) {
        if (normLen != vertLen) throw std::runtime_error("DefineMesh3D: normals != verts");
        op->normals.resize((size_t) normLen);
        for (int i = 0; i < normLen; i++) op->normals[i] = b.readFloat();
    }
    int uvLen = b.readInt();
    if (uvLen != 0) {
        if (uvLen != (vertLen / 3) * 2) throw std::runtime_error("DefineMesh3D: bad uv length");
        op->uv.resize((size_t) uvLen);
        for (int i = 0; i < uvLen; i++) op->uv[i] = b.readFloat();
    }
    ops.push_back(std::move(op));
}

// ── SetCamera3D ───────────────────────────────────────────────────────
std::vector<Field> SetCamera3D::fields() const {
    return {{"projection", "INT", std::to_string(projection)},
            {"projParams", "INT", std::to_string(projParams.size())},
            {"viewParams", "INT", std::to_string(viewParams.size())}};
}
void SetCamera3D::registerListening(RemoteContext& c) {
    listenAll(c, projParams, this);
    listenAll(c, viewParams, this);
}
void SetCamera3D::updateVariables(RemoteContext& c) {
    resolveInto(c, projParams, oProj);
    resolveInto(c, viewParams, oView);
}
void SetCamera3D::apply(RemoteContext& c) {
    if (Paint3D* p = p3d(c)) p->setCamera3D(projection, oProj, oView);
}
void SetCamera3D::read(WireBuffer& b, std::vector<std::unique_ptr<Operation>>& ops) {
    auto op = std::make_unique<SetCamera3D>();
    op->projection = b.readInt();
    op->projParams = readFloats(b, 16, "SetCamera3D projParams");
    op->viewParams = readFloats(b, 16, "SetCamera3D viewParams");
    op->oProj = op->projParams;
    op->oView = op->viewParams;
    ops.push_back(std::move(op));
}

// ── Matrix3DOp ────────────────────────────────────────────────────────
std::vector<Field> Matrix3DOp::fields() const {
    return {{"sub", "INT", std::to_string(sub)},
            {"args", "INT", std::to_string(args.size())}};
}
void Matrix3DOp::registerListening(RemoteContext& c) { listenAll(c, args, this); }
void Matrix3DOp::updateVariables(RemoteContext& c) { resolveInto(c, args, oArgs); }
void Matrix3DOp::apply(RemoteContext& c) {
    if (Paint3D* p = p3d(c)) p->matrix3Op(sub, oArgs);
}
void Matrix3DOp::read(WireBuffer& b, std::vector<std::unique_ptr<Operation>>& ops) {
    auto op = std::make_unique<Matrix3DOp>();
    op->sub = b.readInt();
    op->args = readFloats(b, 16, "Matrix3DOp args");
    op->oArgs = op->args;
    ops.push_back(std::move(op));
}

// ── DrawMesh3D ────────────────────────────────────────────────────────
std::vector<Field> DrawMesh3D::fields() const {
    return {{"meshId", "INT", std::to_string(meshId)}, {"mode", "INT", std::to_string(mode)}};
}
void DrawMesh3D::apply(RemoteContext& c) {
    if (Paint3D* p = p3d(c)) p->drawMesh3D(meshId, mode);
}
void DrawMesh3D::read(WireBuffer& b, std::vector<std::unique_ptr<Operation>>& ops) {
    auto op = std::make_unique<DrawMesh3D>();
    op->meshId = b.readInt();
    op->mode = b.readInt();
    ops.push_back(std::move(op));
}

// ── Paint3DState ──────────────────────────────────────────────────────
std::vector<Field> Paint3DState::fields() const {
    return {{"sub", "INT", std::to_string(sub)},
            {"params", "INT", std::to_string(params.size())}};
}
void Paint3DState::registerListening(RemoteContext& c) { listenAll(c, params, this); }
void Paint3DState::updateVariables(RemoteContext& c) { resolveInto(c, params, oParams); }
void Paint3DState::apply(RemoteContext& c) {
    Paint3D* p = p3d(c);
    if (!p) return;
    switch (sub) {
        case CLEAR_DEPTH: p->clearDepth3D(); break;
        case MATERIAL: if (oParams.size() >= 2) p->setMaterial3D(oParams[0], oParams[1]); break;
        case DEPTH_BIAS: if (oParams.size() >= 2) p->setDepthBias3D(oParams[0], oParams[1]); break;
        default: break;
    }
}
void Paint3DState::read(WireBuffer& b, std::vector<std::unique_ptr<Operation>>& ops) {
    auto op = std::make_unique<Paint3DState>();
    op->sub = b.readInt();
    op->params = readFloats(b, 8, "Paint3DState params");
    op->oParams = op->params;
    ops.push_back(std::move(op));
}

// ── SetLights3D ───────────────────────────────────────────────────────
std::vector<Field> SetLights3D::fields() const {
    return {{"lights", "INT", std::to_string(types.size())}};
}
void SetLights3D::registerListening(RemoteContext& c) { listenAll(c, params, this); }
void SetLights3D::updateVariables(RemoteContext& c) { resolveInto(c, params, oParams); }
void SetLights3D::apply(RemoteContext& c) {
    if (Paint3D* p = p3d(c)) p->setLights3D(types, colors, oParams);
}
void SetLights3D::read(WireBuffer& b, std::vector<std::unique_ptr<Operation>>& ops) {
    auto op = std::make_unique<SetLights3D>();
    int n = b.readInt();
    if (n < 0 || n > MAX_LIGHTS) throw std::runtime_error("SetLights3D: bad light count");
    op->types.resize((size_t) n);
    op->colors.resize((size_t) n);
    for (int i = 0; i < n; i++) {
        op->types[i] = b.readInt();
        op->colors[i] = b.readInt();
    }
    op->params = readFloats(b, MAX_LIGHTS * 4, "SetLights3D params");
    op->oParams = op->params;
    ops.push_back(std::move(op));
}

// ── SetTexture3D ──────────────────────────────────────────────────────
std::vector<Field> SetTexture3D::fields() const {
    return {{"bitmapId", "INT", std::to_string(bitmapId)}};
}
void SetTexture3D::apply(RemoteContext& c) {
    if (Paint3D* p = p3d(c)) p->setTexture3D(bitmapId);
}
void SetTexture3D::read(WireBuffer& b, std::vector<std::unique_ptr<Operation>>& ops) {
    auto op = std::make_unique<SetTexture3D>();
    op->bitmapId = b.readInt();
    ops.push_back(std::move(op));
}

// ── VectorExpression ──────────────────────────────────────────────────
std::vector<Field> VectorExpression::fields() const {
    return {{"id", "INT", std::to_string(id)},
            {"dimension", "INT", std::to_string(dimension)},
            {"flags", "INT", std::to_string(flags)},
            {"length", "INT", std::to_string(value.size())}};
}
void VectorExpression::registerListening(RemoteContext& c) {
    // Operators and vector opcodes are NaN-boxed like variables but must not be resolved.
    listenExpr(c, value, this);
}
void VectorExpression::updateVariables(RemoteContext& c) {
    resolveExpr(c, value, preCalc);
}
void VectorExpression::apply(RemoteContext& c) {
    if (preCalc.empty()) preCalc = value;
    int lanes = mRpn.apply(preCalc.data(), (int) preCalc.size(), mOut);
    bool finite = true;
    for (int k = 0; k < lanes; k++) if (!std::isfinite(mOut[k])) finite = false;
    if (!finite) {
        // A divide or normalize hit (near-)zero: retry with the soft-domain denominator.
        mRpn.mSoftDomain = true;
        lanes = mRpn.apply(preCalc.data(), (int) preCalc.size(), mOut);
        mRpn.mSoftDomain = false;
    }
    for (int k = 0; k < dimension; k++) {
        float v = (k < lanes) ? mOut[k] : 0.f;
        if (!std::isfinite(v)) v = 0.f;   // never store a non-finite value downstream
        c.loadFloat(id + k, v);
    }
}
void VectorExpression::read(WireBuffer& b, std::vector<std::unique_ptr<Operation>>& ops) {
    auto op = std::make_unique<VectorExpression>();
    op->id = b.readInt();
    op->dimension = b.readByte();
    op->flags = b.readByte();
    int len = b.readShort();
    op->value.resize((size_t) len);
    for (int i = 0; i < len; i++) op->value[i] = b.readFloat();
    op->preCalc = op->value;
    ops.push_back(std::move(op));
}

// ── MeshPrimitive ─────────────────────────────────────────────────────
std::vector<Field> MeshPrimitive::fields() const {
    return {{"id", "INT", std::to_string(id)},
            {"type", "INT", std::to_string(type)},
            {"segments", "FLOAT", fmt(segments)},
            {"flags", "INT", std::to_string(flags)},
            {"channels", "INT", std::to_string(data.size())}};
}
void MeshPrimitive::registerListening(RemoteContext& c) {
    Utils::registerFloatVar(segments, c, this);
    for (const auto& ch : data) listenAll(c, ch, this);
}
void MeshPrimitive::updateVariables(RemoteContext& c) {
    oSegments = Utils::resolveFloat(segments, c);
    oData.resize(data.size());
    for (size_t i = 0; i < data.size(); i++) resolveInto(c, data[i], oData[i]);
    // A driving variable changed, so the geometry regenerates on the next paint.
    mMesh.reset();
    mFailed = false;
}
void MeshPrimitive::apply(RemoteContext& c) {
    Paint3D* p = p3d(c);
    if (!p || mFailed) return;
    if (!mMesh) {
        if (oData.empty()) { oData = data; oSegments = segments; }
        try {
            mMesh = d3::buildPrimitive(type, oSegments, flags, oData);
        } catch (const std::exception& e) {
            // Reported once rather than every frame: an unsupported shape is a gap, not noise.
            mFailed = true;
            std::fprintf(stderr, "MeshPrimitive(id=%d): %s\n", id, e.what());
            return;
        }
    }
    p->defineMesh3D(id, mMesh->indices, mMesh->verts, mMesh->normals, mMesh->uv);
}
void MeshPrimitive::read(WireBuffer& b, std::vector<std::unique_ptr<Operation>>& ops) {
    auto op = std::make_unique<MeshPrimitive>();
    op->id = b.readInt();
    op->type = b.readInt();
    op->segments = b.readFloat();
    op->flags = b.readInt();
    int channels = b.readInt();
    if (channels < 0 || channels > MAX_CHANNELS)
        throw std::runtime_error("MeshPrimitive: bad channel count");
    op->data.resize((size_t) channels);
    for (int ch = 0; ch < channels; ch++) {
        op->data[ch] = readFloats(b, MAX_VERTS_FLOATS, "MeshPrimitive channel");
    }
    op->oData = op->data;
    op->oSegments = op->segments;
    ops.push_back(std::move(op));
}

// ── MeshExpression ────────────────────────────────────────────────────
std::vector<Field> MeshExpression::fields() const {
    return {{"id", "INT", std::to_string(id)},
            {"type", "INT", std::to_string(type)},
            {"flags", "INT", std::to_string(flags)},
            {"params", "INT", std::to_string(params.size())},
            {"posExpressions", "INT", std::to_string(pos.size())}};
}

void MeshExpression::registerListening(RemoteContext& c) {
    listenAll(c, params, this);
    for (const auto& g : {pos, normal, uv}) for (const auto& e : g) listenExpr(c, e, this);
}

void MeshExpression::updateVariables(RemoteContext& c) {
    resolveInto(c, params, oParams);
    auto grp = [&](const std::vector<std::vector<float>>& s,
                   std::vector<std::vector<float>>& d) {
        d.resize(s.size());
        for (size_t i = 0; i < s.size(); i++) resolveExpr(c, s[i], d[i]);
    };
    grp(pos, oPos);
    grp(normal, oNormal);
    grp(uv, oUv);
}

int MeshExpression::gridCount(int axis) const {
    switch (type) {
        case SURFACE_HEIGHT_FIELD: return (int) oParams[axis == 0 ? 2 : 5];
        case SURFACE_SPHERE: return (int) oParams[axis == 0 ? 1 : 2];
        case SURFACE_CYLINDER: return (int) oParams[axis == 0 ? 2 : 3];
        default: return (int) oParams[axis == 0 ? 2 : 5];
    }
}

void MeshExpression::paramsFor(float fu, float fv) {
    auto lerp = [](float a, float b, float t) { return a + (b - a) * t; };
    switch (type) {
        case SURFACE_HEIGHT_FIELD:
            mLastA = lerp(oParams[0], oParams[1], fu);   // x
            mLastB = lerp(oParams[3], oParams[4], fv);   // z
            break;
        case SURFACE_SPHERE:
            mLastA = fu * (float)(2.0 * M_PI);           // longitude
            mLastB = fv * (float) M_PI;                  // latitude
            break;
        case SURFACE_CYLINDER:
            mLastA = fu * (float)(2.0 * M_PI);           // angle
            mLastB = lerp(-oParams[1] * 0.5f, oParams[1] * 0.5f, fv);
            break;
        default:
            mLastA = lerp(oParams[0], oParams[1], fu);
            mLastB = lerp(oParams[3], oParams[4], fv);
            break;
    }
}

float MeshExpression::evalExpr(const std::vector<float>& e, float a, float b,
                               RemoteContext& context) {
    static thread_local ExpressionEvaluator eval;
    eval.setVar1(a);
    eval.setVar2(b);
    return eval.eval(context, nullptr, e.data(), (int) e.size());
}

void MeshExpression::position(int off, float fu, float fv, RemoteContext& context) {
    paramsFor(fu, fv);
    float a = mLastA, b = mLastB;
    switch (type) {
        case SURFACE_HEIGHT_FIELD: {
            float h = evalExpr(oPos[0], a, b, context);
            float yMin = oParams[6], yMax = oParams[7];
            if (h < yMin) h = yMin;
            if (h > yMax) h = yMax;
            mVerts[off] = a; mVerts[off+1] = h; mVerts[off+2] = b;
            break;
        }
        case SURFACE_SPHERE: {
            float r = oParams[0] + evalExpr(oPos[0], a, b, context);
            float sinV = (float) d3::jsin((double)(b));
            mVerts[off] = r * sinV * (float) d3::jcos((double)(a));
            mVerts[off+1] = r * (float) d3::jcos((double)(b));
            mVerts[off+2] = r * sinV * (float) d3::jsin((double)(a));
            break;
        }
        case SURFACE_CYLINDER: {
            float r = oParams[0] + evalExpr(oPos[0], a, b, context);
            mVerts[off] = r * (float) d3::jcos((double)(a));
            mVerts[off+1] = b;
            mVerts[off+2] = r * (float) d3::jsin((double)(a));
            break;
        }
        default:
            mVerts[off] = evalExpr(oPos[0], a, b, context);
            mVerts[off+1] = evalExpr(oPos[1], a, b, context);
            mVerts[off+2] = evalExpr(oPos[2], a, b, context);
            break;
    }
}

void MeshExpression::finiteDifferenceNormals(int uCount, int vCount) {
    for (int i = 0; i < uCount; i++) {
        int ip = std::min(i + 1, uCount - 1), im = std::max(i - 1, 0);
        for (int j = 0; j < vCount; j++) {
            int jp = std::min(j + 1, vCount - 1), jm = std::max(j - 1, 0);
            int a = (ip * vCount + j) * 3, b = (im * vCount + j) * 3;
            int c = (i * vCount + jp) * 3, d = (i * vCount + jm) * 3;
            float dux = mVerts[a] - mVerts[b];
            float duy = mVerts[a+1] - mVerts[b+1];
            float duz = mVerts[a+2] - mVerts[b+2];
            float dvx = mVerts[c] - mVerts[d];
            float dvy = mVerts[c+1] - mVerts[d+1];
            float dvz = mVerts[c+2] - mVerts[d+2];
            float nx = duy * dvz - duz * dvy;
            float ny = duz * dvx - dux * dvz;
            float nz = dux * dvy - duy * dvx;
            float len = (float) d3::jsqrt((double)(nx * nx + ny * ny + nz * nz));
            int n = (i * vCount + j) * 3;
            if (len > 1e-8f) {
                mNormalsBuf[n] = nx / len;
                mNormalsBuf[n+1] = ny / len;
                mNormalsBuf[n+2] = nz / len;
            } else {
                mNormalsBuf[n] = 0.f; mNormalsBuf[n+1] = 1.f; mNormalsBuf[n+2] = 0.f;
            }
        }
    }
}

void MeshExpression::apply(RemoteContext& context) {
    Paint3D* p = p3d(context);
    if (!p) return;
    if (oParams.empty()) { oParams = params; oPos = pos; oNormal = normal; oUv = uv; }

    int uCount = gridCount(0), vCount = gridCount(1);
    if (uCount < 2 || vCount < 2 || uCount > MAX_GRID || vCount > MAX_GRID) return;
    size_t nverts = (size_t) uCount * vCount;
    if (mVerts.size() != nverts * 3) {
        mVerts.assign(nverts * 3, 0.f);
        mNormalsBuf.assign(nverts * 3, 0.f);
        mUvBuf.assign(nverts * 2, 0.f);
    }
    if (mGridU != uCount || mGridV != vCount) {
        mIndices.assign((size_t)(uCount - 1) * (vCount - 1) * 6, 0);
        bool flip = (flags & FLAG_FLIP_WINDING) != 0;
        int k = 0;
        for (int i = 0; i < uCount - 1; i++) {
            for (int j = 0; j < vCount - 1; j++) {
                int a = i * vCount + j, b = i * vCount + (j + 1);
                int c = (i + 1) * vCount + (j + 1), d = (i + 1) * vCount + j;
                if (flip) {
                    mIndices[k++] = a; mIndices[k++] = c; mIndices[k++] = b;
                    mIndices[k++] = c; mIndices[k++] = a; mIndices[k++] = d;
                } else {
                    mIndices[k++] = a; mIndices[k++] = b; mIndices[k++] = c;
                    mIndices[k++] = c; mIndices[k++] = d; mIndices[k++] = a;
                }
            }
        }
        mGridU = uCount; mGridV = vCount;
    }

    // Pass 1: positions and (optional) UV.
    bool hasUv = oUv.size() >= 2;
    for (int i = 0; i < uCount; i++) {
        float fu = i / (float)(uCount - 1);
        for (int j = 0; j < vCount; j++) {
            float fv = j / (float)(vCount - 1);
            int idx = i * vCount + j;
            position(idx * 3, fu, fv, context);
            if (hasUv) {
                mUvBuf[idx * 2] = evalExpr(oUv[0], mLastA, mLastB, context);
                mUvBuf[idx * 2 + 1] = evalExpr(oUv[1], mLastA, mLastB, context);
            } else {
                mUvBuf[idx * 2] = fu;
                mUvBuf[idx * 2 + 1] = fv;
            }
        }
    }
    // Pass 2: normals — explicit expressions, else finite differences of the grid.
    if (oNormal.size() >= 3) {
        for (int i = 0; i < uCount; i++) {
            float fu = i / (float)(uCount - 1);
            for (int j = 0; j < vCount; j++) {
                float fv = j / (float)(vCount - 1);
                int n = (i * vCount + j) * 3;
                paramsFor(fu, fv);
                mNormalsBuf[n] = evalExpr(oNormal[0], mLastA, mLastB, context);
                mNormalsBuf[n+1] = evalExpr(oNormal[1], mLastA, mLastB, context);
                mNormalsBuf[n+2] = evalExpr(oNormal[2], mLastA, mLastB, context);
            }
        }
    } else {
        finiteDifferenceNormals(uCount, vCount);
    }
    p->defineMesh3D(id, mIndices, mVerts, mNormalsBuf, mUvBuf);
}

void MeshExpression::read(WireBuffer& b, std::vector<std::unique_ptr<Operation>>& ops) {
    auto readGroup = [&]() {
        int n = b.readInt();
        if (n < 0 || n > MAX_GROUP) throw std::runtime_error("MeshExpression: bad group count");
        std::vector<std::vector<float>> g((size_t) n);
        for (int i = 0; i < n; i++) g[i] = readFloats(b, MAX_EXPR, "MeshExpression expr");
        return g;
    };
    auto op = std::make_unique<MeshExpression>();
    op->id = b.readInt();
    op->type = b.readInt();
    op->flags = b.readInt();
    op->params = readFloats(b, MAX_EXPR, "MeshExpression params");
    op->pos = readGroup();
    op->normal = readGroup();
    op->uv = readGroup();
    op->oParams = op->params;
    op->oPos = op->pos;
    op->oNormal = op->normal;
    op->oUv = op->uv;
    ops.push_back(std::move(op));
}

} // namespace rccore
