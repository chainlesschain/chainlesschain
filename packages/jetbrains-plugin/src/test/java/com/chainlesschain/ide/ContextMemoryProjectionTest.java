package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ContextMemoryProjectionTest {
    private static Path fixturePath() {
        Path sibling = Path.of("..", "context-memory-kernel", "fixtures",
                "cross-surface-projection-v1.tsv");
        if (Files.isRegularFile(sibling)) return sibling;
        return Path.of("packages", "context-memory-kernel", "fixtures",
                "cross-surface-projection-v1.tsv");
    }

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

    @SuppressWarnings("unchecked")
    @Test
    void consumesSharedCrossSurfaceProjectionFixture() throws IOException {
        ContextMemoryProjection projection = new ContextMemoryProjection();
        long expectedRevision = -1L;
        int expectedMemoryCount = -1;
        List<String> lines = Files.readAllLines(fixturePath(), StandardCharsets.UTF_8);
        for (int index = 1; index < lines.size(); index++) {
            String[] fields = lines.get(index).split("\\t", -1);
            String method = fields[0];
            String type = fields[1];
            if ("expected".equals(method)) {
                expectedRevision = Long.parseLong(fields[3]);
                expectedMemoryCount = Integer.parseInt(fields[5]);
                continue;
            }
            Map<String, Object> event = new LinkedHashMap<String, Object>();
            event.put("type", type);
            if (!"-".equals(fields[2])) event.put("memory_id", fields[2]);
            if (!"-".equals(fields[4])) {
                Map<String, Object> record = new LinkedHashMap<String, Object>();
                record.put("memoryId", fields[4]);
                event.put("record", record);
            }
            if (!"-".equals(fields[3])) {
                Map<String, Object> revisionValue = new LinkedHashMap<String, Object>();
                revisionValue.put("memoryRevision", Long.valueOf(fields[3]));
                event.put("context.plan.created".equals(type) ? "plan" : "result",
                        revisionValue);
            }
            assertTrue(projection.accept(event), type);
        }
        Map<String, Object> snapshot = projection.snapshot();
        assertEquals(Long.valueOf(expectedRevision), snapshot.get("memoryRevision"));
        assertEquals(expectedMemoryCount,
                ((List<Map<String, Object>>) snapshot.get("memories")).size());
    }
}
