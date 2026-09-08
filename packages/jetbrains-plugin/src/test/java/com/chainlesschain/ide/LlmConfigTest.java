package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure (parse/build) parts of {@link LlmConfig}. */
class LlmConfigTest {

    @Test
    void parseLlmProviderModelExtractsBothFields() {
        String[] full = LlmConfig.parseLlmProviderModel(
                "{\"llm\":{\"provider\":\"volcengine\",\"model\":\"doubao-seed-1-6\"}}");
        assertEquals("volcengine", full[0]);
        assertEquals("doubao-seed-1-6", full[1]);
    }

    @Test
    void parseLlmProviderModelProviderOnlyLeavesModelNull() {
        String[] provOnly = LlmConfig.parseLlmProviderModel("{\"llm\":{\"provider\":\"ollama\"}}");
        assertEquals("ollama", provOnly[0]);
        assertNull(provOnly[1]);
    }

    @Test
    void parseLlmProviderModelBlankBecomesNull() {
        assertNull(LlmConfig.parseLlmProviderModel("{\"llm\":{\"provider\":\"  \"}}")[0]);
    }

    @Test
    void parseLlmProviderModelNoLlmOrBadJsonYieldsNulls() {
        assertNull(LlmConfig.parseLlmProviderModel("{}")[0]);
        assertNull(LlmConfig.parseLlmProviderModel("not json")[0]);
    }

    @Test
    void looksLikeLlmConfigErrorTrueForAuthAndKeyFailures() {
        assertTrue(LlmConfig.looksLikeLlmConfigError("Anthropic error: 401"));
        assertTrue(LlmConfig.looksLikeLlmConfigError("ANTHROPIC_API_KEY required"));
        assertTrue(LlmConfig.looksLikeLlmConfigError(
                "HTTP 403 — authentication failed: API key missing or invalid"));
    }

    @Test
    void looksLikeLlmConfigErrorFalseForNonAuthAndNull() {
        assertFalse(LlmConfig.looksLikeLlmConfigError("network timeout"));
        assertFalse(LlmConfig.looksLikeLlmConfigError("403 Forbidden"));
        assertFalse(LlmConfig.looksLikeLlmConfigError(
                "volcengine API error: HTTP 403 — AccountOverdueError: overdue balance"));
        assertFalse(LlmConfig.looksLikeLlmConfigError(
                "HTTP 403 — check model access permissions"));
        assertFalse(LlmConfig.looksLikeLlmConfigError(null));
    }

    @Test
    void suggestVisionModelVolcengineDistinctOthersBlank() {
        assertEquals("doubao-seed-2-0-lite-260215", LlmConfig.suggestVisionModel("volcengine"));
        assertEquals("", LlmConfig.suggestVisionModel("ollama"));
    }

    @Test
    void volcenginePresetUsesRequestedDefaultModel() {
        for (LlmConfig.Preset preset : LlmConfig.PRESETS) {
            if ("volcengine".equals(preset.id)) {
                assertEquals("deepseek-v4-flash-260425", preset.defaultModel);
                return;
            }
        }
        throw new AssertionError("volcengine preset missing");
    }

    @Test
    void buildConfigSetArgsEmitsVisionModelWhenPresent() {
        List<List<String>> withVis = LlmConfig.buildConfigSetArgs(
                "volcengine", "doubao-seed-1-6", "k", "https://x", "doubao-vision");
        boolean hasVision = false;
        for (List<String> s : withVis) {
            if (s.size() >= 4 && "llm.visionModel".equals(s.get(2)) && "doubao-vision".equals(s.get(3))) {
                hasVision = true;
            }
        }
        assertTrue(hasVision);
    }

    @Test
    void buildConfigSetArgsOmitsBlankVisionModel() {
        int noVis = LlmConfig.buildConfigSetArgs("ollama", "m", "", "u", "").size();
        int yesVis = LlmConfig.buildConfigSetArgs("ollama", "m", "", "u", "v").size();
        assertEquals(noVis + 1, yesVis);
    }

    @Test
    void connectionUsesOneAtomicStdinWriteAndRedactedReadback() {
        List<List<String>> calls = new ArrayList<List<String>>();
        List<String> inputs = new ArrayList<String>();
        String apiKey = "key with & shell characters";

        String error = LlmConfig.applyConfig(
                "volcengine", "deepseek-v4-flash-260425", apiKey,
                "https://ark.cn-beijing.volces.com/api/v3", null,
                (args, stdin) -> {
                    calls.add(new ArrayList<String>(args));
                    inputs.add(stdin);
                    return new LlmConfig.CliResult(true, args.get(0).equals("llm") ? "{\"ok\":true}"
                            : "{\"llm\":{\"provider\":\"volcengine\",\"model\":\"deepseek-v4-flash-260425\",\"baseUrl\":\"https://ark.cn-beijing.volces.com/api/v3\",\"visionModel\":null,\"apiKey\":\"[REDACTED]\"}}");
                });

        assertNull(error);
        assertEquals(2, calls.size());
        assertEquals(java.util.Arrays.asList("llm", "configure"), calls.get(0));
        assertEquals(java.util.Arrays.asList("config", "list", "--json"), calls.get(1));
        for (List<String> args : calls) assertFalse(args.contains(apiKey));
        assertEquals(apiKey, MiniJson.parseObject(inputs.get(0)).get("apiKey"));
        assertEquals("", MiniJson.parseObject(inputs.get(0)).get("visionModel"));
        assertNull(inputs.get(1));
    }

    @Test
    void failedAtomicSaveDoesNotRunOtherWritesOrEchoTheKey() {
        List<List<String>> calls = new ArrayList<>();
        String error = LlmConfig.saveConnection(new LlmConfig.Connection("openai", "custom", "https://relay.example/v1", "", false), "private-key", false,
                (args, stdin) -> { calls.add(args); return new LlmConfig.CliResult(false, "write failed: private-key"); });
        assertEquals(1, calls.size());
        assertNotNull(error);
        assertFalse(error.contains("private-key"));
    }

    @Test
    void successfulExitWithoutMatchingReadbackIsNotReportedAsSaved() {
        String error = LlmConfig.saveConnection(new LlmConfig.Connection("openai", "new-model", "https://relay.example/v1", "", false), "", false,
                (args, stdin) -> new LlmConfig.CliResult(true, args.get(0).equals("llm") ? "{\"ok\":true}"
                        : "{\"llm\":{\"provider\":\"openai\",\"model\":\"old-model\",\"baseUrl\":\"https://relay.example/v1\",\"apiKey\":\"[REDACTED]\"}}"));
        assertNotNull(error);
        assertTrue(error.contains("readback differs"));
    }

    @Test
    void remoteHttpAndSpecificOperationPathsAreRejectedBeforeWriting() {
        assertNotNull(LlmConfig.validateConnection(new LlmConfig.Connection("openai", "m", "http://relay.example/v1", "", false), false));
        assertNull(LlmConfig.validateConnection(new LlmConfig.Connection("openai", "m", "http://relay.example/v1", "", false), true));
        assertNotNull(LlmConfig.validateConnection(new LlmConfig.Connection("openai", "m", "https://relay.example/v1/chat/completions", "", false), true));
        assertNull(LlmConfig.validateConnection(new LlmConfig.Connection("ollama", "m", "http://localhost:11434", "", false), false));
    }

    @Test
    void presetsAreStructurallyWellFormed() {
        // Structural only — do NOT assert on the display-name label strings.
        assertTrue(LlmConfig.PRESETS.length > 0);
        for (LlmConfig.Preset p : LlmConfig.PRESETS) {
            assertNotNull(p.id);
            assertFalse(p.id.isEmpty());
            assertNotNull(p.baseUrl);
            assertTrue(p.baseUrl.startsWith("http"));
            assertNotNull(p.defaultModel);
            assertFalse(p.defaultModel.isEmpty());
        }
    }

    @Test
    void ollamaPresetNeedsNoKeyWhileVolcengineDoes() {
        LlmConfig.Preset ollama = null;
        LlmConfig.Preset volc = null;
        for (LlmConfig.Preset p : LlmConfig.PRESETS) {
            if ("ollama".equals(p.id)) ollama = p;
            if ("volcengine".equals(p.id)) volc = p;
        }
        assertNotNull(ollama);
        assertNotNull(volc);
        assertFalse(ollama.needsKey);
        assertTrue(volc.needsKey);
    }
}
