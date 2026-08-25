package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ApprovalResponsesTest {

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

    @SuppressWarnings("unchecked")
    private static Map<String, Object> decision(Map<String, Object> response) {
        return (Map<String, Object>) response.get("decision");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> canonicalDecision(String name) throws Exception {
        Path fixture = Path.of("..", "agent-protocol", "test", "fixtures",
                "approval-decisions.json");
        List<Object> entries = (List<Object>) MiniJson.parse(Files.readString(fixture));
        for (Object value : entries) {
            Map<String, Object> entry = (Map<String, Object>) value;
            if (name.equals(entry.get("name"))) {
                return (Map<String, Object>) entry.get("value");
            }
        }
        throw new AssertionError("missing canonical fixture entry: " + name);
    }
}
