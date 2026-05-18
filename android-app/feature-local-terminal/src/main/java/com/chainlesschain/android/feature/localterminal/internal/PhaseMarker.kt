package com.chainlesschain.android.feature.localterminal.internal

/**
 * Phase tracker for feature-local-terminal — bump as sub-phases land so build
 * failures from skipping a phase surface early. Each phase sets the marker in
 * its first sub-phase commit (e.g. Phase 1.1 sets PHASE_1).
 */
internal object PhaseMarker {
    const val CURRENT: String = "1.1"
    const val DESCRIPTION: String =
        "Phase 1.1: real pty_jni.cpp (posix_spawn + POSIX_SPAWN_SETSID + " +
            "openpty/grantpt/unlockpt/ptsname_r + read/write/winsize/killpg/" +
            "waitpid/close JNI bridge) + LocalPtyNative.kt typed surface. " +
            "Next: Phase 1.2 LocalPtyClient.kt (coroutine wrapper with " +
            "stdoutFlow/exitFlow + shutdown SIGTERM-then-SIGKILL escalation)."
}
