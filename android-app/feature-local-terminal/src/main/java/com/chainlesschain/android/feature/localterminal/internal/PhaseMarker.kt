package com.chainlesschain.android.feature.localterminal.internal

/**
 * Phase tracker for feature-local-terminal — bump as sub-phases land so build
 * failures from skipping a phase surface early. Each phase sets the marker in
 * its first sub-phase commit (e.g. Phase 1.1 sets PHASE_1).
 */
internal object PhaseMarker {
    const val CURRENT: String = "3"
    const val DESCRIPTION: String =
        "Phase 3: Compose UI surface via xterm.js WebView. " +
            "LocalTerminalWebView (port of :app TerminalWebView with " +
            "LocalTerminalBridge JS interface) + LocalSessionViewModel + " +
            "LocalTerminalScreen Composable. Phase 3.4 latency gate: PTY " +
            "echo round-trip p99 = 1135μs on Xiaomi+Android 16, 4.4× under " +
            "5ms baseline budget. Next: Phase 4 — RemoteOperate tab wiring."
}
