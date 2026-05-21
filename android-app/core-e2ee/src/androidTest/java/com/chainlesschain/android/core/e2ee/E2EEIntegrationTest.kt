package com.chainlesschain.android.core.e2ee

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.core.e2ee.backup.KeyBackupManager
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
// Package moves between the original `.kt.broken` (2026-05-19) and the
// current :core-e2ee source set:
//   messaging.PersistentMessageQueueManager → queue.PersistentMessageQueueManager
//   prekey.PreKeyRotationManager           → rotation.PreKeyRotationManager
// Plus the entire identity.IdentityKeyManager was removed — accessors
// getIdentityKeyPair / getSignedPreKey / getOneTimePreKeys have no clean
// 1:1 replacement on the new state-less X3DHKeyExchange object. Tests that
// previously relied on those accessors generate keys directly via
// X25519KeyPair.generate() where they actually need values.
import com.chainlesschain.android.core.e2ee.queue.PersistentMessageQueueManager
import com.chainlesschain.android.core.e2ee.rotation.PreKeyRotationManager
import com.chainlesschain.android.core.e2ee.session.E2EESession
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.e2ee.util.X3DHParty
import com.chainlesschain.android.core.e2ee.util.simulateX3DHHandshake
import com.chainlesschain.android.core.e2ee.verification.SafetyNumbers
import com.chainlesschain.android.core.e2ee.verification.SessionFingerprint
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import javax.inject.Inject
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * E2EE 核心功能集成测试
 *
 * 测试端到端加密的完整工作流程：
 * 1. 密钥生成和管理
 * 2. X3DH 密钥交换
 * 3. Double Ratchet 加密通信
 * 4. 会话持久化和恢复
 * 5. 预密钥轮换
 * 6. 密钥备份和恢复
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class E2EEIntegrationTest {

    @get:Rule
    var hiltRule = HiltAndroidRule(this)

    @Inject
    lateinit var sessionManager: PersistentSessionManager

    // The classes below are NOT Hilt-managed in production — PersistentSessionManager
    // constructs them internally (PreKeyRotationManager needs 3 callback lambdas, etc.).
    // Wire them up manually in setup() rather than adding a test-only Hilt module.
    private lateinit var preKeyRotationManager: PreKeyRotationManager
    private val keyBackupManager = KeyBackupManager()
    private lateinit var messageQueueManager: PersistentMessageQueueManager

    private lateinit var context: Context

    @Before
    fun setup() {
        hiltRule.inject()
        context = ApplicationProvider.getApplicationContext()

        preKeyRotationManager = PreKeyRotationManager(
            onSignedPreKeyRotation = { /* no-op for tests */ },
            onOneTimePreKeysGeneration = { /* no-op for tests */ },
            onOneTimePreKeysCleanup = { /* no-op for tests */ }
        )
        messageQueueManager = PersistentMessageQueueManager(context)

        runBlocking {
            // Initialize session manager
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

            // Stop rotation
            try {
                preKeyRotationManager.stop()
            } catch (e: Exception) {
                // Ignore
            }
        }
    }

    /**
     * 测试完整的 X3DH + Double Ratchet 工作流程
     *
     * Reactivated via [simulateX3DHHandshake] — Alice (initiator) and Bob
     * (responder) wire up via the X3DHParty simulator, then exchange
     * encrypted messages bidirectionally. Replaces the deprecated
     * `(peerId, sharedSecret, isInitiator)` overload with the proper
     * PreKeyBundle X3DH dance.
     */
    @Test
    fun testCompleteE2EEWorkflow() = runBlocking {
        val sim = simulateX3DHHandshake()

        // Alice → Bob
        val aliceMessage = "Hello Bob from Alice!"
        val fromAlice = sim.aliceSession.encrypt(aliceMessage)
        val decryptedByBob = sim.bobSession.decryptToString(fromAlice)
        assertEquals(aliceMessage, decryptedByBob)

        // Bob → Alice
        val bobMessage = "Hi Alice, this is Bob!"
        val fromBob = sim.bobSession.encrypt(bobMessage)
        val decryptedByAlice = sim.aliceSession.decryptToString(fromBob)
        assertEquals(bobMessage, decryptedByAlice)
    }

    /**
     * 测试会话持久化和恢复
     *
     * Alice (Hilt-injected [sessionManager]) creates a session with Bob, then
     * a SECOND PSM instance loads from the same on-disk storage and confirms
     * the session was restored. Bypasses Hilt for the second instance because
     * @Singleton can't be re-injected mid-test; PSM has a normal constructor
     * accepting [Context].
     */
    @Test
    fun testSessionPersistenceAndRecovery() = runBlocking {
        val bob = X3DHParty("test_peer")

        // Alice creates session with Bob via PSM
        sessionManager.createSession("test_peer", bob.preKeyBundle)
        // Encrypt one message to ensure ratchet state is persisted post-init
        sessionManager.encrypt("test_peer", "before restart".toByteArray())
        assertTrue(sessionManager.hasSession("test_peer"))

        // Simulate restart — fresh PSM instance loads from same context.filesDir
        val freshPsm = PersistentSessionManager(context)
        freshPsm.initialize(autoRestore = true, enableRotation = false)
        delay(500)

        assertTrue(freshPsm.hasSession("test_peer"))

        // Cleanup so @After's sessionManager.deleteSession doesn't conflict
        freshPsm.deleteSession("test_peer")
        freshPsm.shutdown()
    }

    /**
     * 测试预密钥轮换
     *
     * Original test compared signed-pre-keys before/after rotation via
     * IdentityKeyManager.getSignedPreKey() — that manager no longer exists
     * and the assertion was already a no-op (`assertTrue(true)` after a
     * "may not always trigger" comment). Simplified to: just verify that
     * start() + stop() run without throwing. Real rotation behavior is
     * covered by PreKeyRotationManager's own unit tests.
     */
    @Test
    fun testPreKeyRotation() = runBlocking {
        // Start rotation with short interval for testing
        preKeyRotationManager.start(
            signedPreKeyInterval = 5000L, // 5 seconds
            oneTimePreKeyCheckInterval = 1000L // 1 second
        )

        // Let one cycle happen
        delay(1500)

        // Stop rotation — must not throw
        preKeyRotationManager.stop()

        assertTrue(true) // Sanity: start/stop completed
    }

    /**
     * 测试密钥备份和恢复
     *
     * Generate test key material directly via X25519KeyPair.generate() —
     * the original IdentityKeyManager.getIdentityKeyPair/getSignedPreKey/
     * getOneTimePreKeys accessors no longer exist. Tests the createBackup/
     * restoreBackup round-trip via KeyBackupManager, which is the intent.
     */
    @Test
    fun testKeyBackupAndRecovery() = runBlocking {
        val passphrase = "test_passphrase_123"

        // Generate test keys
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()
        val oneTimePreKeys: Map<String, X25519KeyPair> = mapOf(
            "pk1" to X25519KeyPair.generate(),
            "pk2" to X25519KeyPair.generate()
        )

        // Create backup
        val backup = keyBackupManager.createBackup(
            identityKeyPair = identityKeyPair,
            signedPreKeyPair = signedPreKeyPair,
            oneTimePreKeys = oneTimePreKeys,
            passphrase = passphrase
        )

        assertNotNull(backup)
        assertTrue(backup.encryptedData.isNotEmpty())

        // Restore backup
        val restored = keyBackupManager.restoreBackup(
            encryptedBackup = backup,
            passphrase = passphrase
        )

        assertNotNull(restored)

        // Verify restored keys match original
        assertTrue(
            restored.identityKeyPair.publicKey.contentEquals(
                identityKeyPair.publicKey
            )
        )
    }

    /**
     * 测试消息队列功能
     *
     * Alice encrypts 3 messages and enqueues them via [messageQueueManager];
     * `getAllOutgoingMessages()` returns them filtered by peerId. Note PMQM
     * needs explicit `initialize()` (not auto-injected lifecycle).
     */
    @Test
    fun testMessageQueueOperations() = runBlocking {
        val bob = X3DHParty("queue_test_peer")

        sessionManager.createSession("queue_test_peer", bob.preKeyBundle)
        messageQueueManager.initialize(autoRestore = false, enableAutoSave = false)

        val messages = listOf("Message 1", "Message 2", "Message 3")
        messages.forEach { msg ->
            val encrypted = sessionManager.encrypt("queue_test_peer", msg.toByteArray())
            messageQueueManager.enqueueOutgoing(
                peerId = "queue_test_peer",
                message = encrypted,
                priority = 50
            )
        }

        val all = messageQueueManager.getAllOutgoingMessages()
        val forPeer = all.filter { it.peerId == "queue_test_peer" }
        assertEquals(3, forPeer.size)
    }

    /**
     * 测试 Safety Numbers 生成
     */
    @Test
    fun testSafetyNumbersGeneration() {
        val alice = "alice"
        val bob = "bob"

        val aliceKey = ByteArray(32) { 0x01 }
        val bobKey = ByteArray(32) { 0x02 }

        // Generate from Alice's perspective
        val safetyNumberAlice = SafetyNumbers.generate(
            localIdentifier = alice,
            localPublicKey = aliceKey,
            remoteIdentifier = bob,
            remotePublicKey = bobKey
        )

        // Generate from Bob's perspective
        val safetyNumberBob = SafetyNumbers.generate(
            localIdentifier = bob,
            localPublicKey = bobKey,
            remoteIdentifier = alice,
            remotePublicKey = aliceKey
        )

        // Safety numbers should be identical
        assertEquals(safetyNumberAlice, safetyNumberBob)

        // Should be 60 digits with spaces (5 groups of 12)
        val groups = safetyNumberAlice.split(" ")
        assertEquals(5, groups.size)
        groups.forEach { group ->
            assertEquals(12, group.length)
            assertTrue(group.all { it.isDigit() })
        }
    }

    /**
     * 测试会话指纹生成
     */
    @Test
    fun testSessionFingerprintGeneration() {
        val localKey = ByteArray(32) { 0x01 }
        val remoteKey = ByteArray(32) { 0x02 }
        val associatedData = "test_session".toByteArray()

        // Generate fingerprint
        val fingerprint = SessionFingerprint.generate(
            localPublicKey = localKey,
            remotePublicKey = remoteKey,
            associatedData = associatedData
        )

        assertNotNull(fingerprint)

        // Should be SHA-256 hex (64 characters)
        assertEquals(64, fingerprint.length)
        assertTrue(fingerprint.all { it in '0'..'9' || it in 'a'..'f' })

        // Same inputs should produce same fingerprint
        val fingerprint2 = SessionFingerprint.generate(
            localPublicKey = localKey,
            remotePublicKey = remoteKey,
            associatedData = associatedData
        )

        assertEquals(fingerprint, fingerprint2)
    }

    /**
     * 测试乱序消息处理
     *
     * Alice encrypts msg1/2/3 sequentially; Bob decrypts in order 3,1,2. Double
     * Ratchet's skipped-message-keys cache should handle this transparently.
     */
    @Test
    fun testOutOfOrderMessageHandling() = runBlocking {
        val sim = simulateX3DHHandshake()

        val msg1 = sim.aliceSession.encrypt("Message 1")
        val msg2 = sim.aliceSession.encrypt("Message 2")
        val msg3 = sim.aliceSession.encrypt("Message 3")

        assertEquals("Message 3", sim.bobSession.decryptToString(msg3))
        assertEquals("Message 1", sim.bobSession.decryptToString(msg1))
        assertEquals("Message 2", sim.bobSession.decryptToString(msg2))
    }

    /**
     * 测试大消息加密
     *
     * 1 MiB payload through Alice → Bob — verifies the AEAD path handles
     * large plaintexts (no chunking required at this layer).
     */
    @Test
    fun testLargeMessageEncryption() = runBlocking {
        val sim = simulateX3DHHandshake()

        val largeMessage = ByteArray(1024 * 1024) { (it % 256).toByte() }
        val encrypted = sim.aliceSession.encrypt(largeMessage)
        val decrypted = sim.bobSession.decrypt(encrypted)

        assertTrue(largeMessage.contentEquals(decrypted))
    }

    /**
     * 测试会话删除
     *
     * Alice creates session, verifies [hasSession]=true, deletes, verifies
     * false. Bob's bundle is used to satisfy the X3DH initiator path but the
     * test only checks Alice's PSM state.
     */
    @Test
    fun testSessionDeletion() = runBlocking {
        val bob = X3DHParty("delete_test_peer")

        sessionManager.createSession("delete_test_peer", bob.preKeyBundle)
        assertTrue(sessionManager.hasSession("delete_test_peer"))

        sessionManager.deleteSession("delete_test_peer")

        assertFalse(sessionManager.hasSession("delete_test_peer"))
    }

    /**
     * 测试并发加密操作
     *
     * Original name was aspirational — the body is sequential 1..10 encrypt
     * then decrypt. Real concurrency would need async coroutines + a shared
     * ratchet lock; kept sequential to match the original surface.
     */
    @Test
    fun testConcurrentEncryption() = runBlocking {
        val sim = simulateX3DHHandshake()

        val messages = (1..10).map { "Message $it" }
        val encrypted = messages.map { sim.aliceSession.encrypt(it) }
        val decrypted = encrypted.map { sim.bobSession.decryptToString(it) }

        assertEquals(messages, decrypted)
    }
}
