package com.chainlesschain.android.pdh

import org.json.JSONException
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertFailsWith

/**
 * Plan A v0.1 — unit cover for [LocalCcRunner.parseSyncReport] private path
 * via a public-shimmed lookalike. The runner spawns a real Linux process,
 * so the IO surface is real-device-only; what we CAN unit-test on JVM is
 * the JSON → SyncReport mapping, since cc returns a stable shape per
 * packages/personal-data-hub/lib/registry.js.
 *
 * Mirror the structure here (cannot reflect a private function without
 * reflection-trickery, so we replicate the contract). If the production
 * parse ever drifts, sync this file too.
 */
class LocalCcRunnerParseSyncReportTest {

    /** Mirror of LocalCcRunner.parseSyncReport — kept in sync by hand. */
    private fun parse(stdout: String): LocalCcRunner.SyncReport {
        val obj = org.json.JSONObject(stdout.trim())
        val ec = obj.optJSONObject("entityCounts")
        val ingested = if (ec != null) {
            ec.optInt("persons", 0) + ec.optInt("items", 0) + ec.optInt("events", 0) +
                ec.optInt("places", 0) + ec.optInt("topics", 0)
        } else obj.optInt("ingested", 0)
        return LocalCcRunner.SyncReport(
            adapter = obj.optString("adapter", ""),
            status = obj.optString("status", "unknown"),
            ingested = ingested,
            rawCount = obj.optInt("rawCount", 0),
            archivedRawCount = obj.optInt("archivedRawCount", 0),
            archiveFailureCount = obj.optInt("archiveFailureCount", 0),
            invalidCount = obj.optInt("invalidCount", 0),
            kgTriples = obj.optInt("kgTripleCount", obj.optInt("kgTriples", 0)),
            ragDocs = obj.optInt("ragDocCount", obj.optInt("ragDocs", 0)),
            durationMs = obj.optLong("durationMs", 0L),
            error = obj.optString("error", "").takeIf { it.isNotEmpty() && it != "null" },
            watermarkDeferred = obj.optBoolean("watermarkDeferred", false),
            checkpointCommitted =
                if (obj.has("checkpointCommitted") && !obj.isNull("checkpointCommitted")) {
                    obj.optBoolean("checkpointCommitted")
                } else {
                    null
                },
            pageBudget =
                if (obj.has("pageBudget") && !obj.isNull("pageBudget")) {
                    obj.optLong("pageBudget")
                } else {
                    null
                },
            nextPageBudget =
                if (obj.has("nextPageBudget") && !obj.isNull("nextPageBudget")) {
                    obj.optLong("nextPageBudget")
                } else {
                    null
                },
            scanDeferredCount = obj.optLong("scanDeferredCount", 0L),
            watermarkLookbackMs = obj.optLong("watermarkLookbackMs", 0L),
            collectionSinceWatermark =
                obj.optString("collectionSinceWatermark", "")
                    .takeIf { it.isNotEmpty() && it != "null" },
            attemptCount = obj.optLong("attemptCount", 0L),
            retryCount = obj.optLong("retryCount", 0L),
            totalRetryDelayMs = obj.optLong("totalRetryDelayMs", 0L),
            retryExhausted = obj.optBoolean("retryExhausted", false),
            retryAfterMs =
                if (obj.has("retryAfterMs") && !obj.isNull("retryAfterMs")) {
                    obj.optLong("retryAfterMs")
                } else {
                    null
                },
            rateLimitReason =
                obj.optString("rateLimitReason", "")
                    .takeIf { it.isNotEmpty() && it != "null" },
            rateLimitRemainingMinute =
                if (obj.has("rateLimitRemainingMinute") && !obj.isNull("rateLimitRemainingMinute")) {
                    obj.optLong("rateLimitRemainingMinute")
                } else {
                    null
                },
            rateLimitRemainingDay =
                if (obj.has("rateLimitRemainingDay") && !obj.isNull("rateLimitRemainingDay")) {
                    obj.optLong("rateLimitRemainingDay")
                } else {
                    null
                },
            sourceRequestCount = obj.optLong("sourceRequestCount", 0L),
            sourceRequestThrottleMs = obj.optLong("sourceRequestThrottleMs", 0L),
            sourceRequestRateLimitRemainingMinute =
                if (
                    obj.has("sourceRequestRateLimitRemainingMinute") &&
                    !obj.isNull("sourceRequestRateLimitRemainingMinute")
                ) {
                    obj.optLong("sourceRequestRateLimitRemainingMinute")
                } else {
                    null
                },
            sourceRequestRateLimitRemainingDay =
                if (
                    obj.has("sourceRequestRateLimitRemainingDay") &&
                    !obj.isNull("sourceRequestRateLimitRemainingDay")
                ) {
                    obj.optLong("sourceRequestRateLimitRemainingDay")
                } else {
                    null
                },
        )
    }

    @Test
    fun `parses registry-shaped report — sums entityCounts into ingested`() {
        val stdout = """
            {
              "adapter": "system-data-android",
              "status": "ok",
              "rawCount": 7,
              "archivedRawCount": 7,
              "archiveFailureCount": 0,
              "entityCounts": { "events": 0, "persons": 3, "places": 0, "items": 4, "topics": 0 },
              "invalidCount": 0,
              "kgTripleCount": 12,
              "ragDocCount": 7,
              "durationMs": 421,
              "error": null,
              "watermark": null,
              "watermarkDeferred": true,
              "checkpointCommitted": true,
              "pageBudget": 10,
              "nextPageBudget": 20,
              "scanDeferredCount": 1,
              "watermarkLookbackMs": 86400000,
              "collectionSinceWatermark": "1700000000000",
              "attemptCount": 3,
              "retryCount": 2,
              "totalRetryDelayMs": 1500,
              "retryExhausted": false,
              "retryAfterMs": 45000,
              "rateLimitReason": "per_minute",
              "rateLimitRemainingMinute": 0,
              "rateLimitRemainingDay": 12,
              "sourceRequestCount": 4,
              "sourceRequestThrottleMs": 20000,
              "sourceRequestRateLimitRemainingMinute": 2,
              "sourceRequestRateLimitRemainingDay": 196
            }
        """.trimIndent()
        val r = parse(stdout)
        assertEquals("system-data-android", r.adapter)
        assertEquals("ok", r.status)
        assertEquals(7, r.ingested)
        assertEquals(7, r.rawCount)
        assertEquals(7, r.archivedRawCount)
        assertEquals(0, r.archiveFailureCount)
        assertEquals(0, r.invalidCount)
        assertEquals(12, r.kgTriples)
        assertEquals(7, r.ragDocs)
        assertEquals(421L, r.durationMs)
        assertEquals(true, r.watermarkDeferred)
        assertEquals(true, r.checkpointCommitted)
        assertEquals(10L, r.pageBudget)
        assertEquals(20L, r.nextPageBudget)
        assertEquals(1L, r.scanDeferredCount)
        assertEquals(86_400_000L, r.watermarkLookbackMs)
        assertEquals("1700000000000", r.collectionSinceWatermark)
        assertEquals(3L, r.attemptCount)
        assertEquals(2L, r.retryCount)
        assertEquals(1500L, r.totalRetryDelayMs)
        assertEquals(false, r.retryExhausted)
        assertEquals(45_000L, r.retryAfterMs)
        assertEquals("per_minute", r.rateLimitReason)
        assertEquals(0L, r.rateLimitRemainingMinute)
        assertEquals(12L, r.rateLimitRemainingDay)
        assertEquals(4L, r.sourceRequestCount)
        assertEquals(20_000L, r.sourceRequestThrottleMs)
        assertEquals(2L, r.sourceRequestRateLimitRemainingMinute)
        assertEquals(196L, r.sourceRequestRateLimitRemainingDay)
        assertNull(r.error)
    }

    @Test
    fun `falls back to flat ingested field when entityCounts absent`() {
        val stdout = """{"adapter":"x","status":"ok","ingested":42,"durationMs":3}"""
        val r = parse(stdout)
        assertEquals(42, r.ingested)
        assertEquals(3L, r.durationMs)
        assertNull(r.checkpointCommitted)
    }

    @Test
    fun `surfaces non-empty error string`() {
        val stdout = """{"adapter":"x","status":"error","error":"INPUT_PATH_REQUIRED"}"""
        val r = parse(stdout)
        assertEquals("error", r.status)
        assertEquals("INPUT_PATH_REQUIRED", r.error)
    }

    @Test
    fun `null literal error from JSON serializer becomes null SyncReport_error`() {
        // org.json normalises a JSON literal null in optString to the string
        // "null" — our parser maps that to null to match expectations.
        val stdout = """{"adapter":"x","status":"ok","error":null}"""
        val r = parse(stdout)
        assertNull(r.error)
    }

    @Test
    fun `malformed JSON throws JSONException`() {
        assertFailsWith<JSONException> {
            parse("not json")
        }
    }
}
