package com.chainlesschain.ide;

import com.chainlesschain.agent.protocol.generated.ApprovalDecision;
import com.chainlesschain.agent.protocol.generated.CcAgentProtocolKt;
import com.chainlesschain.agent.protocol.generated.PermissionGrant;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Canonical approval responses emitted by the JetBrains chat client. */
public final class ApprovalResponses {
    private ApprovalResponses() {}

    public static Map<String, Object> response(String id, boolean approve, String binding) {
        return response(id, approve ? "acceptOnce" : "decline", null, binding);
    }

    /**
     * Build a canonical decision from the host-retained CLI request. Reusable
     * decisions require a non-empty, bounded permission list; UI input can pick
     * a lifetime but cannot provide or widen capability/scope.
     */
    public static Map<String, Object> response(
            String id, String decisionKind,
            List<Map<String, Object>> requestedPermissions, String binding) {
        List<PermissionGrant> permissions = trustedPermissions(requestedPermissions);
        ApprovalDecision decision;
        if ("acceptOnce".equals(decisionKind)) {
            decision = ApprovalDecision.AcceptOnce.INSTANCE;
        } else if ("acceptForTurn".equals(decisionKind)) {
            requireReusablePermission(permissions);
            decision = new ApprovalDecision.AcceptForTurn(permissions);
        } else if ("acceptForSession".equals(decisionKind)) {
            requireReusablePermission(permissions);
            decision = new ApprovalDecision.AcceptForSession(permissions);
        } else if ("decline".equals(decisionKind)) {
            decision = new ApprovalDecision.Decline(null);
        } else if ("cancel".equals(decisionKind)) {
            decision = new ApprovalDecision.Cancel(null);
        } else {
            throw new IllegalArgumentException("unsupported approval decision kind");
        }

        boolean approve = decision instanceof ApprovalDecision.AcceptOnce
                || decision instanceof ApprovalDecision.AcceptForTurn
                || decision instanceof ApprovalDecision.AcceptForSession;

        Map<String, Object> event = new LinkedHashMap<>();
        event.put("type", "approval");
        event.put("id", id == null ? "" : id);
        event.put("decision", CcAgentProtocolKt.toWireValue(decision));
        // N-1 compatibility; the CLI rejects disagreement with decision.
        event.put("approve", approve);
        if (binding != null && !binding.isBlank()) event.put("binding", binding);
        return event;
    }

    private static void requireReusablePermission(List<PermissionGrant> permissions) {
        if (permissions.isEmpty()) {
            throw new IllegalArgumentException(
                    "reusable approval requires a CLI-requested permission");
        }
    }

    private static List<PermissionGrant> trustedPermissions(
            List<Map<String, Object>> requestedPermissions) {
        List<PermissionGrant> result = new ArrayList<>();
        if (requestedPermissions == null) return result;
        if (requestedPermissions.size() > 64) {
            throw new IllegalArgumentException("approval permissions exceed 64 entries");
        }
        for (Map<String, Object> permission : requestedPermissions) {
            if (permission == null) {
                throw new IllegalArgumentException("approval permission must be an object");
            }
            String capability = boundedString(
                    permission.get("capability"), "capability", 128);
            String scope = boundedString(permission.get("scope"), "scope", 1024);
            Object rawExpiry = permission.get("expiresAt");
            String expiresAt = null;
            if (rawExpiry != null) {
                expiresAt = boundedString(rawExpiry, "expiresAt", 64);
                try {
                    Instant.parse(expiresAt);
                } catch (DateTimeParseException error) {
                    throw new IllegalArgumentException("invalid expiresAt", error);
                }
            }
            result.add(new PermissionGrant(capability, scope, expiresAt));
        }
        return result;
    }

    private static String boundedString(Object value, String field, int max) {
        if (!(value instanceof String) || ((String) value).isEmpty()
                || ((String) value).length() > max) {
            throw new IllegalArgumentException("invalid approval permission " + field);
        }
        return (String) value;
    }
}
