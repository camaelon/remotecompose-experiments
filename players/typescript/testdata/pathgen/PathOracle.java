// PathOracle — dump remote-core's PathGenerator output as raw float bits, so the
// TypeScript port can be diffed against it exactly rather than approximately.
import androidx.compose.remote.core.operations.utilities.PathGenerator;
import androidx.compose.remote.core.operations.utilities.AnimatedFloatExpression;

public class PathOracle {
    static float[] EYCUR; static String NAME;
    static float[] EX = { AnimatedFloatExpression.VAR1 };
    // y = sin(x) * sin(x * 7): many extrema and sign changes, which is what separates a
    // monotone fit from a plain weighted average.
    static float[] EY = {
        AnimatedFloatExpression.VAR1, AnimatedFloatExpression.SIN,
        AnimatedFloatExpression.VAR1, 7f, AnimatedFloatExpression.MUL,
        AnimatedFloatExpression.SIN, AnimatedFloatExpression.MUL
    };

    // Extra shapes chosen to hit the branches a smooth curve never reaches:
    //   FLAT      constant y  -> every delta is 0, the zero-slope guard and the filter's
    //                            delta==0 branch
    //   ABSX      |x|         -> a sign change with a corner at the origin
    //   MONO      x           -> already monotone; tangents must be left alone
    //   STEP      floor-ish   -> alternating flats and jumps, which is what drives the
    //                            Hyman rescale (s > 9)
    static float[] FLAT = { 1f };
    static float[] ABSX = { AnimatedFloatExpression.VAR1, AnimatedFloatExpression.ABS };
    static float[] MONO = { AnimatedFloatExpression.VAR1 };
    static float[] STEP = { AnimatedFloatExpression.VAR1, AnimatedFloatExpression.SIN,
                            AnimatedFloatExpression.VAR1, 40f, AnimatedFloatExpression.MUL,
                            AnimatedFloatExpression.SIN, AnimatedFloatExpression.MUL };

    public static void main(String[] args) {
        PathGenerator g = new PathGenerator();
        int[] modes = {0, 2, 4};
        boolean[] loops = {false, true};
        int[] counts = {2, 3, 5, 17, 128};
        float[][] ys = { EY, FLAT, ABSX, MONO, STEP };
        String[] names = { "sinsin", "flat", "absx", "mono", "step" };
        for (int yi = 0; yi < ys.length; yi++) {
        EYCUR = ys[yi]; NAME = names[yi];
        for (int count : counts) {
            for (boolean loop : loops) {
                for (int mode : modes) {
                    int len = g.getReturnLength(count, loop);
                    float[] dest = new float[len];
                    int n;
                    try {
                        n = g.getPath(dest, EX, EYCUR, -10f, 10f, count, mode, loop, null);
                    } catch (RuntimeException e) {
                        System.out.println(NAME + " count=" + count + " loop=" + loop
                                + " mode=" + mode + " THREW " + e.getClass().getSimpleName());
                        continue;
                    }
                    if (mode == 0) {
                        // Emit the sampled points too, so the TypeScript side can be fed the
                        // exact same inputs and only the generator is under comparison.
                        AnimatedFloatExpression ex = new AnimatedFloatExpression();
                        float gap = 20f;
                        float step = loop ? (gap / (float) count) : (gap / (float) (count - 1));
                        StringBuilder pts = new StringBuilder();
                        pts.append("SAMPLES ").append(NAME).append(" count=").append(count).append(" loop=").append(loop).append(" |");
                        for (int i = 0; i < count; i++) {
                            float val = -10f + i * step;
                            float xv = ex.eval(EX, EX.length, val);
                            float yv = ex.eval(EYCUR, EYCUR.length, val);
                            pts.append(' ').append(Integer.toHexString(Float.floatToRawIntBits(xv)))
                               .append(',').append(Integer.toHexString(Float.floatToRawIntBits(yv)));
                        }
                        System.out.println(pts);
                    }
                    StringBuilder sb = new StringBuilder();
                    sb.append(NAME).append(" count=").append(count).append(" loop=").append(loop)
                      .append(" mode=").append(mode).append(" n=").append(n).append(" |");
                    for (int i = 0; i < n; i++) {
                        sb.append(' ').append(Integer.toHexString(Float.floatToRawIntBits(dest[i])));
                    }
                    System.out.println(sb);
                }
            }
        }
        }
    }
}
