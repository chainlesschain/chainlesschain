package com.chainlesschain.android.feature.localterminal

/**
 * Phase 0.1 placeholder — proves the JNI symbol path from Kotlin → libpty_jni.so
 * resolves on all 3 ABIs. Real PTY surface (openPty / spawn / read / write /
 * killpg / waitpid) is in `LocalPtyNative` introduced by Phase 1.1.
 *
 * Lazy load pattern follows feature-ai/WhisperNative — Robolectric / host JVM
 * unit tests don't have the .so available, so loadLibrary is gated by
 * double-checked locking and only triggered when an instance is constructed.
 */
internal class LocalTerminalNative {
    companion object {
        @Volatile
        private var libraryLoaded = false

        @JvmStatic
        fun ensureLoaded() {
            if (!libraryLoaded) synchronized(this) {
                if (!libraryLoaded) {
                    System.loadLibrary("pty_jni")
                    libraryLoaded = true
                }
            }
        }
    }

    init {
        ensureLoaded()
    }

    external fun nativeVersion(): String
}
