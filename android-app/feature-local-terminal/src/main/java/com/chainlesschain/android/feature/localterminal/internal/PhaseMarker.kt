package com.chainlesschain.android.feature.localterminal.internal

/**
 * Phase tracker for feature-local-terminal — bump as sub-phases land so build
 * failures from skipping a phase surface early. Each phase sets the marker in
 * its first sub-phase commit (e.g. Phase 1.1 sets PHASE_1).
 */
internal object PhaseMarker {
    const val CURRENT: String = "0.5"
    const val DESCRIPTION: String =
        "Phase 0 complete: NDK toolchain validated, mksh R59c + toybox 0.8.11 " +
            "vendored and cross-compiled, integration smoke test in androidTest " +
            "/. termux-exec (was 0.4) deferred to Sub-phase 5.4 (only needed " +
            "when Phase 5 Full variant ships shebang scripts). Next: Phase 1.1 " +
            "real pty_jni.cpp + LocalPtyClient."
}
