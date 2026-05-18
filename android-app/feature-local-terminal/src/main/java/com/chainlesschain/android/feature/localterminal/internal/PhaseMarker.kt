package com.chainlesschain.android.feature.localterminal.internal

/**
 * Phase tracker for feature-local-terminal — bump as sub-phases land so build
 * failures from skipping a phase surface early. Each phase sets the marker in
 * its first sub-phase commit (e.g. Phase 1.1 sets PHASE_1).
 */
internal object PhaseMarker {
    const val CURRENT: String = "1.2"
    const val DESCRIPTION: String =
        "Phase 1.2: LocalPtyClient.kt coroutine wrapper + PtyNative interface. " +
            "Surface: start/writeStdin/stdoutFlow/exitFlow/resize/shutdown with " +
            "SIGTERM → 5s grace → SIGKILL escalation, killpg→kill fallback for " +
            "MIUI signal-domain hardening. ~15 unit tests (FakePtyNative) + 3 " +
            "instrumented (real mksh on device). Next: Phase 1.3 — Phase 1 " +
            "smoke integration with PtyManager-style session lifecycle."
}
