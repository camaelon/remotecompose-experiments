/* Dump a primitive's mesh as text so a port can be diffed value by value rather than by pixel. */
import androidx.compose.remote.core.operations.utilities.d3.MeshData;
import androidx.compose.remote.core.operations.utilities.d3.Primitive3D;

public final class DumpMesh {
    public static void main(String[] a) {
        int type = Integer.parseInt(a[0]);
        float seg = Float.parseFloat(a[1]);
        int flags = Integer.parseInt(a[2]);
        float[][] ch = new float[a.length - 3][];
        for (int c = 3; c < a.length; c++) {
            String[] parts = a[c].split(",");
            float[] f = new float[parts.length];
            for (int k = 0; k < parts.length; k++) {
                f[k] = Float.parseFloat(parts[k]);
            }
            ch[c - 3] = f;
        }
        MeshData m = Primitive3D.build(type, seg, flags, ch);
        StringBuilder sb = new StringBuilder();
        sb.append("verts ").append(m.verts.length).append('\n');
        for (float v : m.verts) {
            sb.append(Float.floatToRawIntBits(v)).append('\n');
        }
        sb.append("normals ").append(m.normals.length).append('\n');
        for (float v : m.normals) {
            sb.append(Float.floatToRawIntBits(v)).append('\n');
        }
        sb.append("indices ").append(m.indices.length).append('\n');
        for (int v : m.indices) {
            sb.append(v).append('\n');
        }
        System.out.print(sb);
    }
}
