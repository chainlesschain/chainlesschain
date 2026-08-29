package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Collections;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ContextMemoryAuthorityTest {
    @Test
    void defaultsEveryPluginChildToCanonicalProjectionAuthority() {
        Map<String, String> child =
                ContextMemoryAuthority.cliEnvironment(Collections.emptyMap());
        assertEquals("canonical_default", child.get(
                ContextMemoryAuthority.CLI_STAGE_ENV));
        assertTrue(ContextMemoryAuthority.isCanonical(
                ContextMemoryAuthority.resolveStage(Collections.emptyMap())));
        assertThrows(UnsupportedOperationException.class, () -> child.put("x", "y"));
    }

    @Test
    void validatesExplicitJetbrainsRolloutStage() {
        assertEquals("shadow", ContextMemoryAuthority.resolveStage(Map.of(
                ContextMemoryAuthority.JETBRAINS_STAGE_ENV, "shadow")));
        assertThrows(IllegalArgumentException.class, () ->
                ContextMemoryAuthority.resolveStage(Map.of(
                        ContextMemoryAuthority.JETBRAINS_STAGE_ENV, "invalid")));
    }
}
