package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DiffReviewAuditTest {
    @Test
    void recordsUserEditedAcceptanceWithoutEmbeddingContents() {
        Map<String, Object> audit = DiffReviewAudit.build(
                "/ws/src/a.js",
                "old",
                "agent proposal",
                Map.of("outcome", "accepted", "finalText", "user revision"),
                Map.of(
                        "sessionId", "sess-1",
                        "turnId", "run-1:t2",
                        "toolUseId", "call-7"),
                "jetbrains",
                "local-user",
                Instant.parse("2026-07-23T00:00:00Z"));

        assertEquals("cc-diff-review/v1", audit.get("schema"));
        assertTrue(String.valueOf(audit.get("reviewId")).matches("drev_[a-f0-9]{24}"));
        assertEquals("user-edited", audit.get("source"));
        assertEquals(true, audit.get("written"));
        assertEquals("jetbrains", audit.get("host"));
        assertEquals("sess-1", audit.get("sessionId"));
        assertEquals("run-1:t2", audit.get("turnId"));
        assertEquals("call-7", audit.get("toolUseId"));
        assertEquals(false, audit.get("followUpRequested"));
        assertEquals(13, ((Map<?, ?>) audit.get("final")).get("chars"));
        assertFalse(MiniJson.stringify(audit).contains("user revision"));
    }

    @Test
    void recordsHunksAndBoundedComments() {
        Map<String, Object> audit = DiffReviewAudit.build(
                "/ws/a.js",
                "a",
                "b",
                Map.of(
                        "outcome", "changes-requested",
                        "selectedHunks", List.of(2, 0, 2, -1, "1"),
                        "comments", List.of(Map.of(
                                "line", 0, "endLine", 2,
                                "lineText", "const apiKey = 'sensitive line'",
                                "note", "Revise this"))),
                null,
                "jetbrains", "local-user", Instant.now());

        assertEquals(List.of(0, 2), audit.get("selectedHunks"));
        assertEquals(false, audit.get("written"));
        assertEquals(true, audit.get("followUpRequested"));
        assertEquals(null, audit.get("final"));
        assertEquals(1, ((List<?>) audit.get("comments")).size());
        assertFalse(MiniJson.stringify(audit).contains("sensitive line"));
        Map<?, ?> comment = (Map<?, ?>) ((List<?>) audit.get("comments")).get(0);
        assertEquals(31, ((Map<?, ?>) comment.get("lineFingerprint")).get("chars"));
    }

    @Test
    void fingerprintMatchesTheJavascriptTwin() {
        assertEquals(
                "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
                DiffReviewAudit.fingerprintText("hello").get("sha256"));
    }
}
