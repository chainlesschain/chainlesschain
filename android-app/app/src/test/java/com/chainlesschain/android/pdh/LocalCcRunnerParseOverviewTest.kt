package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * ② — unit cover for the top-level [parseOverview] (cc hub run-skill
 * analysis.overview --json → OverviewReport) used by the 数据总览 tab.
 * Plain JUnit + real org.json (same pattern as LocalCcRunnerParseAskReportTest).
 */
class LocalCcRunnerParseOverviewTest {

    @Test
    fun `parses full overview json`() {
        val json = """
            {"skill":"analysis.overview",
             "summary":{"totalEvents":5,"appsActive":3,"topAppName":"wechat-pc"},
             "byApp":[{"app":"wechat-pc","count":3},{"app":"shopping-taobao","count":2}],
             "byType":[{"type":"message","count":3},{"type":"order","count":2}],
             "topContacts":[{"personId":"p1","name":"小明","interactions":2,"byApp":{"wechat-pc":1,"social-douyin":1}}],
             "spending":{"total":100.5,"byDirection":{"out":100.5},"currency":"CNY"}}
        """.trimIndent()
        val r = parseOverview(json)
        assertEquals(5, r.totalEvents)
        assertEquals(3, r.appsActive)
        assertEquals("wechat-pc", r.topAppName)
        assertEquals("wechat-pc" to 3, r.byApp[0])
        assertEquals(2, r.byApp.size)
        assertEquals("message" to 3, r.byType[0])
        assertEquals(1, r.topContacts.size)
        assertEquals("小明", r.topContacts[0].name)
        assertEquals(2, r.topContacts[0].interactions)
        assertEquals(100.5, r.spendTotal, 0.001)
        assertEquals("CNY", r.spendCurrency)
    }

    @Test
    fun `handles missing and empty fields gracefully`() {
        val r = parseOverview("""{"summary":{}}""")
        assertEquals(0, r.totalEvents)
        assertEquals(0, r.appsActive)
        assertNull(r.topAppName)
        assertEquals(0, r.byApp.size)
        assertEquals(0, r.topContacts.size)
        assertEquals(0.0, r.spendTotal, 0.001)
        assertNull(r.spendCurrency)
    }

    @Test
    fun `null name coerces to null (not the string null)`() {
        val json = """{"summary":{"totalEvents":1},"topContacts":[{"personId":"px","interactions":1}]}"""
        val r = parseOverview(json)
        assertEquals("px", r.topContacts[0].personId)
        assertNull(r.topContacts[0].name)
    }
}
