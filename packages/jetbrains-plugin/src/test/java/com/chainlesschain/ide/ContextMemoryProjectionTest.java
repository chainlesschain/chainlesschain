package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ContextMemoryProjectionTest {
    @SuppressWarnings("unchecked")
    @Test
    void consumesCanonicalLifecycleWithoutBecomingAWriter() {
        ContextMemoryProjection projection = new ContextMemoryProjection();
        Map<String, Object> plan = new LinkedHashMap<String, Object>();
        plan.put("memoryRevision", Long.valueOf(4));
        Map<String, Object> planEvent = new LinkedHashMap<String, Object>();
        planEvent.put("type", "context.plan.created");
        planEvent.put("plan", plan);
        assertTrue(projection.accept(planEvent));

        Map<String, Object> record = new LinkedHashMap<String, Object>();
        record.put("memoryId", "memory-1");
        Map<String, Object> activated = new LinkedHashMap<String, Object>();
        activated.put("type", "memory.activated");
        activated.put("memory_id", "memory-1");
        activated.put("record", record);
        assertTrue(projection.accept(activated));

        Map<String, Object> snapshot = projection.snapshot();
        assertEquals(Long.valueOf(4), snapshot.get("memoryRevision"));
        assertEquals(1, ((List<Map<String, Object>>) snapshot.get("memories")).size());

        Map<String, Object> purged = new LinkedHashMap<String, Object>();
        purged.put("type", "memory.purged");
        purged.put("memory_id", "memory-1");
        assertTrue(projection.accept(purged));
        assertEquals(0, ((List<?>) projection.snapshot().get("memories")).size());
    }
}
