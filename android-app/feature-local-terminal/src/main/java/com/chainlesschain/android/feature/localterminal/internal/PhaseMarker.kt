package com.chainlesschain.android.feature.localterminal.internal

/**
 * Phase tracker for feature-local-terminal — bump as sub-phases land so build
 * failures from skipping a phase surface early. Each phase sets the marker in
 * its first sub-phase commit (e.g. Phase 1.1 sets PHASE_1).
 */
internal object PhaseMarker {
    const val CURRENT: String = "0.2"
    const val DESCRIPTION: String =
        "mksh R59c vendored + cross-compiled to libmksh.so per ABI via upstream " +
            "Build.sh. Remaining: toybox (0.3) + termux-exec (0.4) + PTY JNI (1.1)."
}
