/*
 * Copyright 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Desktop adaptation of ComposeRemoteContext.
 */
package org.nirensei.remoteplayer

import androidx.compose.remote.core.RemoteClock
import androidx.compose.remote.core.RemoteContext
import androidx.compose.remote.core.VariableSupport
import androidx.compose.remote.core.operations.BitmapData
import androidx.compose.remote.core.operations.FloatExpression
import androidx.compose.remote.core.operations.ShaderData
import androidx.compose.remote.core.operations.utilities.ArrayAccess
import androidx.compose.remote.core.operations.utilities.DataMap
import androidx.compose.remote.core.types.LongConstant
import org.jetbrains.skia.Image as SkiaImage

/** A [RemoteContext] implementation for Compose Desktop (Skia-backed). */
internal class DesktopRemoteContext(clock: RemoteClock) : RemoteContext(clock) {
    private val varNameHashMap: HashMap<String, VarName?> = HashMap()
    var a11yAnimationEnabled: Boolean = true

    override fun loadPathData(instanceId: Int, winding: Int, floatPath: FloatArray) {
        mRemoteComposeState.putPathData(instanceId, floatPath)
        mRemoteComposeState.putPathWinding(instanceId, winding)
    }

    override fun getPathData(instanceId: Int): FloatArray? =
        mRemoteComposeState.getPathData(instanceId)

    override fun loadVariableName(varName: String, varId: Int, varType: Int) {
        varNameHashMap[varName] = VarName(varName, varId, varType)
    }

    override fun loadColor(id: Int, color: Int) {
        mRemoteComposeState.updateColor(id, color)
    }

    override fun setNamedColorOverride(colorName: String, color: Int) {
        val id = varNameHashMap[colorName]?.id ?: return
        mRemoteComposeState.overrideColor(id, color)
    }

    override fun setNamedStringOverride(stringName: String, value: String) {
        val id = varNameHashMap[stringName]?.id ?: return
        mRemoteComposeState.overrideData(id, value)
    }

    override fun clearNamedStringOverride(stringName: String) {
        val id = varNameHashMap[stringName]?.id ?: return
        mRemoteComposeState.clearDataOverride(id)
        varNameHashMap[stringName] = null
    }

    override fun setNamedBooleanOverride(booleanName: String, value: Boolean) {
        setNamedIntegerOverride(booleanName, if (value) 1 else 0)
    }

    override fun clearNamedBooleanOverride(booleanName: String) {
        clearNamedIntegerOverride(booleanName)
    }

    override fun setNamedIntegerOverride(integerName: String, value: Int) {
        val id = varNameHashMap[integerName]?.id ?: return
        mRemoteComposeState.overrideInteger(id, value)
    }

    override fun clearNamedIntegerOverride(integerName: String) {
        val id = varNameHashMap[integerName]?.id ?: return
        mRemoteComposeState.clearIntegerOverride(id)
        varNameHashMap[integerName] = null
    }

    override fun setNamedFloatOverride(floatName: String, value: Float) {
        val id = varNameHashMap[floatName]?.id ?: return
        mRemoteComposeState.overrideFloat(id, value)
    }

    override fun clearNamedFloatOverride(floatName: String) {
        val id = varNameHashMap[floatName]?.id ?: return
        mRemoteComposeState.clearFloatOverride(id)
        varNameHashMap[floatName] = null
    }

    override fun setNamedLong(name: String, value: Long) {
        val id = varNameHashMap[name]?.id ?: return
        val longConstant = mRemoteComposeState.getObject(id) as? LongConstant ?: return
        longConstant.value = value
    }

    override fun setNamedDataOverride(dataName: String, value: Any) {
        val id = varNameHashMap[dataName]?.id ?: return
        mRemoteComposeState.overrideData(id, value)
    }

    override fun clearNamedDataOverride(dataName: String) {
        val id = varNameHashMap[dataName]?.id ?: return
        mRemoteComposeState.clearDataOverride(id)
        varNameHashMap[dataName] = null
    }

    override fun addCollection(id: Int, collection: ArrayAccess) {
        mRemoteComposeState.addCollection(id, collection)
    }

    override fun putDataMap(id: Int, map: DataMap) {
        mRemoteComposeState.putDataMap(id, map)
    }

    override fun getDataMap(id: Int): DataMap? = mRemoteComposeState.getDataMap(id)

    override fun runAction(id: Int, metadata: String) {
        mDocument.performClick(this, id, metadata)
    }

    override fun runNamedAction(id: Int, value: Any?) {
        val text = getText(id) ?: return
        mDocument.runNamedAction(text, value)
    }

    override fun putObject(id: Int, value: Any) {
        mRemoteComposeState.updateObject(id, value)
    }

    override fun getObject(id: Int): Any? = mRemoteComposeState.getObject(id)

    override fun hapticEffect(type: Int) {
        // No-op on desktop.
    }

    override fun loadBitmap(
        imageId: Int,
        encoding: Short,
        type: Short,
        width: Int,
        height: Int,
        bitmap: ByteArray,
    ) {
        if (mRemoteComposeState.containsId(imageId)) return
        val image: SkiaImage? = try {
            when (encoding) {
                BitmapData.ENCODING_INLINE -> when (type) {
                    BitmapData.TYPE_PNG_8888,
                    BitmapData.TYPE_PNG_ALPHA_8 -> SkiaImage.makeFromEncoded(bitmap)
                    BitmapData.TYPE_RAW8888,
                    BitmapData.TYPE_RAW8 -> null // TODO: raw decoding not yet implemented
                    else -> null
                }
                BitmapData.ENCODING_FILE -> {
                    val path = String(bitmap)
                    SkiaImage.makeFromEncoded(java.io.File(path).readBytes())
                }
                BitmapData.ENCODING_URL,
                BitmapData.ENCODING_EMPTY -> null
                else -> null
            }
        } catch (e: Throwable) {
            null
        }
        if (image != null) {
            mRemoteComposeState.cacheData(imageId, image)
        }
    }

    override fun loadText(id: Int, text: String) {
        if (!mRemoteComposeState.containsId(id)) {
            mRemoteComposeState.cacheData(id, text)
        } else {
            mRemoteComposeState.updateData(id, text)
        }
    }

    override fun getText(id: Int): String? = mRemoteComposeState.getFromId(id) as? String

    override fun loadFloat(id: Int, value: Float) {
        mRemoteComposeState.updateFloat(id, value)
    }

    override fun overrideFloat(id: Int, value: Float) {
        mRemoteComposeState.overrideFloat(id, value)
    }

    override fun loadInteger(id: Int, value: Int) {
        mRemoteComposeState.updateInteger(id, value)
    }

    override fun overrideInteger(id: Int, value: Int) {
        mRemoteComposeState.overrideInteger(id, value)
    }

    override fun overrideText(id: Int, valueId: Int) {
        val text = getText(valueId) ?: return
        mRemoteComposeState.overrideData(id, text)
    }

    override fun loadAnimatedFloat(id: Int, animatedFloat: FloatExpression) {
        mRemoteComposeState.cacheData(id, animatedFloat)
    }

    override fun loadShader(id: Int, value: ShaderData) {
        mRemoteComposeState.cacheData(id, value)
    }

    override fun getFloat(id: Int): Float = mRemoteComposeState.getFloat(id)

    override fun getInteger(id: Int): Int = mRemoteComposeState.getInteger(id)

    override fun getLong(id: Int): Long {
        val lc = mRemoteComposeState.getObject(id) as? LongConstant
        return lc?.value ?: 0L
    }

    override fun getColor(id: Int): Int = mRemoteComposeState.getColor(id)

    override fun listensTo(id: Int, variableSupport: VariableSupport) {
        mRemoteComposeState.listenToVar(id, variableSupport)
    }

    override fun updateOps(): Int =
        mRemoteComposeState.getOpsToUpdate(this, currentTime)

    override fun getShader(id: Int): ShaderData? =
        mRemoteComposeState.getFromId(id) as? ShaderData

    override fun addClickArea(
        id: Int,
        contentDescriptionId: Int,
        left: Float,
        top: Float,
        right: Float,
        bottom: Float,
        metadataId: Int,
    ) {
        val contentDescription = mRemoteComposeState.getFromId(contentDescriptionId) as? String
        val metadata = mRemoteComposeState.getFromId(metadataId) as? String
        mDocument.addClickArea(id, contentDescription, left, top, right, bottom, metadata)
    }

    override fun isAnimationEnabled(): Boolean =
        if (a11yAnimationEnabled) super.isAnimationEnabled() else false
}

private data class VarName(val name: String, val id: Int, val type: Int)
