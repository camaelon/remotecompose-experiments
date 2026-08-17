/*
 * Headless reference renderer for the RemoteCompose 3D software path.
 *
 * JavaPaint3DContext / Rasterizer / Matrix4 depend on nothing but java.util, so the reference
 * rasterizer runs under plain javac with no Android, no gradle and no device. That makes it
 * usable as an oracle: render a scene here, render the same scene in the TypeScript or C++
 * player, diff the pixels.
 *
 * The input is a scene script whose commands map 1:1 onto Paint3DContext calls. Driving both
 * renderers from the same script tests the rasterizer *alone* — a divergence cannot be blamed
 * on wire decoding, because no wire format is involved. Wire parity is a separate test.
 *
 *   javac -d classes $(find src -name '*.java')
 *   java -cp classes Oracle scene.txt out.png
 */
import androidx.compose.remote.core.Paint3DContext;
import androidx.compose.remote.core.operations.utilities.AnimatedFloatExpression;
import androidx.compose.remote.core.operations.d3.MeshExpression;
import androidx.compose.remote.core.operations.utilities.d3.MeshData;
import androidx.compose.remote.core.operations.utilities.d3.Primitive3D;
import androidx.compose.remote.player.core.platform.d3.JavaPaint3DContext;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

public final class Oracle {

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("usage: Oracle <scene.txt> <out.png>");
            System.exit(2);
        }
        JavaPaint3DContext ctx = new JavaPaint3DContext();
        int w = 256, h = 256;
        ctx.setSize(w, h);

        for (String raw : Files.readAllLines(Paths.get(args[0]))) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            String[] t = line.split("\\s+");
            switch (t[0]) {
                case "size":
                    w = Integer.parseInt(t[1]);
                    h = Integer.parseInt(t[2]);
                    ctx.setSize(w, h);
                    break;
                case "color":
                    ctx.setBaseColorArgb((int) Long.parseLong(t[1], 16));
                    break;
                case "clearDepth":
                    ctx.clearDepth3D();
                    break;
                case "camera": {
                    // camera <persp|ortho> <projParams...> | <viewParams x9>
                    int proj = t[1].equals("ortho")
                            ? Paint3DContext.PROJECTION_ORTHO
                            : Paint3DContext.PROJECTION_PERSPECTIVE;
                    int bar = indexOf(t, "|");
                    float[] p = floats(t, 2, bar);
                    float[] v = floats(t, bar + 1, t.length);
                    ctx.setCamera3D(proj, p, v);
                    break;
                }
                case "matrix": {
                    int sub = matrixSub(t[1]);
                    ctx.matrix3Op(sub, floats(t, 2, t.length));
                    break;
                }
                case "mesh":
                    defineMesh(ctx, t);
                    break;
                case "meshexpr":
                    // meshexpr <id> <type> <flags> <params> <posGroup> <normalGroup> <uvGroup>
                    // Each group is a semicolon-separated list of comma-separated RPN tokens;
                    // "-" is an empty group. The real MeshExpression op runs, so this tests the
                    // operation rather than a copy of its arithmetic.
                    meshExpr(ctx, t);
                    break;
                case "lights":
                    setLights(ctx, t);
                    break;
                case "material":
                    ctx.setMaterial3D(Float.parseFloat(t[1]), Float.parseFloat(t[2]));
                    break;
                case "depthBias":
                    ctx.setDepthBias3D(Float.parseFloat(t[1]), Float.parseFloat(t[2]));
                    break;
                case "draw":
                    ctx.drawMesh3D(Integer.parseInt(t[1]), Integer.parseInt(t[2]));
                    break;
                default:
                    // Unknown commands are a scene-script bug, not something to skip silently:
                    // a typo that drops a draw call renders an empty image that still "passes".
                    throw new IllegalArgumentException("unknown scene command: " + t[0]);
            }
        }

        int[] px = ctx.getColorBuffer();
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        if (px != null) {
            img.setRGB(0, 0, w, h, px, 0, w);
        }
        ImageIO.write(img, "png", new File(args[1]));
        System.out.println("wrote " + args[1] + " (" + w + "x" + h + ")");
    }

    /** Parse one group: semicolon-separated expressions, each comma-separated RPN tokens. */
    private static float[][] group(String s) {
        if (s.equals("-")) {
            return new float[0][];
        }
        String[] parts = s.split(";");
        float[][] g = new float[parts.length][];
        for (int i = 0; i < parts.length; i++) {
            String[] tok = parts[i].split(",");
            float[] e = new float[tok.length];
            for (int k = 0; k < tok.length; k++) {
                e[k] = token(tok[k]);
            }
            g[i] = e;
        }
        return g;
    }

    /**
     * A scene-script RPN token: a plain number, or an operator/variable by name. Operators are
     * NaN payloads, so they are looked up rather than parsed — writing them as decimals would
     * lose the exact bit pattern the evaluator switches on.
     */
    private static float token(String s) {
        switch (s) {
            case "u": return AnimatedFloatExpression.VAR1;
            case "v": return AnimatedFloatExpression.VAR2;
            case "+": return AnimatedFloatExpression.ADD;
            case "-": return AnimatedFloatExpression.SUB;
            case "*": return AnimatedFloatExpression.MUL;
            case "/": return AnimatedFloatExpression.DIV;
            case "sin": return AnimatedFloatExpression.SIN;
            case "cos": return AnimatedFloatExpression.COS;
            case "sqrt": return AnimatedFloatExpression.SQRT;
            case "abs": return AnimatedFloatExpression.ABS;
            case "exp": return AnimatedFloatExpression.EXP;
            case "hypot": return AnimatedFloatExpression.HYPOT;
            case "min": return AnimatedFloatExpression.MIN;
            case "max": return AnimatedFloatExpression.MAX;
            case "pow": return AnimatedFloatExpression.POW;
            default: return Float.parseFloat(s);
        }
    }

    private static void meshExpr(JavaPaint3DContext engine, String[] t) {
        int id = Integer.parseInt(t[1]);
        int type = Integer.parseInt(t[2]);
        int flags = Integer.parseInt(t[3]);
        float[][] params = group(t[4]);
        MeshExpression op = new MeshExpression(id, type, flags, params[0],
                group(t[5]), group(t[6]), group(t[7]));
        OracleBridge.Ctx ctx = new OracleBridge.Ctx();
        op.updateVariables(ctx);
        op.paint(new OracleBridge.P3D(ctx, engine));
    }

    private static int indexOf(String[] t, String needle) {
        for (int i = 0; i < t.length; i++) {
            if (t[i].equals(needle)) {
                return i;
            }
        }
        throw new IllegalArgumentException("expected '" + needle + "' in: " + String.join(" ", t));
    }

    private static float[] floats(String[] t, int from, int to) {
        float[] out = new float[to - from];
        for (int i = from; i < to; i++) {
            out[i - from] = Float.parseFloat(t[i]);
        }
        return out;
    }

    private static int matrixSub(String name) {
        switch (name) {
            case "identity": return Paint3DContext.M3_IDENTITY;
            case "translate": return Paint3DContext.M3_TRANSLATE;
            case "scale": return Paint3DContext.M3_SCALE;
            case "rotate": return Paint3DContext.M3_ROTATE_AXIS;
            case "multiply": return Paint3DContext.M3_MULTIPLY;
            default: throw new IllegalArgumentException("bad matrix sub: " + name);
        }
    }

    /** {@code lights <type> <argb> <x> <y> <z> <intensity> [...]} — repeats per light. */
    private static void setLights(JavaPaint3DContext ctx, String[] t) {
        int n = (t.length - 1) / 6;
        int[] types = new int[n];
        int[] colors = new int[n];
        float[] params = new float[n * 4];
        for (int i = 0; i < n; i++) {
            int b = 1 + i * 6;
            types[i] = t[b].equals("point")
                    ? Paint3DContext.LIGHT_POINT
                    : Paint3DContext.LIGHT_DIRECTIONAL;
            colors[i] = (int) Long.parseLong(t[b + 1], 16);
            for (int k = 0; k < 4; k++) {
                params[i * 4 + k] = Float.parseFloat(t[b + 2 + k]);
            }
        }
        ctx.setLights3D(types, colors, params);
    }

    /**
     * {@code mesh <id> cube <size>} — a unit cube with per-face normals, or
     * {@code mesh <id> tri} — one triangle, or
     * {@code mesh <id> raw i:a,b,c v:x,y,z,... [n:...]} for explicit geometry.
     */
    private static void defineMesh(JavaPaint3DContext ctx, String[] t) {
        int id = Integer.parseInt(t[1]);
        switch (t[2]) {
            case "cube": {
                float s = t.length > 3 ? Float.parseFloat(t[3]) : 1f;
                Cube c = cube(s);
                ctx.defineMesh3D(id, c.idx, c.verts, c.normals, c.uv);
                break;
            }
            case "tri": {
                float[] v = {-1, -1, 0, 1, -1, 0, 0, 1, 0};
                int[] i = {0, 1, 2};
                ctx.defineMesh3D(id, i, v, null);
                break;
            }
            case "prim": {
                // prim <id> <type> <segments> <flags> <p0,p1,...> [<channel1...>]
                // Channels are comma-separated float lists, one whitespace-separated token each,
                // so a lathe profile or a sweep path rides the same scene-script line.
                int ptype = Integer.parseInt(t[3]);
                float segs = Float.parseFloat(t[4]);
                int pflags = Integer.parseInt(t[5]);
                float[][] chans = new float[t.length - 6][];
                for (int c = 6; c < t.length; c++) {
                    String[] parts = t[c].split(",");
                    float[] ch = new float[parts.length];
                    for (int k = 0; k < parts.length; k++) {
                        ch[k] = Float.parseFloat(parts[k]);
                    }
                    chans[c - 6] = ch;
                }
                MeshData m = Primitive3D.build(ptype, segs, pflags, chans);
                ctx.defineMesh3D(id, m.indices, m.verts, m.normals, m.uv);
                break;
            }
            case "raw": {
                List<Integer> idx = new ArrayList<>();
                List<Float> verts = new ArrayList<>();
                List<Float> norms = new ArrayList<>();
                for (int k = 3; k < t.length; k++) {
                    String[] kv = t[k].split(":", 2);
                    for (String s : kv[1].split(",")) {
                        if (kv[0].equals("i")) {
                            idx.add(Integer.parseInt(s));
                        } else if (kv[0].equals("v")) {
                            verts.add(Float.parseFloat(s));
                        } else {
                            norms.add(Float.parseFloat(s));
                        }
                    }
                }
                int[] ia = new int[idx.size()];
                for (int k = 0; k < ia.length; k++) {
                    ia[k] = idx.get(k);
                }
                float[] va = new float[verts.size()];
                for (int k = 0; k < va.length; k++) {
                    va[k] = verts.get(k);
                }
                float[] na = null;
                if (!norms.isEmpty()) {
                    na = new float[norms.size()];
                    for (int k = 0; k < na.length; k++) {
                        na[k] = norms.get(k);
                    }
                }
                ctx.defineMesh3D(id, ia, va, na);
                break;
            }
            default:
                throw new IllegalArgumentException("unknown mesh kind: " + t[2]);
        }
    }

    private static final class Cube {
        int[] idx;
        float[] verts;
        float[] normals;
        float[] uv;
    }

    /**
     * Axis-aligned cube of edge {@code 2*s}, built as six independent quads so each face carries
     * its own normal. Shared corner vertices would average three normals and round the edges.
     */
    private static Cube cube(float s) {
        float[][] faces = {
                {0, 0, 1}, {0, 0, -1}, {1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0},
        };
        float[] verts = new float[6 * 4 * 3];
        float[] normals = new float[6 * 4 * 3];
        float[] uv = new float[6 * 4 * 2];
        int[] idx = new int[6 * 6];
        for (int f = 0; f < 6; f++) {
            float nx = faces[f][0], ny = faces[f][1], nz = faces[f][2];
            // Two in-plane axes, right-handed with the normal, so every face winds CCW when
            // seen from outside.
            float ax, ay, az, bx, by, bz;
            if (nz != 0) {
                ax = nz; ay = 0; az = 0; bx = 0; by = 1; bz = 0;
            } else if (nx != 0) {
                ax = 0; ay = 0; az = -nx; bx = 0; by = 1; bz = 0;
            } else {
                ax = 1; ay = 0; az = 0; bx = 0; by = 0; bz = -ny;
            }
            float[][] corner = {{-1, -1}, {1, -1}, {1, 1}, {-1, 1}};
            for (int c = 0; c < 4; c++) {
                int vi = (f * 4 + c) * 3;
                float u = corner[c][0], v = corner[c][1];
                verts[vi] = (nx + ax * u + bx * v) * s;
                verts[vi + 1] = (ny + ay * u + by * v) * s;
                verts[vi + 2] = (nz + az * u + bz * v) * s;
                normals[vi] = nx;
                normals[vi + 1] = ny;
                normals[vi + 2] = nz;
                uv[(f * 4 + c) * 2] = (u + 1) * 0.5f;
                uv[(f * 4 + c) * 2 + 1] = (v + 1) * 0.5f;
            }
            int b = f * 4;
            int o = f * 6;
            idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
            idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
        }
        Cube c = new Cube();
        c.idx = idx;
        c.verts = verts;
        c.normals = normals;
        c.uv = uv;
        return c;
    }
}
