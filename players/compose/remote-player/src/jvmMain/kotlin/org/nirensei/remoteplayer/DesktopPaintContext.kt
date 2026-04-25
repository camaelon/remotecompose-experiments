/*
 * Copyright 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Desktop adaptation of ComposePaintContext.
 */
package org.nirensei.remoteplayer

import androidx.compose.remote.core.PaintContext
import androidx.compose.remote.core.RcPlatformServices
import androidx.compose.remote.core.operations.ClipPath
import androidx.compose.remote.core.operations.layout.managers.TextLayout
import androidx.compose.remote.core.operations.paint.PaintBundle
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.nativeCanvas
import org.jetbrains.skia.Image as SkiaImage
import org.jetbrains.skia.Rect as SkRect
import org.jetbrains.skia.TextLine
import kotlin.math.atan2

internal class DesktopPaintContext(
    remoteContext: DesktopRemoteContext,
    private var canvas: Canvas,
) : PaintContext(remoteContext) {

    var paint: Paint = Paint()
    private val paintList: MutableList<Paint> = mutableListOf()
    private val cachedPaintChanges = DesktopPaintChanges(remoteContext) { paint }

    fun setCanvas(newCanvas: Canvas) {
        canvas = newCanvas
    }

    fun currentCanvas(): Canvas = canvas

    override fun drawBitmap(
        imageId: Int,
        srcLeft: Int, srcTop: Int, srcRight: Int, srcBottom: Int,
        dstLeft: Int, dstTop: Int, dstRight: Int, dstBottom: Int,
        cdId: Int,
    ) {
        val image = (mContext.mRemoteComposeState.getFromId(imageId) as? SkiaImage) ?: return
        val nativePaint = paint.asFrameworkPaint()
        canvas.nativeCanvas.drawImageRect(
            image,
            SkRect.makeLTRB(srcLeft.toFloat(), srcTop.toFloat(), srcRight.toFloat(), srcBottom.toFloat()),
            SkRect.makeLTRB(dstLeft.toFloat(), dstTop.toFloat(), dstRight.toFloat(), dstBottom.toFloat()),
            nativePaint,
        )
    }

    override fun drawBitmap(id: Int, left: Float, top: Float, right: Float, bottom: Float) {
        val image = (mContext.mRemoteComposeState.getFromId(id) as? SkiaImage) ?: return
        val nativePaint = paint.asFrameworkPaint()
        canvas.nativeCanvas.drawImageRect(
            image,
            SkRect.makeLTRB(0f, 0f, image.width.toFloat(), image.height.toFloat()),
            SkRect.makeLTRB(left, top, right, bottom),
            nativePaint,
        )
    }

    override fun scale(scaleX: Float, scaleY: Float) = canvas.scale(scaleX, scaleY)
    override fun translate(translateX: Float, translateY: Float) = canvas.translate(translateX, translateY)

    override fun drawArc(
        left: Float, top: Float, right: Float, bottom: Float,
        startAngle: Float, sweepAngle: Float,
    ) {
        canvas.drawArc(left, top, right, bottom, startAngle, sweepAngle, false, paint)
    }

    override fun drawSector(
        left: Float, top: Float, right: Float, bottom: Float,
        startAngle: Float, sweepAngle: Float,
    ) {
        canvas.drawArc(left, top, right, bottom, startAngle, sweepAngle, true, paint)
    }

    override fun drawCircle(centerX: Float, centerY: Float, radius: Float) {
        canvas.drawCircle(Offset(centerX, centerY), radius, paint)
    }

    override fun drawLine(x1: Float, y1: Float, x2: Float, y2: Float) {
        canvas.drawLine(Offset(x1, y1), Offset(x2, y2), paint)
    }

    override fun drawOval(left: Float, top: Float, right: Float, bottom: Float) {
        canvas.drawOval(left, top, right, bottom, paint)
    }

    override fun drawPath(id: Int, start: Float, end: Float) {
        canvas.drawPath(mContext.mRemoteComposeState.getComposePath(id, start, end), paint)
    }

    override fun drawRect(left: Float, top: Float, right: Float, bottom: Float) {
        canvas.drawRect(left, top, right, bottom, paint)
    }

    override fun savePaint() {
        paintList.add(Paint_copy(paint))
    }

    override fun restorePaint() {
        if (paintList.isNotEmpty()) {
            paint = paintList.removeAt(paintList.size - 1)
        }
    }

    override fun replacePaint(paintBundle: PaintBundle) {
        paint.asFrameworkPaint().reset()
        applyPaint(paintBundle)
    }

    override fun drawRoundRect(
        left: Float, top: Float, right: Float, bottom: Float,
        radiusX: Float, radiusY: Float,
    ) {
        canvas.drawRoundRect(left, top, right, bottom, radiusX, radiusY, paint)
    }

    override fun drawTextOnPath(textId: Int, pathId: Int, hOffset: Float, vOffset: Float) {
        // Skia has no direct drawTextOnPath; walk the path and render each codepoint along it.
        val text = getText(textId) ?: return
        val font = cachedPaintChanges.currentFont()
        val composePath = mContext.mRemoteComposeState.getComposePath(pathId, 0f, 1f)
        if (composePath.isEmpty) return
        val measure = PathMeasure().apply { setPath(composePath, false) }
        val pathLen = measure.length
        if (pathLen == 0f) return

        val nativeCanvas = canvas.nativeCanvas
        withoutShader { nativePaint ->
            var cursor = hOffset
            var idx = 0
            while (idx < text.length && cursor <= pathLen) {
                val cp = text.codePointAt(idx)
                val char = String(Character.toChars(cp))
                val width = font.measureTextWidth(char)
                val center = cursor + width / 2f
                if (center in 0f..pathLen) {
                    val pos = measure.getPosition(center)
                    val tangent = measure.getTangent(center)
                    val angle = Math.toDegrees(atan2(tangent.y, tangent.x).toDouble()).toFloat()
                    nativeCanvas.save()
                    nativeCanvas.translate(pos.x, pos.y)
                    nativeCanvas.rotate(angle)
                    nativeCanvas.drawString(char, -width / 2f, vOffset, font, nativePaint)
                    nativeCanvas.restore()
                }
                cursor += width
                idx += Character.charCount(cp)
            }
        }
    }

    /**
     * Run a text draw with the paint's shader temporarily cleared.
     *
     * RemoteCompose's paint state is sticky: a document may set a background gradient shader via
     * one PaintBundle and then only change color/alpha in the next bundle meant for text,
     * relying on the shader not applying to glyphs. Skia (like Android) does honor the paint's
     * shader when rendering text, which would wipe out the text color. We approximate the
     * expected behavior by suspending the shader for the duration of the text draw.
     */
    private inline fun withoutShader(block: (org.jetbrains.skia.Paint) -> Unit) {
        val nativePaint = paint.asFrameworkPaint()
        val savedShader = nativePaint.shader
        if (savedShader != null) nativePaint.shader = null
        try {
            block(nativePaint)
        } finally {
            if (savedShader != null) nativePaint.shader = savedShader
        }
    }

    override fun getTextBounds(textId: Int, start: Int, end: Int, flags: Int, bounds: FloatArray) {
        val str = getText(textId) ?: run {
            bounds.fill(0f); return
        }
        val sanitized = if (end == -1 || end > str.length) str.length else end
        val sub = str.substring(start, sanitized)
        val font = cachedPaintChanges.currentFont()
        val textLine = TextLine.make(sub, font)
        val advance = textLine.width
        // Use TextLine (shaped) for ink bounds. Font.measureText ignores shaper fallbacks and
        // returns zeros when the paint's typeface lacks glyphs, which breaks center-aligned
        // layouts that rely on the returned width to compute positioning.
        val inkLeft = 0f
        val inkRight = advance
        val inkTop = textLine.ascent
        val inkBottom = textLine.descent
        if ((flags and TEXT_MEASURE_SPACES) != 0) {
            bounds[0] = 0f
            bounds[2] = advance
        } else if ((flags and TEXT_MEASURE_MONOSPACE_WIDTH) != 0) {
            bounds[0] = inkLeft
            bounds[2] = advance - inkLeft
        } else {
            bounds[0] = inkLeft
            bounds[2] = inkRight
        }
        if ((flags and TEXT_MEASURE_FONT_HEIGHT) != 0) {
            val metrics = font.metrics
            bounds[1] = metrics.ascent
            bounds[3] = metrics.descent
        } else {
            bounds[1] = inkTop
            bounds[3] = inkBottom
        }
    }

    override fun layoutComplexText(
        textId: Int, start: Int, end: Int,
        alignment: Int, overflow: Int, maxLines: Int,
        maxWidth: Float, maxHeight: Float,
        letterSpacing: Float, lineHeightAdd: Float, lineHeightMultiplier: Float,
        lineBreakStrategy: Int, hyphenationFrequency: Int, justificationMode: Int,
        underline: Boolean, strikethrough: Boolean, flags: Int,
    ): RcPlatformServices.ComputedTextLayout? {
        val str = getText(textId) ?: return null
        val sanitized = if (end == -1 || end > str.length) str.length else end
        val sub = str.substring(start, sanitized)
        val font = cachedPaintChanges.currentFont()
        val color = paint.asFrameworkPaint().color
        return DesktopComputedTextLayout(
            text = sub,
            font = font,
            color = color,
            maxWidth = maxWidth,
            alignment = alignment,
            overflow = overflow,
            maxLines = maxLines,
            letterSpacing = letterSpacing,
            lineHeightMultiplier = lineHeightMultiplier,
            underline = underline,
            strikethrough = strikethrough,
        )
    }

    override fun drawTextRun(
        textId: Int, start: Int, end: Int,
        contextStart: Int, contextEnd: Int,
        x: Float, y: Float, rtl: Boolean,
    ) {
        var text = getText(textId) ?: return
        text = when {
            end == -1 -> if (start != 0) text.substring(start) else text
            end > text.length -> text.substring(start)
            else -> text.substring(start, end)
        }
        val font = cachedPaintChanges.currentFont()
        val textLine = TextLine.make(text, font)
        withoutShader { nativePaint ->
            canvas.nativeCanvas.drawTextLine(textLine, x, y, nativePaint)
        }
    }

    override fun drawComplexText(computedTextLayout: RcPlatformServices.ComputedTextLayout?) {
        if (computedTextLayout !is DesktopComputedTextLayout) return
        withoutShader { nativePaint ->
            computedTextLayout.draw(canvas.nativeCanvas, nativePaint)
        }
    }

    override fun drawTweenPath(path1Id: Int, path2Id: Int, tween: Float, start: Float, stop: Float) {
        canvas.drawPath(tweenedPath(path1Id, path2Id, tween, start, stop), paint)
    }

    override fun tweenPath(out: Int, path1: Int, path2: Int, tween: Float) {
        val p = tweenedPathArray(path1, path2, tween)
        mContext.mRemoteComposeState.putPathData(out, p)
    }

    override fun combinePath(out: Int, path1: Int, path2: Int, operation: Byte) {
        val p1 = mContext.mRemoteComposeState.getComposePath(path1, 0f, 1f)
        val p2 = mContext.mRemoteComposeState.getComposePath(path2, 0f, 1f)
        val ops = arrayOf(
            PathOperation.Difference, PathOperation.Intersect,
            PathOperation.ReverseDifference, PathOperation.Union, PathOperation.Xor,
        )
        val combined = Path.combine(ops[operation.toInt()], p1, p2)
        mContext.mRemoteComposeState.putPath(out, combined)
    }

    override fun applyPaint(paintData: PaintBundle) {
        paintData.applyPaintChange(this, cachedPaintChanges)
    }

    override fun matrixScale(scaleX: Float, scaleY: Float, centerX: Float, centerY: Float) {
        if (centerX.isNaN()) {
            canvas.scale(scaleX, scaleY)
        } else {
            canvas.translate(centerX, centerY)
            canvas.scale(scaleX, scaleY)
            canvas.translate(-centerX, -centerY)
        }
    }

    override fun matrixTranslate(translateX: Float, translateY: Float) =
        canvas.translate(translateX, translateY)

    override fun matrixSkew(skewX: Float, skewY: Float) = canvas.skew(skewX, skewY)

    override fun matrixRotate(rotate: Float, pivotX: Float, pivotY: Float) {
        if (pivotX.isNaN()) {
            canvas.rotate(rotate)
        } else {
            canvas.translate(pivotX, pivotY)
            canvas.rotate(rotate)
            canvas.translate(-pivotX, -pivotY)
        }
    }

    override fun matrixSave() { canvas.save() }
    override fun matrixRestore() { canvas.restore() }

    override fun clipRect(left: Float, top: Float, right: Float, bottom: Float) =
        canvas.clipRect(left, top, right, bottom)

    override fun clipPath(pathId: Int, regionOp: Int) {
        val path = mContext.mRemoteComposeState.getComposePath(pathId, 0f, 1f)
        canvas.clipPath(
            path,
            if (regionOp == ClipPath.DIFFERENCE) ClipOp.Difference else ClipOp.Intersect,
        )
    }

    override fun roundedClipRect(
        width: Float, height: Float,
        topStart: Float, topEnd: Float, bottomStart: Float, bottomEnd: Float,
    ) {
        val path = Path()
        path.addRoundRect(
            RoundRect(
                left = 0f, top = 0f, right = width, bottom = height,
                topLeftCornerRadius = CornerRadius(topStart, topStart),
                topRightCornerRadius = CornerRadius(topEnd, topEnd),
                bottomRightCornerRadius = CornerRadius(bottomEnd, bottomEnd),
                bottomLeftCornerRadius = CornerRadius(bottomStart, bottomStart),
            )
        )
        canvas.clipPath(path)
    }

    override fun reset() {
        paint.asFrameworkPaint().reset()
    }

    // Graphics layer: desktop fallback just saves/restores canvas state.
    override fun startGraphicsLayer(w: Int, h: Int) {
        canvas.save()
    }

    override fun setGraphicsLayer(attributes: HashMap<Int?, in Any>) {
        // Not implemented for desktop.
    }

    override fun endGraphicsLayer() {
        canvas.restore()
    }

    override fun getText(textId: Int): String? =
        mContext.mRemoteComposeState.getFromId(textId) as? String

    override fun matrixFromPath(pathId: Int, fraction: Float, vOffset: Float, flags: Int) {
        val path = mContext.mRemoteComposeState.getComposePath(pathId, 0f, 1f)
        if (path.isEmpty) return
        val measure = PathMeasure()
        measure.setPath(path, false)
        val matrix = Matrix()
        val len = measure.length
        if (len == 0f) return
        val distance = (len * fraction) % len
        val position = measure.getPosition(distance)
        matrix.translate(position.x, position.y)
        if ((flags and 2) != 0) {
            val tangent = measure.getTangent(distance)
            val angle = Math.toDegrees(atan2(tangent.y, tangent.x).toDouble()).toFloat()
            matrix.rotateZ(angle)
        }
        canvas.concat(matrix)
    }

    override fun drawToBitmap(bitmapId: Int, mode: Int, color: Int) {
        // Not supported on desktop (Skia Image is immutable). No-op.
    }

    private fun tweenedPath(path1Id: Int, path2Id: Int, tween: Float, start: Float, end: Float): Path {
        val arr = tweenedPathArray(path1Id, path2Id, tween)
        val path = Path()
        FloatsToPath.genPath(path, arr, start, end)
        return path
    }

    private fun tweenedPathArray(path1Id: Int, path2Id: Int, tween: Float): FloatArray {
        val state = mContext.mRemoteComposeState
        if (tween == 0f) return state.getPathData(path1Id)!!
        if (tween == 1f) return state.getPathData(path2Id)!!
        val d1 = state.getPathData(path1Id)!!
        val d2 = state.getPathData(path2Id)!!
        val out = FloatArray(d2.size)
        for (i in out.indices) {
            out[i] = if (d1[i].isNaN() || d2[i].isNaN()) d1[i] else (d2[i] - d1[i]) * tween + d1[i]
        }
        return out
    }
}
