package com.chainlesschain.android.core.e2ee

import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import com.chainlesschain.android.core.e2ee.protocol.X3DHKeyExchange
import com.chainlesschain.android.core.e2ee.session.E2EESession
import org.junit.Test
import org.junit.Assert.*

/**
 * 端到端加密集成测试
 *
 * 测试完整的E2EE流程：X3DH + Double Ratchet
 */
class E2EEIntegrationTest {

    @Test
    fun `test complete E2EE session - Alice to Bob`() {
        // Given - Alice和Bob各自生成密钥
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        // Bob发布预密钥包
        val bobPreKeyBundle = X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSignedPreKeyPair
        )

        // When - Alice创建会话
        val (aliceSession, initialMessage) = E2EESession.initializeAsInitiator(
            peerId = "bob",
            senderIdentityKeyPair = aliceIdentityKeyPair,
            receiverPreKeyBundle = bobPreKeyBundle
        )

        // Bob接受会话
        val bobSession = E2EESession.initializeAsResponder(
            peerId = "alice",
            receiverIdentityKeyPair = bobIdentityKeyPair,
            receiverSignedPreKeyPair = bobSignedPreKeyPair,
            receiverOneTimePreKeyPair = null,
            initialMessage = initialMessage
        )

        // Then - Alice加密消息
        val plaintext1 = "Hello, Bob!"
        val encrypted1 = aliceSession.encrypt(plaintext1)

        // Bob解密消息
        val decrypted1 = bobSession.decryptToString(encrypted1)
        assertEquals(plaintext1, decrypted1)

        // Bob回复
        val plaintext2 = "Hi, Alice!"
        val encrypted2 = bobSession.encrypt(plaintext2)

        // Alice解密
        val decrypted2 = aliceSession.decryptToString(encrypted2)
        assertEquals(plaintext2, decrypted2)
    }

    @Test
    fun `test multiple messages in session`() {
        // Given - 建立会话
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        val bobPreKeyBundle = X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSignedPreKeyPair
        )

        val (aliceSession, initialMessage) = E2EESession.initializeAsInitiator(
            "bob",
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

        // When - 发送多条消息
        val messages = listOf(
            "Message 1",
            "Message 2",
            "Message 3",
            "Message 4",
            "Message 5"
        )

        messages.forEach { plaintext ->
            val encrypted = aliceSession.encrypt(plaintext)
            val decrypted = bobSession.decryptToString(encrypted)
            assertEquals(plaintext, decrypted)
        }
    }

    @Test
    fun `test bidirectional communication`() {
        // Given - 建立会话
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        val bobPreKeyBundle = X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSignedPreKeyPair
        )

        val (aliceSession, initialMessage) = E2EESession.initializeAsInitiator(
            "bob",
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

        // When - 双向通信
        // Alice -> Bob
        val msg1 = aliceSession.encrypt("Hello from Alice")
        assertEquals("Hello from Alice", bobSession.decryptToString(msg1))

        // Bob -> Alice
        val msg2 = bobSession.encrypt("Hello from Bob")
        assertEquals("Hello from Bob", aliceSession.decryptToString(msg2))

        // Alice -> Bob
        val msg3 = aliceSession.encrypt("How are you?")
        assertEquals("How are you?", bobSession.decryptToString(msg3))

        // Bob -> Alice
        val msg4 = bobSession.encrypt("I'm fine, thanks!")
        assertEquals("I'm fine, thanks!", aliceSession.decryptToString(msg4))
    }

    @Test
    fun `test binary data encryption`() {
        // Given - 建立会话
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        val bobPreKeyBundle = X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSignedPreKeyPair
        )

        val (aliceSession, initialMessage) = E2EESession.initializeAsInitiator(
            "bob",
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

        // When - 加密二进制数据
        val binaryData = ByteArray(1000) { it.toByte() }
        val encrypted = aliceSession.encrypt(binaryData)
        val decrypted = bobSession.decrypt(encrypted)

        // Then
        assertArrayEquals(binaryData, decrypted)
    }

    @Test
    fun `test session info tracking`() {
        // Given - 建立会话
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        val bobPreKeyBundle = X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSignedPreKeyPair
        )

        val (aliceSession, initialMessage) = E2EESession.initializeAsInitiator(
            "bob",
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

        // When - 发送消息并检查会话信息
        repeat(5) {
            aliceSession.encrypt("Message $it")
        }

        val aliceInfo = aliceSession.getSessionInfo()

        // Then
        assertEquals("bob", aliceInfo.peerId)
        assertEquals(5, aliceInfo.sendMessageNumber)
        assertEquals(0, aliceInfo.receiveMessageNumber)
    }

    @Test
    fun `test large message encryption`() {
        // Given - 建立会话
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        val bobPreKeyBundle = X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSignedPreKeyPair
        )

        val (aliceSession, initialMessage) = E2EESession.initializeAsInitiator(
            "bob",
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

        // When - 加密大消息（100KB）
        val largeMessage = "X".repeat(100 * 1024)
        val encrypted = aliceSession.encrypt(largeMessage)
        val decrypted = bobSession.decryptToString(encrypted)

        // Then
        assertEquals(largeMessage, decrypted)
    }

    @Test(expected = SecurityException::class)
    fun `test tampered message throws exception`() {
        // Given - 建立会话
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        val bobPreKeyBundle = X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSignedPreKeyPair
        )

        val (aliceSession, initialMessage) = E2EESession.initializeAsInitiator(
            "bob",
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

        // When - 篡改密文
        val encrypted = aliceSession.encrypt("Original message")
        val tamperedCiphertext = encrypted.ciphertext.clone()
        tamperedCiphertext[0] = (tamperedCiphertext[0].toInt() xor 0xFF).toByte()

        val tamperedMessage = encrypted.copy(ciphertext = tamperedCiphertext)

        // Then - 解密应该失败
        bobSession.decrypt(tamperedMessage)
    }

    @Test
    fun `test UTF-8 text with emojis`() {
        // Given - 建立会话
        val aliceIdentityKeyPair = X25519KeyPair.generate()
        val bobIdentityKeyPair = X25519KeyPair.generate()
        val bobSignedPreKeyPair = X25519KeyPair.generate()

        val bobPreKeyBundle = X3DHKeyExchange.generatePreKeyBundle(
            bobIdentityKeyPair,
            bobSignedPreKeyPair
        )

        val (aliceSession, initialMessage) = E2EESession.initializeAsInitiator(
            "bob",
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

        // When - 加密包含表情符号的UTF-8文本
        val plaintext = "Hello 👋 World 🌍! 你好 世界 🇨🇳"
        val encrypted = aliceSession.encrypt(plaintext)
        val decrypted = bobSession.decryptToString(encrypted)

        // Then
        assertEquals(plaintext, decrypted)
    }
}
