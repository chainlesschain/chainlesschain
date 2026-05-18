package com.chainlesschain.android.remote.registry

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * Forward-compat tests for #21 A.3 AI-3 — `SkillMetadata.signature` field +
 * `ManifestSignatureVerifier` interface + `NoOpManifestVerifier` default.
 *
 * The point of these tests is to lock the seams so the real Ed25519/SLH-DSA
 * verifier (#21 A.3 AI-5, marketplace M0) can be swapped in without churning
 * registry call sites.
 */
class ManifestSignatureVerifierTest {

    // ===== SkillMetadata.signature field invariants =====

    @Test
    fun `signature defaults to null on SkillMetadata`() {
        val skill = SkillMetadata(
            namespace = "test",
            displayName = "T",
            description = "d",
            category = "c",
            risk = SkillRiskTag.Safe,
            androidSourceFile = "F.kt",
            methodCount = 1,
        )
        assertNull(skill.signature)
    }

    @Test
    fun `non-null signature is accepted verbatim`() {
        val sig = "base64url-sig-bytes"
        val skill = SkillMetadata(
            namespace = "test",
            displayName = "T",
            description = "d",
            category = "c",
            risk = SkillRiskTag.Safe,
            androidSourceFile = "F.kt",
            methodCount = 1,
            signature = sig,
        )
        assertEquals(sig, skill.signature)
    }

    @Test
    fun `blank signature is rejected when explicitly set (use null for unsigned)`() {
        assertThrows(IllegalArgumentException::class.java) {
            SkillMetadata(
                namespace = "test",
                displayName = "T",
                description = "d",
                category = "c",
                risk = SkillRiskTag.Safe,
                androidSourceFile = "F.kt",
                methodCount = 1,
                signature = "",
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            SkillMetadata(
                namespace = "test",
                displayName = "T",
                description = "d",
                category = "c",
                risk = SkillRiskTag.Safe,
                androidSourceFile = "F.kt",
                methodCount = 1,
                signature = "   ",
            )
        }
    }

    // ===== NoOpManifestVerifier behavior =====

    @Test
    fun `NoOpManifestVerifier accepts skills without signature`() {
        val skill = sampleSkill(namespace = "ns-unsigned", signature = null)
        assertEquals(VerificationResult.Accepted, NoOpManifestVerifier.verify(skill))
    }

    @Test
    fun `NoOpManifestVerifier accepts skills with signature`() {
        val skill = sampleSkill(
            namespace = "ns-signed",
            signature = "any-bytes-it-does-not-look",
        )
        assertEquals(VerificationResult.Accepted, NoOpManifestVerifier.verify(skill))
    }

    @Test
    fun `VerificationResult Rejected carries reason for diagnostics`() {
        val r = VerificationResult.Rejected("bad-sig-format")
        assertEquals("bad-sig-format", r.reason)
    }

    // ===== RemoteSkillRegistry + verifier integration =====

    private lateinit var tempDir: File
    private lateinit var mockContext: Context
    private lateinit var store: RegistryStore
    private lateinit var registry: RemoteSkillRegistry

    @Before
    fun setup() {
        tempDir = File.createTempFile("reg_verif_test", "").apply {
            delete()
            mkdir()
            deleteOnExit()
        }
        mockContext = mockk(relaxed = true)
        every { mockContext.filesDir } returns tempDir
        store = RegistryStore(mockContext)
        registry = RemoteSkillRegistry(store)
    }

    @Test
    fun `updateFromRemote accepts both signed and unsigned with NoOpManifestVerifier`() {
        registry.initialize()
        val before = registry.listAll().size

        val signed = sampleSkill(namespace = "alpha", signature = "sig-a")
        val unsigned = sampleSkill(namespace = "beta", signature = null)
        registry.updateFromRemote(listOf(signed, unsigned))

        assertEquals(before + 2, registry.listAll().size)
        assertNotNull(registry.get("alpha"))
        assertEquals("sig-a", registry.get("alpha")!!.signature)
        assertNotNull(registry.get("beta"))
        assertNull(registry.get("beta")!!.signature)
    }

    @Test
    fun `setManifestVerifier swaps verifier and a rejecting verifier skips bad skills`() {
        registry.initialize()
        val before = registry.listAll().size

        // Custom verifier that rejects anything without a non-null, non-blank signature.
        registry.setManifestVerifier(RequireSignatureVerifier)

        val ok = sampleSkill(namespace = "kept", signature = "sig-ok")
        val bad = sampleSkill(namespace = "dropped", signature = null)
        registry.updateFromRemote(listOf(ok, bad))

        // ok merged; bad skipped (logged warn, not thrown)
        assertEquals(before + 1, registry.listAll().size)
        assertNotNull(registry.get("kept"))
        assertNull(registry.get("dropped"))
    }

    @Test
    fun `updateFromRemote with all-rejected list leaves registry unchanged`() {
        registry.initialize()
        val before = registry.listAll().size

        registry.setManifestVerifier(AlwaysRejectVerifier)
        val r = registry.updateFromRemote(
            listOf(sampleSkill(namespace = "x"), sampleSkill(namespace = "y")),
        )

        assertEquals(before, r)
        assertEquals(before, registry.listAll().size)
        assertNull(registry.get("x"))
        assertNull(registry.get("y"))
    }

    @Test
    fun `existing tests' default path still works when verifier left at NoOp`() {
        // Smoke: don't call setManifestVerifier; updateFromRemote should behave
        // identically to pre-#21-A.3-AI-3 code.
        registry.initialize()
        val before = registry.listAll().size

        registry.updateFromRemote(listOf(sampleSkill(namespace = "smoke")))

        assertEquals(before + 1, registry.listAll().size)
        assertNotNull(registry.get("smoke"))
    }

    // ===== Helpers =====

    private fun sampleSkill(
        namespace: String,
        signature: String? = null,
    ): SkillMetadata = SkillMetadata(
        namespace = namespace,
        displayName = "$namespace display",
        description = "desc",
        category = "test",
        risk = SkillRiskTag.Safe,
        androidSourceFile = "${namespace}Commands.kt",
        methodCount = 1,
        signature = signature,
    )

    /** Test-only verifier — rejects anything missing/blank signature. */
    private object RequireSignatureVerifier : ManifestSignatureVerifier {
        override fun verify(skill: SkillMetadata): VerificationResult =
            if (skill.signature.isNullOrBlank()) {
                VerificationResult.Rejected("signature required")
            } else {
                VerificationResult.Accepted
            }
    }

    /** Test-only verifier — rejects everything; used to lock the empty-result branch. */
    private object AlwaysRejectVerifier : ManifestSignatureVerifier {
        override fun verify(skill: SkillMetadata): VerificationResult =
            VerificationResult.Rejected("test-reject")
    }
}
