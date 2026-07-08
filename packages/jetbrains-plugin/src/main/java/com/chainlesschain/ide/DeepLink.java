package com.chainlesschain.ide;

import java.util.Locale;
import java.util.Map;

/**
 * Pure parser for ChainlessChain deep links — the JetBrains twin of the VS Code
 * extension's {@code uri-handler.js} ({@code vscode://…/open[?prompt=…]}
 * parity). The IDE's {@code jetbrains://} protocol handler (a
 * {@code JBProtocolCommand}) hands us a decoded {@code target} segment plus a
 * {@code parameters} map; this maps that to an action the SDK glue acts on
 * (focus the chat tool window, optionally seed a prompt). SDK-free → smoke-
 * testable without the platform.
 *
 * <p>Supported today: {@code jetbrains://idea/chainlesschain/open?prompt=…} — a
 * null/blank target also maps to {@code "open"} (matching the VS "bare authority
 * → open" rule). Anything else returns {@code null} so an unknown link is
 * ignored rather than misfiring.
 */
public final class DeepLink {
    private DeepLink() {}

    /** The parsed deep-link action. {@code prompt} is null when none was given. */
    public static final class Action {
        public final String action;
        public final String prompt;

        Action(String action, String prompt) {
            this.action = action;
            this.prompt = prompt;
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
        String prompt = parameters == null ? null : parameters.get("prompt");
        if (prompt != null && prompt.trim().isEmpty()) prompt = null;
        return new Action("open", prompt);
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
