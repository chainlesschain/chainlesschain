package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.TranscriptCap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import javax.swing.SwingUtilities;
import org.junit.jupiter.api.Test;

class ChatTranscriptTest {

    @Test
    void transcriptExposesAStableScreenReaderNameAndDescription() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            ChatTranscript transcript = new ChatTranscript();
            assertEquals("Conversation transcript",
                    transcript.pane().getAccessibleContext().getAccessibleName());
            assertEquals(
                    "Read-only ChainlessChain agent conversation and tool activity",
                    transcript.pane().getAccessibleContext().getAccessibleDescription());
        });
    }

    @Test
    void transcriptBoundsTwoThousandMessagesAndRetainsTheNewestContent() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            ChatTranscript transcript = new ChatTranscript();
            for (int index = 0; index < 2_000; index++) {
                transcript.append(String.format("%04d:%s%n", index, "x".repeat(122)));
            }

            String text = normalizedText(transcript);
            assertTrue(text.length() <= TranscriptCap.DEFAULT_MAX_CHARS);
            assertFalse(text.contains("0000:"));
            assertTrue(text.contains("1999:"));
        });
    }

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

    @Test
    void oversizedStreamingAnswerIsBoundedBeforeFinalization() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            ChatTranscript transcript = new ChatTranscript();
            String mebibyte = "x".repeat(1024 * 1024);
            transcript.appendAssistantDelta("HEAD");
            for (int i = 0; i < 16; i++) {
                transcript.appendAssistantDelta(mebibyte);
            }
            transcript.appendAssistantDelta("TAIL");

            assertTrue(normalizedText(transcript).length()
                    <= TranscriptCap.DEFAULT_MAX_CHARS);
            transcript.finalizeAssistantRun();
            String text = normalizedText(transcript);
            assertTrue(text.length() <= TranscriptCap.DEFAULT_MAX_CHARS);
            assertTrue(text.startsWith("HEAD"));
            assertTrue(text.contains("characters omitted"));
            assertTrue(text.endsWith("TAIL"));
        });
    }

    private static String normalizedText(ChatTranscript transcript) {
        return transcript.pane().getText().replace("\r\n", "\n");
    }
}
