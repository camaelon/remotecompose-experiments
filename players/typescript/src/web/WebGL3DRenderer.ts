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
in vec4 vColor;
in vec2 vUv;
uniform sampler2D uTex;
uniform bool uUseTex;
out vec4 fragColor;
void main() {
    vec4 c = vColor;
    if (uUseTex) {
        // Lighting modulates the sampled texel, as the reference does with a BitmapShader.
        c *= texture(uTex, vUv);
    }
    if (c.a <= 0.0) discard;
    // Premultiplied out, because the canvas is created with premultipliedAlpha and
    // compositing it with drawImage otherwise darkens every antialiased edge.
    fragColor = vec4(c.rgb * c.a, c.a);
}`;

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
}
