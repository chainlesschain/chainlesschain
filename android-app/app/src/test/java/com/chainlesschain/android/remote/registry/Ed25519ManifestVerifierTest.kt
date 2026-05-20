package com.chainlesschain.android.remote.registry

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.Base64

/**
 * Tests for [Ed25519ManifestVerifier] — the production manifest signature
 * verifier prepared for marketplace M0 (#21 A.3 AI-5).
 *
 * Test publisher keypair is derived deterministically from a fixed seed so
 * signed-fixture round trips are reproducible across runs / CI machines.
 *
 * At marketplace M0 ship, the wire-up site swaps the [PublisherPubkeyResolver]
 * fixture for one that returns the real publisher public key (hardcoded in
 * code, or fetched from a server-side directory). Nothing else in this verifier
 * or its tests should need to change.
 */
class Ed25519ManifestVerifierTest {

    private lateinit var publisherSecret: Ed25519PrivateKeyParameters
    private lateinit var publisherPubkey: ByteArray
    private lateinit var resolver: PublisherPubkeyResolver
    private lateinit var verifier: Ed25519ManifestVerifier

    @Before
    fun setup() {
        // Deterministic test keypair from a fixed UTF-8 seed → SHA-256 → 32-byte secret.
        val seed = MessageDigest.getInstance("SHA-256")
            .digest("chainlesschain-test-publisher-v1".toByteArray(Charsets.UTF_8))
        publisherSecret = Ed25519PrivateKeyParameters(seed, 0)
        publisherPubkey = publisherSecret.generatePublicKey().encoded
        resolver = PublisherPubkeyResolver { publisherPubkey }
        verifier = Ed25519ManifestVerifier(resolver)
    }

    private fun sign(skill: SkillMetadata): String {
        val signingInput = Ed25519ManifestVerifier.buildSigningInput(skill)
        val signer = Ed25519Signer().apply {
            init(true, publisherSecret)
            update(signingInput, 0, signingInput.size)
        }
        val raw = signer.generateSignature()
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw)
    }

    // Test helper exposing 6 SkillMetadata knobs as keyword args with defaults.
    // Each test only overrides 1-2 — passing positional args or wrapping in a
    // builder would hurt readability more than the 6-param list does.
    @Suppress("LongParameterList")
    private fun sample(
        namespace: String = "system.clipboard",
        displayName: String = "剪贴板",
        description: String = "读写桌面剪贴板",
        category: String = "data",
        risk: SkillRiskTag = SkillRiskTag.Mutating,
        signature: String? = null,
    ): SkillMetadata = SkillMetadata(
        namespace = namespace,
        displayName = displayName,
        description = description,
        category = category,
        risk = risk,
        androidSourceFile = "ClipboardCommands.kt",
        methodCount = 3,
        signature = signature,
    )

    // ===== Happy path =====

    @Test
    fun `accepts a properly signed manifest`() {
        val unsigned = sample()
        val signed = unsigned.copy(signature = sign(unsigned))
        assertEquals(VerificationResult.Accepted, verifier.verify(signed))
    }

    @Test
    fun `accepts a manifest with Chinese display name`() {
        val unsigned = sample(displayName = "中文显示名称-with-mixed-ASCII")
        val signed = unsigned.copy(signature = sign(unsigned))
        assertEquals(VerificationResult.Accepted, verifier.verify(signed))
    }

    @Test
    fun `accepts a manifest with methods array`() {
        val unsigned = sample().copy(
            methods = listOf(
                MethodMetadata("read", "read clipboard", 0),
                MethodMetadata("write", "write to clipboard", 1),
                MethodMetadata("clear", "clear clipboard", 0),
            ),
        )
        val signed = unsigned.copy(signature = sign(unsigned))
        assertEquals(VerificationResult.Accepted, verifier.verify(signed))
    }

    // ===== Tamper detection =====

    @Test
    fun `rejects tampered description with SIGNATURE_MISMATCH`() {
        val original = sample()
        val sig = sign(original)
        val tampered = original.copy(description = "tampered", signature = sig)
        assertEquals(
            VerificationResult.Rejected("SIGNATURE_MISMATCH"),
            verifier.verify(tampered),
        )
    }

    @Test
    fun `rejects tampered risk with SIGNATURE_MISMATCH`() {
        val original = sample(risk = SkillRiskTag.Mutating)
        val sig = sign(original)
        val tampered = original.copy(risk = SkillRiskTag.Safe, signature = sig)
        assertEquals(
            VerificationResult.Rejected("SIGNATURE_MISMATCH"),
            verifier.verify(tampered),
        )
    }

    @Test
    fun `rejects tampered methods array with SIGNATURE_MISMATCH`() {
        val original = sample().copy(
            methods = listOf(MethodMetadata("read", "read", 0)),
        )
        val sig = sign(original)
        val tampered = original.copy(
            methods = listOf(MethodMetadata("write", "write", 1)),
            signature = sig,
        )
        assertEquals(
            VerificationResult.Rejected("SIGNATURE_MISMATCH"),
            verifier.verify(tampered),
        )
    }

    // ===== Resolver / pubkey failure modes =====

    @Test
    fun `rejects with UNKNOWN_PUBLISHER when resolver returns null`() {
        val nullResolver = Ed25519ManifestVerifier { null }
        val signed = sample().let { it.copy(signature = sign(it)) }
        assertEquals(
            VerificationResult.Rejected("UNKNOWN_PUBLISHER"),
            nullResolver.verify(signed),
        )
    }

    @Test
    fun `rejects with INVALID_PUBKEY_LENGTH when resolver returns short pubkey`() {
        val shortResolver = Ed25519ManifestVerifier { ByteArray(16) }
        val signed = sample().let { it.copy(signature = sign(it)) }
        assertEquals(
            VerificationResult.Rejected("INVALID_PUBKEY_LENGTH"),
            shortResolver.verify(signed),
        )
    }

    @Test
    fun `rejects with SIGNATURE_MISMATCH when resolver returns wrong pubkey`() {
        // Resolver returns a valid-length but different (random-like) pubkey
        val otherSeed = MessageDigest.getInstance("SHA-256")
            .digest("a-different-publisher".toByteArray(Charsets.UTF_8))
        val otherPubkey = Ed25519PrivateKeyParameters(otherSeed, 0)
            .generatePublicKey().encoded
        val wrongResolver = Ed25519ManifestVerifier { otherPubkey }
        val signed = sample().let { it.copy(signature = sign(it)) }
        assertEquals(
            VerificationResult.Rejected("SIGNATURE_MISMATCH"),
            wrongResolver.verify(signed),
        )
    }

    // ===== Signature format failure modes =====

    @Test
    fun `rejects unsigned manifest with NO_SIGNATURE`() {
        assertEquals(
            VerificationResult.Rejected("NO_SIGNATURE"),
            verifier.verify(sample(signature = null)),
        )
    }

    @Test
    fun `rejects malformed base64 with INVALID_SIGNATURE_FORMAT`() {
        val signed = sample(signature = "!!!not-base64url@@@")
        assertEquals(
            VerificationResult.Rejected("INVALID_SIGNATURE_FORMAT"),
            verifier.verify(signed),
        )
    }

    @Test
    fun `rejects too-short signature with INVALID_SIGNATURE_FORMAT`() {
        val tooShort = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32))
        assertEquals(
            VerificationResult.Rejected("INVALID_SIGNATURE_FORMAT"),
            verifier.verify(sample(signature = tooShort)),
        )
    }

    @Test
    fun `rejects too-long signature with INVALID_SIGNATURE_FORMAT`() {
        val tooLong = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(128))
        assertEquals(
            VerificationResult.Rejected("INVALID_SIGNATURE_FORMAT"),
            verifier.verify(sample(signature = tooLong)),
        )
    }

    @Test
    fun `accepts base64url signature without padding`() {
        // Standard URL-encoder output (withoutPadding); sign() already produces
        // unpadded — explicit test that the verifier's pad-helper restores it.
        val unsigned = sample()
        val sig = sign(unsigned)
        // sign() output is unpadded — assert that and verify still accepts.
        assertFalse("sign() should produce unpadded base64url", sig.contains("="))
        assertEquals(
            VerificationResult.Accepted,
            verifier.verify(unsigned.copy(signature = sig)),
        )
    }

    @Test
    fun `accepts base64url signature with padding`() {
        val sig = Base64.getUrlEncoder().encodeToString(
            Ed25519Signer().run {
                init(true, publisherSecret)
                val input = Ed25519ManifestVerifier.buildSigningInput(sample())
                update(input, 0, input.size)
                generateSignature()
            },
        )
        assertEquals(
            VerificationResult.Accepted,
            verifier.verify(sample().copy(signature = sig)),
        )
    }

    // ===== Signing-input invariants =====

    @Test
    fun `signing input is identical whether signature is null or set`() {
        // The stripping rule: signature field MUST NOT contribute to the signing
        // input, so signing the unsigned and signing the same skill carrying a
        // bogus signature must produce the same hash.
        val unsigned = sample(signature = null)
        val withBogusSig = unsigned.copy(signature = "any-string-here-is-irrelevant")
        assertArrayEquals(
            Ed25519ManifestVerifier.buildSigningInput(unsigned),
            Ed25519ManifestVerifier.buildSigningInput(withBogusSig),
        )
    }

    @Test
    fun `signing input is deterministic across calls`() {
        val a = Ed25519ManifestVerifier.buildSigningInput(sample())
        val b = Ed25519ManifestVerifier.buildSigningInput(sample())
        assertArrayEquals(a, b)
    }

    @Test
    fun `signing input changes when methods array order changes`() {
        // Per JCS: arrays are NOT sorted (preserve order). Reordering must change
        // the signing input so swapping method order can't slip past the signature.
        val skillA = sample().copy(
            methods = listOf(
                MethodMetadata("read", "read", 0),
                MethodMetadata("write", "write", 1),
            ),
        )
        val skillB = sample().copy(
            methods = listOf(
                MethodMetadata("write", "write", 1),
                MethodMetadata("read", "read", 0),
            ),
        )
        val a = Ed25519ManifestVerifier.buildSigningInput(skillA)
        val b = Ed25519ManifestVerifier.buildSigningInput(skillB)
        assertFalse("reordered methods should produce different signing input", a.contentEquals(b))
    }

    @Test
    fun `signing input is 32 bytes (SHA-256)`() {
        assertEquals(32, Ed25519ManifestVerifier.buildSigningInput(sample()).size)
    }

    // ===== Wire-up via RemoteSkillRegistry =====
    // Confirms the M0 wire site (registry.setManifestVerifier(Ed25519ManifestVerifier(...))
    // and updateFromRemote gating) actually works end-to-end with the real
    // verifier, not just the NoOp.

    private lateinit var tempDir: File
    private lateinit var mockContext: Context

    @Before
    fun setupRegistryDeps() {
        tempDir = File.createTempFile("ed25519_verif_test", "").apply {
            delete(); mkdir(); deleteOnExit()
        }
        mockContext = mockk(relaxed = true)
        every { mockContext.filesDir } returns tempDir
    }

    @Test
    fun `RemoteSkillRegistry accepts signed and rejects unsigned with Ed25519 verifier`() {
        val registry = RemoteSkillRegistry(RegistryStore(mockContext))
        registry.initialize() // loads SeedRegistry
        registry.setManifestVerifier(verifier)
        val seedSize = registry.listAll().size

        val signedNs = "ed-signed"
        val unsignedNs = "ed-unsigned"
        val good = sample(namespace = signedNs).let { it.copy(signature = sign(it)) }
        val bad = sample(namespace = unsignedNs, signature = null)

        registry.updateFromRemote(listOf(good, bad))

        // Signed accepted, unsigned silently rejected (logged warn, not thrown)
        assertEquals(seedSize + 1, registry.listAll().size)
        assertNotNull(registry.get(signedNs))
        assertNull(registry.get(unsignedNs))
    }

    @Test
    fun `RemoteSkillRegistry rejects all when every manifest fails verification`() {
        val registry = RemoteSkillRegistry(RegistryStore(mockContext))
        registry.initialize()
        registry.setManifestVerifier(verifier)
        val before = registry.listAll().size

        val tampered = sample(namespace = "ed-tamper").let { unsigned ->
            unsigned.copy(description = "post-sign tamper", signature = sign(unsigned.copy(description = "original")))
        }
        val unsigned = sample(namespace = "ed-naked", signature = null)

        registry.updateFromRemote(listOf(tampered, unsigned))

        // All rejected → state unchanged
        assertEquals(before, registry.listAll().size)
        assertNull(registry.get("ed-tamper"))
        assertNull(registry.get("ed-naked"))
    }
}
