package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link RewindCommands} (/rewind checkpoint) layer. */
class RewindCommandsTest {

    private static Path timelineFixturePath() {
        for (String root : new String[] {
                "../vscode-extension", "packages/vscode-extension",
                "../../packages/vscode-extension" }) {
            Path candidate = Paths.get(
                    root, "src", "__fixtures__", "checkpoint-timeline", "cases.json");
            if (Files.isRegularFile(candidate)) return candidate;
        }
        throw new AssertionError("shared checkpoint timeline fixture not found; cwd="
                + Paths.get("").toAbsolutePath());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> timelineFixture() {
        try {
            return (Map<String, Object>) MiniJson.parse(Files.readString(
                    timelineFixturePath(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new AssertionError("cannot read checkpoint timeline fixture", e);
        }
    }

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

    @Test
    void buildTimelineArgsRequestsCanonicalSessionProjection() {
        assertEquals("checkpoint timeline -s session-fixture --json",
                String.join(" ", RewindCommands.buildTimelineArgs("session-fixture")));
        assertEquals("checkpoint timeline -s default --json",
                String.join(" ", RewindCommands.buildTimelineArgs(null)));
    }

    @Test
    @SuppressWarnings("unchecked")
    void timelineMatchesTheSharedCliAndVsCodeProjection() {
        Map<String, Object> fixture = timelineFixture();
        RewindCommands.TimelineProjection timeline =
                RewindCommands.parseTimelineProjection(fixture.get("projection"));
        assertNotNull(timeline);
        assertEquals(fixture.get("hostProjection"), timeline.hostProjection());

        Map<String, Object> projection = (Map<String, Object>) fixture.get("projection");
        List<Object> entries = (List<Object>) projection.get("entries");
        Map<String, Object> second = (Map<String, Object>) entries.get(1);
        List<Object> actions = (List<Object>) second.get("actions");
        Map<String, Object> expected =
                (Map<String, Object>) ((Map<String, Object>) actions.get(5)).get("submission");
        assertEquals(expected, timeline.actionSubmission("turn-2", "branch"));
        assertNull(timeline.actionSubmission("turn-3", "restore-code"));
        assertEquals("timeline-fixture-r1", timeline.revision);

        List<String> previewArgs = RewindCommands.buildTimelineActionArgs(
                timeline.actionSubmission("turn-2", "branch"), true, false);
        assertEquals("checkpoint", previewArgs.get(0));
        assertTrue(previewArgs.contains("--preview"));
        assertEquals(expected, MiniJson.parse(previewArgs.get(5)));
    }

    @Test
    @SuppressWarnings("unchecked")
    void timelineFailsClosedForUnsupportedOrTamperedContracts() {
        Map<String, Object> fixture = timelineFixture();
        Map<String, Object> projection =
                (Map<String, Object>) fixture.get("projection");
        Map<String, Object> unsupported =
                new LinkedHashMap<String, Object>(projection);
        unsupported.put("version", Long.valueOf(2));
        assertNull(RewindCommands.parseTimelineProjection(unsupported));

        Map<String, Object> tampered = (Map<String, Object>) MiniJson.parse(
                MiniJson.stringify(projection));
        List<Object> entries = (List<Object>) tampered.get("entries");
        Map<String, Object> first = (Map<String, Object>) entries.get(0);
        List<Object> actions = (List<Object>) first.get("actions");
        Map<String, Object> restoreCode = (Map<String, Object>) actions.get(0);
        ((Map<String, Object>) restoreCode.get("submission"))
                .put("turnId", "another-turn");

        RewindCommands.TimelineProjection timeline =
                RewindCommands.parseTimelineProjection(tampered);
        assertNotNull(timeline);
        assertNull(timeline.actionSubmission("turn-1", "restore-code"));
        assertFalse(timeline.entries.get(0).enabledActions.contains("restore-code"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void timelineBuildsVisualRowsAndRendersTheSharedPreview() {
        Map<String, Object> fixture = timelineFixture();
        RewindCommands.TimelineProjection timeline =
                RewindCommands.parseTimelineProjection(fixture.get("projection"));
        assertNotNull(timeline);
        String row = RewindCommands.timelineEntryLabel(timeline.entries.get(1));
        assertTrue(row.contains("partial"));
        assertTrue(row.contains("artifact"));
        assertEquals("Restore code + conversation",
                RewindCommands.timelineActionLabel("restore-both"));

        String rawPreview = MiniJson.stringify(fixture.get("actionPreview"));
        Map<String, Object> preview =
                RewindCommands.parseTimelineActionResult(rawPreview);
        assertEquals(fixture.get("actionPreview"), preview);
        String text = RewindCommands.formatTimelinePreview(preview);
        assertTrue(text.contains("restore-both"));
        assertTrue(text.contains("partial"));
        assertTrue(text.contains("vendor/cache"));
        assertTrue(text.contains("bundle.zip"));

        Map<String, Object> invalid = new LinkedHashMap<String, Object>(preview);
        invalid.put("version", Long.valueOf(2));
        assertNull(RewindCommands.parseTimelineActionResult(MiniJson.stringify(invalid)));
    }
}
