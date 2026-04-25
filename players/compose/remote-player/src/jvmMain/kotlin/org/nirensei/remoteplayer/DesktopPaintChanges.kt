/*
 * Copyright 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Desktop (Skia) adaptation of ComposePaintChanges.
 */
package org.nirensei.remoteplayer

import androidx.compose.remote.core.RemoteContext
import androidx.compose.remote.core.operations.ShaderData
import androidx.compose.remote.core.operations.paint.PaintBundle
import androidx.compose.remote.core.operations.paint.PaintChanges
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.PaintingStyle
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import org.jetbrains.skia.ColorFilter
import org.jetbrains.skia.FilterTileMode
import org.jetbrains.skia.Font
import org.jetbrains.skia.FontStyle
import org.jetbrains.skia.FontWeight
import org.jetbrains.skia.Image as SkiaImage
import org.jetbrains.skia.Point as SkPoint
import org.jetbrains.skia.RuntimeEffect
import org.jetbrains.skia.RuntimeShaderBuilder
import org.jetbrains.skia.SamplingMode
import org.jetbrains.skia.Shader
import org.jetbrains.skia.Typeface as SkTypeface

internal class DesktopPaintChanges(
    private val remoteContext: RemoteContext,
    private val getPaint: () -> Paint,
) : PaintChanges {

    private var font: Font = Font(defaultTypeface(), 30f)
    private val effectCache: MutableMap<Int, RuntimeEffect> = HashMap()

    fun currentFont(): Font = font

    override fun setTextSize(size: Float) {
        font = Font(font.typeface ?: defaultTypeface(), size)
    }

    override fun setTypeFace(fontType: Int, weight: Int, italic: Boolean) {
        val family = when (fontType) {
            PaintBundle.FONT_TYPE_SERIF -> "Serif"
            PaintBundle.FONT_TYPE_MONOSPACE -> "Monospace"
            PaintBundle.FONT_TYPE_SANS_SERIF,
            PaintBundle.FONT_TYPE_DEFAULT -> "SansSerif"
            else -> null
        }
        val typeface = if (family != null) {
            try {
                matchTypeface(family, weight, italic)
            } catch (_: Throwable) {
                defaultTypeface()
            }
        } else {
            defaultTypeface()
        }
        font = Font(typeface, font.size)
    }

    override fun setFallbackTypeFace(fontType: Int, weight: Int, italic: Boolean) {
        // Not implemented.
    }

    override fun setShaderMatrix(matrixId: Float) {
        // Not implemented.
    }

    override fun setTypeFace(fontType: String, weight: Int, italic: Boolean) {
        val typeface = try { matchTypeface(fontType, weight, italic) } catch (_: Throwable) { defaultTypeface() }
        font = Font(typeface, font.size)
    }

    private fun defaultTypeface(): SkTypeface =
        org.jetbrains.skia.FontMgr.default.matchFamilyStyle(null, FontStyle.NORMAL)
            ?: SkTypeface.makeEmpty()

    private fun matchTypeface(family: String, weight: Int, italic: Boolean): SkTypeface {
        val slant = if (italic) FontStyle.ITALIC.slant else FontStyle.NORMAL.slant
        val style = FontStyle(weight, FontStyle.NORMAL.width, slant)
        return org.jetbrains.skia.FontMgr.default.matchFamilyStyle(family, style)
            ?: defaultTypeface()
    }

    override fun setFontVariationAxes(tags: Array<String>, values: FloatArray) {
        // Not implemented on desktop.
    }

    override fun setTextureShader(
        bitmapId: Int, tileX: Short, tileY: Short, filterMode: Short, maxAnisotropy: Short
    ) {
        val image = remoteContext.mRemoteComposeState.getFromId(bitmapId) as? SkiaImage ?: return
        val tileModes = arrayOf(FilterTileMode.CLAMP, FilterTileMode.REPEAT, FilterTileMode.MIRROR)
        val shader = image.makeShader(
            tileModes[tileX.toInt().coerceIn(0, 2)],
            tileModes[tileY.toInt().coerceIn(0, 2)],
        )
        getPaint().asFrameworkPaint().shader = shader
    }

    override fun setPathEffect(pathEffect: FloatArray?) {
        val target = getPaint()
        if (pathEffect == null || pathEffect.isEmpty()) {
            target.pathEffect = null
            return
        }
        // Two encodings show up in practice:
        //   1. PaintPathEffects-prefixed: data[0] is a small int (1..5) naming
        //      the subtype (DASH, DISCRETE_PATH, PATH_DASH, SUM, COMPOSE).
        //   2. Plain [on, off, on, off, ...] dash intervals — the raw
        //      SkDashPathEffect input emitted by the Echo creator and similar
        //      tools that don't wrap the data.
        val firstAsInt = java.lang.Float.floatToRawIntBits(pathEffect[0])
        target.pathEffect = when {
            firstAsInt == PATH_EFFECT_DASH && pathEffect.size >= 2 -> dashEffect(pathEffect)
            firstAsInt in PATH_EFFECT_PREFIX_RANGE -> null // other subtypes not implemented yet
            pathEffect.size % 2 == 0 -> PathEffect.dashPathEffect(pathEffect, 0f)
            else -> null
        }
    }

    private fun dashEffect(prefixed: FloatArray): PathEffect? {
        // Layout per PaintPathEffects.Dash.decode: [type, phase, count, intervals...]
        if (prefixed.size < 3) return null
        val phase = prefixed[1]
        val count = java.lang.Float.floatToRawIntBits(prefixed[2])
        if (count <= 0 || count % 2 != 0 || prefixed.size < 3 + count) return null
        val intervals = FloatArray(count) { prefixed[3 + it] }
        return PathEffect.dashPathEffect(intervals, phase)
    }

    override fun setStrokeWidth(width: Float) {
        getPaint().strokeWidth = width
    }

    override fun setColor(color: Int) {
        val nativePaint = getPaint().asFrameworkPaint()
        // Some RemoteCompose documents set a shader (e.g. a background gradient overlay)
        // and never emit an explicit setShader(0) before a later draw that's meant to use a
        // solid color. Treat setColor as a signal of solid-color intent, so a lingering
        // shader from a previous unrelated draw doesn't override the color.
        nativePaint.shader = null
        nativePaint.color = color
    }

    override fun setStrokeCap(cap: Int) {
        getPaint().strokeCap = when (cap) {
            0 -> StrokeCap.Butt
            1 -> StrokeCap.Round
            2 -> StrokeCap.Square
            else -> StrokeCap.Butt
        }
    }

    override fun setStyle(style: Int) {
        getPaint().style = when (style) {
            PaintBundle.STYLE_STROKE -> PaintingStyle.Stroke
            else -> PaintingStyle.Fill
        }
    }

    override fun setShader(shaderId: Int) {
        val nativePaint = getPaint().asFrameworkPaint()
        if (shaderId == 0) {
            nativePaint.shader = null
            return
        }
        val data = remoteContext.mRemoteComposeState.getFromId(shaderId) as? ShaderData ?: return
        val source = remoteContext.getText(data.shaderTextId) ?: return
        val effect = effectCache[shaderId] ?: runCatching { RuntimeEffect.makeForShader(source) }
            .onSuccess { effectCache[shaderId] = it }
            .getOrElse {
                System.err.println("Shader compile failed for id=$shaderId: ${it.message}")
                null
            } ?: return
        // Bind the current uniform values each call, since variables may have changed.
        nativePaint.shader = runCatching { buildShader(effect, data) }
            .getOrElse {
                System.err.println("Shader bind failed for id=$shaderId: ${it.message}")
                null
            }
    }

    private fun buildShader(effect: RuntimeEffect, data: ShaderData): Shader {
        val builder = RuntimeShaderBuilder(effect)
        for (name in data.uniformFloatNames.orEmpty()) {
            val values = data.getUniformFloats(name) ?: continue
            when (values.size) {
                1 -> builder.uniform(name, values[0])
                2 -> builder.uniform(name, values[0], values[1])
                3 -> builder.uniform(name, values[0], values[1], values[2])
                4 -> builder.uniform(name, values[0], values[1], values[2], values[3])
                else -> builder.uniform(name, values)
            }
        }
        for (name in data.uniformIntegerNames.orEmpty()) {
            val values = data.getUniformInts(name) ?: continue
            when (values.size) {
                1 -> builder.uniform(name, values[0])
                2 -> builder.uniform(name, values[0], values[1])
                3 -> builder.uniform(name, values[0], values[1], values[2])
                4 -> builder.uniform(name, values[0], values[1], values[2], values[3])
                else -> { /* >4 int uniforms not supported by RuntimeShaderBuilder */ }
            }
        }
        for (name in data.uniformBitmapNames.orEmpty()) {
            val bitmapId = data.getUniformBitmapId(name)
            val image = remoteContext.mRemoteComposeState.getFromId(bitmapId) as? SkiaImage ?: continue
            val childShader = image.makeShader(
                FilterTileMode.CLAMP,
                FilterTileMode.CLAMP,
                SamplingMode.DEFAULT,
                localMatrix = null,
            )
            builder.child(name, childShader)
        }
        return builder.makeShader()
    }

    override fun setImageFilterQuality(quality: Int) {
        // Not critical: no-op.
    }

    override fun setBlendMode(mode: Int) {
        val bm = remoteBlendMode(mode) ?: return
        getPaint().blendMode = bm
    }

    override fun setAlpha(a: Float) {
        val p = getPaint().asFrameworkPaint()
        val argb = p.color
        val alpha = (255 * a).toInt().coerceIn(0, 255)
        p.color = (argb and 0x00FFFFFF.toInt()) or (alpha shl 24)
    }

    override fun setStrokeMiter(miter: Float) {
        getPaint().strokeMiterLimit = miter
    }

    override fun setStrokeJoin(join: Int) {
        getPaint().strokeJoin = when (join) {
            0 -> StrokeJoin.Miter
            1 -> StrokeJoin.Round
            2 -> StrokeJoin.Bevel
            else -> StrokeJoin.Miter
        }
    }

    override fun setFilterBitmap(filter: Boolean) {
        // No-op.
    }

    override fun setAntiAlias(aa: Boolean) {
        getPaint().isAntiAlias = aa
    }

    override fun clear(mask: Long) {
        if ((mask and (1L shl PaintBundle.COLOR_FILTER)) != 0L) {
            getPaint().asFrameworkPaint().colorFilter = null
        }
    }

    override fun setLinearGradient(
        colors: IntArray, stops: FloatArray?,
        startX: Float, startY: Float, endX: Float, endY: Float,
        tileMode: Int,
    ) {
        val style = org.jetbrains.skia.GradientStyle.DEFAULT.withTileMode(tileModeOf(tileMode))
        val shader = Shader.makeLinearGradient(
            SkPoint(startX, startY), SkPoint(endX, endY),
            colors, stops, style,
        )
        getPaint().asFrameworkPaint().shader = shader
    }

    override fun setRadialGradient(
        colors: IntArray, stops: FloatArray?,
        centerX: Float, centerY: Float, radius: Float, tileMode: Int,
    ) {
        val style = org.jetbrains.skia.GradientStyle.DEFAULT.withTileMode(tileModeOf(tileMode))
        val shader = Shader.makeRadialGradient(
            SkPoint(centerX, centerY), radius, colors, stops, style,
        )
        getPaint().asFrameworkPaint().shader = shader
    }

    override fun setSweepGradient(
        colors: IntArray, stops: FloatArray?, centerX: Float, centerY: Float,
    ) {
        val shader = Shader.makeSweepGradient(centerX, centerY, colors, stops)
        getPaint().asFrameworkPaint().shader = shader
    }

    override fun setColorFilter(color: Int, mode: Int) {
        val bm = remoteBlendMode(mode) ?: return
        val skBm = composeBlendToSkia(bm)
        getPaint().asFrameworkPaint().colorFilter = ColorFilter.makeBlend(color, skBm)
    }

    private fun tileModeOf(mode: Int): FilterTileMode = when (mode) {
        0 -> FilterTileMode.CLAMP
        1 -> FilterTileMode.REPEAT
        2 -> FilterTileMode.MIRROR
        else -> FilterTileMode.CLAMP
    }

    private fun remoteBlendMode(mode: Int): BlendMode? = when (mode) {
        PaintBundle.BLEND_MODE_CLEAR -> BlendMode.Clear
        PaintBundle.BLEND_MODE_SRC -> BlendMode.Src
        PaintBundle.BLEND_MODE_DST -> BlendMode.Dst
        PaintBundle.BLEND_MODE_SRC_OVER -> BlendMode.SrcOver
        PaintBundle.BLEND_MODE_DST_OVER -> BlendMode.DstOver
        PaintBundle.BLEND_MODE_SRC_IN -> BlendMode.SrcIn
        PaintBundle.BLEND_MODE_DST_IN -> BlendMode.DstIn
        PaintBundle.BLEND_MODE_SRC_OUT -> BlendMode.SrcOut
        PaintBundle.BLEND_MODE_DST_OUT -> BlendMode.DstOut
        PaintBundle.BLEND_MODE_SRC_ATOP -> BlendMode.SrcAtop
        PaintBundle.BLEND_MODE_DST_ATOP -> BlendMode.DstAtop
        PaintBundle.BLEND_MODE_XOR -> BlendMode.Xor
        PaintBundle.BLEND_MODE_PLUS -> BlendMode.Plus
        PaintBundle.BLEND_MODE_MODULATE -> BlendMode.Modulate
        PaintBundle.BLEND_MODE_SCREEN -> BlendMode.Screen
        PaintBundle.BLEND_MODE_OVERLAY -> BlendMode.Overlay
        PaintBundle.BLEND_MODE_DARKEN -> BlendMode.Darken
        PaintBundle.BLEND_MODE_LIGHTEN -> BlendMode.Lighten
        PaintBundle.BLEND_MODE_COLOR_DODGE -> BlendMode.ColorDodge
        PaintBundle.BLEND_MODE_COLOR_BURN -> BlendMode.ColorBurn
        PaintBundle.BLEND_MODE_HARD_LIGHT -> BlendMode.Hardlight
        PaintBundle.BLEND_MODE_SOFT_LIGHT -> BlendMode.Softlight
        PaintBundle.BLEND_MODE_DIFFERENCE -> BlendMode.Difference
        PaintBundle.BLEND_MODE_EXCLUSION -> BlendMode.Exclusion
        PaintBundle.BLEND_MODE_MULTIPLY -> BlendMode.Multiply
        PaintBundle.BLEND_MODE_HUE -> BlendMode.Hue
        PaintBundle.BLEND_MODE_SATURATION -> BlendMode.Saturation
        PaintBundle.BLEND_MODE_COLOR -> BlendMode.Color
        PaintBundle.BLEND_MODE_LUMINOSITY -> BlendMode.Luminosity
        PaintBundle.BLEND_MODE_NULL -> null
        else -> null
    }

    private fun composeBlendToSkia(bm: BlendMode): org.jetbrains.skia.BlendMode = when (bm) {
        BlendMode.Clear -> org.jetbrains.skia.BlendMode.CLEAR
        BlendMode.Src -> org.jetbrains.skia.BlendMode.SRC
        BlendMode.Dst -> org.jetbrains.skia.BlendMode.DST
        BlendMode.SrcOver -> org.jetbrains.skia.BlendMode.SRC_OVER
        BlendMode.DstOver -> org.jetbrains.skia.BlendMode.DST_OVER
        BlendMode.SrcIn -> org.jetbrains.skia.BlendMode.SRC_IN
        BlendMode.DstIn -> org.jetbrains.skia.BlendMode.DST_IN
        BlendMode.SrcOut -> org.jetbrains.skia.BlendMode.SRC_OUT
        BlendMode.DstOut -> org.jetbrains.skia.BlendMode.DST_OUT
        BlendMode.SrcAtop -> org.jetbrains.skia.BlendMode.SRC_ATOP
        BlendMode.DstAtop -> org.jetbrains.skia.BlendMode.DST_ATOP
        BlendMode.Xor -> org.jetbrains.skia.BlendMode.XOR
        BlendMode.Plus -> org.jetbrains.skia.BlendMode.PLUS
        BlendMode.Modulate -> org.jetbrains.skia.BlendMode.MODULATE
        BlendMode.Screen -> org.jetbrains.skia.BlendMode.SCREEN
        BlendMode.Overlay -> org.jetbrains.skia.BlendMode.OVERLAY
        BlendMode.Darken -> org.jetbrains.skia.BlendMode.DARKEN
        BlendMode.Lighten -> org.jetbrains.skia.BlendMode.LIGHTEN
        BlendMode.ColorDodge -> org.jetbrains.skia.BlendMode.COLOR_DODGE
        BlendMode.ColorBurn -> org.jetbrains.skia.BlendMode.COLOR_BURN
        BlendMode.Hardlight -> org.jetbrains.skia.BlendMode.HARD_LIGHT
        BlendMode.Softlight -> org.jetbrains.skia.BlendMode.SOFT_LIGHT
        BlendMode.Difference -> org.jetbrains.skia.BlendMode.DIFFERENCE
        BlendMode.Exclusion -> org.jetbrains.skia.BlendMode.EXCLUSION
        BlendMode.Multiply -> org.jetbrains.skia.BlendMode.MULTIPLY
        BlendMode.Hue -> org.jetbrains.skia.BlendMode.HUE
        BlendMode.Saturation -> org.jetbrains.skia.BlendMode.SATURATION
        BlendMode.Color -> org.jetbrains.skia.BlendMode.COLOR
        BlendMode.Luminosity -> org.jetbrains.skia.BlendMode.LUMINOSITY
        else -> org.jetbrains.skia.BlendMode.SRC_OVER
    }

    private companion object {
        // PaintPathEffects subtype ids (see PaintPathEffects.java in remote-core).
        const val PATH_EFFECT_DASH = 1
        val PATH_EFFECT_PREFIX_RANGE = 1..5
    }
}
