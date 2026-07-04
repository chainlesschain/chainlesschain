package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Session listing for the chat panel's {@code /sessions} picker — the Java twin
 * of the VS Code extension's session-list.js. Asks the CLI
 * ({@code cc session list --json}) instead of re-implementing the home-dir /
 * store resolution (CHAINLESSCHAIN_HOME vs %APPDATA% is a known divergence
 * trap). Pure arg builder + tolerant stdout parser.
 */
public final class SessionList {

    private SessionList() {}

    /** One pickable session. */
    public static final class SessionItem {
        public final String id;
        public final String title;     // "" when untitled
        public final String updatedAt; // nullable
        /** {@code "agent"} (jsonl store) or {@code "chat"}. */
        public final String store;

        SessionItem(String id, String title, String updatedAt, String store) {
            this.id = id;
            this.title = title;
            this.updatedAt = updatedAt;
            this.store = store;
        }
    }

    /** {@code cc session list --json -n <limit>}. */
    public static List<String> buildListArgs(int limit) {
        return new ArrayList<String>(Arrays.asList(
                "session", "list", "--json", "-n", String.valueOf(limit)));
    }

    /** Tolerant parse of {@code cc session list --json} stdout (empty on any mismatch). */
    public static List<SessionItem> parseSessionList(String stdout) {
        List<SessionItem> out = new ArrayList<SessionItem>();
        Object parsed;
        try {
            parsed = MiniJson.parse(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return out;
        }
        if (!(parsed instanceof List)) return out;
        for (Object row : (List<?>) parsed) {
            if (!(row instanceof Map)) continue;
            Map<?, ?> s = (Map<?, ?>) row;
            Object id = s.get("id");
            if (!(id instanceof String) || ((String) id).isEmpty()) continue;
            Object title = s.get("title");
            Object updated = s.get("updated_at");
            if (updated == null) updated = s.get("updatedAt");
            out.add(new SessionItem(
                    (String) id,
                    title instanceof String ? (String) title : "",
                    updated instanceof String ? (String) updated : null,
                    "jsonl".equals(s.get("_store")) ? "agent" : "chat"));
        }
        return out;
    }

    /** Chooser row: {@code "<id>  ·  <store>[ · <updatedAt>][ · <title>]"}. */
    public static String itemLabel(SessionItem s) {
        StringBuilder sb = new StringBuilder(s.id).append("  ·  ").append(s.store);
        if (s.updatedAt != null && !s.updatedAt.isEmpty()) sb.append(" · ").append(s.updatedAt);
        if (s.title != null && !s.title.isEmpty()) sb.append(" · ").append(s.title);
        return sb.toString();
    }
}
