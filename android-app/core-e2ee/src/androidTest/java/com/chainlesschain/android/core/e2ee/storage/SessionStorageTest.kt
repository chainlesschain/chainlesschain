package com.chainlesschain.android.core.e2ee.storage

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.core.e2ee.crypto.Ed25519KeyPair
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import com.chainlesschain.android.core.e2ee.protocol.DoubleRatchet
import com.chainlesschain.android.core.e2ee.session.E2EESession
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.File

/**
 * SessionStorage 测试
 */
@RunWith(AndroidJUnit4::class)
class SessionStorageTest {

    private lateinit var context: Context
    private lateinit var sessionStorage: SessionStorage
    private lateinit var storageDir: File

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        sessionStorage = SessionStorage(context)
        storageDir = File(context.filesDir, "e2ee_sessions")
    }

    @After
    fun cleanup() {
        // 清理测试文件
        storageDir.listFiles()?.forEach { it.delete() }
    }

    @Test
    fun `test save and load identity keys`() = runBlocking {
        // Given
        val identityKeyPair = X25519KeyPair.generate()
        val signedPreKeyPair = X25519KeyPair.generate()

        // When
        sessionStorage.saveIdentityKeys(identityKeyPair, signedPreKeyPair)
        val loaded = sessionStorage.loadIdentityKeys()

        // Then
        assertNotNull(loaded)
        val (loadedIdentity, loadedSignedPreKey) = loaded!!
        assertArrayEquals(identityKeyPair.publicKey, loadedIdentity.publicKey)
        assertArrayEquals(identityKeyPair.privateKey, loadedIdentity.privateKey)
        assertArrayEquals(signedPreKeyPair.publicKey, loadedSignedPreKey.publicKey)
        assertArrayEquals(signedPreKeyPair.privateKey, loadedSignedPreKey.privateKey)
    }

    @Test
    fun `test save and load one-time pre-keys`() = runBlocking {
        // Given
        val preKeys = mapOf(
            "key1" to X25519KeyPair.generate(),
            "key2" to X25519KeyPair.generate(),
            "key3" to X25519KeyPair.generate()
        )

        // When
        sessionStorage.saveOneTimePreKeys(preKeys)
        val loaded = sessionStorage.loadOneTimePreKeys()

        // Then
        assertEquals(3, loaded.size)
        preKeys.forEach { (id, keyPair) ->
            val loadedKeyPair = loaded[id]
            assertNotNull(loadedKeyPair)
            assertArrayEquals(keyPair.publicKey, loadedKeyPair!!.publicKey)
            assertArrayEquals(keyPair.privateKey, loadedKeyPair.privateKey)
        }
    }

    @Test
    fun `test save and load session`() = runBlocking {
        // Given
        val peerId = "test_peer"
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSigningKeyPair = Ed25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        val bobPreKeyBundle = com.chainlesschain.android.core.e2ee.protocol.X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSigningKeyPair,
            bobSignedPreKeyPair
        )

        val (session, _) = E2EESession.initializeAsInitiator(
            peerId,
            aliceIdentityKeyPair,
            bobPreKeyBundle
        )

        // When
        sessionStorage.saveSession(
            peerId,
            session,
            session.getRatchetState(),
            session.getAssociatedData()
        )

        val loaded = sessionStorage.loadSession(peerId)

        // Then
        assertNotNull(loaded)
        val (loadedRatchetState, loadedAssociatedData) = loaded!!
        assertEquals(0, loadedRatchetState.sendMessageNumber)
        assertEquals(0, loadedRatchetState.receiveMessageNumber)
        assertArrayEquals(session.getAssociatedData(), loadedAssociatedData)
    }

    @Test
    fun `test delete session`() = runBlocking {
        // Given
        val peerId = "test_peer"
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSigningKeyPair = Ed25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        val bobPreKeyBundle = com.chainlesschain.android.core.e2ee.protocol.X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSigningKeyPair,
            bobSignedPreKeyPair
        )

        val (session, _) = E2EESession.initializeAsInitiator(
            peerId,
            aliceIdentityKeyPair,
            bobPreKeyBundle
        )

        sessionStorage.saveSession(
            peerId,
            session,
            session.getRatchetState(),
            session.getAssociatedData()
        )

        // When
        sessionStorage.deleteSession(peerId)
        val loaded = sessionStorage.loadSession(peerId)

        // Then
        assertNull(loaded)
    }

    @Test
    fun `test get all session IDs`() = runBlocking {
        // Given
        val peerIds = listOf("peer1", "peer2", "peer3")
        val aliceIdentityKeyPair = X25519KeyPair.generate()

        for (peerId in peerIds) {
            val bobIdentityKeyPair = X25519KeyPair.generate()
            val bobSigningKeyPair = Ed25519KeyPair.generate()
            val bobSignedPreKeyPair = X25519KeyPair.generate()

            val bobPreKeyBundle = com.chainlesschain.android.core.e2ee.protocol.X3DHKeyExchange.generatePreKeyBundle(
                bobIdentityKeyPair,
                bobSigningKeyPair,
                bobSignedPreKeyPair
            )

            val (session, _) = E2EESession.initializeAsInitiator(
                peerId,
                aliceIdentityKeyPair,
                bobPreKeyBundle
            )

            sessionStorage.saveSession(
                peerId,
                session,
                session.getRatchetState(),
                session.getAssociatedData()
            )
        }

        // When
        val sessionIds = sessionStorage.getAllSessionIds()

        // Then
        assertEquals(3, sessionIds.size)
        assertTrue(sessionIds.containsAll(peerIds))
    }

    @Test
    fun `test session persistence across encryption operations`() = runBlocking {
        // Given
        val peerId = "test_peer"
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSigningKeyPair = Ed25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        val bobPreKeyBundle = com.chainlesschain.android.core.e2ee.protocol.X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSigningKeyPair,
            bobSignedPreKeyPair
        )

        val (aliceSession, initialMessage) = E2EESession.initializeAsInitiator(
            peerId,
            aliceIdentityKeyPair,
            bobPreKeyBundle
        )

        val bobSession = E2EESession.initializeAsResponder(
            "alice",
            bobIdentityKeyPair,
            bobSignedPreKeyPair,
            null,
            initialMessage
        )

        // 发送几条消息
        val message1 = aliceSession.encrypt("Message 1")
        bobSession.decrypt(message1)

        val message2 = aliceSession.encrypt("Message 2")
        bobSession.decrypt(message2)

        // When - 保存并重新加载会话
        sessionStorage.saveSession(
            peerId,
            aliceSession,
            aliceSession.getRatchetState(),
            aliceSession.getAssociatedData()
        )

        val loaded = sessionStorage.loadSession(peerId)
        assertNotNull(loaded)

        val (loadedRatchetState, loadedAssociatedData) = loaded!!
        val restoredSession = E2EESession.restore(peerId, loadedRatchetState, loadedAssociatedData)

        // Then - 恢复的会话应该能继续加密/解密
        val message3 = restoredSession.encrypt("Message 3")
        val decrypted3 = bobSession.decryptToString(message3)

        assertEquals("Message 3", decrypted3)
    }

    @Test
    fun `test load non-existent session returns null`() = runBlocking {
        // When
        val loaded = sessionStorage.loadSession("non_existent_peer")

        // Then
        assertNull(loaded)
    }

    @Test
    fun `test load non-existent identity keys returns null`() = runBlocking {
        // When
        val loaded = sessionStorage.loadIdentityKeys()

        // Then
        assertNull(loaded)
    }

    @Test
    fun `test load non-existent pre-keys returns empty map`() = runBlocking {
        // When
        val loaded = sessionStorage.loadOneTimePreKeys()

        // Then
        assertTrue(loaded.isEmpty())
    }
}
