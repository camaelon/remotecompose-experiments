/*
 * A RemoteContext for rendering a whole document headlessly.
 *
 * Every store delegates to mRemoteComposeState, which is what AndroidRemoteContext does and is
 * not optional: RemoteContext.getCollectionsAccess() returns mRemoteComposeState, so a context
 * that keeps its own private maps leaves collections invisible to the very operations that read
 * them. That failure is silent and looks like an engine divergence — a vector expression or an
 * array-driven loop simply draws nothing, with no error anywhere.
 *
 * Inert here: bitmaps, shaders, haptics and actions, all of which need a platform object this
 * harness has no business inventing. A 3D document touches none of them.
 *
 * Deliberately not MockRemoteContext from remote-creation's test source set — that is 1100 lines
 * carrying its own PaintContext and a string log of every call, and it is test-set code this
 * harness would then depend on.
 */
import androidx.compose.remote.core.*;
import androidx.compose.remote.core.operations.*;
import androidx.compose.remote.core.operations.utilities.*;
import androidx.compose.remote.core.types.*;

import java.util.*;

public final class DocContext extends RemoteContext {
    @Override public void loadPathData(int instanceId, int winding, float[] floatPath) { mRemoteComposeState.putPathData(instanceId, floatPath);
            mRemoteComposeState.putPathWinding(instanceId, winding); }
    @Override public float[] getPathData(int instanceId) { return mRemoteComposeState.getPathData(instanceId); }
    @Override public void loadVariableName(String varName, int varId, int varType) {  }
    @Override public void loadColor(int id, int color) { mRemoteComposeState.updateColor(id, color); }
    @Override public void setNamedColorOverride(String colorName, int color) {  }
    @Override public void setNamedStringOverride(String stringName, String value) {  }
    @Override public void clearNamedStringOverride(String stringName) {  }
    @Override public void setNamedBooleanOverride(String booleanName, boolean value) {  }
    @Override public void clearNamedBooleanOverride(String booleanName) {  }
    @Override public void setNamedIntegerOverride(String integerName, int value) {  }
    @Override public void clearNamedIntegerOverride(String integerName) {  }
    @Override public void setNamedFloatOverride(String floatName, float value) {  }
    @Override public void clearNamedFloatOverride(String floatName) {  }
    @Override public void setNamedLong(String name, long value) {  }
    @Override public void setNamedDataOverride(String dataName, Object value) {  }
    @Override public void clearNamedDataOverride(String dataName) {  }
    @Override public void addCollection(int id, ArrayAccess collection) { mRemoteComposeState.addCollection(id, collection); }
    @Override public void putDataMap(int id, DataMap map) { mRemoteComposeState.putDataMap(id, map); }
    @Override public DataMap getDataMap(int id) { return mRemoteComposeState.getDataMap(id); }
    @Override public void runAction(int id, String metadata) {  }
    @Override public void runNamedAction(int id, Object value) {  }
    @Override public void putObject(int id, Object value) { mRemoteComposeState.updateObject(id, value); }
    @Override public Object getObject(int id) { return mRemoteComposeState.getObject(id); }
    @Override public void hapticEffect(int type) {  }
    @Override public void loadBitmap(int imageId, short encoding, short type, int width, int height, byte[] bitmap) {  }
    @Override public void loadText(int id, String text) { if (!mRemoteComposeState.containsId(id)) { mRemoteComposeState.cacheData(id, text); }
            else { mRemoteComposeState.updateData(id, text); } }
    @Override public String getText(int id) { return (String) mRemoteComposeState.getFromId(id); }
    @Override public void loadFloat(int id, float value) { mRemoteComposeState.updateFloat(id, value); }
    @Override public void overrideFloat(int id, float value) { mRemoteComposeState.overrideFloat(id, value); }
    @Override public void loadInteger(int id, int value) { mRemoteComposeState.updateInteger(id, value); }
    @Override public void overrideInteger(int id, int value) { mRemoteComposeState.overrideInteger(id, value); }
    @Override public void overrideText(int id, int valueId) {  }
    @Override public void loadAnimatedFloat(int id, FloatExpression animatedFloat) { mRemoteComposeState.cacheData(id, animatedFloat); }
    @Override public void loadShader(int id, ShaderData value) {  }
    @Override public float getFloat(int id) { return (float) mRemoteComposeState.getFloat(id); }
    @Override public int getInteger(int id) { return mRemoteComposeState.getInteger(id); }
    @Override public long getLong(int id) { return 0; }
    @Override public int getColor(int id) { return mRemoteComposeState.getColor(id); }
    @Override public void listensTo(int id, VariableSupport variableSupport) { mRemoteComposeState.listenToVar(id, variableSupport); }
    @Override public int updateOps() { return mRemoteComposeState.getOpsToUpdate(this, System.currentTimeMillis()); }
    @Override public ShaderData getShader(int id) { return null; }
    @Override public void addClickArea(int id, int contentDescriptionId, float left, float top, float right, float bottom, int metadataId) {  }
}
