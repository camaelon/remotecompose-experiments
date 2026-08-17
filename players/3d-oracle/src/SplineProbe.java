/* Print the tube's chord-length knots and the first centreline samples, to locate a divergence
 * between the Java reference spline and a port. */
import androidx.compose.remote.core.operations.utilities.easing.MonotonicCurveFit;

public final class SplineProbe {
    public static void main(String[] a) {
        float[] cx = {-1.6f, -0.7f, 0.1f, 0.9f, 1.6f};
        float[] cy = {-0.9f, 0.5f, -0.6f, 0.6f, -0.2f};
        float[] cz = {0.4f, -0.5f, 0.6f, -0.3f, 0.5f};
        int cn = 5;
        double[] knot = new double[cn];
        double[][] y = new double[cn][3];
        y[0][0] = cx[0]; y[0][1] = cy[0]; y[0][2] = cz[0];
        for (int i = 1; i < cn; i++) {
            float dx = cx[i] - cx[i-1], dy = cy[i] - cy[i-1], dz = cz[i] - cz[i-1];
            double d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            knot[i] = knot[i-1] + Math.max(d, 1e-4);
            y[i][0] = cx[i]; y[i][1] = cy[i]; y[i][2] = cz[i];
        }
        MonotonicCurveFit fit = new MonotonicCurveFit(knot, y);
        for (int i = 0; i < cn; i++) System.out.println("knot " + Double.doubleToRawLongBits(knot[i]));
        float[] pos = new float[3];
        double[] slope = new double[3];
        // First span, second sample (ring 1) — the first place the port diverged.
        for (int s = 0; s < 3; s++) {
            double t = knot[0] + (knot[1] - knot[0]) * s / 9;
            fit.getPos(t, pos);
            fit.getSlope(t, slope);
            System.out.println("s" + s + " pos " + Float.floatToRawIntBits(pos[0]) + ","
                + Float.floatToRawIntBits(pos[1]) + "," + Float.floatToRawIntBits(pos[2])
                + " slope " + Double.doubleToRawLongBits(slope[0]) + ","
                + Double.doubleToRawLongBits(slope[1]) + "," + Double.doubleToRawLongBits(slope[2]));
        }
    }
}
