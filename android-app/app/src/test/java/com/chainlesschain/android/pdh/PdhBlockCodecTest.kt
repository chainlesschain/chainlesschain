package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * §8.3 加密块线编码测试:kind/hash/iv/ciphertext 往返(含二进制)、坏格式抛、未知资产类型抛。
 */
class PdhBlockCodecTest {

    private fun block(kind: AssetKind, hash: String, iv: ByteArray, ct: ByteArray) =
        PdhBackupEnvelope.EncryptedBlock(kind, hash, iv, ct)

    @Test
    fun round_trips_block_with_binary_iv_and_ciphertext() {
        val b = block(AssetKind.VAULT, "deadbeef", byteArrayOf(0, -1, 13, 10), byteArrayOf(-128, 0, 127, 46))
        val d = PdhBlockCodec.decode(PdhBlockCodec.encode(b))
        assertEquals(AssetKind.VAULT, d.assetKind)
        assertEquals("deadbeef", d.contentHash)
        assertTrue(byteArrayOf(0, -1, 13, 10).contentEquals(d.iv))
        assertTrue(byteArrayOf(-128, 0, 127, 46).contentEquals(d.ciphertext))
    }

    @Test
    fun malformed_throws() {
        assertFailsWith<IllegalArgumentException> { PdhBlockCodec.decode("only.two.parts".toByteArray()) }
    }

    @Test
    fun unknown_asset_kind_throws() {
        assertFailsWith<IllegalArgumentException> { PdhBlockCodec.decode("NOPE.h.aa.bb".toByteArray()) }
    }
}
