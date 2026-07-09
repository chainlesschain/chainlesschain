package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link SessionArgs} CLI-arg builder. */
class SessionArgsTest {

    @Test
    void handsOffModesEmitPermissionModeFlag() {
        assertEquals(Arrays.asList("--permission-mode", "acceptEdits"),
                SessionArgs.build(null, null, null, "acceptEdits"));
        assertEquals(Arrays.asList("--permission-mode", "bypassPermissions"),
                SessionArgs.build(null, null, null, "bypassPermissions"));
    }

    @Test
    void defaultUnknownAndNullModeEmitNoFlag() {
        assertEquals(new ArrayList<String>(), SessionArgs.build(null, null, null, "default"));
        assertEquals(new ArrayList<String>(), SessionArgs.build(null, null, null, "nonsense"));
        assertEquals(new ArrayList<String>(), SessionArgs.build(null, null, null, null));
    }

    @Test
    void composedArgsFollowProviderModelResumeModeOrder() {
        assertEquals(
                Arrays.asList("--provider", "ollama", "--model", "qwen2.5:7b",
                        "--resume", "sess-1", "--permission-mode", "acceptEdits"),
                SessionArgs.build("ollama", "qwen2.5:7b", "sess-1", "acceptEdits"));
    }

    @Test
    void allBlankInputsYieldEmpty() {
        assertEquals(new ArrayList<String>(), SessionArgs.build("  ", "", null, "default"));
    }

    @Test
    void permissionModesAllowListExcludesDefault() {
        assertTrue(SessionArgs.PERMISSION_MODES.contains("acceptEdits"));
        assertFalse(SessionArgs.PERMISSION_MODES.contains("default"));
    }

    @Test
    void thinkFlagMapsOnAndUltra() {
        assertEquals(Arrays.asList("--think"),
                SessionArgs.build(null, null, null, "default", "on"));
        assertEquals(Arrays.asList("--ultrathink"),
                SessionArgs.build(null, null, null, "default", "ultra"));
    }

    @Test
    void thinkOffAndNullEmitNoFlag() {
        assertEquals(new ArrayList<String>(), SessionArgs.build(null, null, null, "default", "off"));
        assertEquals(new ArrayList<String>(), SessionArgs.build(null, null, null, "default", null));
    }

    @Test
    void modeAndThinkComposeTogether() {
        assertEquals(
                Arrays.asList("--provider", "anthropic", "--resume", "s1",
                        "--permission-mode", "acceptEdits", "--ultrathink"),
                SessionArgs.build("anthropic", null, "s1", "acceptEdits", "ultra"));
    }

    @Test
    void fullBlockPassesBaseUrlAndApiKeyInOrder() {
        assertEquals(
                Arrays.asList("--provider", "volcengine", "--model", "doubao-x",
                        "--base-url", "https://ark.cn-beijing.volces.com/api/v3",
                        "--api-key", "sk-volc", "--resume", "sess-1"),
                SessionArgs.build("volcengine", "doubao-x",
                        "https://ark.cn-beijing.volces.com/api/v3", "sk-volc",
                        "sess-1", "default", null));
    }

    @Test
    void blankBaseUrlAndApiKeyAreOmitted() {
        assertEquals(
                Arrays.asList("--provider", "ollama", "--model", "m", "--resume", "s1"),
                SessionArgs.build("ollama", "m", "  ", "", "s1", "default", null));
    }

    @Test
    void fourArgOverloadStillWorks() {
        assertEquals(new ArrayList<String>(), SessionArgs.build(null, null, null, "default"));
    }
}
