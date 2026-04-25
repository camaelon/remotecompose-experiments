/*
 * Copyright 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Desktop adaptation of RemoteDocumentPlayer / RemoteComposePlayer.
 */
package org.nirensei.remoteplayer

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.remote.core.CoreDocument
import androidx.compose.remote.core.RemoteContext
import androidx.compose.remote.core.SystemClock
import androidx.compose.remote.core.operations.Theme
import org.jetbrains.skia.RuntimeEffect
import androidx.compose.remote.player.core.RemoteDocument
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Canvas as ComposeCanvas
import androidx.compose.ui.graphics.asSkiaBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.input.pointer.changedToDown
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import org.jetbrains.skia.EncodedImageFormat
import org.jetbrains.skia.Image

@Composable
fun RemoteDocumentPlayer(
    document: CoreDocument,
    modifier: Modifier = Modifier,
    state: RemoteDocumentPlayerState? = null,
    debugMode: Int = 0,
) {
    OperationProfileInjector.ensure()
    val inDarkTheme = isSystemInDarkTheme()
    val playbackTheme = if (inDarkTheme) Theme.DARK else Theme.LIGHT

    val remoteDoc = remember(document) { RemoteDocument(document) }

    val remoteContext = remember(document) {
        DesktopRemoteContext(SystemClock()).also { ctx ->
            remoteDoc.initializeContext(ctx)
            ctx.setDebug(debugMode)
            ctx.theme = playbackTheme
            // Force lazy population of the document's themed color table; CoreDocument.paint
            // only resolves ColorTheme ops when this list is non-null.
            document.themedColors
            ctx.loadFloat(RemoteContext.ID_TOUCH_EVENT_TIME, -Float.MAX_VALUE)
            // Allow shaders whose SkSL source compiles successfully.
            document.checkShaders(ctx) { source ->
                try {
                    RuntimeEffect.makeForShader(source)
                    true
                } catch (_: Throwable) {
                    false
                }
            }
        }
    }

    DisposableEffect(state, remoteContext, remoteDoc, playbackTheme) {
        state?.captureCallback = {
            val w = remoteContext.mWidth.toInt()
            val h = remoteContext.mHeight.toInt()
            if (w > 0 && h > 0) {
                val bitmap = ImageBitmap(w, h)
                val canvas = ComposeCanvas(bitmap)
                canvas.save()
                canvas.clipRect(0f, 0f, w.toFloat(), h.toFloat())
                val previousPaint = remoteContext.paintContext
                val snapshotPaint = DesktopPaintContext(remoteContext, canvas)
                remoteContext.setPaintContext(snapshotPaint)
                remoteDoc.paint(remoteContext, playbackTheme)
                canvas.restore()
                if (previousPaint != null) remoteContext.setPaintContext(previousPaint)
                Image.makeFromBitmap(bitmap.asSkiaBitmap())
                    .encodeToData(EncodedImageFormat.PNG)?.bytes
            } else null
        }
        onDispose { state?.captureCallback = null }
    }

    val start = remember(document) { mutableLongStateOf(System.nanoTime()) }
    val lastAnimationTime = remember(document) { mutableFloatStateOf(0.1f) }
    // Drive recomposition so animations advance.
    val frameTick = remember { mutableIntStateOf(0) }
    LaunchedEffect(document) {
        while (true) {
            withFrameNanos { frameTick.value = (frameTick.value + 1) and 0x3FFFFFFF }
        }
    }

    val dragHappened = remember { mutableStateOf(false) }

    Canvas(
        modifier = modifier.pointerInput(remoteContext) {
            awaitPointerEventScope {
                while (true) {
                    val event = awaitPointerEvent()
                    for (i in 0 until event.changes.size) {
                        val change = event.changes[i]
                        if (change.changedToDown()) {
                            val x = change.position.x
                            val y = change.position.y
                            val time = remoteContext.animationTime
                            remoteContext.loadFloat(RemoteContext.ID_TOUCH_EVENT_TIME, time)
                            document.touchDown(remoteContext, x, y)
                            dragHappened.value = false
                            change.consume()
                        }
                        if (change.changedToUp()) {
                            val x = change.position.x
                            val y = change.position.y
                            val time = remoteContext.animationTime
                            remoteContext.loadFloat(RemoteContext.ID_TOUCH_EVENT_TIME, time)
                            document.touchUp(remoteContext, x, y, 0f, 0f)
                            if (!dragHappened.value) {
                                document.onClick(remoteContext, x, y)
                            }
                            change.consume()
                        }
                        if (change.positionChanged()) {
                            val x = change.position.x
                            val y = change.position.y
                            val time = remoteContext.animationTime
                            remoteContext.loadFloat(RemoteContext.ID_TOUCH_EVENT_TIME, time)
                            document.touchDrag(remoteContext, x, y)
                            dragHappened.value = true
                            change.consume()
                        }
                    }
                }
            }
        }
    ) {
        // Read frameTick so we recompose on every frame while animation is active.
        @Suppress("UNUSED_VARIABLE") val tick = frameTick.value
        drawIntoCanvas { canvas ->
            canvas.save()
            canvas.clipRect(0f, 0f, size.width, size.height)

            if (remoteContext.isAnimationEnabled) {
                val nanoStart = System.nanoTime()
                val animationTime = (nanoStart - start.value) * 1e-9f
                remoteContext.animationTime = animationTime
                remoteContext.loadFloat(RemoteContext.ID_ANIMATION_TIME, animationTime)
                val loopTime = animationTime - lastAnimationTime.value
                remoteContext.loadFloat(RemoteContext.ID_ANIMATION_DELTA_TIME, loopTime)
                lastAnimationTime.value = animationTime
                remoteContext.currentTime = System.currentTimeMillis()
            }

            remoteContext.density = density
            remoteContext.mWidth = size.width
            remoteContext.mHeight = size.height
            remoteContext.loadFloat(RemoteContext.ID_FONT_SIZE, 30f)

            val paintContext = DesktopPaintContext(remoteContext, canvas)
            remoteContext.setPaintContext(paintContext)
            remoteDoc.paint(remoteContext, playbackTheme)
            canvas.restore()
        }
    }
}
