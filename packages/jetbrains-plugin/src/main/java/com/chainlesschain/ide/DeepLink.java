package com.chainlesschain.ide;

import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Pure parser for ChainlessChain deep links — the JetBrains twin of the VS Code
 * extension's {@code uri-handler.js} ({@code vscode://…/open[?prompt=…]}
 * parity). The IDE's {@code jetbrains://} protocol handler (a
 * {@code JBProtocolCommand}) hands us a decoded {@code target} segment plus a
 * {@code parameters} map; this maps that to an action the SDK glue acts on
 * (focus the chat tool window, seed a prompt, resume a session, reveal a file).
 * SDK-free → smoke-testable without the platform.
 *
 * <p>Supported today: {@code jetbrains://idea/chainlesschain/open?prompt=…&session=…&file=…&line=…&workspace=…&mode=…}
 * — a null/blank target also maps to {@code "open"} (matching the VS "bare
 * authority → open" rule). Anything else returns {@code null} so an unknown link
 * is ignored rather than misfiring.
 *
 * <p>SECURITY (same stance as the VS twin): a deep link is UNTRUSTED input.
 * {@code prompt} is only SEEDED (never auto-sent); {@code mode} accepts only the
 * safe approval modes and NEVER {@code bypassPermissions}; ids/lines are
 * shape-validated; {@code workspace} is returned verbatim for the glue to
 * compare against the open project.
 */
public final class DeepLink {
    private DeepLink() {}

    /** Approval modes a deep link may request — bypassPermissions is deliberately absent. */
    public static final Set<String> SAFE_MODES = Set.of("default", "acceptEdits", "plan");

    private static final Pattern SESSION_ID = Pattern.compile("^[A-Za-z0-9._-]{1,128}$");

    /** The parsed deep-link action. Absent fields are null (line is 0 when absent). */
    public static final class Action {
        public final String action;
        public final String prompt;
        public final String session;
        public final String file;
        public final int line; // 1-based; 0 = none
        public final String workspace;
        public final String mode;

        Action(String action, String prompt, String session, String file,
               int line, String workspace, String mode) {
            this.action = action;
            this.prompt = prompt;
            this.session = session;
            this.file = file;
            this.line = line;
            this.workspace = workspace;
            this.mode = mode;
        }
    }

    /**
     * Parse a deep link into an {@link Action}, or {@code null} for anything we
     * don't handle.
     *
     * @param target     the path segment after the command (e.g. {@code "open"});
     *                   null/blank maps to {@code "open"}
     * @param parameters decoded query parameters; may be null
     */
    public static Action parse(String target, Map<String, String> parameters) {
        String action = normalize(target);
        if (action.isEmpty()) action = "open";
        if (!action.equals("open")) return null; // only /open is supported today

        String prompt = blankToNull(get(parameters, "prompt"));
        String session = normalizeSession(get(parameters, "session"));

        String file = blankToNull(get(parameters, "file"));
        int line = 0;
        if (file != null) line = normalizeLine(get(parameters, "line"));

        String workspace = blankToNull(get(parameters, "workspace"));

        String rawMode = get(parameters, "mode");
        String mode = (rawMode != null && SAFE_MODES.contains(rawMode.trim()))
                ? rawMode.trim() : null;

        return new Action("open", prompt, session, file, line, workspace, mode);
    }

    private static String get(Map<String, String> m, String k) {
        return m == null ? null : m.get(k);
    }

    private static String blankToNull(String s) {
        if (s == null) return null;
        return s.trim().isEmpty() ? null : s;
    }

    /** Clean + validate a session id, or null (spaces / separators / >128 → null). */
    private static String normalizeSession(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        return SESSION_ID.matcher(s).matches() ? s : null;
    }

    /** Parse a 1-based line, or 0 (0/negative/NaN/huge → 0). */
    private static int normalizeLine(String raw) {
        if (raw == null) return 0;
        try {
            long n = Long.parseLong(raw.trim());
            return (n >= 1 && n <= 2_000_000_000L) ? (int) n : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** Strip leading slashes + lowercase, tolerant of null (mirrors the JS regex). */
    private static String normalize(String s) {
        if (s == null) return "";
        String t = s.trim();
        int i = 0;
        while (i < t.length() && t.charAt(i) == '/') i++;
        return t.substring(i).toLowerCase(Locale.ROOT);
    }
}
