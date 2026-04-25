/*
 * Copyright 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */
package org.nirensei.remoteplayer

import androidx.compose.remote.core.RcPlatformServices
import androidx.compose.remote.core.operations.layout.managers.TextLayout
import org.jetbrains.skia.Canvas as SkCanvas
import org.jetbrains.skia.Font
import org.jetbrains.skia.Paint as SkPaint
import org.jetbrains.skia.paragraph.Alignment
import org.jetbrains.skia.paragraph.DecorationLineStyle
import org.jetbrains.skia.paragraph.DecorationStyle
import org.jetbrains.skia.paragraph.FontCollection
import org.jetbrains.skia.paragraph.Paragraph
import org.jetbrains.skia.paragraph.ParagraphBuilder
import org.jetbrains.skia.paragraph.ParagraphStyle
import org.jetbrains.skia.paragraph.TextStyle

/** A paragraph-backed text layout that mirrors the StaticLayout-based Android implementation. */
internal class DesktopComputedTextLayout(
    private val text: String,
    private val font: Font,
    private val color: Int,
    private val maxWidth: Float,
    private val alignment: Int,
    private val overflow: Int,
    private val maxLines: Int,
    private val letterSpacing: Float,
    private val lineHeightMultiplier: Float,
    private val underline: Boolean,
    private val strikethrough: Boolean,
) : RcPlatformServices.ComputedTextLayout {

    private val paragraph: Paragraph = buildParagraph()

    private fun buildParagraph(): Paragraph {
        val fonts = FontCollection().setDefaultFontManager(org.jetbrains.skia.FontMgr.default)
        val alignmentEnum: Alignment = when (alignment) {
            TextLayout.TEXT_ALIGN_RIGHT, TextLayout.TEXT_ALIGN_END -> Alignment.RIGHT
            TextLayout.TEXT_ALIGN_CENTER -> Alignment.CENTER
            else -> Alignment.LEFT
        }
        val style = ParagraphStyle().apply {
            this.alignment = alignmentEnum
            if (maxLines > 0) maxLinesCount = maxLines
            if (overflow == TextLayout.OVERFLOW_ELLIPSIS ||
                overflow == TextLayout.OVERFLOW_START_ELLIPSIS ||
                overflow == TextLayout.OVERFLOW_MIDDLE_ELLIPSIS
            ) {
                ellipsis = "\u2026"
            }
        }

        val textStyle = TextStyle().apply {
            color = this@DesktopComputedTextLayout.color
            fontSize = font.size
            if (letterSpacing != 0f) this.letterSpacing = letterSpacing
            if (lineHeightMultiplier > 0f && lineHeightMultiplier != 1f) {
                height = lineHeightMultiplier
            }
            if (underline || strikethrough) {
                decorationStyle = DecorationStyle(
                    _underline = underline,
                    _overline = false,
                    _lineThrough = strikethrough,
                    _gaps = false,
                    color = this@DesktopComputedTextLayout.color,
                    lineStyle = DecorationLineStyle.SOLID,
                    thicknessMultiplier = 1f,
                )
            }
        }
        font.typeface?.let { textStyle.typeface = it }

        val builder = ParagraphBuilder(style, fonts)
        builder.pushStyle(textStyle)
        builder.addText(text)
        builder.popStyle()
        val p = builder.build()
        p.layout(maxWidth)
        return p
    }

    fun draw(canvas: SkCanvas, @Suppress("UNUSED_PARAMETER") paint: SkPaint) {
        paragraph.paint(canvas, 0f, 0f)
    }

    override fun getWidth(): Float = paragraph.maxWidth
    override fun getHeight(): Float = paragraph.height
    override fun getVisibleLineCount(): Int = paragraph.lineNumber
    override fun isHyphenatedText(): Boolean = false
}
