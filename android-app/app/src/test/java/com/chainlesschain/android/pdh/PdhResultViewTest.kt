package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * §3.5.12 工具→视图种类纯逻辑测试。钉死:分析/查询类→对应 ViewKind(可信视图);
 * 采集/打捞/文件/系统→null(走 §3.5.11 不可信 DATA);run_analysis(skill) 看 input。
 */
class PdhResultViewTest {

    @Test
    fun overview_tools_map_to_overview() {
        assertEquals(ViewKind.OVERVIEW, PdhResultView.viewKindOf("mcp__pdh__data_overview"))
        assertEquals(ViewKind.OVERVIEW, PdhResultView.viewKindOf("analysis.overview"))
    }

    @Test
    fun analysis_skills_by_name() {
        assertEquals(ViewKind.TIMELINE, PdhResultView.viewKindOf("analysis.timeline"))
        assertEquals(ViewKind.INTERESTS, PdhResultView.viewKindOf("analysis.interests"))
        assertEquals(ViewKind.SPENDING, PdhResultView.viewKindOf("analysis.spending"))
        assertEquals(ViewKind.RELATIONS, PdhResultView.viewKindOf("analysis.relations"))
        assertEquals(ViewKind.RELATIONS, PdhResultView.viewKindOf("analysis.footprint"))
    }

    @Test
    fun run_analysis_reads_skill_from_input() {
        assertEquals(
            ViewKind.INTERESTS,
            PdhResultView.viewKindOf("run_analysis", """{"skill":"interests"}"""),
        )
        assertEquals(
            ViewKind.SPENDING,
            PdhResultView.viewKindOf("run_analysis", """{"skill":"spending"}"""),
        )
    }

    @Test
    fun query_and_search_are_hits() {
        assertEquals(ViewKind.HITS, PdhResultView.viewKindOf("query_vault"))
        assertEquals(ViewKind.HITS, PdhResultView.viewKindOf("mcp__pdh__search"))
        assertEquals(ViewKind.HITS, PdhResultView.viewKindOf("event_detail"))
    }

    @Test
    fun raw_data_tools_are_not_views() {
        // §3.5.11 path: 采集/打捞/文件/系统 → null(不可信 DATA,不当可信视图)
        assertNull(PdhResultView.viewKindOf("mcp__pdh__collect_app_data"))
        assertNull(PdhResultView.viewKindOf("mcp__pdh__salvage_app_data"))
        assertNull(PdhResultView.viewKindOf("mcp__pdh__collect_files"))
        assertNull(PdhResultView.viewKindOf("read_file_content"))
        assertNull(PdhResultView.viewKindOf("mcp__pdh__collect_system_data"))
    }

    @Test
    fun collect_keyword_not_hijacked_into_a_view() {
        // 即便采集工具名/输入里恰含 "overview" 之类,也仍是原始数据(DATA)。
        assertNull(PdhResultView.viewKindOf("mcp__pdh__collect_app_data", """{"note":"overview"}"""))
    }

    @Test
    fun unknown_and_null_are_not_views() {
        assertNull(PdhResultView.viewKindOf("pdh_ping"))
        assertNull(PdhResultView.viewKindOf(null))
        assertNull(PdhResultView.viewKindOf(""))
    }

    @Test
    fun labels_present_for_all_kinds() {
        for (k in ViewKind.values()) {
            assert(PdhResultView.label(k).isNotBlank()) { "missing label for $k" }
        }
        assertEquals("数据全貌", PdhResultView.label(ViewKind.OVERVIEW))
    }
}
