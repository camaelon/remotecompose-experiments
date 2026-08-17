// MakeDemoGraphs2 — emit a document that drives the same path-expression code path as
// DemoGraphsKt::demoGraphs2.
//
// demoGraphs2 itself cannot be run off-device: it goes through XYGraph's plotting helpers,
// which are extensions on RemoteComposeContextAndroid and take android.graphics types
// (Painter.setShader wants a Shader.TileMode), so the whole chain needs Android at compile
// and run time. What actually stresses the spline engine is one operation — the
// PATH_EXPRESSION that FunctionPlot emits — and RemoteComposeWriter.addPathExpression is
// JVM-safe, so that part is reproduced exactly here.
//
// Same function as the demo:  y = min(scale, 15) * sin(x * 0.3 + t) * sin(x * 7)
// Same domain (-10..10), same 128 samples. Three copies are drawn, one per path mode, so a
// single render shows LINEAR against MONOTONIC against SPLINE — the modes the player used
// to collapse into one.
import androidx.compose.remote.core.operations.Header;
import androidx.compose.remote.core.operations.utilities.AnimatedFloatExpression;
import androidx.compose.remote.creation.RemoteComposeWriter;
import androidx.compose.remote.core.RcPlatformServices;
import androidx.compose.remote.creation.modifiers.RecordingModifier;
import java.io.FileOutputStream;

public class MakeDemoGraphs2 {
    static final float VAR1 = AnimatedFloatExpression.VAR1;
    static final float ADD = AnimatedFloatExpression.ADD;
    static final float MUL = AnimatedFloatExpression.MUL;
    static final float SIN = AnimatedFloatExpression.SIN;
    static final float MIN = AnimatedFloatExpression.MIN;

    static final int W = 500, H = 500;

    /** Nothing here draws a bitmap or parses an SVG path, so these can all be inert. */
    static final class MockPlatform implements RcPlatformServices {
        @Override public float[] pathToFloatArray(Object path) { return new float[0]; }
        @Override public Object parsePath(String path) { return new float[0]; }
        @Override public byte[] imageToByteArray(Object image) { return new byte[0]; }
        @Override public int getImageWidth(Object image) { return 0; }
        @Override public int getImageHeight(Object image) { return 0; }
        @Override public boolean isAlpha8Image(Object image) { return false; }
        @Override public void log(LogCategory category, String message) {}
    }

    public static void main(String[] args) throws Exception {
        RemoteComposeWriter w = new RemoteComposeWriter(
                W, H, "demoGraphs2 path modes", 7, 513, new MockPlatform());

        // Time-varying amplitude, as the demo has: abs((sin(t) + 1.5) * 10), capped at 15.
        float t = androidx.compose.remote.core.RemoteContext.FLOAT_CONTINUOUS_SEC;

        // x(t) mapped into the viewport: x * 22 + 250  (domain -10..10 -> ~30..470)
        float[] ex = { VAR1, 22f, MUL, 250f, ADD };

        int[] modes = { 4 /* LINEAR */, 2 /* MONOTONIC */, 0 /* SPLINE */ };
        int[] bands = { 120, 250, 380 };   // vertical centre of each band

        w.root(() -> {
            w.startBox(new RecordingModifier().fillMaxSize(), 0, 0);
            w.startCanvas(new RecordingModifier().fillMaxSize().background(0xFF112244));
            w.startCanvasOperations();
            for (int i = 0; i < modes.length; i++) {
                // y = min(scale,15) * sin(x*0.3 + t) * sin(x*7), scaled and centred in a band
                float[] ey = {
                    15f, t, MIN,                       // min(scale, 15) with scale = seconds
                    VAR1, 0.3f, MUL, t, ADD, SIN, MUL, // * sin(x*0.3 + t)
                    VAR1, 7f, MUL, SIN, MUL,           // * sin(x*7)
                    4f, MUL, (float) bands[i], ADD,    // into the band
                };
                int pathId = w.addPathExpression(ex, ey, -10f, 10f, 128f, modes[i]);
                w.drawPath(pathId);
            }
            w.endCanvasOperations();
            w.endCanvas();
            w.endBox();
        });

        byte[] buf = w.buffer();
        try (FileOutputStream out = new FileOutputStream(args[0])) {
            out.write(buf, 0, w.bufferSize());
        }
        System.out.println("wrote " + args[0] + " (" + w.bufferSize() + " bytes)");
    }
}
