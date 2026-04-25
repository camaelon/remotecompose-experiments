/*
 * Copyright 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */
package org.nirensei.remoteplayer

import androidx.compose.remote.core.Operations

/**
 * Ensures the operation map used when a document declares no profile still includes the
 * AndroidX profile operations. This is necessary because .rc files emitted by the creation
 * tooling may not tag themselves with [RcProfiles.PROFILE_ANDROIDX], yet contain
 * operations from that profile (DATA_SHADER, etc.).
 *
 * We use reflection to copy the PROFILE_ANDROIDX map into the slot for profile=0.
 */
internal object OperationProfileInjector {

    private const val PROFILE_ANDROIDX = 0x200

    private var initialised = false

    fun ensure() {
        if (initialised) return
        synchronized(this) {
            if (initialised) return
            try {
                // Force creation of the profile=PROFILE_ANDROIDX map.
                val androidxMap = Operations.getOperations(7, PROFILE_ANDROIDX) ?: return
                val sMapV7Field = Operations::class.java.getDeclaredField("sMapV7").apply {
                    isAccessible = true
                }
                @Suppress("UNCHECKED_CAST")
                val hashMap = sMapV7Field.get(null) as? MutableMap<Int, Any>
                hashMap?.put(0, androidxMap)
            } catch (t: Throwable) {
                t.printStackTrace()
            }
            initialised = true
        }
    }
}
