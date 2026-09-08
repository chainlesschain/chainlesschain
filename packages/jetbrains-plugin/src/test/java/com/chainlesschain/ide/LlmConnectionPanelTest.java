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
}
