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
        return fixture(itemRevision, catalogRevision, List.of());
    }

    private static String fixture(String itemRevision, String catalogRevision,
            List<Map<String, Object>> incidents) {
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
                "active", 1, "paused", 0, "needsAttention", 0,
                "runtimeRunning", 1, "runtimePauseRequested", 0,
                "runtimePaused", 0));
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
        routine.put("incidents", incidents);
        routine.put("actions", List.of(
                action("run_now", true, revision),
                action("retry_failed", false, revision),
                action("pause", true, revision),
                action("resume", false, revision),
                action("disable", true, revision),
                action("delete", false, revision),
                action("edit", true, revision)));
        root.put("items", List.of(routine));
        Map<String, Object> runtime = MiniJson.obj();
        runtime.put("schema", AutomationCenter.RUNTIME_SCHEMA);
        runtime.put("schemaVersion", AutomationCenter.RUNTIME_SCHEMA_VERSION);
        Map<String, Object> occurrence = MiniJson.obj();
        occurrence.put("id", "occurrence-1");
        occurrence.put("jobId", "automation:flow-1");
        occurrence.put("jobKind", "automation");
        occurrence.put("status", "running");
        occurrence.put("occurrenceStatus", "running");
        occurrence.put("scheduledFor", 1_786_600_000_000L);
        occurrence.put("attempt", 1);
        occurrence.put("maxAttempts", 3);
        occurrence.put("fence", 7);
        occurrence.put("controlRevision", 0);
        occurrence.put("createdAt", 1_786_600_000_000L);
        occurrence.put("updatedAt", 1_786_600_000_001L);
        occurrence.put("runtimeControl", Map.of(
                "pauseResume", "checkpoint_v1",
                "safePoints", List.of("before_execute", "adapter_checkpoint")));
        occurrence.put("actions", List.of(
                runtimeAction("pause", true, 7, 0),
                runtimeAction("resume", false, 7, 0)));
        runtime.put("items", List.of(occurrence));
        root.put("runtime", runtime);
        return MiniJson.stringify(root);
    }

    @SuppressWarnings("unchecked")
    private static String legacyFixture(String itemRevision, String catalogRevision) {
        Map<String, Object> root = MiniJson.parseObject(
                fixture(itemRevision, catalogRevision));
        root.put("schema", AutomationCenter.LEGACY_SCHEMA);
        root.put("schemaVersion", AutomationCenter.LEGACY_SCHEMA_VERSION);
        root.remove("runtime");
        Map<String, Object> summary = (Map<String, Object>) root.get("summary");
        summary.remove("runtimeRunning");
        summary.remove("runtimePauseRequested");
        summary.remove("runtimePaused");
        Map<String, Object> item = (Map<String, Object>)
                ((List<Object>) root.get("items")).get(0);
        item.remove("incidents");
        return MiniJson.stringify(root);
    }

    private static Map<String, Object> incident(String status) {
        Map<String, Object> incident = MiniJson.obj();
        incident.put("incidentId", repeat("e", 64));
        incident.put("runId", "<run&1>");
        incident.put("occurrenceId", "occurrence-1");
        incident.put("triggerType", "manual");
        incident.put("category", "connector");
        incident.put("code", "AUTOMATION_EXECUTION_PERMISSION_DENIED");
        incident.put("status", status);
        incident.put("revision", 1);
        incident.put("createdAtMs", 1_786_600_000_000L);
        incident.put("updatedAtMs", 1_786_600_000_001L);
        incident.put("actions", List.of(
                incidentAction("retry", false, 1),
                incidentAction("cancel", true, 1)));
        return incident;
    }

    private static Map<String, Object> incidentAction(
            String id, boolean available, long revision) {
        Map<String, Object> action = MiniJson.obj();
        action.put("id", id);
        action.put("available", available);
        action.put("reason", available ? null : "unavailable");
        action.put("preview", available ? Map.of(
                "executor", "cli", "mutates", true,
                "argv", List.of("automation", "center-incident-action",
                        repeat("e", 64), id, "--expected-revision",
                        String.valueOf(revision), "--json")) : null);
        return action;
    }

    private static Map<String, Object> runtimeAction(
            String id, boolean available, long fence, long revision) {
        Map<String, Object> action = MiniJson.obj();
        action.put("id", id);
        action.put("available", available);
        action.put("reason", available ? null : "unavailable");
        action.put("preview", available ? Map.of(
                "executor", "cli", "mutates", true,
                "argv", List.of("automation", "center-runtime-action",
                        "occurrence-1", id, "--expected-fence",
                        String.valueOf(fence), "--expected-control-revision",
                        String.valueOf(revision), "--json")) : null);
        return action;
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
        assertEquals(1, snapshot.runtimeItems.size());
        AutomationCenter.RuntimeItem runtime = snapshot.runtimeItems.get(0);
        AutomationCenter.ActionPreview runtimePreview = AutomationCenter.previewRuntime(
                snapshot, runtime.id, "pause", snapshot.revision,
                runtime.fence, runtime.controlRevision);
        assertEquals("center-runtime-action", runtimePreview.argv.get(1));
    }

    @Test
    void acceptsReleasedV2PairWithoutV3Controls() {
        String item = repeat("b", 64);
        String catalog = "sha256:" + repeat("d", 64);
        AutomationCenter.Snapshot snapshot = AutomationCenter.parse(
                legacyFixture(item, catalog));
        assertTrue(snapshot.connected);
        assertTrue(snapshot.runtimeItems.isEmpty());
        assertTrue(snapshot.items.get(0).incidents.isEmpty());
        assertEquals("center-routine-action", AutomationCenter.preview(
                snapshot, "routine", "rt-1", "run_now",
                snapshot.revision, snapshot.items.get(0).revision).argv.get(1));
        assertNull(AutomationCenter.previewRuntime(snapshot, "occurrence-1",
                "pause", snapshot.revision, 7, 0));
    }

    @Test
    void malformedStaleAndChangedTargetsFailClosed() {
        String item = repeat("b", 64);
        String catalog = "sha256:" + repeat("d", 64);
        AutomationCenter.Snapshot rendered = AutomationCenter.parse(fixture(item, catalog));
        assertFalse(AutomationCenter.parse("not json").connected);
        Map<String, Object> mismatched = MiniJson.parseObject(
                legacyFixture(item, catalog));
        mismatched.put("schemaVersion", 3);
        assertFalse(AutomationCenter.parse(MiniJson.stringify(mismatched)).connected);
        Map<String, Object> unknown = MiniJson.parseObject(
                legacyFixture(item, catalog));
        unknown.put("schema", "chainlesschain.automation-center/v1");
        unknown.put("schemaVersion", 1);
        assertFalse(AutomationCenter.parse(MiniJson.stringify(unknown)).connected);
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

    @Test
    void parsesSanitizedIncidentControls() {
        AutomationCenter.Snapshot snapshot = AutomationCenter.parse(fixture(
                repeat("b", 64), "sha256:" + repeat("d", 64),
                List.of(incident("open"))));
        assertTrue(snapshot.connected);
        AutomationCenter.Item routine = snapshot.items.get(0);
        assertEquals(1, routine.incidents.size());
        AutomationCenter.Incident incident = routine.incidents.get(0);
        assertEquals("<run&1>", incident.runId);
        assertEquals("occurrence-1", incident.occurrenceId);
        assertEquals("AUTOMATION_EXECUTION_PERMISSION_DENIED", incident.code);
        assertEquals("open", incident.status);
        assertTrue(incident.actions.get("cancel").available);
        assertEquals("center-incident-action",
                incident.actions.get("cancel").preview.argv.get(1));
        assertEquals(AutomationCenter.ROUTINE_ACTIONS.size(), routine.actions.size());
        String detail = AutomationCenter.detail(routine);
        assertTrue(detail.contains("Incidents:"));
        assertTrue(detail.contains("run <run&1>"));
        assertFalse(detail.contains("must-not-render"));
        assertFalse(detail.contains("--dangerous"));
        assertEquals(1, AutomationCenter.filter(snapshot.items, "permission_denied").size());
    }

    @Test
    void malformedAndDuplicateIncidentsFailClosed() {
        String revision = repeat("b", 64);
        String catalog = "sha256:" + repeat("d", 64);
        assertFalse(AutomationCenter.parse(
                fixture(revision, catalog, List.of(incident("retry")))).connected);
        Map<String, Object> first = incident("open");
        Map<String, Object> duplicate = new java.util.LinkedHashMap<String, Object>(first);
        assertFalse(AutomationCenter.parse(
                fixture(revision, catalog, List.of(first, duplicate))).connected);
        Map<String, Object> controlled = incident("open");
        controlled.put("runId", "run\nid");
        assertFalse(AutomationCenter.parse(
                fixture(revision, catalog, List.of(controlled))).connected);
    }

    @Test
    @SuppressWarnings("unchecked")
    void rechecksRuntimeAndIncidentControlsAndRejectsBoundaryFields() {
        String revision = repeat("b", 64);
        String catalog = "sha256:" + repeat("d", 64);
        AutomationCenter.Snapshot rendered = AutomationCenter.parse(
                fixture(revision, catalog, List.of(incident("open"))));
        AutomationCenter.Snapshot current = AutomationCenter.parse(
                fixture(revision, catalog, List.of(incident("open"))));
        AutomationCenter.RuntimeItem runtime = rendered.runtimeItems.get(0);
        assertEquals("center-runtime-action", AutomationCenter.recheckRuntime(
                rendered, current, runtime.id, "pause", rendered.revision,
                runtime.fence, runtime.controlRevision).argv.get(1));
        AutomationCenter.Incident incident = rendered.items.get(0).incidents.get(0);
        assertEquals("center-incident-action", AutomationCenter.recheckIncident(
                rendered, current, incident.incidentId, "cancel", rendered.revision,
                incident.revision).argv.get(1));

        Map<String, Object> changedFence = MiniJson.parseObject(
                fixture(revision, catalog, List.of(incident("open"))));
        Map<String, Object> runtimeRoot =
                (Map<String, Object>) changedFence.get("runtime");
        Map<String, Object> occurrence = (Map<String, Object>)
                ((List<Object>) runtimeRoot.get("items")).get(0);
        occurrence.put("fence", 8);
        occurrence.put("actions", List.of(
                runtimeAction("pause", true, 8, 0),
                runtimeAction("resume", false, 8, 0)));
        assertNull(AutomationCenter.recheckRuntime(rendered,
                AutomationCenter.parse(MiniJson.stringify(changedFence)),
                runtime.id, "pause", rendered.revision,
                runtime.fence, runtime.controlRevision));

        Map<String, Object> boundary = MiniJson.parseObject(
                fixture(revision, catalog, List.of(incident("open"))));
        Map<String, Object> boundaryRuntime =
                (Map<String, Object>) boundary.get("runtime");
        Map<String, Object> boundaryOccurrence = (Map<String, Object>)
                ((List<Object>) boundaryRuntime.get("items")).get(0);
        boundaryOccurrence.put("payload", Map.of("secret", "must-not-cross"));
        assertFalse(AutomationCenter.parse(MiniJson.stringify(boundary)).connected);

        Map<String, Object> incidentBoundary = MiniJson.parseObject(
                fixture(revision, catalog, List.of(incident("open"))));
        Map<String, Object> routine = (Map<String, Object>)
                ((List<Object>) incidentBoundary.get("items")).get(0);
        Map<String, Object> rawIncident = (Map<String, Object>)
                ((List<Object>) routine.get("incidents")).get(0);
        rawIncident.put("authority", Map.of("secret", true));
        assertFalse(AutomationCenter.parse(
                MiniJson.stringify(incidentBoundary)).connected);
    }

    @Test
    @SuppressWarnings("unchecked")
    void rejectsDuplicateAndUnknownRuntimeActions() {
        String revision = repeat("b", 64);
        String catalog = "sha256:" + repeat("d", 64);
        Map<String, Object> duplicate = MiniJson.parseObject(
                fixture(revision, catalog));
        Map<String, Object> runtime = (Map<String, Object>) duplicate.get("runtime");
        List<Object> occurrences = (List<Object>) runtime.get("items");
        occurrences.add(new java.util.LinkedHashMap<String, Object>(
                (Map<String, Object>) occurrences.get(0)));
        assertFalse(AutomationCenter.parse(MiniJson.stringify(duplicate)).connected);

        Map<String, Object> unknown = MiniJson.parseObject(
                fixture(revision, catalog));
        Map<String, Object> unknownRuntime =
                (Map<String, Object>) unknown.get("runtime");
        Map<String, Object> occurrence = (Map<String, Object>)
                ((List<Object>) unknownRuntime.get("items")).get(0);
        Map<String, Object> action = (Map<String, Object>)
                ((List<Object>) occurrence.get("actions")).get(1);
        action.put("id", "terminate");
        assertFalse(AutomationCenter.parse(MiniJson.stringify(unknown)).connected);
    }
}
