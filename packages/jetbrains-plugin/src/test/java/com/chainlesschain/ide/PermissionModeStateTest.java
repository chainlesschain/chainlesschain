package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class PermissionModeStateTest {
    private static Map<String, Object> ack(String id, String requested, String effective, String session) {
        return Map.of("session_id", session, "permission_mode_state", Map.of(
                "correlation_id", id, "requested", requested, "effective", effective,
                "policy_revision", "a".repeat(64)));
    }

    @Test void onlyMatchingGenerationSessionRequestAndPolicyCanBecomeEffective() {
        PermissionModeState state = new PermissionModeState();
        Object owner = new Object();
        long revision = state.request("bypassPermissions");
        String id = state.starting(revision, "bypassPermissions", "s1", owner);
        assertFalse(state.acknowledge(new Object(), ack(id, "bypassPermissions", "default", "s1")));
        assertFalse(state.acknowledge(owner, ack(id, "bypassPermissions", "default", "other")));
        assertFalse(state.acknowledge(owner, ack("old", "bypassPermissions", "default", "s1")));
        assertEquals("pending", state.snapshot().status());
        assertTrue(state.acknowledge(owner, ack(id, "bypassPermissions", "default", "s1")));
        assertEquals("default", state.snapshot().effective());
        assertEquals("bypassPermissions", state.snapshot().requested());
        assertTrue(StatusBarText.labelForState(1234, state.snapshot()).contains("default (requested bypassPermissions)"));
        assertTrue(StatusBarText.tooltipForState(1234, state.snapshot()).contains("a".repeat(64)));
    }

    @Test void tighteningRemainsPendingAndShowsTheOldModeUntilExitConfirmation() {
        PermissionModeState state = new PermissionModeState();
        Object owner = new Object();
        long before = state.request("bypassPermissions");
        String id = state.starting(before, "bypassPermissions", "s", owner);
        state.acknowledge(owner, ack(id, "bypassPermissions", "bypassPermissions", "s"));
        long revision = state.request("default");
        assertFalse(state.acknowledge(owner, ack(id, "bypassPermissions", "bypassPermissions", "s")));
        assertEquals("bypassPermissions", state.snapshot().effective());
        assertTrue(StatusBarText.labelForState(1234, state.snapshot()).contains("default pending · last confirmed bypassPermissions"));
        assertTrue(StatusBarText.modeStateLine(state.snapshot()).contains("last confirmed bypassPermissions"));
        state.failed(revision, "stop failed");
        assertEquals("bypassPermissions", state.snapshot().effective());
        assertEquals("failed", state.snapshot().status());
        state.stopped(before);
        assertEquals("failed", state.snapshot().status());
        state.stopped(revision);
        assertNull(state.snapshot().effective());
        assertEquals("pending", state.snapshot().status());
    }

    @Test void oldCliMalformedAcknowledgementsAndTimeoutNeverPretendToBeEffective() {
        PermissionModeState state = new PermissionModeState();
        Object owner = new Object();
        String id = state.starting(0, "default", "s", owner);
        assertFalse(state.acknowledge(owner, Map.of("session_id", "s")));
        assertEquals("unconfirmed", state.snapshot().status());
        assertFalse(state.acknowledge(owner, ack(id, "auto", "default", "s")));
        assertFalse(state.acknowledge(owner, ack(id, "default", "unknown", "s")));
        assertNull(state.snapshot().effective());
        state.request("acceptEdits");
        state.starting(1, "acceptEdits", "s", owner);
        state.acknowledgementTimedOut(new Object());
        assertEquals("pending", state.snapshot().status());
        state.acknowledgementTimedOut(owner);
        assertEquals("unconfirmed", state.snapshot().status());
        state.exited(owner, 1);
        assertEquals("failed", state.snapshot().status());
    }

    @Test void rapidRequestsInvalidateQueuedLaunchesAndStaleFailures() {
        PermissionModeState state = new PermissionModeState();
        long old = state.request("acceptEdits");
        long latest = state.request("default");
        assertNull(state.starting(old, "acceptEdits", "s", new Object()));
        state.failed(old, "late spawn error");
        assertEquals("pending", state.snapshot().status());
        assertTrue(state.current(latest));
        assertFalse(state.current(old));
        assertNotNull(state.starting(latest, "default", "s", new Object()));
    }
}
