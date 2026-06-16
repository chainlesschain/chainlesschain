package com.chainlesschain.android.remote.p2p.e2ee

import com.chainlesschain.android.core.e2ee.protocol.PreKeyBundle
import com.chainlesschain.android.core.e2ee.session.InitialMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * FAMILY-67: [E2EEHandshakeCodec] round-trip 测试。ByteArray 字段用 contentEquals 比较
 * （data class 默认 equals 对 ByteArray 是引用相等，不能直接 assertEquals）。
 */
class E2EEHandshakeCodecTest {

    @Test
    fun `PreKeyBundle round-trips with all fields`() {
        val bundle = PreKeyBundle(
            identityKey = byteArrayOf(1, 2, 3, 4),
            signingPublicKey = byteArrayOf(5, 6, 7),
            signedPreKey = byteArrayOf(8, 9),
            signedPreKeySignature = byteArrayOf(10, 11, 12, 13, 14),
            oneTimePreKey = byteArrayOf(15, 16),
        )

        val decoded = E2EEHandshakeCodec.decodeBundle(E2EEHandshakeCodec.encodeBundle(bundle))

        assertTrue(bundle.identityKey.contentEquals(decoded.identityKey))
        assertTrue(bundle.signingPublicKey!!.contentEquals(decoded.signingPublicKey!!))
        assertTrue(bundle.signedPreKey.contentEquals(decoded.signedPreKey))
        assertTrue(bundle.signedPreKeySignature.contentEquals(decoded.signedPreKeySignature))
        assertTrue(bundle.oneTimePreKey!!.contentEquals(decoded.oneTimePreKey!!))
    }

    @Test
    fun `PreKeyBundle round-trips with optional fields null`() {
        val bundle = PreKeyBundle(
            identityKey = byteArrayOf(1, 2, 3),
            signingPublicKey = null,
            signedPreKey = byteArrayOf(4, 5),
            signedPreKeySignature = byteArrayOf(6, 7, 8),
            oneTimePreKey = null,
        )

        val decoded = E2EEHandshakeCodec.decodeBundle(E2EEHandshakeCodec.encodeBundle(bundle))

        assertTrue(bundle.identityKey.contentEquals(decoded.identityKey))
        assertNull(decoded.signingPublicKey)
        assertNull(decoded.oneTimePreKey)
    }

    @Test
    fun `InitialMessage round-trips`() {
        val message = InitialMessage(
            identityKey = byteArrayOf(1, 2, 3),
            ephemeralKey = byteArrayOf(4, 5, 6, 7),
            ratchetKey = byteArrayOf(8, 9),
            oneTimePreKeyUsed = true,
        )

        val decoded = E2EEHandshakeCodec.decodeInitialMessage(
            E2EEHandshakeCodec.encodeInitialMessage(message),
        )

        assertTrue(message.identityKey.contentEquals(decoded.identityKey))
        assertTrue(message.ephemeralKey.contentEquals(decoded.ephemeralKey))
        assertTrue(message.ratchetKey.contentEquals(decoded.ratchetKey))
        assertEquals(message.oneTimePreKeyUsed, decoded.oneTimePreKeyUsed)
    }
}
