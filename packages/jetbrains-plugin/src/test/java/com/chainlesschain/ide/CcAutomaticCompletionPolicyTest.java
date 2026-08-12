package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

final class CcAutomaticCompletionPolicyTest {

    @Test
    void automaticModeDefaultsAreBounded() {
        CcAutomaticCompletionPolicy.Options options =
                CcAutomaticCompletionPolicy.Options.defaults();
        assertEquals(650, options.debounceMs);
        assertEquals(60, options.maxRequestsPerHour);
        assertEquals(240_000, options.maxContextCharsPerHour);
        assertEquals(800, options.maxCompletionChars);
        assertEquals(12, options.maxCompletionLines);
    }

    @Test
    void contextEligibilityAvoidsWhitespaceAndTinyFragments() {
        assertFalse(CcAutomaticCompletionPolicy.isContextEligible(""));
        assertFalse(CcAutomaticCompletionPolicy.isContextEligible("x"));
        assertFalse(CcAutomaticCompletionPolicy.isContextEligible("const value "));
        assertTrue(CcAutomaticCompletionPolicy.isContextEligible("const value"));
    }

    @Test
    void completionQualityRejectsProseDuplicatesAndOversizeResults() {
        CcAutomaticCompletionPolicy.Options options = new CcAutomaticCompletionPolicy.Options(
                650, 30_000, 64, 60, 240_000, 20, 2);
        assertFalse(CcAutomaticCompletionPolicy.isCompletionUsable(
                "Here is the completion", "", options));
        assertFalse(CcAutomaticCompletionPolicy.isCompletionUsable(
                "value", "value;", options));
        assertFalse(CcAutomaticCompletionPolicy.isCompletionUsable(
                "one\ntwo\nthree", "", options));
        assertFalse(CcAutomaticCompletionPolicy.isCompletionUsable(
                "x".repeat(33), "", options));
        assertTrue(CcAutomaticCompletionPolicy.isCompletionUsable(
                "nextValue", ";", options));
    }

    @Test
    void rollingBudgetExpiresAfterOneHour() {
        AtomicLong now = new AtomicLong();
        CcAutomaticCompletionPolicy policy =
                new CcAutomaticCompletionPolicy(now::get);
        CcAutomaticCompletionPolicy.Options options = new CcAutomaticCompletionPolicy.Options(
                650, 30_000, 64, 2, 1000, 800, 12);
        assertTrue(policy.reserve(500, options));
        assertTrue(policy.reserve(500, options));
        assertFalse(policy.reserve(1, options));
        assertEquals(1, policy.metrics().budgetRejects);
        now.set(3_600_001L);
        assertTrue(policy.reserve(500, options));
    }

    @Test
    void exactContextCacheUsesTtlAndDoesNotSpendAnotherRequest() {
        AtomicLong now = new AtomicLong(1000);
        CcAutomaticCompletionPolicy policy =
                new CcAutomaticCompletionPolicy(now::get);
        CcAutomaticCompletionPolicy.Options options = new CcAutomaticCompletionPolicy.Options(
                650, 1000, 2, 60, 240_000, 800, 12);
        String key = CcAutomaticCompletionPolicy.key("abc", "def", "java");
        assertTrue(policy.reserve(6, options));
        assertTrue(policy.recordLatency(42));
        policy.store(key, "value", options);
        assertEquals("value", policy.cached(key, options));
        assertEquals(1, policy.metrics().requests);
        assertEquals(1, policy.metrics().cacheHits);
        now.set(2001);
        assertEquals("", policy.cached(key, options));
    }

    @Test
    void latencyMetricsUseNearestRankP50AndP95() {
        CcAutomaticCompletionPolicy policy = new CcAutomaticCompletionPolicy();
        CcAutomaticCompletionPolicy.Options options =
                CcAutomaticCompletionPolicy.Options.defaults();
        for (int i = 1; i <= 20; i++) {
            assertTrue(policy.recordLatency(i * 10L));
            policy.store("key-" + i, "value", options);
        }
        assertEquals(100, policy.metrics().p50Ms);
        assertEquals(190, policy.metrics().p95Ms);
        assertEquals(20, policy.metrics().samples);
        assertTrue(policy.metrics().sloEvaluable);
        assertTrue(policy.metrics().sloMet);
    }

    @Test
    void inFlightDedupAndSlowResponseFallbackAreExplicit() {
        CcAutomaticCompletionPolicy policy = new CcAutomaticCompletionPolicy();
        assertTrue(policy.begin("same"));
        assertFalse(policy.begin("same"));
        assertEquals(1, policy.metrics().dedupeHits);
        policy.end("same");
        assertTrue(policy.begin("same"));
        policy.end("same");

        assertFalse(policy.recordLatency(CcAutomaticCompletionPolicy.SLO_P95_MS + 1));
        assertEquals(1, policy.metrics().sloRejects);
    }
}
