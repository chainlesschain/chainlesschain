package com.chainlesschain.android.pdh

import com.chainlesschain.android.pdh.PdhAgentSession.PdhAgentEvent
import org.junit.Test
import kotlin.test.assertEquals
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
}
