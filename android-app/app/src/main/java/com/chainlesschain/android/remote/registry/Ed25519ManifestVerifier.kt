package com.chainlesschain.android.remote.registry

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import timber.log.Timber
import java.security.MessageDigest
import java.util.Base64

/**
 * Resolves the Ed25519 public key (raw 32 bytes) for a given skill's publisher.
 *
 * Two wire patterns expected at marketplace M0 (#21 A.3 AI-5):
 *  - Single-publisher v1: `PublisherPubkeyResolver { _ -> globalMarketplaceKey }`
 *    (most likely first deploy — one trusted publisher signs the whole catalog)
 *  - Per-publisher: future SkillMetadata gains a `publisherId` field, resolver
 *    looks up against a server-fetched directory table
 *
 * Returning null = "no key known for this publisher" → Rejected("UNKNOWN_PUBLISHER").
 */
fun interface PublisherPubkeyResolver {
    fun resolve(skill: SkillMetadata): ByteArray?
}

/**
 * Production manifest verifier using Ed25519 over JCS-canonical SkillMetadata.
 *
 * Wire site (post marketplace M0, #21 A.3 AI-5):
 *   ```
 *   val resolver = PublisherPubkeyResolver { _ -> marketplaceGlobalPubkey }
 *   remoteSkillRegistry.setManifestVerifier(Ed25519ManifestVerifier(resolver))
 *   ```
 *
 * Pre-stage scope: this class is ready to drop in; the only thing that changes
 * at marketplace M0 is the source of `marketplaceGlobalPubkey` (hardcoded
 * fixture → server-fetched directory).
 *
 * Verification protocol:
 *  1. Strip `signature` field from SkillMetadata → JCS canonicalize → UTF-8 bytes
 *  2. SHA-256 hash → 32-byte signing input
 *  3. Ed25519 verify against publisher's pubkey
 *  4. Signature wire format: base64url-encoded (padding optional) raw 64-byte Ed25519
 *
 * Failure modes (each returns [VerificationResult.Rejected] with a stable reason
 * string, kept short so log greps stay simple):
 *  - "NO_SIGNATURE"             — `skill.signature` is null. Caller should NOT use
 *                                  this verifier for legacy unsigned manifests;
 *                                  use [NoOpManifestVerifier] for those.
 *  - "UNKNOWN_PUBLISHER"        — pubkey resolver returned null
 *  - "INVALID_PUBKEY_LENGTH"    — resolver returned wrong-length pubkey (≠ 32)
 *  - "INVALID_SIGNATURE_FORMAT" — base64url decode failed OR length ≠ 64
 *  - "SIGNATURE_MISMATCH"       — Ed25519 verify returned false (tampered OR
 *                                  signed by a different key than resolver returned)
 *
 * Forward-compat for SLH-DSA hybrid (per MTC v0.11 pattern, memory
 * `mtc_publisher_sig_threshold`): when adopted, the `signature` field is expected
 * to become a JSON map `{"ed25519": "...", "slh_dsa": "..."}` and a hybrid
 * verifier subclass will require both. The JCS canonicalizer + signing-input
 * computation stays unchanged.
 */
class Ed25519ManifestVerifier(
    private val pubkeyResolver: PublisherPubkeyResolver,
) : ManifestSignatureVerifier {

    // Each return statement maps to a distinct, documented rejection reason
    // (see class KDoc "Failure modes"). Collapsing them into a single return
    // would hide which precondition failed; the 6-branch shape is intentional.
    @Suppress("ReturnCount")
    override fun verify(skill: SkillMetadata): VerificationResult {
        val signatureB64 = skill.signature
            ?: return VerificationResult.Rejected("NO_SIGNATURE")

        val pubkey = pubkeyResolver.resolve(skill)
            ?: return VerificationResult.Rejected("UNKNOWN_PUBLISHER")

        if (pubkey.size != ED25519_PUBKEY_LENGTH) {
            return VerificationResult.Rejected("INVALID_PUBKEY_LENGTH")
        }

        val sig: ByteArray = try {
            Base64.getUrlDecoder().decode(signatureB64.padBase64Url())
        } catch (e: IllegalArgumentException) {
            Timber.w(e, "Ed25519 signature base64url decode failed (ns=%s)", skill.namespace)
            return VerificationResult.Rejected("INVALID_SIGNATURE_FORMAT")
        }
        if (sig.size != ED25519_SIG_LENGTH) {
            return VerificationResult.Rejected("INVALID_SIGNATURE_FORMAT")
        }

        val signingInput = buildSigningInput(skill)

        val verifier = Ed25519Signer().apply {
            init(false, Ed25519PublicKeyParameters(pubkey, 0))
            update(signingInput, 0, signingInput.size)
        }

        return if (verifier.verifySignature(sig)) {
            VerificationResult.Accepted
        } else {
            Timber.w("Ed25519 signature mismatch (ns=%s)", skill.namespace)
            VerificationResult.Rejected("SIGNATURE_MISMATCH")
        }
    }

    companion object {
        const val ED25519_PUBKEY_LENGTH = 32
        const val ED25519_SIG_LENGTH = 64

        private val jcsJson = Json {
            encodeDefaults = true
            // Pretty-print OFF — JCS requires no insignificant whitespace.
            prettyPrint = false
        }

        /**
         * Compute the JCS-canonical SHA-256 signing input over a SkillMetadata
         * with the `signature` field stripped (always set to null before encoding).
         *
         * Exposed as @JvmStatic so test fixtures can produce matching signatures
         * via sign-then-verify round-trip without duplicating the canonicalization
         * logic.
         */
        @JvmStatic
        fun buildSigningInput(skill: SkillMetadata): ByteArray {
            val withoutSig = skill.copy(signature = null)
            val tree = jcsJson.encodeToJsonElement(SkillMetadata.serializer(), withoutSig)
            val canonical = JcsCanonicalizer.canonicalize(tree as JsonObject)
            val canonicalString = jcsJson.encodeToString(JsonObject.serializer(), canonical as JsonObject)
            return MessageDigest.getInstance("SHA-256")
                .digest(canonicalString.toByteArray(Charsets.UTF_8))
        }

        /**
         * Base64URL (RFC 4648 §5) signatures are commonly transmitted without
         * `=` padding. `java.util.Base64.getUrlDecoder()` requires the length to
         * be a multiple of 4 — explicitly pad here so unpadded inputs decode.
         */
        private fun String.padBase64Url(): String {
            val rem = length % 4
            return if (rem == 0) this else this + "=".repeat(4 - rem)
        }
    }
}
