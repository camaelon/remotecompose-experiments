// RcLayoutDump: the Java reference (androidx remote-core) layout of a document, in the line
// format the C++ rc2layout and the TypeScript layout.mjs print, so the three engines diff:
//
//   LAYOUT id=<n> x=<f> y=<f> w=<f> h=<f>
//
//   RcLayoutDump DOC.rc WIDTH HEIGHT [--density D] [--frames N] [--anim] [STEP]...
//
// Loads, measures and settles the document the way layout-specs' CoverageHarness (and the
// Android LayoutSpecGeneratorTest) do, with MockRemoteContext; text is measured by that mock,
// so text sizes are approximate, everything else is the reference code. STEPs, in order, as
// layout-specs' interactive cases (the clock only moves when a step moves it):
//   --click X Y         CoreDocument.onClick at the point, then settle
//   --click-frame X Y   onClick, then paint a single frame (an animation left in flight)
//   --advance MS        move the clock MS milliseconds and paint one frame
//   --settle            paint every 16 ms while the document asks for a repaint
// --anim enables bounds animations (off by default, as the spec harness does).
import androidx.compose.remote.core.CoreDocument;
import androidx.compose.remote.core.RemoteComposeBuffer;
import androidx.compose.remote.core.RemoteContext;
import androidx.compose.remote.core.layout.MockRemoteContext;
import androidx.compose.remote.core.operations.Theme;
import androidx.compose.remote.core.operations.layout.Component;
import androidx.compose.remote.core.operations.layout.LayoutComponent;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class RcLayoutDump {
    static long now = 1735689600000L;

    public static void main(String[] args) throws Exception {
        byte[] bytes = Files.readAllBytes(Paths.get(args[0]));
        int w = Integer.parseInt(args[1]), h = Integer.parseInt(args[2]);
        float density = 1f;
        int frames = 200;
        List<Object[]> steps = new ArrayList<>();
        boolean anim = false;
        for (int i = 3; i < args.length; i++) {
            if (args[i].equals("--density")) density = Float.parseFloat(args[++i]);
            else if (args[i].equals("--frames")) frames = Integer.parseInt(args[++i]);
            else if (args[i].equals("--anim")) anim = true;
            else if (args[i].equals("--click") || args[i].equals("--click-frame")) steps.add(new Object[] {args[i], Float.parseFloat(args[++i]), Float.parseFloat(args[++i])});
            else if (args[i].equals("--advance")) steps.add(new Object[] {args[i], Float.parseFloat(args[++i]), 0f});
            else if (args[i].equals("--settle")) steps.add(new Object[] {args[i], 0f, 0f});
        }
        CoreDocument doc = new CoreDocument();
        doc.initFromBuffer(RemoteComposeBuffer.fromInputStream(new ByteArrayInputStream(bytes)));
        // MockRemoteContext.overrideFloat (what a click's value-change action calls) stores the
        // value but, unlike the player's AndroidRemoteContext (RemoteComposeState.overrideFloat),
        // does not mark the variable's listeners dirty: expressions and modifiers reading the
        // variable would never update. Notify them as the player does.
        MockRemoteContext ctx = new MockRemoteContext() {
            @Override
            public void overrideFloat(int id, float value) {
                super.overrideFloat(id, value);
                loadFloat(id, value);
            }
        };
        ctx.mWidth = w;
        ctx.mHeight = h;
        doc.initializeContext(ctx);
        ctx.setAnimationEnabled(anim);
        ctx.setDensity(density);
        ctx.loadFloat(RemoteContext.ID_WINDOW_WIDTH, w);
        ctx.loadFloat(RemoteContext.ID_WINDOW_HEIGHT, h);
        try { doc.applyDataOperations(ctx); } catch (Throwable t) { /* as the player */ }
        doc.measure(ctx, 0f, w, 0f, h);
        settle(doc, ctx, w, h, frames);
        for (Object[] st : steps) {
            String kind = (String) st[0];
            float a = (Float) st[1], b = (Float) st[2];
            if (kind.startsWith("--click")) {
                doc.onClick(ctx, a, b);
                if (kind.equals("--click")) settle(doc, ctx, w, h, frames); else paint(doc, ctx, w, h);
            } else if (kind.equals("--advance")) {
                now += (long) a;
                paint(doc, ctx, w, h);
            } else {
                settle(doc, ctx, w, h, frames);
            }
        }
        Component root = doc.getRootLayoutComponent();
        dump(root);
        if (args.length > 3 && String.join(" ", args).contains("--ints")) {
            for (int id = 40; id < 120; id++) System.out.println("INT id=" + id + " v=" + ctx.getInteger(id));
        }
    }

    static void settle(CoreDocument doc, MockRemoteContext ctx, int w, int h, int max) {
        paint(doc, ctx, w, h);
        for (int n = 0; doc.needsRepaint() != 0 && n < max; n++) {
            now += 16;
            paint(doc, ctx, w, h);
        }
    }

    static void paint(CoreDocument doc, MockRemoteContext ctx, int w, int h) {
        ctx.mWidth = w;
        ctx.mHeight = h;
        ctx.currentTime = now;
        doc.paint(ctx, Theme.UNSPECIFIED);
    }

    static void dump(Object o) {
        if (o instanceof Component) {
            Component c = (Component) o;
            System.out.println(String.format(Locale.ROOT, "LAYOUT id=%d x=%.2f y=%.2f w=%.2f h=%.2f %s",
                    c.getComponentId(), c.getX(), c.getY(), c.getWidth(), c.getHeight(), c.getClass().getSimpleName()));
        }
        if (o instanceof androidx.compose.remote.core.operations.layout.Container) {
            for (Object k : ((androidx.compose.remote.core.operations.layout.Container) o).getList()) dump(k);
        }
    }
}
