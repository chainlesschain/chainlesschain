package com.chainlesschain.android.pdh

import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §8.3 libp2p 块通道(请求方)测试:push→ACK、pull 往返(经应答方处理器+块库,端到端)、
 * pull 缺失返 null、pull 内容寻址不符拒收、push 非 ACK 返 false。suspend → runTest + fake responder。
 */
class PdhBackupBlockChannelTest {

    private fun block(kind: AssetKind, hash: String) =
        PdhBackupEnvelope.EncryptedBlock(kind, hash, byteArrayOf(9), byteArrayOf(1, 2, 3))

    private class FakeStore : PdhBackupRequestHandler.BlockStore {
        val map = HashMap<String, PdhBackupEnvelope.EncryptedBlock>()
        override fun put(block: PdhBackupEnvelope.EncryptedBlock) { map["${block.assetKind.name}.${block.contentHash}"] = block }
        override fun get(assetKind: AssetKind, hash: String) = map["${assetKind.name}.$hash"]
    }

    /** Fake responder 路由到真应答处理器 + in-memory 块库 → 端到端验证请求方↔应答方。 */
    private class HandlerResponder(val store: FakeStore) : PdhBackupBlockChannel.P2PResponder {
        override suspend fun request(peerId: String, type: String, payload: ByteArray): ByteArray? =
            when (type) {
                PdhBackupBlockChannel.TYPE_PUSH -> PdhBackupRequestHandler.handlePush(payload, store)
                PdhBackupBlockChannel.TYPE_PULL -> PdhBackupRequestHandler.handlePull(payload, store)
                else -> null
            }
    }

    @Test
    fun push_then_pull_round_trips_end_to_end() = runTest {
        val store = FakeStore()
        val channel = PdhBackupBlockChannel("peerB", HandlerResponder(store))
        val b = block(AssetKind.VAULT, "h1")
        assertTrue(channel.push(b)) // 推成功(ACK)
        val pulled = channel.pull(AssetKind.VAULT, "h1")
        assertEquals("h1", pulled?.contentHash) // 拉回同块
        assertTrue(pulled!!.ciphertext.contentEquals(b.ciphertext))
    }

    @Test
    fun pull_missing_returns_null() = runTest {
        val channel = PdhBackupBlockChannel("peerB", HandlerResponder(FakeStore()))
        assertNull(channel.pull(AssetKind.MEMORY, "absent"))
    }

    @Test
    fun pull_rejects_content_hash_mismatch() = runTest {
        // responder 返回的块 hash 与请求不符 → 内容寻址完整性拒收
        val responder = object : PdhBackupBlockChannel.P2PResponder {
            override suspend fun request(peerId: String, type: String, payload: ByteArray) =
                PdhBlockCodec.encode(block(AssetKind.VAULT, "WRONG"))
        }
        assertNull(PdhBackupBlockChannel("p", responder).pull(AssetKind.VAULT, "requested"))
    }

    @Test
    fun push_non_ack_returns_false() = runTest {
        val responder = object : PdhBackupBlockChannel.P2PResponder {
            override suspend fun request(peerId: String, type: String, payload: ByteArray) =
                "ERR".toByteArray()
        }
        assertFalse(PdhBackupBlockChannel("p", responder).push(block(AssetKind.VAULT, "h")))
    }

    @Test
    fun push_null_response_returns_false() = runTest {
        val responder = object : PdhBackupBlockChannel.P2PResponder {
            override suspend fun request(peerId: String, type: String, payload: ByteArray): ByteArray? = null
        }
        assertFalse(PdhBackupBlockChannel("p", responder).push(block(AssetKind.VAULT, "h")))
    }
}
