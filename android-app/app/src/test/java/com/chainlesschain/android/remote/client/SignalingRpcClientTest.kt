package com.chainlesschain.android.remote.client

import com.chainlesschain.android.core.did.manager.DIDIdentity
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.config.SignalingConfig
import com.chainlesschain.android.core.p2p.pairing.PairingSignalingGate
import com.chainlesschain.android.remote.webrtc.SignalClient
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * SignalingRpcClient 单元测试 — v1.3+ issue #21 plan C。
 *
 * 用 hand-rolled FakeSignalClient 而非 mockk —— mockk 对 nullable function-type
 * argument 的 capture 路径不稳定（arg<>/firstArg 拿到 null），且 SignalClient 接口
 * 有 9 个方法但只用 setOnForwardedMessageReceived，stub 其余 8 个开销极低。
 *
 * 依赖 `testImplementation("org.json:json:...")`：Android SDK 自带的
 * `org.json.JSONObject` 是 stub，在 `isReturnDefaultValues=true` 下方法静默返
 * 默认值而非真解析 JSON，会让 invoke() 内部 payload 丢字段。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalingRpcClientTest {

    private val testDispatcher = StandardTestDispatcher()

    private lateinit var didManager: DIDManager
    private lateinit var identityFlow: MutableStateFlow<DIDIdentity?>
    private lateinit var fakeSignalClient: FakeSignalClient
    private lateinit var signalingConfig: SignalingConfig

    private class FakeSignalClient : SignalClient {
        var onForwardedCallback: ((String) -> Unit)? = null
        var setCallbackCount = 0
        private val _forwardedMessages = MutableSharedFlow<String>(extraBufferCapacity = 64)
        override val forwardedMessages: SharedFlow<String> = _forwardedMessages.asSharedFlow()

        /** Test helper — emit 一帧 forwarded message 模拟桌面经信令转发的响应。 */
        suspend fun emitForwarded(raw: String) {
            _forwardedMessages.emit(raw)
        }

        override suspend fun connect(): Result<Unit> = Result.success(Unit)
        override suspend fun register(peerId: String, deviceInfo: Map<String, String>) {}
        override suspend fun sendOffer(peerId: String, offer: org.webrtc.SessionDescription) {}
        override suspend fun sendIceCandidate(
            peerId: String,
            candidate: org.webrtc.IceCandidate,
        ) {}
        override suspend fun waitForAnswer(
            peerId: String,
            timeout: Long,
        ): org.webrtc.SessionDescription =
            throw UnsupportedOperationException("not used by SignalingRpcClient test")
        override suspend fun sendAnswer(peerId: String, answer: org.webrtc.SessionDescription) {}
        override suspend fun waitForOffer(
            peerId: String,
            timeout: Long,
        ): org.webrtc.SessionDescription =
            throw UnsupportedOperationException("not used by SignalingRpcClient test")
        override suspend fun receiveIceCandidate(): org.webrtc.IceCandidate =
            throw UnsupportedOperationException("not used by SignalingRpcClient test")
        override suspend fun sendForwardedMessage(
            toPeerId: String,
            payload: org.json.JSONObject,
        ): Result<Unit> = Result.success(Unit)
        override fun disconnect() {}
        override fun setOnForwardedMessageReceived(callback: ((String) -> Unit)?) {
            setCallbackCount++
            onForwardedCallback = callback
        }
    }

    private class CapturingGate(
        private val firstResult: Result<Unit> = Result.success(Unit),
        private val secondResult: Result<Unit> = Result.success(Unit),
    ) : PairingSignalingGate {
        var lastPayload: Map<String, Any?>? = null
        var sendAckCallCount = 0
        var resetCallCount = 0
        var ensureRegisteredCallCount = 0

        override suspend fun ensureRegistered(localPeerId: String): Result<Unit> {
            ensureRegisteredCallCount++
            return Result.success(Unit)
        }

        override suspend fun sendAck(
            toPeerId: String,
            ackPayload: Map<String, Any?>,
        ): Result<Unit> {
            sendAckCallCount++
            lastPayload = ackPayload
            return if (sendAckCallCount == 1) firstResult else secondResult
        }

        override suspend fun reset() {
            resetCallCount++
        }
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        didManager = mockk(relaxed = true)
        identityFlow = MutableStateFlow(null)
        every { didManager.currentIdentity } returns identityFlow

        fakeSignalClient = FakeSignalClient()
        signalingConfig = mockk(relaxed = true)
        every { signalingConfig.getRelayUrl() } returns "wss://signaling.chainlesschain.com"
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun seedDid(did: String = "did:cc:mobile") {
        identityFlow.value = DIDIdentity(
            did = did,
            deviceName = "Test",
            keyPair = mockk(relaxed = true),
            didDocument = mockk(relaxed = true),
            createdAt = 1L,
        )
    }

    private fun makeClient(
        gate: CapturingGate,
        webRTCClient: com.chainlesschain.android.remote.webrtc.WebRTCClient = defaultWebRTCMock(),
    ): SignalingRpcClient =
        SignalingRpcClient(
            signalingGate = gate,
            signalClient = fakeSignalClient,
            didManager = didManager,
            signalingConfig = signalingConfig,
            pairedDesktopsStore = mockk(relaxed = true),
            webRTCClient = webRTCClient,
        )

    /**
     * Default WebRTCClient mock — DC NOT ready (DISCONNECTED). Most existing tests
     * exercise the signaling fallback path; Plan A.1 DC fast-path tests below
     * override this to inject a READY state.
     */
    private fun defaultWebRTCMock(): com.chainlesschain.android.remote.webrtc.WebRTCClient {
        val m = mockk<com.chainlesschain.android.remote.webrtc.WebRTCClient>(relaxed = true)
        val state = MutableStateFlow(com.chainlesschain.android.remote.webrtc.P2PConnectionState.DISCONNECTED)
        every { m.connectionState } returns state
        // messages flow — required by ensureResponseListener.launchIn collect
        val msgs = kotlinx.coroutines.flow.MutableSharedFlow<String>(extraBufferCapacity = 64)
        every { m.messages } returns msgs.asSharedFlow()
        return m
    }

    /**
     * Synthesize a forwarded RPC response and feed it into the response listener,
     * matching the wire shape from desktop `handleMobileCommand`:
     *   {type:"chainlesschain:command:response", payload:"<jsonrpc-2.0 stringified>"}
     *
     * Plan A.1 — emit via SharedFlow（替代旧的单 callback path）。
     */
    private suspend fun simulateResponse(
        requestId: String,
        resultMap: Map<String, Any?>? = mapOf("ok" to true),
        errorMap: Map<String, Any?>? = null,
    ) {
        val rpc = JSONObject().apply {
            put("jsonrpc", "2.0")
            put("id", requestId)
            if (resultMap != null) put("result", JSONObject(resultMap))
            if (errorMap != null) put("error", JSONObject(errorMap))
        }
        val outer = JSONObject().apply {
            put("type", "chainlesschain:command:response")
            put("payload", rpc.toString())
        }
        fakeSignalClient.emitForwarded(outer.toString())
    }

    private fun extractRequestId(gate: CapturingGate): String {
        val payload = gate.lastPayload!!
        val nested = payload["payload"] as JSONObject
        return nested.getString("id")
    }

    @Test
    fun `invoke without DID fails fast`() = runTest(testDispatcher) {
        val gate = CapturingGate()
        val client = makeClient(gate)

        val res = client.invoke("pc-1", "system.ping")

        assertTrue(res.isFailure)
        assertEquals(0, gate.sendAckCallCount, "should not even reach sendAck")
    }

    @Test
    fun `invoke happy path resolves via response listener`() = runTest(testDispatcher) {
        // Use runCurrent (not advanceUntilIdle) — withTimeout uses virtual delay,
        // advanceUntilIdle would auto-advance virtual time past the 30s timeout
        // and trigger TimeoutCancellationException before we can deliver the response.
        seedDid()
        val gate = CapturingGate()
        val client = makeClient(gate)

        val deferredResult = async { client.invoke("pc-1", "system.ping") }
        runCurrent()

        assertEquals(1, gate.sendAckCallCount)
        // Plan A.1: listener 安装确认走 SharedFlow 订阅；下面 simulateResponse 能让
        // deferred 完成本身就是 listener active 的证据，单独 assertNotNull callback
        // 已不适用（callback path 仅 WebRTCClient.initialize 用）。

        simulateResponse(extractRequestId(gate))
        runCurrent()

        val r = deferredResult.await()
        assertTrue(r.isSuccess, "got failure: ${r.exceptionOrNull()?.message}")
        assertEquals(true, r.getOrNull()?.getBoolean("ok"))
    }

    @Test
    fun `LAN sendAck failure falls back to relay`() = runTest(testDispatcher) {
        seedDid()
        val gate = CapturingGate(
            firstResult = Result.failure(RuntimeException("LAN down")),
            secondResult = Result.success(Unit),
        )
        val client = makeClient(gate)

        val deferredResult = async { client.invoke("pc-1", "system.ping") }
        runCurrent()

        assertEquals(2, gate.sendAckCallCount, "second call after LAN fail")
        assertEquals(1, gate.resetCallCount, "gate reset before URL switch")
        verify { signalingConfig.setCustomSignalingUrl("wss://signaling.chainlesschain.com") }

        simulateResponse(extractRequestId(gate))
        runCurrent()

        assertTrue(deferredResult.await().isSuccess)
    }

    @Test
    fun `both LAN and relay failure returns Result_failure`() = runTest(testDispatcher) {
        seedDid()
        val gate = CapturingGate(
            firstResult = Result.failure(RuntimeException("LAN down")),
            secondResult = Result.failure(RuntimeException("relay down")),
        )
        val client = makeClient(gate)

        val r = client.invoke("pc-1", "system.ping")

        assertTrue(r.isFailure)
        assertTrue(r.exceptionOrNull()?.message?.contains("relay down") == true)
        assertEquals(2, gate.sendAckCallCount)
    }

    @Test
    fun `response with error field returns Result_failure`() = runTest(testDispatcher) {
        seedDid()
        val gate = CapturingGate()
        val client = makeClient(gate)

        val deferred = async { client.invoke("pc-1", "system.ping") }
        runCurrent()
        val rid = extractRequestId(gate)

        simulateResponse(
            requestId = rid,
            resultMap = null,
            errorMap = mapOf("code" to -32000, "message" to "boom"),
        )
        runCurrent()

        val r = deferred.await()
        assertTrue(r.isFailure)
        assertTrue(r.exceptionOrNull()?.message?.contains("远程错误") == true)
    }

    @Test
    fun `invoke times out when no response arrives`() = runTest(testDispatcher) {
        seedDid()
        val gate = CapturingGate()
        val client = makeClient(gate)

        val deferred = async {
            client.invoke("pc-1", "system.ping", timeoutMs = 100L)
        }
        advanceTimeBy(200L)
        advanceUntilIdle()

        val r = deferred.await()
        assertTrue(r.isFailure)
        assertTrue(r.exceptionOrNull()?.message?.contains("超时") == true)
    }

    @Test
    fun `response for unknown rid is ignored without crashing`() = runTest(testDispatcher) {
        seedDid()
        val gate = CapturingGate()
        val client = makeClient(gate)

        val deferred = async { client.invoke("pc-1", "system.ping") }
        runCurrent()

        simulateResponse(requestId = "not-a-real-rid")
        runCurrent()

        simulateResponse(extractRequestId(gate))
        runCurrent()

        assertTrue(deferred.await().isSuccess)
    }

    // ==================== Plan A.1 Phase 2 — DC fast path tests ====================

    /** WebRTCClient mock in READY state with a working sendMessage stub. */
    private fun readyWebRTCMock(): com.chainlesschain.android.remote.webrtc.WebRTCClient {
        val m = mockk<com.chainlesschain.android.remote.webrtc.WebRTCClient>(relaxed = true)
        every { m.connectionState } returns
            MutableStateFlow(com.chainlesschain.android.remote.webrtc.P2PConnectionState.READY)
        every { m.messages } returns
            MutableSharedFlow<String>(extraBufferCapacity = 64).asSharedFlow()
        every { m.sendMessage(any()) } returns Unit
        return m
    }

    @Test
    fun `Plan A1 — DC ready uses DC path, signaling untouched`() = runTest(testDispatcher) {
        seedDid()
        val gate = CapturingGate()
        val webRTC = readyWebRTCMock()
        // Capture DC envelope so we can extract the requestId (gate.lastPayload would
        // be null — DC path bypasses signaling).
        val dcEnvelope = slot<String>()
        every { webRTC.sendMessage(capture(dcEnvelope)) } returns Unit
        val client = makeClient(gate, webRTC)

        val deferred = async { client.invoke("pc-1", "system.ping") }
        runCurrent()

        // DC path: sendMessage called once, signaling gate.sendAck NOT called.
        verify(exactly = 1) { webRTC.sendMessage(any()) }
        assertEquals(0, gate.sendAckCallCount, "signaling gate must NOT be hit when DC is ready")
        assertEquals(0, gate.ensureRegisteredCallCount)

        // Extract requestId from the captured DC envelope.
        val rid = JSONObject(dcEnvelope.captured)
            .getJSONObject("payload")
            .getString("id")

        // Response can come via either path — emit via signaling SharedFlow.
        simulateResponse(rid)
        runCurrent()

        assertTrue(deferred.await().isSuccess)
    }

    @Test
    fun `Plan A1 — preferDataChannel=false forces signaling even when DC ready`() = runTest(testDispatcher) {
        seedDid()
        val gate = CapturingGate()
        val webRTC = readyWebRTCMock()
        val client = makeClient(gate, webRTC)
        client.preferDataChannel = false  // feature flag off

        val deferred = async { client.invoke("pc-1", "system.ping") }
        runCurrent()

        // DC NOT used; signaling path taken.
        verify(exactly = 0) { webRTC.sendMessage(any()) }
        assertEquals(1, gate.sendAckCallCount)

        simulateResponse(extractRequestId(gate))
        runCurrent()
        assertTrue(deferred.await().isSuccess)
    }

    @Test
    fun `Plan A1 — DC not ready falls through to signaling`() = runTest(testDispatcher) {
        seedDid()
        val gate = CapturingGate()
        // default mock has DISCONNECTED state
        val client = makeClient(gate)

        val deferred = async { client.invoke("pc-1", "system.ping") }
        runCurrent()

        assertEquals(1, gate.sendAckCallCount)

        simulateResponse(extractRequestId(gate))
        runCurrent()
        assertTrue(deferred.await().isSuccess)
    }

    @Test
    fun `Plan A1 — DC sendMessage throws falls back to signaling`() = runTest(testDispatcher) {
        seedDid()
        val gate = CapturingGate()
        val webRTC = readyWebRTCMock()
        every { webRTC.sendMessage(any()) } throws IllegalStateException("Data channel not open")
        val client = makeClient(gate, webRTC)

        val deferred = async { client.invoke("pc-1", "system.ping") }
        runCurrent()

        // DC was attempted then fallback signaling kicked in.
        verify(exactly = 1) { webRTC.sendMessage(any()) }
        assertEquals(1, gate.sendAckCallCount, "fallback signaling must have been taken after DC threw")

        simulateResponse(extractRequestId(gate))
        runCurrent()
        assertTrue(deferred.await().isSuccess)
    }
}
