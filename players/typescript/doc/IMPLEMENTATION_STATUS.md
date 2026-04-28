# TypeScript Player — Implementation Status

## RemoteContext System

### Fully Implemented
- RemoteContext abstract base class with all 37 system variable IDs
- NaN-encoded float constants for all system variables
- ContextMode enum (UNSET, DATA, PAINT)
- All abstract method declarations matching Java
- Operation count safety limit (20,000)
- Animation time, density, theme, debug management
- Header processing and root content behavior

### RemoteComposeState — Fully Implemented
- All data tables: mFloatMap, mIntegerMap, mColorMap, mIntDataMap, mObjectMap
- Path storage: mPathData, mPathMap, mPathWinding
- Collection storage: mCollectionMap, mDataMapMap
- Override system: mFloatOverride, mIntegerOverride, mDataOverride, mColorOverride
- Variable listener system: listenToVar, updateListeners, markDirty
- ID generation (START_ID=42)
- getOpsToUpdate / wakeIn for repaint scheduling
- getFloatValue / getListLength for collection access

### WebRemoteContext — Fully Implemented
- Named variable tracking for all types (color, string, boolean, integer, float, data)
- loadPathData, loadColor, loadText, loadFloat, loadInteger
- overrideFloat, overrideInteger, overrideText
- addCollection, putDataMap, getDataMap
- putObject, getObject
- listensTo (delegates to RemoteComposeState)
- addClickArea, runAction, runNamedAction
- updateOps (delegates to RemoteComposeState.getOpsToUpdate)

### Gaps Relative to Java

1. **RemoteComposeState.getFloats(id)** — Java returns backing float[] from ArrayAccess;
   TS getFloatValue exists but getFloats/getDynamicFloats/getArray/getId are missing.

2. **loadShader / getShader** — WebRemoteContext stubs these (no-op). Full shader
   support requires AGSL/WebGL integration.

3. **loadAnimatedFloat** — Stubbed. Full FloatExpression animation evaluation would
   need the expression engine to be wired into the variable listener system.

4. **loadFont** — Base class has basic implementation storing FontInfo objects.
   Full font loading requires platform font API integration.

5. **System variable population** — Java player populates time/sensor variables
   each frame from platform APIs. TS does not yet populate ID_CONTINUOUS_SEC,
   ID_TIME_IN_SEC, etc. from Date APIs during paint.
