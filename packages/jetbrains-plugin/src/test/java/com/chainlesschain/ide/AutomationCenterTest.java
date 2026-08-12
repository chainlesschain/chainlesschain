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

    private static String fixture(String itemRevision) {
        String flowRevision = "sha256:" + itemRevision;
        Map<String, Object> root = MiniJson.obj();
        root.put("schema", AutomationCenter.SCHEMA);
        root.put("schemaVersion", AutomationCenter.SCHEMA_VERSION);
        root.put("authority", "cli");
        root.put("connected", true);
        root.put("revision", "sha256:" + repeat("a", 64));
        root.put("summary", Map.of(
                "total", 1, "active", 1, "paused", 0, "needsAttention", 0));
        Map<String, Object> flow = MiniJson.obj();
        flow.put("id", "flow-1");
        flow.put("revision", flowRevision);
        flow.put("name", "IDE alert");
        flow.put("description", "notify");
        flow.put("status", "active");
        flow.put("schedule", "*/5 * * * *");
        flow.put("security", Map.of(
                "state", "ready", "ready", true, "principalId", "alice",
                "budget", Map.of("remainingRuns", 2, "remainingActionSteps", 2),
                "permissions", List.of(), "connectors", List.of("slack")));
        flow.put("triggers", List.of(Map.of(
                "id", "trigger-1", "type", "event", "enabled", true,
                "scope", Map.of("origins", List.of("telegram")))));
        flow.put("history", List.of(Map.of(
                "id", "exec-1", "status", "success", "triggerType", "event",
                "startedAt", "2026-08-12T00:00:00Z")));
        flow.put("actions", List.of(
                action("run_now", true, flowRevision),
                action("retry_failed", false, flowRevision),
                action("pause", true, flowRevision),
                action("resume", false, flowRevision),
                action("disable", true, flowRevision),
                action("delete", false, flowRevision)));
        root.put("flows", List.of(flow));
        return MiniJson.stringify(root);
    }

    private static Map<String, Object> action(String id, boolean available,
            String revision) {
        Map<String, Object> action = MiniJson.obj();
        action.put("id", id);
        action.put("available", available);
        action.put("reason", available ? null : "unavailable");
        if (available) action.put("preview", Map.of(
                "executor", "cli", "mutates", true,
                "argv", List.of("automation", "center-action", "flow-1", id,
                        "--expected-revision", revision, "--json")));
        else action.put("preview", null);
        return action;
    }

    @Test
    void parsesProjectionAndExactActions() {
        String item = repeat("b", 64);
        AutomationCenter.Snapshot snapshot = AutomationCenter.parse(fixture(item));
        assertTrue(snapshot.connected);
        assertEquals(1, snapshot.flows.size());
        AutomationCenter.Flow flow = snapshot.flows.get(0);
        assertTrue(flow.ready);
        assertEquals(List.of("event · telegram"), flow.triggers);
        assertTrue(AutomationCenter.detail(flow).contains("2 runs / 2 steps left"));
        assertEquals(List.of("automation", "center-action", "flow-1", "run_now",
                        "--expected-revision", flow.revision, "--json"),
                AutomationCenter.preview(snapshot, flow.id, "run_now",
                        snapshot.revision, flow.revision).argv);
    }

    @Test
    void malformedStaleAndChangedTargetsFailClosed() {
        String item = repeat("b", 64);
        AutomationCenter.Snapshot rendered = AutomationCenter.parse(fixture(item));
        assertFalse(AutomationCenter.parse("not json").connected);
        AutomationCenter.Snapshot stale = AutomationCenter.parse(
                fixture(item), "sha256:older");
        assertFalse(stale.connected);
        assertTrue(stale.stale);
        AutomationCenter.Snapshot changed = AutomationCenter.parse(fixture(repeat("c", 64)));
        AutomationCenter.Flow flow = rendered.flows.get(0);
        assertNull(AutomationCenter.recheck(rendered, changed, flow.id, "pause",
                rendered.revision, flow.revision));
        assertNull(AutomationCenter.preview(rendered, flow.id, "resume",
                rendered.revision, flow.revision));
    }

    @Test
    void filtersFlows() {
        AutomationCenter.Snapshot snapshot = AutomationCenter.parse(
                fixture(repeat("b", 64)));
        assertEquals(1, AutomationCenter.filter(snapshot.flows, "alert").size());
        assertEquals(0, AutomationCenter.filter(snapshot.flows, "missing").size());
    }
}
