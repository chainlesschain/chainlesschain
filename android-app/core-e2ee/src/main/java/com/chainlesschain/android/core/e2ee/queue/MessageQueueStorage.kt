package com.chainlesschain.android.core.e2ee.queue

import android.content.Context
import timber.log.Timber
import com.chainlesschain.android.core.e2ee.storage.EncryptedStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.io.File

/**
 * 消息队列存储
 *
 * 持久化消息队列，支持应用重启后恢复
 */
class MessageQueueStorage(private val context: Context) {

    companion object {
        private const val STORAGE_DIR = "message_queue"
        private const val OUTGOING_FILE = "outgoing_messages.json"
        private const val INCOMING_FILE = "incoming_messages.json"
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
     * 保存待发送消息队列
     *
     * @param messages 待发送消息列表
     */
    suspend fun saveOutgoingMessages(messages: List<QueuedMessage>) = withContext(Dispatchers.IO) {
        try {
            Timber.d("Saving ${messages.size} outgoing messages")

            val persistentQueue = PersistentMessageQueue(
                messages = messages,
                lastUpdated = System.currentTimeMillis()
            )

            val outgoingFile = File(storageDir, OUTGOING_FILE)
            val encryptedData = encryptQueueData(json.encodeToString(persistentQueue))
            outgoingFile.writeBytes(encryptedData)

            Timber.d("Outgoing messages saved successfully")
        } catch (e: Exception) {
            Timber.e(e, "Failed to save outgoing messages")
            throw e
        }
    }

    /**
     * 加载待发送消息队列
     *
     * @return 待发送消息列表
     */
    suspend fun loadOutgoingMessages(): List<QueuedMessage> = withContext(Dispatchers.IO) {
        try {
            Timber.d("Loading outgoing messages")

            val outgoingFile = File(storageDir, OUTGOING_FILE)
            if (!outgoingFile.exists()) {
                Timber.d("No saved outgoing messages found")
                return@withContext emptyList()
            }

            val encryptedData = outgoingFile.readBytes()
            val decryptedJson = decryptQueueData(encryptedData)
            val persistentQueue = json.decodeFromString<PersistentMessageQueue>(decryptedJson)

            Timber.d("Loaded ${persistentQueue.messages.size} outgoing messages")

            persistentQueue.messages
        } catch (e: Exception) {
            Timber.e(e, "Failed to load outgoing messages")
            emptyList()
        }
    }

    /**
     * 保存待处理消息队列
     *
     * @param messages 待处理消息列表
     */
    suspend fun saveIncomingMessages(messages: List<QueuedMessage>) = withContext(Dispatchers.IO) {
        try {
            Timber.d("Saving ${messages.size} incoming messages")

            val persistentQueue = PersistentMessageQueue(
                messages = messages,
                lastUpdated = System.currentTimeMillis()
            )

            val incomingFile = File(storageDir, INCOMING_FILE)
            val encryptedData = encryptQueueData(json.encodeToString(persistentQueue))
            incomingFile.writeBytes(encryptedData)

            Timber.d("Incoming messages saved successfully")
        } catch (e: Exception) {
            Timber.e(e, "Failed to save incoming messages")
            throw e
        }
    }

    /**
     * 加载待处理消息队列
     *
     * @return 待处理消息列表
     */
    suspend fun loadIncomingMessages(): List<QueuedMessage> = withContext(Dispatchers.IO) {
        try {
            Timber.d("Loading incoming messages")

            val incomingFile = File(storageDir, INCOMING_FILE)
            if (!incomingFile.exists()) {
                Timber.d("No saved incoming messages found")
                return@withContext emptyList()
            }

            val encryptedData = incomingFile.readBytes()
            val decryptedJson = decryptQueueData(encryptedData)
            val persistentQueue = json.decodeFromString<PersistentMessageQueue>(decryptedJson)

            Timber.d("Loaded ${persistentQueue.messages.size} incoming messages")

            persistentQueue.messages
        } catch (e: Exception) {
            Timber.e(e, "Failed to load incoming messages")
            emptyList()
        }
    }

    /**
     * 清除所有持久化消息
     */
    suspend fun clearAll() = withContext(Dispatchers.IO) {
        try {
            Timber.i("Clearing all persisted messages")

            File(storageDir, OUTGOING_FILE).delete()
            File(storageDir, INCOMING_FILE).delete()

            Timber.i("All persisted messages cleared")
        } catch (e: Exception) {
            Timber.e(e, "Failed to clear persisted messages")
        }
    }

    /**
     * 加密队列数据
     */
    private fun encryptQueueData(data: String): ByteArray {
        return EncryptedStorage.encrypt(context, data.toByteArray(Charsets.UTF_8))
    }

    /**
     * 解密队列数据
     */
    private fun decryptQueueData(encryptedData: ByteArray): String {
        val decrypted = EncryptedStorage.decrypt(context, encryptedData)
        return String(decrypted, Charsets.UTF_8)
    }
}

/**
 * 持久化消息队列
 */
@Serializable
data class PersistentMessageQueue(
    val messages: List<QueuedMessage>,
    val lastUpdated: Long
)
