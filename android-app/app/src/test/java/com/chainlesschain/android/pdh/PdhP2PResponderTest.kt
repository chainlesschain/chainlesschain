package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §8.3 P2P 请求-响应关联测试:requestId 关联响应、超时返 null、两个配对 responder 端到端
 * 跑 push/pull(BlockChannel→P2PResponder→线→P2PResponder→RequestHandler→BlockStore→回)。
 */
class PdhP2PResponderTest {

    /** in-memory messenger;设 [peer] 后 send 投递到对端 incoming(配对端到端用)。 */
    private class FakeMessenger(val myId: String) : PdhP2PResponder.P2PMessenger {
        val flow = MutableSharedFlow<P2PMessage>(extraBufferCapacity = 64)
        var peer: FakeMessenger? = null
        val sent = mutableListOf<String>()
        override val incoming = flow
        override suspend fun send(toDeviceId: String, payload: String) {
            sent.add(payload)
            peer?.flow?.emit(
                P2PMessage(UUID.randomUUID().toString(), myId, toDeviceId, MessageType.KNOWLEDGE_SYNC, payload),
            )
        }
    }

    private class FakeStore : PdhBackupRequestHandler.BlockStore {
        val map = HashMap<String, PdhBackupEnvelope.EncryptedBlock>()
        override fun put(block: PdhBackupEnvelope.EncryptedBlock) { map["${block.assetKind.name}.${block.contentHash}"] = block }
        override fun get(assetKind: AssetKind, hash: String) = map["${assetKind.name}.$hash"]
    }

    private fun block(hash: String) =
        PdhBackupEnvelope.EncryptedBlock(AssetKind.VAULT, hash, byteArrayOf(9), byteArrayOf(1, 2, 3))

    @Test
    fun request_correlates_response_by_request_id() = runTest(UnconfinedTestDispatcher()) {
        val m = FakeMessenger("A")
        val responder = PdhP2PResponder(m, backgroundScope, genRequestId = { "rid-1" })
        responder.start()
        val result = async { responder.request("B", "t", "hello".toByteArray()) }
        // 对端回带同 requestId 的响应信封
        m.flow.emit(
            P2PMessage(
                "id2", "B", "A", MessageType.KNOWLEDGE_SYNC,
                PdhP2PResponder.Envelope("rid-1", "t", true, "world".toByteArray()).encode(),
            ),
        )
        assertEquals("world", String(result.await()!!))
    }

    @Test
    fun request_auto_starts_collector_without_explicit_start() = runTest(UnconfinedTestDispatcher()) {
        val m = FakeMessenger("A")
        val responder = PdhP2PResponder(m, backgroundScope, genRequestId = { "rid-x" })
        // 不调 start() —— request() 应惰性自启动收集器
        val result = async { responder.request("B", "t", "hi".toByteArray()) }
        m.flow.emit(
            P2PMessage(
                "id", "B", "A", MessageType.KNOWLEDGE_SYNC,
                PdhP2PResponder.Envelope("rid-x", "t", true, "ok".toByteArray()).encode(),
            ),
        )
        assertEquals("ok", String(result.await()!!))
    }

    @Test
    fun request_times_out_to_null_when_no_response() = runTest {
        val responder = PdhP2PResponder(FakeMessenger("A"), backgroundScope, timeoutMs = 1000L)
        responder.start()
        assertNull(responder.request("B", "t", "x".toByteArray())) // 无响应 → 超时 null
    }

    @Test
    fun end_to_end_push_then_pull_over_two_responders() = runTest(UnconfinedTestDispatcher()) {
        val mA = FakeMessenger("A")
        val mB = FakeMessenger("B")
        mA.peer = mB
        mB.peer = mA
        val store = FakeStore()
        val respA = PdhP2PResponder(mA, backgroundScope) // 请求方
        val respB = PdhP2PResponder(
            mB, backgroundScope,
            onRequest = { type, data ->
                when (type) {
                    PdhBackupBlockChannel.TYPE_PUSH -> PdhBackupRequestHandler.handlePush(data, store)
                    PdhBackupBlockChannel.TYPE_PULL -> PdhBackupRequestHandler.handlePull(data, store)
                    else -> ByteArray(0)
                }
            },
        )
        respA.start()
        respB.start()
        val channel = PdhBackupBlockChannel("B", respA)

        assertTrue(channel.push(block("h1"))) // A 推到 B(经 handler 存入 store)
        val pulled = channel.pull(AssetKind.VAULT, "h1") // A 从 B 拉回
        assertEquals("h1", pulled?.contentHash)
        assertTrue(pulled!!.ciphertext.contentEquals(byteArrayOf(1, 2, 3)))
    }
}
