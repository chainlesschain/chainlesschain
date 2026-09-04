package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class EvolutionWorkbenchTest {
    private static String digest(char value) {
        return "sha256:" + String.valueOf(value).repeat(64);
    }

    private static String candidate(String name, char packet, char content,
            String status, boolean active) {
        String decision = "approved".equals(status)
                ? "{\"decision\":\"approved\"}" : "null";
        return "{\"packetDigest\":\"" + digest(packet) + "\"," +
                "\"candidateId\":\"" + name + "\"," +
                "\"candidateContentDigest\":\"" + digest(content) + "\"," +
                "\"status\":\"" + status + "\",\"decision\":" + decision + "," +
                "\"why\":{\"parentContentDigest\":\"" + digest('9') + "\"}," +
                "\"changes\":{\"candidateDiffDigest\":\"" + digest('8') + "\"," +
                "\"unifiedDiff\":\"+" + name + "\"}," +
                "\"validation\":{\"matrixReceiptDigest\":\"" + digest('7') + "\"," +
                "\"targetRuntimes\":[\"cli\",\"desktop\"]}," +
                "\"actualUsage\":{\"active\":" + active + ",\"receiptCount\":3," +
                "\"completed\":2,\"failedOrBlocked\":1,\"totalCostUsd\":0.25}}";
    }

    private static String projection(String candidates) {
        int count = candidates.isEmpty() ? 0 : candidates.split("candidateId", -1).length - 1;
        return "{\"projectionDigest\":\"" + digest('a') + "\",\"total\":" +
                count + ",\"offset\":0,\"limit\":500,\"hasMore\":false," +
                "\"governance\":{\"runStatus\":\"active\"," +
                "\"activeReleaseId\":\"release:current\"," +
                "\"lastKnownGoodReleaseId\":\"release:lkg\"," +
                "\"conflictCount\":1,\"pilot\":{\"stage\":\"canary\"," +
                "\"revision\":4,\"killSwitch\":false," +
                "\"reconciliationRequired\":true}}," +
                "\"candidates\":[" + candidates + "]}";
    }

    private static EvolutionWorkbench.Projection validProjection() {
        EvolutionWorkbench.Projection result = EvolutionWorkbench.parseProjection(projection(
                candidate("active", '1', '2', "approved", true) + "," +
                candidate("target", '3', '4', "approved", false) + "," +
                candidate("pending", '5', '6', "pending", false)));
        assertNotNull(result);
        return result;
    }

    @Test
    void parsesCanonicalProjectionAndUsage() {
        EvolutionWorkbench.Projection result = validProjection();
        assertEquals(3, result.total);
        assertEquals(3, result.candidates.size());
        assertEquals("active", result.activeCandidate().candidateId);
        assertEquals(3, result.candidates.get(0).receiptCount);
        assertEquals("release:current", result.governance.activeReleaseId);
        assertEquals("release:lkg", result.governance.lastKnownGoodReleaseId);
        assertEquals("canary", result.governance.pilotStage);
        assertTrue(result.governance.reconciliationRequired);
        assertTrue(EvolutionWorkbench.describeGovernance(result.governance)
                .contains("Pilot: canary@4 RECONCILE"));
        assertTrue(EvolutionWorkbench.describe(result.candidates.get(0)).contains("+active"));
    }

    @Test
    void rejectsForgedDigestDuplicatePacketAndMalformedUsage() {
        assertNull(EvolutionWorkbench.parseProjection(
                projection(candidate("bad", '1', '2', "pending", false))
                        .replace(digest('a'), "forged")));
        String duplicate = candidate("one", '1', '2', "pending", false) + ","
                + candidate("two", '1', '3', "pending", false);
        assertNull(EvolutionWorkbench.parseProjection(projection(duplicate)));
        assertNull(EvolutionWorkbench.parseProjection(
                projection(candidate("bad", '1', '2', "pending", false))
                        .replace("\"receiptCount\":3", "\"receiptCount\":-1")));
        assertNull(EvolutionWorkbench.parseProjection(
                projection(candidate("bad", '1', '2', "pending", false))
                        .replace("\"killSwitch\":false", "\"killSwitch\":\"false\"")));
    }

    @Test
    void buildsOnlyFixedCliArguments() {
        EvolutionWorkbench.Projection projection = validProjection();
        EvolutionWorkbench.Candidate active = projection.candidates.get(0);
        EvolutionWorkbench.Candidate target = projection.candidates.get(1);
        EvolutionWorkbench.Candidate pending = projection.candidates.get(2);
        assertEquals(List.of("evolution", "workbench", "list", "--limit", "500"),
                EvolutionWorkbench.buildListArgs());
        assertEquals(List.of("evolution", "workbench", "compare",
                        active.packetDigest, target.packetDigest),
                EvolutionWorkbench.buildCompareArgs(projection, active, target));
        assertEquals(List.of("evolution", "workbench", "review", "approve",
                        pending.packetDigest, "--reason", "reviewed"),
                EvolutionWorkbench.buildReviewArgs(
                        projection, pending, "approve", " reviewed "));
        assertEquals(List.of("evolution", "workbench", "rollback",
                        active.packetDigest, target.packetDigest, "--reason", "regression"),
                EvolutionWorkbench.buildRollbackArgs(
                        projection, target, " regression "));
    }

    @Test
    void rejectsStaleReviewAndUnapprovedRollback() {
        EvolutionWorkbench.Projection projection = validProjection();
        EvolutionWorkbench.Candidate target = projection.candidates.get(1);
        EvolutionWorkbench.Candidate pending = projection.candidates.get(2);
        assertThrows(IllegalArgumentException.class, () ->
                EvolutionWorkbench.buildReviewArgs(
                        projection, target, "approve", "reviewed"));
        assertThrows(IllegalArgumentException.class, () ->
                EvolutionWorkbench.buildReviewArgs(
                        projection, pending, "approve", " "));
        assertThrows(IllegalArgumentException.class, () ->
                EvolutionWorkbench.buildReviewArgs(
                        projection, pending, "approve", "x".repeat(2_049)));
        assertThrows(IllegalArgumentException.class, () ->
                EvolutionWorkbench.buildRollbackArgs(
                        projection, pending, "regression"));
    }

    @Test
    void requiresExactlyOneActiveRollbackSource() {
        EvolutionWorkbench.Projection noActive = EvolutionWorkbench.parseProjection(projection(
                candidate("target", '3', '4', "approved", false)));
        assertNotNull(noActive);
        assertThrows(IllegalArgumentException.class, () ->
                EvolutionWorkbench.buildRollbackArgs(
                        noActive, noActive.candidates.get(0), "regression"));
        EvolutionWorkbench.Projection twoActive = EvolutionWorkbench.parseProjection(projection(
                candidate("one", '1', '2', "approved", true) + "," +
                candidate("two", '3', '4', "approved", true) + "," +
                candidate("target", '5', '6', "approved", false)));
        assertNotNull(twoActive);
        assertThrows(IllegalArgumentException.class, () ->
                EvolutionWorkbench.buildRollbackArgs(
                        twoActive, twoActive.candidates.get(2), "regression"));
    }

    @Test
    void authenticatesComparisonBindingsAndMutationReceiptShape() {
        EvolutionWorkbench.Projection projection = validProjection();
        EvolutionWorkbench.Candidate left = projection.candidates.get(0);
        EvolutionWorkbench.Candidate right = projection.candidates.get(1);
        String comparison = "{\"schema\":\"" + EvolutionWorkbench.COMPARISON_SCHEMA +
                "\",\"skillName\":\"repair-tests" +
                "\",\"sourceProjectionDigest\":\"" + projection.projectionDigest +
                "\",\"comparisonDigest\":\"" + digest('b') +
                "\",\"left\":{\"packetDigest\":\"" + left.packetDigest +
                "\",\"contentDigest\":\"" + left.contentDigest +
                "\"},\"right\":{\"packetDigest\":\"" + right.packetDigest +
                "\",\"contentDigest\":\"" + right.contentDigest + "\"}}";
        assertNotNull(EvolutionWorkbench.formatComparison(
                comparison, projection, left, right));
        assertNull(EvolutionWorkbench.formatComparison(
                comparison.replace(right.packetDigest, digest('f')),
                projection, left, right));
        assertEquals(digest('c'), EvolutionWorkbench.parseMutationPlanDigest(
                "{\"schema\":\"" + EvolutionWorkbench.BATCH_EXECUTION_SCHEMA +
                "\",\"planDigest\":\"" + digest('c') +
                "\",\"executionDigest\":\"" + digest('d') + "\"}"));
        assertNull(EvolutionWorkbench.parseMutationPlanDigest(
                "{\"schema\":\"" + EvolutionWorkbench.BATCH_EXECUTION_SCHEMA +
                "\",\"planDigest\":\"forged\",\"executionDigest\":\"" +
                digest('d') + "\"}"));
        assertNull(EvolutionWorkbench.parseMutationPlanDigest(
                "{\"planDigest\":\"" + digest('c') + "\"}"));
    }
}
