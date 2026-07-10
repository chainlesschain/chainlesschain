package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.List;

/**
 * Remote / WSL Doctor (P2 #12) — the JetBrains twin of the VS Code extension's
 * {@code remote-doctor.js}. Pure analysis of the environment signals that make
 * the IDE↔cc bridge flaky on WSL2 / Remote / SSH: WSL mirrored networking, a
 * missing or version-mismatched CLI on the remote host, a stopped/unreachable
 * bridge port, and loopback/firewall reachability — each with a COPYABLE fix.
 * SDK-free → smoke-testable; DiagnoseBridgeAction gathers the real signals.
 */
public final class RemoteDoctor {
    private RemoteDoctor() {}

    /** Signals the host gathers; unknowns default to the benign value. */
    public static final class Signals {
        public boolean isWsl;
        public boolean isRemote;
        public String remoteUncPath; // null unless a \\wsl… folder is open
        public Boolean cliFound;     // null = unknown
        public String cliVersion;
        public String minCliVersion;
        public int bridgePort;       // 0 = stopped
        public String portProbe;     // "listening" | "stopped" | "unknown"
    }

    /** A leveled check with an optional copyable fix. */
    public static final class Check {
        public final String level; // ok | warn | error
        public final String id;
        public final String title;
        public final String detail;
        public final String fix; // null when none

        Check(String level, String id, String title, String detail, String fix) {
            this.level = level;
            this.id = id;
            this.title = title;
            this.detail = detail;
            this.fix = fix;
        }
    }

    public static final class Result {
        public final String level;
        public final List<Check> checks;
        public final String summary;

        Result(String level, List<Check> checks, String summary) {
            this.level = level;
            this.checks = checks;
            this.summary = summary;
        }
    }

    /** Compare dotted numeric versions, ignoring a prerelease tail. <0/0/>0. */
    public static int compareVersions(String a, String b) {
        int[] x = parse(a);
        int[] y = parse(b);
        int n = Math.max(x.length, y.length);
        for (int i = 0; i < n; i++) {
            int d = (i < x.length ? x[i] : 0) - (i < y.length ? y[i] : 0);
            if (d != 0) return d < 0 ? -1 : 1;
        }
        return 0;
    }

    private static int[] parse(String v) {
        String s = (v == null ? "" : v).trim().replaceFirst("^v", "").split("[-+]")[0];
        String[] parts = s.isEmpty() ? new String[0] : s.split("\\.");
        int[] out = new int[parts.length];
        for (int i = 0; i < parts.length; i++) {
            try {
                out[i] = Integer.parseInt(parts[i].trim());
            } catch (NumberFormatException e) {
                out[i] = 0;
            }
        }
        return out;
    }

    public static Result analyze(Signals s) {
        List<Check> checks = new ArrayList<>();
        boolean remote = s.isWsl || s.remoteUncPath != null || s.isRemote;

        if (s.isWsl || s.remoteUncPath != null) {
            checks.add(new Check("warn", "wsl-networking", "WSL2 networking",
                    "The IDE bridge binds 127.0.0.1. Under WSL2's default NAT networking, a "
                            + "cc in the Windows host and the IDE in WSL don't share loopback. "
                            + "Mirrored networking makes 127.0.0.1 shared.",
                    "Add to %UserProfile%\\.wslconfig then `wsl --shutdown`:\n"
                            + "[wsl2]\nnetworkingMode=mirrored"));
        }

        if (Boolean.FALSE.equals(s.cliFound)) {
            checks.add(new Check("error", "cli-missing", "cc CLI not found on this host",
                    remote
                            ? "Remote/WSL sessions have their own PATH — the CLI must be "
                                    + "installed on the host the IDE runs on."
                            : "The chat panel and bridge shell out to `cc`.",
                    "npm install -g chainlesschain"));
        } else if (Boolean.TRUE.equals(s.cliFound) && s.cliVersion != null
                && s.minCliVersion != null) {
            if (compareVersions(s.cliVersion, s.minCliVersion) < 0) {
                checks.add(new Check("warn", "cli-outdated",
                        "cc CLI is older than this plugin expects",
                        "Found " + s.cliVersion + "; the plugin targets ≥ "
                                + s.minCliVersion + ". Some features may be missing.",
                        "npm install -g chainlesschain@latest"));
            } else {
                checks.add(new Check("ok", "cli-ok", "cc CLI present and compatible",
                        "Found " + s.cliVersion + ".", null));
            }
        }

        if ("stopped".equals(s.portProbe) || s.bridgePort == 0) {
            checks.add(new Check("error", "bridge-stopped", "IDE bridge is not running",
                    "A terminal cc agent auto-connects via the bridge; without it there's "
                            + "no editor context (selection/diagnostics/diff).",
                    "Run Tools → “ChainlessChain IDE: Restart Bridge”"));
        } else if (s.bridgePort > 0) {
            checks.add(new Check("ok", "bridge-ok", "IDE bridge is listening",
                    "127.0.0.1:" + s.bridgePort
                            + (remote ? " — confirm the same host can reach this port." : ""),
                    null));
        }

        if (remote && s.bridgePort > 0 && !"listening".equals(s.portProbe)) {
            checks.add(new Check("warn", "firewall", "Bridge reachability unverified",
                    "The bridge is up but a loopback probe didn't confirm reachability — a "
                            + "host firewall or WSL NAT can still block 127.0.0.1.",
                    "netsh advfirewall firewall add rule name=\"cc-ide\" dir=in action=allow "
                            + "protocol=TCP localport=" + s.bridgePort));
        }

        String level = "ok";
        for (Check c : checks) {
            if ("error".equals(c.level)) { level = "error"; break; }
            if ("warn".equals(c.level)) level = "warn";
        }
        return new Result(level, checks, summarize(level, checks, remote));
    }

    private static String summarize(String level, List<Check> checks, boolean remote) {
        StringBuilder sb = new StringBuilder();
        sb.append(remote
                ? "Remote / WSL Doctor — remote or WSL session detected"
                : "Remote / WSL Doctor — local session").append("\n\n");
        for (Check c : checks) {
            String icon = "ok".equals(c.level) ? "✓"
                    : "warn".equals(c.level) ? "⚠" : "✗";
            sb.append(icon).append(' ').append(c.title).append('\n');
            if (c.detail != null && !c.detail.isEmpty()) {
                sb.append("    ").append(c.detail.replace("\n", "\n    ")).append('\n');
            }
            if (c.fix != null) {
                sb.append("    fix: ").append(c.fix.replace("\n", "\n         ")).append('\n');
            }
            sb.append('\n');
        }
        if ("ok".equals(level)) sb.append("All checks passed.");
        return sb.toString();
    }
}
