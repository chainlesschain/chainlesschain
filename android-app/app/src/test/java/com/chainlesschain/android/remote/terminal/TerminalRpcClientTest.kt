package com.chainlesschain.android.remote.terminal

import com.chainlesschain.android.remote.client.SignalingRpcClient
import com.chainlesschain.android.remote.webrtc.SignalClient
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
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

    private val testDispatcher = StandardTestDispatcher()

    private lateinit var rpc: SignalingRpcClient
    private lateinit var signalClient: FakeSignalClient
    private lateinit var webRTCClient: WebRTCClient
    private lateinit var dcMessages: MutableSharedFlow<String>
    private lateinit var client: TerminalRpcClient

    private class FakeSignalClient : SignalClient {
        var callback: ((String) -> Unit)? = null
        private val _forwardedMessages = MutableSharedFlow<String>(extraBufferCapacity = 64)
        override val forwardedMessages: SharedFlow<String> = _forwardedMessages.asSharedFlow()
        suspend fun emitForwarded(raw: String) = _forwardedMessages.emit(raw)
        /** Expose subscription count for idempotency tests (SharedFlow API hides it). */
        val subscriberCount: Int get() = _forwardedMessages.subscriptionCount.value

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
        Dispatchers.setMain(testDispatcher)
        rpc = mockk()
        signalClient = FakeSignalClient()
        webRTCClient = mockk(relaxed = true)
        dcMessages = MutableSharedFlow(extraBufferCapacity = 64)
        every { webRTCClient.messages } returns dcMessages.asSharedFlow()
        client = TerminalRpcClient(rpc, signalClient, webRTCClient)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `create returns CreatedSession from JSON result`() = runTest(testDispatcher) {
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
    fun `list parses sessions array`() = runTest(testDispatcher) {
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
    fun `list returns empty when sessions array missing`() = runTest(testDispatcher) {
        coEvery { rpc.invoke("pc-1", "terminal.list", any(), any()) } returns
            Result.success(JSONObject())
        val res = client.list("pc-1")
        assertTrue(res.isSuccess)
        assertEquals(emptyList(), res.getOrNull())
    }

    @Test
    fun `stdin forwards data param`() = runTest(testDispatcher) {
        val captured = slot<Map<String, Any?>>()
        coEvery { rpc.invoke("pc-1", "terminal.stdin", capture(captured), any()) } returns
            Result.success(JSONObject().put("ok", true))
        val res = client.stdin("pc-1", "s1", "ls\r")
        assertTrue(res.isSuccess)
        assertEquals("s1", captured.captured["sessionId"])
        assertEquals("ls\r", captured.captured["data"])
    }

    @Test
    fun `resize forwards cols and rows`() = runTest(testDispatcher) {
        val captured = slot<Map<String, Any?>>()
        coEvery { rpc.invoke("pc-1", "terminal.resize", capture(captured), any()) } returns
            Result.success(JSONObject().put("ok", true))
        client.resize("pc-1", "s1", 120, 40).getOrThrow()
        assertEquals(120, captured.captured["cols"])
        assertEquals(40, captured.captured["rows"])
    }

    @Test
    fun `close forwards sessionId`() = runTest(testDispatcher) {
        val captured = slot<Map<String, Any?>>()
        coEvery { rpc.invoke("pc-1", "terminal.close", capture(captured), any()) } returns
            Result.success(JSONObject().put("ok", true))
        client.close("pc-1", "s1").getOrThrow()
        assertEquals("s1", captured.captured["sessionId"])
    }

    @Test
    fun `history decodes chunks and truncated flag`() = runTest(testDispatcher) {
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
    fun `start installs push listener and dispatches terminal_stdout to flow`() = runTest(testDispatcher) {
        client.start()
        val received = mutableListOf<TerminalRpcClient.StdoutEvent>()
        val job = launch {
            client.observeStdout().collect { received.add(it) }
        }
        // Ensure both client's forwardedMessages collect AND test's observeStdout collect
        // are subscribed before we emit (SharedFlow has no replay — missed = lost).
        runCurrentScheduler()

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
        signalClient.emitForwarded(frame.toString())
        runCurrentScheduler()

        assertEquals(1, received.size)
        assertEquals("s1", received[0].sessionId)
        assertEquals("hello world", received[0].data)
        assertEquals(99, received[0].seq)
        job.cancel()
    }

    @Test
    fun `start dispatches terminal_exit to flow`() = runTest(testDispatcher) {
        client.start()
        val received = mutableListOf<TerminalRpcClient.ExitEvent>()
        val job = launch {
            client.observeExit().collect { received.add(it) }
        }
        runCurrentScheduler()  // Subscribers attach before emit (no-replay SharedFlow).
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
        signalClient.emitForwarded(frame.toString())
        runCurrentScheduler()

        assertEquals(1, received.size)
        assertEquals(0, received[0].exitCode)
        assertEquals(null, received[0].signal)
        job.cancel()
    }

    @Test
    fun `start is idempotent — second call is a no-op`() = runTest(testDispatcher) {
        // Plan A.1: start switched to forwardedMessages SharedFlow.
        // Idempotency is verified via subscriptionCount — two starts still yield
        // 1 subscriber, proving no duplicate collect job was created.
        client.start()
        runCurrentScheduler()
        val afterFirst = signalClient.subscriberCount
        client.start()
        runCurrentScheduler()
        assertEquals(afterFirst, signalClient.subscriberCount)
    }

    /**
     * Plan A.1 Trap 1 regression — verify that `TerminalRpcClient.start()` does NOT
     * call `signalClient.setOnForwardedMessageReceived`, so a previously-installed
     * callback (production: `WebRTCClient.initialize` ice:config handler) stays alive.
     *
     * Pre Plan A.1 this test would fail: start() called setOnForwardedMessageReceived,
     * silently replacing any earlier handler.
     */
    @Test
    fun `start does not overwrite externally-installed forward callback (Trap 1 regression)`() = runTest(testDispatcher) {
        var externalHits = 0
        val externalCallback: (String) -> Unit = { externalHits++ }
        signalClient.setOnForwardedMessageReceived(externalCallback)
        client.start()
        runCurrentScheduler()
        // External callback must still be the one we installed — start() did not touch it.
        assertEquals(externalCallback, signalClient.callback)
    }

    /**
     * Plan A.1 Phase 4 → v5.0.3.53-fix5 真机 E2E 修订：dedup gate 被**故意去掉**
     * （详见 [TerminalRpcClient] L151-160 注释）。真机上 listener fires 4 次 per
     * stdout event（forwardedMessages + _messages 双 emit + 老 callback 残留），
     * dedup 把所有 4 次都 drop → WebView 永远黑屏。
     *
     * 当前行为：DC + signaling 双发都 emit 到 SharedFlow；xterm.js 收重复 chunk
     * 只是渲染同样字节 N 次，对用户不可感（视觉上轻微重复，无功能损坏）。
     *
     * v0.2 dedup-redesign：(sessionId, seq, payload-hash) + emit-first-add-after
     * 模式 — 届时本测试期望改回 1。
     */
    @Test
    fun `Plan A1 — stdout from DC and signaling double-emits per v5_0_3_53 fix5 (dedup disabled)`() = runTest(testDispatcher) {
        client.start()
        val received = mutableListOf<TerminalRpcClient.StdoutEvent>()
        val job = launch {
            client.observeStdout().collect { received.add(it) }
        }
        runCurrentScheduler()

        val frame = JSONObject()
            .put("type", "chainlesschain:event")
            .put(
                "payload",
                JSONObject()
                    .put("event", "terminal.stdout")
                    .put("sessionId", "s1")
                    .put("data", "hello")
                    .put("seq", 42),
            ).toString()

        // First delivery via signaling, second via DC — same (s1, 42).
        signalClient.emitForwarded(frame)
        dcMessages.emit(frame)
        runCurrentScheduler()

        // v5.0.3.53-fix5: dedup disabled — 双发各 emit 一次
        assertEquals(2, received.size, "dedup disabled — both DC + signaling emit (v0.2 will re-enable)")
        assertEquals("hello", received[0].data)
        assertEquals("hello", received[1].data)
        job.cancel()
    }

    /**
     * v5.0.3.53-fix5: 同 stdout dedup 一并去除。exit 多 emit 是 idempotent（ViewModel
     * 只用第一次的 exitCode 关 session），UI 不受影响。详见 [TerminalRpcClient] L178-179。
     */
    @Test
    fun `Plan A1 — exit from DC and signaling double-emits per v5_0_3_53 fix5 (dedup disabled)`() = runTest(testDispatcher) {
        client.start()
        val received = mutableListOf<TerminalRpcClient.ExitEvent>()
        val job = launch {
            client.observeExit().collect { received.add(it) }
        }
        runCurrentScheduler()

        val frame = JSONObject()
            .put("type", "chainlesschain:event")
            .put(
                "payload",
                JSONObject()
                    .put("event", "terminal.exit")
                    .put("sessionId", "s1")
                    .put("exitCode", 0)
                    .put("signal", JSONObject.NULL),
            ).toString()

        signalClient.emitForwarded(frame)
        dcMessages.emit(frame)
        runCurrentScheduler()

        // dedup disabled — 双 emit，但 ViewModel 用 first-write-wins 兼容
        assertEquals(2, received.size, "dedup disabled — both emit (idempotent at ViewModel layer)")
        job.cancel()
    }

    @Test
    fun `Plan A1 — DC path delivers stdout when signaling silent`() = runTest(testDispatcher) {
        client.start()
        val received = mutableListOf<TerminalRpcClient.StdoutEvent>()
        val job = launch {
            client.observeStdout().collect { received.add(it) }
        }
        runCurrentScheduler()

        val frame = JSONObject()
            .put("type", "chainlesschain:event")
            .put(
                "payload",
                JSONObject()
                    .put("event", "terminal.stdout")
                    .put("sessionId", "s1")
                    .put("data", "dc-only")
                    .put("seq", 7),
            ).toString()

        // Only DC path delivers.
        dcMessages.emit(frame)
        runCurrentScheduler()

        assertEquals(1, received.size)
        assertEquals("dc-only", received[0].data)
        job.cancel()
    }

    @Test
    fun `start ignores non-terminal events`() = runTest(testDispatcher) {
        client.start()
        val received = mutableListOf<TerminalRpcClient.StdoutEvent>()
        val job = launch {
            client.observeStdout().collect { received.add(it) }
        }
        runCurrentScheduler()  // Subscribers attach before emit.
        val frame = JSONObject()
            .put("type", "chainlesschain:event")
            .put(
                "payload",
                JSONObject()
                    .put("event", "unrelated.event")
                    .put("sessionId", "s1"),
            )
        signalClient.emitForwarded(frame.toString())
        runCurrentScheduler()
        assertEquals(0, received.size)
        job.cancel()
    }

    private fun kotlinx.coroutines.test.TestScope.runCurrentScheduler() {
        testScheduler.runCurrent()
    }
}
