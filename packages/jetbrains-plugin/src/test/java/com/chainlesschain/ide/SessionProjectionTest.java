package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

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
