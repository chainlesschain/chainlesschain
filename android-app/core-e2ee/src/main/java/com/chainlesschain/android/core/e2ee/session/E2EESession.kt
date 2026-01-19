package com.chainlesschain.android.core.e2ee.session

import android.util.Log
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import com.chainlesschain.android.core.e2ee.protocol.DoubleRatchet
import com.chainlesschain.android.core.e2ee.protocol.PreKeyBundle
import com.chainlesschain.android.core.e2ee.protocol.RatchetMessage
import com.chainlesschain.android.core.e2ee.protocol.X3DHKeyExchange
import kotlinx.serialization.Serializable

/**
 * 端到端加密会话
 *
 * 管理与特定对等方的加密会话
 */
class E2EESession(
    /** 对等方标识符（DID或设备ID） */
    val peerId: String,

    /** Ratchet状态 */
    private var ratchetState: DoubleRatchet.RatchetState,

    /** 关联数据（用于认证） */
    private val associatedData: ByteArray
) {

    companion object {
        private const val TAG = "E2EESession"

        /**
         * 作为发送方初始化会话
         *
         * @param peerId 对等方ID
         * @param senderIdentityKeyPair 发送方身份密钥对
         * @param receiverPreKeyBundle 接收方预密钥包
         * @return (会话, 初始消息头)
         */
        fun initializeAsInitiator(
            peerId: String,
            senderIdentityKeyPair: X25519KeyPair,
            receiverPreKeyBundle: PreKeyBundle
        ): Pair<E2EESession, InitialMessage> {
            Log.d(TAG, "Initializing session as initiator with peer: $peerId")

            // 生成临时密钥对
            val senderEphemeralKeyPair = X25519KeyPair.generate()

            // 执行X3DH密钥交换
            val x3dhResult = X3DHKeyExchange.senderX3DH(
                senderIdentityKeyPair,
                senderEphemeralKeyPair,
                receiverPreKeyBundle
            )

            // 初始化Double Ratchet
            val doubleRatchet = DoubleRatchet()
            val sendingRatchetKeyPair = X25519KeyPair.generate()

            val ratchetState = doubleRatchet.initializeSender(
                x3dhResult.sharedSecret,
                sendingRatchetKeyPair,
                receiverPreKeyBundle.signedPreKey
            )

            // 创建初始消息头（包含发送方的公钥）
            val initialMessage = InitialMessage(
                identityKey = senderIdentityKeyPair.publicKey,
                ephemeralKey = senderEphemeralKeyPair.publicKey,
                ratchetKey = sendingRatchetKeyPair.publicKey,
                oneTimePreKeyUsed = receiverPreKeyBundle.oneTimePreKey != null
            )

            val session = E2EESession(
                peerId = peerId,
                ratchetState = ratchetState,
                associatedData = x3dhResult.associatedData
            )

            Log.d(TAG, "Session initialized as initiator")

            return Pair(session, initialMessage)
        }

        /**
         * 作为接收方初始化会话
         *
         * @param peerId 对等方ID
         * @param receiverIdentityKeyPair 接收方身份密钥对
         * @param receiverSignedPreKeyPair 接收方签名预密钥对
         * @param receiverOneTimePreKeyPair 接收方一次性预密钥对（可选）
         * @param initialMessage 发送方的初始消息
         * @return 会话
         */
        fun initializeAsResponder(
            peerId: String,
            receiverIdentityKeyPair: X25519KeyPair,
            receiverSignedPreKeyPair: X25519KeyPair,
            receiverOneTimePreKeyPair: X25519KeyPair?,
            initialMessage: InitialMessage
        ): E2EESession {
            Log.d(TAG, "Initializing session as responder with peer: $peerId")

            // 执行X3DH密钥交换
            val x3dhResult = X3DHKeyExchange.receiverX3DH(
                receiverIdentityKeyPair,
                receiverSignedPreKeyPair,
                if (initialMessage.oneTimePreKeyUsed) receiverOneTimePreKeyPair else null,
                initialMessage.identityKey,
                initialMessage.ephemeralKey
            )

            // 初始化Double Ratchet
            val doubleRatchet = DoubleRatchet()
            val ratchetState = doubleRatchet.initializeReceiver(
                x3dhResult.sharedSecret,
                receiverSignedPreKeyPair
            )

            // 设置接收DH公钥
            ratchetState.receiveRatchetKey = initialMessage.ratchetKey

            val session = E2EESession(
                peerId = peerId,
                ratchetState = ratchetState,
                associatedData = x3dhResult.associatedData
            )

            Log.d(TAG, "Session initialized as responder")

            return session
        }
    }

    /**
     * 加密消息
     *
     * @param plaintext 明文
     * @return 加密消息
     */
    fun encrypt(plaintext: ByteArray): RatchetMessage {
        Log.d(TAG, "Encrypting message for peer: $peerId")

        val doubleRatchet = DoubleRatchet()
        return doubleRatchet.encrypt(ratchetState, plaintext, associatedData)
    }

    /**
     * 加密文本消息
     *
     * @param plaintext 明文字符串
     * @return 加密消息
     */
    fun encrypt(plaintext: String): RatchetMessage {
        return encrypt(plaintext.toByteArray(Charsets.UTF_8))
    }

    /**
     * 解密消息
     *
     * @param message 加密消息
     * @return 明文
     */
    fun decrypt(message: RatchetMessage): ByteArray {
        Log.d(TAG, "Decrypting message from peer: $peerId")

        val doubleRatchet = DoubleRatchet()
        return doubleRatchet.decrypt(ratchetState, message, associatedData)
    }

    /**
     * 解密文本消息
     *
     * @param message 加密消息
     * @return 明文字符串
     */
    fun decryptToString(message: RatchetMessage): String {
        val plaintext = decrypt(message)
        return String(plaintext, Charsets.UTF_8)
    }

    /**
     * 获取会话状态
     */
    fun getSessionInfo(): SessionInfo {
        return SessionInfo(
            peerId = peerId,
            sendMessageNumber = ratchetState.sendMessageNumber,
            receiveMessageNumber = ratchetState.receiveMessageNumber,
            skippedMessagesCount = ratchetState.skippedMessageKeys.size
        )
    }
}

/**
 * 初始消息（会话建立时）
 */
@Serializable
data class InitialMessage(
    /** 发送方身份公钥 */
    val identityKey: ByteArray,

    /** 发送方临时公钥 */
    val ephemeralKey: ByteArray,

    /** 发送方Ratchet公钥 */
    val ratchetKey: ByteArray,

    /** 是否使用了一次性预密钥 */
    val oneTimePreKeyUsed: Boolean
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as InitialMessage

        if (!identityKey.contentEquals(other.identityKey)) return false
        if (!ephemeralKey.contentEquals(other.ephemeralKey)) return false
        if (!ratchetKey.contentEquals(other.ratchetKey)) return false
        if (oneTimePreKeyUsed != other.oneTimePreKeyUsed) return false

        return true
    }

    override fun hashCode(): Int {
        var result = identityKey.contentHashCode()
        result = 31 * result + ephemeralKey.contentHashCode()
        result = 31 * result + ratchetKey.contentHashCode()
        result = 31 * result + oneTimePreKeyUsed.hashCode()
        return result
    }
}

/**
 * 会话信息
 */
data class SessionInfo(
    /** 对等方ID */
    val peerId: String,

    /** 已发送消息数 */
    val sendMessageNumber: Int,

    /** 已接收消息数 */
    val receiveMessageNumber: Int,

    /** 跳过的消息数 */
    val skippedMessagesCount: Int
)
