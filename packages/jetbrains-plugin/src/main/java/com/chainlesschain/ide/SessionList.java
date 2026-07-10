package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
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
        /** {@code "agent"} (jsonl store), {@code "chat"} or {@code "ide:<name>"}. */
        public final String store;
        /** IDE-index lifecycle status ({@code "running"}…), "" for CLI rows. */
        public final String status;
        /** Workspace path from the IDE index, "" for CLI rows. */
        public final String workspace;

        SessionItem(String id, String title, String updatedAt, String store) {
            this(id, title, updatedAt, store, "", "");
        }

        SessionItem(String id, String title, String updatedAt, String store,
                String status, String workspace) {
            this.id = id;
            this.title = title;
            this.updatedAt = updatedAt;
            this.store = store;
            this.status = status == null ? "" : status;
            this.workspace = workspace == null ? "" : workspace;
        }
    }

    /** {@code cc session list --json -n <limit>}. */
    public static List<String> buildListArgs(int limit) {
        return new ArrayList<String>(Arrays.asList(
                "session", "list", "--json", "-n", String.valueOf(limit)));
    }

    /** {@code cc session delete <id> --force} — force skips the interactive confirm. */
    public static List<String> buildDeleteArgs(String id) {
        return new ArrayList<String>(Arrays.asList(
                "session", "delete", String.valueOf(id), "--force"));
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

    /** Merge CLI sessions with shared IDE-index sessions, de-duplicating by id. */
    public static List<SessionItem> mergeSessionItems(
            List<SessionItem> cliItems, List<SessionItem> ideItems) {
        LinkedHashMap<String, SessionItem> byId = new LinkedHashMap<String, SessionItem>();
        if (cliItems != null) {
            for (SessionItem s : cliItems) if (s != null && s.id != null && !s.id.isEmpty()) {
                byId.put(s.id, s);
            }
        }
        if (ideItems != null) {
            for (SessionItem s : ideItems) if (s != null && s.id != null && !s.id.isEmpty()) {
                SessionItem prev = byId.get(s.id);
                if (prev == null) {
                    byId.put(s.id, s);
                } else {
                    byId.put(s.id, new SessionItem(
                            s.id,
                            s.title != null && !s.title.isEmpty() ? s.title : prev.title,
                            newer(s.updatedAt, prev.updatedAt),
                            prev.store + "+" + s.store,
                            !s.status.isEmpty() ? s.status : prev.status,
                            !s.workspace.isEmpty() ? s.workspace : prev.workspace));
                }
            }
        }
        return new ArrayList<SessionItem>(byId.values());
    }

    /**
     * Chooser row:
     * {@code "<id>  ·  <store>[ · <status>][ · <updatedAt>][ · <title>][ · <workspace>]"} —
     * status/workspace ride along so cross-workspace sessions are searchable in
     * the popup's speed search.
     */
    public static String itemLabel(SessionItem s) {
        StringBuilder sb = new StringBuilder(s.id).append("  ·  ").append(s.store);
        if (!s.status.isEmpty()) sb.append(" · ").append(s.status);
        if (s.updatedAt != null && !s.updatedAt.isEmpty()) sb.append(" · ").append(s.updatedAt);
        if (s.title != null && !s.title.isEmpty()) sb.append(" · ").append(s.title);
        if (!s.workspace.isEmpty()) sb.append(" · ").append(s.workspace);
        return sb.toString();
    }

    private static String newer(String a, String b) {
        if (a == null || a.isEmpty()) return b;
        if (b == null || b.isEmpty()) return a;
        return a.compareTo(b) >= 0 ? a : b;
    }
}
