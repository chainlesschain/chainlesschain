package com.chainlesschain.ide;

import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** Display evidence only. The CLI remains the permission authority. */
public final class PermissionModeState {
    private static final Set<String> EFFECTIVE_MODES = Set.of(
            "default", "acceptEdits", "auto", "bypassPermissions", "dontAsk", "plan");
    private long revision;
    private String requested = "default";
    private String effective;
    private String policyRevision;
    private String status = "pending";
    private String reason = "Send a message to start the requested mode";
    private String requestId;
    private String sessionId;
    private Object generation;

    public record Snapshot(String requested, String effective, String status,
            String policyRevision, String reason, long revision) {}

    public synchronized Snapshot snapshot() {
        return new Snapshot(requested, effective, status, policyRevision, reason, revision);
    }

    /** Invalidates old ACKs immediately, while retaining the last effective mode until exit. */
    public synchronized long request(String mode) {
        if (!Set.of("default", "acceptEdits", "bypassPermissions").contains(mode))
            throw new IllegalArgumentException("Unsupported requested approval mode");
        requested = mode;
        status = "pending";
        reason = "Waiting for the previous agent to exit";
        requestId = null;
        generation = null;
        return ++revision;
    }

    public synchronized boolean current(long expected) { return revision == expected; }

    public synchronized String starting(long expected, String mode, String id, Object owner) {
        if (!current(expected) || !requested.equals(mode)) return null;
        sessionId = id;
        generation = owner;
        requestId = UUID.randomUUID().toString();
        effective = null;
        policyRevision = null;
        status = "pending";
        reason = "Waiting for the CLI to confirm its effective mode";
        return requestId;
    }

    public synchronized boolean acknowledge(Object owner, Map<String, Object> event) {
        if (owner == null || owner != generation || requestId == null) return false;
        Object raw = event.get("permission_mode_state");
        if (raw instanceof Map<?, ?> ack) {
            if (!requestId.equals(ack.get("correlation_id"))
                    || !Objects.equals(sessionId, event.get("session_id"))) return false;
            Object mode = ack.get("effective");
            Object digest = ack.get("policy_revision");
            if (requested.equals(ack.get("requested")) && mode instanceof String && EFFECTIVE_MODES.contains(mode)
                    && digest instanceof String && ((String) digest).matches("[a-f0-9]{16,64}")) {
                effective = (String) mode;
                policyRevision = (String) digest;
                status = "effective";
                reason = "";
                return true;
            }
        }
        effective = null;
        policyRevision = null;
        status = "unconfirmed";
        reason = "The CLI has not confirmed the effective approval mode; update the CLI if needed";
        return false;
    }

    public synchronized void stopped(long expected) {
        if (!current(expected)) return;
        effective = null;
        policyRevision = null;
        generation = null;
        requestId = null;
        status = "pending";
        reason = "Previous agent exited; the next message starts the requested mode";
    }

    public synchronized void failed(long expected, String message) {
        if (!current(expected)) return;
        generation = null;
        requestId = null;
        status = "failed";
        reason = message == null ? "Mode transition failed" : message;
    }

    public synchronized void exited(Object owner, int code) {
        if (owner != generation) return;
        generation = null;
        requestId = null;
        status = code == 0 ? "pending" : "failed";
        reason = "Agent exited (" + code + "); process-tree exit confirmation is pending";
    }

    public synchronized void acknowledgementTimedOut(Object owner) {
        if (owner != generation || !"pending".equals(status)) return;
        status = "unconfirmed";
        reason = "The CLI did not confirm its effective approval mode within 15 seconds";
    }
}
