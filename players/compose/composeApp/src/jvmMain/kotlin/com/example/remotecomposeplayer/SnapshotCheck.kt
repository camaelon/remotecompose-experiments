package com.example.remotecomposeplayer

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Density
import org.nirensei.remoteplayer.RemoteDocumentPlayer
import org.nirensei.remoteplayer.RemoteDocumentPlayerState
import org.nirensei.remoteplayer.loadRemoteDocument
import java.io.File

@OptIn(ExperimentalComposeUiApi::class)
fun main(args: Array<String>) {
    val path = args.firstOrNull() ?: "../../samples/base.rc"
    val out = args.getOrNull(1) ?: "snapshot.png"
    val doc = loadRemoteDocument(File(path))
        ?: error("Could not load document at $path")

    val state = RemoteDocumentPlayerState()
    val w = (args.getOrNull(2)?.toIntOrNull()) ?: 1600
    val h = (args.getOrNull(3)?.toIntOrNull()) ?: 900
    val scene = ImageComposeScene(
        width = w,
        height = h,
        density = Density(1f),
    ) {
        MaterialTheme {
            RemoteDocumentPlayer(
                document = doc,
                state = state,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
    scene.render()
    // Let any intro animation progress; player uses System.nanoTime() internally.
    val holdMs = (args.getOrNull(4)?.toLongOrNull()) ?: 2000L
    Thread.sleep(holdMs)
    scene.render()
    val png = state.snapshotPng()
        ?: error("snapshotPng returned null — player not laid out")
    File(out).writeBytes(png)
    println("Wrote ${png.size} bytes to $out")
    scene.close()
}
