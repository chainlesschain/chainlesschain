package com.chainlesschain.android.core.e2ee.storage

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import com.chainlesschain.android.core.e2ee.protocol.DoubleRatchet
import com.chainlesschain.android.core.e2ee.protocol.MessageHeader
import com.chainlesschain.android.core.e2ee.session.E2EESession
import com.chainlesschain.android.core.e2ee.session.InitialMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.io.File

/**
 * 会话存储
 *
 * 负责持久化和恢复 E2EE 会话状态
 */
class SessionStorage(private val context: Context) {

    companion object {
        private const val TAG = "SessionStorage"
        private const val STORAGE_DIR = "e2ee_sessions"
        private const val SESSION_FILE_SUFFIX = ".session"
        private const val IDENTITY_FILE = "identity_keys.json"
        private const val PRE_KEYS_FILE = "pre_keys.json"
    }

    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
    }

    private val storageDir: File by lazy {
        File(context.filesDir, STORAGE_DIR).apply {
            if (!exists()) {
                mkdirs()
            }
        }
    }

    /**
     * 保存会话状态
     *
     * @param peerId 对等方ID
     * @param session 会话实例
     * @param ratchetState Ratchet 状态
     * @param associatedData 关联数据
     */
    suspend fun saveSession(
        peerId: String,
        session: E2EESession,
        ratchetState: DoubleRatchet.RatchetState,
        associatedData: ByteArray
    ) = withContext(Dispatchers.IO) {
        try {
            Log.d(TAG, "Saving session for peer: $peerId")

            val persistentSession = PersistentSession(
                peerId = peerId,
                ratchetState = serializeRatchetState(ratchetState),
                associatedData = associatedData,
                lastUpdated = System.currentTimeMillis()
            )

            val sessionFile = File(storageDir, "${peerId}${SESSION_FILE_SUFFIX}")
            val encryptedData = encryptSessionData(json.encodeToString(persistentSession))
            sessionFile.writeBytes(encryptedData)

            Log.d(TAG, "Session saved successfully for peer: $peerId")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save session for peer: $peerId", e)
            throw e
        }
    }

    /**
     * 加载会话状态
     *
     * @param peerId 对等方ID
     * @return (Ratchet状态, 关联数据) 或 null
     */
    suspend fun loadSession(
        peerId: String
    ): Pair<DoubleRatchet.RatchetState, ByteArray>? = withContext(Dispatchers.IO) {
        try {
            Log.d(TAG, "Loading session for peer: $peerId")

            val sessionFile = File(storageDir, "${peerId}${SESSION_FILE_SUFFIX}")
            if (!sessionFile.exists()) {
                Log.d(TAG, "No saved session found for peer: $peerId")
                return@withContext null
            }

            val encryptedData = sessionFile.readBytes()
            val decryptedJson = decryptSessionData(encryptedData)
            val persistentSession = json.decodeFromString<PersistentSession>(decryptedJson)

            val ratchetState = deserializeRatchetState(persistentSession.ratchetState)

            Log.d(TAG, "Session loaded successfully for peer: $peerId")

            Pair(ratchetState, persistentSession.associatedData)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load session for peer: $peerId", e)
            null
        }
    }

    /**
     * 删除会话
     *
     * @param peerId 对等方ID
     */
    suspend fun deleteSession(peerId: String): Unit = withContext(Dispatchers.IO) {
        try {
            Log.d(TAG, "Deleting session for peer: $peerId")

            val sessionFile = File(storageDir, "${peerId}${SESSION_FILE_SUFFIX}")
            if (sessionFile.exists()) {
                sessionFile.delete()
                Log.d(TAG, "Session deleted for peer: $peerId")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to delete session for peer: $peerId", e)
        }
    }

    /**
     * 获取所有已保存的会话 ID
     */
    suspend fun getAllSessionIds(): List<String> = withContext(Dispatchers.IO) {
        try {
            storageDir.listFiles()
                ?.filter { it.name.endsWith(SESSION_FILE_SUFFIX) }
                ?.map { it.name.removeSuffix(SESSION_FILE_SUFFIX) }
                ?: emptyList()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to list sessions", e)
            emptyList()
        }
    }

    /**
     * 保存身份密钥对
     */
    suspend fun saveIdentityKeys(
        identityKeyPair: X25519KeyPair,
        signedPreKeyPair: X25519KeyPair
    ) = withContext(Dispatchers.IO) {
        try {
            Log.d(TAG, "Saving identity keys")

            val identityKeys = IdentityKeys(
                identityPublicKey = identityKeyPair.publicKey,
                identityPrivateKey = identityKeyPair.privateKey,
                signedPreKeyPublic = signedPreKeyPair.publicKey,
                signedPreKeyPrivate = signedPreKeyPair.privateKey,
                lastRotated = System.currentTimeMillis()
            )

            val identityFile = File(storageDir, IDENTITY_FILE)
            val encryptedData = encryptSessionData(json.encodeToString(identityKeys))
            identityFile.writeBytes(encryptedData)

            Log.d(TAG, "Identity keys saved successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save identity keys", e)
            throw e
        }
    }

    /**
     * 加载身份密钥对
     */
    suspend fun loadIdentityKeys(): Pair<X25519KeyPair, X25519KeyPair>? = withContext(Dispatchers.IO) {
        try {
            Log.d(TAG, "Loading identity keys")

            val identityFile = File(storageDir, IDENTITY_FILE)
            if (!identityFile.exists()) {
                Log.d(TAG, "No saved identity keys found")
                return@withContext null
            }

            val encryptedData = identityFile.readBytes()
            val decryptedJson = decryptSessionData(encryptedData)
            val identityKeys = json.decodeFromString<IdentityKeys>(decryptedJson)

            val identityKeyPair = X25519KeyPair(
                identityKeys.identityPublicKey,
                identityKeys.identityPrivateKey
            )
            val signedPreKeyPair = X25519KeyPair(
                identityKeys.signedPreKeyPublic,
                identityKeys.signedPreKeyPrivate
            )

            Log.d(TAG, "Identity keys loaded successfully")

            Pair(identityKeyPair, signedPreKeyPair)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load identity keys", e)
            null
        }
    }

    /**
     * 保存一次性预密钥
     */
    suspend fun saveOneTimePreKeys(
        preKeys: Map<String, X25519KeyPair>
    ) = withContext(Dispatchers.IO) {
        try {
            Log.d(TAG, "Saving ${preKeys.size} one-time pre-keys")

            val preKeysList = preKeys.map { (id, keyPair) ->
                PreKeyEntry(id, keyPair.publicKey, keyPair.privateKey)
            }

            val preKeysData = PreKeysData(preKeysList)

            val preKeysFile = File(storageDir, PRE_KEYS_FILE)
            val encryptedData = encryptSessionData(json.encodeToString(preKeysData))
            preKeysFile.writeBytes(encryptedData)

            Log.d(TAG, "One-time pre-keys saved successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save one-time pre-keys", e)
            throw e
        }
    }

    /**
     * 加载一次性预密钥
     */
    suspend fun loadOneTimePreKeys(): Map<String, X25519KeyPair> = withContext(Dispatchers.IO) {
        try {
            Log.d(TAG, "Loading one-time pre-keys")

            val preKeysFile = File(storageDir, PRE_KEYS_FILE)
            if (!preKeysFile.exists()) {
                Log.d(TAG, "No saved one-time pre-keys found")
                return@withContext emptyMap()
            }

            val encryptedData = preKeysFile.readBytes()
            val decryptedJson = decryptSessionData(encryptedData)
            val preKeysData = json.decodeFromString<PreKeysData>(decryptedJson)

            val preKeys = preKeysData.keys.associate { entry ->
                entry.id to X25519KeyPair(entry.publicKey, entry.privateKey)
            }

            Log.d(TAG, "Loaded ${preKeys.size} one-time pre-keys")

            preKeys
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load one-time pre-keys", e)
            emptyMap()
        }
    }

    /**
     * 序列化 Ratchet 状态
     */
    private fun serializeRatchetState(state: DoubleRatchet.RatchetState): SerializedRatchetState {
        return SerializedRatchetState(
            rootKey = state.rootKey,
            sendChainKey = state.sendChainKey,
            receiveChainKey = state.receiveChainKey,
            sendRatchetPublicKey = state.sendRatchetKeyPair.publicKey,
            sendRatchetPrivateKey = state.sendRatchetKeyPair.privateKey,
            receiveRatchetKey = state.receiveRatchetKey,
            sendMessageNumber = state.sendMessageNumber,
            receiveMessageNumber = state.receiveMessageNumber,
            previousSendChainLength = state.previousSendChainLength,
            skippedMessageKeys = state.skippedMessageKeys.map { (header, key) ->
                SkippedMessageKey(
                    publicKey = header.ratchetKey,
                    messageNumber = header.messageNumber,
                    messageKey = key
                )
            }
        )
    }

    /**
     * 反序列化 Ratchet 状态
     */
    private fun deserializeRatchetState(serialized: SerializedRatchetState): DoubleRatchet.RatchetState {
        val sendRatchetKeyPair = X25519KeyPair(
            serialized.sendRatchetPublicKey,
            serialized.sendRatchetPrivateKey
        )

        val skippedMessageKeys = serialized.skippedMessageKeys.associate { skipped ->
            val keyId = DoubleRatchet.MessageKeyId(
                ratchetKey = skipped.publicKey,
                messageNumber = skipped.messageNumber
            )
            Pair(keyId, skipped.messageKey)
        }.toMutableMap()

        return DoubleRatchet.RatchetState(
            rootKey = serialized.rootKey,
            sendChainKey = serialized.sendChainKey,
            receiveChainKey = serialized.receiveChainKey,
            sendRatchetKeyPair = sendRatchetKeyPair,
            receiveRatchetKey = serialized.receiveRatchetKey,
            sendMessageNumber = serialized.sendMessageNumber,
            receiveMessageNumber = serialized.receiveMessageNumber,
            previousSendChainLength = serialized.previousSendChainLength,
            skippedMessageKeys = skippedMessageKeys
        )
    }

    /**
     * 加密会话数据
     *
     * 使用 Android Keystore 派生的密钥加密
     */
    private fun encryptSessionData(data: String): ByteArray {
        // 简化版：使用设备绑定的加密
        // 实际应使用 Android Keystore + AES-GCM
        return EncryptedStorage.encrypt(context, data.toByteArray(Charsets.UTF_8))
    }

    /**
     * 解密会话数据
     */
    private fun decryptSessionData(encryptedData: ByteArray): String {
        val decrypted = EncryptedStorage.decrypt(context, encryptedData)
        return String(decrypted, Charsets.UTF_8)
    }
}

/**
 * 持久化会话数据
 */
@Serializable
data class PersistentSession(
    val peerId: String,
    val ratchetState: SerializedRatchetState,
    val associatedData: ByteArray,
    val lastUpdated: Long
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as PersistentSession

        if (peerId != other.peerId) return false
        if (ratchetState != other.ratchetState) return false
        if (!associatedData.contentEquals(other.associatedData)) return false
        if (lastUpdated != other.lastUpdated) return false

        return true
    }

    override fun hashCode(): Int {
        var result = peerId.hashCode()
        result = 31 * result + ratchetState.hashCode()
        result = 31 * result + associatedData.contentHashCode()
        result = 31 * result + lastUpdated.hashCode()
        return result
    }
}

/**
 * 序列化的 Ratchet 状态
 */
@Serializable
data class SerializedRatchetState(
    val rootKey: ByteArray,
    val sendChainKey: ByteArray,
    val receiveChainKey: ByteArray,
    val sendRatchetPublicKey: ByteArray,
    val sendRatchetPrivateKey: ByteArray,
    val receiveRatchetKey: ByteArray,
    val sendMessageNumber: Int,
    val receiveMessageNumber: Int,
    val previousSendChainLength: Int,
    val skippedMessageKeys: List<SkippedMessageKey>
)

/**
 * 跳过的消息密钥
 */
@Serializable
data class SkippedMessageKey(
    val publicKey: ByteArray,
    val messageNumber: Int,
    val messageKey: ByteArray
)

/**
 * 身份密钥
 */
@Serializable
data class IdentityKeys(
    val identityPublicKey: ByteArray,
    val identityPrivateKey: ByteArray,
    val signedPreKeyPublic: ByteArray,
    val signedPreKeyPrivate: ByteArray,
    val lastRotated: Long
)

/**
 * 预密钥数据
 */
@Serializable
data class PreKeysData(
    val keys: List<PreKeyEntry>
)

/**
 * 预密钥条目
 */
@Serializable
data class PreKeyEntry(
    val id: String,
    val publicKey: ByteArray,
    val privateKey: ByteArray
)
