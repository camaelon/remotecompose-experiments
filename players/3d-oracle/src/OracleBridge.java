/*
 * Minimal PaintContext / RemoteContext bridge so the oracle can drive the *real* remote-core
 * operations rather than a re-implementation of them.
 *
 * Only the 3D surface is live: everything else is a stub, because a MeshExpression's paint()
 * touches exactly two things — the Paint3DContext cast and getContext().getCollectionsAccess().
 * Re-implementing the op in the harness would test the copy, not the op.
 */
import androidx.compose.remote.core.*;
import androidx.compose.remote.core.operations.*;
import androidx.compose.remote.core.operations.layout.*;
import androidx.compose.remote.core.operations.paint.*;
import androidx.compose.remote.core.operations.utilities.*;
import androidx.compose.remote.core.semantics.*;
import androidx.compose.remote.core.types.*;
import androidx.compose.remote.player.core.platform.d3.JavaPaint3DContext;

import java.util.*;

public final class OracleBridge {

    /** A RemoteContext that answers only what an expression evaluation needs. */
    public static final class Ctx extends RemoteContext {
    @Override public void loadPathData(int instanceId, int winding, float[] floatPath) { }
    @Override public float[] getPathData(int instanceId) { return null; }
    @Override public void loadVariableName(String varName, int varId, int varType) { }
    @Override public void loadColor(int id, int color) { }
    @Override public void setNamedColorOverride(String colorName, int color) { }
    @Override public void setNamedStringOverride(String stringName, String value) { }
    @Override public void clearNamedStringOverride(String stringName) { }
    @Override public void setNamedBooleanOverride(String booleanName, boolean value) { }
    @Override public void clearNamedBooleanOverride(String booleanName) { }
    @Override public void setNamedIntegerOverride(String integerName, int value) { }
    @Override public void clearNamedIntegerOverride(String integerName) { }
    @Override public void setNamedFloatOverride(String floatName, float value) { }
    @Override public void clearNamedFloatOverride(String floatName) { }
    @Override public void setNamedLong(String name, long value) { }
    @Override public void setNamedDataOverride(String dataName, Object value) { }
    @Override public void clearNamedDataOverride(String dataName) { }
    @Override public void addCollection(int id, ArrayAccess collection) { }
    @Override public void putDataMap(int id, DataMap map) { }
    @Override public DataMap getDataMap(int id) { return null; }
    @Override public void runAction(int id, String metadata) { }
    @Override public void runNamedAction(int id, Object value) { }
    @Override public void putObject(int id, Object value) { }
    @Override public Object getObject(int id) { return null; }
    @Override public void hapticEffect(int type) { }
    @Override public void loadBitmap(int imageId, short encoding, short type, int width, int height, byte[] bitmap) { }
    @Override public void loadText(int id, String text) { }
    @Override public String getText(int id) { return null; }
    @Override public void loadFloat(int id, float value) { }
    @Override public void overrideFloat(int id, float value) { }
    @Override public void loadInteger(int id, int value) { }
    @Override public void overrideInteger(int id, int value) { }
    @Override public void overrideText(int id, int valueId) { }
    @Override public void loadAnimatedFloat(int id, FloatExpression animatedFloat) { }
    @Override public void loadShader(int id, ShaderData value) { }
    @Override public float getFloat(int id) { return 0; }
    @Override public int getInteger(int id) { return 0; }
    @Override public long getLong(int id) { return 0; }
    @Override public int getColor(int id) { return 0; }
    @Override public void listensTo(int id, VariableSupport variableSupport) { }
    @Override public int updateOps() { return 0; }
    @Override public ShaderData getShader(int id) { return null; }
    @Override public void addClickArea(int id, int contentDescriptionId, float left, float top, float right, float bottom, int metadataId) { }
    }

    /** A PaintContext that forwards the 3D surface to the software engine. */
    public static final class P3D extends PaintContext implements Paint3DContext {
        private final JavaPaint3DContext m3d;

        public P3D(RemoteContext ctx, JavaPaint3DContext engine) {
            super(ctx);
            m3d = engine;
        }

        @Override public void defineMesh3D(int id, int[] i, float[] v, float[] n) {
            m3d.defineMesh3D(id, i, v, n);
        }
        @Override public void defineMesh3D(int id, int[] i, float[] v, float[] n, float[] uv) {
            m3d.defineMesh3D(id, i, v, n, uv);
        }
        @Override public void setCamera3D(int p, float[] pp, float[] vp) {
            m3d.setCamera3D(p, pp, vp);
        }
        @Override public void matrix3Op(int sub, float[] args) { m3d.matrix3Op(sub, args); }
        @Override public void drawMesh3D(int meshId, int mode) { m3d.drawMesh3D(meshId, mode); }
        @Override public void clearDepth3D() { m3d.clearDepth3D(); }
        @Override public void setLights3D(int[] t, int[] c, float[] p) { m3d.setLights3D(t, c, p); }
        @Override public void setTexture3D(int bitmapId) { m3d.setTexture3D(bitmapId); }
        @Override public void setMaterial3D(float s, float sh) { m3d.setMaterial3D(s, sh); }
        @Override public void setDepthBias3D(float c, float s) { m3d.setDepthBias3D(c, s); }

    @Override public void drawBitmap(int imageId, int srcLeft, int srcTop, int srcRight, int srcBottom, int dstLeft, int dstTop, int dstRight, int dstBottom, int cdId) { }
    @Override public void scale(float scaleX, float scaleY) { }
    @Override public void translate(float translateX, float translateY) { }
    @Override public void drawArc(float left, float top, float right, float bottom, float startAngle, float sweepAngle) { }
    @Override public void drawSector(float left, float top, float right, float bottom, float startAngle, float sweepAngle) { }
    @Override public void drawBitmap(int id, float left, float top, float right, float bottom) { }
    @Override public void drawCircle(float centerX, float centerY, float radius) { }
    @Override public void drawLine(float x1, float y1, float x2, float y2) { }
    @Override public void drawOval(float left, float top, float right, float bottom) { }
    @Override public void drawPath(int id, float start, float end) { }
    @Override public void drawRect(float left, float top, float right, float bottom) { }
    @Override public void savePaint() { }
    @Override public void restorePaint() { }
    @Override public void replacePaint(PaintBundle paintBundle) { }
    @Override public void drawRoundRect(float left, float top, float right, float bottom, float radiusX, float radiusY) { }
    @Override public void drawTextOnPath(int textId, int pathId, float hOffset, float vOffset) { }
    @Override public void getTextBounds(int textId, int start, int end, int flags, float[] bounds) { }
    @Override public RcPlatformServices. ComputedTextLayout layoutComplexText(int textId, int start, int end, int alignment, int overflow, int maxLines, float maxWidth, float maxHeight, float letterSpacing, float lineHeightAdd, float lineHeightMultiplier, int lineBreakStrategy, int hyphenationFrequency, int justificationMode, boolean useUnderline, boolean strikethrough, int flags) { return null; }
    @Override public void drawTextRun(int textId, int start, int end, int contextStart, int contextEnd, float x, float y, boolean rtl) { }
    @Override public void drawComplexText(RcPlatformServices. ComputedTextLayout computedTextLayout) { }
    @Override public void drawTweenPath(int path1Id, int path2Id, float tween, float start, float end) { }
    @Override public void tweenPath(int out, int path1, int path2, float tween) { }
    @Override public void combinePath(int out, int path1, int path2, byte operation) { }
    @Override public void applyPaint(PaintBundle mPaintData) { }
    @Override public void matrixScale(float scaleX, float scaleY, float centerX, float centerY) { }
    @Override public void matrixTranslate(float translateX, float translateY) { }
    @Override public void matrixSkew(float skewX, float skewY) { }
    @Override public void matrixRotate(float rotate, float pivotX, float pivotY) { }
    @Override public void matrixSave() { }
    @Override public void matrixRestore() { }
    @Override public void clipRect(float left, float top, float right, float bottom) { }
    @Override public void clipPath(int pathId, int regionOp) { }
    @Override public void roundedClipRect(float width, float height, float topStart, float topEnd, float bottomStart, float bottomEnd) { }
    @Override public void reset() { }
    @Override public void startGraphicsLayer(int w, int h) { }
    @Override public void setGraphicsLayer(HashMap<Integer, Object> attributes) { }
    @Override public void endGraphicsLayer() { }
    @Override public String getText(int id) { return null; }
    @Override public void matrixFromPath(int pathId, float fraction, float vOffset, int flags) { }
    @Override public void drawToBitmap(int bitmapId, int mode, int color) { }
    }
}
