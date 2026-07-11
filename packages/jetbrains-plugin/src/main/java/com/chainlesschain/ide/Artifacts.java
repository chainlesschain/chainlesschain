package com.chainlesschain.ide;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Artifacts drawer core (gap #9) — browse the agent-published deliverable
 * store surfaced by {@code cc artifacts}:
 *
 * <ul>
 *   <li>{@code cc artifacts list --json} → {@code {"artifacts":[{id, title,
 *       kind, mime, size, sha256, sourcePath, file, sessionId, createdAt,
 *       expiresAt}, …]}} (metadata only — payloads live under
 *       {@code ~/.chainlesschain/artifacts/files/&lt;file&gt;});</li>
 *   <li>{@code cc artifacts show &lt;id&gt; --json} adds {@code storedPath};</li>
 *   <li>{@code cc artifacts remove &lt;id&gt; --json} deletes copy + row.</li>
 * </ul>
 *
 * This core parses the list JSON ({@link MiniJson} conventions — malformed
 * input yields an empty list, a corrupt row never poisons the drawer), shapes
 * rows for a table (human size, relative time via
 * {@link SessionsWorkbench#formatRelativeTime}), filters by query + kind,
 * classifies previewability by mime/extension and derives the per-row action
 * ids the glue maps to buttons. Pure JDK — no IntelliJ SDK, no process
 * spawning, no clock reads (callers pass {@code now}); JUnit + smoke tested.
 * The Swing glue lives in {@code intellij/ArtifactsAction}.
 */
public final class Artifacts {

    private Artifacts() {}

    /** Kinds the CLI store normalizes to (artifact-store.js ARTIFACT_KINDS). */
    public static final List<String> KINDS = List.of(
            "report", "patch", "screenshot", "log", "data", "other");

    // Preview classes (what "Open" means for a row).
    public static final String PREVIEW_TEXT = "text";
    public static final String PREVIEW_IMAGE = "image";
    public static final String PREVIEW_HTML = "html";
    public static final String PREVIEW_BINARY = "binary";

    // Action ids (the glue maps these to buttons).
    public static final String ACT_OPEN = "openInEditor";
    public static final String ACT_OPEN_EXTERNAL = "openExternal";
    public static final String ACT_REVEAL = "revealInFolder";
    public static final String ACT_COPY_PATH = "copyPath";
    public static final String ACT_REMOVE = "remove";

    /** One artifact metadata row (never the payload bytes). */
    public static final class Row {
        public final String id;
        public final String title;
        public final String kind;
        public final String mime;
        public final long size;
        public final String sha256;
        public final String sourcePath;
        /** Stored copy's file name under {@code <store>/files/}. */
        public final String file;
        public final String sessionId;
        /** Epoch ms; 0 when unknown. */
        public final long createdAt;
        /** Epoch ms; 0 when unknown. */
        public final long expiresAt;

        public Row(String id, String title, String kind, String mime, long size,
                String sha256, String sourcePath, String file, String sessionId,
                long createdAt, long expiresAt) {
            this.id = nz(id);
            this.title = nz(title);
            this.kind = nz(kind);
            this.mime = nz(mime);
            this.size = Math.max(0L, size);
            this.sha256 = nz(sha256);
            this.sourcePath = nz(sourcePath);
            this.file = nz(file);
            this.sessionId = nz(sessionId);
            this.createdAt = createdAt;
            this.expiresAt = expiresAt;
        }
    }

    // ------------------------------------------------------------- cc args

    public static List<String> buildListArgs() {
        return Arrays.asList("artifacts", "list", "--json");
    }

    public static List<String> buildShowArgs(String id) {
        return Arrays.asList("artifacts", "show", String.valueOf(id), "--json");
    }

    public static List<String> buildRemoveArgs(String id) {
        return Arrays.asList("artifacts", "remove", String.valueOf(id), "--json");
    }

    // --------------------------------------------------------------- parse

    /**
     * Rows from {@code cc artifacts list --json} stdout — accepts the
     * {@code {"artifacts":[…]}} envelope or a bare array; empty on malformed.
     * Rows without an id are skipped; result is newest-created first.
     */
    public static List<Row> parseList(String stdout) {
        List<Row> out = new ArrayList<Row>();
        Object parsed;
        try {
            parsed = MiniJson.parse(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return out;
        }
        Object arr = parsed;
        if (parsed instanceof Map) arr = ((Map<?, ?>) parsed).get("artifacts");
        if (!(arr instanceof List)) return out;
        for (Object o : (List<?>) arr) {
            if (!(o instanceof Map)) continue;
            Map<?, ?> m = (Map<?, ?>) o;
            String id = str(m.get("id"));
            if (id.isEmpty()) continue;
            out.add(new Row(id, str(m.get("title")), str(m.get("kind")),
                    str(m.get("mime")), num(m.get("size")), str(m.get("sha256")),
                    str(m.get("sourcePath")), str(m.get("file")),
                    str(m.get("sessionId")),
                    SessionsWorkbench.parseTimestamp(str(m.get("createdAt"))),
                    SessionsWorkbench.parseTimestamp(str(m.get("expiresAt")))));
        }
        out.sort(ROW_ORDER);
        return out;
    }

    /** Newest createdAt first; id breaks the tie deterministically. */
    public static final Comparator<Row> ROW_ORDER = new Comparator<Row>() {
        @Override
        public int compare(Row a, Row b) {
            int c = Long.compare(b.createdAt, a.createdAt);
            return c != 0 ? c : a.id.compareTo(b.id);
        }
    };

    // ------------------------------------------------------ previewability

    /**
     * Classify how "Open" should treat an artifact, by mime with an extension
     * fallback (older rows / octet-stream mime): {@link #PREVIEW_HTML} (open
     * in the external browser), {@link #PREVIEW_IMAGE} / {@link #PREVIEW_TEXT}
     * (IDE editor — it has an image viewer), else {@link #PREVIEW_BINARY}
     * (reveal/copy only).
     */
    public static String previewClass(String mime, String fileName) {
        String m = nz(mime).toLowerCase(Locale.ROOT);
        String ext = extOf(fileName);
        if (m.equals("text/html") || ext.equals("html") || ext.equals("htm")) {
            return PREVIEW_HTML;
        }
        if (m.startsWith("image/") || IMAGE_EXTS.contains(ext)) {
            return PREVIEW_IMAGE;
        }
        if (m.startsWith("text/") || TEXT_MIMES.contains(m) || TEXT_EXTS.contains(ext)) {
            return PREVIEW_TEXT;
        }
        return PREVIEW_BINARY;
    }

    private static final List<String> IMAGE_EXTS = List.of(
            "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico");
    private static final List<String> TEXT_MIMES = List.of(
            "application/json", "application/xml", "application/yaml",
            "application/javascript");
    private static final List<String> TEXT_EXTS = List.of(
            "md", "markdown", "txt", "log", "json", "csv", "xml", "yaml", "yml",
            "patch", "diff", "js", "ts", "java", "py");

    private static String extOf(String fileName) {
        String f = nz(fileName);
        int dot = f.lastIndexOf('.');
        return dot < 0 || dot == f.length() - 1
                ? "" : f.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    // ------------------------------------------------------------- actions

    /**
     * Action ids for a row: reveal/copy/remove always; text/image rows lead
     * with {@link #ACT_OPEN} (IDE editor / image viewer); html rows lead with
     * {@link #ACT_OPEN_EXTERNAL} (system browser); binary rows get no open.
     */
    public static List<String> actionsFor(Row r) {
        if (r == null) return List.of();
        String cls = previewClass(r.mime, r.file);
        List<String> out = new ArrayList<String>();
        if (PREVIEW_TEXT.equals(cls) || PREVIEW_IMAGE.equals(cls)) {
            out.add(ACT_OPEN);
        } else if (PREVIEW_HTML.equals(cls)) {
            out.add(ACT_OPEN_EXTERNAL);
        }
        out.add(ACT_REVEAL);
        out.add(ACT_COPY_PATH);
        out.add(ACT_REMOVE);
        return Collections.unmodifiableList(out);
    }

    // -------------------------------------------------------------- filter

    /**
     * Kind filter (exact, "" / null = all) + case-insensitive substring query
     * over title/id/kind/mime/sourcePath/sessionId. Blank query keeps all.
     */
    public static List<Row> filter(List<Row> rows, String query, String kind) {
        List<Row> out = new ArrayList<Row>();
        if (rows == null) return out;
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        String k = kind == null ? "" : kind.trim().toLowerCase(Locale.ROOT);
        for (Row r : rows) {
            if (r == null) continue;
            if (!k.isEmpty() && !r.kind.toLowerCase(Locale.ROOT).equals(k)) continue;
            if (q.isEmpty()
                    || r.title.toLowerCase(Locale.ROOT).contains(q)
                    || r.id.toLowerCase(Locale.ROOT).contains(q)
                    || r.kind.toLowerCase(Locale.ROOT).contains(q)
                    || r.mime.toLowerCase(Locale.ROOT).contains(q)
                    || r.sourcePath.toLowerCase(Locale.ROOT).contains(q)
                    || r.sessionId.toLowerCase(Locale.ROOT).contains(q)) {
                out.add(r);
            }
        }
        return out;
    }

    // --------------------------------------------------------------- paths

    /**
     * The artifact store directory the CLI uses: the {@code CC_ARTIFACTS_DIR}
     * override when set (same convention as artifact-store.js), else
     * {@code <home>/.chainlesschain/artifacts}. Inputs are injected so the
     * pure layer stays env-read free.
     */
    public static String defaultArtifactsDir(String envOverride, String home) {
        String env = nz(envOverride);
        if (!env.isEmpty()) return env;
        String h = nz(home);
        return h + (h.endsWith("/") || h.endsWith("\\") ? "" : java.io.File.separator)
                + ".chainlesschain" + java.io.File.separator + "artifacts";
    }

    /**
     * Absolute path of a row's stored copy under {@code <dir>/files/}; null
     * when the row carries no stored file name.
     */
    public static String storedPath(String artifactsDir, Row r) {
        if (r == null || r.file.isEmpty()) return null;
        String d = nz(artifactsDir);
        return d + (d.endsWith("/") || d.endsWith("\\") ? "" : java.io.File.separator)
                + "files" + java.io.File.separator + r.file;
    }

    // ------------------------------------------------------------- display

    /** Human-readable size: {@code 512 B}, {@code 1.5 KB}, {@code 2.0 MB}, … */
    public static String formatSize(long bytes) {
        long b = Math.max(0L, bytes);
        if (b < 1024) return b + " B";
        double v = b / 1024.0;
        String unit = "KB";
        if (v >= 1024) { v /= 1024; unit = "MB"; }
        if (v >= 1024) { v /= 1024; unit = "GB"; }
        return String.format(Locale.ROOT, "%.1f %s", v, unit);
    }

    /** Number of display columns produced by {@link #toColumns}. */
    public static final int COLUMN_COUNT = 5;

    /**
     * Shape one row into the table's display columns
     * {@code [title-or-id, kind, human size, mime, relative created]} — plain
     * text, metadata only (the payload is never read for listing).
     */
    public static String[] toColumns(Row r, long nowMs) {
        if (r == null) return new String[] { "", "", "", "", "" };
        return new String[] {
                r.title.isEmpty() ? r.id : r.title,
                r.kind,
                formatSize(r.size),
                r.mime,
                SessionsWorkbench.formatRelativeTime(nowMs, r.createdAt),
        };
    }

    /** Multi-line plain-text detail for the selected row (note line / tooltip). */
    public static String describe(Row r, long nowMs) {
        if (r == null) return "";
        StringBuilder sb = new StringBuilder();
        sb.append(r.id).append('\n');
        if (!r.title.isEmpty()) sb.append("title: ").append(r.title).append('\n');
        sb.append("kind: ").append(r.kind.isEmpty() ? "-" : r.kind)
                .append("  mime: ").append(r.mime.isEmpty() ? "-" : r.mime)
                .append("  size: ").append(formatSize(r.size))
                .append(" (").append(r.size).append(" B)").append('\n');
        if (!r.sha256.isEmpty()) sb.append("sha256: ").append(r.sha256).append('\n');
        if (!r.sourcePath.isEmpty()) sb.append("source: ").append(r.sourcePath).append('\n');
        if (!r.sessionId.isEmpty()) sb.append("session: ").append(r.sessionId).append('\n');
        String rel = SessionsWorkbench.formatRelativeTime(nowMs, r.createdAt);
        if (!rel.isEmpty()) sb.append("created: ").append(rel).append('\n');
        if (r.expiresAt > 0) {
            sb.append("expires: ").append(utcDate(r.expiresAt))
                    .append(r.expiresAt <= nowMs ? " (expired)" : "").append('\n');
        }
        sb.append("actions: ").append(String.join(", ", actionsFor(r)));
        return sb.toString();
    }

    private static String utcDate(long epochMs) {
        return LocalDate.ofInstant(Instant.ofEpochMilli(epochMs), ZoneOffset.UTC).toString();
    }

    // -------------------------------------------------------------- helpers

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String str(Object v) {
        if (v == null) return "";
        String s = String.valueOf(v).trim();
        return "null".equals(s) ? "" : s;
    }

    private static long num(Object v) {
        return v instanceof Number ? ((Number) v).longValue() : 0L;
    }
}
