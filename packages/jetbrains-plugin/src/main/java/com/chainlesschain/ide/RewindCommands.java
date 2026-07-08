package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Panel {@code /rewind} (checkpoint restore) — the Java twin of the VS Code
 * extension's rewind-commands.js. Rather than re-implement the shadow-commit
 * engine, this defers to the CLI's source of truth — {@code cc checkpoint
 * list|restore} — scoped to the panel's session (mirroring how /cost and
 * /sessions defer to the CLI). Pure arg builders + tolerant stdout parsers;
 * the glue drives {@code AgentChatSession.runCapture} + a chooser around them.
 */
public final class RewindCommands {

    private RewindCommands() {}

    /** One checkpoint row from {@code cc checkpoint list --json}. */
    public static final class Checkpoint {
        public final String id;
        public final String createdAt; // nullable
        public final String label;     // nullable
        public final Long fileCount;   // nullable

        Checkpoint(String id, String createdAt, String label, Long fileCount) {
            this.id = id;
            this.createdAt = createdAt;
            this.label = label;
            this.fileCount = fileCount;
        }
    }

    /** {@code cc checkpoint list -s <session> --json} — newest-first snapshots. */
    public static List<String> buildListArgs(String sessionId) {
        return new ArrayList<String>(Arrays.asList(
                "checkpoint", "list", "-s", orDefault(sessionId), "--json"));
    }

    /**
     * {@code cc checkpoint restore <id> -s <session> --force --json} —
     * auto-snapshots the current state first, then restores. {@code --force}
     * skips the CLI's own interactive confirm because the panel confirms via
     * its chooser selection.
     */
    public static List<String> buildRestoreArgs(String sessionId, String id) {
        return new ArrayList<String>(Arrays.asList(
                "checkpoint", "restore", id == null ? "" : id,
                "-s", orDefault(sessionId), "--force", "--json"));
    }

    /**
     * {@code cc checkpoint show <id> --diff -s <session> --json} — the
     * checkpoint's diff vs the current work tree, for a PREVIEW before
     * restoring (the old flow restored on pick with no way to see what changes).
     */
    public static List<String> buildShowDiffArgs(String sessionId, String id) {
        return new ArrayList<String>(Arrays.asList(
                "checkpoint", "show", id == null ? "" : id,
                "--diff", "-s", orDefault(sessionId), "--json"));
    }

    /**
     * Normalize {@code checkpoint show --diff --json} stdout into preview text.
     * The git engine returns {@code { id, diff:"<patch>" }}; the copy-fallback
     * engine has no raw patch and returns a status object
     * {@code { modified, added, deleted }} — both become a readable string.
     * Returns "" when there's nothing to show or the stdout is unusable.
     */
    @SuppressWarnings("unchecked")
    public static String formatDiffPreview(String stdout) {
        Object parsed;
        try {
            parsed = MiniJson.parse(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return "";
        }
        if (!(parsed instanceof Map)) return "";
        Map<String, Object> data = (Map<String, Object>) parsed;
        Object diff = data.get("diff");
        if (diff instanceof String) return ((String) diff).trim();
        StringBuilder sb = new StringBuilder();
        appendList(sb, "modified", data.get("modified"));
        appendList(sb, "added", data.get("added"));
        appendList(sb, "deleted", data.get("deleted"));
        return sb.toString().trim();
    }

    private static void appendList(StringBuilder sb, String label, Object arr) {
        if (!(arr instanceof List) || ((List<?>) arr).isEmpty()) return;
        List<?> list = (List<?>) arr;
        if (sb.length() > 0) sb.append("\n\n");
        sb.append(label).append(" (").append(list.size()).append("):\n");
        for (Object f : list) {
            String rel = f instanceof Map && ((Map<?, ?>) f).get("rel") != null
                    ? String.valueOf(((Map<?, ?>) f).get("rel")) : String.valueOf(f);
            sb.append("  ").append(rel).append("\n");
        }
    }

    /** Tolerant parse of {@code checkpoint list --json} stdout (empty on any mismatch). */
    public static List<Checkpoint> parseCheckpointList(String stdout) {
        List<Checkpoint> out = new ArrayList<Checkpoint>();
        Object parsed;
        try {
            parsed = MiniJson.parse(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return out;
        }
        if (!(parsed instanceof List)) return out;
        for (Object row : (List<?>) parsed) {
            if (!(row instanceof Map)) continue;
            Map<?, ?> c = (Map<?, ?>) row;
            Object id = c.get("id");
            if (!(id instanceof String) || ((String) id).isEmpty()) continue;
            Object created = c.get("createdAt");
            Object label = c.get("label");
            Object files = c.get("fileCount");
            out.add(new Checkpoint(
                    (String) id,
                    created instanceof String ? (String) created : null,
                    label instanceof String ? (String) label : null,
                    files instanceof Number ? Long.valueOf(((Number) files).longValue()) : null));
        }
        return out;
    }

    /** Chooser row: {@code "<id>  ·  <createdAt>  ·  N file(s)  ·  <label>"} (parts optional). */
    public static String itemLabel(Checkpoint c) {
        StringBuilder sb = new StringBuilder(c.id);
        if (c.createdAt != null && !c.createdAt.isEmpty()) sb.append("  ·  ").append(c.createdAt);
        if (c.fileCount != null) sb.append("  ·  ").append(c.fileCount).append(" file(s)");
        if (c.label != null && !c.label.isEmpty()) sb.append("  ·  ").append(c.label);
        return sb.toString();
    }

    /** Did {@code checkpoint restore --json} succeed? (stdout parses as a JSON object) */
    public static boolean restoreOk(String stdout) {
        try {
            MiniJson.parseObject(stdout == null ? "" : stdout.trim());
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Restored-file count from {@code checkpoint restore --json} stdout (null when absent). */
    public static Integer restoredCount(String stdout) {
        Map<String, Object> data;
        try {
            data = MiniJson.parseObject(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return null;
        }
        Object n = data.get("restoredCount");
        if (n == null) n = data.get("restored");
        return n instanceof Number ? Integer.valueOf(((Number) n).intValue()) : null;
    }

    private static String orDefault(String sessionId) {
        return sessionId == null || sessionId.isEmpty() ? "default" : sessionId;
    }
}
