#pragma once
// SoftwarePaint3DContext: the pure-software 3D renderer.
//
// Port of the reference JavaPaint3DContext. Owns an ARGB color buffer and a float depth buffer,
// transforms and lights each triangle, and hands it to the Rasterizer. Nothing here touches a
// canvas, a GPU or a windowing system — the host reads colorBuffer() and composites.

#include <cstdint>
#include <map>
#include <vector>

namespace rccore::d3 {

struct Mesh {
    std::vector<int32_t> indices;
    std::vector<float> verts;
    std::vector<float> normals;   // empty = absent
    std::vector<float> uv;        // empty = absent
};

class SoftwarePaint3DContext {
public:
    SoftwarePaint3DContext();

    /** (Re)allocate the buffers if the size changed. Pixels are NOT cleared — call clearDepth3D. */
    void setSize(int width, int height);
    int width() const { return mWidth; }
    int height() const { return mHeight; }
    const std::vector<int32_t>& colorBuffer() const { return mColor; }

    void setBaseColorArgb(int32_t argb) { mBaseColorArgb = argb; }

    void defineMesh3D(int id, const std::vector<int32_t>& indices,
                      const std::vector<float>& verts, const std::vector<float>& normals,
                      const std::vector<float>& uv = {});
    void setCamera3D(int projection, const std::vector<float>& projParams,
                     const std::vector<float>& viewParams);
    void matrix3Op(int sub, const std::vector<float>& args);
    void drawMesh3D(int meshId, int mode);
    void clearDepth3D();
    void setLights3D(const std::vector<int>& types, const std::vector<int32_t>& colors,
                     const std::vector<float>& params);
    void setMaterial3D(float specStrength, float shininess);
    void setDepthBias3D(float constant, float slope);
    /** Host-supplied texture pixels (ARGB); empty clears the texture. */
    void setTextureData(const std::vector<int32_t>& pixels, int w, int h);

private:
    struct Light {
        int type;
        float r, g, b;
        float wx, wy, wz;
        float intensity;
    };

    void prepareLightsEyeSpace();
    void ensureEyeLightCapacity(int n);
    int32_t litColor(int32_t base, float nx, float ny, float nz,
                     float px, float py, float pz);
    int32_t litColorSpecular(int32_t base, float nfx, float nfy, float nfz,
                             float px, float py, float pz);
    bool projectTriangle(const Mesh& m, bool smooth, bool computeInvW, int t,
                         int32_t baseColor, int w, int h);
    void drawMeshWireframe(const Mesh& m, int32_t lineColor, int w, int h, int mode);

    float mProj[16], mView[16], mModel[16], mPV[16], mMVP[16], mMV[16];
    std::map<int, Mesh> mMeshes;

    std::vector<int32_t> mColor;
    std::vector<float> mZbuf;
    int mWidth = 0, mHeight = 0;
    int32_t mBaseColorArgb = (int32_t) 0xFFFFFFFF;

    std::vector<Light> mLights;
    bool mLightsTouched = false;

    int mNumEyeLights = 0;
    std::vector<int> mEType;
    std::vector<float> mElx, mEly, mElz, mElr, mElg, mElb;

    float mScratch4[4]{};
    float mLightScratch3[3]{};
    float mNormal3[3]{};

    std::vector<int32_t> mTexPixels;
    int mTexW = 0, mTexH = 0;

    float mSpecStrength = 0.f;
    float mShininess = 32.f;
    float mDepthBiasC = 0.f, mDepthBiasS = 0.f;

    float mTriScreen[9]{};
    int32_t mTriColor[3]{};
    float mTriInvW[3]{};
};

} // namespace rccore::d3
