package com.chainlesschain.android.remote.registry

import timber.log.Timber

/**
 * Migration-stage manifest verifier: **verify-if-present**.
 *
 * Bridges "no signatures exist yet" (current v1.2/v1.3 stage — SeedRegistry +
 * every desktop-pushed skill is unsigned) and full enforcement at marketplace
 * M0 (#21 A.3 AI-5). Semantics:
 *
 *  - `signature == null` → [VerificationResult.Accepted]. Legacy unsigned
 *    manifests keep flowing — **zero regression** versus [NoOpManifestVerifier].
 *  - `signature != null` → delegate to [signed] (an [Ed25519ManifestVerifier]).
 *    A manifest that *claims* a signature must actually verify; a forged or
 *    unverifiable signature is [VerificationResult.Rejected] instead of being
 *    blindly accepted.
 *
 * Strictly stronger than [NoOpManifestVerifier] (which accepts a bogus
 * signature) and strictly weaker than wiring [Ed25519ManifestVerifier] directly
 * (which rejects every current unsigned skill with `NO_SIGNATURE` and would
 * break desktop skill push). It is the safe default until a signing pipeline +
 * trust anchor (publisher pubkey) ship at marketplace M0.
 *
 * **At marketplace M0:** swap the delegate's [PublisherPubkeyResolver] (today a
 * null-returning resolver via [withoutTrustAnchor] → any signed-but-unknown
 * manifest is rejected `UNKNOWN_PUBLISHER`, safe-by-default) for one returning
 * the real marketplace key. Once all publishers sign, flip the null-signature
 * branch to reject and the migration is complete.
 */
class LenientManifestVerifier(
    private val signed: ManifestSignatureVerifier,
) : ManifestSignatureVerifier {

    override fun verify(skill: SkillMetadata): VerificationResult {
        // Unsigned legacy manifest — accept without consulting the delegate
        // (the delegate would reject it NO_SIGNATURE, which is wrong for this
        // migration stage where unsigned is the norm).
        if (skill.signature == null) {
            return VerificationResult.Accepted
        }
        val result = signed.verify(skill)
        if (result is VerificationResult.Rejected) {
            Timber.w(
                "LenientManifestVerifier rejected signed manifest ns=%s reason=%s",
                skill.namespace,
                result.reason,
            )
        }
        return result
    }

    companion object {
        /**
         * Migration verifier with **no trust anchor provisioned yet**: unsigned
         * accepted, any signed manifest rejected `UNKNOWN_PUBLISHER` (no
         * publisher key is known to verify against). This is the
         * [RemoteSkillRegistry] default until marketplace M0 provisions a real
         * [PublisherPubkeyResolver] via [RemoteSkillRegistry.setManifestVerifier].
         */
        fun withoutTrustAnchor(): LenientManifestVerifier =
            LenientManifestVerifier(Ed25519ManifestVerifier { null })
    }
}
