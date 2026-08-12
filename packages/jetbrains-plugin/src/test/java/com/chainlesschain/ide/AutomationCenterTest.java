package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AutomationCenterTest {

    private static String repeat(String value, int count) {
        return value.repeat(count);
    }

    private static String fixture(String itemRevision, String catalogRevision) {
        String revision = "sha256:" + itemRevision;
        Map<String, Object> root = MiniJson.obj();
        root.put("schema", AutomationCenter.SCHEMA);
        root.put("schemaVersion", AutomationCenter.SCHEMA_VERSION);
        root.put("authority", "cli");
        root.put("connected", true);
        root.put("revision", "sha256:" + repeat("a", 64));
        root.put("routineCatalogRevision", catalogRevision);
        root.put("summary", Map.of(
                "total", 1, "flows", 0, "routines", 1,
                "active", 1, "paused", 0, "needsAttention", 0));
        root.put("mutations", Map.of("createRoutine", Map.of(
                "available", true,
                "preview", Map.of(
                        "executor", "cli", "mutates", true, "stdin", "json",
                        "argv", List.of("automation", "center-routine-create",
                                "--expected-revision", catalogRevision,
                                "--json-stdin", "--json")))));
        Map<String, Object> routine = MiniJson.obj();
        routine.put("kind", "routine");
        routine.put("id", "rt-1");
        routine.put("revision", revision);
        routine.put("name", "GitHub watch");
        routine.put("description", "watch pushes");
        routine.put("status", "active");
        routine.put("schedule", "acme/app · PushEvent");
        routine.put("definition", Map.of(
                "name", "GitHub watch", "prompt", "Summarize pushes",
                "trigger", Map.of("kind", "github", "repo", "acme/app",
                        "events", List.of("PushEvent"))));
        routine.put("security", Map.of(
                "state", "snapshot_bound", "ready", true,
                "principalId", "routine:rt-1", "permissions", List.of(),
                "connectors", List.of()));
        routine.put("triggers", List.of(Map.of(
                "id", "routine:rt-1:github", "type", "github", "enabled", true,
                "scope", Map.of("repo", "acme/app", "events", List.of("PushEvent")))));
        routine.put("history", List.of());
        routine.put("actions", List.of(
                action("run_now", true, revision),
                action("retry_failed", false, revision),
                action("pause", true, revision),
                action("resume", false, revision),
                action("disable", true, revision),
                action("delete", false, revision),
                action("edit", true, revision)));
        root.put("items", List.of(routine));
        return MiniJson.stringify(root);
    }

    private static Map<String, Object> action(String id, boolean available,
            String revision) {
        Map<String, Object> action = MiniJson.obj();
        action.put("id", id);
        action.put("available", available);
        action.put("reason", available ? null : "unavailable");
        if (available) {
            boolean edit = "edit".equals(id);
            Map<String, Object> preview = MiniJson.obj();
            preview.put("executor", "cli");
            preview.put("mutates", true);
            if (edit) preview.put("stdin", "json");
            preview.put("argv", edit
                    ? List.of("automation", "center-routine-edit", "rt-1",
                            "--expected-revision", revision, "--json-stdin", "--json")
                    : List.of("automation", "center-routine-action", "rt-1", id,
                            "--expected-revision", revision, "--json"));
            action.put("preview", preview);
        } else action.put("preview", null);
        return action;
    }

    @Test
    void parsesRoutineProjectionAndExactEdit() {
        String item = repeat("b", 64);
        String catalog = "sha256:" + repeat("d", 64);
        AutomationCenter.Snapshot snapshot = AutomationCenter.parse(fixture(item, catalog));
        assertTrue(snapshot.connected);
        assertEquals(1, snapshot.routineCount);
        AutomationCenter.Item routine = snapshot.items.get(0);
        assertEquals("routine", routine.kind);
        assertEquals(List.of("github · acme/app"), routine.triggers);
        AutomationCenter.ActionPreview preview = AutomationCenter.preview(
                snapshot, routine.kind, routine.id, "edit",
                snapshot.revision, routine.revision);
        assertTrue(preview.jsonStdin);
        assertEquals("center-routine-edit", preview.argv.get(1));
        assertEquals("center-routine-create", snapshot.createRoutine.argv.get(1));
    }

    @Test
    void malformedStaleAndChangedTargetsFailClosed() {
        String item = repeat("b", 64);
        String catalog = "sha256:" + repeat("d", 64);
        AutomationCenter.Snapshot rendered = AutomationCenter.parse(fixture(item, catalog));
        assertFalse(AutomationCenter.parse("not json").connected);
        AutomationCenter.Snapshot stale = AutomationCenter.parse(
                fixture(item, catalog), "sha256:older");
        assertFalse(stale.connected);
        assertTrue(stale.stale);
        AutomationCenter.Snapshot changed = AutomationCenter.parse(
                fixture(repeat("c", 64), catalog));
        AutomationCenter.Item routine = rendered.items.get(0);
        assertNull(AutomationCenter.recheck(rendered, changed, routine.kind,
                routine.id, "pause", rendered.revision, routine.revision));
        AutomationCenter.Snapshot changedCatalog = AutomationCenter.parse(
                fixture(item, "sha256:" + repeat("e", 64)));
        assertNull(AutomationCenter.recheckCreateRoutine(rendered, changedCatalog));
    }

    @Test
    void filtersKindsAndNames() {
        AutomationCenter.Snapshot snapshot = AutomationCenter.parse(
                fixture(repeat("b", 64), "sha256:" + repeat("d", 64)));
        assertEquals(1, AutomationCenter.filter(snapshot.items, "github").size());
        assertEquals(1, AutomationCenter.filter(snapshot.items, "routine").size());
        assertEquals(0, AutomationCenter.filter(snapshot.items, "missing").size());
    }
}
