package com.chainlesschain.android.feature.familyguard.data.signer

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.feature.familyguard.domain.signer.InviteSigner
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 生产实现 (FAMILY-13). DIDManager.sign / verify 走 [SignatureUtils] +
 * [DidKeyGenerator.extractPublicKey]; 算法在 :core-did 内已选定 Ed25519。
 *
 * sign 调走 currentIdentity 私钥 (FAMILY-04 角色选择 + 后续配对前 DID
 * provision 链路 之外, sign 调用方需保证 DIDManager.getCurrentDID() 非 null,
 * 否则抛 IllegalStateException; 本 wrapper 不再额外做 null 检查)。
 */
@Singleton
class DidManagerInviteSigner @Inject constructor(
    private val didManager: DIDManager,
) : InviteSigner {

    override suspend fun sign(payloadBytes: ByteArray): ByteArray =
        didManager.sign(payloadBytes)

    override suspend fun verify(
        signerDid: String,
        payloadBytes: ByteArray,
        signatureBytes: ByteArray,
    ): Boolean = didManager.verify(payloadBytes, signatureBytes, signerDid)
}
