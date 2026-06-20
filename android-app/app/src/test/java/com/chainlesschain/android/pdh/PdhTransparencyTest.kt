package com.chainlesschain.android.pdh

import com.chainlesschain.android.pdh.PdhTransparency.ActionEntry
import com.chainlesschain.android.pdh.PdhTransparency.EgressEntry
import com.chainlesschain.android.pdh.PdhTransparency.ProfileItem
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §3.5.18 透明度审计纯逻辑测试:过滤(按类别/动作)+ 时间倒序 + 诚实摘要(0 也如实)。
 */
class PdhTransparencyTest {

    private val egress = listOf(
        EgressEntry(100, "interests", "cloud", "CLOUD_ANDROID"),
        EgressEntry(300, "spending", "desktop", "PC_LOCAL"),
        EgressEntry(200, "interests", "cloud", "CLOUD_ANDROID"),
    )

    @Test
    fun egress_sorted_newest_first() {
        val all = PdhTransparency.filterEgress(egress)
        assertEquals(listOf(300L, 200L, 100L), all.map { it.epochMs })
    }

    @Test
    fun egress_filter_by_category() {
        val interests = PdhTransparency.filterEgress(egress, "interests")
        assertEquals(2, interests.size)
        assertTrue(interests.all { it.category == "interests" })
        // 倒序
        assertEquals(listOf(200L, 100L), interests.map { it.epochMs })
    }

    @Test
    fun action_filter_and_sort() {
        val actions = listOf(
            ActionEntry(10, "send_message", "妈妈", "ok", "user"),
            ActionEntry(30, "make_call", "爸爸", "ok", "user"),
            ActionEntry(20, "send_message", "同事", "failed", "user"),
        )
        val sends = PdhTransparency.filterActions(actions, "send_message")
        assertEquals(2, sends.size)
        assertEquals(listOf(20L, 10L), sends.map { it.epochMs })
        assertEquals(3, PdhTransparency.filterActions(actions).size)
    }

    @Test
    fun honest_summaries_report_zero_truthfully() {
        assertEquals("尚无数据出过端", PdhTransparency.egressSummary(emptyList()))
        assertEquals("AI 还没替你办过事", PdhTransparency.actionSummary(emptyList()))
        assertEquals("AI 还没学到关于你的偏好", PdhTransparency.profileSummary(emptyList()))
    }

    @Test
    fun summaries_count_when_nonempty() {
        assertTrue(PdhTransparency.egressSummary(egress).contains("3"))
        assertTrue(
            PdhTransparency.profileSummary(listOf(ProfileItem("1", "外卖=美团+饿了么")))
                .contains("1"),
        )
    }
}
