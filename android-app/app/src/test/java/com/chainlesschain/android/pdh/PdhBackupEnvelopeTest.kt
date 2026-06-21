package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.security.strongbox.EncryptResult
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * §8.3 加密块信封纯逻辑测试:内容寻址(同明文同 hash)、封装/解封往返、解封校验明文
 * 哈希(篡改/错密钥即抛)、转增量同步块引用。AES 本体由 KeystoreFacade 覆盖,这里用
 * 可逆 fake cipher 验证信封编排。
 */
class PdhBackupEnvelopeTest {

    /** 可逆 fake:seal=反转字节(iv 固定),open=再反转。验证信封逻辑,非真 AES。 */
    private val fakeCipher = object : PdhBackupEnvelope.BackupCipher {
        override fun seal(plaintext: ByteArray) =
            EncryptResult(iv = byteArrayOf(1, 2, 3), ciphertext = plaintext.reversedArray())
        override fun open(iv: ByteArray, ciphertext: ByteArray) = ciphertext.reversedArray()
    }

    @Test
    fun content_hash_is_deterministic_and_dedups_identical_plaintext() {
        val a = PdhBackupEnvelope.contentHash("hello".toByteArray())
        val b = PdhBackupEnvelope.contentHash("hello".toByteArray())
        val c = PdhBackupEnvelope.contentHash("world".toByteArray())
        assertEquals(a, b) // 同内容 → 同 hash(去重)
        assertTrue(a != c)
        assertEquals(64, a.length) // SHA-256 hex
    }

    @Test
    fun seal_records_plaintext_content_hash_and_kind() {
        val plain = "vault-row-42".toByteArray()
        val block = PdhBackupEnvelope.seal(AssetKind.VAULT, plain, fakeCipher)
        assertEquals(AssetKind.VAULT, block.assetKind)
        assertEquals(PdhBackupEnvelope.contentHash(plain), block.contentHash)
        // 密文 = fake 反转,确非明文原样
        assertTrue(!block.ciphertext.contentEquals(plain))
    }

    @Test
    fun open_round_trips_the_plaintext() {
        val plain = "记忆条目:妈妈=某联系人".toByteArray()
        val block = PdhBackupEnvelope.seal(AssetKind.MEMORY, plain, fakeCipher)
        assertTrue(PdhBackupEnvelope.open(block, fakeCipher).contentEquals(plain))
    }

    @Test
    fun open_rejects_a_tampered_block() {
        val block = PdhBackupEnvelope.seal(AssetKind.SKILLS, "skill-v2".toByteArray(), fakeCipher)
        // 篡改密文 → 解出的明文与记录的内容哈希不符 → 抛
        val tampered = block.copy(ciphertext = "evilpayload".toByteArray())
        assertFailsWith<IllegalStateException> { PdhBackupEnvelope.open(tampered, fakeCipher) }
    }

    @Test
    fun to_sync_block_carries_content_hash_for_dedup() {
        val plain = "x".toByteArray()
        val block = PdhBackupEnvelope.seal(AssetKind.VAULT, plain, fakeCipher)
        val sync = PdhBackupEnvelope.toSyncBlock(block)
        assertEquals(AssetKind.VAULT, sync.assetKind)
        assertEquals(block.contentHash, sync.hash) // 内容寻址键一致 → 接 PdhBackupSync 去重
    }
}
