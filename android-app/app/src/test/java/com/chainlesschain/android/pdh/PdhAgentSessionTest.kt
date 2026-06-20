package com.chainlesschain.android.pdh

import com.chainlesschain.android.pdh.PdhAgentSession.PdhAgentEvent
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Headless tests for the pure NDJSON parser at the heart of [PdhAgentSession]
 * (`cc agent` stream-json output → typed events). The process/IPC side is
 * device-validated; this nails the event-shape mapping that schema drift would
 * silently break.
 */
class PdhAgentSessionTest {

    @Test
    fun text_event_yields_text() {
        assertEquals(
            PdhAgentEvent.Text("你好"),
            PdhAgentSession.parseLine("""{"type":"text","text":"你好"}"""),
        )
    }

    @Test
    fun assistant_message_content_array_extracts_text_blocks() {
        val line =
            """{"type":"assistant","message":{"content":[{"type":"text","text":"a"},""" +
                """{"type":"tool_use","name":"x"},{"type":"text","text":"b"}]}}"""
        assertEquals(PdhAgentEvent.Text("ab"), PdhAgentSession.parseLine(line))
    }

    @Test
    fun tool_use_yields_name_and_input() {
        val e = PdhAgentSession.parseLine(
            """{"type":"tool_use","name":"mcp__pdh__collect_files","input":{"roots":["/sdcard"]}}""",
        )
        assertTrue(e is PdhAgentEvent.ToolUse)
        e as PdhAgentEvent.ToolUse
        assertEquals("mcp__pdh__collect_files", e.name)
        assertTrue(e.input!!.contains("roots"))
    }

    @Test
    fun tool_use_falls_back_to_tool_field() {
        val e = PdhAgentSession.parseLine("""{"type":"tool_use","tool":"pdh_ping"}""")
        assertEquals("pdh_ping", (e as PdhAgentEvent.ToolUse).name)
    }

    @Test
    fun tool_result_yields_content() {
        assertEquals(
            PdhAgentEvent.ToolResult("pong"),
            PdhAgentSession.parseLine("""{"type":"tool_result","content":"pong"}"""),
        )
    }

    @Test
    fun result_with_text_is_not_error() {
        assertEquals(
            PdhAgentEvent.Result("done", false),
            PdhAgentSession.parseLine("""{"type":"result","text":"done"}"""),
        )
    }

    @Test
    fun result_field_carries_the_final_answer() {
        // cc agent's real success shape: the answer is in `result`, not `text`.
        assertEquals(
            PdhAgentEvent.Result("我是助手", false),
            PdhAgentSession.parseLine(
                """{"type":"result","subtype":"success","is_error":false,"result":"我是助手"}""",
            ),
        )
    }

    @Test
    fun result_is_error_flag_honored() {
        val e = PdhAgentSession.parseLine("""{"type":"result","text":"x","is_error":true}""")
        assertTrue((e as PdhAgentEvent.Result).isError)
    }

    @Test
    fun result_error_subtype_marks_error() {
        val e = PdhAgentSession.parseLine("""{"type":"result","subtype":"error_max_turns","text":""}""")
        assertTrue((e as PdhAgentEvent.Result).isError)
    }

    @Test
    fun error_event_yields_message() {
        assertEquals(
            PdhAgentEvent.Error("boom"),
            PdhAgentSession.parseLine("""{"type":"error","message":"boom"}"""),
        )
    }

    @Test
    fun system_and_token_usage_are_ignored() {
        assertNull(PdhAgentSession.parseLine("""{"type":"system","subtype":"init"}"""))
        assertNull(PdhAgentSession.parseLine("""{"type":"token_usage","input":10}"""))
    }

    @Test
    fun blank_and_non_object_lines_are_null() {
        assertNull(PdhAgentSession.parseLine(""))
        assertNull(PdhAgentSession.parseLine("   "))
        assertNull(PdhAgentSession.parseLine("not json"))
        assertNull(PdhAgentSession.parseLine("[1,2,3]"))
    }

    @Test
    fun malformed_json_is_null() {
        assertNull(PdhAgentSession.parseLine("""{"type":"text" """))
    }

    // ── §3.5.9 trust-card events ──────────────────────────────────────────

    @Test
    fun approval_request_maps_fields() {
        val e = PdhAgentSession.parseLine(
            """{"type":"approval_request","id":"appr-1","tool":"mcp__pdh__send_message",""" +
                """"command":"发给 妈妈:晚上好","risk":"high"}""",
        )
        assertTrue(e is PdhAgentEvent.ApprovalRequest)
        e as PdhAgentEvent.ApprovalRequest
        assertEquals("appr-1", e.id)
        assertEquals("mcp__pdh__send_message", e.tool)
        assertEquals("发给 妈妈:晚上好", e.summary)
        assertEquals("high", e.risk)
    }

    @Test
    fun approval_request_summary_falls_back_to_reason_then_tool() {
        val e = PdhAgentSession.parseLine(
            """{"type":"approval_request","id":"a2","tool":"mcp__pdh__make_call","reason":"拨打电话"}""",
        ) as PdhAgentEvent.ApprovalRequest
        assertEquals("拨打电话", e.summary)
        assertNull(e.risk)
    }

    @Test
    fun approval_resolved_maps_approved() {
        assertEquals(
            PdhAgentEvent.ApprovalResolved("appr-1", true),
            PdhAgentSession.parseLine(
                """{"type":"approval_resolved","id":"appr-1","approved":true,"via":"panel"}""",
            ),
        )
        assertEquals(
            PdhAgentEvent.ApprovalResolved("a2", false),
            PdhAgentSession.parseLine("""{"type":"approval_resolved","id":"a2","approved":false}"""),
        )
    }

    @Test
    fun plan_update_extracts_item_titles_and_phase() {
        val e = PdhAgentSession.parseLine(
            """{"type":"plan_update","state":"awaiting_approval","items":[""" +
                """{"id":"1","title":"采集抖音","tool":"x"},{"id":"2","title":"总结兴趣"}]}""",
        )
        assertTrue(e is PdhAgentEvent.PlanUpdate)
        e as PdhAgentEvent.PlanUpdate
        assertEquals(listOf("采集抖音", "总结兴趣"), e.items)
        assertEquals("awaiting_approval", e.phase)
    }

    @Test
    fun plan_update_with_no_items_yields_empty_list() {
        val e = PdhAgentSession.parseLine("""{"type":"plan_update","state":"inactive","items":[]}""")
        assertEquals(emptyList<String>(), (e as PdhAgentEvent.PlanUpdate).items)
    }

    @Test
    fun tool_result_with_assist_required_yields_assist_event() {
        val line =
            """{"type":"tool_result","content":"{\"status\":\"assist_required\",""" +
                """\"instruction\":\"打开抖音\",\"deepLink\":\"snssdk1128://message\",""" +
                """\"resumeToken\":\"rt-9\",\"reason\":\"需 .so 加载\"}"}"""
        val e = PdhAgentSession.parseLine(line)
        assertTrue(e is PdhAgentEvent.AssistRequired)
        e as PdhAgentEvent.AssistRequired
        assertEquals("打开抖音", e.instruction)
        assertEquals("snssdk1128://message", e.deepLink)
        assertEquals("rt-9", e.resumeToken)
        assertEquals("需 .so 加载", e.reason)
    }

    @Test
    fun tool_result_plain_content_is_not_assist() {
        assertEquals(
            PdhAgentEvent.ToolResult("pong"),
            PdhAgentSession.parseLine("""{"type":"tool_result","content":"pong"}"""),
        )
    }

    @Test
    fun tool_result_json_without_assist_status_stays_tool_result() {
        // A JSON-object content that ISN'T assist_required must not be hijacked.
        val line = """{"type":"tool_result","content":"{\"status\":\"ok\",\"ingested\":3}"}"""
        val e = PdhAgentSession.parseLine(line)
        assertTrue(e is PdhAgentEvent.ToolResult)
    }

    @Test
    fun parse_assist_optional_fields_default_null() {
        val a = PdhAgentSession.parseAssist("""{"status":"assist_required","instruction":"登录"}""")
        assertTrue(a is PdhAgentEvent.AssistRequired)
        a as PdhAgentEvent.AssistRequired
        assertEquals("登录", a.instruction)
        assertNull(a.deepLink)
        assertNull(a.resumeToken)
        assertNull(a.reason)
    }

    // ── §3.5.13 feedback events ───────────────────────────────────────────

    @Test
    fun feedback_event_positive_no_comment() {
        val s = PdhAgentSession.feedbackEvent("t1", PdhAgentSession.FeedbackKind.POSITIVE, null).toString()
        assertTrue(s.contains("\"type\":\"feedback\""))
        assertTrue(s.contains("\"turn_id\":\"t1\""))
        assertTrue(s.contains("\"kind\":\"positive\""))
        assertFalse(s.contains("comment"))
    }

    @Test
    fun feedback_event_correction_carries_comment() {
        val s = PdhAgentSession.feedbackEvent(
            "t2", PdhAgentSession.FeedbackKind.CORRECTION, "外卖应含饿了么",
        ).toString()
        assertTrue(s.contains("\"kind\":\"correction\""))
        assertTrue(s.contains("外卖应含饿了么"))
    }

    @Test
    fun feedback_event_blank_comment_omitted() {
        val s = PdhAgentSession.feedbackEvent(
            "t3", PdhAgentSession.FeedbackKind.NEGATIVE, "   ",
        ).toString()
        assertTrue(s.contains("\"kind\":\"negative\""))
        assertFalse(s.contains("comment"))
    }

    // ── §3.5.15 resume events ─────────────────────────────────────────────

    @Test
    fun resume_event_completed() {
        val s = PdhAgentSession.resumeEvent("rt-9", "completed").toString()
        assertTrue(s.contains("\"type\":\"resume\""))
        assertTrue(s.contains("\"token\":\"rt-9\""))
        assertTrue(s.contains("\"action\":\"completed\""))
    }

    @Test
    fun resume_event_skip() {
        val s = PdhAgentSession.resumeEvent("rt-9", "skip").toString()
        assertTrue(s.contains("\"action\":\"skip\""))
    }
}
