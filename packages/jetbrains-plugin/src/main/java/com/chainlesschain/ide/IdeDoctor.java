package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * "Diagnose Bridge" — surface the CLI's own IDE-discovery diagnostics
 * ({@code cc ide status} / {@code cc ide doctor} / {@code cc ide jetbrains})
 * inside the IDE. The plugin writes the lockfile and hosts the MCP server, but
 * when a terminal {@code cc agent} doesn't auto-connect the WHY lives on the
 * CLI side — this report brings it in-IDE. The Java twin of the VS Code
 * extension's ide-doctor.js (plus the IDEA-only {@code ide jetbrains} probe).
 * Pure arg builders + report renderer; DiagnoseBridgeAction drives
 * {@code AgentChatSession.runCapture} + a dialog around them.
 */
public final class IdeDoctor {

    private IdeDoctor() {}

    /** {@code cc ide status} — which server a terminal cc agent would connect. */
    public static List<String> buildStatusArgs() {
        return new ArrayList<String>(Arrays.asList("ide", "status"));
    }

    /** {@code cc ide doctor} — why discovery did / didn't pick a server. */
    public static List<String> buildDoctorArgs() {
        return new ArrayList<String>(Arrays.asList("ide", "doctor"));
    }

    /** {@code cc ide jetbrains} — would IDEA's built-in MCP (server `idea`) connect. */
    public static List<String> buildJetbrainsArgs() {
        return new ArrayList<String>(Arrays.asList("ide", "jetbrains"));
    }

    private static String section(String out) {
        String t = out == null ? "" : out.trim();
        return t.isEmpty() ? "(no output — is the cc CLI installed and on PATH?)" : t;
    }

    /**
     * The plain-text report the dialog shows: this project's bridge state (from
     * the live plugin), then the CLI's discovery view verbatim — those sections
     * are the source of truth this report exists to surface.
     */
    public static String formatReport(int port, String statusOut, String doctorOut,
                                      String jetbrainsOut) {
        StringBuilder sb = new StringBuilder("ChainlessChain IDE bridge — diagnostics\n\n");
        sb.append("This project's bridge: ");
        if (port > 0) {
            sb.append("running on 127.0.0.1:").append(port).append(" (server \"ide\")\n");
        } else {
            sb.append("STOPPED — run Tools → \"ChainlessChain IDE: Restart Bridge\"\n");
        }
        sb.append("\n── cc ide status — which server a terminal cc agent would connect ──\n")
          .append(section(statusOut)).append("\n");
        sb.append("\n── cc ide doctor — why discovery did / didn't pick a server ──\n")
          .append(section(doctorOut)).append("\n");
        sb.append("\n── cc ide jetbrains — IDEA built-in MCP (server \"idea\") ──\n")
          .append(section(jetbrainsOut)).append("\n");
        sb.append("\nA cc agent run in this IDE's terminal auto-connects via the injected\n")
          .append("CHAINLESSCHAIN_IDE_PORT/_TOKEN; from an outside terminal, discovery\n")
          .append("matches the lockfile's workspace folders against your cwd.\n");
        return sb.toString();
    }
}
