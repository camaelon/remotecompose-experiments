/*
 * Copyright 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */
package org.nirensei.remoteplayer

import androidx.compose.remote.core.CoreDocument
import androidx.compose.remote.core.RemoteComposeBuffer
import java.io.File
import java.io.InputStream

/**
 * Load a RemoteCompose document from an [InputStream] of `.rc` bytes.
 *
 * Returns null if the stream cannot be decoded into a [CoreDocument]. The caller is
 * responsible for closing the stream.
 */
fun loadRemoteDocument(input: InputStream): CoreDocument? = try {
    OperationProfileInjector.ensure()
    val buffer = RemoteComposeBuffer.fromInputStream(input)
    CoreDocument().apply { initFromBuffer(buffer) }
} catch (t: Throwable) {
    t.printStackTrace()
    null
}

/** Convenience overload that opens [file] and delegates to [loadRemoteDocument]. */
fun loadRemoteDocument(file: File): CoreDocument? =
    file.inputStream().use { loadRemoteDocument(it) }
