package com.chainlesschain.android.sign

import com.chainlesschain.android.core.did.crypto.Ed25519KeyPair
import com.chainlesschain.android.core.did.crypto.SignatureUtils
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.security.strongbox.KeyTier
import com.chainlesschain.android.core.security.strongbox.StrongBoxKeyManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.Base64

@OptIn(ExperimentalCoroutinesApi::class)
class SignAsServiceTest {

    private lateinit var didManager: DIDManager
    private lateinit var strongBoxKeyManager: StrongBoxKeyManager
    private lateinit var approvalGate: ApprovalGate
    private lateinit var service: SignAsService

    private val validHash = "a".repeat(64)
    private val testKeyPair = Ed25519KeyPair.generate()

    @Before
    fun setup() {
        didManager = mockk(relaxed = true)
        strongBoxKeyManager = mockk(relaxed = true)
        approvalGate = mockk(relaxed = false)
        service = SignAsService(didManager, strongBoxKeyManager, approvalGate)
    }

    private fun req(
        hash: String = validHash,
        desc: String = "Test payload",
        requireStrongBox: Boolean = false,
    ) = SignAsRequest(hash, desc, requireStrongBox)

    @Test
    fun `SignAsRequest rejects wrong-length hash`() {
        assertThrows(IllegalArgumentException::class.java) {
            SignAsRequest(payloadHash = "abc", description = "x")
        }
    }

    @Test
    fun `SignAsRequest rejects non-hex hash`() {
        assertThrows(IllegalArgumentException::class.java) {
            SignAsRequest(payloadHash = "Z".repeat(64), description = "x")
        }
    }

    @Test
    fun `SignAsRequest accepts mixed case hex`() {
        // 不抛 = 测过
        SignAsRequest(payloadHash = "AbCdEf0123456789".repeat(4), description = "x")
    }

    @Test
    fun `no active DID returns denied with no-active-did`() = runTest {
        every { didManager.getCurrentDID() } returns null

        val resp = service.handleSignRequest(req())

        assertFalse(resp.approved)
        assertEquals("no-active-did", resp.deniedReason)
    }

    @Test
    fun `blank active DID returns denied`() = runTest {
        every { didManager.getCurrentDID() } returns ""

        val resp = service.handleSignRequest(req())

        assertFalse(resp.approved)
        assertEquals("no-active-did", resp.deniedReason)
    }

    @Test
    fun `requireStrongBox with SOFTWARE tier returns no-strongbox`() = runTest {
        every { didManager.getCurrentDID() } returns "did:key:zABC"
        every { strongBoxKeyManager.detectMaxTier() } returns KeyTier.SOFTWARE

        val resp = service.handleSignRequest(req(requireStrongBox = true))

        assertFalse(resp.approved)
        assertEquals("no-strongbox", resp.deniedReason)
    }

    @Test
    fun `requireStrongBox with WRAPPER_TEE tier passes through to approval`() = runTest {
        every { didManager.getCurrentDID() } returns "did:key:zABC"
        every { strongBoxKeyManager.detectMaxTier() } returns KeyTier.WRAPPER_TEE
        every { didManager.requiresBiometric(any()) } returns false
        coEvery { approvalGate.requestApproval(any(), any(), any()) } returns
            ApprovalResult(approved = false, deniedReason = "user-decline")

        val resp = service.handleSignRequest(req(requireStrongBox = true))

        // 到 approval gate（非 no-strongbox 拒绝）
        assertEquals("user-decline", resp.deniedReason)
    }

    @Test
    fun `approval denied returns denied with reason`() = runTest {
        every { didManager.getCurrentDID() } returns "did:key:zABC"
        every { didManager.requiresBiometric(any()) } returns true
        coEvery {
            approvalGate.requestApproval(any(), any(), any())
        } returns ApprovalResult(approved = false, deniedReason = "biometric-failed")

        val resp = service.handleSignRequest(req())

        assertFalse(resp.approved)
        assertEquals("biometric-failed", resp.deniedReason)
    }

    @Test
    fun `approval denied with missing reason defaults to user-declined`() = runTest {
        every { didManager.getCurrentDID() } returns "did:key:zABC"
        every { didManager.requiresBiometric(any()) } returns false
        coEvery {
            approvalGate.requestApproval(any(), any(), any())
        } returns ApprovalResult(approved = false, deniedReason = null)

        val resp = service.handleSignRequest(req())

        assertEquals("user-declined", resp.deniedReason)
    }

    @Test
    fun `successful sign returns base64 signature and did`() = runTest {
        every { didManager.getCurrentDID() } returns "did:key:zXYZ"
        every { didManager.requiresBiometric(any()) } returns false
        coEvery {
            approvalGate.requestApproval(any(), any(), any())
        } returns ApprovalResult(approved = true)

        val signatureBytes = ByteArray(64) { (it % 256).toByte() }
        every { didManager.sign(any<ByteArray>()) } returns signatureBytes

        val resp = service.handleSignRequest(req())

        assertTrue(resp.approved)
        assertEquals("did:key:zXYZ", resp.did)
        assertNotNull(resp.signatureBase64)
        assertNotNull(resp.signedAt)
        val decoded = Base64.getDecoder().decode(resp.signatureBase64)
        assertArrayEquals(signatureBytes, decoded)
    }

    @Test
    fun `sign with hash bytes passes correct decoded payload`() = runTest {
        every { didManager.getCurrentDID() } returns "did:key:z"
        every { didManager.requiresBiometric(any()) } returns false
        coEvery {
            approvalGate.requestApproval(any(), any(), any())
        } returns ApprovalResult(approved = true)
        every { didManager.sign(any<ByteArray>()) } returns ByteArray(64)

        // Known hash → known bytes
        val knownHash = "0123456789abcdef".repeat(4) // 64 chars
        service.handleSignRequest(SignAsRequest(knownHash, "x"))

        coVerify {
            didManager.sign(match<ByteArray> { it.size == 32 && it[0] == 0x01.toByte() && it[1] == 0x23.toByte() })
        }
    }

    @Test
    fun `DIDManager throws IllegalStateException returns no-active-did`() = runTest {
        every { didManager.getCurrentDID() } returns "did:key:z"
        every { didManager.requiresBiometric(any()) } returns false
        coEvery {
            approvalGate.requestApproval(any(), any(), any())
        } returns ApprovalResult(approved = true)
        every { didManager.sign(any<ByteArray>()) } throws IllegalStateException("No DID")

        val resp = service.handleSignRequest(req())

        assertFalse(resp.approved)
        assertEquals("no-active-did", resp.deniedReason)
    }

    @Test
    fun `DIDManager throws unexpected returns sign-failed`() = runTest {
        every { didManager.getCurrentDID() } returns "did:key:z"
        every { didManager.requiresBiometric(any()) } returns false
        coEvery {
            approvalGate.requestApproval(any(), any(), any())
        } returns ApprovalResult(approved = true)
        every { didManager.sign(any<ByteArray>()) } throws RuntimeException("crash")

        val resp = service.handleSignRequest(req())

        assertFalse(resp.approved)
        assertEquals("sign-failed", resp.deniedReason)
    }

    @Test
    fun `biometric flag propagates from DID metadata to approval gate`() = runTest {
        every { didManager.getCurrentDID() } returns "did:key:zBio"
        every { didManager.requiresBiometric("did:key:zBio") } returns true
        coEvery {
            approvalGate.requestApproval(any(), any(), requireBiometric = true)
        } returns ApprovalResult(approved = true)
        every { didManager.sign(any<ByteArray>()) } returns ByteArray(64)

        service.handleSignRequest(req())

        coVerify {
            approvalGate.requestApproval(any(), any(), requireBiometric = true)
        }
    }

    @Test
    fun `end-to-end signature verifies via SignatureUtils with returned DID public key`() = runTest {
        // 使用真实的 Ed25519 KeyPair 做端到端：sign(payload) → verify(payload, sig, pubkey)
        val realKeyPair = testKeyPair
        val payload = ByteArray(32) { 0xCC.toByte() }

        every { didManager.getCurrentDID() } returns "did:key:zReal"
        every { didManager.requiresBiometric(any()) } returns false
        coEvery {
            approvalGate.requestApproval(any(), any(), any())
        } returns ApprovalResult(approved = true)
        every { didManager.sign(payload) } returns SignatureUtils.sign(payload, realKeyPair)

        val resp = service.handleSignRequest(
            SignAsRequest(
                payloadHash = payload.joinToString("") { "%02x".format(it) },
                description = "End-to-end",
            ),
        )

        assertTrue(resp.approved)
        val sigBytes = Base64.getDecoder().decode(resp.signatureBase64)
        assertTrue(SignatureUtils.verify(payload, sigBytes, realKeyPair.publicKey))
    }
}
