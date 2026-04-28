// WebRemoteContext: concrete RemoteContext for web/Canvas playback.

import { RemoteContext } from '../core/RemoteContext';
import type { RemoteClock } from '../core/RemoteClock';
import { SYSTEM_CLOCK } from '../core/RemoteClock';
import type { VariableSupport } from '../core/VariableSupport';
import type { CanvasPaintContext } from './CanvasPaintContext';
import { getDefaultSystemColor } from '../core/DefaultSystemColors';

export class WebRemoteContext extends RemoteContext {
    private canvasPaintContext: CanvasPaintContext;

    // Named variable tracking
    private namedVariables = new Map<string, { id: number; type: number }>();
    private namedColorOverrides = new Map<string, number>();
    private namedStringOverrides = new Map<string, string>();
    private namedBooleanOverrides = new Map<string, boolean>();
    private namedIntegerOverrides = new Map<string, number>();
    private namedFloatOverrides = new Map<string, number>();

    constructor(paintContext: CanvasPaintContext, clock: RemoteClock = SYSTEM_CLOCK) {
        super(clock);
        this.canvasPaintContext = paintContext;
        this.mPaintContext = paintContext;
    }

    // --- Path data ---

    loadPathData(instanceId: number, winding: number, floatPath: Float32Array): void {
        this.mRemoteComposeState.putPathData(instanceId, floatPath);
        this.mRemoteComposeState.putPathWinding(instanceId, winding);
        this.canvasPaintContext.loadPathData(instanceId, winding, floatPath);
    }

    getPathData(instanceId: number): Float32Array | null {
        return this.mRemoteComposeState.getPathData(instanceId);
    }

    // --- Variables ---

    loadVariableName(varName: string, varId: number, varType: number): void {
        this.namedVariables.set(varName, { id: varId, type: varType });

        // Apply default Material Design system color if this is a color variable
        // with a known system name and no explicit override has been set.
        if (varType === 2) { // COLOR_TYPE
            const lookupName = varName.startsWith('color.') ? varName.substring(6) : varName;
            const defaultColor = getDefaultSystemColor(lookupName);
            if (defaultColor !== undefined && !this.namedColorOverrides.has(varName)) {
                this.mRemoteComposeState.overrideColor(varId, defaultColor);
            }
        }
    }

    getVariableNameMap(): Map<number, string> {
        const map = new Map<number, string>();
        this.namedVariables.forEach(({ id }, name) => map.set(id, name));
        return map;
    }

    // --- Color ---

    loadColor(id: number, color: number): void {
        this.mRemoteComposeState.updateColor(id, color);
    }

    setNamedColorOverride(colorName: string, color: number): void {
        this.namedColorOverrides.set(colorName, color);
        const v = this.namedVariables.get(colorName);
        if (v) this.mRemoteComposeState.overrideColor(v.id, color);
    }

    getColor(id: number): number { return this.mRemoteComposeState.getColor(id); }

    // --- String ---

    setNamedStringOverride(stringName: string, value: string): void {
        this.namedStringOverrides.set(stringName, value);
        const v = this.namedVariables.get(stringName);
        if (v) this.mRemoteComposeState.overrideData(v.id, value);
    }

    clearNamedStringOverride(stringName: string): void {
        this.namedStringOverrides.delete(stringName);
        const v = this.namedVariables.get(stringName);
        if (v) this.mRemoteComposeState.clearDataOverride(v.id);
    }

    // --- Boolean ---

    setNamedBooleanOverride(booleanName: string, value: boolean): void {
        this.namedBooleanOverrides.set(booleanName, value);
    }

    clearNamedBooleanOverride(booleanName: string): void {
        this.namedBooleanOverrides.delete(booleanName);
    }

    // --- Integer ---

    setNamedIntegerOverride(integerName: string, value: number): void {
        this.namedIntegerOverrides.set(integerName, value);
        const v = this.namedVariables.get(integerName);
        if (v) this.mRemoteComposeState.overrideInteger(v.id, value);
    }

    clearNamedIntegerOverride(integerName: string): void {
        this.namedIntegerOverrides.delete(integerName);
        const v = this.namedVariables.get(integerName);
        if (v) this.mRemoteComposeState.clearIntegerOverride(v.id);
    }

    // --- Float ---

    setNamedFloatOverride(floatName: string, value: number): void {
        this.namedFloatOverrides.set(floatName, value);
        const v = this.namedVariables.get(floatName);
        if (v) this.mRemoteComposeState.overrideFloat(v.id, value);
    }

    clearNamedFloatOverride(floatName: string): void {
        this.namedFloatOverrides.delete(floatName);
        const v = this.namedVariables.get(floatName);
        if (v) this.mRemoteComposeState.clearFloatOverride(v.id);
    }

    // --- Long ---

    setNamedLong(_name: string, _value: number): void { /* stub */ }

    // --- Data ---

    setNamedDataOverride(dataName: string, value: any): void {
        const v = this.namedVariables.get(dataName);
        if (v) this.mRemoteComposeState.overrideData(v.id, value);
    }

    clearNamedDataOverride(dataName: string): void {
        const v = this.namedVariables.get(dataName);
        if (v) this.mRemoteComposeState.clearDataOverride(v.id);
    }

    // --- Collections & DataMaps ---

    addCollection(id: number, collection: any): void {
        this.mRemoteComposeState.addCollection(id, collection);
    }

    putDataMap(id: number, map: any): void { this.mRemoteComposeState.putDataMap(id, map); }
    getDataMap(id: number): any { return this.mRemoteComposeState.getDataMap(id); }

    // --- Actions ---

    runAction(id: number, metadata: string): void {
        this.mDocument?.runAction(id, metadata);
    }

    runNamedAction(id: number, value: any): void {
        const name = this.mRemoteComposeState.getFromId(id) as string;
        this.mDocument?.runNamedAction(name, value);
    }

    // --- Objects ---

    putObject(id: number, value: any): void { this.mRemoteComposeState.updateObject(id, value); }
    getObject(id: number): any { return this.mRemoteComposeState.getObject(id); }

    // --- Haptic ---

    hapticEffect(_type: number): void { /* no-op on web */ }

    // --- Bitmap ---

    loadBitmap(imageId: number, encoding: number, type: number,
               width: number, height: number, bitmap: Uint8Array): void {
        this.canvasPaintContext.loadBitmap(imageId, encoding, type, width, height, bitmap);
    }

    // --- Text ---

    loadText(id: number, text: string): void {
        this.mRemoteComposeState.cacheDataWithId(id, text);
        this.canvasPaintContext.loadText(id, text);
    }

    getText(id: number): string | null {
        return this.canvasPaintContext.getText(id);
    }

    // --- Float ---

    loadFloat(id: number, value: number): void { this.mRemoteComposeState.updateFloat(id, value); }
    overrideFloat(id: number, value: number): void { this.mRemoteComposeState.overrideFloat(id, value); }
    getFloat(id: number): number { return this.mRemoteComposeState.getFloat(id); }

    // --- Integer ---

    loadInteger(id: number, value: number): void { this.mRemoteComposeState.updateInteger(id, value); }
    overrideInteger(id: number, value: number): void { this.mRemoteComposeState.overrideInteger(id, value); }
    getInteger(id: number): number { return this.mRemoteComposeState.getInteger(id); }
    getLong(id: number): number { return this.mRemoteComposeState.getInteger(id); }

    // --- Text override ---

    overrideText(id: number, valueId: number): void {
        const text = this.mRemoteComposeState.getFromId(valueId) as string;
        if (text) this.loadText(id, text);
    }

    // --- Animated float ---

    loadAnimatedFloat(_id: number, _animatedFloat: any): void { /* stub */ }

    // --- Shader ---

    loadShader(id: number, value: any): void {
        this.mRemoteComposeState.updateObject(id, value);
    }

    getShader(id: number): any {
        return this.mRemoteComposeState.getObject(id);
    }

    // --- Listeners ---

    listensTo(id: number, variableSupport: VariableSupport): void {
        this.mRemoteComposeState.listenToVar(id, variableSupport);
    }

    // --- Click areas ---

    addClickArea(id: number, contentDescriptionId: number, left: number, top: number,
                 right: number, bottom: number, metadataId: number): void {
        const cd = (this.mRemoteComposeState.getFromId(contentDescriptionId) as string) ?? '';
        const meta = (this.mRemoteComposeState.getFromId(metadataId) as string) ?? '';
        this.mDocument?.addClickArea(id, cd, left, top, right, bottom, meta);
    }

    // --- Update ops ---

    updateOps(): number {
        return this.mRemoteComposeState.getOpsToUpdate(this, Date.now());
    }
}
