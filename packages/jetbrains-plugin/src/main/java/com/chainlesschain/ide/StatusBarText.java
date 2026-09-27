package com.chainlesschain.ide;

/**
 * Pure text derivation for the status-bar widget (VS Code status-bar parity:
 * bridge running state + port, plus the active conversation's approval mode so
 * auto-accept / bypass are visible outside the chat panel). No IntelliJ SDK —
 * compiles + smoke-tests with plain {@code javac}; the SDK glue
 * (BridgeStatusBarWidgetFactory) only reads these strings.
 */
public final class StatusBarText {

    private StatusBarText() {}

    public static String labelForState(int port, PermissionModeState.Snapshot state) {
        if (state == null) return port > 0 ? "CC :" + port : "CC off";
        String base = port > 0 ? "CC :" + port : "CC off";
        if (!"effective".equals(state.status())) {
            String last = state.effective() == null ? "" : " · last confirmed " + state.effective();
            return base + " · " + state.requested() + " " + state.status() + last;
        }
        String requested = state.requested().equals(state.effective()) ? "" : " (requested " + state.requested() + ")";
        return base + " · " + state.effective() + requested;
    }

    public static String tooltipForState(int port, PermissionModeState.Snapshot state) {
        String bridge = port > 0 ? "ChainlessChain IDE bridge · 127.0.0.1:" + port
                : "ChainlessChain IDE bridge is stopped";
        return bridge + "\n" + modeStateLine(state)
                + (state == null ? "" : "\n" + state.reason()
                    + (state.policyRevision() == null ? "" : "\nPolicy revision: " + state.policyRevision()))
                + "\nClick for bridge status";
    }

    public static String modeStateLine(PermissionModeState.Snapshot state) {
        if (state == null) return "No active chat agent";
        String effectiveLabel = "effective".equals(state.status()) ? "effective " : "last confirmed ";
        return "Approvals: requested " + state.requested()
                + " · " + (state.effective() == null ? "effective unconfirmed" : effectiveLabel + state.effective())
                + " · " + state.status();
    }

    /**
     * Compact widget label. Examples: {@code "CC :63412"} (running, normal
     * approvals), {@code "CC :63412 ⚠bypass"}, {@code "CC off"} (bridge down).
     */
    public static String label(int port, String mode) {
        String base = port > 0 ? "CC :" + port : "CC off";
        String suffix = modeSuffix(mode);
        return suffix.isEmpty() ? base : base + " " + suffix;
    }

    /**
     * Mode marker appended to the label — empty for the normal/default mode
     * (the quiet steady state), visible for the two elevated modes.
     */
    public static String modeSuffix(String mode) {
        if ("acceptEdits".equals(mode)) return "✓auto";
        if ("bypassPermissions".equals(mode)) return "⚠bypass";
        return "";
    }

    /** Multi-line hover tooltip: bridge endpoint + approval mode + click hint. */
    public static String tooltip(int port, String mode) {
        String bridge = port > 0
                ? "ChainlessChain IDE bridge · 127.0.0.1:" + port + " (MCP server \"ide\")"
                : "ChainlessChain IDE bridge is stopped";
        return bridge + "\n" + modeLine(mode) + "\nClick for bridge status";
    }

    /** One tooltip line describing the chat's approval mode + how to change it. */
    public static String modeLine(String mode) {
        if ("acceptEdits".equals(mode)) {
            return "Chat approvals: auto-accept edits · /normal to restore";
        }
        if ("bypassPermissions".equals(mode)) {
            return "Chat approvals: BYPASSED (dangerous) · /normal to restore";
        }
        return "Chat approvals: normal (confirm each step) · /auto · /bypass";
    }
}
