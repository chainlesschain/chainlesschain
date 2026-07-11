package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Remote / WSL Doctor one-click fixes (gap #12) — the Java twin of the VS Code
 * extension's {@code remote-doctor-fixes.js}. Pure classification of
 * {@link RemoteDoctor}'s checks into what the plugin may safely do about each:
 *
 * <ul>
 *   <li>{@code autoApplicable} — safe + non-admin: {@code npm install -g
 *       chainlesschain[@latest]} (run in a VISIBLE terminal after one confirm)
 *       and restarting the bridge via the existing RestartBridge path;</li>
 *   <li>{@code scriptable} — admin-required Windows Firewall rules → we
 *       GENERATE a complete .ps1 (elevation-checked, idempotent) for the user
 *       to review and run themselves; the plugin never runs it;</li>
 *   <li>{@code manualOnly} — .wslconfig edits (exact ini + target path, user
 *       merges) and anything we can only offer to copy.</li>
 * </ul>
 *
 * Injection stance: check titles/details/fixes are DATA, never code. Terminal
 * commands are only emitted when they match a strict allowlist; the firewall
 * script embeds nothing from a check except a digits-validated port number.
 *
 * Pure JDK + host-free so it unit-tests without the SDK; the glue (the "Fix…"
 * flow of the Diagnose Bridge dialog) lives in
 * {@code intellij/DiagnoseBridgeAction}.
 */
public final class RemoteDoctorFixes {

    private RemoteDoctorFixes() {}

    /** The only shell command shapes the "Apply safe fixes" path may run. */
    public static final Pattern AUTO_COMMAND_ALLOWLIST =
            Pattern.compile("^npm install -g chainlesschain(@latest)?$");

    /**
     * Marker for "run the existing Restart Bridge path" — the JB stand-in for
     * the VS twin's {@code chainlesschain.ide.restart} command id (here the
     * glue calls {@code IdeBridgeService.restart()} off-EDT, exactly what
     * RestartBridgeAction does).
     */
    public static final String ACTION_RESTART_BRIDGE = "restart-bridge";

    // Fix kinds.
    public static final String KIND_AUTO = "autoApplicable";
    public static final String KIND_SCRIPT = "scriptable";
    public static final String KIND_MANUAL = "manualOnly";

    // Action types.
    public static final String ACT_TERMINAL = "terminal";
    public static final String ACT_IDE_ACTION = "ideAction";
    public static final String ACT_SCRIPT = "script";
    public static final String ACT_WSLCONFIG = "wslconfig";
    public static final String ACT_COPY = "copy";

    /**
     * One classified fix. {@code actionType} decides which payload field is
     * meaningful: {@link #ACT_TERMINAL} → {@code command} (allowlisted),
     * {@link #ACT_IDE_ACTION} → {@code command} = {@link #ACTION_RESTART_BRIDGE},
     * {@link #ACT_SCRIPT} → {@code port}, {@link #ACT_COPY} → {@code copyText},
     * {@link #ACT_WSLCONFIG} → {@link #buildWslConfigPatch} output.
     */
    public static final class Fix {
        public final String id;
        public final String title;
        public final String kind;
        public final String actionType;
        public final String command;
        public final String copyText;
        public final int port;

        Fix(String id, String title, String kind, String actionType,
                String command, String copyText, int port) {
            this.id = nz(id);
            this.title = nz(title);
            this.kind = kind;
            this.actionType = actionType;
            this.command = nz(command);
            this.copyText = nz(copyText);
            this.port = port;
        }
    }

    private static final Pattern PORT_PATTERN =
            Pattern.compile("localport=(\\d{1,5})(?!\\d)");

    /**
     * Digits-only port extraction from a firewall check's fix text
     * ({@code … localport=51234}). Anything non-numeric or out of range →
     * null, so hostile check text can never smuggle script fragments into
     * the .ps1.
     */
    public static Integer extractFirewallPort(RemoteDoctor.Check check) {
        Matcher m = PORT_PATTERN.matcher(check == null ? "" : nz(check.fix));
        if (!m.find()) return null;
        int port;
        try {
            port = Integer.parseInt(m.group(1));
        } catch (NumberFormatException e) {
            return null;
        }
        return port >= 1 && port <= 65535 ? port : null;
    }

    /**
     * Classify each actionable check (level ≠ ok, has a fix) into a fix plan.
     * Tampered/unexpected fix text NEVER executes — it degrades to copy-only.
     */
    public static List<Fix> classifyFixes(List<RemoteDoctor.Check> checks) {
        List<Fix> out = new ArrayList<Fix>();
        if (checks == null) return out;
        for (RemoteDoctor.Check c : checks) {
            if (c == null || "ok".equals(c.level) || c.fix == null || c.fix.isEmpty()) {
                continue;
            }
            switch (nz(c.id)) {
                case "cli-missing":
                case "cli-outdated": {
                    String cmd = c.fix.trim();
                    if (AUTO_COMMAND_ALLOWLIST.matcher(cmd).matches()) {
                        out.add(new Fix(c.id, c.title, KIND_AUTO, ACT_TERMINAL,
                                cmd, "", 0));
                    } else {
                        // Unexpected fix text (tampered / future variant) —
                        // never execute it.
                        out.add(new Fix(c.id, c.title, KIND_MANUAL, ACT_COPY,
                                "", c.fix, 0));
                    }
                    break;
                }
                case "bridge-stopped":
                    out.add(new Fix(c.id, c.title, KIND_AUTO, ACT_IDE_ACTION,
                            ACTION_RESTART_BRIDGE, "", 0));
                    break;
                case "firewall": {
                    Integer port = extractFirewallPort(c);
                    if (port != null) {
                        out.add(new Fix(c.id, c.title, KIND_SCRIPT, ACT_SCRIPT,
                                "", "", port));
                    } else {
                        out.add(new Fix(c.id, c.title, KIND_MANUAL, ACT_COPY,
                                "", c.fix, 0));
                    }
                    break;
                }
                case "wsl-networking":
                    out.add(new Fix(c.id, c.title, KIND_MANUAL, ACT_WSLCONFIG,
                            "", "", 0));
                    break;
                default:
                    out.add(new Fix(c.id, c.title, KIND_MANUAL, ACT_COPY,
                            "", c.fix, 0));
            }
        }
        return out;
    }

    /**
     * Generate the complete, reviewable PowerShell script that adds the
     * inbound firewall rule(s) for the bridge port(s). Deterministic (no
     * timestamps), elevation-checked, idempotent (an existing cc-ide rule for
     * the same port is skipped). Only digits-validated ports reach the script
     * — nothing else from the checks is embedded. Pure ASCII: it is saved as
     * UTF-8 WITHOUT a BOM, which Windows PowerShell 5.1 would otherwise
     * decode as ANSI (mojibake).
     *
     * @return script text (CRLF line endings), or null when no firewall
     *         check with a valid port applies.
     */
    public static String buildFirewallFixScript(List<RemoteDoctor.Check> checks) {
        List<Integer> ports = new ArrayList<Integer>();
        if (checks != null) {
            for (RemoteDoctor.Check c : checks) {
                if (c == null || !"firewall".equals(c.id)) continue;
                Integer port = extractFirewallPort(c);
                if (port != null && !ports.contains(port)) ports.add(port);
            }
        }
        if (ports.isEmpty()) return null;

        StringBuilder portList = new StringBuilder();
        for (int i = 0; i < ports.size(); i++) {
            if (i > 0) portList.append(", ");
            portList.append(ports.get(i));
        }
        String[] lines = {
                "#Requires -RunAsAdministrator",
                "<#",
                " ChainlessChain Remote / WSL Doctor - firewall fix",
                "",
                " Adds an inbound Windows Firewall ALLOW rule (TCP) for the ChainlessChain",
                " IDE bridge port(s) listed below, so a cc agent running across the",
                " WSL2/host boundary can reach the bridge on 127.0.0.1.",
                "",
                " Idempotent: a cc-ide rule that already exists for the same port is",
                " skipped, so re-running the script is safe. Review before running;",
                " it must be executed from an elevated (Administrator) PowerShell.",
                "#>",
                "$ErrorActionPreference = \"Stop\"",
                "",
                "$ports = @(" + portList + ")",
                "foreach ($port in $ports) {",
                "  $ruleName = \"cc-ide-$port\"",
                "  $existing = netsh advfirewall firewall show rule name=\"$ruleName\" 2>$null | Out-String",
                "  if ($existing -match \"$ruleName\") {",
                "    Write-Host \"Rule $ruleName already exists - skipping.\"",
                "  } else {",
                "    netsh advfirewall firewall add rule name=\"$ruleName\" dir=in action=allow protocol=TCP localport=$port",
                "    Write-Host \"Added inbound allow rule $ruleName (TCP $port).\"",
                "  }",
                "}",
                "",
        };
        return String.join("\r\n", lines);
    }

    /**
     * The exact .wslconfig ini content to merge + where it lives. The plugin
     * never writes this file itself — the user confirms and merges (an
     * existing [wsl2] section must be merged by hand, not clobbered).
     */
    public static final class WslConfigPatch {
        public final String targetPathHint;
        public final String ini;
        public final String postStep;
        public final String note;

        WslConfigPatch(String targetPathHint, String ini, String postStep, String note) {
            this.targetPathHint = targetPathHint;
            this.ini = ini;
            this.postStep = postStep;
            this.note = note;
        }
    }

    /** @return the patch, or null when no wsl-networking check is present. */
    public static WslConfigPatch buildWslConfigPatch(List<RemoteDoctor.Check> checks) {
        boolean present = false;
        if (checks != null) {
            for (RemoteDoctor.Check c : checks) {
                if (c != null && "wsl-networking".equals(c.id)) { present = true; break; }
            }
        }
        if (!present) return null;
        return new WslConfigPatch(
                "%UserProfile%\\.wslconfig",
                "[wsl2]\nnetworkingMode=mirrored\n",
                "wsl --shutdown",
                "Merge into the existing [wsl2] section if the file already has one, "
                        + "then run `wsl --shutdown` and reopen the WSL window.");
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
