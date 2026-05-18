package com.chainlesschain.android.feature.localterminal.internal

/**
 * Phase tracker for feature-local-terminal — bump as sub-phases land so build
 * failures from skipping a phase surface early. Each phase sets the marker in
 * its first sub-phase commit (e.g. Phase 1.1 sets PHASE_1).
 */
internal object PhaseMarker {
    const val CURRENT: String = "2"
    const val DESCRIPTION: String =
        "Phase 2: LocalFilesystemBootstrapper + PtyEnvironment. \$PREFIX " +
            "skeleton with bin/etc/lib/share/tmp + idempotent re-link on every " +
            "bootstrap. Profile/mkshrc/motd inlined (no usr.tar.xz until " +
            "Phase 5 brings Node+CLI snapshot). 10 instrumented bootstrap + " +
            "env + spawn-via-\$PREFIX cases pass on Xiaomi+Android 16. Next: " +
            "Phase 3 — Compose AnsiTerminalView + xterm.js WebView bridge."
}
