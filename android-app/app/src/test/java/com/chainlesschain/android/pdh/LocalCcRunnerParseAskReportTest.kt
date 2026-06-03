package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A3 — unit cover for [LocalCcRunner.parseAskReport] private path via a
 * public-shimmed lookalike. The cc binary writes the AnalysisEngine.ask()
 * JSON shape per packages/personal-data-hub/lib/analysis.js — answer +
 * citations array + llmName + isLocal + durationMs.
 *
 * Mirrors [LocalCcRunnerParseSyncReportTest] pattern. If the production
 * parse ever drifts, sync this file too.
 */
class LocalCcRunnerParseAskReportTest {

    /** Mirror of LocalCcRunner.parseAskReport — kept in sync by hand. */
    private fun parse(stdout: String): LocalCcRunner.AskReport {
        val obj = org.json.JSONObject(stdout.trim())
        val arr = obj.optJSONArray("citations")
        val citations = buildList {
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val asObj = arr.optJSONObject(i)
                    val eventId = asObj?.optString("eventId", "") ?: arr.optString(i, "")
                    if (eventId.isEmpty()) continue
                    add(
                        LocalCcRunner.AskReport.Citation(
                            eventId = eventId,
                            excerpt = asObj?.optString("excerpt", "")?.takeIf { it.isNotEmpty() },
                            source = asObj?.optString("source", "")?.takeIf { it.isNotEmpty() },
                        )
                    )
                }
            }
        }
        val hallucinatedCount = obj.optJSONArray("hallucinatedCitations")?.length() ?: 0
        return LocalCcRunner.AskReport(
            answer = obj.optString("answer", ""),
            citations = citations,
            llmName = obj.optString("llmName", "").takeIf { it.isNotEmpty() },
            isLocal = obj.optBoolean("isLocal", true),
            durationMs = obj.optLong("durationMs", 0L),
            hallucinatedCount = hallucinatedCount,
        )
    }

    @Test
    fun `parses full happy-path response with citations`() {
        val stdout = """
            {
              "answer": "上周妈妈给你打了 2 个电话。",
              "citations": [
                { "eventId": "evt_abc", "excerpt": "通话 · 2026-05-15", "source": "system-data-android" },
                { "eventId": "evt_def", "excerpt": "通话 · 2026-05-17", "source": "system-data-android" }
              ],
              "llmName": "ollama:qwen2.5-1.5b-instruct",
              "isLocal": true,
              "durationMs": 4200
            }
        """.trimIndent()
        val r = parse(stdout)
        assertEquals("上周妈妈给你打了 2 个电话。", r.answer)
        assertEquals(2, r.citations.size)
        assertEquals("evt_abc", r.citations[0].eventId)
        assertEquals("通话 · 2026-05-15", r.citations[0].excerpt)
        assertEquals("system-data-android", r.citations[0].source)
        assertEquals("ollama:qwen2.5-1.5b-instruct", r.llmName)
        assertTrue(r.isLocal)
        assertEquals(4200L, r.durationMs)
    }

    @Test
    fun `parses answer-only response when no citations`() {
        val stdout = """
            {
              "answer": "数据不足，无法回答。",
              "citations": [],
              "llmName": "mock-llm",
              "isLocal": true,
              "durationMs": 12
            }
        """.trimIndent()
        val r = parse(stdout)
        assertEquals("数据不足，无法回答。", r.answer)
        assertTrue(r.citations.isEmpty())
        assertEquals("mock-llm", r.llmName)
    }

    @Test
    fun `null excerpt and source coerce to null on absence or empty`() {
        val stdout = """
            {
              "answer": "x",
              "citations": [
                { "eventId": "evt_1" },
                { "eventId": "evt_2", "excerpt": "", "source": "" }
              ],
              "isLocal": true,
              "durationMs": 0
            }
        """.trimIndent()
        val r = parse(stdout)
        assertEquals(2, r.citations.size)
        assertNull(r.citations[0].excerpt)
        assertNull(r.citations[0].source)
        assertNull(r.citations[1].excerpt)
        assertNull(r.citations[1].source)
    }

    @Test
    fun `defaults when fields missing`() {
        val r = parse("""{"answer":"x"}""")
        assertEquals("x", r.answer)
        assertTrue(r.citations.isEmpty())
        assertNull(r.llmName)
        assertTrue(r.isLocal) // default true (privacy-safe)
        assertEquals(0L, r.durationMs)
    }

    @Test
    fun `isLocal=false survives parse — provenance for audit trail`() {
        val r = parse("""{"answer":"x","isLocal":false,"llmName":"cloud-bot"}""")
        assertEquals("cloud-bot", r.llmName)
        assertEquals(false, r.isLocal)
    }

    @Test
    fun `parses citations as plain string-id array (real AnalysisEngine shape)`() {
        // analysis.js 回传 citations 是 event-id 字符串数组（`known`），非对象。
        // 旧解析只认对象 → 字符串元素全丢。回归守护。
        val stdout = """
            {
              "answer": "上周妈妈给你打了 2 个电话 [evt_abc][evt_def]。",
              "citations": ["evt_abc", "evt_def"],
              "llmName": "ollama:qwen2.5",
              "isLocal": true,
              "durationMs": 4200
            }
        """.trimIndent()
        val r = parse(stdout)
        assertEquals(2, r.citations.size)
        assertEquals("evt_abc", r.citations[0].eventId)
        assertEquals("evt_def", r.citations[1].eventId)
        assertNull(r.citations[0].excerpt)  // 字符串形态没有 excerpt/source
        assertNull(r.citations[0].source)
    }

    @Test
    fun `hallucinatedCitations array length drives hallucinatedCount`() {
        val stdout = """
            {
              "answer": "你花了 ¥5000 [evt_fake_1][evt_fake_2]。",
              "citations": [],
              "hallucinatedCitations": ["evt_fake_1", "evt_fake_2"],
              "warning": "hallucinated-citations",
              "isLocal": true,
              "durationMs": 30
            }
        """.trimIndent()
        val r = parse(stdout)
        assertEquals(2, r.hallucinatedCount)
    }

    @Test
    fun `hallucinatedCount defaults to 0 when field absent (old cc binary)`() {
        // 旧 cc 不带 hallucinatedCitations 字段 — 不应误报幻觉。
        val r = parse("""{"answer":"x","citations":[{"eventId":"evt_1"}],"isLocal":true}""")
        assertEquals(0, r.hallucinatedCount)
    }

    @Test
    fun `empty hallucinatedCitations array means no hallucination`() {
        val r = parse("""{"answer":"x","hallucinatedCitations":[],"isLocal":true}""")
        assertEquals(0, r.hallucinatedCount)
    }
}
