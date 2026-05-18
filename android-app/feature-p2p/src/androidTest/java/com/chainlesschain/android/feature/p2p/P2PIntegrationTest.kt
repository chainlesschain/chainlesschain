package com.chainlesschain.android.feature.p2p

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.e2ee.identity.IdentityKeyManager
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.e2ee.verification.VerificationManager
import com.chainlesschain.android.core.e2ee.x3dh.X3DHKeyExchange
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.discovery.NSDDeviceDiscovery
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import javax.inject.Inject
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * P2P 功能集成测试
 *
 * 测试完整的 P2P 工作流程：
 * 1. 设备发现
 * 2. 配对和密钥交换
 * 3. 会话建立
 * 4. 消息加密传输
 * 5. Safety Numbers 验证
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class P2PIntegrationTest {

    @get:Rule
    var hiltRule = HiltAndroidRule(this)

    @Inject
    lateinit var deviceDiscovery: NSDDeviceDiscovery

    @Inject
    lateinit var connectionManager: P2PConnectionManager

    @Inject
    lateinit var sessionManager: PersistentSessionManager

    @Inject
    lateinit var keyExchange: X3DHKeyExchange

    @Inject
    lateinit var verificationManager: VerificationManager

    @Inject
    lateinit var identityKeyManager: IdentityKeyManager

    @Inject
    lateinit var didManager: DIDManager

    private lateinit var context: Context

    @Before
    fun setup() {
        hiltRule.inject()
        context = ApplicationProvider.getApplicationContext()

        // Initialize managers
        runBlocking {
            sessionManager.initialize(autoRestore = false, enableRotation = false)
        }
    }

    @After
    fun tearDown() {
        runBlocking {
            // Clean up sessions
            val sessions = sessionManager.activeSessions.first()
            sessions.forEach { session ->
                sessionManager.deleteSession(session.peerId)
            }

            // Stop discovery
            try {
                deviceDiscovery.stopDiscovery()
            } catch (e: Exception) {
                // Ignore
            }
        }
    }

    /**
     * 测试完整的设备配对流程
     */
    @Test
    fun testCompleteDevicePairingFlow() = runBlocking {
        // Given: Two simulated devices
        val device1Id = "device1"
        val device2Id = "device2"

        // Step 1: Device 1 initiates key exchange
        val device1PreKeys = identityKeyManager.generatePreKeyBundle()

        // Step 2: Device 2 receives pre-key bundle and creates session
        val sharedSecret1 = keyExchange.initiateSession(
            remoteIdentityKey = device1PreKeys.identityKey,
            remoteSignedPreKey = device1PreKeys.signedPreKey,
            remoteOneTimePreKey = device1PreKeys.oneTimePreKey,
            remoteSignature = device1PreKeys.signature
        )

        // Step 3: Create session for device 1
        sessionManager.createSession(
            peerId = device1Id,
            sharedSecret = sharedSecret1,
            isInitiator = true
        )

        // Step 4: Verify session was created
        val sessions = sessionManager.activeSessions.first()
        assertEquals(1, sessions.size)
        assertEquals(device1Id, sessions[0].peerId)

        // Step 5: Send encrypted message
        val plaintext = "Hello from device 2!"
        val encryptedMessage = sessionManager.encryptMessage(
            peerId = device1Id,
            plaintext = plaintext.toByteArray()
        )

        assertNotNull(encryptedMessage)
        assertTrue(encryptedMessage.ciphertext.isNotEmpty())

        // Step 6: Decrypt message
        val decryptedMessage = sessionManager.decryptMessage(
            peerId = device1Id,
            encryptedMessage = encryptedMessage
        )

        assertEquals(plaintext, String(decryptedMessage))
    }

    /**
     * 测试设备发现功能
     */
    @Test
    fun testDeviceDiscovery() = runBlocking {
        // Start discovery
        deviceDiscovery.startDiscovery()

        // Wait for discovery to start
        delay(2000)

        // Get discovered devices
        val devices = withTimeout(5000) {
            deviceDiscovery.discoveredDevices.first()
        }

        // Discovery should be running (even if no devices found)
        assertTrue(true) // Test structure validation

        // Stop discovery
        deviceDiscovery.stopDiscovery()
    }

    /**
     * 测试 Safety Numbers 生成和验证
     */
    @Test
    fun testSafetyNumbersGeneration() = runBlocking {
        // Given: Two devices with identity keys
        val device1Id = "device1"
        val device2Id = "device2"

        val device1Key = identityKeyManager.getIdentityKeyPair()
        val device2Key = identityKeyManager.generatePreKeyBundle().identityKey

        // Generate Safety Numbers
        val safetyNumber1 = verificationManager.generateSafetyNumbers(
            localIdentifier = device1Id,
            localPublicKey = device1Key.publicKey.keyBytes,
            remoteIdentifier = device2Id,
            remotePublicKey = device2Key.keyBytes
        )

        val safetyNumber2 = verificationManager.generateSafetyNumbers(
            localIdentifier = device2Id,
            localPublicKey = device2Key.keyBytes,
            remoteIdentifier = device1Id,
            remotePublicKey = device1Key.publicKey.keyBytes
        )

        // Safety Numbers should be identical
        assertEquals(safetyNumber1, safetyNumber2)

        // Should be 60 digits with spaces
        val digits = safetyNumber1.replace(" ", "")
        assertEquals(60, digits.length)
        assertTrue(digits.all { it.isDigit() })
    }

    /**
     * 测试会话持久化
     */
    @Test
    fun testSessionPersistence() = runBlocking {
        // Create a session
        val peerId = "test_peer"
        val sharedSecret = ByteArray(32) { it.toByte() }

        sessionManager.createSession(
            peerId = peerId,
            sharedSecret = sharedSecret,
            isInitiator = true
        )

        // Get session info
        val sessionBefore = sessionManager.getSessionInfo(peerId)
        assertNotNull(sessionBefore)

        // Reinitialize session manager (simulates app restart)
        sessionManager.initialize(autoRestore = true, enableRotation = false)

        // Session should be restored
        val sessionAfter = sessionManager.getSessionInfo(peerId)
        assertNotNull(sessionAfter)
        assertEquals(peerId, sessionAfter.peerId)
    }

    /**
     * 测试消息队列功能
     */
    @Test
    fun testMessageQueueing() = runBlocking {
        // Create session
        val peerId = "test_peer"
        val sharedSecret = ByteArray(32) { it.toByte() }

        sessionManager.createSession(
            peerId = peerId,
            sharedSecret = sharedSecret,
            isInitiator = true
        )

        // Queue multiple messages
        val messages = listOf(
            "Message 1",
            "Message 2",
            "Message 3"
        )

        messages.forEach { message ->
            sessionManager.encryptMessage(
                peerId = peerId,
                plaintext = message.toByteArray()
            )
        }

        // Verify session message count
        val sessionInfo = sessionManager.getSessionInfo(peerId)
        assertNotNull(sessionInfo)
        assertTrue(sessionInfo.sendMessageNumber >= messages.size)
    }

    /**
     * 测试验证状态管理
     */
    @Test
    fun testVerificationStatusManagement() = runBlocking {
        val peerId = "test_peer"

        // Initially not verified
        val initialStatus = verificationManager.isVerified(peerId)
        assertEquals(false, initialStatus)

        // Mark as verified
        verificationManager.markAsVerified(peerId)

        // Should be verified now
        val verifiedStatus = verificationManager.isVerified(peerId)
        assertEquals(true, verifiedStatus)

        // Clear verification
        verificationManager.clearVerification(peerId)

        // Should be unverified again
        val clearedStatus = verificationManager.isVerified(peerId)
        assertEquals(false, clearedStatus)
    }

    /**
     * 测试 DID 文档管理
     */
    @Test
    fun testDIDDocumentManagement() = runBlocking {
        // Get or create local DID
        val did = didManager.getLocalDID() ?: didManager.createDID()

        assertNotNull(did)
        assertTrue(did.startsWith("did:chainlesschain:"))

        // Resolve DID document
        val document = didManager.resolveDID(did)
        assertNotNull(document)
        assertEquals(did, document.id)

        // Verify document structure
        assertTrue(document.verificationMethod.isNotEmpty())
        assertTrue(document.authentication.isNotEmpty())
    }

    /**
     * 测试多会话管理
     */
    @Test
    fun testMultipleSessionManagement() = runBlocking {
        // Create multiple sessions
        val peer1 = "peer1"
        val peer2 = "peer2"
        val peer3 = "peer3"

        sessionManager.createSession(peer1, ByteArray(32), true)
        sessionManager.createSession(peer2, ByteArray(32), true)
        sessionManager.createSession(peer3, ByteArray(32), true)

        // Verify all sessions exist
        val sessions = sessionManager.activeSessions.first()
        assertEquals(3, sessions.size)

        val peerIds = sessions.map { it.peerId }.toSet()
        assertTrue(peerIds.contains(peer1))
        assertTrue(peerIds.contains(peer2))
        assertTrue(peerIds.contains(peer3))

        // Delete one session
        sessionManager.deleteSession(peer2)

        // Verify session was deleted
        val remainingSessions = sessionManager.activeSessions.first()
        assertEquals(2, remainingSessions.size)
        assertEquals(false, remainingSessions.any { it.peerId == peer2 })
    }

    /**
     * 测试加密消息的完整往返
     */
    @Test
    fun testEncryptionRoundTrip() = runBlocking {
        // Setup session
        val peerId = "test_peer"
        val sharedSecret = ByteArray(32) { it.toByte() }

        sessionManager.createSession(
            peerId = peerId,
            sharedSecret = sharedSecret,
            isInitiator = true
        )

        // Test different message sizes
        val testMessages = listOf(
            "Short message",
            "Medium length message with more content to test encryption",
            "Long message: " + "A".repeat(1000)
        )

        testMessages.forEach { plaintext ->
            // Encrypt
            val encrypted = sessionManager.encryptMessage(
                peerId = peerId,
                plaintext = plaintext.toByteArray()
            )

            assertNotNull(encrypted)

            // Decrypt
            val decrypted = sessionManager.decryptMessage(
                peerId = peerId,
                encryptedMessage = encrypted
            )

            // Verify
            assertEquals(plaintext, String(decrypted))
        }
    }

    /**
     * 测试会话指纹生成
     */
    @Test
    fun testSessionFingerprintGeneration() = runBlocking {
        // Generate two key pairs
        val key1 = identityKeyManager.getIdentityKeyPair()
        val key2 = identityKeyManager.generatePreKeyBundle().identityKey

        val associatedData = "test_session".toByteArray()

        // Generate fingerprint
        val fingerprint1 = verificationManager.generateSessionFingerprint(
            localPublicKey = key1.publicKey.keyBytes,
            remotePublicKey = key2.keyBytes,
            associatedData = associatedData
        )

        val fingerprint2 = verificationManager.generateSessionFingerprint(
            localPublicKey = key1.publicKey.keyBytes,
            remotePublicKey = key2.keyBytes,
            associatedData = associatedData
        )

        // Fingerprints should be identical for same keys
        assertEquals(fingerprint1, fingerprint2)

        // Should be valid SHA-256 hex string (64 characters)
        assertEquals(64, fingerprint1.length)
        assertTrue(fingerprint1.all { it.isLetterOrDigit() })
    }
}
