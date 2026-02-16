package com.chainlesschain.android.core.e2ee.recall

import timber.log.Timber
import com.chainlesschain.android.core.e2ee.protocol.RatchetMessage
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

/**
 * 消息撤回管理器
 *
 * 管理加密的消息撤回请求和响应
 */
class MessageRecallManager(
    private val encryptCallback: suspend (peerId: String, data: ByteArray) -> RatchetMessage,
    private val decryptCallback: suspend (peerId: String, message: RatchetMessage) -> ByteArray,
    private val policy: RecallPolicy = RecallPolicy.DEFAULT
) {

    private val json = Json {
        ignoreUnknownKeys = true
    }

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // 消息撤回状态
    private val recallStatuses = mutableMapOf<String, MutableMap<String, MessageRecallStatus>>()
    private val mutex = Mutex()

    // 撤回事件流
    private val _recallEvents = MutableStateFlow<RecallEvent?>(null)
    val recallEvents: StateFlow<RecallEvent?> = _recallEvents.asStateFlow()

    // 待处理的撤回超时任务
    private val timeoutJobs = mutableMapOf<String, Job>()

    /**
     * 请求撤回消息
     *
     * @param peerId 对等方ID
     * @param messageId 消息ID
     * @param messageSentAt 消息发送时间
     * @param isRead 消息是否已读
     * @param reason 撤回原因
     * @param replacementText 替换文本
     * @return 是否成功发起撤回
     */
    suspend fun recallMessage(
        peerId: String,
        messageId: String,
        messageSentAt: Long,
        isRead: Boolean,
        reason: RecallReason = RecallReason.USER_REQUEST,
        replacementText: String? = null
    ): Boolean {
        Timber.d("Requesting recall for message: $messageId")

        // 检查是否可以撤回
        if (!policy.canRecall(messageSentAt, isRead)) {
            Timber.w("Cannot recall message: policy restriction")
            _recallEvents.value = RecallEvent.Failed(peerId, messageId, "Cannot recall: policy restriction")
            return false
        }

        // 创建撤回请求
        val request = MessageRecallRequest.create(messageId, reason, replacementText)

        // 记录撤回状态
        val status = MessageRecallStatus(
            messageId = messageId,
            status = RecallStatus.PENDING,
            requestedAt = System.currentTimeMillis(),
            reason = reason,
            replacementText = replacementText
        )

        mutex.withLock {
            val peerStatuses = recallStatuses.getOrPut(peerId) { mutableMapOf() }
            peerStatuses[messageId] = status
        }

        // 发送撤回请求
        try {
            sendRecallRequest(peerId, request)

            // 启动超时任务
            startTimeoutJob(peerId, messageId)

            // 触发事件
            _recallEvents.value = RecallEvent.Requested(peerId, messageId)

            Timber.d("Recall request sent for message: $messageId")
            return true
        } catch (e: Exception) {
            Timber.e(e, "Failed to send recall request")

            // 更新状态为失败
            updateRecallStatus(peerId, messageId, RecallStatus.FAILED, "Failed to send request: ${e.message}")

            return false
        }
    }

    /**
     * 处理接收到的撤回请求
     *
     * @param peerId 对等方ID
     * @param encryptedRequest 加密的撤回请求
     * @param messageCallback 消息处理回调（返回消息发送时间和是否已读）
     */
    suspend fun handleRecallRequest(
        peerId: String,
        encryptedRequest: RatchetMessage,
        messageCallback: suspend (messageId: String) -> Pair<Long, Boolean>?
    ) {
        try {
            // 解密撤回请求
            val decryptedData = decryptCallback(peerId, encryptedRequest)
            val requestJson = String(decryptedData, Charsets.UTF_8)
            val request = json.decodeFromString<MessageRecallRequest>(requestJson)

            Timber.d("Received recall request for message: ${request.messageId}")

            // 获取消息信息
            val messageInfo = messageCallback(request.messageId)

            val response = if (messageInfo == null) {
                // 消息不存在
                MessageRecallResponse.failure(request.messageId, "Message not found")
            } else {
                val (messageSentAt, isRead) = messageInfo

                // 检查是否可以撤回
                if (policy.canRecall(messageSentAt, isRead)) {
                    // 执行撤回
                    executeRecall(peerId, request.messageId, request)

                    MessageRecallResponse.success(request.messageId)
                } else {
                    MessageRecallResponse.failure(request.messageId, "Cannot recall: policy restriction")
                }
            }

            // 发送响应
            sendRecallResponse(peerId, response)

            if (response.success) {
                // 触发撤回事件
                _recallEvents.value = RecallEvent.Recalled(peerId, request.messageId, request.replacementText)
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to handle recall request")
        }
    }

    /**
     * 处理接收到的撤回响应
     *
     * @param peerId 对等方ID
     * @param encryptedResponse 加密的撤回响应
     */
    suspend fun handleRecallResponse(
        peerId: String,
        encryptedResponse: RatchetMessage
    ) {
        try {
            // 解密撤回响应
            val decryptedData = decryptCallback(peerId, encryptedResponse)
            val responseJson = String(decryptedData, Charsets.UTF_8)
            val response = json.decodeFromString<MessageRecallResponse>(responseJson)

            Timber.d("Received recall response for message: ${response.messageId}, success: ${response.success}")

            // 取消超时任务
            cancelTimeoutJob("${peerId}_${response.messageId}")

            if (response.success) {
                // 更新状态为已撤回
                updateRecallStatus(peerId, response.messageId, RecallStatus.RECALLED)

                // 触发事件
                _recallEvents.value = RecallEvent.Confirmed(peerId, response.messageId)
            } else {
                // 更新状态为失败
                updateRecallStatus(peerId, response.messageId, RecallStatus.FAILED, response.failureReason)

                // 触发事件
                _recallEvents.value = RecallEvent.Failed(peerId, response.messageId, response.failureReason ?: "Unknown error")
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to handle recall response")
        }
    }

    /**
     * 获取消息的撤回状态
     *
     * @param peerId 对等方ID
     * @param messageId 消息ID
     * @return 撤回状态
     */
    suspend fun getRecallStatus(peerId: String, messageId: String): MessageRecallStatus? = mutex.withLock {
        recallStatuses[peerId]?.get(messageId)
    }

    /**
     * 检查消息是否已撤回
     *
     * @param peerId 对等方ID
     * @param messageId 消息ID
     * @return 是否已撤回
     */
    suspend fun isRecalled(peerId: String, messageId: String): Boolean {
        val status = getRecallStatus(peerId, messageId)
        return status?.isRecalled == true
    }

    /**
     * 清除对等方的撤回状态
     *
     * @param peerId 对等方ID
     */
    suspend fun clearRecallStatuses(peerId: String) = mutex.withLock {
        recallStatuses.remove(peerId)
        Timber.i("Cleared recall statuses for peer: $peerId")
    }

    /**
     * 清除所有撤回状态
     */
    suspend fun clearAll() = mutex.withLock {
        recallStatuses.clear()
        // 取消所有超时任务
        timeoutJobs.values.forEach { it.cancel() }
        timeoutJobs.clear()
        Timber.i("Cleared all recall statuses")
    }

    /**
     * 释放资源
     */
    fun release() {
        scope.cancel()
    }

    /**
     * 执行撤回
     */
    private suspend fun executeRecall(peerId: String, messageId: String, request: MessageRecallRequest) {
        Timber.d("Executing recall for message: $messageId")

        // 记录撤回状态（如果配置保留记录）
        if (policy.keepRecallRecord) {
            val status = MessageRecallStatus(
                messageId = messageId,
                status = RecallStatus.RECALLED,
                requestedAt = request.timestamp,
                reason = request.reason,
                replacementText = request.replacementText,
                confirmedAt = System.currentTimeMillis()
            )

            mutex.withLock {
                val peerStatuses = recallStatuses.getOrPut(peerId) { mutableMapOf() }
                peerStatuses[messageId] = status
            }
        }
    }

    /**
     * 更新撤回状态
     */
    private suspend fun updateRecallStatus(
        peerId: String,
        messageId: String,
        status: RecallStatus,
        failureReason: String? = null
    ) = mutex.withLock {
        val peerStatuses = recallStatuses[peerId]
        val recallStatus = peerStatuses?.get(messageId)

        if (recallStatus != null) {
            recallStatus.status = status
            if (failureReason != null) {
                recallStatus.failureReason = failureReason
            }
            if (status == RecallStatus.RECALLED) {
                recallStatus.confirmedAt = System.currentTimeMillis()
            }
        }
    }

    /**
     * 发送撤回请求
     */
    private suspend fun sendRecallRequest(peerId: String, request: MessageRecallRequest) {
        val requestJson = json.encodeToString(request)
        val requestData = requestJson.toByteArray(Charsets.UTF_8)
        val encryptedRequest = encryptCallback(peerId, requestData)

        // 实际发送由调用方处理
        Timber.d("Encrypted recall request for message: ${request.messageId}")
    }

    /**
     * 发送撤回响应
     */
    private suspend fun sendRecallResponse(peerId: String, response: MessageRecallResponse) {
        val responseJson = json.encodeToString(response)
        val responseData = responseJson.toByteArray(Charsets.UTF_8)
        val encryptedResponse = encryptCallback(peerId, responseData)

        // 实际发送由调用方处理
        Timber.d("Encrypted recall response for message: ${response.messageId}")
    }

    /**
     * 启动超时任务
     */
    private fun startTimeoutJob(peerId: String, messageId: String) {
        val jobKey = "${peerId}_${messageId}"

        val job = scope.launch {
            delay(policy.recallTimeout)

            // 超时，更新状态
            updateRecallStatus(peerId, messageId, RecallStatus.EXPIRED)

            // 触发事件
            _recallEvents.value = RecallEvent.Timeout(peerId, messageId)

            Timber.w("Recall timeout for message: $messageId")
        }

        timeoutJobs[jobKey] = job
    }

    /**
     * 取消超时任务
     */
    private fun cancelTimeoutJob(jobKey: String) {
        timeoutJobs.remove(jobKey)?.cancel()
    }

    /**
     * 获取统计信息
     */
    suspend fun getStatistics(peerId: String): RecallStatistics = mutex.withLock {
        val statuses = recallStatuses[peerId]?.values ?: emptyList()

        RecallStatistics(
            totalRecalls = statuses.size,
            successfulRecalls = statuses.count { it.status == RecallStatus.RECALLED },
            failedRecalls = statuses.count { it.status == RecallStatus.FAILED },
            expiredRecalls = statuses.count { it.status == RecallStatus.EXPIRED }
        )
    }
}

/**
 * 撤回事件
 */
sealed class RecallEvent {
    abstract val peerId: String
    abstract val messageId: String

    /** 撤回请求已发送 */
    data class Requested(override val peerId: String, override val messageId: String) : RecallEvent()

    /** 撤回已确认 */
    data class Confirmed(override val peerId: String, override val messageId: String) : RecallEvent()

    /** 消息已被撤回 */
    data class Recalled(override val peerId: String, override val messageId: String, val replacementText: String?) : RecallEvent()

    /** 撤回失败 */
    data class Failed(override val peerId: String, override val messageId: String, val reason: String) : RecallEvent()

    /** 撤回超时 */
    data class Timeout(override val peerId: String, override val messageId: String) : RecallEvent()
}

/**
 * 撤回统计信息
 */
data class RecallStatistics(
    val totalRecalls: Int,
    val successfulRecalls: Int,
    val failedRecalls: Int,
    val expiredRecalls: Int
) {
    val successRate: Float
        get() = if (totalRecalls > 0) successfulRecalls.toFloat() / totalRecalls else 0f
}
