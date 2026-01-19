package com.chainlesschain.android.core.e2ee.session

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import com.chainlesschain.android.core.e2ee.protocol.PreKeyBundle
import com.chainlesschain.android.core.e2ee.protocol.RatchetMessage
import com.chainlesschain.android.core.e2ee.rotation.PreKeyRotationManager
import com.chainlesschain.android.core.e2ee.storage.SessionStorage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 持久化会话管理器
 *
 * 管理所有端到端加密会话，支持持久化、恢复和自动轮转
 */
@Singleton
class PersistentSessionManager @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        private const val TAG = "PersistentSessionManager"
    }

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val sessionStorage = SessionStorage(context)

    // 当前设备的密钥对
    private lateinit var identityKeyPair: X25519KeyPair
    private lateinit var signedPreKeyPair: X25519KeyPair
    private val oneTimePreKeys = mutableMapOf<String, X25519KeyPair>()

    // 活跃会话
    private val sessions = mutableMapOf<String, E2EESession>()
    private val _activeSessions = MutableStateFlow<List<SessionInfo>>(emptyList())
    val activeSessions: StateFlow<List<SessionInfo>> = _activeSessions.asStateFlow()

    // 预密钥轮转管理器
    private val rotationManager = PreKeyRotationManager(
        onSignedPreKeyRotation = { newSignedPreKeyPair ->
            handleSignedPreKeyRotation(newSignedPreKeyPair)
        },
        onOneTimePreKeysGeneration = { count ->
            handleOneTimePreKeysGeneration(count)
        },
        onOneTimePreKeysCleanup = {
            handleOneTimePreKeysCleanup()
        }
    )

    private var isInitialized = false

    /**
     * 初始化会话管理器
     *
     * @param autoRestore 是否自动恢复保存的会话
     * @param enableRotation 是否启用自动轮转
     */
    suspend fun initialize(
        autoRestore: Boolean = true,
        enableRotation: Boolean = true
    ) = withContext(Dispatchers.IO) {
        if (isInitialized) {
            Log.w(TAG, "Session manager already initialized")
            return@withContext
        }

        Log.i(TAG, "Initializing persistent session manager")

        try {
            // 尝试加载保存的密钥
            val savedKeys = sessionStorage.loadIdentityKeys()

            if (savedKeys != null) {
                Log.d(TAG, "Loaded saved identity keys")
                identityKeyPair = savedKeys.first
                signedPreKeyPair = savedKeys.second
            } else {
                Log.d(TAG, "Generating new identity keys")
                identityKeyPair = X25519KeyPair.generate()
                signedPreKeyPair = X25519KeyPair.generate()

                // 保存新生成的密钥
                sessionStorage.saveIdentityKeys(identityKeyPair, signedPreKeyPair)
            }

            // 加载一次性预密钥
            val savedPreKeys = sessionStorage.loadOneTimePreKeys()
            oneTimePreKeys.clear()
            oneTimePreKeys.putAll(savedPreKeys)

            // 补充一次性预密钥
            if (oneTimePreKeys.size < 5) {
                generateOneTimePreKeys(20)
                sessionStorage.saveOneTimePreKeys(oneTimePreKeys)
            }

            Log.d(TAG, "Loaded ${oneTimePreKeys.size} one-time pre-keys")

            // 自动恢复会话
            if (autoRestore) {
                restoreAllSessions()
            }

            // 启动预密钥轮转
            if (enableRotation) {
                rotationManager.start()
            }

            isInitialized = true

            Log.i(TAG, "Persistent session manager initialized")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize session manager", e)
            throw e
        }
    }

    /**
     * 关闭会话管理器
     */
    fun shutdown() {
        Log.i(TAG, "Shutting down persistent session manager")

        rotationManager.release()
        scope.cancel()

        isInitialized = false

        Log.i(TAG, "Persistent session manager shut down")
    }

    /**
     * 恢复所有保存的会话
     */
    private suspend fun restoreAllSessions() = withContext(Dispatchers.IO) {
        try {
            val sessionIds = sessionStorage.getAllSessionIds()
            Log.i(TAG, "Restoring ${sessionIds.size} saved sessions")

            var restoredCount = 0

            for (peerId in sessionIds) {
                try {
                    val sessionData = sessionStorage.loadSession(peerId)
                    if (sessionData != null) {
                        val (ratchetState, associatedData) = sessionData
                        val session = E2EESession.restore(peerId, ratchetState, associatedData)
                        sessions[peerId] = session
                        restoredCount++
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to restore session for peer: $peerId", e)
                }
            }

            updateActiveSessions()

            Log.i(TAG, "Restored $restoredCount sessions")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to restore sessions", e)
        }
    }

    /**
     * 生成一次性预密钥
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
     */
    fun getPreKeyBundle(): PreKeyBundle {
        val oneTimePreKeyPair = oneTimePreKeys.values.firstOrNull()

        return com.chainlesschain.android.core.e2ee.protocol.X3DHKeyExchange.generatePreKeyBundle(
            identityKeyPair,
            signedPreKeyPair,
            oneTimePreKeyPair
        )
    }

    /**
     * 消费一次性预密钥
     */
    private fun consumeOneTimePreKey(publicKey: ByteArray?): X25519KeyPair? {
        if (publicKey == null) return null

        val entry = oneTimePreKeys.entries.find {
            it.value.publicKey.contentEquals(publicKey)
        }

        return if (entry != null) {
            oneTimePreKeys.remove(entry.key)
            Log.d(TAG, "Consumed one-time pre-key: ${entry.key}")

            // 异步保存更新后的预密钥
            scope.launch {
                try {
                    sessionStorage.saveOneTimePreKeys(oneTimePreKeys)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to save one-time pre-keys", e)
                }
            }

            entry.value
        } else {
            null
        }
    }

    /**
     * 创建会话（作为发起方）
     */
    suspend fun createSession(
        peerId: String,
        peerPreKeyBundle: PreKeyBundle
    ): Pair<E2EESession, InitialMessage> = withContext(Dispatchers.IO) {
        Log.i(TAG, "Creating session with peer: $peerId")

        val (session, initialMessage) = E2EESession.initializeAsInitiator(
            peerId,
            identityKeyPair,
            peerPreKeyBundle
        )

        sessions[peerId] = session
        updateActiveSessions()

        // 保存会话
        try {
            sessionStorage.saveSession(
                peerId,
                session,
                session.getRatchetState(),
                session.getAssociatedData()
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save session", e)
        }

        Log.i(TAG, "Session created with peer: $peerId")

        Pair(session, initialMessage)
    }

    /**
     * 接受会话（作为响应方）
     */
    suspend fun acceptSession(
        peerId: String,
        initialMessage: InitialMessage
    ): E2EESession = withContext(Dispatchers.IO) {
        Log.i(TAG, "Accepting session from peer: $peerId")

        val oneTimePreKeyPair = if (initialMessage.oneTimePreKeyUsed) {
            consumeOneTimePreKey(null)
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

        // 保存会话
        try {
            sessionStorage.saveSession(
                peerId,
                session,
                session.getRatchetState(),
                session.getAssociatedData()
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save session", e)
        }

        Log.i(TAG, "Session accepted from peer: $peerId")

        session
    }

    /**
     * 获取会话
     */
    fun getSession(peerId: String): E2EESession? {
        return sessions[peerId]
    }

    /**
     * 加密消息
     */
    suspend fun encrypt(peerId: String, plaintext: ByteArray): RatchetMessage = withContext(Dispatchers.IO) {
        val session = sessions[peerId]
            ?: throw IllegalStateException("No session with peer: $peerId")

        val encrypted = session.encrypt(plaintext)

        // 保存更新后的会话状态
        try {
            sessionStorage.saveSession(
                peerId,
                session,
                session.getRatchetState(),
                session.getAssociatedData()
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save session after encryption", e)
        }

        encrypted
    }

    /**
     * 加密文本消息
     */
    suspend fun encrypt(peerId: String, plaintext: String): RatchetMessage {
        return encrypt(peerId, plaintext.toByteArray(Charsets.UTF_8))
    }

    /**
     * 解密消息
     */
    suspend fun decrypt(peerId: String, message: RatchetMessage): ByteArray = withContext(Dispatchers.IO) {
        val session = sessions[peerId]
            ?: throw IllegalStateException("No session with peer: $peerId")

        val decrypted = session.decrypt(message)

        // 保存更新后的会话状态
        try {
            sessionStorage.saveSession(
                peerId,
                session,
                session.getRatchetState(),
                session.getAssociatedData()
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save session after decryption", e)
        }

        decrypted
    }

    /**
     * 解密文本消息
     */
    suspend fun decryptToString(peerId: String, message: RatchetMessage): String {
        val plaintext = decrypt(peerId, message)
        return String(plaintext, Charsets.UTF_8)
    }

    /**
     * 删除会话
     */
    suspend fun deleteSession(peerId: String) = withContext(Dispatchers.IO) {
        sessions.remove(peerId)
        updateActiveSessions()

        // 删除持久化的会话
        sessionStorage.deleteSession(peerId)

        Log.i(TAG, "Session deleted: $peerId")
    }

    /**
     * 检查会话是否存在
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
     * 清除所有会话
     */
    suspend fun clearAllSessions() = withContext(Dispatchers.IO) {
        val sessionIds = sessions.keys.toList()

        sessions.clear()
        updateActiveSessions()

        // 删除所有持久化的会话
        for (peerId in sessionIds) {
            sessionStorage.deleteSession(peerId)
        }

        Log.i(TAG, "All sessions cleared")
    }

    /**
     * 处理签名预密钥轮转
     */
    private suspend fun handleSignedPreKeyRotation(newSignedPreKeyPair: X25519KeyPair) {
        Log.i(TAG, "Handling signed pre-key rotation")

        signedPreKeyPair = newSignedPreKeyPair

        // 保存新的签名预密钥
        try {
            sessionStorage.saveIdentityKeys(identityKeyPair, signedPreKeyPair)
            Log.i(TAG, "New signed pre-key saved")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save new signed pre-key", e)
        }
    }

    /**
     * 处理一次性预密钥生成
     */
    private suspend fun handleOneTimePreKeysGeneration(count: Int) {
        Log.i(TAG, "Generating $count new one-time pre-keys")

        generateOneTimePreKeys(count)

        // 保存新生成的预密钥
        try {
            sessionStorage.saveOneTimePreKeys(oneTimePreKeys)
            Log.i(TAG, "New one-time pre-keys saved")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save new one-time pre-keys", e)
        }
    }

    /**
     * 处理一次性预密钥清理
     */
    private suspend fun handleOneTimePreKeysCleanup() {
        Log.i(TAG, "Cleaning up old one-time pre-keys")

        // 简化版：保留最新的20个密钥
        if (oneTimePreKeys.size > 20) {
            val keysToRemove = oneTimePreKeys.size - 20
            val oldestKeys = oneTimePreKeys.keys.take(keysToRemove)

            oldestKeys.forEach { oneTimePreKeys.remove(it) }

            // 保存更新后的预密钥
            try {
                sessionStorage.saveOneTimePreKeys(oneTimePreKeys)
                Log.i(TAG, "Removed $keysToRemove old one-time pre-keys")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to save one-time pre-keys after cleanup", e)
            }
        }
    }

    /**
     * 获取轮转状态
     */
    fun getRotationStatus() = rotationManager.getRotationStatus()

    /**
     * 立即轮转签名预密钥
     */
    suspend fun rotateSignedPreKeyNow() {
        rotationManager.rotateSignedPreKey()
    }
}
