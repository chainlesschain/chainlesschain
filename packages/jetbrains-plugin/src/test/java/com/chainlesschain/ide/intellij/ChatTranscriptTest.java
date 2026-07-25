package com.chainlesschain.ide.intellij;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import javax.swing.SwingUtilities;
import org.junit.jupiter.api.Test;

class ChatTranscriptTest {

    @Test
    void expandCommandCollapsesAndRestoresEveryReasoningBlock() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            ChatTranscript transcript = new ChatTranscript();
            transcript.append("before\n");
            transcript.appendReasoning("first reasoning\n");
            transcript.append("middle\n");
            transcript.appendReasoning("second reasoning\n");
            transcript.append("after\n");

            String expanded = normalizedText(transcript);
            assertTrue(transcript.toggleAllReasoning());
            assertEquals(
                    "before\nthinking (collapsed)\nmiddle\n"
                            + "thinking (collapsed)\nafter\n",
                    normalizedText(transcript));

            transcript.appendReasoning("third reasoning\n");
            transcript.append("done\n");
            assertTrue(transcript.toggleAllReasoning());
            assertEquals(expanded + "third reasoning\ndone\n",
                    normalizedText(transcript));
        });
    }

    @Test
    void expandReportsNoBlocksAfterClear() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            ChatTranscript transcript = new ChatTranscript();
            transcript.appendReasoning("reasoning\n");
            transcript.clear();
            assertFalse(transcript.toggleAllReasoning());
        });
    }

    private static String normalizedText(ChatTranscript transcript) {
        return transcript.pane().getText().replace("\r\n", "\n");
    }
}
