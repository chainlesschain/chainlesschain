package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §8.3 块通道应答方测试:push 解码存库回 ACK(坏块回 ERR 不存)、pull 命中回块/缺失回
 * NOT_FOUND/坏请求回 NOT_FOUND。in-memory fake BlockStore。
 */
class PdhBackupRequestHandlerTest {

    private class FakeStore : PdhBackupRequestHandler.BlockStore {
        val map = HashMap<String, PdhBackupEnvelope.EncryptedBlock>()
        private fun k(kind: AssetKind, hash: String) = "${kind.name}.$hash"
        override fun put(block: PdhBackupEnvelope.EncryptedBlock) { map[k(block.assetKind, block.contentHash)] = block }
        override fun get(assetKind: AssetKind, hash: String) = map[k(assetKind, hash)]
    }

    private fun block(kind: AssetKind, hash: String) =
        PdhBackupEnvelope.EncryptedBlock(kind, hash, byteArrayOf(1), byteArrayOf(2, 3))

    @Test
    fun handle_push_decodes_stores_and_acks() {
        val store = FakeStore()
        val resp = PdhBackupRequestHandler.handlePush(PdhBlockCodec.encode(block(AssetKind.VAULT, "h1")), store)
        assertEquals(PdhBackupBlockChannel.ACK_OK, String(resp))
        assertTrue(store.map.containsKey("VAULT.h1"))
    }

    @Test
    fun handle_push_malformed_does_not_store() {
        val store = FakeStore()
        val resp = PdhBackupRequestHandler.handlePush("garbage".toByteArray(), store)
        assertTrue(String(resp) != PdhBackupBlockChannel.ACK_OK) // ERR
        assertTrue(store.map.isEmpty())
    }

    @Test
    fun handle_pull_hit_returns_encoded_block() {
        val store = FakeStore().apply { put(block(AssetKind.MEMORY, "h2")) }
        val resp = PdhBackupRequestHandler.handlePull("MEMORY.h2".toByteArray(), store)
        val decoded = PdhBlockCodec.decode(resp)
        assertEquals("h2", decoded.contentHash)
        assertEquals(AssetKind.MEMORY, decoded.assetKind)
    }

    @Test
    fun handle_pull_miss_returns_not_found() {
        val resp = PdhBackupRequestHandler.handlePull("VAULT.absent".toByteArray(), FakeStore())
        assertEquals(PdhBackupBlockChannel.NOT_FOUND, String(resp))
    }

    @Test
    fun handle_pull_malformed_request_returns_not_found() {
        assertEquals(PdhBackupBlockChannel.NOT_FOUND, String(PdhBackupRequestHandler.handlePull("nodot".toByteArray(), FakeStore())))
        assertNull(runCatching { PdhBlockCodec.decode(PdhBackupRequestHandler.handlePull("BADKIND.h".toByteArray(), FakeStore())) }.getOrNull())
    }
}
