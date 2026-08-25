package com.chainlesschain.ide;

import java.util.LinkedHashMap;
import java.util.Map;

/** Canonical approval responses emitted by the JetBrains chat client. */
public final class ApprovalResponses {
    private ApprovalResponses() {}

    /**
     * Build the least-privilege structured decision supported by the binary UI.
     * Session/turn grants require a separately reviewed native control and cannot
     * be requested through this helper.
     */
    public static Map<String, Object> response(String id, boolean approve, String binding) {
        Map<String, Object> decision = new LinkedHashMap<>();
        decision.put("kind", approve ? "acceptOnce" : "decline");

        Map<String, Object> event = new LinkedHashMap<>();
        event.put("type", "approval");
        event.put("id", id == null ? "" : id);
        event.put("decision", decision);
        // N-1 compatibility; the CLI rejects disagreement with decision.
        event.put("approve", approve);
        if (binding != null && !binding.isBlank()) event.put("binding", binding);
        return event;
    }
}
