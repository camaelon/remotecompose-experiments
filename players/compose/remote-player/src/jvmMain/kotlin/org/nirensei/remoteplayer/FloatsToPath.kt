/*
 * Copyright 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Adapted from remote-player-compose for Compose Desktop.
 */
package org.nirensei.remoteplayer

import androidx.compose.remote.core.operations.PathData
import androidx.compose.remote.core.operations.Utils.idFromNan
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import kotlin.math.max
import kotlin.math.min

internal object FloatsToPath {
    fun genPath(retPath: Path, floatPath: FloatArray, start: Float, stop: Float) {
        var i = 0
        val path = Path()
        while (i < floatPath.size) {
            when (idFromNan(floatPath[i])) {
                PathData.MOVE -> {
                    i++
                    path.moveTo(floatPath[i + 0], floatPath[i + 1])
                    i += 2
                }
                PathData.LINE -> {
                    i += 3
                    path.lineTo(floatPath[i + 0], floatPath[i + 1])
                    i += 2
                }
                PathData.QUADRATIC -> {
                    i += 3
                    path.quadraticTo(
                        floatPath[i + 0], floatPath[i + 1],
                        floatPath[i + 2], floatPath[i + 3],
                    )
                    i += 4
                }
                PathData.CONIC -> {
                    // Not directly exposed in multiplatform Path; skip/approximate as quadratic.
                    i += 3
                    path.quadraticTo(
                        floatPath[i + 0], floatPath[i + 1],
                        floatPath[i + 2], floatPath[i + 3],
                    )
                    i += 5
                }
                PathData.CUBIC -> {
                    i += 3
                    path.cubicTo(
                        floatPath[i + 0], floatPath[i + 1],
                        floatPath[i + 2], floatPath[i + 3],
                        floatPath[i + 4], floatPath[i + 5],
                    )
                    i += 6
                }
                PathData.CLOSE -> {
                    path.close()
                    i++
                }
                PathData.DONE -> i++
                else -> i++
            }
        }

        retPath.reset()
        if (start > 0f || stop < 1f) {
            if (start < stop) {
                val measure = PathMeasure()
                measure.setPath(path, false)
                val len = measure.length
                val scaleStart = (max(start.toDouble(), 0.0) * len).toFloat()
                val scaleStop = (min(stop.toDouble(), 1.0) * len).toFloat()
                measure.getSegment(scaleStart, scaleStop, retPath, true)
            }
        } else {
            retPath.addPath(path)
        }
    }
}
