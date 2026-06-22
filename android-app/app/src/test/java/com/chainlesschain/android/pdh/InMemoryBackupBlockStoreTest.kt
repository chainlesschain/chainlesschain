package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §8.3 内存块库测试:put/get(kind+hash 寻址)、putPushed→drainPushed 取出并清空且不含自有块、
 * miss 返 null。
 */
class InMemoryBackupBlockStoreTest {

    private fun block(kind: AssetKind, hash: String) =
        PdhBackupEnvelope.EncryptedBlock(kind, hash, byteArrayOf(1), byteArrayOf(2, 3))

    @Test
    fun put_and_get_by_kind_and_hash() {
        val store = InMemoryBackupBlockStore()
        store.put(block(AssetKind.VAULT, "h1"))
        assertEquals("h1", store.get(AssetKind.VAULT, "h1")?.contentHash)
        assertNull(store.get(AssetKind.MEMORY, "h1")) // 不同 kind 同 hash 不撞
        assertNull(store.get(AssetKind.VAULT, "absent"))
    }

    @Test
    fun drain_pushed_returns_only_pushed_and_clears() {
        val store = InMemoryBackupBlockStore()
        store.put(block(AssetKind.VAULT, "own")) // 本机自有块(非 push)
        store.putPushed(block(AssetKind.MEMORY, "fromPeer"))
        val drained = store.drainPushed()
        assertEquals(listOf("fromPeer"), drained.map { it.contentHash }) // 只 push 来的
        assertTrue(store.drainPushed().isEmpty()) // drain 后清空
        assertEquals("own", store.get(AssetKind.VAULT, "own")?.contentHash) // 自有块仍在
    }
}
