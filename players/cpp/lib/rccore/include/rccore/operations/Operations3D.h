#pragma once
// The ten 3D operations (opcodes 110-118, 120).
//
// Each decodes its payload and dispatches to PaintContext::asPaint3D(), which is null on a
// 2D-only backend — so a 3D document degrades to drawing nothing rather than failing to load.
//
// Six of the ten carry variable support: any float in the payload may be a NaN-boxed variable id
// that re-resolves each frame. That is what separates this from a mesh format — a primitive's
// radius, a camera's eye position and a light's direction are all expressions.

#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"
#include "rccore/d3/Primitive3D.h"
#include "rccore/d3/VectorRpn.h"

#include <cstdint>
#include <memory>
#include <optional>
#include <vector>

namespace rccore {

/** Upload (or replace) a cached mesh keyed by id. */
class DefineMesh3D : public Operation {
public:
    static constexpr int OP_CODE = 110;
    int id = 0;
    std::vector<int32_t> indices;
    std::vector<float> verts, normals, uv;

    std::string name() const override { return "DEFINE_MESH_3D"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override;
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops);
};

/** Set projection and view in one call. Reactive. */
class SetCamera3D : public Operation {
public:
    static constexpr int OP_CODE = 111;
    int projection = 0;
    std::vector<float> projParams, viewParams;
    std::vector<float> oProj, oView;

    std::string name() const override { return "SET_CAMERA_3D"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops);
};

/** Post-multiply the modelview by a transform. Reactive. */
class Matrix3DOp : public Operation {
public:
    static constexpr int OP_CODE = 112;
    int sub = 0;
    std::vector<float> args, oArgs;

    std::string name() const override { return "MATRIX_3D_OP"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops);
};

/** Draw a cached mesh with the current modelview, projection and paint color. */
class DrawMesh3D : public Operation {
public:
    static constexpr int OP_CODE = 113;
    int meshId = 0;
    int mode = 0;

    std::string name() const override { return "DRAW_MESH_3D"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override;
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops);
};

/** Consolidated render state: clear-depth, material, or depth-bias. Reactive. */
class Paint3DState : public Operation {
public:
    static constexpr int OP_CODE = 114;
    static constexpr int CLEAR_DEPTH = 0;
    static constexpr int MATERIAL = 1;
    static constexpr int DEPTH_BIAS = 2;
    int sub = 0;
    std::vector<float> params, oParams;

    std::string name() const override { return "PAINT_3D_STATE"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops);
};

/** Define the entire light set in one op. Reactive in the parameter block. */
class SetLights3D : public Operation {
public:
    static constexpr int OP_CODE = 115;
    std::vector<int> types;
    std::vector<int32_t> colors;
    std::vector<float> params, oParams;

    std::string name() const override { return "SET_LIGHTS_3D"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops);
};

/** A vec2/3/4-valued expression; scatters its components to id..id+dimension-1. */
class VectorExpression : public Operation {
public:
    static constexpr int OP_CODE = 116;
    int id = 0;
    int dimension = 0;
    int flags = 0;
    std::vector<float> value, preCalc;

    std::string name() const override { return "VECTOR_EXPRESSION"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops);

private:
    d3::VectorRpn mRpn;
    float mOut[d3::VEC_MAX_DIM]{};
};

/** Set the active texture; bitmapId 0 clears it. */
class SetTexture3D : public Operation {
public:
    static constexpr int OP_CODE = 118;
    int bitmapId = 0;

    std::string name() const override { return "SET_TEXTURE_3D"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override;
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops);
};

/**
 * Define a mesh from a parametric primitive. The geometry math lives in Primitive3D; this op
 * carries the type, a sampling control and the parameter channels, and builds the mesh on first
 * paint. A change to a driving variable invalidates the cached geometry.
 */
class MeshPrimitive : public Operation {
public:
    static constexpr int OP_CODE = 120;
    int id = 0;
    int type = 0;
    float segments = 0.f;
    int flags = 0;
    std::vector<std::vector<float>> data, oData;
    float oSegments = 0.f;

    std::string name() const override { return "MESH_PRIMITIVE_3D"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops);

private:
    std::optional<d3::MeshData> mMesh;
    /** Set once if the build throws, so a broken shape is reported once, not every frame. */
    bool mFailed = false;
};

/**
 * Procedural mesh from RPN expressions over a (u,v) grid — the 3D analogue of PathExpression.
 * Four surface families; because the expressions can reference time, the *surface* animates.
 */
class MeshExpression : public Operation {
public:
    static constexpr int OP_CODE = 117;
    static constexpr int SURFACE_GENERAL = 0;
    static constexpr int SURFACE_HEIGHT_FIELD = 1;
    static constexpr int SURFACE_SPHERE = 2;
    static constexpr int SURFACE_CYLINDER = 3;
    static constexpr int FLAG_FLIP_WINDING = 0x1;

    int id = 0;
    int type = 0;
    int flags = 0;
    std::vector<float> params, oParams;
    std::vector<std::vector<float>> pos, normal, uv;
    std::vector<std::vector<float>> oPos, oNormal, oUv;

    std::string name() const override { return "MESH_EXPRESSION_3D"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops);

private:
    void paramsFor(float fu, float fv);
    void position(int off, float fu, float fv, RemoteContext& context);
    void finiteDifferenceNormals(int uCount, int vCount);
    int gridCount(int axis) const;
    float evalExpr(const std::vector<float>& e, float a, float b, RemoteContext& context);

    std::vector<float> mVerts, mNormalsBuf, mUvBuf;
    std::vector<int32_t> mIndices;
    int mGridU = -1, mGridV = -1;
    float mLastA = 0.f, mLastB = 0.f;
};

} // namespace rccore
