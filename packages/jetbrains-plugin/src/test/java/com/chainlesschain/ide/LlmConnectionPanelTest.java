package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import javax.swing.*;
import java.awt.Component;
import java.awt.Container;
import static org.junit.jupiter.api.Assertions.*;

class LlmConnectionPanelTest {
    private static Component find(Container parent, String name) {
        for (Component child : parent.getComponents()) {
            if (name.equals(child.getName())) return child;
            if (child instanceof Container) {
                Component nested = find((Container) child, name);
                if (nested != null) return nested;
            }
        }
        return null;
    }

    @Test void loadsSavedValuesWithoutPuttingCredentialsInThePasswordField() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            LlmConnectionPanel panel = new LlmConnectionPanel(key -> key);
            panel.load(new LlmConfig.Connection("volcengine", "saved-model", "https://ark.cn-beijing.volces.com/api/v3", "saved-vision", true));
            assertEquals("saved-model", panel.connection().model);
            assertEquals("saved-vision", panel.connection().visionModel);
            assertEquals("", panel.apiKey());
            assertFalse(panel.needsNewKey());
            assertTrue(find(panel, "llm.test").isEnabled());
            assertFalse(find(panel, "llm.save").isEnabled());
            ((JTextField) find(panel, "llm.model")).setText("changed-model");
            assertFalse(find(panel, "llm.test").isEnabled());
            assertTrue(find(panel, "llm.save").isEnabled());
            assertFalse(panel.needsNewKey());
        });
    }

    @Test void destinationChangesRequireANewKeyAndBlankVisionIsPreserved() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            LlmConnectionPanel panel = new LlmConnectionPanel(key -> key);
            panel.load(new LlmConfig.Connection("openai", "model", "https://relay.example/v1", "vision", true));
            ((JTextField) find(panel, "llm.baseUrl")).setText("https://another.example/v1");
            assertTrue(panel.needsNewKey());
            ((JPasswordField) find(panel, "llm.apiKey")).setText("new-key");
            assertFalse(panel.needsNewKey());
            ((JTextField) find(panel, "llm.visionModel")).setText("");
            assertEquals("", panel.connection().visionModel);
            panel.setBusy(true);
            assertFalse(find(panel, "llm.save").isEnabled());
            assertFalse(find(panel, "llm.reload").isEnabled());
            assertFalse(find(panel, "llm.model").isEnabled());
            panel.clearSecret();
            assertEquals("", panel.apiKey());
        });
    }

    @Test void customRelaySupportsProtocolSelectionAndArbitraryModelAliases() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            LlmConnectionPanel panel = new LlmConnectionPanel(key -> key);
            panel.load(new LlmConfig.Connection("openai", "original", "https://api.openai.com/v1", "", true));
            ((JComboBox<?>) find(panel, "llm.provider")).setSelectedIndex(LlmConfig.PRESETS.length);
            assertTrue(find(panel, "llm.protocol").isVisible());
            ((JComboBox<?>) find(panel, "llm.protocol")).setSelectedIndex(1);
            ((JTextField) find(panel, "llm.model")).setText("team/custom-model");
            assertEquals("anthropic", panel.connection().provider);
            assertEquals("team/custom-model", panel.connection().model);
            assertTrue(panel.needsNewKey());
        });
    }

    @Test void providerIdentityAndCredentialsSurviveSavedRelayLoad() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            LlmConnectionPanel panel = new LlmConnectionPanel(key -> key);
            for (LlmConfig.Preset preset : LlmConfig.PRESETS) {
                panel.load(new LlmConfig.Connection(preset.id, "team/alias", "https://relay.example/v1", "saved-vision", true));
                assertEquals(preset.id, panel.connection().provider);
                assertEquals("team/alias", panel.connection().model);
                assertEquals("https://relay.example/v1", panel.connection().baseUrl);
                assertFalse(panel.needsNewKey());
                assertFalse(find(panel, "llm.save").isEnabled());
            }
        });
    }

    @Test void sharedRecommendationsNeverReplaceSavedGatewayAliasesOnLoad() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            LlmConnectionPanel panel = new LlmConnectionPanel(key -> key);
            panel.load(new LlmConfig.Connection("openai", "team/custom-alias", "https://relay.example/v1", "saved-vision", true));
            JComboBox<?> providers = (JComboBox<?>) find(panel, "llm.provider");
            assertEquals(LlmConfig.PRESETS.length, providers.getSelectedIndex());
            assertEquals("team/custom-alias", panel.connection().model);
            assertEquals("https://relay.example/v1", panel.connection().baseUrl);
            assertEquals("saved-vision", panel.connection().visionModel);
            assertFalse(find(panel, "llm.save").isEnabled());
            for (int i = 0; i < LlmConfig.PRESETS.length; i++) {
                if ("openai".equals(LlmConfig.PRESETS[i].id)) providers.setSelectedIndex(i);
            }
            assertEquals("gpt-6.1-sol", panel.connection().model);
            assertEquals("https://api.openai.com/v1", panel.connection().baseUrl);
            assertTrue(panel.needsNewKey());
        });
    }
}
