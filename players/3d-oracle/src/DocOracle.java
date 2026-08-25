/*
 * DocOracle — render a whole .rc document with the *reference* Java engine, headlessly.
 *
 * 3d-parity.sh drives the engines from a scene script, which covers the rasterizer and the
 * primitives but not the pipeline that feeds them. This drives the whole thing — WireBuffer ->
 * CoreDocument -> the ten registered 3D operations -> JavaPaint3DContext's software renderer —
 * so it also covers decoding, variable resolution and per-frame regeneration.
 *
 * The C++ counterpart is tools/rc3d, and the two take the same arguments on purpose:
 *
 *     java -cp classes DocOracle <in.rc> <out.png> [--width N] [--height N]
 *                                                  [--frames N] [--time SECONDS]
 *
 * The clock is pinned rather than read. Without that, continuousSec() returns wall time and no
 * two players ever agree on anything animated, so a pixel comparison measures the clock instead
 * of the code.
 *
 * Only the 3D surface is live; the 2D calls are inert, exactly as in rc3d. A document that
 * draws 2D content will therefore show only its 3D content here, which is what makes the
 * comparison a comparison *of the 3D renderer*.
 */
import androidx.compose.remote.core.CoreDocument;
import androidx.compose.remote.core.RemoteClock;
import androidx.compose.remote.core.RemoteComposeBuffer;
import androidx.compose.remote.core.RemoteContext;
import androidx.compose.remote.core.TimeVariables;
import androidx.compose.remote.player.core.platform.d3.JavaPaint3DContext;

import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileInputStream;

public final class DocOracle {

    private static int flagInt(String[] a, String name, int def) {
        for (int i = 0; i < a.length - 1; i++) {
            if (a[i].equals("--" + name)) {
                return Integer.parseInt(a[i + 1]);
            }
        }
        return def;
    }

    /** Epoch milliseconds do not survive a float: 1.7e12 needs 41 bits of mantissa and a
     * float has 24, so parsing the pin as a float would quietly round it to the nearest ~130ms
     * and the two players would be pinned to different instants. */
    private static long flagLong(String[] a, String name, long def) {
        for (int i = 0; i < a.length - 1; i++) {
            if (a[i].equals("--" + name)) {
                return Long.parseLong(a[i + 1]);
            }
        }
        return def;
    }

    private static float flagFloat(String[] a, String name, float def) {
        for (int i = 0; i < a.length - 1; i++) {
            if (a[i].equals("--" + name)) {
                return Float.parseFloat(a[i + 1]);
            }
        }
        return def;
    }

    /** A clock stopped at one instant. Calendar decomposition is delegated to the reference's
     * own system clock so only the instant is substituted, not the arithmetic around it. */
    private static final class FixedClock implements RemoteClock {
        private final long mMillis;

        FixedClock(long millis) {
            mMillis = millis;
        }

        @Override public long millis() {
            return mMillis;
        }

        @Override public long nanoTime() {
            return mMillis * 1_000_000L;
        }

        @Override public String getZoneId() {
            return RemoteClock.SYSTEM.getZoneId();
        }

        @Override public TimeSnapshot snapshot(Long millis) {
            return RemoteClock.SYSTEM.snapshot(millis == null ? mMillis : millis);
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("usage: DocOracle <in.rc> <out.png> [--width N] [--height N]"
                    + " [--frames N] [--time SECONDS] [--epoch MILLIS]");
            System.exit(2);
        }
        CoreDocument doc = new CoreDocument();
        try (FileInputStream in = new FileInputStream(args[0])) {
            doc.initFromBuffer(RemoteComposeBuffer.fromInputStream(in));
        }

        int w = flagInt(args, "width", doc.getWidth() > 0 ? doc.getWidth() : 400);
        int h = flagInt(args, "height", doc.getHeight() > 0 ? doc.getHeight() : 400);
        int frames = flagInt(args, "frames", 1);
        float at = flagFloat(args, "time", 0f);
        long epoch = flagLong(args, "epoch", 0L);

        // Pinning the clock has to happen at the *source*, not by loading the time variables
        // before paint(): paint() calls mTimeVariables.updateTime(), which overwrites them.
        // Setting the floats first and hoping looks like it works and silently does not —
        // both players then render at wall time and disagree on every animated document.
        if (epoch > 0) {
            doc.mTimeVariables = new TimeVariables(new FixedClock(epoch));
        }

        JavaPaint3DContext engine = new JavaPaint3DContext();
        engine.setSize(w, h);

        DocContext ctx = new DocContext();
        OracleBridge.P3D paint = new OracleBridge.P3D(ctx, engine);
        ctx.setPaintContext(paint);
        ctx.mWidth = w;
        ctx.mHeight = h;

        doc.setWidth(w);
        doc.setHeight(h);
        doc.initializeContext(ctx);

        for (int f = 0; f < frames; f++) {
            // Pinned clock, same three ids rc3d pins, so the two renders are comparable.
            ctx.loadFloat(RemoteContext.ID_ANIMATION_TIME, at);
            ctx.loadFloat(RemoteContext.ID_CONTINUOUS_SEC, at);
            ctx.loadFloat(RemoteContext.ID_TIME_IN_SEC, at);
            doc.paint(ctx, -2); // THEME_DARK, matching rc2image and rc3d
        }

        int[] px = engine.getColorBuffer();
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        if (px != null) {
            img.setRGB(0, 0, w, h, px, 0, w);
        }
        javax.imageio.ImageIO.write(img, "png", new File(args[1]));
        System.out.println("wrote " + args[1] + " (" + w + "x" + h + ")");
    }
}
