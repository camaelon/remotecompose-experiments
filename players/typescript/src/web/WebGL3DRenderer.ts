/**
 * GPU rasterizer for the 3D canvas backend.
 *
 * Draws screen-space triangles produced by `SoftwarePaint3DContext.buildCanvasVertices`
 * into an offscreen WebGL2 canvas, which the caller composites with
 * `ctx.drawImage(renderer.getCanvas(), …)`. Same offscreen-and-composite shape as
 * WebGLShaderRenderer, for the same reason: Canvas2D has no way to draw a shaded triangle
 * mesh, and going through WebGL for the whole 2D surface would mean reimplementing it.
 *
 * Canvas2D genuinely cannot do this. There is no `drawVertices`: flat triangles could be
 * filled as paths, but Gouraud shading — a different colour at each vertex of one triangle
 * — has no Canvas2D expression at all. That is what forces WebGL here where the C++ player
 * could simply call SkCanvas::drawVertices.
 *
 * Unlike either Android accelerated backend, this one has a **real depth buffer**. The
 * reference's canvas path sorts back-to-front and lives with the artefacts, and its
 * DRAWMESH_ZBUF path resolves depth in a two-pass shader to work around Canvas not having
 * one. Here a depth attachment is free, so interpenetrating geometry is simply correct when
 * the mode asks for it.
 */

/** Vertices as buildCanvasVertices produces them: window pixels, ARGB, window z in [0,1]. */
export interface Mesh3DBatch {
    positions: Float32Array;
    colors: Int32Array;
    uvs: Float32Array;
    depths: Float32Array;
    hasUv: boolean;
    vertexCount: number;
}

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;      // window pixels, y down
layout(location = 1) in vec4 aColor;    // straight (non-premultiplied) RGBA
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aDepth;   // window z in [0,1], smaller = closer
uniform vec2 uViewport;
out vec4 vColor;
out vec2 vUv;
void main() {
    // Window pixels to clip space. The y flip is the whole conversion: our window origin is
    // top-left with y increasing downward, clip space is centre-origin with y up.
    vec2 clip = vec2(aPos.x / uViewport.x * 2.0 - 1.0,
                     1.0 - aPos.y / uViewport.y * 2.0);
    // Depth [0,1] to clip [-1,1], matching the default depth range so gl.LESS means the
    // same thing here as the software rasterizer's "smaller z wins".
    gl_Position = vec4(clip, aDepth * 2.0 - 1.0, 1.0);
    vColor = aColor;
    vUv = aUv;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec4 vColorW;
in float vW;
in vec2 vUv;
uniform sampler2D uTex;
uniform bool uUseTex;
out vec4 fragColor;
void main() {
    vec4 c = vColorW / vW;   // undo the perspective weighting: screen-affine, as software
    if (uUseTex) {
        // Lighting modulates the sampled texel, as the reference does with a BitmapShader.
        c *= texture(uTex, vUv);
    }
    if (c.a <= 0.0) discard;
    // Premultiplied out, because the canvas is created with premultipliedAlpha and
    // compositing it with drawImage otherwise darkens every antialiased edge.
    fragColor = vec4(c.rgb * c.a, c.a);
}`;


// ── Model-space pipeline (MODE_BACKEND_GL, modes 6/7) ───────────────────────────────────
//
// The path above is a *screen-space* rasterizer: the CPU transforms, lights, clips and
// projects every vertex each frame and the GPU only fills triangles. That is what the canvas
// backends ask for. The GL backend is a different thing — geometry is uploaded once and lives
// on the GPU, and the transform and the lighting happen in the shaders.
//
// The shading below is a transcription of SoftwarePaint3DContext.litColor /
// litColorSpecular, not an interpretation of it. Where the two can differ is written down in
// GL_DIVERGENCES at the bottom of this file; everything else is meant to match.

const LIGHT_FN = `
const float AMBIENT = 0.2;
const int LIGHT_POINT_T = 1;
uniform int uNumLights;
uniform int uLightType[32];
uniform vec3 uLightVec[32];      // directional: unit vector TOWARD the light; point: eye pos
uniform vec3 uLightColor[32];    // intensity already folded in
uniform float uSpecStrength;
uniform float uShininess;
uniform vec4 uBaseColor;

vec4 shade(vec3 n, vec3 p) {
    float nlen = length(n);
    vec3 N = nlen > 0.0 ? n / nlen : vec3(0.0);
    vec3 l = vec3(AMBIENT);
    vec3 s = vec3(0.0);
    if (uSpecStrength > 0.0) {
        // Glossy: the normal is flipped to face the viewer so highlights land on the lit
        // side only, and a light behind the surface contributes nothing at all -- unlike
        // the matte path below, which is two-sided.
        vec3 V = length(p) > 0.0 ? normalize(-p) : vec3(0.0, 0.0, 1.0);
        vec3 Nf = dot(N, V) < 0.0 ? -N : N;
        for (int i = 0; i < uNumLights; i++) {
            vec3 L = uLightType[i] == LIGHT_POINT_T ? normalize(uLightVec[i] - p) : uLightVec[i];
            float ndl = dot(Nf, L);
            if (ndl <= 0.0) { continue; }
            l += uLightColor[i] * ndl;
            vec3 H = L + V;
            float hlen = length(H);
            if (hlen <= 0.0) { continue; }
            float ndh = dot(Nf, H) / hlen;
            if (ndh <= 0.0) { continue; }
            s += uLightColor[i] * (pow(ndh, uShininess) * uSpecStrength);
        }
    } else {
        for (int i = 0; i < uNumLights; i++) {
            vec3 L = uLightType[i] == LIGHT_POINT_T ? normalize(uLightVec[i] - p) : uLightVec[i];
            l += uLightColor[i] * abs(dot(N, L));   // two-sided at this profile
        }
    }
    return vec4(min(uBaseColor.rgb * l + s, vec3(1.0)), uBaseColor.a);
}
`;

// `vColorW` is the lit colour premultiplied by clip w, and `vW` is that w.
//
// GLSL interpolates a varying perspective-correct. The software Gouraud fill interpolates
// vertex colour with plain screen-space barycentrics — only its *texture* coordinates are
// perspective-correct, which is why it tracks 1/w separately for those alone. On a triangle
// with any depth across it the two disagree, and on the crane that was 64 levels in the
// middle of a face: far outside rounding, and not a shape error, so only a metric that looks
// away from the edges finds it.
//
// GLSL ES 3.00 has no `noperspective` qualifier — that is desktop GL — so the division is
// done by hand. Interpolating `a*w` and `w` perspective-correctly and dividing one by the
// other yields exactly the screen-affine value, because both carry the same 1/w weighting
// and it cancels. UV is left alone.
const MODEL_HEAD = `#version 300 es
precision highp float;
uniform mat4 uMVP;
uniform mat4 uMV;
uniform float uDepthBiasC;
out vec4 vColorW;
out float vW;
out vec2 vUv;
` + LIGHT_FN;

/** Smooth: indexed geometry, one normal per vertex. */
const VERT_SMOOTH = MODEL_HEAD + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
void main() {
    vec4 eye = uMV * vec4(aPos, 1.0);
    // mat3(uMV), deliberately, NOT the inverse transpose: the software path uses the plain
    // upper 3x3 and under a non-uniform scale the two disagree. Matching the reference beats
    // being right here, or the same document lights differently on the two backends.
    vec4 pos = uMVP * vec4(aPos, 1.0);
    pos.z += 2.0 * uDepthBiasC * pos.w;
    vColorW = shade(mat3(uMV) * aNormal, eye.xyz) * pos.w;
    vW = pos.w;
    vUv = vec2(aUv.x, 1.0 - aUv.y);
    gl_Position = pos;
}`;

/**
 * Flat: expanded (non-indexed) geometry carrying its triangle's two edges and centroid.
 *
 * The face normal is the cross product of the two edges *in eye space*, which is what the
 * software path computes. Transforming a precomputed model-space face normal instead would
 * agree only for a similarity transform, and shear or non-uniform scale is exactly when a
 * lighting difference is hardest to spot and hardest to explain.
 */
const VERT_FLAT = MODEL_HEAD + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aEdge1;
layout(location = 2) in vec3 aEdge2;
layout(location = 3) in vec3 aCentroid;
layout(location = 4) in vec2 aUv;
void main() {
    mat3 mv3 = mat3(uMV);
    vec3 n = cross(mv3 * aEdge1, mv3 * aEdge2);
    // Matte flat shading lights the face once, at its centroid, so all three vertices get the
    // same colour and the interpolation is constant. Glossy flat lights each vertex at its own
    // position, so the view-dependent highlight gradates across the face. Both are the
    // software path's behaviour.
    vec3 p = uSpecStrength > 0.0 ? (uMV * vec4(aPos, 1.0)).xyz
                                 : (uMV * vec4(aCentroid, 1.0)).xyz;
    vec4 pos = uMVP * vec4(aPos, 1.0);
    pos.z += 2.0 * uDepthBiasC * pos.w;
    vColorW = shade(n, p) * pos.w;
    vW = pos.w;
    vUv = vec2(aUv.x, 1.0 - aUv.y);
    gl_Position = pos;
}`;

const FRAG_MODEL = `#version 300 es
precision highp float;
in vec4 vColorW;
in float vW;
in vec2 vUv;
uniform sampler2D uTex;
uniform bool uUseTex;
out vec4 fragColor;
void main() {
    vec4 c = vColorW / vW;   // undo the perspective weighting: screen-affine, as software
    if (uUseTex) {
        vec4 t = texture(uTex, vUv);
        // A fully transparent texel is skipped outright and writes no depth -- the software
        // path tests the texel's alpha before it touches the z-buffer, so a cut-out texture
        // does not occlude what is behind it.
        if (t.a <= 0.0) { discard; }
        c *= t;
    }
    if (c.a <= 0.0) { discard; }
    fragColor = vec4(c.rgb * c.a, c.a);   // premultiplied, as the canvas expects
}`;


/** Geometry as `defineMesh3D` stored it. Structural, so this file need not import the core. */
export interface Mesh3DSource {
    indices: Int32Array;
    verts: Float32Array;
    normals: Float32Array | null;
    uv: Float32Array | null;
}

/** The resolved 3D state the GPU path draws from — see SoftwarePaint3DContext.getGlFrame. */
export interface Gl3DFrameLike {
    mvp: Float32Array;
    mv: Float32Array;
    lights: ReadonlyArray<{ type: number; x: number; y: number; z: number;
                            r: number; g: number; b: number; }>;
    specStrength: number;
    shininess: number;
    depthBiasC: number;
    depthBiasS: number;
    baseColorArgb: number;
}

function buildProgram(gl: WebGL2RenderingContext, vsrc: string, fsrc: string): WebGLProgram | null {
    const compile = (type: number, src: string): WebGLShader | null => {
        const sh = gl.createShader(type);
        if (!sh) return null;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            console.error('rc 3d model shader:', gl.getShaderInfoLog(sh));
            gl.deleteShader(sh);
            return null;
        }
        return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vsrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('rc 3d model link:', gl.getProgramInfoLog(prog));
        return null;
    }
    return prog;
}

function attrib(gl: WebGL2RenderingContext, loc: number, size: number,
                stride: number, offset: number): void {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
}

/** One mesh's GPU buffers, for one shading variant. */
interface GpuMesh {
    vao: WebGLVertexArrayObject;
    vbo: WebGLBuffer;
    ibo: WebGLBuffer | null;
    count: number;
    indexed: boolean;
}

export class WebGL3DRenderer {
    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private vao: WebGLVertexArrayObject | null = null;
    private buffer: WebGLBuffer | null = null;
    private texture: WebGLTexture | null = null;
    private texW = 0;
    private texH = 0;
    /** The pixel array last uploaded. The host caches its conversion, so an unchanged texture
     *  arrives as the same array and the upload can be skipped — otherwise every mesh in
     *  every frame re-uploads the whole image. */
    private texSource: Int32Array | null = null;
    /** Interleaved x,y,r,g,b,a,u,v,depth — 9 floats per vertex. */
    private interleaved = new Float32Array(0);
    private uViewport: WebGLUniformLocation | null = null;
    private uUseTex: WebGLUniformLocation | null = null;
    /** Batches drawn since construction. Lets a harness prove the GPU path was taken rather
     *  than the software fallback, which is otherwise invisible in the output. */
    drawCount = 0;

    constructor() {
        this.canvas = document.createElement('canvas');
    }

    /** The offscreen canvas — use as a drawImage source after `draw`. */
    getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    isAvailable(): boolean {
        return this.ensureGl() !== null;
    }

    private ensureGl(): WebGL2RenderingContext | null {
        if (this.gl) return this.gl;
        const gl = this.canvas.getContext('webgl2', {
            alpha: true,
            depth: true,
            antialias: true,
            premultipliedAlpha: true,
            // Without this the drawing buffer is cleared after every composite, so reading it
            // back with drawImage gets an empty image on some drivers.
            preserveDrawingBuffer: true,
        }) as WebGL2RenderingContext | null;
        if (!gl) return null;
        this.gl = gl;

        const compile = (type: number, src: string): WebGLShader | null => {
            const sh = gl.createShader(type);
            if (!sh) return null;
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                console.error('rc 3d shader:', gl.getShaderInfoLog(sh));
                gl.deleteShader(sh);
                return null;
            }
            return sh;
        };
        const vs = compile(gl.VERTEX_SHADER, VERT);
        const fs = compile(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) return null;
        const prog = gl.createProgram();
        if (!prog) return null;
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('rc 3d link:', gl.getProgramInfoLog(prog));
            return null;
        }
        this.program = prog;
        this.uViewport = gl.getUniformLocation(prog, 'uViewport');
        this.uUseTex = gl.getUniformLocation(prog, 'uUseTex');
        gl.useProgram(prog);
        gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);

        this.buffer = gl.createBuffer();
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        const stride = 9 * 4;
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 8);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 32);
        gl.bindVertexArray(null);
        return gl;
    }

    /** Upload the active texture. `pixels` is ARGB, as the 3D context stores it. */
    setTexture(pixels: Int32Array | null, w: number, h: number): void {
        const gl = this.ensureGl();
        if (!gl) return;
        if (!pixels || w <= 0 || h <= 0) {
            this.texW = 0;
            this.texH = 0;
            this.texSource = null;
            return;
        }
        if (pixels === this.texSource && this.texW === w && this.texH === h) return;
        if (!this.texture) this.texture = gl.createTexture();
        // ARGB ints to RGBA bytes. Done here rather than in the shader so the sampler sees a
        // normal texture and filtering behaves.
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
            const p = pixels[i];
            rgba[i * 4] = (p >>> 16) & 0xFF;
            rgba[i * 4 + 1] = (p >>> 8) & 0xFF;
            rgba[i * 4 + 2] = p & 0xFF;
            rgba[i * 4 + 3] = (p >>> 24) & 0xFF;
        }
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.texW = w;
        this.texH = h;
        this.texSource = pixels;
    }

    /** Discard everything drawn so far and resize if needed. Call once per 3D pass. */
    beginFrame(width: number, height: number): void {
        const gl = this.ensureGl();
        if (!gl) return;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepth(1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    /**
     * Draw one batch.
     *
     * `useDepth` picks the ordering rule. False reproduces the reference's canvas backend:
     * depth test off, correctness resting entirely on the painter's sort the caller already
     * applied. True uses the depth buffer, which is what the ZBUF modes ask for and is the
     * only way interpenetrating geometry comes out right.
     */
    draw(batch: Mesh3DBatch, useDepth: boolean): void {
        const gl = this.ensureGl();
        if (!gl || !this.program || batch.vertexCount < 3) return;
        const n = batch.vertexCount;
        if (this.interleaved.length < n * 9) this.interleaved = new Float32Array(n * 9);
        const v = this.interleaved;
        const useTex = batch.hasUv && this.texW > 0;
        for (let i = 0; i < n; i++) {
            const o = i * 9;
            v[o] = batch.positions[i * 2];
            v[o + 1] = batch.positions[i * 2 + 1];
            const c = batch.colors[i];
            v[o + 2] = ((c >>> 16) & 0xFF) / 255;
            v[o + 3] = ((c >>> 8) & 0xFF) / 255;
            v[o + 4] = (c & 0xFF) / 255;
            v[o + 5] = ((c >>> 24) & 0xFF) / 255;
            // v runs bottom-up in the document and top-down in the texture, the same flip
            // the software path and the Skia backend apply.
            v[o + 6] = useTex ? batch.uvs[i * 2] : 0;
            v[o + 7] = useTex ? 1 - batch.uvs[i * 2 + 1] : 0;
            v[o + 8] = batch.depths[i];
        }

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, v.subarray(0, n * 9), gl.DYNAMIC_DRAW);
        gl.uniform2f(this.uViewport, this.canvas.width, this.canvas.height);
        gl.uniform1i(this.uUseTex, useTex ? 1 : 0);
        if (useTex) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
        }
        if (useDepth) {
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LESS);
        } else {
            gl.disable(gl.DEPTH_TEST);
        }
        // Back faces are already culled on the CPU by projectTriangle, and culling again here
        // would double-apply the winding rule and drop everything.
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // source is premultiplied
        gl.drawArrays(gl.TRIANGLES, 0, n);
        this.drawCount++;
        gl.bindVertexArray(null);
    }

    // ── Model-space pipeline state ─────────────────────────────────────────────────────

    private modelProgSmooth: WebGLProgram | null = null;
    private modelProgFlat: WebGLProgram | null = null;
    private modelUniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
    /** Uploaded geometry, keyed `meshId:variant`. Built once, reused every frame. */
    private gpuMeshes = new Map<string, GpuMesh>();
    /** Whether this pass has been cleared yet. */
    private passStarted = false;
    /** Batches drawn through the model-space path, for a harness to assert the GPU ran. */
    modelDrawCount = 0;

    /**
     * Start a 3D pass: resize and clear colour and depth.
     *
     * Separate from `beginFrame` because the two backends accumulate differently. The canvas
     * backends composite each mesh on its own, so they clear per mesh. The software path keeps
     * ONE depth buffer for the whole pass and re-blits the accumulated buffer after every
     * mesh, so meshes depth-test against each other — and the GL backend has to do the same or
     * a document built from many small meshes (one per facet, say) loses all inter-mesh
     * occlusion while still looking plausible.
     */
    beginPass(width: number, height: number): void {
        const gl = this.ensureGl();
        if (!gl) return;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepth(1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.passStarted = true;
    }

    /** Drop a mesh's uploaded buffers, so a redefinition is not drawn from stale geometry. */
    invalidateMesh(meshId: number): void {
        const gl = this.gl;
        for (const variant of ['s', 'f']) {
            const key = `${meshId}:${variant}`;
            const m = this.gpuMeshes.get(key);
            if (!m) continue;
            if (gl) {
                gl.deleteVertexArray(m.vao);
                gl.deleteBuffer(m.vbo);
                if (m.ibo) gl.deleteBuffer(m.ibo);
            }
            this.gpuMeshes.delete(key);
        }
    }

    private uniform(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
        let m = this.modelUniforms.get(prog);
        if (!m) { m = new Map(); this.modelUniforms.set(prog, m); }
        if (!m.has(name)) {
            const gl = this.gl!;
            m.set(name, gl.getUniformLocation(prog, name));
        }
        return m.get(name) ?? null;
    }

    private ensureModelProgram(smooth: boolean): WebGLProgram | null {
        const gl = this.ensureGl();
        if (!gl) return null;
        const have = smooth ? this.modelProgSmooth : this.modelProgFlat;
        if (have) return have;
        const prog = buildProgram(gl, smooth ? VERT_SMOOTH : VERT_FLAT, FRAG_MODEL);
        if (!prog) return null;
        if (smooth) this.modelProgSmooth = prog; else this.modelProgFlat = prog;
        return prog;
    }

    /**
     * Upload one mesh in the layout the requested variant needs, or return the cached upload.
     *
     * Smooth keeps the index buffer. Flat cannot: the face normal and the centroid belong to
     * the triangle, not the vertex, so a vertex shared by two faces would need two different
     * values. Expanding costs memory and is done once per mesh, not once per frame.
     */
    private ensureGpuMesh(gl: WebGL2RenderingContext, meshId: number, mesh: Mesh3DSource,
                          smooth: boolean): GpuMesh | null {
        const key = `${meshId}:${smooth ? 's' : 'f'}`;
        const cached = this.gpuMeshes.get(key);
        if (cached) return cached;

        const idx = mesh.indices;
        const verts = mesh.verts;
        const uv = mesh.uv;
        const vao = gl.createVertexArray();
        const vbo = gl.createBuffer();
        if (!vao || !vbo) return null;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

        let built: GpuMesh;
        if (smooth) {
            const n = verts.length / 3;
            const data = new Float32Array(n * 8);
            const normals = mesh.normals;
            for (let i = 0; i < n; i++) {
                const o = i * 8;
                data[o] = verts[i * 3]; data[o + 1] = verts[i * 3 + 1]; data[o + 2] = verts[i * 3 + 2];
                if (normals) {
                    data[o + 3] = normals[i * 3];
                    data[o + 4] = normals[i * 3 + 1];
                    data[o + 5] = normals[i * 3 + 2];
                }
                if (uv) { data[o + 6] = uv[i * 2]; data[o + 7] = uv[i * 2 + 1]; }
            }
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            const stride = 8 * 4;
            attrib(gl, 0, 3, stride, 0);
            attrib(gl, 1, 3, stride, 12);
            attrib(gl, 2, 2, stride, 24);
            const ibo = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
            built = { vao, vbo, ibo, count: idx.length, indexed: true };
        } else {
            const tris = Math.floor(idx.length / 3);
            const data = new Float32Array(tris * 3 * 14);
            let o = 0;
            for (let t = 0; t < tris; t++) {
                const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
                const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
                const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
                const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
                const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
                const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
                const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
                const vi = [a, b, c];
                const px = [ax, bx, cx], py = [ay, by, cy], pz = [az, bz, cz];
                for (let k = 0; k < 3; k++) {
                    data[o] = px[k]; data[o + 1] = py[k]; data[o + 2] = pz[k];
                    data[o + 3] = e1x; data[o + 4] = e1y; data[o + 5] = e1z;
                    data[o + 6] = e2x; data[o + 7] = e2y; data[o + 8] = e2z;
                    data[o + 9] = mx; data[o + 10] = my; data[o + 11] = mz;
                    if (uv) { data[o + 12] = uv[vi[k] * 2]; data[o + 13] = uv[vi[k] * 2 + 1]; }
                    o += 14;
                }
            }
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            const stride = 14 * 4;
            attrib(gl, 0, 3, stride, 0);
            attrib(gl, 1, 3, stride, 12);
            attrib(gl, 2, 3, stride, 24);
            attrib(gl, 3, 3, stride, 36);
            attrib(gl, 4, 2, stride, 48);
            built = { vao, vbo, ibo: null, count: tris * 3, indexed: false };
        }
        gl.bindVertexArray(null);
        this.gpuMeshes.set(key, built);
        return built;
    }

    /**
     * Draw one mesh with the GPU pipeline. Returns false if WebGL2 is unavailable, so the
     * caller can fall back to software rather than draw nothing.
     */
    drawModelSpace(meshId: number, mesh: Mesh3DSource, frame: Gl3DFrameLike,
                   smooth: boolean, width: number, height: number): boolean {
        const gl = this.ensureGl();
        if (!gl) return false;
        const prog = this.ensureModelProgram(smooth);
        if (!prog) return false;
        if (!this.passStarted || this.canvas.width !== width || this.canvas.height !== height) {
            this.beginPass(width, height);
        }
        const gpu = this.ensureGpuMesh(gl, meshId, mesh, smooth);
        if (!gpu || gpu.count < 3) return true;

        const useTex = this.texW > 0 && mesh.uv !== null;
        gl.useProgram(prog);
        gl.bindVertexArray(gpu.vao);

        gl.uniformMatrix4fv(this.uniform(prog, 'uMVP'), false, frame.mvp);
        gl.uniformMatrix4fv(this.uniform(prog, 'uMV'), false, frame.mv);
        gl.uniform1f(this.uniform(prog, 'uSpecStrength'), frame.specStrength);
        gl.uniform1f(this.uniform(prog, 'uShininess'), frame.shininess);
        gl.uniform1f(this.uniform(prog, 'uDepthBiasC'), frame.depthBiasC);
        const base = frame.baseColorArgb;
        gl.uniform4f(this.uniform(prog, 'uBaseColor'),
                     ((base >>> 16) & 0xFF) / 255, ((base >>> 8) & 0xFF) / 255,
                     (base & 0xFF) / 255, ((base >>> 24) & 0xFF) / 255);

        const n = Math.min(frame.lights.length, 32);
        gl.uniform1i(this.uniform(prog, 'uNumLights'), n);
        if (n > 0) {
            const types = new Int32Array(n);
            const vecs = new Float32Array(n * 3);
            const cols = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                const l = frame.lights[i];
                types[i] = l.type;
                vecs[i * 3] = l.x; vecs[i * 3 + 1] = l.y; vecs[i * 3 + 2] = l.z;
                cols[i * 3] = l.r; cols[i * 3 + 1] = l.g; cols[i * 3 + 2] = l.b;
            }
            gl.uniform1iv(this.uniform(prog, 'uLightType[0]'), types);
            gl.uniform3fv(this.uniform(prog, 'uLightVec[0]'), vecs);
            gl.uniform3fv(this.uniform(prog, 'uLightColor[0]'), cols);
        }

        gl.uniform1i(this.uniform(prog, 'uUseTex'), useTex ? 1 : 0);
        if (useTex) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            // Nearest, because the software path point-samples and clamps. Linear would look
            // better and would make the same document differ by backend; the mode is supposed
            // to change the speed, not the picture.
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.uniform1i(this.uniform(prog, 'uTex'), 0);
        }

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        // CCW is front-facing in NDC. The software path culls on the screen-space signed area
        // after the y flip, which is the same rule stated the other way round.
        gl.enable(gl.CULL_FACE);
        gl.frontFace(gl.CCW);
        gl.cullFace(gl.BACK);
        if (frame.depthBiasS !== 0) {
            // Only the slope term: GL's polygon offset multiplies the same max-partial-
            // derivative depth slope the software path computes. The constant term is applied
            // in the vertex shader instead, where it is exact — GL's `units` are scaled by the
            // depth buffer's resolution, which is not a number the document knows.
            gl.enable(gl.POLYGON_OFFSET_FILL);
            gl.polygonOffset(frame.depthBiasS, 0);
        } else {
            gl.disable(gl.POLYGON_OFFSET_FILL);
        }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        if (gpu.indexed) {
            gl.drawElements(gl.TRIANGLES, gpu.count, gl.UNSIGNED_INT, 0);
        } else {
            gl.drawArrays(gl.TRIANGLES, 0, gpu.count);
        }
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.bindVertexArray(null);
        this.drawCount++;
        this.modelDrawCount++;
        return true;
    }

    /**
     * Hand the WebGL context back.
     *
     * A browser allows only about 16 live contexts and silently kills the oldest beyond that,
     * so a gallery that builds a player per card blanks its earliest documents unless each one
     * releases. The shader renderer already did this; this one never did, which is the same
     * leak with a second cause.
     */
    destroy(): void {
        const gl = this.gl;
        if (!gl) return;
        for (const m of this.gpuMeshes.values()) {
            gl.deleteVertexArray(m.vao);
            gl.deleteBuffer(m.vbo);
            if (m.ibo) gl.deleteBuffer(m.ibo);
        }
        this.gpuMeshes.clear();
        this.modelUniforms.clear();
        if (this.texture) gl.deleteTexture(this.texture);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        this.gl = null;
        this.program = null;
        this.modelProgSmooth = null;
        this.modelProgFlat = null;
        this.texture = null;
        this.texSource = null;
        this.passStarted = false;
    }

}

// ── GL_DIVERGENCES ─────────────────────────────────────────────────────────────────────
//
// Where modes 6/7 cannot match modes 0/1, and why. Each of these is a property of running on
// a GPU rather than a bug, but a parity harness has to know about them or it reports noise.
//
// 1. ROUNDING. The software path truncates each channel to an integer after lighting
//    (`Math.trunc`) and accumulates in float32 at every step, because that is what the Java
//    reference does. The GPU accumulates in its own precision and the blend to 8 bits rounds.
//    Expect whole faces to differ by one 8-bit level.
//
// 2. COVERAGE. Two rasterizers disagree about pixels whose centre lies on a triangle edge.
//    The software path uses a 28.4 fixed-point top-left rule; the GPU uses its own. Only
//    boundary pixels are affected, but a silhouette is all boundary pixels.
//
// 3. NEAR PLANE. The software path *rejects* any triangle with a vertex at clip w below
//    1e-4; it does not clip. The GPU clips properly, so geometry crossing the near plane is
//    drawn here and dropped there. A scene wholly in front of the camera is unaffected.
//
// 4. ANTIALIASING. The offscreen context is created with `antialias: true`, so edges are
//    smoothed. The software path has no coverage antialiasing at all.
//
// None of these change which surface is in front, which is the thing the backend exists to
// get right, so a parity test should compare structure and allow the above rather than
// demand bit-exactness the way the software-vs-Java test correctly does.
