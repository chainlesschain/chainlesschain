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
