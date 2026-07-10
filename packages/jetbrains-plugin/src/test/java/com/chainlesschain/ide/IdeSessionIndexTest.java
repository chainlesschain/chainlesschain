package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class IdeSessionIndexTest {
    @Test
    void upsertsSharedSessionMetadata() throws Exception {
        Path dir = Files.createTempDirectory("cc-ide-index");
        Path file = dir.resolve("session-index.json");

        IdeSessionIndex.upsert(file, IdeSessionIndex.record(
                "s1", "Old", "jetbrains", "conv-1", "/repo",
                Arrays.asList("/repo"), "stopped", "default",
                Instant.parse("2026-07-09T00:00:00Z")));
        IdeSessionIndex.upsert(file, IdeSessionIndex.record(
                "s1", "New", "jetbrains", "conv-1", "/repo",
                Arrays.asList("/repo"), "waiting approval", "acceptEdits",
                Instant.parse("2026-07-10T00:00:00Z")));

        List<Map<String, Object>> rows = IdeSessionIndex.read(file);
        assertEquals(1, rows.size());
        assertEquals("s1", rows.get(0).get("id"));
        assertEquals("New", rows.get(0).get("title"));
        assertEquals("waiting_approval", rows.get(0).get("status"));
    }

    @Test
    void renamesIndexedSessionsAndOverlaysCliOnlySessions() throws Exception {
        Path dir = Files.createTempDirectory("cc-ide-index");
        Path file = dir.resolve("session-index.json");

        IdeSessionIndex.upsert(file, IdeSessionIndex.record(
                "s1", "Old", "jetbrains", "conv-1", "/repo",
                Arrays.asList("/repo"), "running", "acceptEdits",
                Instant.parse("2026-07-09T00:00:00Z")));

        assertTrue(IdeSessionIndex.rename(file, "s1", "Renamed"));
        Map<String, Object> row = IdeSessionIndex.read(file).get(0);
        // Rename keeps the record's other metadata intact.
        assertEquals("Renamed", row.get("title"));
        assertEquals("running", row.get("status"));
        assertEquals("acceptEdits", row.get("mode"));

        // CLI-only session (never indexed): rename creates a title overlay.
        assertTrue(IdeSessionIndex.rename(file, "cli-only", "Titled from IDE"));
        boolean found = false;
        for (Map<String, Object> r : IdeSessionIndex.read(file)) {
            if ("cli-only".equals(r.get("id"))) {
                assertEquals("Titled from IDE", r.get("title"));
                found = true;
            }
        }
        assertTrue(found);

        // Blank ids/titles are rejected, not written.
        assertFalse(IdeSessionIndex.rename(file, "s1", "   "));
        assertFalse(IdeSessionIndex.rename(file, "", "x"));
    }

    @Test
    void removesSessionsAndReportsMisses() throws Exception {
        Path dir = Files.createTempDirectory("cc-ide-index");
        Path file = dir.resolve("session-index.json");

        IdeSessionIndex.upsert(file, IdeSessionIndex.record(
                "s1", "", "jetbrains", "", "", null, "stopped", "default",
                Instant.parse("2026-07-09T00:00:00Z")));
        IdeSessionIndex.upsert(file, IdeSessionIndex.record(
                "s2", "", "vscode", "", "", null, "stopped", "default",
                Instant.parse("2026-07-10T00:00:00Z")));

        assertTrue(IdeSessionIndex.remove(file, "s1"));
        List<Map<String, Object>> rows = IdeSessionIndex.read(file);
        assertEquals(1, rows.size());
        assertEquals("s2", rows.get(0).get("id"));
        assertFalse(IdeSessionIndex.remove(file, "s1"));
        assertFalse(IdeSessionIndex.remove(file, "missing"));
    }

    @Test
    void deleteArgsForceSkipTheInteractiveConfirm() {
        assertEquals(Arrays.asList("session", "delete", "s1", "--force"),
                SessionList.buildDeleteArgs("s1"));
    }

    @Test
    void itemLabelCarriesStatusAndWorkspaceForSearch() {
        SessionList.SessionItem item = new SessionList.SessionItem(
                "s1", "Fix tests", "2026-07-10", "ide:vscode",
                "waiting_approval", "C:/repo");
        String label = SessionList.itemLabel(item);
        assertTrue(label.contains("waiting_approval"));
        assertTrue(label.contains("C:/repo"));
        assertTrue(label.contains("Fix tests"));
        // 4-arg CLI rows carry no status/workspace and label stays compact.
        String cli = SessionList.itemLabel(new SessionList.SessionItem(
                "s2", "", "2026-07-09", "agent"));
        assertEquals("s2  ·  agent · 2026-07-09", cli);
    }

    @Test
    void mergePrefersIdeStatusAndWorkspace() {
        List<SessionList.SessionItem> merged = SessionList.mergeSessionItems(
                Arrays.asList(new SessionList.SessionItem(
                        "s1", "CLI", "2026-07-09", "agent")),
                Arrays.asList(new SessionList.SessionItem(
                        "s1", "", "2026-07-10", "ide:jetbrains",
                        "running", "/repo")));
        assertEquals(1, merged.size());
        assertEquals("running", merged.get(0).status);
        assertEquals("/repo", merged.get(0).workspace);
    }

    @Test
    void sessionListMergesCliAndIdeIndexRows() {
        List<SessionList.SessionItem> merged = SessionList.mergeSessionItems(
                Arrays.asList(new SessionList.SessionItem(
                        "s1", "CLI", "2026-07-09", "agent")),
                Arrays.asList(
                        new SessionList.SessionItem(
                                "s1", "IDE", "2026-07-10", "ide:jetbrains"),
                        new SessionList.SessionItem(
                                "s2", "Other", "2026-07-08", "ide:vscode")));

        assertEquals(2, merged.size());
        assertEquals("s1", merged.get(0).id);
        assertEquals("IDE", merged.get(0).title);
        assertEquals("agent+ide:jetbrains", merged.get(0).store);
        assertEquals("s2", merged.get(1).id);
    }
}
