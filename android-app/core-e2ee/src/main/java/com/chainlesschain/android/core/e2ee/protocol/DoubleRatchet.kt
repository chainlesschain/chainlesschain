package com.chainlesschain.android.core.e2ee.protocol

import android.util.Log
import com.chainlesschain.android.core.e2ee.crypto.AESCipher
import com.chainlesschain.android.core.e2ee.crypto.HKDF
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import kotlinx.serialization.Serializable

/**
 * Double Ratchet算法
 *
 * Signal Protocol的核心加密机制
 *
 * 特性：
 * - 前向安全性（Forward Secrecy）：旧密钥泄露不影响新消息
 * - 后向安全性（Post-Compromise Security）：密钥泄露后可恢复安全
 * - 消息顺序保证
 * - 丢失消息处理
 *
 * 参考：https://signal.org/docs/specifications/doubleratchet/
 */
class DoubleRatchet {

    companion object {
        private const val TAG = "DoubleRatchet"

        /** 最大跳过消息数（防止DOS攻击） */
        private const val MAX_SKIP = 1000
    }

    /**
     * Ratchet状态
     */
    data class RatchetState(
        /** 根密钥（Root Key） */
        var rootKey: ByteArray,

        /** 发送链密钥（Chain Key for sending） */
        var sendChainKey: ByteArray,

        /** 接收链密钥（Chain Key for receiving） */
        var receiveChainKey: ByteArray,

        /** 发送DH密钥对（用于密钥棘轮） */
        var sendRatchetKeyPair: X25519KeyPair,

        /** 接收DH公钥（用于密钥棘轮） */
        var receiveRatchetKey: ByteArray,

        /** 发送消息序号 */
        var sendMessageNumber: Int = 0,

        /** 接收消息序号 */
        var receiveMessageNumber: Int = 0,

        /** 上一个发送链中的消息数 */
        var previousSendChainLength: Int = 0,

        /** 跳过的消息密钥（用于处理乱序消息） */
        val skippedMessageKeys: MutableMap<MessageKeyId, ByteArray> = mutableMapOf()
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false

            other as RatchetState

            if (!rootKey.contentEquals(other.rootKey)) return false
            if (!sendChainKey.contentEquals(other.sendChainKey)) return false
            if (!receiveChainKey.contentEquals(other.receiveChainKey)) return false

            return true
        }

        override fun hashCode(): Int {
            var result = rootKey.contentHashCode()
            result = 31 * result + sendChainKey.contentHashCode()
            result = 31 * result + receiveChainKey.contentHashCode()
            return result
        }
    }

    /**
     * 消息密钥ID（用于跳过消息）
     */
    @Serializable
    data class MessageKeyId(
        val ratchetKey: ByteArray,
        val messageNumber: Int
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false

            other as MessageKeyId

            if (!ratchetKey.contentEquals(other.ratchetKey)) return false
            if (messageNumber != other.messageNumber) return false

            return true
        }

        override fun hashCode(): Int {
            var result = ratchetKey.contentHashCode()
            result = 31 * result + messageNumber
            return result
        }
    }

    /**
     * 初始化Ratchet状态（发送方）
     *
     * @param sharedSecret X3DH派生的共享密钥
     * @param sendingRatchetKeyPair 发送方的初始DH密钥对
     * @param receivingRatchetKey 接收方的DH公钥
     * @return Ratchet状态
     */
    fun initializeSender(
        sharedSecret: ByteArray,
        sendingRatchetKeyPair: X25519KeyPair,
        receivingRatchetKey: ByteArray
    ): RatchetState {
        Log.d(TAG, "Initializing ratchet (sender)")

        // 使用共享密钥作为初始根密钥
        val initialRootKey = sharedSecret

        // 执行DH棘轮，派生新根密钥和发送链密钥
        val (newRootKey, sendChainKey) = HKDF.deriveRootKey(
            initialRootKey,
            sendingRatchetKeyPair.computeSharedSecret(receivingRatchetKey)
        )

        return RatchetState(
            rootKey = newRootKey,
            sendChainKey = sendChainKey,
            receiveChainKey = ByteArray(32), // 将在接收第一条消息时设置
            sendRatchetKeyPair = sendingRatchetKeyPair,
            receiveRatchetKey = receivingRatchetKey
        )
    }

    /**
     * 初始化Ratchet状态（接收方）
     *
     * @param sharedSecret X3DH派生的共享密钥
     * @param receivingRatchetKeyPair 接收方的DH密钥对
     * @return Ratchet状态
     */
    fun initializeReceiver(
        sharedSecret: ByteArray,
        receivingRatchetKeyPair: X25519KeyPair
    ): RatchetState {
        Log.d(TAG, "Initializing ratchet (receiver)")

        return RatchetState(
            rootKey = sharedSecret,
            sendChainKey = ByteArray(32), // 将在发送第一条消息时设置
            receiveChainKey = ByteArray(32), // 将在接收第一条消息时设置
            sendRatchetKeyPair = receivingRatchetKeyPair,
            receiveRatchetKey = ByteArray(32) // 将在接收第一条消息时设置
        )
    }

    /**
     * 加密消息
     *
     * @param state Ratchet状态
     * @param plaintext 明文
     * @param associatedData 关联数据（用于认证）
     * @return 加密消息
     */
    fun encrypt(
        state: RatchetState,
        plaintext: ByteArray,
        associatedData: ByteArray = ByteArray(0)
    ): RatchetMessage {
        Log.d(TAG, "Encrypting message: ${plaintext.size} bytes")

        // 从链密钥派生消息密钥
        val messageKeys = HKDF.deriveMessageKey(state.sendChainKey)

        // 加密消息
        val ciphertext = AESCipher.encrypt(plaintext, messageKeys)

        // 创建消息头
        val header = MessageHeader(
            ratchetKey = state.sendRatchetKeyPair.publicKey,
            previousChainLength = state.previousSendChainLength,
            messageNumber = state.sendMessageNumber
        )

        // 更新发送链密钥
        state.sendChainKey = HKDF.deriveNextChainKey(state.sendChainKey)
        state.sendMessageNumber++

        Log.d(TAG, "Message encrypted: messageNumber=${header.messageNumber}")

        return RatchetMessage(
            header = header,
            ciphertext = ciphertext
        )
    }

    /**
     * 解密消息
     *
     * @param state Ratchet状态
     * @param message 加密消息
     * @param associatedData 关联数据
     * @return 明文
     */
    fun decrypt(
        state: RatchetState,
        message: RatchetMessage,
        associatedData: ByteArray = ByteArray(0)
    ): ByteArray {
        Log.d(TAG, "Decrypting message: messageNumber=${message.header.messageNumber}")

        // 检查是否需要执行DH棘轮
        if (!message.header.ratchetKey.contentEquals(state.receiveRatchetKey)) {
            skipMessageKeys(state, message.header.previousChainLength)
            dhRatchet(state, message.header.ratchetKey)
        }

        // 跳过丢失的消息
        skipMessageKeys(state, message.header.messageNumber)

        // 从链密钥派生消息密钥
        val messageKeys = HKDF.deriveMessageKey(state.receiveChainKey)

        // 更新接收链密钥
        state.receiveChainKey = HKDF.deriveNextChainKey(state.receiveChainKey)
        state.receiveMessageNumber++

        // 解密消息
        val plaintext = AESCipher.decrypt(message.ciphertext, messageKeys)

        Log.d(TAG, "Message decrypted: ${plaintext.size} bytes")

        return plaintext
    }

    /**
     * 执行DH棘轮
     *
     * @param state Ratchet状态
     * @param newRatchetKey 新的接收DH公钥
     */
    private fun dhRatchet(state: RatchetState, newRatchetKey: ByteArray) {
        Log.d(TAG, "Performing DH ratchet")

        // 保存上一个发送链的长度
        state.previousSendChainLength = state.sendMessageNumber

        // 重置发送和接收消息序号
        state.sendMessageNumber = 0
        state.receiveMessageNumber = 0

        // 更新接收DH公钥
        state.receiveRatchetKey = newRatchetKey

        // 派生新的接收链密钥
        val (newRootKey1, receiveChainKey) = HKDF.deriveRootKey(
            state.rootKey,
            state.sendRatchetKeyPair.computeSharedSecret(newRatchetKey)
        )
        state.rootKey = newRootKey1
        state.receiveChainKey = receiveChainKey

        // 生成新的发送DH密钥对
        state.sendRatchetKeyPair = X25519KeyPair.generate()

        // 派生新的发送链密钥
        val (newRootKey2, sendChainKey) = HKDF.deriveRootKey(
            state.rootKey,
            state.sendRatchetKeyPair.computeSharedSecret(newRatchetKey)
        )
        state.rootKey = newRootKey2
        state.sendChainKey = sendChainKey
    }

    /**
     * 跳过消息密钥（处理乱序/丢失消息）
     *
     * @param state Ratchet状态
     * @param until 跳到的消息序号
     */
    private fun skipMessageKeys(state: RatchetState, until: Int) {
        if (state.receiveMessageNumber + MAX_SKIP < until) {
            Log.w(TAG, "Too many skipped messages: ${until - state.receiveMessageNumber}")
            throw SecurityException("Too many skipped messages")
        }

        while (state.receiveMessageNumber < until) {
            // 派生并保存跳过的消息密钥
            val messageKeys = HKDF.deriveMessageKey(state.receiveChainKey)
            val keyId = MessageKeyId(state.receiveRatchetKey, state.receiveMessageNumber)

            // 保存消息密钥（用于后续解密乱序消息）
            state.skippedMessageKeys[keyId] = messageKeys.cipherKey

            // 更新链密钥
            state.receiveChainKey = HKDF.deriveNextChainKey(state.receiveChainKey)
            state.receiveMessageNumber++
        }
    }
}

/**
 * 消息头
 */
@Serializable
data class MessageHeader(
    /** DH棘轮公钥 */
    val ratchetKey: ByteArray,

    /** 上一个发送链中的消息数 */
    val previousChainLength: Int,

    /** 消息序号 */
    val messageNumber: Int
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as MessageHeader

        if (!ratchetKey.contentEquals(other.ratchetKey)) return false
        if (previousChainLength != other.previousChainLength) return false
        if (messageNumber != other.messageNumber) return false

        return true
    }

    override fun hashCode(): Int {
        var result = ratchetKey.contentHashCode()
        result = 31 * result + previousChainLength
        result = 31 * result + messageNumber
        return result
    }
}

/**
 * 加密消息
 */
@Serializable
data class RatchetMessage(
    /** 消息头 */
    val header: MessageHeader,

    /** 密文（包含MAC） */
    val ciphertext: ByteArray
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as RatchetMessage

        if (header != other.header) return false
        if (!ciphertext.contentEquals(other.ciphertext)) return false

        return true
    }

    override fun hashCode(): Int {
        var result = header.hashCode()
        result = 31 * result + ciphertext.contentHashCode()
        return result
    }
}
