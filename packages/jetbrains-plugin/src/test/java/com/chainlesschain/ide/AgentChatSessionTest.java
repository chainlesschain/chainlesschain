package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Pure static-logic coverage for {@link AgentChatSession}: the configured-cc-path
 * override (IDE Settings), plus the cc-vs-C-compiler resolution helpers. None of
 * these spawn a process — the override short-circuits before probing and the
 * chooseBinary probe is injected.
 */
class AgentChatSessionTest {

    @AfterEach
    void clearOverride() {
        // The override is a process-wide static — reset so tests don't leak into
        // each other (or into resolveBinary()'s real probing elsewhere).
        AgentChatSession.setConfiguredBinary(null);
    }

    @Test
    void configuredBinaryOverrideWinsInResolveBinary() {
        AgentChatSession.setConfiguredBinary("/opt/tools/cc");
        assertEquals("/opt/tools/cc", AgentChatSession.resolveBinary());
    }

    @Test
    void setConfiguredBinaryTrimsSurroundingWhitespace() {
        AgentChatSession.setConfiguredBinary("  C:\\bin\\cc.cmd  ");
        assertEquals("C:\\bin\\cc.cmd", AgentChatSession.configuredBinary());
    }

    @Test
    void blankOrNullClearsTheOverride() {
        AgentChatSession.setConfiguredBinary("cc");
        assertEquals("cc", AgentChatSession.configuredBinary());
        AgentChatSession.setConfiguredBinary("   ");
        assertNull(AgentChatSession.configuredBinary());
        AgentChatSession.setConfiguredBinary("cc");
        AgentChatSession.setConfiguredBinary(null);
        assertNull(AgentChatSession.configuredBinary());
    }

    @Test
    void looksLikeCcVersionAcceptsBareSemver() {
        assertTrue(AgentChatSession.looksLikeCcVersion("0.162.95"));
        assertTrue(AgentChatSession.looksLikeCcVersion("0.162.95\n"));
        assertTrue(AgentChatSession.looksLikeCcVersion("v1.2.3"));
    }

    @Test
    void looksLikeCcVersionRejectsCompilerAndShellBanners() {
        assertFalse(AgentChatSession.looksLikeCcVersion("cc (GCC) 12.2.0"));
        assertFalse(AgentChatSession.looksLikeCcVersion("Apple clang version 15.0.0"));
        assertFalse(AgentChatSession.looksLikeCcVersion("Microsoft Windows [Version 10.0.19045]"));
        assertFalse(AgentChatSession.looksLikeCcVersion("not a version"));
        assertFalse(AgentChatSession.looksLikeCcVersion(""));
        assertFalse(AgentChatSession.looksLikeCcVersion(null));
    }

    @Test
    void chooseBinaryPicksAHealthyCc() {
        assertEquals("cc", AgentChatSession.chooseBinary(c -> "0.162.150"));
    }

    @Test
    void chooseBinaryFallsThroughAShadowedCcToChainlesschain() {
        assertEquals(
                "chainlesschain",
                AgentChatSession.chooseBinary(
                        c ->
                                c.equals("cc")
                                        ? "cc (GCC) 12.2.0"
                                        : c.equals("chainlesschain") ? "0.162.150" : ""));
    }

    @Test
    void chooseBinaryYieldsNullWhenNoCandidateResolves() {
        assertNull(AgentChatSession.chooseBinary(c -> ""));
        assertNull(AgentChatSession.chooseBinary(c -> null));
    }
}
