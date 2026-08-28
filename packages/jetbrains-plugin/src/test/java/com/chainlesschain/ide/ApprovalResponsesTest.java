package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.chainlesschain.agent.protocol.generated.CcAgentProtocolKt;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ApprovalResponsesTest {

    @Test
    @SuppressWarnings("unchecked")
    void generatedKotlinUnionReplaysEveryCanonicalFixture() throws Exception {
        for (Object value : canonicalFixtures()) {
            Map<String, Object> fixture = (Map<String, Object>) value;
            boolean valid = Boolean.TRUE.equals(fixture.get("valid"));
            try {
                assertNotNull(CcAgentProtocolKt.parseApprovalDecision(fixture.get("value")));
                assertEquals(true, valid, fixture.get("name") + " should be invalid");
            } catch (IllegalArgumentException error) {
                assertFalse(valid, fixture.get("name") + " should be valid: " + error);
            }
        }
    }

    @Test
    void emitsCanonicalLeastPrivilegeDecisionAndEchoesBinding() throws Exception {
        Map<String, Object> response = ApprovalResponses.response(
                "approval-1", true, "sha256:exact-call");
        assertEquals("approval", response.get("type"));
        assertEquals("approval-1", response.get("id"));
        assertEquals(Boolean.TRUE, response.get("approve"));
        assertEquals("sha256:exact-call", response.get("binding"));
        assertEquals(canonicalDecision("accept-once"), response.get("decision"));
    }

    @Test
    void denialUsesCanonicalDecisionAndDropsBlankBinding() throws Exception {
        Map<String, Object> response = ApprovalResponses.response(
                "approval-2", false, "  ");
        assertEquals(Boolean.FALSE, response.get("approve"));
        assertEquals(canonicalDecision("decline-with-reason").get("kind"),
                decision(response).get("kind"));
        assertFalse(response.containsKey("binding"));
    }

    @Test
    void emitsExactTurnAndSessionGrantsFromTrustedRequestPermissions() {
        List<Map<String, Object>> permissions = List.of(Map.of(
                "capability", "tool:run_shell",
                "scope", "{\"command\":\"npm test\"}"));

        for (String kind : List.of("acceptForTurn", "acceptForSession")) {
            Map<String, Object> response = ApprovalResponses.response(
                    "approval-scoped", kind, permissions, "sha256:exact-call");
            assertEquals(Boolean.TRUE, response.get("approve"));
            assertEquals(kind, decision(response).get("kind"));
            assertEquals(permissions, decision(response).get("permissions"));
        }
    }

    @Test
    void reusableDecisionFailsClosedWithoutValidCliPermission() {
        assertThrows(IllegalArgumentException.class, () -> ApprovalResponses.response(
                "approval-empty", "acceptForSession", List.of(), "sha256:exact"));
        assertThrows(IllegalArgumentException.class, () -> ApprovalResponses.response(
                "approval-wide", "acceptForTurn",
                List.of(Map.of("capability", "tool:run_shell", "scope", "")),
                "sha256:exact"));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> decision(Map<String, Object> response) {
        return (Map<String, Object>) response.get("decision");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> canonicalDecision(String name) throws Exception {
        for (Object value : canonicalFixtures()) {
            Map<String, Object> entry = (Map<String, Object>) value;
            if (name.equals(entry.get("name"))) {
                return (Map<String, Object>) entry.get("value");
            }
        }
        throw new AssertionError("missing canonical fixture entry: " + name);
    }

    @SuppressWarnings("unchecked")
    private static List<Object> canonicalFixtures() throws Exception {
        Path fixture = Path.of("..", "agent-protocol", "test", "fixtures",
                "approval-decisions.json");
        return (List<Object>) MiniJson.parse(Files.readString(fixture));
    }
}
