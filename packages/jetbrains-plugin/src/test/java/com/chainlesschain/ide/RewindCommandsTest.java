package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link RewindCommands} (/rewind checkpoint) layer. */
class RewindCommandsTest {

    @Test
    void buildListArgsScopesToSession() {
        assertEquals("checkpoint list -s s1 --json",
                String.join(" ", RewindCommands.buildListArgs("s1")));
    }

    @Test
    void buildListArgsDefaultsSessionWhenNull() {
        assertEquals("checkpoint list -s default --json",
                String.join(" ", RewindCommands.buildListArgs(null)));
    }

    @Test
    void buildRestoreArgsForcesAndScopes() {
        assertEquals("checkpoint restore cp-3 -s s1 --force --json",
                String.join(" ", RewindCommands.buildRestoreArgs("s1", "cp-3")));
    }

    @Test
    void parseCheckpointListDropsRowsWithoutId() {
        List<RewindCommands.Checkpoint> cps = RewindCommands.parseCheckpointList(
                "[{\"id\":\"cp-2\",\"createdAt\":\"2026-07-05\",\"label\":\"before edit\",\"fileCount\":3},"
                        + "{\"id\":\"cp-1\"},{\"label\":\"no id -> dropped\"}]");
        assertEquals(2, cps.size());
        assertEquals("cp-2", cps.get(0).id);
    }

    @Test
    void itemLabelIncludesFileCount() {
        List<RewindCommands.Checkpoint> cps = RewindCommands.parseCheckpointList(
                "[{\"id\":\"cp-2\",\"createdAt\":\"2026-07-05\",\"label\":\"before edit\",\"fileCount\":3},"
                        + "{\"id\":\"cp-1\"}]");
        assertTrue(RewindCommands.itemLabel(cps.get(0)).contains("3 file(s)"));
    }

    @Test
    void itemLabelForBareCheckpointIsIdOnly() {
        List<RewindCommands.Checkpoint> cps = RewindCommands.parseCheckpointList(
                "[{\"id\":\"cp-2\",\"createdAt\":\"2026-07-05\",\"label\":\"before edit\",\"fileCount\":3},"
                        + "{\"id\":\"cp-1\"}]");
        assertEquals("cp-1", RewindCommands.itemLabel(cps.get(1)));
    }

    @Test
    void parseCheckpointListToleratesBadInput() {
        assertTrue(RewindCommands.parseCheckpointList("not json").isEmpty());
        assertTrue(RewindCommands.parseCheckpointList("{\"a\":1}").isEmpty());
    }

    @Test
    void restoreOkReflectsJsonObject() {
        assertTrue(RewindCommands.restoreOk("{\"restoredCount\":2}"));
        assertFalse(RewindCommands.restoreOk("boom"));
    }

    @Test
    void restoredCountReadsPrimaryAndFallbackFields() {
        assertEquals(2, RewindCommands.restoredCount("{\"restoredCount\":2}").intValue());
        assertEquals(5, RewindCommands.restoredCount("{\"restored\":5}").intValue());
        assertNull(RewindCommands.restoredCount("{\"ok\":true}"));
    }

    @Test
    void buildShowDiffArgsRequestsDiff() {
        assertEquals("checkpoint show cp-3 --diff -s s1 --json",
                String.join(" ", RewindCommands.buildShowDiffArgs("s1", "cp-3")));
    }

    @Test
    void formatDiffPreviewTrimsRawPatch() {
        assertEquals("--- a\n+++ b",
                RewindCommands.formatDiffPreview("{\"id\":\"cp-3\",\"diff\":\"--- a\\n+++ b\\n\"}"));
    }

    @Test
    void formatDiffPreviewRendersStatusPayloadAndDropsEmptySections() {
        String status = RewindCommands.formatDiffPreview(
                "{\"modified\":[{\"rel\":\"a.js\"}],\"added\":[\"b.js\"],\"deleted\":[]}");
        assertTrue(status.contains("modified (1):") && status.contains("a.js"));
        assertTrue(status.contains("added (1):") && status.contains("b.js"));
        assertFalse(status.contains("deleted"));
    }

    @Test
    void formatDiffPreviewEmptyWhenNothingToShow() {
        assertEquals("", RewindCommands.formatDiffPreview("{}"));
        assertEquals("", RewindCommands.formatDiffPreview("not json"));
    }
}
