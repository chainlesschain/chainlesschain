package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link ProjectMemory} (init / memory files) layer. */
class ProjectMemoryTest {

    @Test
    void buildInitArgsPlain() {
        assertEquals("init", String.join(" ", ProjectMemory.buildInitArgs(false, false)));
    }

    @Test
    void buildInitArgsWithAi() {
        assertEquals("init --ai", String.join(" ", ProjectMemory.buildInitArgs(true, false)));
    }

    @Test
    void buildInitArgsWithAiAndForce() {
        assertEquals("init --ai --force", String.join(" ", ProjectMemory.buildInitArgs(true, true)));
    }

    @Test
    void buildMemoryFilesArgs() {
        assertEquals("memory files", String.join(" ", ProjectMemory.buildMemoryFilesArgs()));
    }

    @Test
    void initModesHasTwoModesSecondIsAi() {
        assertEquals(2, ProjectMemory.initModes().size());
        assertTrue(ProjectMemory.initModes().get(1)[0].contains("--ai"));
    }

    @Test
    void leanContextEnvOnIsLean() {
        assertEquals("lean", ProjectMemory.leanContextEnvValue(true));
    }

    @Test
    void leanContextEnvOffIsNull() {
        // off → return null so ConversationView does not set CC_PROJECT_MEMORY at
        // all (full project memory, byte-identical to pre-lean behavior).
        assertNull(ProjectMemory.leanContextEnvValue(false));
    }
}
