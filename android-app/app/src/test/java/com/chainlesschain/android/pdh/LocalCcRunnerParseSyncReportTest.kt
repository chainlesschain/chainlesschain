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
            invalidCount = obj.optInt("invalidCount", 0),
            kgTriples = obj.optInt("kgTripleCount", obj.optInt("kgTriples", 0)),
            ragDocs = obj.optInt("ragDocCount", obj.optInt("ragDocs", 0)),
            durationMs = obj.optLong("durationMs", 0L),
            error = obj.optString("error", "").takeIf { it.isNotEmpty() && it != "null" },
        )
    }

    @Test
    fun `parses registry-shaped report — sums entityCounts into ingested`() {
        val stdout = """
            {
              "adapter": "system-data-android",
              "status": "ok",
              "rawCount": 7,
              "entityCounts": { "events": 0, "persons": 3, "places": 0, "items": 4, "topics": 0 },
              "invalidCount": 0,
              "kgTripleCount": 12,
              "ragDocCount": 7,
              "durationMs": 421,
              "error": null,
              "watermark": null
            }
        """.trimIndent()
        val r = parse(stdout)
        assertEquals("system-data-android", r.adapter)
        assertEquals("ok", r.status)
        assertEquals(7, r.ingested)
        assertEquals(0, r.invalidCount)
        assertEquals(12, r.kgTriples)
        assertEquals(7, r.ragDocs)
        assertEquals(421L, r.durationMs)
        assertNull(r.error)
    }

    @Test
    fun `falls back to flat ingested field when entityCounts absent`() {
        val stdout = """{"adapter":"x","status":"ok","ingested":42,"durationMs":3}"""
        val r = parse(stdout)
        assertEquals(42, r.ingested)
        assertEquals(3L, r.durationMs)
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
