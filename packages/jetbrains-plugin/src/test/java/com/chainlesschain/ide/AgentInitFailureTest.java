package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

class AgentInitFailureTest {

    @Test
    void ignoresEventsThatDoNotEndInitialization() {
        assertNull(AgentInitFailure.fromEarlyEvent(null));
        assertNull(AgentInitFailure.fromEarlyEvent(Map.of("type", "system", "subtype", "init")));
        assertNull(AgentInitFailure.fromEarlyEvent(Map.of("type", "result", "is_error", false)));
    }

    @Test
    void classifiesCredentialsWithoutShowingProviderText() {
        String secret = "private-provider-detail-123";
        String message = AgentInitFailure.fromEarlyEvent(Map.of(
                "type", "result", "is_error", true, "error", "HTTP 401 unauthorized " + secret));
        assertTrue(message.contains("provider credentials were rejected"));
        assertTrue(message.contains("Input was not dispatched"));
        assertFalse(message.contains(secret));
    }

    @Test
    void classifiesEndpointAndGenericFailure() {
        assertTrue(AgentInitFailure.fromEarlyEvent(Map.of(
                "type", "result", "is_error", true, "result", "model not supported"))
                .contains("provider endpoint or model is unavailable"));
        assertEquals("Agent failed to initialize; check Doctor. Input was not dispatched",
                AgentInitFailure.fromEarlyEvent(Map.of(
                        "type", "result", "is_error", true, "error", "unexpected failure")));
    }

    @Test
    void processFailuresGiveRecoveryActions() {
        assertTrue(AgentInitFailure.fromEarlyEvent(Map.of("type", "session_error"))
                .contains("check the CLI installation and Doctor"));
        assertTrue(AgentInitFailure.processStart().contains("Input was not dispatched"));
        assertTrue(AgentInitFailure.earlyExit().contains("Input was not dispatched"));
    }
}
