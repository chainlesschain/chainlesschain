package com.chainlesschain.android.core.did.manager

import android.content.Context
import com.chainlesschain.android.core.did.crypto.SignatureUtils
import com.chainlesschain.android.core.did.generator.DidKeyGenerator
import com.chainlesschain.android.core.did.resolver.DidKeyResolver
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever
import java.io.File

/**
 * DIDManager单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DIDManagerTest {

    private lateinit var didManager: DIDManager
    private lateinit var mockContext: Context
    private lateinit var didKeyResolver: DidKeyResolver
    private lateinit var tempDir: File

    @Before
    fun setup() {
        // Create temporary directory for testing
        tempDir = File.createTempFile("did_test", "").apply {
            delete()
            mkdir()
            deleteOnExit()
        }

        mockContext = mock()
        whenever(mockContext.filesDir).thenReturn(tempDir)

        didKeyResolver = DidKeyResolver()
        didManager = DIDManager(mockContext, didKeyResolver)
    }

    @Test
    fun `test createIdentity generates valid DID`() {
        // When
        val identity = didManager.createIdentity("TestDevice")

        // Then
        assertNotNull(identity.did)
        assertTrue(identity.did.startsWith("did:key:z"))
        assertEquals("TestDevice", identity.deviceName)
        assertTrue(identity.keyPair.hasPrivateKey())
        assertNotNull(identity.didDocument)
        assertEquals(identity.did, identity.didDocument.id)
    }

    @Test
    fun `test initialize loads or creates identity`() = runTest {
        // When
        didManager.initialize()

        // Then
        val currentDID = didManager.getCurrentDID()
        assertNotNull(currentDID)
        assertTrue(currentDID!!.startsWith("did:key:z"))

        val currentDocument = didManager.getCurrentDIDDocument()
        assertNotNull(currentDocument)
        assertEquals(currentDID, currentDocument!!.id)
    }

    @Test
    fun `test sign creates valid signature`() = runTest {
        // Given
        didManager.initialize()
        val message = "Test message for signing"

        // When
        val signature = didManager.sign(message)

        // Then
        assertEquals(64, signature.size)
    }

    @Test
    fun `test sign and verify roundtrip`() = runTest {
        // Given
        didManager.initialize()
        val message = "Test message"

        // When
        val signature = didManager.sign(message)
        val isValid = didManager.verify(message, signature, didManager.getCurrentDID()!!)

        // Then
        assertTrue(isValid)
    }

    @Test
    fun `test verify fails with wrong message`() = runTest {
        // Given
        didManager.initialize()
        val originalMessage = "Original message"
        val tamperedMessage = "Tampered message"

        // When
        val signature = didManager.sign(originalMessage)
        val isValid = didManager.verify(tamperedMessage, signature, didManager.getCurrentDID()!!)

        // Then
        assertFalse(isValid)
    }

    @Test
    fun `test verify fails with wrong DID`() = runTest {
        // Given
        didManager.initialize()
        val message = "Test message"

        // Create another DID manager with different identity
        val otherManager = DIDManager(mockContext, didKeyResolver)
        val otherIdentity = otherManager.createIdentity("OtherDevice")

        // When
        val signature = didManager.sign(message)
        val isValid = didManager.verify(message, signature, otherIdentity.did)

        // Then
        assertFalse(isValid)
    }

    @Test
    fun `test signWithTimestamp creates valid timestamped signature`() = runTest {
        // Given
        didManager.initialize()
        val message = "Test message".toByteArray()

        // When
        val timestampedSig = didManager.signWithTimestamp(message)

        // Then
        assertEquals(64, timestampedSig.signature.size)
        assertTrue(timestampedSig.timestamp > 0)
    }

    @Test
    fun `test verifyWithTimestamp succeeds`() = runTest {
        // Given
        didManager.initialize()
        val message = "Test message".toByteArray()

        // When
        val timestampedSig = didManager.signWithTimestamp(message)
        val isValid = didManager.verifyWithTimestamp(
            message,
            timestampedSig,
            didManager.getCurrentDID()!!,
            maxAgeMs = 60000
        )

        // Then
        assertTrue(isValid)
    }

    @Test
    fun `test addTrustedDevice stores device`() = runTest {
        // Given
        didManager.initialize()
        val otherIdentity = didManager.createIdentity("OtherDevice")

        // When
        didManager.addTrustedDevice(otherIdentity.did, "OtherDevice", otherIdentity.keyPair.publicKey)

        // Then
        assertTrue(didManager.isTrustedDevice(otherIdentity.did))
        val trustedDevice = didManager.getTrustedDevice(otherIdentity.did)
        assertNotNull(trustedDevice)
        assertEquals(otherIdentity.did, trustedDevice!!.did)
        assertEquals("OtherDevice", trustedDevice.deviceName)
    }

    @Test
    fun `test addTrustedDevice without publicKey extracts from DID`() = runTest {
        // Given
        didManager.initialize()
        val otherIdentity = didManager.createIdentity("OtherDevice")

        // When
        didManager.addTrustedDevice(otherIdentity.did, "OtherDevice")

        // Then
        val trustedDevice = didManager.getTrustedDevice(otherIdentity.did)
        assertNotNull(trustedDevice)
        assertArrayEquals(otherIdentity.keyPair.publicKey, trustedDevice!!.getPublicKeyBytes())
    }

    @Test
    fun `test removeTrustedDevice removes device`() = runTest {
        // Given
        didManager.initialize()
        val otherIdentity = didManager.createIdentity("OtherDevice")
        didManager.addTrustedDevice(otherIdentity.did, "OtherDevice")

        // When
        didManager.removeTrustedDevice(otherIdentity.did)

        // Then
        assertFalse(didManager.isTrustedDevice(otherIdentity.did))
        assertNull(didManager.getTrustedDevice(otherIdentity.did))
    }

    @Test
    fun `test trustedDevicesList Flow updates`() = runTest {
        // Given
        didManager.initialize()
        val otherIdentity = didManager.createIdentity("OtherDevice")

        // When
        didManager.addTrustedDevice(otherIdentity.did, "OtherDevice")

        // Then
        val trustedDevices = didManager.trustedDevicesList.value
        assertEquals(1, trustedDevices.size)
        assertEquals(otherIdentity.did, trustedDevices[0].did)

        // When removing
        didManager.removeTrustedDevice(otherIdentity.did)

        // Then
        assertEquals(0, didManager.trustedDevicesList.value.size)
    }

    @Test
    fun `test resolveDID returns valid DID Document`() = runTest {
        // Given
        didManager.initialize()
        val did = didManager.getCurrentDID()!!

        // When
        val didDocument = didManager.resolveDID(did)

        // Then
        assertNotNull(didDocument)
        assertEquals(did, didDocument!!.id)
    }

    @Test
    fun `test currentIdentity Flow is updated after initialize`() = runTest {
        // When
        didManager.initialize()

        // Then
        val identity = didManager.currentIdentity.value
        assertNotNull(identity)
        assertNotNull(identity!!.did)
        assertTrue(identity.did.startsWith("did:key:z"))
    }

    @Test(expected = IllegalStateException::class)
    fun `test sign without initialize throws exception`() {
        // When
        didManager.sign("test")

        // Then - exception thrown
    }

    @Test(expected = IllegalStateException::class)
    fun `test signWithTimestamp without initialize throws exception`() {
        // When
        didManager.signWithTimestamp("test".toByteArray())

        // Then - exception thrown
    }

    @Test
    fun `test TrustedDevice publicKey conversion`() {
        // Given
        val publicKey = ByteArray(32) { it.toByte() }
        val trustedDevice = TrustedDevice(
            did = "did:key:z123",
            deviceName = "Test",
            publicKey = publicKey,
            trustedAt = System.currentTimeMillis()
        )

        // When
        val extractedPublicKey = trustedDevice.getPublicKeyBytes()

        // Then
        assertArrayEquals(publicKey, extractedPublicKey)
    }

    @Test
    fun `test identity persistence across instances`() = runTest {
        // Given
        val manager1 = DIDManager(mockContext, didKeyResolver)
        manager1.initialize()
        val originalDID = manager1.getCurrentDID()

        // When - Create new instance
        val manager2 = DIDManager(mockContext, didKeyResolver)
        manager2.initialize()
        val loadedDID = manager2.getCurrentDID()

        // Then - Should load same identity
        assertEquals(originalDID, loadedDID)
    }

    @Test
    fun `test trusted devices persistence across instances`() = runTest {
        // Given
        val manager1 = DIDManager(mockContext, didKeyResolver)
        manager1.initialize()
        val otherIdentity = manager1.createIdentity("OtherDevice")
        manager1.addTrustedDevice(otherIdentity.did, "OtherDevice")

        // When - Create new instance
        val manager2 = DIDManager(mockContext, didKeyResolver)
        manager2.initialize()

        // Then - Should load trusted devices
        assertTrue(manager2.isTrustedDevice(otherIdentity.did))
    }
}
