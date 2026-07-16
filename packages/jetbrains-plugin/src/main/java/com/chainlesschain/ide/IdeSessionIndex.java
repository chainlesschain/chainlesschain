package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Shared IDE session index.
 *
 * VS Code and JetBrains both write ~/.chainlesschain/ide/session-index.json so
 * either IDE can discover and resume sessions created by the other. Only
 * metadata is stored here; the transcript remains in the CLI session store.
 */
public final class IdeSessionIndex {
    private IdeSessionIndex() {}

    public static final int MAX_RECORDS = 200;

    // Every mutation is a read-merge-write of the whole file; two writers
    // interleaving lose one of the updates. In-process: one monitor. Cross-
    // process (VS Code writes the same file): an OS lock on a sibling .lock
    // file — best-effort, a lock failure NEVER drops the write (fail open;
    // losing exclusion beats losing the upsert).
    private static final Object IO_LOCK = new Object();
    private static final java.util.concurrent.atomic.AtomicLong TMP_SEQ =
            new java.util.concurrent.atomic.AtomicLong();

    private interface IoMutation {
        void run() throws IOException;
    }

    private static void locked(Path file, IoMutation body) throws IOException {
        synchronized (IO_LOCK) {
            java.nio.channels.FileChannel ch = null;
            java.nio.channels.FileLock lock = null;
            try {
                Files.createDirectories(file.getParent());
                ch = java.nio.channels.FileChannel.open(
                        file.resolveSibling(file.getFileName().toString() + ".lock"),
                        java.nio.file.StandardOpenOption.CREATE,
                        java.nio.file.StandardOpenOption.WRITE);
                lock = ch.lock();
            } catch (Exception ignored) {
                // fail open — cross-process exclusion is best-effort
            }
            try {
                body.run();
            } finally {
                try {
                    if (lock != null) lock.release();
                } catch (Exception ignored) {
                    // already released / channel closed
                }
                try {
                    if (ch != null) ch.close();
                } catch (Exception ignored) {
                    // already closed
                }
            }
        }
    }

    public static Path defaultFile() {
        return Paths.get(System.getProperty("user.home"),
                ".chainlesschain", "ide", "session-index.json");
    }

    public static Map<String, Object> record(String id, String title, String ide,
            String conversationId, String workspace, List<String> workspaceFolders,
            String status, String mode, Instant updatedAt) {
        Map<String, Object> r = new LinkedHashMap<String, Object>();
        r.put("id", clean(id));
        r.put("title", clean(title));
        r.put("ide", clean(ide).isEmpty() ? "unknown" : clean(ide));
        r.put("conversationId", clean(conversationId));
        r.put("workspace", clean(workspace));
        r.put("workspaceFolders", workspaceFolders == null
                ? new ArrayList<String>() : new ArrayList<String>(workspaceFolders));
        r.put("status", cleanStatus(status));
        r.put("mode", clean(mode).isEmpty() ? "default" : clean(mode));
        r.put("updatedAt", String.valueOf(updatedAt != null ? updatedAt : Instant.now()));
        return r;
    }

    public static boolean upsertDefault(Map<String, Object> record) {
        try {
            upsert(defaultFile(), record);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    public static void upsert(Path file, Map<String, Object> record) throws IOException {
        locked(file, () -> {
            List<Map<String, Object>> merged =
                    merge(read(file), record, Instant.now(), MAX_RECORDS);
            write(file, merged);
        });
    }

    public static boolean renameDefault(String id, String title) {
        try {
            return rename(defaultFile(), id, title);
        } catch (IOException e) {
            return false;
        }
    }

    /**
     * Rename a session in the shared index. For sessions the index has never
     * seen (CLI-only sessions) a minimal overlay record is created — the picker
     * merge prefers the IDE-index title, so the rename shows up for those too.
     */
    public static boolean rename(Path file, String id, String title) throws IOException {
        String key = clean(id);
        String next = clean(title);
        if (key.isEmpty() || next.isEmpty()) return false;
        locked(file, () -> {
            List<Map<String, Object>> rows = read(file);
            Map<String, Object> match = null;
            for (Map<String, Object> row : rows) {
                if (key.equals(row.get("id"))) match = row;
            }
            if (match == null) {
                match = new LinkedHashMap<String, Object>();
                match.put("id", key);
                match = normalize(match, Instant.now());
                rows.add(match);
            }
            match.put("title", next);
            match.put("updatedAt", String.valueOf(Instant.now()));
            write(file, rows);
        });
        return true;
    }

    public static boolean removeDefault(String id) {
        try {
            return remove(defaultFile(), id);
        } catch (IOException e) {
            return false;
        }
    }

    /** Drop a session from the shared index. Returns whether anything was removed. */
    public static boolean remove(Path file, String id) throws IOException {
        String key = clean(id);
        if (key.isEmpty()) return false;
        boolean[] removed = new boolean[1];
        locked(file, () -> {
            List<Map<String, Object>> rows = read(file);
            for (java.util.Iterator<Map<String, Object>> it = rows.iterator(); it.hasNext();) {
                if (key.equals(it.next().get("id"))) {
                    it.remove();
                    removed[0] = true;
                }
            }
            if (removed[0]) write(file, rows);
        });
        return removed[0];
    }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> read(Path file) {
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        String raw;
        try {
            raw = new String(Files.readAllBytes(file), StandardCharsets.UTF_8).trim();
        } catch (IOException e) {
            return out;
        }
        Object parsed;
        try {
            parsed = MiniJson.parse(raw);
        } catch (RuntimeException e) {
            return out;
        }
        Object rows = parsed instanceof Map ? ((Map<?, ?>) parsed).get("sessions") : parsed;
        if (!(rows instanceof List)) return out;
        for (Object row : (List<?>) rows) {
            if (!(row instanceof Map)) continue;
            Map<String, Object> normalized =
                    normalize((Map<String, Object>) row, Instant.now());
            if (normalized != null) out.add(normalized);
        }
        return out;
    }

    public static List<Map<String, Object>> merge(List<Map<String, Object>> existing,
            Map<String, Object> incoming, Instant now, int limit) {
        Map<String, Map<String, Object>> byId =
                new LinkedHashMap<String, Map<String, Object>>();
        if (existing != null) {
            for (Map<String, Object> row : existing) {
                Map<String, Object> n = normalize(row, now);
                if (n != null) byId.put(String.valueOf(n.get("id")), n);
            }
        }
        Map<String, Object> next = normalize(incoming, now);
        if (next != null) {
            String id = String.valueOf(next.get("id"));
            Map<String, Object> prev = byId.get(id);
            if (prev != null) {
                next.put("createdAt", prev.get("createdAt"));
                if (clean(String.valueOf(next.get("title"))).isEmpty()) {
                    next.put("title", prev.get("title"));
                }
                if (clean(String.valueOf(next.get("workspace"))).isEmpty()) {
                    next.put("workspace", prev.get("workspace"));
                }
            }
            byId.put(id, next);
        }
        List<Map<String, Object>> rows =
                new ArrayList<Map<String, Object>>(byId.values());
        Collections.sort(rows, new Comparator<Map<String, Object>>() {
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                return String.valueOf(b.get("updatedAt"))
                        .compareTo(String.valueOf(a.get("updatedAt")));
            }
        });
        if (rows.size() > limit) return new ArrayList<Map<String, Object>>(rows.subList(0, limit));
        return rows;
    }

    public static void write(Path file, List<Map<String, Object>> sessions) throws IOException {
        Files.createDirectories(file.getParent());
        Map<String, Object> root = new LinkedHashMap<String, Object>();
        root.put("version", 1L);
        root.put("sessions", sessions == null
                ? new ArrayList<Map<String, Object>>() : sessions);
        // Unique per write: two same-millisecond writers used to collide on the
        // tmp name — the second Files.move failed and its upsert vanished.
        Path tmp = file.resolveSibling(file.getFileName().toString()
                + "." + System.nanoTime() + "-" + TMP_SEQ.incrementAndGet() + ".tmp");
        Files.write(tmp, MiniJson.stringify(root).getBytes(StandardCharsets.UTF_8));
        try {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    public static List<SessionList.SessionItem> sessionItems(Path file) {
        List<SessionList.SessionItem> out = new ArrayList<SessionList.SessionItem>();
        for (Map<String, Object> row : read(file)) {
            String id = clean(String.valueOf(row.get("id")));
            if (id.isEmpty()) continue;
            String ide = clean(String.valueOf(row.get("ide")));
            out.add(new SessionList.SessionItem(
                    id,
                    clean(String.valueOf(row.get("title"))),
                    clean(String.valueOf(row.get("updatedAt"))),
                    "ide:" + (ide.isEmpty() ? "unknown" : ide),
                    clean(String.valueOf(row.get("status"))),
                    clean(String.valueOf(row.get("workspace")))));
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> normalize(Map<String, Object> row, Instant now) {
        if (row == null) return null;
        String id = clean(String.valueOf(first(row.get("id"), row.get("sessionId"))));
        if (id.isEmpty()) return null;
        String updatedAt = iso(row.get("updatedAt"), now);
        String createdAt = iso(row.get("createdAt"), Instant.parse(updatedAt));
        List<String> folders = new ArrayList<String>();
        Object rawFolders = row.get("workspaceFolders");
        if (rawFolders instanceof List) {
            for (Object v : (List<Object>) rawFolders) {
                String s = clean(String.valueOf(v));
                if (!s.isEmpty() && folders.size() < 8) folders.add(s);
            }
        }
        String workspace = clean(String.valueOf(row.get("workspace")));
        if (workspace.isEmpty() && !folders.isEmpty()) workspace = folders.get(0);

        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("id", id);
        out.put("title", clean(String.valueOf(row.get("title"))));
        out.put("ide", clean(String.valueOf(row.get("ide"))).isEmpty()
                ? "unknown" : clean(String.valueOf(row.get("ide"))));
        out.put("conversationId", clean(String.valueOf(row.get("conversationId"))));
        out.put("workspace", workspace);
        out.put("workspaceFolders", folders);
        out.put("status", cleanStatus(String.valueOf(row.get("status"))));
        out.put("mode", clean(String.valueOf(row.get("mode"))).isEmpty()
                ? "default" : clean(String.valueOf(row.get("mode"))));
        out.put("createdAt", createdAt);
        out.put("updatedAt", updatedAt);
        return out;
    }

    private static Object first(Object a, Object b) {
        return a != null ? a : b;
    }

    private static String clean(String s) {
        return s == null || "null".equals(s) ? "" : s.trim();
    }

    private static String cleanStatus(String s) {
        String v = clean(s).toLowerCase().replace(' ', '_');
        if ("running".equals(v) || "waiting_approval".equals(v)
                || "errored".equals(v) || "stopped".equals(v)
                || "completed".equals(v)) return v;
        return "stopped";
    }

    private static String iso(Object raw, Instant fallback) {
        if (raw instanceof String) {
            try {
                return String.valueOf(Instant.parse((String) raw));
            } catch (RuntimeException ignored) {
                // fall through
            }
        }
        return String.valueOf(fallback != null ? fallback : Instant.now());
    }
}
