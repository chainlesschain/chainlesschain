package com.chainlesschain.android.remote.registry

import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.security.MessageDigest
import java.util.Base64

/**
 * Tests for [LenientManifestVerifier] — the verify-if-present migration verifier
 * that is now the [RemoteSkillRegistry] default (A7 hardening).
 *
 * Test publisher keypair derived deterministically from a fixed seed (mirrors
 * [Ed25519ManifestVerifierTest]) so signed-fixture round trips are reproducible.
 */
class LenientManifestVerifierTest {

    private lateinit var publisherSecret: Ed25519PrivateKeyParameters
    private lateinit var publisherPubkey: ByteArray
    private lateinit var signedVerifier: Ed25519ManifestVerifier
    private lateinit var lenient: LenientManifestVerifier

    @Before
    fun setup() {
        val seed = MessageDigest.getInstance("SHA-256")
            .digest("chainlesschain-test-publisher-v1".toByteArray(Charsets.UTF_8))
        publisherSecret = Ed25519PrivateKeyParameters(seed, 0)
        publisherPubkey = publisherSecret.generatePublicKey().encoded
        signedVerifier = Ed25519ManifestVerifier { publisherPubkey }
        lenient = LenientManifestVerifier(signedVerifier)
    }

    private fun sign(skill: SkillMetadata): String {
        val input = Ed25519ManifestVerifier.buildSigningInput(skill)
        val signer = Ed25519Signer().apply {
            init(true, publisherSecret)
            update(input, 0, input.size)
        }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(signer.generateSignature())
    }

    private fun sample(
        namespace: String = "system.clipboard",
        signature: String? = null,
    ): SkillMetadata = SkillMetadata(
        namespace = namespace,
        displayName = "剪贴板",
        description = "读写桌面剪贴板",
        category = "data",
        risk = SkillRiskTag.Mutating,
        androidSourceFile = "ClipboardCommands.kt",
        methodCount = 3,
        signature = signature,
    )

    // ===== Unsigned (legacy) path — no regression vs NoOp =====

    @Test
    fun `accepts unsigned manifest without consulting the delegate`() {
        val recording = RecordingVerifier()
        val v = LenientManifestVerifier(recording)
        assertEquals(VerificationResult.Accepted, v.verify(sample(signature = null)))
        assertFalse("delegate must NOT run for an unsigned manifest", recording.called)
    }

    // ===== Signed path — delegated verification =====

    @Test
    fun `accepts a properly signed manifest via the delegate`() {
        val unsigned = sample()
        val signed = unsigned.copy(signature = sign(unsigned))
        assertEquals(VerificationResult.Accepted, lenient.verify(signed))
    }

    @Test
    fun `rejects a tampered signed manifest via the delegate`() {
        val original = sample()
        val sig = sign(original)
        val tampered = original.copy(description = "tampered", signature = sig)
        assertEquals(
            VerificationResult.Rejected("SIGNATURE_MISMATCH"),
            lenient.verify(tampered),
        )
    }

    // ===== withoutTrustAnchor() — the RemoteSkillRegistry default =====

    @Test
    fun `withoutTrustAnchor accepts unsigned but rejects any signed as UNKNOWN_PUBLISHER`() {
        val v = LenientManifestVerifier.withoutTrustAnchor()

        // Unsigned legacy manifest still flows (push-based update keeps working).
        assertEquals(VerificationResult.Accepted, v.verify(sample(signature = null)))

        // Even a validly-signed manifest is rejected — no trust anchor provisioned
        // yet (resolver returns null → UNKNOWN_PUBLISHER). Safe-by-default until M0.
        val unsigned = sample()
        val signed = unsigned.copy(signature = sign(unsigned))
        assertEquals(
            VerificationResult.Rejected("UNKNOWN_PUBLISHER"),
            v.verify(signed),
        )
    }

    @Test
    fun `is strictly stronger than NoOp for a bogus-signature manifest`() {
        val bogus = sample(signature = "not-a-real-signature")
        // NoOp accepts a bogus signature; the lenient default rejects it.
        assertEquals(VerificationResult.Accepted, NoOpManifestVerifier.verify(bogus))
        val v = LenientManifestVerifier.withoutTrustAnchor()
        assertTrue(v.verify(bogus) is VerificationResult.Rejected)
    }

    /** Test-only delegate that records whether it was consulted. */
    private class RecordingVerifier : ManifestSignatureVerifier {
        var called = false
        override fun verify(skill: SkillMetadata): VerificationResult {
            called = true
            return VerificationResult.Accepted
        }
    }
}
