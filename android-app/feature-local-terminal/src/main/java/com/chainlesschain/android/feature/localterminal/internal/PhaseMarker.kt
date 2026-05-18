package com.chainlesschain.android.feature.localterminal.internal

/**
 * Phase tracker for feature-local-terminal — bump as sub-phases land so build
 * failures from skipping a phase surface early. Each phase sets the marker in
 * its first sub-phase commit (e.g. Phase 1.1 sets PHASE_1).
 */
internal object PhaseMarker {
    const val CURRENT: String = "0.1"
    const val DESCRIPTION: String =
        "NDK toolchain + module skeleton. Real native binaries (mksh / toybox / " +
            "termux-exec) and PTY JNI surface land in Phase 0.2-0.4 + 1.1."
}
