package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SessionModelTest {
    @Test void commandSupportsStatusResetAndGatewayAliases() {
        assertNull(SessionModel.parse(""));
        assertEquals("", SessionModel.parse("--default"));
        assertEquals("team/custom-alias", SessionModel.parse("team/custom-alias"));
        assertEquals("default", SessionModel.parse("default"));
        for (String bad : new String[]{"bad & command", "x\ny", "x\u0000y", "x%PATH%", "a".repeat(257)}) {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> SessionModel.parse(bad));
            assertFalse(error.getMessage().contains(bad));
        }
    }

    @Test void modelSelectionRetainsProviderEndpointAndCredentialHandling() {
        String[] configured = {"volcengine", "original", "https://relay.example/v1", ""};
        String[] chosen = SessionModel.apply(configured, "team/custom-alias");
        assertArrayEquals(new String[]{"volcengine", "team/custom-alias", "https://relay.example/v1", ""}, chosen);
        assertEquals("original", configured[1]);
        assertArrayEquals(configured, SessionModel.apply(configured, ""));
        java.util.List<String> args = SessionArgs.build(chosen[0], chosen[1], chosen[2], "secret-not-an-argument", "session-a", "default", "off");
        assertTrue(args.contains("team/custom-alias"));
        assertTrue(args.contains("session-a"));
        assertFalse(args.contains("secret-not-an-argument"));
    }

    @Test void changesApplyOnlyToTheOwningConversationAtAnIdleBoundary() {
        ConversationManager manager = new ConversationManager();
        ConversationManager.Conversation a = manager.create();
        ConversationManager.Conversation b = manager.create();
        Object sessionA = new Object(), sessionB = new Object();
        a.session = sessionA; b.session = sessionB;
        a.modelOverride = SessionModel.parse("team/new-model");
        assertFalse(SessionModel.needsRestart(a.modelOverride, "", true, true));
        assertTrue(SessionModel.needsRestart(a.modelOverride, "", true, false));
        assertFalse(SessionModel.needsRestart(a.modelOverride, a.modelOverride, true, false));
        assertFalse(SessionModel.needsRestart(a.modelOverride, "", false, false));
        assertEquals("", b.modelOverride);
        assertSame(sessionA, a.session);
        assertSame(sessionB, b.session);
    }
}
