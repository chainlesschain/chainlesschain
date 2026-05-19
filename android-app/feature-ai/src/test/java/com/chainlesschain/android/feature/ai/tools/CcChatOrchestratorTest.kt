package com.chainlesschain.android.feature.ai.tools

import com.chainlesschain.android.feature.ai.data.llm.ChatWithToolsResponse
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.data.llm.ToolCall
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class CcChatOrchestratorTest {

    private lateinit var dispatcher: CcToolCallDispatcher
    private lateinit var orchestrator: CcChatOrchestrator

    @Before
    fun setUp() {
        dispatcher = mockk(relaxed = true)
        orchestrator = CcChatOrchestrator(dispatcher)
    }

    private fun adapter(supportsTools: Boolean): LLMAdapter = mockk(relaxed = true) {
        every { supportsToolUse } returns supportsTools
    }

    // ---------- dedupKey ----------

    @Test fun `dedupKey is stable for same args`() {
        val k1 = orchestrator.dedupKey("cc_exec", "note", listOf("list", "--limit", "10"))
        val k2 = orchestrator.dedupKey("cc_exec", "note", listOf("list", "--limit", "10"))
        assertEquals(k1, k2)
    }

    @Test fun `dedupKey differs for different cmds`() {
        val k1 = orchestrator.dedupKey("cc_exec", "note", listOf("list"))
        val k2 = orchestrator.dedupKey("cc_exec", "memory", listOf("list"))
        assertFalse(k1 == k2)
    }

    @Test fun `ccExecToolDescriptor lists all v1 commands in enum`() {
        val desc = orchestrator.ccExecToolDescriptor()
        @Suppress("UNCHECKED_CAST")
        val params = desc["parameters"] as Map<String, Any>
        @Suppress("UNCHECKED_CAST")
        val props = params["properties"] as Map<String, Any>
        @Suppress("UNCHECKED_CAST")
        val cmdSpec = props["command"] as Map<String, Any>
        @Suppress("UNCHECKED_CAST")
        val enum = cmdSpec["enum"] as List<String>
        // Should include all V1 commands
        assertTrue(enum.containsAll(listOf("note", "search", "memory", "skill", "status", "session", "mcp", "did")))
    }

    // ---------- E6 — fallback for tool-incapable adapter ----------

    @Test fun `E6 fallback path streams without invoking dispatcher`() = runTest {
        val ad = adapter(supportsTools = false)
        every { ad.streamChat(any(), any(), any(), any()) } returns flow {
            emit(StreamChunk("Hello ", isDone = false))
            emit(StreamChunk("世界", isDone = false))
            emit(StreamChunk("", isDone = true))
        }

        val events = orchestrator.run(
            userText = "列下我最近的笔记",
            history = emptyList(),
            adapter = ad,
            model = "qwen-max",
        ).toList()

        // 3 status changes (THINKING, COMPLETE) + 2 deltas + 1 Completed
        val deltas = events.filterIsInstance<CcChatEvent.AssistantTextDelta>()
        assertEquals(2, deltas.size)
        assertEquals("Hello ", deltas[0].text)
        assertEquals("世界", deltas[1].text)

        val completed = events.last() as CcChatEvent.Completed
        assertEquals("Hello 世界", completed.finalText)

        // Dispatcher never invoked in fallback path
        coVerify(exactly = 0) { dispatcher.dispatch(any()) }
    }

    @Test fun `E6 fallback injects no-tool-hallucination guard`() = runTest {
        val ad = adapter(supportsTools = false)
        val capturedMessages = mutableListOf<List<com.chainlesschain.android.feature.ai.domain.model.Message>>()
        every { ad.streamChat(any(), any(), any(), any()) } answers {
            capturedMessages += firstArg<List<com.chainlesschain.android.feature.ai.domain.model.Message>>()
            flow { emit(StreamChunk("ok", isDone = true)) }
        }

        orchestrator.run("hi", emptyList(), ad, "qwen-max").toList()

        assertEquals(1, capturedMessages.size)
        val msgs = capturedMessages.first()
        // first message = guard (SYSTEM role)
        assertTrue(
            msgs.first().content.contains("工具调用 (cc_exec) 不可用"),
            "guard not injected; got: ${msgs.first().content}"
        )
    }

    // ---------- B26 fix — StreamChunk.error surfaces as Failed ----------

    @Test fun `B26 fix — fallback surfaces stream error as Failed event`() = runTest {
        val ad = adapter(supportsTools = false)
        every { ad.streamChat(any(), any(), any(), any()) } returns flow {
            emit(StreamChunk("partial ", isDone = false))
            emit(StreamChunk("", isDone = true, error = "API错误: 401"))
        }

        val events = orchestrator.run("hi", emptyList(), ad, "qwen-max").toList()
        val failed = events.filterIsInstance<CcChatEvent.Failed>()
        assertEquals(1, failed.size)
        assertTrue(failed.first().reason.contains("401"))
        // status should be FAILED, NOT COMPLETE
        assertFalse(events.any { it is CcChatEvent.Completed })
        val statuses = events.filterIsInstance<CcChatEvent.StatusChanged>().map { it.status }
        assertTrue(statuses.contains(ChatStatus.FAILED))
        assertFalse(statuses.contains(ChatStatus.COMPLETE))
    }

    // ---------- E1 / happy path — tool loop ----------

    @Test fun `E1 tool loop — single tool call then final text`() = runTest {
        val ad = adapter(supportsTools = true)
        val tc = ToolCall("call_1", "cc_exec",
            mapOf("command" to "note", "subargs" to listOf("list", "--limit", "10")))

        coEvery { ad.chatWithTools(any(), any(), any(), any(), any()) } returnsMany listOf(
            ChatWithToolsResponse(content = null, toolCalls = listOf(tc), finishReason = "tool_calls"),
            ChatWithToolsResponse(content = "你有 2 个笔记。", toolCalls = null, finishReason = "stop"),
        )
        coEvery { dispatcher.parseArguments(tc.arguments) } returns ("note" to listOf("list", "--limit", "10"))
        coEvery { dispatcher.dispatch(tc) } returns ToolResult(
            toolCallId = "call_1",
            content = "$ cc note list --limit 10\nexitCode=0\nduration=200ms\nstdout:\nnote1\nnote2\n",
        )

        val events = orchestrator.run("列下笔记", emptyList(), ad, "gpt-4o-mini").toList()

        // Should emit: Started + StatusChange(TOOL_RUNNING) + StatusChange(TOOL_DONE) + Completed
        val started = events.filterIsInstance<CcChatEvent.ToolCallStarted>()
        val finished = events.filterIsInstance<CcChatEvent.ToolCallCompleted>()
        assertEquals(1, started.size)
        assertEquals(1, finished.size)
        assertEquals("note", started[0].command)
        assertEquals(listOf("list", "--limit", "10"), started[0].subargs)
        assertTrue(finished[0].resultContent.contains("note1\nnote2"))

        val completed = events.filterIsInstance<CcChatEvent.Completed>().last()
        assertEquals("你有 2 个笔记。", completed.finalText)
    }

    // ---------- E9 — duplicate dedup ----------

    @Test fun `E9 dedup — same tool call twice returns 129 cached`() = runTest {
        val ad = adapter(supportsTools = true)
        val tc1 = ToolCall("c1", "cc_exec",
            mapOf("command" to "search", "subargs" to listOf("RAG", "--limit", "20")))
        val tc2 = ToolCall("c2", "cc_exec",
            mapOf("command" to "search", "subargs" to listOf("RAG", "--limit", "20")))

        coEvery { ad.chatWithTools(any(), any(), any(), any(), any()) } returnsMany listOf(
            ChatWithToolsResponse(content = null, toolCalls = listOf(tc1), finishReason = "tool_calls"),
            ChatWithToolsResponse(content = null, toolCalls = listOf(tc2), finishReason = "tool_calls"),
            ChatWithToolsResponse(content = "好", toolCalls = null, finishReason = "stop"),
        )
        // dispatcher.parseArguments is called for each call (display)
        coEvery { dispatcher.parseArguments(any()) } returns ("search" to listOf("RAG", "--limit", "20"))
        coEvery { dispatcher.dispatch(tc1) } returns ToolResult("c1", "first result")

        val events = orchestrator.run("连续搜 3 次 RAG 看看", emptyList(), ad, "gpt-4o-mini").toList()

        // Second call dispatched is dedup branch → exitCode=129 in resultContent
        val toolCompleted = events.filterIsInstance<CcChatEvent.ToolCallCompleted>()
        assertEquals(2, toolCompleted.size)
        assertTrue(toolCompleted[1].resultContent.contains("exitCode=129"))
        assertTrue(toolCompleted[1].resultContent.contains("duplicate tool call"))

        // Real exec called exactly once
        coVerify(exactly = 1) { dispatcher.dispatch(tc1) }
        coVerify(exactly = 0) { dispatcher.dispatch(tc2) }
    }

    // ---------- E8 — multi-turn tool loop (search → show) ----------

    @Test fun `E8 multi-turn — search then note show`() = runTest {
        val ad = adapter(supportsTools = true)
        val tcSearch = ToolCall("s", "cc_exec",
            mapOf("command" to "search", "subargs" to listOf("RAG", "--limit", "20")))
        val tcShow = ToolCall("v", "cc_exec",
            mapOf("command" to "note", "subargs" to listOf("show", "--id", "n-42")))

        coEvery { ad.chatWithTools(any(), any(), any(), any(), any()) } returnsMany listOf(
            ChatWithToolsResponse(null, listOf(tcSearch), "tool_calls"),
            ChatWithToolsResponse(null, listOf(tcShow), "tool_calls"),
            ChatWithToolsResponse("note 内容是...", null, "stop"),
        )
        coEvery { dispatcher.parseArguments(tcSearch.arguments) } returns
            ("search" to listOf("RAG", "--limit", "20"))
        coEvery { dispatcher.parseArguments(tcShow.arguments) } returns
            ("note" to listOf("show", "--id", "n-42"))
        coEvery { dispatcher.dispatch(tcSearch) } returns ToolResult("s", "search result")
        coEvery { dispatcher.dispatch(tcShow) } returns ToolResult("v", "show result")

        val events = orchestrator.run("找那篇 RAG 笔记内容", emptyList(), ad, "gpt-4o-mini").toList()

        val cards = events.filterIsInstance<CcChatEvent.ToolCallCompleted>()
        assertEquals(2, cards.size)
        assertEquals("search", cards[0].command)
        assertEquals("note", cards[1].command)
        assertEquals("note 内容是...", events.filterIsInstance<CcChatEvent.Completed>().last().finalText)
    }

    // ---------- loop limit ----------

    @Test fun `MAX_TOOL_ITERATIONS — forced final after limit`() = runTest {
        val ad = adapter(supportsTools = true)
        // adapter keeps requesting tool calls beyond MAX_TOOL_ITERATIONS
        coEvery { ad.chatWithTools(any(), any(), any(), any(), any()) } answers {
            ChatWithToolsResponse(
                content = null,
                toolCalls = listOf(ToolCall("c", "cc_exec",
                    mapOf("command" to "search", "subargs" to listOf("query-${System.nanoTime()}")))),
                finishReason = "tool_calls",
            )
        }
        coEvery { ad.chat(any(), any(), any(), any()) } returns "已达调用上限，无法继续。"
        coEvery { dispatcher.parseArguments(any()) } returns
            ("search" to listOf("query"))
        coEvery { dispatcher.dispatch(any()) } returns ToolResult("c", "result")

        val events = orchestrator.run("loop me", emptyList(), ad, "gpt-4o-mini").toList()

        // Final fallback Completed event
        val completed = events.filterIsInstance<CcChatEvent.Completed>().last()
        assertEquals("已达调用上限，无法继续。", completed.finalText)
        // exactly MAX_TOOL_ITERATIONS dispatches (queries are unique → no dedup hits)
        coVerify(exactly = CcChatOrchestrator.MAX_TOOL_ITERATIONS) { dispatcher.dispatch(any()) }
    }

    // ---------- failure paths ----------

    @Test fun `chatWithTools throws — Failed event emitted`() = runTest {
        val ad = adapter(supportsTools = true)
        coEvery { ad.chatWithTools(any(), any(), any(), any(), any()) } throws
            RuntimeException("network broken")

        val events = orchestrator.run("hi", emptyList(), ad, "gpt-4o-mini").toList()
        val failed = events.filterIsInstance<CcChatEvent.Failed>()
        assertEquals(1, failed.size)
        assertTrue(failed.first().reason.contains("network broken"))
    }

    @Test fun `fallback chat throws — Failed surfaced`() = runTest {
        val ad = adapter(supportsTools = false)
        every { ad.streamChat(any(), any(), any(), any()) } returns flow {
            throw RuntimeException("connection reset")
        }

        val events = orchestrator.run("hi", emptyList(), ad, "qwen-max").toList()
        val failed = events.filterIsInstance<CcChatEvent.Failed>()
        assertEquals(1, failed.size)
        assertTrue(failed.first().reason.contains("connection reset"))
    }
}
