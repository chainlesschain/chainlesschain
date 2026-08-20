package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Cross-IDE parity over the exact fixture consumed by the VS Code twin. */
class SessionProjectionTest {

    private static Path fixtureFile() {
        for (String root : new String[] { "../cli", "packages/cli", "../../packages/cli" }) {
            Path file = Paths.get(root, "__tests__", "fixtures",
                    "session-projection-v1.json");
            if (Files.isRegularFile(file)) return file;
        }
        throw new AssertionError("shared session projection fixture not found; cwd="
                + Paths.get("").toAbsolutePath());
    }

    private static String fixture() {
        try {
            return Files.readString(fixtureFile(), StandardCharsets.UTF_8);
        } catch (IOException error) {
            throw new AssertionError("cannot read session projection fixture", error);
        }
    }

    private static Map<String, Object> action(String id, boolean available,
            List<String> argv) {
        Map<String, Object> action = MiniJson.obj();
        action.put("id", id);
        action.put("available", available);
        action.put("reason", available ? null : "unsupported for this row");
        if (available) {
            Map<String, Object> preview = MiniJson.obj();
            preview.put("executor", "cli");
            preview.put("argv", argv);
            preview.put("mutates", !"peek".equals(id));
            preview.put("input", null);
            action.put("preview", preview);
        } else {
            action.put("preview", null);
        }
        return action;
    }

    @SuppressWarnings("unchecked")
    private static String v2Fixture() {
        Map<String, Object> root = MiniJson.parseObject(fixture());
        root.put("schema", SessionProjection.SCHEMA);
        root.put("schemaVersion", SessionProjection.SCHEMA_VERSION);
        root.put("revision", "sha256:" + "9".repeat(64));
        Map<String, Object> sources = (Map<String, Object>) root.get("sources");
        Map<String, Object> sourceStatus = MiniJson.obj();
        sourceStatus.put("ok", true);
        sourceStatus.put("count", 1L);
        sourceStatus.put("error", null);
        sources.put("dynamicWorkflow", sourceStatus);
        List<Object> sessions = (List<Object>) root.get("sessions");
        for (Object value : sessions) {
            Map<String, Object> item = (Map<String, Object>) value;
            item.put("workflow", null);
            List<Object> actions = (List<Object>) item.get("actions");
            actions.add(action("pause", false, List.of()));
            actions.add(action("resume", false, List.of()));
            actions.add(action("recover", false, List.of()));
        }

        List<Object> actions = new ArrayList<>();
        for (String id : SessionProjection.ACTIONS) {
            boolean available = List.of("peek", "stop", "resume", "recover")
                    .contains(id);
            List<String> argv = "peek".equals(id)
                    ? List.of("cowork", "workflow", "runtime-status", "wf-run",
                            "--cwd", "C:/repo", "--json")
                    : List.of("cowork", "workflow",
                            "runtime-" + ("recover".equals(id)
                                    ? "recover-checkpoints" : id),
                            "wf-run", "--expected-revision", "7",
                            "--cwd", "C:/repo", "--json");
            actions.add(action(id, available, argv));
        }
        Map<String, Object> dynamic = MiniJson.obj();
        dynamic.put("id", "dynamic_workflow:wf-run");
        dynamic.put("sourceId", "wf-run");
        dynamic.put("kind", "dynamic_workflow");
        dynamic.put("state", "blocked");
        dynamic.put("title", "Dynamic workflow release-review");
        dynamic.put("capabilities", List.of("peek", "stop", "resume", "recover"));
        dynamic.put("actions", actions);
        dynamic.put("linkedSessionId", "authority-session");
        dynamic.put("owner", Map.of("type", "local-user", "id", ""));
        dynamic.put("environment", Map.of("cwd", "C:/repo"));
        dynamic.put("worktree", null);
        dynamic.put("artifact", Map.of("count", 1L));
        dynamic.put("approval", Map.of(
                "pending", true, "type", "recovery", "count", 1L));
        dynamic.put("pr", Map.of("count", 0L));
        dynamic.put("workflow", Map.of(
                "runtimeRevision", 7L,
                "phase", Map.of("status", "paused"),
                "agents", Map.of("requested", 2L, "settled", 2L, "pending", 0L),
                "budget", Map.of("overall", "within"),
                "recovery", Map.of("terminal", 1L),
                "recent", Map.of("call", Map.of(
                        "name", "read_file", "status", "completed"))));
        dynamic.put("lastEvent", Map.of("at", "2026-08-01T00:10:00Z"));
        dynamic.put("revision", "sha256:" + "8".repeat(64));
        sessions.add(0, dynamic);
        return MiniJson.stringify(root);
    }

    @Test
    void consumesTheSharedFiveKindProjection() {
        SessionProjection.Snapshot snapshot = SessionProjection.parse(fixture());
        assertTrue(snapshot.connected);
        assertFalse(snapshot.stale);
        assertEquals("sha256:a8e6e8f46d7d4467d994a5e67b97cfb49955446f74453e719ba510cbb573b4e5",
                snapshot.revision);
        List<SessionsWorkbench.Row> rows = SessionsWorkbench.projectionRows(snapshot);
        assertEquals(List.of("workflow", "background", "team", "remote", "local"),
                rows.stream().map(row -> row.kind).toList());
        assertEquals(List.of("peek", "reply", "attach", "stop"), rows.get(1).actions);
        assertEquals(List.of("dispatch", "peek"), rows.get(4).actions);
        assertTrue(rows.get(2).actions.isEmpty());
        assertEquals("bg-fixture", rows.get(1).sourceId);
        assertEquals(18800L, rows.get(3).port);
        assertEquals(snapshot.revision, rows.get(1).projectionRevision);
        assertTrue(rows.get(1).detail.contains("owner local-user:alice"));
        assertTrue(rows.get(1).detail.contains("artifacts 1 · report.md"));
        assertTrue(rows.get(1).detail.contains("PR #42 open"));
    }

    @Test
    void consumesV2DynamicWorkflowSummaryAndExactControls() {
        SessionProjection.Snapshot snapshot = SessionProjection.parse(v2Fixture());
        assertTrue(snapshot.connected);
        SessionProjection.Item item = snapshot.sessions.stream()
                .filter(row -> "dynamic_workflow".equals(row.kind))
                .findFirst().orElseThrow();
        assertEquals(List.of("peek", "stop", "resume", "recover"), item.actions);
        assertTrue(item.detail.contains("phase paused"));
        assertTrue(item.detail.contains("agents 2/2"));
        assertTrue(item.detail.contains("budget within"));
        assertTrue(item.detail.contains("recent tool read_file:completed"));
        assertTrue(item.detail.contains("recoverable checkpoints 1"));
        assertEquals(List.of("cowork", "workflow", "runtime-resume", "wf-run",
                        "--expected-revision", "7", "--cwd", "C:/repo", "--json"),
                SessionProjection.preview(snapshot, item.id, "resume",
                        snapshot.revision, item.revision).argv);
    }

    @Test
    void disconnectedMalformedAndStaleSnapshotsClearAllRows() {
        String disconnected = fixture().replace(
                "\"connected\": true", "\"connected\": false");
        SessionProjection.Snapshot offline = SessionProjection.parse(disconnected);
        assertFalse(offline.connected);
        assertTrue(offline.sessions.isEmpty());
        assertTrue(SessionsWorkbench.projectionRows(offline).isEmpty());

        SessionProjection.Snapshot malformed = SessionProjection.parse("not-json");
        assertFalse(malformed.connected);
        assertTrue(malformed.sessions.isEmpty());

        SessionProjection.Snapshot stale = SessionProjection.parse(
                fixture(), "sha256:older");
        assertFalse(stale.connected);
        assertTrue(stale.stale);
        assertTrue(stale.sessions.isEmpty());
    }

    @Test
    void actionDispatchRequiresCurrentRevisionAndAdvertisedCapability() {
        SessionProjection.Snapshot snapshot = SessionProjection.parse(fixture());
        assertTrue(SessionProjection.canRun(snapshot,
                "background:bg-fixture", "reply", snapshot.revision));
        assertFalse(SessionProjection.canRun(snapshot,
                "background:bg-fixture", "checkpoint", snapshot.revision));
        assertFalse(SessionProjection.canRun(snapshot,
                "background:bg-fixture", "stop", "sha256:stale"));
        assertFalse(SessionProjection.canRun(
                SessionProjection.parse("not-json"),
                "background:bg-fixture", "stop", snapshot.revision));
    }

    @Test
    void routesLocalBackgroundAndRemoteActionsAndFailsClosedOnStaleTargets() {
        SessionProjection.Snapshot snapshot = SessionProjection.parse(fixture());
        SessionProjection.Item local = snapshot.sessions.stream()
                .filter(item -> "local".equals(item.kind)).findFirst().orElseThrow();
        SessionProjection.Item background = snapshot.sessions.stream()
                .filter(item -> "background".equals(item.kind)).findFirst().orElseThrow();
        SessionProjection.Item remote = snapshot.sessions.stream()
                .filter(item -> "remote".equals(item.kind)).findFirst().orElseThrow();

        assertEquals(List.of("session", "resume", "local-fixture"),
                SessionProjection.preview(snapshot, local.id, "dispatch",
                        snapshot.revision, local.revision).argv);
        assertEquals(List.of("daemon", "stop", "bg-fixture", "--json"),
                SessionProjection.preview(snapshot, background.id, "stop",
                        snapshot.revision, background.revision).argv);
        assertEquals(List.of("remote-control", "stop", "--port", "18800", "--json"),
                SessionProjection.preview(snapshot, remote.id, "stop",
                        snapshot.revision, remote.revision).argv);

        assertTrue(SessionProjection.recheck(snapshot, snapshot, local.id, "dispatch",
                snapshot.revision, "sha256:stale") == null);
        assertTrue(SessionProjection.recheck(snapshot, SessionProjection.parse("not-json"),
                local.id, "dispatch", snapshot.revision, local.revision) == null);
    }
}
