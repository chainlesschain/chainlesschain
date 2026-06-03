package com.chainlesschain.android.feature.familyguard.fixtures

import com.chainlesschain.android.feature.familyguard.domain.signer.InviteSigner
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Test-only [InviteSigner] (FAMILY-13).
 *
 * 走 HMAC-SHA256 + 共享 secret 让单测可重现, 不依赖 Android Keystore / DIDManager。
 * 实际生产用 [com.chainlesschain.android.feature.familyguard.data.signer.DidManagerInviteSigner]
 * (走 Ed25519 via :core-did SignatureUtils)。
 *
 * verify 仅在 sigBytes 等于 HMAC(payloadBytes) 时返 true; 不依赖 signerDid
 * (单测只关心"sig 是否由本 service 之前生成", 不模拟 inviterDid 反向解公钥)。
 *
 * 如要模拟"sig 来自不同 DID 的私钥"场景, 用 [withSecret] 创建第二个签名器。
 */
class FakeInviteSigner(private val secret: ByteArray = DEFAULT_SECRET) : InviteSigner {

    override suspend fun sign(payloadBytes: ByteArray): ByteArray = hmac(payloadBytes)

    override suspend fun verify(
        signerDid: String,
        payloadBytes: ByteArray,
        signatureBytes: ByteArray,
    ): Boolean = hmac(payloadBytes).contentEquals(signatureBytes)

    private fun hmac(input: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret, "HmacSHA256"))
        return mac.doFinal(input)
    }

    fun withSecret(other: ByteArray): FakeInviteSigner = FakeInviteSigner(other)

    companion object {
        val DEFAULT_SECRET = ByteArray(32) { it.toByte() }
    }
}
