package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.MiniJson;
import com.chainlesschain.ide.SessionProjection;
import com.chainlesschain.ide.SessionsWorkbench;

import org.junit.jupiter.api.Test;

import javax.swing.SwingUtilities;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Required SESSION-UX evidence over the real Java projection and Swing transcript. */
final class SessionUxEvidenceTest {

    @Test
    void measuresCanonicalProjectionAndThinkingCollapse() throws Exception {
        String projectionInput = System.getenv("CC_SESSION_UX_PROJECTION");
        String evidenceOutput = System.getenv("CC_SESSION_UX_JETBRAINS_EVIDENCE");
        if (projectionInput == null || projectionInput.isBlank()
                || evidenceOutput == null || evidenceOutput.isBlank()) {
            assertFalse("true".equals(System.getenv("CC_SESSION_UX_REQUIRED")),
                    "required SESSION-UX evidence must configure its input paths");
            return;
        }
        assertEquals("true", System.getenv("CC_SESSION_UX_REQUIRED"));

        byte[] projectionBytes = Files.readAllBytes(Path.of(projectionInput));
        String projectionJson = new String(projectionBytes, StandardCharsets.UTF_8);
        SessionProjection.Snapshot snapshot = SessionProjection.parse(projectionJson);
        List<SessionsWorkbench.Row> rows = SessionsWorkbench.projectionRows(snapshot);
        List<SessionsWorkbench.Row> focused = SessionsWorkbench.focusRows(rows);
        long grouped = rows.stream().filter(row -> !row.groupId.isEmpty()).count();
        SessionsWorkbench.Row focus = focused.isEmpty() ? null : focused.get(0);

        assertTrue(snapshot.connected);
        assertTrue(snapshot.groupsConnected);
        assertEquals(128, rows.size());
        assertEquals(1, snapshot.groups.size());
        assertEquals(128L, grouped);
        assertEquals(1, focused.size());
        assertEquals("Publish the canonical fragment?", focus.focus.pendingQuestion);
        assertEquals("Only after exact-head verification", focus.focus.settledAnswer);

        boolean[] reasoning = new boolean[3];
        SwingUtilities.invokeAndWait(() -> {
            ChatTranscript transcript = new ChatTranscript();
            transcript.beginTurn();
            transcript.appendReasoning("bounded SESSION-UX reasoning\n");
            reasoning[0] = normalizedTranscriptText(transcript).contains(
                    "bounded SESSION-UX reasoning");
            transcript.collapseCompletedReasoning();
            String collapsed = normalizedTranscriptText(transcript);
            reasoning[1] = collapsed.contains("thinking (collapsed)\n")
                    && !collapsed.contains("bounded SESSION-UX reasoning");
            boolean toggled = transcript.toggleAllReasoning();
            reasoning[2] = toggled && normalizedTranscriptText(transcript).contains(
                    "bounded SESSION-UX reasoning\n");
        });
        int thinkingFailures = 0;
        for (boolean result : reasoning) if (!result) thinkingFailures += 1;
        assertEquals(0, thinkingFailures,
                "reasoning states expanded=" + reasoning[0]
                        + ", collapsed=" + reasoning[1]
                        + ", restored=" + reasoning[2]);

        String headSha = requiredEnvironment("ACCESSIBILITY_PERFORMANCE_COMMIT");
        String artifactName = requiredEnvironment("CC_P2_ARTIFACT");
        Map<String, Object> source = new LinkedHashMap<>();
        source.put("workflowId", requiredEnvironment("GITHUB_WORKFLOW_REF"));
        source.put("runId", requiredEnvironment("GITHUB_RUN_ID"));
        source.put("jobId", requiredEnvironment("GITHUB_JOB"));
        source.put("artifactName", artifactName);

        Map<String, Object> measurements = new LinkedHashMap<>();
        measurements.put("projectionConnected", snapshot.connected);
        measurements.put("sessionCount", rows.size());
        measurements.put("groupCount", snapshot.groups.size());
        measurements.put("groupRevisionPreserved",
                snapshot.groupsConnected && snapshot.groupRevision.startsWith("sha256:"));
        measurements.put("groupedSessionCount", grouped);
        measurements.put("focusRowCount", focused.size());
        measurements.put("pendingQuestionPreserved",
                focus != null && "Publish the canonical fragment?".equals(
                        focus.focus.pendingQuestion));
        measurements.put("settledAnswerPreserved",
                focus != null && "Only after exact-head verification".equals(
                        focus.focus.settledAnswer));
        measurements.put("reasoningExpandedBeforeSettlement", reasoning[0]);
        measurements.put("reasoningCollapsedAfterSettlement", reasoning[1]);
        measurements.put("reasoningRestoredAfterToggle", reasoning[2]);
        measurements.put("thinkingCollapseFailureCount", thinkingFailures);

        Map<String, Object> evidence = new LinkedHashMap<>();
        evidence.put("schema", "chainlesschain.session-ux-jetbrains-evidence.v1");
        evidence.put("headSha", headSha);
        evidence.put("platform", platform());
        evidence.put("javaVersion", System.getProperty("java.version"));
        evidence.put("javaArch", System.getProperty("os.arch"));
        evidence.put("source", source);
        evidence.put("projectionDigest", sha256(projectionBytes));
        evidence.put("projectionRevision", snapshot.revision);
        evidence.put("groupRevision", snapshot.groupRevision);
        evidence.put("measurements", measurements);

        Path output = Path.of(evidenceOutput).toAbsolutePath();
        if (output.getParent() != null) Files.createDirectories(output.getParent());
        Files.writeString(output, MiniJson.stringify(evidence) + "\n",
                StandardCharsets.UTF_8);
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        assertTrue(value != null && !value.isBlank(), name);
        assertFalse("local".equals(value), name);
        return value;
    }

    /** Swing text components expose native CRLF on some Windows runtimes.
     * Evidence assertions concern the logical transcript, whose writer always
     * uses a single newline boundary. */
    private static String normalizedTranscriptText(ChatTranscript transcript) {
        return transcript.pane().getText()
                .replace("\r\n", "\n")
                .replace('\r', '\n');
    }

    private static String platform() {
        String value = System.getProperty("os.name", "").toLowerCase();
        if (value.contains("win")) return "win32";
        if (value.contains("mac")) return "darwin";
        if (value.contains("linux")) return "linux";
        throw new IllegalStateException("unsupported SESSION-UX operating system: " + value);
    }

    private static String sha256(byte[] bytes) throws Exception {
        byte[] value = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder result = new StringBuilder("sha256:");
        for (byte item : value) result.append(String.format("%02x", item));
        return result.toString();
    }
}
