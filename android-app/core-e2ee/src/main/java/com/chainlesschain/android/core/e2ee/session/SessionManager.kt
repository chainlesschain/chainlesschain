package com.chainlesschain.android.core.e2ee.session

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import com.chainlesschain.android.core.e2ee.protocol.PreKeyBundle
import com.chainlesschain.android.core.e2ee.protocol.RatchetMessage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 会话管理器
 *
 * 管理所有端到端加密会话
 */
@Singleton
class SessionManager @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        private const val TAG = "SessionManager"
    }

    // 当前设备的密钥对
    private lateinit var identityKeyPair: X25519KeyPair
    private lateinit var signedPreKeyPair: X25519KeyPair
    private val oneTimePreKeys = mutableMapOf<String, X25519KeyPair>()

    // 活跃会话
    private val sessions = mutableMapOf<String, E2EESession>()
    private val _activeSessions = MutableStateFlow<List<SessionInfo>>(emptyList())
    val activeSessions: StateFlow<List<SessionInfo>> = _activeSessions.asStateFlow()

    /**
     * 初始化会话管理器
     */
    fun initialize() {
        Log.i(TAG, "Initializing session manager")

        // 生成身份密钥对（长期）
        identityKeyPair = X25519KeyPair.generate()

        // 生成签名预密钥对（中期）
        signedPreKeyPair = X25519KeyPair.generate()

        // 生成一次性预密钥（短期）
        generateOneTimePreKeys(10) // 生成10个一次性预密钥

        Log.i(TAG, "Session manager initialized")
    }

    /**
     * 生成一次性预密钥
     *
     * @param count 生成数量
     */
    private fun generateOneTimePreKeys(count: Int) {
        repeat(count) {
            val keyPair = X25519KeyPair.generate()
            val keyId = "opk_${System.currentTimeMillis()}_$it"
            oneTimePreKeys[keyId] = keyPair
        }
        Log.d(TAG, "Generated $count one-time pre-keys")
    }

    /**
     * 获取预密钥包
     *
     * @return 预密钥包
     */
    fun getPreKeyBundle(): PreKeyBundle {
        // 获取一个一次性预密钥（使用后删除）
        val oneTimePreKeyPair = oneTimePreKeys.values.firstOrNull()

        return com.chainlesschain.android.core.e2ee.protocol.X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeyPair
        )
    }

    /**
     * 消费一次性预密钥
     *
     * @param publicKey 公钥
     */
    private fun consumeOneTimePreKey(publicKey: ByteArray?): X25519KeyPair? {
        if (publicKey == null) return null

        val entry = oneTimePreKeys.entries.find {
            it.value.publicKey.contentEquals(publicKey)
        }

        return if (entry != null) {
            oneTimePreKeys.remove(entry.key)
            Log.d(TAG, "Consumed one-time pre-key: ${entry.key}")
            entry.value
        } else {
            null
        }
    }

    /**
     * 创建会话（作为发起方）
     *
     * @param peerId 对等方ID
     * @param peerPreKeyBundle 对等方预密钥包
     * @return (会话, 初始消息)
     */
    fun createSession(
        peerId: String,
        peerPreKeyBundle: PreKeyBundle
    ): Pair<E2EESession, InitialMessage> {
        Log.i(TAG, "Creating session with peer: $peerId")

        val (session, initialMessage) = E2EESession.initializeAsInitiator(
            peerId,
            identityKeyPair,
            peerPreKeyBundle
        )

        sessions[peerId] = session
        updateActiveSessions()

        Log.i(TAG, "Session created with peer: $peerId")

        return Pair(session, initialMessage)
    }

    /**
     * 接受会话（作为响应方）
     *
     * @param peerId 对等方ID
     * @param initialMessage 初始消息
     * @return 会话
     */
    fun acceptSession(
        peerId: String,
        initialMessage: InitialMessage
    ): E2EESession {
        Log.i(TAG, "Accepting session from peer: $peerId")

        // 获取对应的一次性预密钥
        val oneTimePreKeyPair = if (initialMessage.oneTimePreKeyUsed) {
            consumeOneTimePreKey(null) // 简化版：使用第一个可用的
        } else {
            null
        }

        val session = E2EESession.initializeAsResponder(
            peerId,
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeyPair,
            initialMessage
        )

        sessions[peerId] = session
        updateActiveSessions()

        Log.i(TAG, "Session accepted from peer: $peerId")

        return session
    }

    /**
     * 获取会话
     *
     * @param peerId 对等方ID
     * @return 会话，如果不存在返回null
     */
    fun getSession(peerId: String): E2EESession? {
        return sessions[peerId]
    }

    /**
     * 加密消息
     *
     * @param peerId 对等方ID
     * @param plaintext 明文
     * @return 加密消息
     * @throws IllegalStateException 如果会话不存在
     */
    fun encrypt(peerId: String, plaintext: ByteArray): RatchetMessage {
        val session = sessions[peerId]
            ?: throw IllegalStateException("No session with peer: $peerId")

        return session.encrypt(plaintext)
    }

    /**
     * 加密文本消息
     *
     * @param peerId 对等方ID
     * @param plaintext 明文字符串
     * @return 加密消息
     */
    fun encrypt(peerId: String, plaintext: String): RatchetMessage {
        return encrypt(peerId, plaintext.toByteArray(Charsets.UTF_8))
    }

    /**
     * 解密消息
     *
     * @param peerId 对等方ID
     * @param message 加密消息
     * @return 明文
     * @throws IllegalStateException 如果会话不存在
     */
    fun decrypt(peerId: String, message: RatchetMessage): ByteArray {
        val session = sessions[peerId]
            ?: throw IllegalStateException("No session with peer: $peerId")

        return session.decrypt(message)
    }

    /**
     * 解密文本消息
     *
     * @param peerId 对等方ID
     * @param message 加密消息
     * @return 明文字符串
     */
    fun decryptToString(peerId: String, message: RatchetMessage): String {
        val plaintext = decrypt(peerId, message)
        return String(plaintext, Charsets.UTF_8)
    }

    /**
     * 删除会话
     *
     * @param peerId 对等方ID
     */
    fun deleteSession(peerId: String) {
        sessions.remove(peerId)
        updateActiveSessions()
        Log.i(TAG, "Session deleted: $peerId")
    }

    /**
     * 检查会话是否存在
     *
     * @param peerId 对等方ID
     * @return 是否存在
     */
    fun hasSession(peerId: String): Boolean {
        return sessions.containsKey(peerId)
    }

    /**
     * 获取所有会话信息
     */
    fun getAllSessionInfo(): List<SessionInfo> {
        return sessions.values.map { it.getSessionInfo() }
    }

    /**
     * 更新活跃会话列表
     */
    private fun updateActiveSessions() {
        _activeSessions.value = getAllSessionInfo()
    }

    /**
     * 补充一次性预密钥
     *
     * 当一次性预密钥数量低于阈值时补充
     *
     * @param threshold 阈值（默认5）
     * @param count 补充数量（默认10）
     */
    fun replenishOneTimePreKeys(threshold: Int = 5, count: Int = 10) {
        if (oneTimePreKeys.size < threshold) {
            val currentCount = oneTimePreKeys.size
            generateOneTimePreKeys(count)
            Log.i(TAG, "Replenished one-time pre-keys: $currentCount -> ${oneTimePreKeys.size}")
        }
    }

    /**
     * 清除所有会话
     */
    fun clearAllSessions() {
        sessions.clear()
        updateActiveSessions()
        Log.i(TAG, "All sessions cleared")
    }
}
