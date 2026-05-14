package com.chainlesschain.android.remote.terminal

import com.chainlesschain.android.remote.client.SignalingRpcClient
import com.chainlesschain.android.remote.webrtc.SignalClient
import io.mockk.coEvery
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * TerminalRpcClient unit tests — covers Result decoding paths + the
 * push-event listener fan-out (terminal.stdout / terminal.exit).
 *
 * SignalingRpcClient is mocked at the suspend `invoke()` boundary so the
 * full deferred / signaling-forward plumbing isn't re-exercised here —
 * SignalingRpcClientTest already covers it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TerminalRpcClientTest {

    private lateinit var rpc: SignalingRpcClient
    private lateinit var signalClient: FakeSignalClient
    private lateinit var client: TerminalRpcClient

    private class FakeSignalClient : SignalClient {
        var callback: ((String) -> Unit)? = null
        override suspend fun connect(): Result<Unit> = Result.success(Unit)
        override suspend fun register(peerId: String, deviceInfo: Map<String, String>) {}
        override suspend fun sendOffer(peerId: String, offer: org.webrtc.SessionDescription) {}
        override suspend fun sendIceCandidate(peerId: String, candidate: org.webrtc.IceCandidate) {}
        override suspend fun waitForAnswer(peerId: String, timeout: Long): org.webrtc.SessionDescription =
            throw UnsupportedOperationException()
        override suspend fun receiveIceCandidate(): org.webrtc.IceCandidate =
            throw UnsupportedOperationException()
        override suspend fun sendForwardedMessage(
            toPeerId: String,
            payload: JSONObject,
        ): Result<Unit> = Result.success(Unit)
        override fun disconnect() {}
        override fun setOnForwardedMessageReceived(cb: ((String) -> Unit)?) { callback = cb }
    }

    @Before
    fun setUp() {
        rpc = mockk()
        signalClient = FakeSignalClient()
        client = TerminalRpcClient(rpc, signalClient)
    }

    @Test
    fun `create returns CreatedSession from JSON result`() = runTest {
        coEvery { rpc.invoke("pc-1", "terminal.create", any(), any()) } returns
            Result.success(
                JSONObject()
                    .put("sessionId", "sess-1")
                    .put("pid", 42)
                    .put("shell", "pwsh")
                    .put("createdAt", 1700000000000L),
            )
        val res = client.create("pc-1", shell = "pwsh", cols = 80, rows = 24)
        assertTrue(res.isSuccess)
        val session = res.getOrNull()!!
        assertEquals("sess-1", session.sessionId)
        assertEquals(42, session.pid)
        assertEquals("pwsh", session.shell)
        assertEquals(1700000000000L, session.createdAt)
    }

    @Test
    fun `list parses sessions array`() = runTest {
        coEvery { rpc.invoke("pc-1", "terminal.list", any(), any()) } returns
            Result.success(
                JSONObject().put(
                    "sessions",
                    JSONArray()
                        .put(
                            JSONObject()
                                .put("id", "s1")
                                .put("shell", "pwsh")
                                .put("cwd", "C:\\")
                                .put("alive", true)
                                .put("lastSeq", 7),
                        )
                        .put(
                            JSONObject()
                                .put("id", "s2")
                                .put("shell", "bash")
                                .put("alive", false)
                                .put("lastSeq", 12),
                        ),
                ),
            )
        val res = client.list("pc-1")
        val rows = res.getOrNull()!!
        assertEquals(2, rows.size)
        assertEquals("s1", rows[0].id)
        assertEquals("C:\\", rows[0].cwd)
        assertTrue(rows[0].alive)
        assertEquals(12, rows[1].lastSeq)
    }

    @Test
    fun `list returns empty when sessions array missing`() = runTest {
        coEvery { rpc.invoke("pc-1", "terminal.list", any(), any()) } returns
            Result.success(JSONObject())
        val res = client.list("pc-1")
        assertTrue(res.isSuccess)
        assertEquals(emptyList(), res.getOrNull())
    }

    @Test
    fun `stdin forwards data param`() = runTest {
        val captured = slot<Map<String, Any?>>()
        coEvery { rpc.invoke("pc-1", "terminal.stdin", capture(captured), any()) } returns
            Result.success(JSONObject().put("ok", true))
        val res = client.stdin("pc-1", "s1", "ls\r")
        assertTrue(res.isSuccess)
        assertEquals("s1", captured.captured["sessionId"])
        assertEquals("ls\r", captured.captured["data"])
    }

    @Test
    fun `resize forwards cols and rows`() = runTest {
        val captured = slot<Map<String, Any?>>()
        coEvery { rpc.invoke("pc-1", "terminal.resize", capture(captured), any()) } returns
            Result.success(JSONObject().put("ok", true))
        client.resize("pc-1", "s1", 120, 40).getOrThrow()
        assertEquals(120, captured.captured["cols"])
        assertEquals(40, captured.captured["rows"])
    }

    @Test
    fun `close forwards sessionId`() = runTest {
        val captured = slot<Map<String, Any?>>()
        coEvery { rpc.invoke("pc-1", "terminal.close", capture(captured), any()) } returns
            Result.success(JSONObject().put("ok", true))
        client.close("pc-1", "s1").getOrThrow()
        assertEquals("s1", captured.captured["sessionId"])
    }

    @Test
    fun `history decodes chunks and truncated flag`() = runTest {
        coEvery { rpc.invoke("pc-1", "terminal.history", any(), any()) } returns
            Result.success(
                JSONObject()
                    .put("truncated", true)
                    .put(
                        "chunks",
                        JSONArray()
                            .put(JSONObject().put("seq", 5).put("data", "hello"))
                            .put(JSONObject().put("seq", 6).put("data", "世界")),
                    ),
            )
        val res = client.history("pc-1", "s1", fromSeq = 5).getOrThrow()
        assertTrue(res.truncated)
        assertEquals(2, res.chunks.size)
        assertEquals("hello", res.chunks[0].data)
        assertEquals(5, res.chunks[0].seq)
        assertEquals("世界", res.chunks[1].data)
    }

    @Test
    fun `start installs push listener and dispatches terminal_stdout to flow`() = runTest {
        client.start()
        val testScope = TestScope(StandardTestDispatcher(testScheduler))
        val received = mutableListOf<TerminalRpcClient.StdoutEvent>()
        val job = launch {
            client.observeStdout().collect { received.add(it) }
        }

        val frame = JSONObject()
            .put("type", "chainlesschain:event")
            .put(
                "payload",
                JSONObject()
                    .put("event", "terminal.stdout")
                    .put("sessionId", "s1")
                    .put("data", "hello world")
                    .put("seq", 99),
            )
        signalClient.callback?.invoke(frame.toString())
        runCurrentScheduler()

        assertEquals(1, received.size)
        assertEquals("s1", received[0].sessionId)
        assertEquals("hello world", received[0].data)
        assertEquals(99, received[0].seq)
        job.cancel()
    }

    @Test
    fun `start dispatches terminal_exit to flow`() = runTest {
        client.start()
        val received = mutableListOf<TerminalRpcClient.ExitEvent>()
        val job = launch {
            client.observeExit().collect { received.add(it) }
        }
        val frame = JSONObject()
            .put("type", "chainlesschain:event")
            .put(
                "payload",
                JSONObject()
                    .put("event", "terminal.exit")
                    .put("sessionId", "s1")
                    .put("exitCode", 0)
                    .put("signal", JSONObject.NULL),
            )
        signalClient.callback?.invoke(frame.toString())
        runCurrentScheduler()

        assertEquals(1, received.size)
        assertEquals(0, received[0].exitCode)
        assertEquals(null, received[0].signal)
        job.cancel()
    }

    @Test
    fun `start is idempotent — second call is a no-op`() {
        client.start()
        val first = signalClient.callback
        client.start()
        // The callback should be the same instance (not re-installed).
        assertEquals(first, signalClient.callback)
    }

    @Test
    fun `start ignores non-terminal events`() = runTest {
        client.start()
        val received = mutableListOf<TerminalRpcClient.StdoutEvent>()
        val job = launch {
            client.observeStdout().collect { received.add(it) }
        }
        val frame = JSONObject()
            .put("type", "chainlesschain:event")
            .put(
                "payload",
                JSONObject()
                    .put("event", "unrelated.event")
                    .put("sessionId", "s1"),
            )
        signalClient.callback?.invoke(frame.toString())
        runCurrentScheduler()
        assertEquals(0, received.size)
        job.cancel()
    }

    private fun kotlinx.coroutines.test.TestScope.runCurrentScheduler() {
        testScheduler.runCurrent()
    }
}
