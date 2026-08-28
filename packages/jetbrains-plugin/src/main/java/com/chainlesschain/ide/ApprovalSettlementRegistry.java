package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Process-local settlement guard for approval transport cards.
 *
 * <p>The CLI remains the durable authority. This registry only prevents one
 * JetBrains card from writing duplicate or conflicting responses while the
 * authoritative result is in flight, and lets a failed transport write return
 * the card to a retryable state.
 */
public final class ApprovalSettlementRegistry {
    public enum Status {
        PENDING,
        RESPONDING,
        INTERRUPTING
    }

    private final Map<String, Status> approvals = new LinkedHashMap<>();

    /** Register a newly rendered transport card. Duplicate ids stay unchanged. */
    public synchronized boolean open(String id) {
        String normalized = normalize(id);
        if (normalized == null || approvals.containsKey(normalized)) return false;
        approvals.put(normalized, Status.PENDING);
        return true;
    }

    /** Atomically reserve one pending card for an approval or denial response. */
    public synchronized boolean beginDecision(String id) {
        return begin(id, Status.RESPONDING);
    }

    /** Atomically reserve every pending card before writing an interrupt. */
    public synchronized List<String> beginInterrupt() {
        List<String> reserved = new ArrayList<>();
        for (Map.Entry<String, Status> entry : approvals.entrySet()) {
            if (entry.getValue() == Status.PENDING) {
                entry.setValue(Status.INTERRUPTING);
                reserved.add(entry.getKey());
            }
        }
        return reserved;
    }

    /**
     * Complete a transport attempt only when its reservation is still current.
     * Accepted decisions stay reserved until the CLI emits approval_resolved;
     * accepted interrupts invalidate their transport cards immediately.
     */
    public synchronized boolean complete(String id, Status reservation, boolean accepted) {
        String normalized = normalize(id);
        if (normalized == null || reservation == null || reservation == Status.PENDING
                || approvals.get(normalized) != reservation) return false;
        if (!accepted) {
            approvals.put(normalized, Status.PENDING);
        } else if (reservation == Status.INTERRUPTING) {
            approvals.remove(normalized);
        }
        return true;
    }

    /** Apply the CLI's authoritative resolution and forget the transport card. */
    public synchronized boolean resolve(String id) {
        String normalized = normalize(id);
        return normalized != null && approvals.remove(normalized) != null;
    }

    /** Invalidate every card when its owning child/session is stopped or replaced. */
    public synchronized void invalidateAll() {
        approvals.clear();
    }

    public synchronized int size() {
        return approvals.size();
    }

    public synchronized Status status(String id) {
        String normalized = normalize(id);
        return normalized == null ? null : approvals.get(normalized);
    }

    private synchronized boolean begin(String id, Status reservation) {
        String normalized = normalize(id);
        if (normalized == null || approvals.get(normalized) != Status.PENDING) return false;
        approvals.put(normalized, reservation);
        return true;
    }

    private static String normalize(String id) {
        if (id == null) return null;
        String normalized = id.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
