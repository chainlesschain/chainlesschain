package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Remote/cloud session handoff — the Java twin of the VS Code extension's
 * chat/remote-handoff.js. Pure arg builders + tolerant parsers.
 *
 * {@code /handoff} converts the panel's conversation into a detached
 * background agent ({@code cc agent --bg --resume <sessionId> -p <prompt>
 * --output-format json}); the session then keeps running without the IDE and
 * is continuable from the web panel's Background Agents view (browser/phone),
 * {@code cc attach <id>}, or either IDE's Background Agents panel.
 *
 * The Remote Control action wraps {@code cc remote-control start/status/stop
 * --json} so the IDE can boot a pairing host for mobile/web devices, surface
 * the one-time pairing URI, and stop hosts.
 */
public final class RemoteHandoff {

    private RemoteHandoff() {}

    /** {@code cc agent --bg --resume <sessionId> -p <prompt> --output-format json}. */
    public static List<String> buildHandoffArgs(String sessionId, String prompt) {
        return new ArrayList<String>(Arrays.asList(
                "agent", "--bg", "--resume", String.valueOf(sessionId),
                "-p", String.valueOf(prompt), "--output-format", "json"));
    }

    /**
     * Parse the background-launch state JSON ({@code {id, sessionId, …}}) out
     * of the launcher's stdout. Tolerant: scans lines for the first JSON
     * object carrying an {@code id}; stray log lines don't break it.
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseBackgroundState(String stdout) {
        for (String line : String.valueOf(stdout == null ? "" : stdout).split("\r?\n")) {
            String s = line.trim();
            if (!s.startsWith("{")) continue;
            try {
                Object parsed = MiniJson.parse(s);
                if (parsed instanceof Map && ((Map<String, Object>) parsed).get("id") != null) {
                    return (Map<String, Object>) parsed;
                }
            } catch (RuntimeException ignored) {
                // not this line
            }
        }
        return null;
    }

    /** {@code cc remote-control start --json} — long-running; first output is pairing JSON. */
    public static List<String> buildRemoteControlStartArgs() {
        return new ArrayList<String>(Arrays.asList("remote-control", "start", "--json"));
    }

    /** {@code cc remote-control status --json --prune} (prune drops dead-pid records). */
    public static List<String> buildRemoteControlStatusArgs() {
        return new ArrayList<String>(Arrays.asList(
                "remote-control", "status", "--json", "--prune"));
    }

    /** {@code cc remote-control stop --port <port> --json}. */
    public static List<String> buildRemoteControlStopArgs(long port) {
        return new ArrayList<String>(Arrays.asList(
                "remote-control", "stop", "--port", String.valueOf(port), "--json"));
    }

    /**
     * Extract the FIRST complete top-level JSON object from an accumulating
     * stdout buffer (the start command pretty-prints its pairing JSON across
     * multiple lines, then keeps serving). Null until the buffer holds a
     * balanced object. String-aware brace counting (tokens are arbitrary
     * base64url, so quotes/escapes are honored).
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> extractFirstJsonObject(String buffer) {
        String s = String.valueOf(buffer == null ? "" : buffer);
        int start = s.indexOf('{');
        if (start < 0) return null;
        int depth = 0;
        boolean inString = false;
        boolean escaped = false;
        for (int i = start; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (inString) {
                if (escaped) escaped = false;
                else if (ch == '\\') escaped = true;
                else if (ch == '"') inString = false;
                continue;
            }
            if (ch == '"') inString = true;
            else if (ch == '{') depth++;
            else if (ch == '}') {
                depth--;
                if (depth == 0) {
                    try {
                        Object parsed = MiniJson.parse(s.substring(start, i + 1));
                        return parsed instanceof Map ? (Map<String, Object>) parsed : null;
                    } catch (RuntimeException e) {
                        return null;
                    }
                }
            }
        }
        return null;
    }

    /** Parse {@code remote-control status --json} (array of host states). */
    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> parseRemoteControlStatus(String stdout) {
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        Object parsed;
        try {
            parsed = MiniJson.parse(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return out;
        }
        if (!(parsed instanceof List)) return out;
        for (Object row : (List<?>) parsed) {
            if (row instanceof Map && !Boolean.TRUE.equals(((Map<String, Object>) row).get("invalid"))) {
                out.add((Map<String, Object>) row);
            }
        }
        return out;
    }

    /** One-line human summary of a background handoff for the transcript. */
    public static String formatHandoffNote(Map<String, Object> state) {
        Object id = state == null ? null : state.get("id");
        if (id == null || String.valueOf(id).isEmpty()) return null;
        return "handed off to background agent " + id
                + " — continue from the web panel's Background Agents view, `cc attach "
                + id + "`, or the IDE Background Agents panel; this tab is detached"
                + " (pick the session again to re-attach here later)";
    }

    /** Human summary of a pairing payload (start --json). */
    public static String formatPairingNote(Map<String, Object> pairing) {
        Object uri = pairing == null ? null : pairing.get("pairingUri");
        if (uri == null || String.valueOf(uri).isEmpty()) return null;
        String mode = "relay".equals(pairing.get("mode")) ? "relay (E2EE)" : "direct LAN";
        Object exp = pairing.get("pairing") instanceof Map
                ? ((Map<?, ?>) pairing.get("pairing")).get("expiresAt") : null;
        String expText = "n/a";
        if (exp instanceof Number) {
            expText = String.valueOf(
                    java.time.Instant.ofEpochMilli(((Number) exp).longValue()));
        } else if (exp != null && !String.valueOf(exp).isEmpty()) {
            expText = String.valueOf(exp);
        }
        return "remote control ready (" + mode + ", port " + pairing.get("port")
                + ") — pair a phone/web panel with the one-time URI (expires "
                + expText + "):\n" + uri;
    }

    /** One status row for a hosts dialog: {@code "running  port 18800  direct  pid 123  session s1"}. */
    public static String formatStatusLine(Map<String, Object> host) {
        if (host == null) return "";
        boolean alive = Boolean.TRUE.equals(host.get("alive"));
        return (alive ? "running" : "stale  ")
                + "  port " + host.get("port")
                + "  " + (host.get("mode") == null ? "?" : host.get("mode"))
                + "  pid " + host.get("pid")
                + "  session " + (host.get("agentSessionId") == null
                        ? "?" : host.get("agentSessionId"));
    }
}
