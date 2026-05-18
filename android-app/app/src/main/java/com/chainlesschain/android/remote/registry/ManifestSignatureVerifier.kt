package com.chainlesschain.android.remote.registry

/**
 * Verifies that a [SkillMetadata.signature] is valid against its content.
 *
 * Forward-compat for ADR-8 amend (v0.9.1) — marketplace M0 上线时, publisher
 * 签发的 skill manifest 会带 [SkillMetadata.signature]（Ed25519 / 未来 SLH-DSA
 * hybrid over JCS-canonical metadata）。届时 [RemoteSkillRegistry.updateFromRemote]
 * 会跑这个 verifier；现在用 [NoOpManifestVerifier] 兜底，不阻塞任何 update。
 *
 * 详细 deferral 决策见 [Android_ADR_重评估_v2.0.md](../../../../../../../../docs/design/Android_ADR_重评估_v2.0.md)
 * §2 ADR-8 + §4 AI-3 / AI-5。本接口 (#21 A.3 AI-3 forward-compat 字段 + stub) 已落；
 * 真验签 (#21 A.3 AI-5) 等 marketplace M0 触发。
 */
interface ManifestSignatureVerifier {
    /**
     * @return [VerificationResult.Accepted] if signed-and-valid OR signature null
     *         (legacy unsigned manifest still accepted in current v1.2/v1.3 stage);
     *         [VerificationResult.Rejected] with a reason string otherwise.
     */
    fun verify(skill: SkillMetadata): VerificationResult
}

/**
 * Outcome of a single [ManifestSignatureVerifier.verify] call. Sealed so future
 * additions (e.g. `WarnedButAccepted`) are exhaustive at call sites.
 */
sealed class VerificationResult {
    object Accepted : VerificationResult()
    data class Rejected(val reason: String) : VerificationResult()
}

/**
 * Default no-op verifier — accepts every skill (signed or not).
 *
 * Wired by [RemoteSkillRegistry] until marketplace M0 ships and a real
 * Ed25519 / SLH-DSA hybrid verifier replaces it via
 * [RemoteSkillRegistry.setManifestVerifier].
 */
object NoOpManifestVerifier : ManifestSignatureVerifier {
    override fun verify(skill: SkillMetadata): VerificationResult =
        VerificationResult.Accepted
}
