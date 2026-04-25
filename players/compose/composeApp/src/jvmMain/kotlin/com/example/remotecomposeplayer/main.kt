package com.example.remotecomposeplayer

import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import java.io.File

fun main(args: Array<String>) {
    val initial = args.firstOrNull()?.let { path ->
        val f = File(path)
        if (!f.isFile) {
            System.err.println("remotecomposeplayer: file not found: ${f.absolutePath}")
            null
        } else {
            f
        }
    }
    application {
        Window(
            onCloseRequest = ::exitApplication,
            title = "remotecomposeplayer",
        ) {
            App(initialFile = initial)
        }
    }
}