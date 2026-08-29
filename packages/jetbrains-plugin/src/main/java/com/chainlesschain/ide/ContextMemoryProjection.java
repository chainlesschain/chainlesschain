package com.chainlesschain.ide;

import com.chainlesschain.agent.protocol.generated.AgentStreamEventType;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Bounded read-only projection of canonical Context/Memory lifecycle events. */
public final class ContextMemoryProjection {
    private static final int MAX_MEMORIES = 256;

    private Map<String, Object> lastPlan;
    private Map<String, Object> lastCompactionReceipt;
    private Map<String, Object> lastRecall;
    private long memoryRevision;
    private final LinkedHashMap<String, Map<String, Object>> memories =
            new LinkedHashMap<String, Map<String, Object>>();

    @SuppressWarnings("unchecked")
    public synchronized boolean accept(Map<String, Object> event) {
        if (event == null) return false;
        AgentStreamEventType type = AgentStreamEventType.Companion.fromWireValue(
                String.valueOf(event.get("type")));
        if (type == null) return false;
        if (type == AgentStreamEventType.CONTEXT_PLAN_CREATED) {
            lastPlan = map(event.get("plan"));
            updateRevision(lastPlan);
            return lastPlan != null;
        }
        if (type == AgentStreamEventType.CONTEXT_COMPACTION_COMMITTED
                || type == AgentStreamEventType.CONTEXT_COMPACTION_RECONCILIATION_REQUIRED) {
            lastCompactionReceipt = map(event.get("receipt"));
            updateRevision(lastCompactionReceipt);
            return lastCompactionReceipt != null;
        }
        if (type == AgentStreamEventType.MEMORY_RECALLED) {
            lastRecall = map(event.get("result"));
            updateRevision(lastRecall);
            return lastRecall != null;
        }
        if (type == AgentStreamEventType.MEMORY_PURGED) {
            Object id = event.get("memory_id");
            if (id != null) memories.remove(String.valueOf(id));
            return id != null;
        }
        if (type == AgentStreamEventType.MEMORY_CANDIDATE_CREATED
                || type == AgentStreamEventType.MEMORY_ACTIVATED
                || type == AgentStreamEventType.MEMORY_REINFORCED
                || type == AgentStreamEventType.MEMORY_SUPERSEDED
                || type == AgentStreamEventType.MEMORY_EXPIRED) {
            Object id = event.get("memory_id");
            Map<String, Object> record = map(event.get("record"));
            if (id == null || record == null) return false;
            memories.put(String.valueOf(id), record);
            while (memories.size() > MAX_MEMORIES) {
                memories.remove(memories.keySet().iterator().next());
            }
            return true;
        }
        return false;
    }

    public synchronized Map<String, Object> snapshot() {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("lastPlan", copy(lastPlan));
        result.put("lastCompactionReceipt", copy(lastCompactionReceipt));
        result.put("lastRecall", copy(lastRecall));
        result.put("memoryRevision", Long.valueOf(memoryRevision));
        List<Map<String, Object>> records =
                new ArrayList<Map<String, Object>>(memories.size());
        for (Map<String, Object> record : memories.values()) {
            records.add(copy(record));
        }
        result.put("memories", Collections.unmodifiableList(records));
        return Collections.unmodifiableMap(result);
    }

    private void updateRevision(Map<String, Object> value) {
        if (value == null) return;
        Object revision = value.get("memoryRevision");
        if (revision instanceof Number) {
            long candidate = ((Number) revision).longValue();
            if (candidate >= 0) memoryRevision = candidate;
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return value instanceof Map
                ? copy((Map<String, Object>) value) : null;
    }

    private static Map<String, Object> copy(Map<String, Object> value) {
        return value == null ? null
                : Collections.unmodifiableMap(
                        new LinkedHashMap<String, Object>(value));
    }
}
