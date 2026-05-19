package com.chainlesschain.android.presentation.screens.cc

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import com.chainlesschain.android.core.security.SecurePreferences
import com.chainlesschain.android.feature.ai.data.llm.ChatWithToolsResponse
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.data.llm.ToolCall
import com.chainlesschain.android.feature.ai.di.LLMAdapterFactory
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.tools.CcChatOrchestrator
import com.chainlesschain.android.feature.ai.tools.CcExecService
import com.chainlesschain.android.feature.ai.tools.CcResult
import com.chainlesschain.android.feature.ai.tools.CcToolCallDispatcher
import com.chainlesschain.android.feature.ai.tools.ChatStatus
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase 5.8 integration test — wires the real production graph
 * (CcChatViewModel → CcChatOrchestrator → CcToolCallDispatcher → CcAllowlist)
 * but mocks the leaf [CcExecService] so we don't spawn a real `node + cc`
 * subprocess. Covers Phase 5.8 §F.E1/E5/E6/E9 scenarios at the integration
 * layer that unit tests can't reach (real allowlist + dedup keys + format
 * round-trip).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CcChatIntegrationTest {

    @get:Rule val instantTaskExecutorRule = InstantTaskExecutorRule()
    private val testDispatcher = StandardTestDispatcher()

    private lateinit var ccExec: CcExecService
    private lateinit var dispatcher: CcToolCallDispatcher
    private lateinit var orchestrator: CcChatOrchestrator
    private lateinit var adapterFactory: LLMAdapterFactory
    private lateinit var securePrefs: SecurePreferences
    private lateinit var vm: CcChatViewModel
    private lateinit var adapter: LLMAdapter

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        ccExec = mockk(relaxed = true)
        dispatcher = CcToolCallDispatcher(ccExec)
        orchestrator = CcChatOrchestrator(dispatcher)

        adapter = mockk(relaxed = true) {
            every { supportsToolUse } returns true
        }
        adapterFactory = mockk(relaxed = true)
        every { adapterFactory.createAdapter(LLMProvider.OPENAI, any()) } returns adapter

        securePrefs = mockk(relaxed = true)
        every { securePrefs.getOpenAIApiKey() } returns "sk-test-key"

        vm = CcChatViewModel(orchestrator, adapterFactory, securePrefs)
    }

    @After fun tearDown() = Dispatchers.resetMain()

    // ---------- E1 — happy path through real production graph ----------

    @Test fun `E1 — note list happy path full graph`() = runTest {
        val tc = ToolCall(
            id = "call_e1",
            name = "cc_exec",
            arguments = mapOf("command" to "note", "subargs" to listOf("list")),
        )
        coEvery { adapter.chatWithTools(any(), any(), any(), any(), any()) } returnsMany listOf(
            ChatWithToolsResponse(content = null, toolCalls = listOf(tc), finishReason = "tool_calls"),
            ChatWithToolsResponse(content = "你有 2 条笔记。", toolCalls = null, finishReason = "stop"),
        )

        val cmdSlot = slot<String>()
        val argsSlot = slot<List<String>>()
        coEvery { ccExec.run(capture(cmdSlot), capture(argsSlot), any()) } returns CcResult.Ok(
            exitCode = 0,
            stdout = "note-1\nnote-2\n",
            stderr = "",
            durationMs = 234L,
        )

        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("列下我最近的笔记"); advanceUntilIdle()

        // 1) Real CcAllowlist injected default --limit 20 into the EXEC args.
        // (Display args in the UI show the raw LLM-requested form — see #2.)
        assertEquals("note", cmdSlot.captured)
        assertEquals(listOf("list", "--limit", "20"), argsSlot.captured)

        // 2) UI got user + ToolCall + Assistant.
        // Note: invocationLine reflects what the LLM REQUESTED (display layer),
        // not the post-defaults effective form — see Phase 5.8 design §4.4.
        val msgs = vm.uiState.value.messages
        val toolCalls = msgs.filterIsInstance<CcChatMessage.ToolCall>()
        assertEquals(1, toolCalls.size)
        val tcMsg = toolCalls.first()
        assertEquals(0, tcMsg.exitCode)
        assertEquals(234L, tcMsg.durationMs)
        assertEquals("cc note list", tcMsg.invocationLine)

        // 3) Final state ready for next turn
        assertEquals(ChatStatus.COMPLETE, vm.uiState.value.status)
        assertTrue(vm.uiState.value.inputEnabled)
    }

    // ---------- E5 — allowlist deny, NO real exec invoked ----------

    @Test fun `E5 — write op denied at allowlist, ccExec never called`() = runTest {
        val evilTc = ToolCall(
            id = "evil",
            name = "cc_exec",
            arguments = mapOf("command" to "note", "subargs" to listOf("delete", "--id", "all")),
        )
        coEvery { adapter.chatWithTools(any(), any(), any(), any(), any()) } returnsMany listOf(
            ChatWithToolsResponse(content = null, toolCalls = listOf(evilTc), finishReason = "tool_calls"),
            ChatWithToolsResponse(content = "我无法删除你的笔记。", toolCalls = null, finishReason = "stop"),
        )

        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("帮我把所有笔记删了"); advanceUntilIdle()

        // Critical Blocker check: ccExec.run MUST NOT have been invoked
        coVerify(exactly = 0) { ccExec.run(any(), any(), any()) }

        // UI surfaces 126 deny + correct reasoning
        val toolCalls = vm.uiState.value.messages.filterIsInstance<CcChatMessage.ToolCall>()
        assertEquals(1, toolCalls.size)
        assertEquals(126, toolCalls.first().exitCode)
        assertTrue(toolCalls.first().resultContent!!.contains("denied by v1 allowlist"))
    }

    @Test fun `E5b — shell metachars in arg denied`() = runTest {
        val injectTc = ToolCall(
            id = "inj",
            name = "cc_exec",
            arguments = mapOf("command" to "search", "subargs" to listOf("foo; rm -rf /")),
        )
        coEvery { adapter.chatWithTools(any(), any(), any(), any(), any()) } returnsMany listOf(
            ChatWithToolsResponse(content = null, toolCalls = listOf(injectTc), finishReason = "tool_calls"),
            ChatWithToolsResponse(content = "ok", toolCalls = null, finishReason = "stop"),
        )

        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("search test"); advanceUntilIdle()

        coVerify(exactly = 0) { ccExec.run(any(), any(), any()) }
        assertEquals(126, vm.uiState.value.messages.filterIsInstance<CcChatMessage.ToolCall>().first().exitCode)
    }

    // ---------- E9 — dedup across turns ----------

    @Test fun `E9 — same call thrice, real exec once, 2 cached`() = runTest {
        val tc1 = ToolCall("c1", "cc_exec",
            mapOf("command" to "search", "subargs" to listOf("RAG", "--limit", "10")))
        val tc2 = ToolCall("c2", "cc_exec",
            mapOf("command" to "search", "subargs" to listOf("RAG", "--limit", "10")))
        val tc3 = ToolCall("c3", "cc_exec",
            mapOf("command" to "search", "subargs" to listOf("RAG", "--limit", "10")))

        coEvery { adapter.chatWithTools(any(), any(), any(), any(), any()) } returnsMany listOf(
            ChatWithToolsResponse(null, listOf(tc1), "tool_calls"),
            ChatWithToolsResponse(null, listOf(tc2), "tool_calls"),
            ChatWithToolsResponse(null, listOf(tc3), "tool_calls"),
        )
        coEvery { ccExec.run(any(), any(), any()) } returns CcResult.Ok(
            exitCode = 0, stdout = "hit1\nhit2\n", stderr = "", durationMs = 100L,
        )

        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("连续搜 3 次 RAG 看看"); advanceUntilIdle()

        // Real exec called exactly once (first call); next 2 hit dedup
        coVerify(exactly = 1) { ccExec.run("search", listOf("RAG", "--limit", "10"), any()) }

        val toolCalls = vm.uiState.value.messages.filterIsInstance<CcChatMessage.ToolCall>()
        assertEquals(3, toolCalls.size)
        // First card exit=0, next two have dedup exit=129
        assertEquals(0, toolCalls[0].exitCode)
        assertEquals(129, toolCalls[1].exitCode)
        assertEquals(129, toolCalls[2].exitCode)
        assertTrue(toolCalls[1].resultContent!!.contains("duplicate tool call"))
    }

    // ---------- E6 — fallback path when adapter doesn't support tools ----------

    @Test fun `E6 — tool-unsupported adapter takes fallback path with no real exec`() = runTest {
        every { adapter.supportsToolUse } returns false
        every { adapter.streamChat(any(), any(), any(), any()) } returns kotlinx.coroutines.flow.flow {
            emit(com.chainlesschain.android.feature.ai.domain.model.StreamChunk("我无法访问你的笔记", false))
            emit(com.chainlesschain.android.feature.ai.domain.model.StreamChunk("", true))
        }

        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("列下笔记"); advanceUntilIdle()

        // No tool exec, no tool card; assistant bubble with text
        assertEquals(0, vm.uiState.value.messages.filterIsInstance<CcChatMessage.ToolCall>().size)
        coVerify(exactly = 0) { ccExec.run(any(), any(), any()) }
        val assistantMsg = vm.uiState.value.messages.filterIsInstance<CcChatMessage.Assistant>().last()
        assertEquals("我无法访问你的笔记", assistantMsg.text)
        assertFalse(assistantMsg.isStreaming)
    }

    // ---------- B26 fix — fallback surfaces stream error ----------

    @Test fun `B26 — fallback StreamChunk error surfaced through real graph`() = runTest {
        every { adapter.supportsToolUse } returns false
        every { adapter.streamChat(any(), any(), any(), any()) } returns kotlinx.coroutines.flow.flow {
            emit(com.chainlesschain.android.feature.ai.domain.model.StreamChunk(
                "", isDone = true, error = "API错误: 401",
            ))
        }

        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("hi"); advanceUntilIdle()

        // Status FAILED, error surface, status NOT COMPLETE
        assertEquals(ChatStatus.FAILED, vm.uiState.value.status)
        assertTrue(vm.uiState.value.error!!.contains("401"))
    }

    // ---------- B28 ground truth — exec failure surfaces clean Error (NOT crash) ----------

    @Test fun `B28-adjacent — exec returns Error when bootstrap missing, not crash`() = runTest {
        coEvery { adapter.chatWithTools(any(), any(), any(), any(), any()) } returnsMany listOf(
            ChatWithToolsResponse(
                content = null,
                toolCalls = listOf(ToolCall("c", "cc_exec",
                    mapOf("command" to "status", "subargs" to emptyList<String>()))),
                finishReason = "tool_calls",
            ),
            ChatWithToolsResponse(content = "bootstrap 还没跑过", toolCalls = null, finishReason = "stop"),
        )
        coEvery { ccExec.run("status", any(), any()) } returns
            CcResult.Error("Node binary missing", expectedPath = "/data/.../bin/node")

        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("查一下 cc 跑得起来吗"); advanceUntilIdle()

        // Did NOT crash; UI shows error tool card + assistant final text
        assertEquals(ChatStatus.COMPLETE, vm.uiState.value.status)
        val tcMsg = vm.uiState.value.messages.filterIsInstance<CcChatMessage.ToolCall>().first()
        // EXIT_EXEC_ERROR = -1
        assertEquals(-1, tcMsg.exitCode)
        assertTrue(tcMsg.resultContent!!.contains("Node binary missing"))
    }

    // ---------- E7 — cancel mid-flight ----------

    @Test fun `E7 — cancel after tool call started leaves UI in CANCELLED state`() = runTest {
        val slowTc = ToolCall("slow", "cc_exec",
            mapOf("command" to "search", "subargs" to listOf("forever")))
        coEvery { adapter.chatWithTools(any(), any(), any(), any(), any()) } returns
            ChatWithToolsResponse(null, listOf(slowTc), "tool_calls")
        // Mock exec to "never return" via long delay
        coEvery { ccExec.run(any(), any(), any()) } coAnswers {
            kotlinx.coroutines.delay(60_000)
            CcResult.Ok(0, "", "", 0)
        }

        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("never-completing search")
        // Allow the chatWithTools + tool-call-started events to flow
        testDispatcher.scheduler.runCurrent()
        // Cancel mid-flight
        vm.cancel()
        advanceUntilIdle()

        assertEquals(ChatStatus.CANCELLED, vm.uiState.value.status)
        assertTrue(vm.uiState.value.inputEnabled)
    }

    // ---------- multi-turn history ----------

    @Test fun `history — user + assistant + new turn carries context`() = runTest {
        coEvery { adapter.chatWithTools(any(), any(), any(), any(), any()) } returns
            ChatWithToolsResponse(content = "你好", toolCalls = null, finishReason = "stop")

        vm.setProvider(LLMProvider.OPENAI); advanceUntilIdle()
        vm.sendMessage("hi"); advanceUntilIdle()
        // Second turn — capture messages passed in
        val capturedSecond = slot<List<com.chainlesschain.android.feature.ai.domain.model.Message>>()
        coEvery { adapter.chatWithTools(capture(capturedSecond), any(), any(), any(), any()) } returns
            ChatWithToolsResponse(content = "再见", toolCalls = null, finishReason = "stop")

        vm.sendMessage("再说点"); advanceUntilIdle()

        // History on second turn: previous user "hi" + assistant "你好" + new user "再说点"
        val msgs = capturedSecond.captured
        assertTrue(msgs.size >= 3, "expected at least 3 messages, got ${msgs.size}: ${msgs.map { it.content }}")
        assertEquals("hi", msgs[0].content)
        assertEquals("你好", msgs[1].content)
        assertEquals("再说点", msgs[2].content)
    }
}
