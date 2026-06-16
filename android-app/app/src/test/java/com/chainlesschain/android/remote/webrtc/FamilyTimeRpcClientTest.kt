package com.chainlesschain.android.remote.webrtc

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Test
import org.webrtc.IceCandidate
import org.webrtc.SessionDescription
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * FAMILY-60 验收: [FamilyTimeRpcClient] 请求-响应 + 超时 + requestId 关联。
 *
 * listener 跑 IO scope (runTest 不控), 故直驱 internal [FamilyTimeRpcClient.handleForwarded]
 * 注入响应 (同 FamilyCallRpcClientTest 模式), 避时序 flaky。
 */
class FamilyTimeRpcClientTest {

    private class FakeSignalClient(
        private val sendResult: Result<Unit> = Result.success(Unit),
    ) : SignalClient {
        private val forwarded = MutableSharedFlow<String>(extraBufferCapacity = 16)
        override val forwardedMessages: SharedFlow<String> = forwarded.asSharedFlow()

        var lastToPeerId: String? = null
        var lastPayload: JSONObject? = null

        override suspend fun sendForwardedMessage(
            toPeerId: String,
            payload: JSONObject,
        ): Result<Unit> {
            lastToPeerId = toPeerId
            lastPayload = payload
            return sendResult
        }

        // ── 以下 family.time 路径不用, 桩实现 ──
        override suspend fun connect(): Result<Unit> = Result.success(Unit)
        override suspend fun register(peerId: String, deviceInfo: Map<String, String>) {}
        override suspend fun sendOffer(peerId: String, offer: SessionDescription) {}
        override suspend fun sendIceCandidate(peerId: String, candidate: IceCandidate) {}
        override suspend fun waitForAnswer(peerId: String, timeout: Long): SessionDescription =
            error("unused")
        override suspend fun receiveIceCandidate(): IceCandidate = error("unused")
        override suspend fun sendAnswer(peerId: String, answer: SessionDescription) {}
        override suspend fun waitForOffer(peerId: String, timeout: Long): SessionDescription =
            error("unused")
        override fun setRelaySignaling(enabled: Boolean) {}
        override fun disconnect() {}
        override fun setOnForwardedMessageReceived(callback: ((String) -> Unit)?) {}
    }

    private fun response(requestId: String, epochMs: Long): String =
        JSONObject()
            .put("type", FamilyTimeRpcClient.RESPONSE_TYPE)
            .put("requestId", requestId)
            .put("parentEpochMs", epochMs)
            .toString()

    @Test
    fun `resolves with parentEpochMs on matching response`() = runTest {
        val fake = FakeSignalClient()
        val client = FamilyTimeRpcClient(fake)
        var result: Long? = null
        val job = launch { result = client.fetchParentEpochMs("parent-peer", timeoutMs = 10_000) }
        runCurrent() // 发请求 + await 挂起; lastPayload 已捕获

        assertEquals("parent-peer", fake.lastToPeerId)
        assertEquals(FamilyTimeRpcClient.REQUEST_TYPE, fake.lastPayload!!.getString("type"))
        val reqId = fake.lastPayload!!.getString("requestId")

        client.handleForwarded(response(reqId, 1_717_000_000_000L))
        runCurrent()
        job.join()

        assertEquals(1_717_000_000_000L, result)
        client.stop()
    }

    @Test
    fun `returns null on timeout when no response arrives`() = runTest {
        val fake = FakeSignalClient()
        val client = FamilyTimeRpcClient(fake)
        var result: Long? = 999L
        val job = launch { result = client.fetchParentEpochMs("parent-peer", timeoutMs = 5_000) }
        runCurrent()
        advanceTimeBy(5_001)
        runCurrent()
        job.join()
        assertNull(result)
        client.stop()
    }

    @Test
    fun `ignores wrong type and wrong requestId then times out`() = runTest {
        val fake = FakeSignalClient()
        val client = FamilyTimeRpcClient(fake)
        var result: Long? = 999L
        val job = launch { result = client.fetchParentEpochMs("parent-peer", timeoutMs = 5_000) }
        runCurrent()
        val reqId = fake.lastPayload!!.getString("requestId")

        // 非 family.time 响应类型 — 忽略
        client.handleForwarded(
            JSONObject().put("type", "chainlesschain:family:call:invite").put("requestId", reqId)
                .toString(),
        )
        // 正确类型但 requestId 不匹配 — 忽略
        client.handleForwarded(response("some-other-id", 123L))
        runCurrent()

        // waiter 未完成 → 走超时
        advanceTimeBy(5_001)
        runCurrent()
        job.join()
        assertNull(result)
        client.stop()
    }

    @Test
    fun `returns null when send fails`() = runTest {
        val fake = FakeSignalClient(sendResult = Result.failure(RuntimeException("relay down")))
        val client = FamilyTimeRpcClient(fake)
        val result = client.fetchParentEpochMs("parent-peer", timeoutMs = 10_000)
        assertNull(result)
        client.stop()
    }

    @Test
    fun `ignores response with non-positive parentEpochMs`() {
        val fake = FakeSignalClient()
        val client = FamilyTimeRpcClient(fake)
        // 直驱 handleForwarded 不应抛 (无匹配 pending 时 remove 返 null 安全丢弃)。
        client.handleForwarded(response("nobody-waiting", -1L))
        client.handleForwarded(response("nobody-waiting", 0L))
        client.stop()
    }
}
