package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
        assertTrue(LlmConfig.looksLikeLlmConfigError("403 Forbidden"));
    }

    @Test
    void looksLikeLlmConfigErrorFalseForNonAuthAndNull() {
        assertFalse(LlmConfig.looksLikeLlmConfigError("network timeout"));
        assertFalse(LlmConfig.looksLikeLlmConfigError(null));
    }

    @Test
    void suggestVisionModelVolcengineDistinctOthersBlank() {
        assertEquals("doubao-seed-2-0-lite-260215", LlmConfig.suggestVisionModel("volcengine"));
        assertEquals("", LlmConfig.suggestVisionModel("ollama"));
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
