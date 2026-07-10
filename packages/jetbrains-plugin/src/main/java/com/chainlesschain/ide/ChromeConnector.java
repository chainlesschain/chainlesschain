package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Chrome connector IDE entry (P1 #8) — the Java twin of the VS Code
 * extension's chrome-connector.js. Wraps the CLI's {@code cc browse chrome
 * status/launch/state --json} (CDP attach to the user's real/dedicated-
 * profile Chrome) and renders the captured page state as a monospace text
 * report. Pure builders/parsers, JUnit-testable.
 */
public final class ChromeConnector {

    private ChromeConnector() {}

    public static List<String> buildStatusArgs(int port) {
        return new ArrayList<String>(Arrays.asList(
                "browse", "chrome", "status", "--port", String.valueOf(port), "--json"));
    }

    public static List<String> buildLaunchArgs(int port, String url) {
        List<String> args = new ArrayList<String>(Arrays.asList(
                "browse", "chrome", "launch", "--port", String.valueOf(port)));
        if (url != null && !url.isEmpty()) {
            args.add("--url");
            args.add(url);
        }
        args.add("--json");
        return args;
    }

    public static List<String> buildStateArgs(int port, int tab, long watchMs,
            boolean reload, String screenshotPath) {
        List<String> args = new ArrayList<String>(Arrays.asList(
                "browse", "chrome", "state",
                "--port", String.valueOf(port),
                "--tab", String.valueOf(tab),
                "--watch-ms", String.valueOf(watchMs)));
        if (reload) args.add("--reload");
        if (screenshotPath != null && !screenshotPath.isEmpty()) {
            args.add("--screenshot");
            args.add(screenshotPath);
        }
        args.add("--json");
        return args;
    }

    /** Tolerant parse of any of the three --json replies; null = unreadable. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseJson(String text) {
        try {
            Object parsed = MiniJson.parse(text == null ? "" : text.trim());
            return parsed instanceof Map ? (Map<String, Object>) parsed : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Render a captured state as the text report. Null when not ok. */
    public static String stateToReport(Map<String, Object> state) {
        if (state == null || !Boolean.TRUE.equals(state.get("ok"))) return null;
        StringBuilder sb = new StringBuilder();
        sb.append("Chrome page state\n\n");
        Object title = state.get("title");
        sb.append(title == null || String.valueOf(title).isEmpty()
                ? "(untitled)" : title).append('\n');
        sb.append("URL: ").append(state.get("url")).append('\n');
        Object tabs = state.get("tabs");
        int tabCount = tabs instanceof List ? ((List<?>) tabs).size() : 0;
        sb.append("tab ").append(state.get("tab")).append(" of ").append(tabCount);
        Object html = state.get("html");
        if (html instanceof String) {
            sb.append("  ·  DOM ").append(((String) html).length());
            if (Boolean.TRUE.equals(state.get("htmlTruncated"))) sb.append("+ (truncated)");
            sb.append(" chars");
        }
        sb.append('\n');
        Object shot = state.get("screenshotPath");
        if (shot != null) sb.append("screenshot: ").append(shot).append('\n');

        sb.append("\nConsole:\n");
        Object console = state.get("console");
        if (!(console instanceof List) || ((List<?>) console).isEmpty()) {
            sb.append("  (nothing captured — observed from attach time;"
                    + " use Capture with reload for load-time output)\n");
        } else {
            int shown = 0;
            for (Object row : (List<?>) console) {
                if (!(row instanceof Map) || shown++ >= 50) continue;
                Map<?, ?> c = (Map<?, ?>) row;
                sb.append("  [").append(c.get("type")).append("] ")
                        .append(c.get("text")).append('\n');
            }
        }

        sb.append("\nNetwork issues:\n");
        Object network = state.get("network");
        if (!(network instanceof List) || ((List<?>) network).isEmpty()) {
            sb.append("  (no failed or 4xx/5xx requests observed)\n");
        } else {
            int shown = 0;
            for (Object row : (List<?>) network) {
                if (!(row instanceof Map) || shown++ >= 50) continue;
                Map<?, ?> nw = (Map<?, ?>) row;
                sb.append("  [").append(nw.get("kind")).append("] ").append(nw.get("url"));
                if (nw.get("status") != null) sb.append(" -> ").append(nw.get("status"));
                if (nw.get("error") != null && !String.valueOf(nw.get("error")).isEmpty()) {
                    sb.append(" (").append(nw.get("error")).append(')');
                }
                sb.append('\n');
            }
        }

        if (tabCount > 1 && tabs instanceof List) {
            sb.append("\nTabs:\n");
            for (Object row : (List<?>) tabs) {
                if (row instanceof Map) {
                    sb.append("  [").append(((Map<?, ?>) row).get("index")).append("] ")
                            .append(((Map<?, ?>) row).get("url")).append('\n');
                }
            }
        }
        sb.append("\nCaptured with `cc browse chrome state` — the agent can run"
                + " the same command (add --reload) to see this context.\n");
        return sb.toString();
    }
}
