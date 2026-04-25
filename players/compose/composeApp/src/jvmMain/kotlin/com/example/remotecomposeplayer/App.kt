package com.example.remotecomposeplayer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import org.nirensei.remoteplayer.RemoteDocumentPlayer
import org.nirensei.remoteplayer.loadRemoteDocument
import java.io.File

@Composable
@Preview
fun App(initialFile: File? = null) {
    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            val examples = remember { findExampleFiles(extra = initialFile) }
            var selected by remember {
                mutableStateOf(initialFile ?: examples.firstOrNull())
            }
            val document = remember(selected) { selected?.let { loadRemoteDocument(it) } }

            Row(modifier = Modifier.fillMaxSize()) {
                Column(
                    modifier = Modifier
                        .width(320.dp)
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .padding(8.dp),
                ) {
                    Text(
                        "Examples (${examples.size})",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(8.dp),
                    )
                    LazyColumn(modifier = Modifier.fillMaxWidth()) {
                        items(examples) { file ->
                            TextButton(
                                onClick = { selected = file },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    file.name,
                                    fontWeight = if (file == selected) FontWeight.Bold else FontWeight.Normal,
                                )
                            }
                        }
                    }
                }
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black),
                    contentAlignment = Alignment.Center,
                ) {
                    val doc = document
                    if (doc != null) {
                        RemoteDocumentPlayer(
                            document = doc,
                            modifier = Modifier.fillMaxSize(),
                        )
                    } else {
                        Text(
                            "No .rc file selected (pass a path on the command line, or place .rc files under remotecompose-experiments/samples/).",
                            color = Color.White,
                        )
                    }
                }
            }
        }
    }
}

private fun findExampleFiles(extra: File? = null): List<File> {
    val dir = locateSamplesDir()
    val fromDir = dir
        ?.listFiles { f -> f.isFile && f.name.endsWith(".rc") }
        ?.toList()
        .orEmpty()
    val all = buildList {
        if (extra != null && extra.isFile) add(extra.absoluteFile)
        addAll(fromDir.map { it.absoluteFile })
    }
    return all.distinctBy { it.canonicalPath }.sortedBy { it.name }
}

private fun locateSamplesDir(): File? {
    val start = File(System.getProperty("user.dir")).absoluteFile
    var cur: File? = start
    repeat(6) {
        val c = cur ?: return@repeat
        val candidate = File(c, "samples")
        if (candidate.isDirectory) return candidate
        cur = c.parentFile
    }
    return null
}

