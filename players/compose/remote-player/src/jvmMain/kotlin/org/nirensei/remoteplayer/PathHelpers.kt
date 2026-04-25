/*
 * Copyright 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */
package org.nirensei.remoteplayer

import androidx.compose.remote.core.RemoteComposeState
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType

internal fun RemoteComposeState.getComposePath(id: Int, start: Float, end: Float): Path {
    val cached = getPath(id) as? Path
    if (cached != null) return cached
    val path = Path()
    val pathData = getPathData(id)
    if (pathData != null) {
        FloatsToPath.genPath(path, pathData, start, end)
        if (getPathWinding(id) == 1) {
            path.fillType = PathFillType.EvenOdd
        }
        putPath(id, path)
    }
    return path
}

internal fun Paint_copy(src: androidx.compose.ui.graphics.Paint): androidx.compose.ui.graphics.Paint =
    androidx.compose.ui.graphics.Paint().also { dst ->
        dst.alpha = src.alpha
        dst.isAntiAlias = src.isAntiAlias
        dst.color = src.color
        dst.blendMode = src.blendMode
        dst.style = src.style
        dst.strokeWidth = src.strokeWidth
        dst.strokeCap = src.strokeCap
        dst.strokeJoin = src.strokeJoin
        dst.strokeMiterLimit = src.strokeMiterLimit
        dst.filterQuality = src.filterQuality
        dst.shader = src.shader
        dst.colorFilter = src.colorFilter
        dst.pathEffect = src.pathEffect
    }
