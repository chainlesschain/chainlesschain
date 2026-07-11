package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link Artifacts} — the artifacts drawer core (gap #9): list JSON parsing
 * (incl. malformed), row shaping, filtering, previewability classification,
 * action derivation, size/time formatting and stored-path derivation.
 */
class ArtifactsTest {

    private static final long NOW = 1_800_000_000_000L;

    private static final String LIST_JSON = "{\"artifacts\":[" +
            "{\"id\":\"art_a\",\"title\":\"Review findings\",\"kind\":\"report\"," +
            "\"mime\":\"text/markdown\",\"size\":2048,\"sha256\":\"abc123\"," +
            "\"sourcePath\":\"C:/tmp/findings.md\",\"file\":\"art_a.md\"," +
            "\"sessionId\":\"s1\",\"createdAt\":\"2026-07-01T00:00:00.000Z\"," +
            "\"expiresAt\":\"2026-07-31T00:00:00.000Z\"}," +
            "{\"id\":\"art_b\",\"title\":\"UI screenshot\",\"kind\":\"screenshot\"," +
            "\"mime\":\"image/png\",\"size\":512,\"sha256\":\"def456\"," +
            "\"sourcePath\":\"C:/tmp/shot.png\",\"file\":\"art_b.png\"," +
            "\"sessionId\":null,\"createdAt\":\"2026-07-10T00:00:00.000Z\"," +
            "\"expiresAt\":\"2026-08-09T00:00:00.000Z\"}]}";

    // --------------------------------------------------------------- parsing

    @Test
    void parseListReadsAllFieldsAndSortsNewestFirst() {
        List<Artifacts.Row> rows = Artifacts.parseList(LIST_JSON);
        assertEquals(2, rows.size());
        // Newest createdAt first (the CLI store appends oldest-first).
        assertEquals("art_b", rows.get(0).id);
        Artifacts.Row a = rows.get(1);
        assertEquals("art_a", a.id);
        assertEquals("Review findings", a.title);
        assertEquals("report", a.kind);
        assertEquals("text/markdown", a.mime);
        assertEquals(2048L, a.size);
        assertEquals("abc123", a.sha256);
        assertEquals("C:/tmp/findings.md", a.sourcePath);
        assertEquals("art_a.md", a.file);
        assertEquals("s1", a.sessionId);
        assertTrue(a.createdAt > 0);
        assertTrue(a.expiresAt > a.createdAt);
        // JSON null sessionId normalizes to "".
        assertEquals("", rows.get(0).sessionId);
    }

    @Test
    void parseListToleratesMalformedAndOddShapes() {
        assertEquals(0, Artifacts.parseList("not json {{").size());
        assertEquals(0, Artifacts.parseList(null).size());
        assertEquals(0, Artifacts.parseList("").size());
        assertEquals(0, Artifacts.parseList("{}").size());
        assertEquals(0, Artifacts.parseList("{\"artifacts\":\"nope\"}").size());
        // Bare array accepted; rows without an id are skipped.
        List<Artifacts.Row> rows = Artifacts.parseList(
                "[{\"id\":\"x\",\"size\":1.5},{\"title\":\"no id\"},\"junk\"]");
        assertEquals(1, rows.size());
        assertEquals(1L, rows.get(0).size); // Double size truncates safely
    }

    // ---------------------------------------------------------------- filter

    @Test
    void filterByKindAndQuery() {
        List<Artifacts.Row> rows = Artifacts.parseList(LIST_JSON);
        assertEquals(1, Artifacts.filter(rows, "", "report").size());
        assertEquals(1, Artifacts.filter(rows, null, "screenshot").size());
        assertEquals(2, Artifacts.filter(rows, "", "").size());
        assertEquals(2, Artifacts.filter(rows, "", null).size());
        // query is case-insensitive over title/id/mime/sourcePath/session
        assertEquals(1, Artifacts.filter(rows, "FINDINGS", "").size());
        assertEquals(1, Artifacts.filter(rows, "art_b", "").size());
        assertEquals(1, Artifacts.filter(rows, "image/png", "").size());
        assertEquals(0, Artifacts.filter(rows, "zzz", "").size());
        // kind + query combine
        assertEquals(0, Artifacts.filter(rows, "findings", "screenshot").size());
        assertEquals(0, Artifacts.filter(null, "x", "y").size());
    }

    // -------------------------------------------------------- previewability

    @Test
    void previewClassByMimeThenExtension() {
        assertEquals(Artifacts.PREVIEW_TEXT, Artifacts.previewClass("text/markdown", "a.md"));
        assertEquals(Artifacts.PREVIEW_TEXT, Artifacts.previewClass("application/json", "a.json"));
        assertEquals(Artifacts.PREVIEW_IMAGE, Artifacts.previewClass("image/png", "a.png"));
        assertEquals(Artifacts.PREVIEW_IMAGE, Artifacts.previewClass("image/svg+xml", "a.svg"));
        assertEquals(Artifacts.PREVIEW_HTML, Artifacts.previewClass("text/html", "a.html"));
        assertEquals(Artifacts.PREVIEW_BINARY, Artifacts.previewClass("application/zip", "a.zip"));
        assertEquals(Artifacts.PREVIEW_BINARY, Artifacts.previewClass("application/pdf", "a.pdf"));
        // extension fallback when the mime is octet-stream/unknown
        assertEquals(Artifacts.PREVIEW_TEXT,
                Artifacts.previewClass("application/octet-stream", "run.log"));
        assertEquals(Artifacts.PREVIEW_HTML,
                Artifacts.previewClass("application/octet-stream", "page.htm"));
        assertEquals(Artifacts.PREVIEW_IMAGE,
                Artifacts.previewClass("application/octet-stream", "x.webp"));
        assertEquals(Artifacts.PREVIEW_BINARY, Artifacts.previewClass(null, null));
        assertEquals(Artifacts.PREVIEW_BINARY, Artifacts.previewClass("", "noext"));
    }

    // --------------------------------------------------------------- actions

    @Test
    void actionDerivationPerPreviewClass() {
        List<Artifacts.Row> rows = Artifacts.parseList(LIST_JSON);
        Artifacts.Row md = rows.get(1);
        assertEquals(List.of(Artifacts.ACT_OPEN, Artifacts.ACT_REVEAL,
                Artifacts.ACT_COPY_PATH, Artifacts.ACT_REMOVE), Artifacts.actionsFor(md));
        Artifacts.Row png = rows.get(0);
        assertTrue(Artifacts.actionsFor(png).contains(Artifacts.ACT_OPEN));

        Artifacts.Row html = new Artifacts.Row("h", "t", "report", "text/html", 1,
                "", "", "h.html", "", NOW, 0);
        List<String> acts = Artifacts.actionsFor(html);
        assertTrue(acts.contains(Artifacts.ACT_OPEN_EXTERNAL));
        assertFalse(acts.contains(Artifacts.ACT_OPEN));

        Artifacts.Row zip = new Artifacts.Row("z", "t", "data", "application/zip", 1,
                "", "", "z.zip", "", NOW, 0);
        assertEquals(List.of(Artifacts.ACT_REVEAL, Artifacts.ACT_COPY_PATH,
                Artifacts.ACT_REMOVE), Artifacts.actionsFor(zip));

        assertEquals(0, Artifacts.actionsFor(null).size());
    }

    // --------------------------------------------------------------- display

    @Test
    void formatSizeHuman() {
        assertEquals("0 B", Artifacts.formatSize(0));
        assertEquals("0 B", Artifacts.formatSize(-5));
        assertEquals("512 B", Artifacts.formatSize(512));
        assertEquals("1.0 KB", Artifacts.formatSize(1024));
        assertEquals("1.5 KB", Artifacts.formatSize(1536));
        assertEquals("5.0 MB", Artifacts.formatSize(5L * 1024 * 1024));
        assertEquals("2.0 GB", Artifacts.formatSize(2L * 1024 * 1024 * 1024));
    }

    @Test
    void toColumnsShapesMetadataOnly() {
        Artifacts.Row r = Artifacts.parseList(LIST_JSON).get(1);
        String[] cols = Artifacts.toColumns(r, r.createdAt + 5 * 60_000L);
        assertEquals(Artifacts.COLUMN_COUNT, cols.length);
        assertEquals("Review findings", cols[0]);
        assertEquals("report", cols[1]);
        assertEquals("2.0 KB", cols[2]);
        assertEquals("text/markdown", cols[3]);
        assertEquals("5m ago", cols[4]);
        // untitled row falls back to id; null row yields blanks, no throw
        Artifacts.Row untitled = new Artifacts.Row("art_x", "", "log", "text/plain",
                1, "", "", "art_x.log", "", 0, 0);
        assertEquals("art_x", Artifacts.toColumns(untitled, NOW)[0]);
        assertEquals(Artifacts.COLUMN_COUNT, Artifacts.toColumns(null, NOW).length);
    }

    @Test
    void describeCarriesDetailAndExpiry() {
        Artifacts.Row r = Artifacts.parseList(LIST_JSON).get(1);
        String d = Artifacts.describe(r, r.createdAt + 60_000L);
        assertTrue(d.contains("art_a"));
        assertTrue(d.contains("sha256: abc123"));
        assertTrue(d.contains("session: s1"));
        assertTrue(d.contains("expires: 2026-07-31"));
        assertFalse(d.contains("(expired)"));
        String expired = Artifacts.describe(r, r.expiresAt + 1);
        assertTrue(expired.contains("(expired)"));
        assertEquals("", Artifacts.describe(null, NOW));
    }

    // ----------------------------------------------------------------- paths

    @Test
    void storedPathAndDefaultDir() {
        Artifacts.Row r = Artifacts.parseList(LIST_JSON).get(1);
        String dir = Artifacts.defaultArtifactsDir(null, "C:\\Users\\u");
        assertTrue(dir.endsWith(".chainlesschain" + java.io.File.separator + "artifacts"));
        assertEquals("C:\\custom", Artifacts.defaultArtifactsDir("C:\\custom", "C:\\Users\\u"));
        String path = Artifacts.storedPath(dir, r);
        assertTrue(path.endsWith("files" + java.io.File.separator + "art_a.md"));
        assertNull(Artifacts.storedPath(dir, null));
        assertNull(Artifacts.storedPath(dir,
                new Artifacts.Row("x", "", "", "", 0, "", "", "", "", 0, 0)));
    }

    // ------------------------------------------------------------------ args

    @Test
    void ccArgsMatchTheCliSurface() {
        assertEquals(List.of("artifacts", "list", "--json"), Artifacts.buildListArgs());
        assertEquals(List.of("artifacts", "show", "art_a", "--json"),
                Artifacts.buildShowArgs("art_a"));
        assertEquals(List.of("artifacts", "remove", "art_a", "--json"),
                Artifacts.buildRemoveArgs("art_a"));
    }
}
