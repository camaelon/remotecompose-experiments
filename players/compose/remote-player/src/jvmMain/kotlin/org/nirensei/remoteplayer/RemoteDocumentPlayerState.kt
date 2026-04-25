/*
 * Copyright 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */
package org.nirensei.remoteplayer

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/**
 * Handle for interacting with a running [RemoteDocumentPlayer].
 *
 * Pass an instance via [RemoteDocumentPlayer]'s `state` parameter, then call [snapshotPng]
 * to capture the current view as a PNG byte array.
 *
 * Call from the UI thread; the snapshot re-paints the document into an offscreen bitmap
 * using the player's live remote context.
 */
class RemoteDocumentPlayerState {
    internal var captureCallback: (() -> ByteArray?)? = null

    /**
     * Capture the currently displayed view as PNG bytes.
     *
     * Returns null if the player has not yet been laid out or is not currently composed.
     */
    fun snapshotPng(): ByteArray? = captureCallback?.invoke()
}

@Composable
fun rememberRemoteDocumentPlayerState(): RemoteDocumentPlayerState =
    remember { RemoteDocumentPlayerState() }
