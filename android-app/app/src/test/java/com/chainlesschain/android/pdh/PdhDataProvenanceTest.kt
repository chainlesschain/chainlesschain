package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §3.5.11 工具→来源归属纯逻辑测试。钉死:采集/打捞/文件/系统/vault 类被标为
 * untrusted 数据并给对的来源标签;控制类(ping/list)非数据内容;null/未知降级。
 */
class PdhDataProvenanceTest {

    @Test
    fun collect_app_data_is_app_collection_untrusted() {
        val p = PdhDataProvenance.sourceOf("mcp__pdh__collect_app_data")
        assertEquals("App 采集", p.label)
        assertTrue(p.untrusted)
    }

    @Test
    fun salvage_is_forensic_untrusted() {
        val p = PdhDataProvenance.sourceOf("mcp__pdh__salvage_app_data")
        assertEquals("取证打捞", p.label)
        assertTrue(p.untrusted)
    }

    @Test
    fun files_and_read_file_map_to_file_source() {
        assertEquals("文件", PdhDataProvenance.sourceOf("mcp__pdh__collect_files").label)
        assertEquals("文件", PdhDataProvenance.sourceOf("read_file_content").label)
        assertTrue(PdhDataProvenance.sourceOf("mcp__pdh__collect_files").untrusted)
    }

    @Test
    fun system_data_source() {
        val p = PdhDataProvenance.sourceOf("mcp__pdh__collect_system_data")
        assertEquals("系统数据", p.label)
        assertTrue(p.untrusted)
    }

    @Test
    fun vault_queries_are_your_vault_untrusted() {
        // 自有 vault 内容也按"数据(非 AI 判断)"渲染(可能含当初采进来的 injection 文本)。
        for (t in listOf("query_vault", "search", "run_analysis", "event_detail", "data_overview")) {
            val p = PdhDataProvenance.sourceOf("mcp__pdh__$t")
            assertEquals("你的 vault", p.label, "tool=$t")
            assertTrue(p.untrusted, "tool=$t")
        }
    }

    @Test
    fun control_tools_are_not_untrusted_data() {
        // pdh_ping / list_collectors 不是数据内容(仍以 DATA 行渲染,但不打 ⚠)。
        val ping = PdhDataProvenance.sourceOf("pdh_ping")
        assertEquals("工具结果", ping.label)
        assertFalse(ping.untrusted)
        assertFalse(PdhDataProvenance.sourceOf("mcp__pdh__list_collectors").untrusted)
    }

    @Test
    fun null_and_blank_degrade_to_generic() {
        assertEquals("工具结果", PdhDataProvenance.sourceOf(null).label)
        assertFalse(PdhDataProvenance.sourceOf(null).untrusted)
        assertEquals("工具结果", PdhDataProvenance.sourceOf("").label)
    }

    @Test
    fun matching_is_case_insensitive() {
        assertEquals("App 采集", PdhDataProvenance.sourceOf("MCP__PDH__COLLECT_APP_DATA").label)
    }
}
