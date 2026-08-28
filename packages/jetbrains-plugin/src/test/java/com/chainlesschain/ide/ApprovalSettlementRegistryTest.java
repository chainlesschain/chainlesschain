package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class ApprovalSettlementRegistryTest {

    @Test
    @SuppressWarnings("unchecked")
    void replaysJetbrainsSurfaceFromSharedHumanTaskFixture() throws Exception {
        Map<String, Object> fixture = (Map<String, Object>) MiniJson.parse(
                Files.readString(fixturePath(), StandardCharsets.UTF_8));
        List<Map<String, Object>> scenarios =
                (List<Map<String, Object>>) (List<?>) fixture.get("scenarios");
        int replayed = 0;

        for (Map<String, Object> scenario : scenarios) {
            List<String> surfaces = (List<String>) (List<?>) scenario.get("surfaces");
            if (!surfaces.contains("jetbrains")) continue;
            replayed += 1;

            String name = String.valueOf(scenario.get("name"));
            String requestId = "approval-" + name;
            ApprovalSettlementRegistry registry = new ApprovalSettlementRegistry();
            assertTrue(registry.open(requestId), name);
            int sentDecisions = 0;
            int interrupts = 0;
            int rejectedResponses = 0;
            String unresolvedDecision = null;

            List<Map<String, Object>> steps =
                    (List<Map<String, Object>>) (List<?>) scenario.get("steps");
            for (Map<String, Object> step : steps) {
                String action = String.valueOf(step.get("action"));
                Map<String, Object> expectations =
                        (Map<String, Object>) step.get("expect");
                String expectedStep = String.valueOf(expectations.get("jetbrains"));

                if ("restart".equals(action)) {
                    if (unresolvedDecision != null) {
                        registry.resolve(requestId);
                        unresolvedDecision = null;
                    }
                    registry.invalidateAll();
                    assertEquals("settled", expectedStep, name);
                    continue;
                }

                if ("cancel".equals(action)) {
                    List<String> reserved = registry.beginInterrupt();
                    interrupts += 1;
                    for (String id : reserved) {
                        assertTrue(registry.complete(
                                id, ApprovalSettlementRegistry.Status.INTERRUPTING, true), name);
                    }
                    assertEquals("settled", expectedStep, name);
                    continue;
                }

                assertTrue("approve".equals(action) || "decline".equals(action),
                        name + ": unsupported JetBrains action " + action);
                boolean accepted = registry.beginDecision(requestId);
                if (accepted) {
                    assertTrue(registry.complete(
                            requestId, ApprovalSettlementRegistry.Status.RESPONDING, true), name);
                    sentDecisions += 1;
                    unresolvedDecision = action;
                } else {
                    rejectedResponses += 1;
                }
                assertEquals("settled".equals(expectedStep), accepted, name);
            }

            if (unresolvedDecision != null) registry.resolve(requestId);
            Map<String, Object> expectedBySurface =
                    (Map<String, Object>) scenario.get("expected");
            Map<String, Object> expected =
                    (Map<String, Object>) expectedBySurface.get("jetbrains");
            assertEquals(asInt(expected.get("pending_approvals")), registry.size(), name);
            assertEquals(asInt(expected.get("sent_decisions")), sentDecisions, name);
            assertEquals(asInt(expected.get("interrupts")), interrupts, name);
            assertEquals(asInt(expected.get("rejected_responses")), rejectedResponses, name);
        }

        assertEquals(4, replayed, "JetBrains fixture coverage changed unexpectedly");
    }

    @Test
    void rejectedTransportRollsReservationBackForRetry() {
        ApprovalSettlementRegistry registry = new ApprovalSettlementRegistry();
        assertTrue(registry.open("approval-retry"));
        assertTrue(registry.beginDecision("approval-retry"));
        assertTrue(registry.complete(
                "approval-retry", ApprovalSettlementRegistry.Status.RESPONDING, false));
        assertEquals(ApprovalSettlementRegistry.Status.PENDING,
                registry.status("approval-retry"));
        assertTrue(registry.beginDecision("approval-retry"));
    }

    @Test
    void concurrentDecisionReservationHasExactlyOneWinner() {
        ApprovalSettlementRegistry registry = new ApprovalSettlementRegistry();
        assertTrue(registry.open("approval-race"));
        AtomicInteger winners = new AtomicInteger();

        IntStream.range(0, 64).parallel().forEach(ignored -> {
            if (registry.beginDecision("approval-race")) winners.incrementAndGet();
        });

        assertEquals(1, winners.get());
        assertFalse(registry.beginDecision("approval-race"));
    }

    private static int asInt(Object value) {
        return ((Number) value).intValue();
    }

    private static Path fixturePath() {
        return Path.of("..", "agent-protocol", "test", "fixtures",
                "human-task-settlement-conformance.json");
    }
}
