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
        return result(selected, candidates, conflicts, rejected,
                "{\"schema\":\"" + SkillRetrieval.OUTCOME_AUTHORITY_SCHEMA
                + "\",\"status\":\"verified\",\"sourceDigest\":\""
                + digest('f') + "\",\"selectedSessionCount\":2"
                + ",\"receiptCount\":3,\"uniqueReceiptCount\":2"
                + ",\"attributionEligibleReceiptCount\":2"
                + ",\"outcomeEligibleReceiptCount\":2,\"duplicateReceiptCount\":1"
                + ",\"maxSessions\":128,\"maxReceipts\":10000}");
    }

    private static String result(String selected, String candidates,
            String conflicts, String rejected, String outcomeAuthority) {
        return result(selected, candidates, conflicts, rejected, outcomeAuthority,
                "{\"schema\":\"" + SkillRetrieval.VECTOR_AUTHORITY_SCHEMA
                + "\",\"status\":\"unavailable\""
                + ",\"code\":\"CC_SKILL_VECTOR_AUTHORITY_UNCONFIGURED\"}");
    }

    private static String result(String selected, String candidates,
            String conflicts, String rejected, String outcomeAuthority,
            String vectorAuthority) {
        return "{\"schema\":\"" + SkillRetrieval.SCHEMA
                + "\",\"query\":\"repair tests\",\"selected\":" + selected
                + ",\"candidates\":[" + candidates + "]"
                + ",\"conflicts\":[" + conflicts + "]"
                + ",\"rejected\":[" + rejected + "]"
                + ",\"vectorAvailable\":false"
                + ",\"outcomeAuthority\":" + outcomeAuthority
                + ",\"vectorAuthority\":" + vectorAuthority + "}";
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
        assertEquals("unavailable", parsed.vectorAuthorityStatus);
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

    @Test
    void acceptsOnlyWitnessedBoundedOutcomeIndexes() {
        String candidate = candidate("repair-tests", 'a', 0.9);
        String indexed = "{\"schema\":\"" + SkillRetrieval.INDEX_OUTCOME_AUTHORITY_SCHEMA
                + "\",\"status\":\"verified-indexed\",\"sourceDigest\":\""
                + digest('e') + "\",\"sourceCount\":2,\"snapshotCount\":2"
                + ",\"versionCount\":3,\"outcomeSampleCount\":21"
                + ",\"maxSources\":128,\"maxVersions\":10000"
                + ",\"antiRollbackWitness\":true}";
        SkillRetrieval.Result parsed = SkillRetrieval.parseResult(
                result(candidate, candidate, "", "", indexed));
        assertNotNull(parsed);
        assertEquals("verified-indexed", parsed.outcomeAuthorityStatus);
        assertEquals(digest('e'), parsed.outcomeSourceDigest);
        assertNull(SkillRetrieval.parseResult(result(candidate, candidate, "", "",
                indexed.replace("\"antiRollbackWitness\":true",
                        "\"antiRollbackWitness\":false"))));
        assertNull(SkillRetrieval.parseResult(result(candidate, candidate, "", "",
                indexed.replace("\"snapshotCount\":2", "\"snapshotCount\":3"))));
        assertNull(SkillRetrieval.parseResult(result(candidate, candidate, "", "",
                indexed.replace("\"versionCount\":3", "\"versionCount\":10001"))));
        assertNull(SkillRetrieval.parseResult(result(candidate, candidate, "", "",
                indexed.replace("\"outcomeSampleCount\":21",
                        "\"outcomeSampleCount\":9007199254740992"))));
        String unavailable = "{\"schema\":\""
                + SkillRetrieval.INDEX_OUTCOME_AUTHORITY_SCHEMA
                + "\",\"status\":\"unavailable\""
                + ",\"code\":\"CC_SKILL_OUTCOME_INDEX_BACKFILL_REQUIRED\""
                + ",\"antiRollbackWitness\":false}";
        assertNotNull(SkillRetrieval.parseResult(
                result(candidate, candidate, "", "", unavailable)));
        assertNull(SkillRetrieval.parseResult(result(candidate, candidate, "", "",
                unavailable.replace("false", "true"))));
    }

    @Test
    void explicitlyValidatesVectorAuthorityEvidence() {
        String candidate = candidate("repair-tests", 'a', 0.9);
        String outcome = "{\"schema\":\"" + SkillRetrieval.OUTCOME_AUTHORITY_SCHEMA
                + "\",\"status\":\"verified\",\"sourceDigest\":\""
                + digest('f') + "\",\"selectedSessionCount\":2"
                + ",\"receiptCount\":3,\"uniqueReceiptCount\":2"
                + ",\"attributionEligibleReceiptCount\":2"
                + ",\"outcomeEligibleReceiptCount\":2,\"duplicateReceiptCount\":1"
                + ",\"maxSessions\":128,\"maxReceipts\":10000}";
        String vector = "{\"schema\":\"" + SkillRetrieval.VECTOR_AUTHORITY_SCHEMA
                + "\",\"status\":\"verified\",\"tenantId\":\"tenant:ide\""
                + ",\"requestDigest\":\"" + digest('1') + "\""
                + ",\"corpusDigest\":\"" + digest('2') + "\""
                + ",\"skillCount\":1,\"modelId\":\"embedding:text-v1\""
                + ",\"modelRevision\":\"revision:7\",\"indexDigest\":\""
                + digest('3') + "\",\"resultDigest\":\"" + digest('4') + "\""
                + ",\"receiptDigest\":\"" + digest('5') + "\"}";
        String verified = result(candidate, candidate, "", "", outcome, vector)
                .replace("\"vectorAvailable\":false", "\"vectorAvailable\":true");
        SkillRetrieval.Result parsed = SkillRetrieval.parseResult(verified);
        assertNotNull(parsed);
        assertEquals("verified", parsed.vectorAuthorityStatus);
        assertEquals("embedding:text-v1@revision:7", parsed.vectorModel);
        assertEquals(digest('3'), parsed.vectorIndexDigest);
        assertNull(SkillRetrieval.parseResult(verified.replace(
                "\"receiptDigest\":\"" + digest('5') + "\"",
                "\"receiptDigest\":\"forged\"")));
        assertNull(SkillRetrieval.parseResult(verified.replace(
                "\"skillCount\":1", "\"skillCount\":10001")));
        assertNull(SkillRetrieval.parseResult(verified.replace(
                "\"tenantId\":\"tenant:ide\"", "\"tenantId\":\"../tenant\"")));
        assertNull(SkillRetrieval.parseResult(verified.replace(
                "\"receiptDigest\":", "\"injectedClaim\":true,\"receiptDigest\":")));
        assertNull(SkillRetrieval.parseResult(result(candidate, candidate, "", "")
                .replace("\"vectorAvailable\":false", "\"vectorAvailable\":true")));
    }
}
