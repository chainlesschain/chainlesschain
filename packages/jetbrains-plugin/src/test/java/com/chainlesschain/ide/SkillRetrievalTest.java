package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

final class SkillRetrievalTest {
    private static String digest(char value) {
        return "sha256:" + String.valueOf(value).repeat(64);
    }

    private static String candidate(String id, char digest, double score) {
        return "{\"id\":\"" + id + "\",\"displayName\":\"" + id
                + "\",\"namespace\":\"workspace\",\"version\":\"1.0.0\""
                + ",\"digest\":\"" + digest(digest) + "\",\"category\":\"development\""
                + ",\"contextCostTokens\":20,\"score\":" + score
                + ",\"scores\":{\"lexical\":1,\"vector\":0,\"outcome\":0.5}"
                + ",\"outcome\":{\"samples\":0,\"successRate\":0,\"correctionRate\":0}"
                + ",\"reason\":\"bm25=1.000, vector=0.000, outcome=0.500\"}";
    }

    private static String result(String selected, String candidates,
            String conflicts, String rejected) {
        return "{\"schema\":\"" + SkillRetrieval.SCHEMA
                + "\",\"query\":\"repair tests\",\"selected\":" + selected
                + ",\"candidates\":[" + candidates + "]"
                + ",\"conflicts\":[" + conflicts + "]"
                + ",\"rejected\":[" + rejected + "]"
                + ",\"vectorAvailable\":false"
                + ",\"outcomeAuthority\":{\"schema\":\""
                + SkillRetrieval.OUTCOME_AUTHORITY_SCHEMA
                + "\",\"status\":\"verified\",\"sourceDigest\":\""
                + digest('f') + "\",\"selectedSessionCount\":2"
                + ",\"receiptCount\":3,\"uniqueReceiptCount\":2"
                + ",\"attributionEligibleReceiptCount\":2"
                + ",\"outcomeEligibleReceiptCount\":2,\"duplicateReceiptCount\":1"
                + ",\"maxSessions\":128,\"maxReceipts\":10000}}";
    }

    @Test
    void buildsOnlyTheFixedReadOnlyCommand() {
        assertEquals(List.of("skill", "search", "repair tests", "--limit", "20", "--json"),
                SkillRetrieval.buildSearchArgs("  repair tests  ", 20));
        assertThrows(IllegalArgumentException.class,
                () -> SkillRetrieval.buildSearchArgs("repair", 65));
    }

    @Test
    void parsesCanonicalEvidenceAndMarksInspectionAsNonExecutable() {
        String candidate = candidate("repair-tests", 'a', 0.9);
        SkillRetrieval.Result parsed = SkillRetrieval.parseResult(
                result(candidate, candidate, "", ""));
        assertNotNull(parsed);
        assertEquals(digest('a'), parsed.selectedDigest);
        assertEquals(1, parsed.candidates.size());
        assertEquals("verified", parsed.outcomeAuthorityStatus);
        assertEquals(digest('f'), parsed.outcomeSourceDigest);
        assertTrue(SkillRetrieval.describe(parsed, parsed.candidates.get(0))
                .contains("Execution authorized: false"));
    }

    @Test
    void rejectsSelectedDriftDuplicateDigestAndInvalidScore() {
        String candidate = candidate("repair-tests", 'a', 0.9);
        assertNull(SkillRetrieval.parseResult(
                result(candidate("drift", 'b', 0.8), candidate, "", "")));
        assertNull(SkillRetrieval.parseResult(
                result(candidate, candidate + "," + candidate, "", "")));
        assertNull(SkillRetrieval.parseResult(
                result(candidate("repair-tests", 'a', 2),
                        candidate("repair-tests", 'a', 2), "", "")));
        assertNull(SkillRetrieval.parseResult(
                result("null", candidate, "", "")));
        assertNull(SkillRetrieval.parseResult(
                result(candidate("second", 'b', 0.8),
                        candidate + "," + candidate("second", 'b', 0.8), "", "")));
        assertNull(SkillRetrieval.parseResult(
                result(candidate, candidate, "", "").replace(
                        "\"selected\":" + candidate + ",", "")));
        assertNull(SkillRetrieval.parseResult(
                result(candidate, candidate, "", "").replace(
                        "\"outcomeEligibleReceiptCount\":2",
                        "\"outcomeEligibleReceiptCount\":3")));
    }

    @Test
    void preservesCanonicalConflictAbstentionAndRejections() {
        String candidate = candidate("repair-tests", 'a', 0.9);
        String conflict = "{\"type\":\"ambiguous-top-score\",\"digests\":[\""
                + digest('a') + "\",\"" + digest('b') + "\"],\"margin\":0.01}";
        String rejected = "{\"id\":\"unsafe\",\"digest\":null,"
                + "\"reasons\":[\"missing-content-digest\"]}";
        SkillRetrieval.Result parsed = SkillRetrieval.parseResult(
                result("null", candidate, conflict, rejected));
        assertNotNull(parsed);
        assertTrue(parsed.abstained());
        assertEquals(1, parsed.conflictCount);
        assertEquals(1, parsed.rejectedCount);
        String invalidConflict = "{\"type\":\"ambiguous-top-score\",\"digests\":[\""
                + digest('a') + "\",\"" + digest('a') + "\"],\"margin\":0}";
        assertNull(SkillRetrieval.parseResult(
                result("null", candidate, invalidConflict, rejected)));
    }
}
