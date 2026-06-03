package com.chainlesschain.android.feature.familyguard.domain.signer

/**
 * Ed25519 邀请签名抽象 (FAMILY-13).
 *
 * 生产环境实现走 DIDManager (已在 :core-did 中, 见 FAMILY-03 spike 报告 §1):
 *   - [sign]: 用 currentDID 的私钥签 [payloadBytes]
 *   - [verify]: 用 [signerDid] 对应的公钥验 [signatureBytes]
 *
 * 测试用 Fake (FakeInviteSigner) 走 HMAC-SHA256 + fixed seed 让单测可重现,
 * 不依赖 Android Keystore 或 BouncyCastle。
 *
 * 注意 base64 编码 / 解码不在本接口内; 上层 [InviteTokenCodec] 处理。
 */
interface InviteSigner {

    /** 用当前 DID 私钥签 payload; 返 raw signature bytes (Ed25519 固定 64 B)。 */
    suspend fun sign(payloadBytes: ByteArray): ByteArray

    /**
     * 验证 sig 是否由 [signerDid] 私钥签出。生产实现需先查 signerDid 对应公钥
     * (DIDManager.resolvePublicKey), 再 verify。Fake 走 HMAC, 不区分 signerDid。
     */
    suspend fun verify(
        signerDid: String,
        payloadBytes: ByteArray,
        signatureBytes: ByteArray,
    ): Boolean
}
