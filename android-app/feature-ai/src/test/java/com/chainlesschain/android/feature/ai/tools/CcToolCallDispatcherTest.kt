package com.chainlesschain.android.feature.ai.tools

import com.chainlesschain.android.feature.ai.data.llm.ToolCall
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class CcToolCallDispatcherTest {

    private lateinit var execService: CcExecService
    private lateinit var dispatcher: CcToolCallDispatcher

    @Before
    fun setUp() {
        execService = mockk(relaxed = true)
        dispatcher = CcToolCallDispatcher(execService)
    }

    // ---------- parseArguments ----------

    @Test fun `parseArguments accepts List`() {
        val parsed = dispatcher.parseArguments(
            mapOf("command" to "note", "subargs" to listOf("list", "--limit", "10"))
        )
        assertNotNull(parsed)
        assertEquals("note" to listOf("list", "--limit", "10"), parsed)
    }

    @Test fun `parseArguments accepts JSON string subargs`() {
        // OpenAIAdapter sometimes passes nested-array subargs as a stringified JSON
        // when the tool schema declares array-of-strings — exercise that path.
        val parsed = dispatcher.parseArguments(
            mapOf("command" to "search", "subargs" to """["RAG", "--limit", "5"]""")
        )
        assertNotNull(parsed)
        assertEquals("search", parsed!!.first)
        assertEquals(listOf("RAG", "--limit", "5"), parsed.second)
    }

    @Test fun `parseArguments accepts Array`() {
        val parsed = dispatcher.parseArguments(
            mapOf("command" to "status", "subargs" to arrayOf<Any>("--json"))
        )
        assertNotNull(parsed)
        assertEquals("status" to listOf("--json"), parsed)
    }

    @Test fun `parseArguments rejects missing command`() {
        val parsed = dispatcher.parseArguments(mapOf("subargs" to listOf<String>()))
        assertEquals(null, parsed)
    }

    @Test fun `parseArguments rejects missing subargs`() {
        val parsed = dispatcher.parseArguments(mapOf("command" to "status"))
        assertEquals(null, parsed)
    }

    @Test fun `parseArguments rejects non-array JSON string subargs`() {
        val parsed = dispatcher.parseArguments(
            mapOf("command" to "status", "subargs" to """{"not": "an-array"}""")
        )
        assertEquals(null, parsed)
    }

    @Test fun `parseArguments filters empty strings out of subargs`() {
        val parsed = dispatcher.parseArguments(
            mapOf("command" to "note", "subargs" to listOf("list", "", "--limit", "10"))
        )
        assertEquals(listOf("list", "--limit", "10"), parsed!!.second)
    }

    // ---------- dispatch happy path ----------

    @Test fun `dispatch happy path runs exec and formats result`() = runTest {
        coEvery { execService.run("note", listOf("list", "--limit", "20"), any()) } returns
            CcResult.Ok(exitCode = 0, stdout = "note1\nnote2\n", stderr = "", durationMs = 234L)

        val toolCall = ToolCall(
            id = "tc1",
            name = "cc_exec",
            arguments = mapOf("command" to "note", "subargs" to listOf("list")),
        )
        val r = dispatcher.dispatch(toolCall)

        assertEquals("tc1", r.toolCallId)
        assertTrue(r.content.startsWith("$ cc note list --limit 20"))
        assertTrue(r.content.contains("exitCode=0"))
        assertTrue(r.content.contains("duration=234ms"))
        assertTrue(r.content.contains("stdout:\nnote1\nnote2"))
    }

    @Test fun `dispatch applies default --limit when missing`() = runTest {
        val cmdSlot = slot<String>()
        val argsSlot = slot<List<String>>()
        coEvery { execService.run(capture(cmdSlot), capture(argsSlot), any()) } returns
            CcResult.Ok(exitCode = 0, stdout = "", stderr = "", durationMs = 1L)

        dispatcher.dispatch(
            ToolCall("tc", "cc_exec", mapOf("command" to "note", "subargs" to listOf("list")))
        )
        assertEquals("note", cmdSlot.captured)
        assertEquals(listOf("list", "--limit", "20"), argsSlot.captured)
    }

    // ---------- E5 — allowlist deny → exitCode=126 ----------

    @Test fun `dispatch denies write op with exitCode=126`() = runTest {
        val toolCall = ToolCall(
            id = "evil-1",
            name = "cc_exec",
            arguments = mapOf("command" to "note", "subargs" to listOf("delete", "--id", "abc")),
        )
        val r = dispatcher.dispatch(toolCall)

        assertTrue(r.content.contains("exitCode=126"))
        assertTrue(r.content.contains("denied by v1 allowlist"))
        // Allowlist deny MUST NOT have invoked exec
        coVerify(exactly = 0) { execService.run(any(), any(), any()) }
    }

    @Test fun `dispatch denies unknown top-level cmd with 126`() = runTest {
        val r = dispatcher.dispatch(
            ToolCall("x", "cc_exec", mapOf("command" to "rm", "subargs" to listOf("-rf")))
        )
        assertTrue(r.content.contains("exitCode=126"))
        coVerify(exactly = 0) { execService.run(any(), any(), any()) }
    }

    @Test fun `dispatch denies shell-meta in subargs`() = runTest {
        val r = dispatcher.dispatch(
            ToolCall("x", "cc_exec", mapOf(
                "command" to "search", "subargs" to listOf("foo; rm -rf /"),
            ))
        )
        assertTrue(r.content.contains("exitCode=126"))
    }

    // ---------- E7 — exec error formatting ----------

    @Test fun `dispatch formats CcResult Error with exitCode=-1 + expectedPath`() = runTest {
        coEvery { execService.run(any(), any(), any()) } returns
            CcResult.Error("Node binary missing", expectedPath = "/some/path/node")

        val r = dispatcher.dispatch(
            ToolCall("tc", "cc_exec", mapOf("command" to "status", "subargs" to listOf<String>()))
        )
        assertTrue(r.content.contains("exitCode=${CcToolCallDispatcher.EXIT_EXEC_ERROR}"))
        assertTrue(r.content.contains("Node binary missing"))
        assertTrue(r.content.contains("expectedPath=/some/path/node"))
    }

    // ---------- E6 / wrong tool name ----------

    @Test fun `dispatch rejects unknown tool name with 127`() = runTest {
        val r = dispatcher.dispatch(
            ToolCall("x", "wrong_tool", mapOf("command" to "note", "subargs" to listOf<String>()))
        )
        assertTrue(r.content.contains("exitCode=127"))
        assertTrue(r.content.contains("unknown tool"))
        coVerify(exactly = 0) { execService.run(any(), any(), any()) }
    }

    @Test fun `dispatch rejects malformed args with 64`() = runTest {
        val r = dispatcher.dispatch(
            ToolCall("x", "cc_exec", mapOf("not-command" to "x"))
        )
        assertTrue(r.content.contains("exitCode=64"))
        assertTrue(r.content.contains("malformed arguments"))
        coVerify(exactly = 0) { execService.run(any(), any(), any()) }
    }

    // ---------- B17 fix — missing subcommand ----------

    @Test fun `dispatch denies missing subcommand with 126 (B17 fix)`() = runTest {
        val r = dispatcher.dispatch(
            ToolCall("x", "cc_exec", mapOf("command" to "note", "subargs" to listOf("--limit", "10")))
        )
        assertTrue(r.content.contains("exitCode=126"))
        assertTrue(r.content.contains("requires a subcommand"))
        coVerify(exactly = 0) { execService.run(any(), any(), any()) }
    }

    // ---------- formatResultContent edge cases ----------

    @Test fun `formatResultContent omits empty stdout and stderr sections`() {
        val out = dispatcher.formatResultContent(
            "status", emptyList(),
            CcResult.Ok(exitCode = 0, stdout = "", stderr = "", durationMs = 12L),
        )
        assertTrue(out.contains("exitCode=0"))
        assertFalse(out.contains("stdout:"))
        assertFalse(out.contains("stderr:"))
    }

    @Test fun `formatResultContent appends newline if missing`() {
        val out = dispatcher.formatResultContent(
            "status", emptyList(),
            CcResult.Ok(exitCode = 0, stdout = "no-trailing-newline", stderr = "", durationMs = 1L),
        )
        // body section should end with \n even though input didn't
        val stdoutSection = out.substringAfter("stdout:\n")
        assertTrue(stdoutSection.endsWith("\n"))
    }

    @Test fun `formatResultContent renders header without subargs cleanly`() {
        val out = dispatcher.formatResultContent(
            "status", emptyList(),
            CcResult.Ok(exitCode = 0, stdout = "", stderr = "", durationMs = 1L),
        )
        assertTrue(out.startsWith("$ cc status\n"))
        assertFalse(out.startsWith("$ cc status \n")) // no trailing space before \n
    }
}
