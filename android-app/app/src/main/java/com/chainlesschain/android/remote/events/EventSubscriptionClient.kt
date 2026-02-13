package com.chainlesschain.android.remote.events

import com.chainlesschain.android.remote.client.RemoteCommandClient
import com.chainlesschain.android.remote.data.EventNotification
import com.chainlesschain.android.remote.data.FileTransferProgress
import com.chainlesschain.android.remote.data.ProgressNotification
import com.chainlesschain.android.remote.p2p.P2PClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import timber.log.Timber
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 事件订阅客户端
 *
 * 提供事件订阅和管理的高级 API
 */
@Singleton
class EventSubscriptionClient @Inject constructor(
    private val p2pClient: P2PClient,
    private val commandClient: RemoteCommandClient
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val subscriptions = ConcurrentHashMap<String, EventSubscriptionInfo>()
    private var eventCollectorJob: Job? = null

    // 分类事件流
    private val _fileEvents = MutableSharedFlow<EventNotification>(extraBufferCapacity = 32)
    val fileEvents: SharedFlow<EventNotification> = _fileEvents.asSharedFlow()

    private val _aiEvents = MutableSharedFlow<EventNotification>(extraBufferCapacity = 32)
    val aiEvents: SharedFlow<EventNotification> = _aiEvents.asSharedFlow()

    private val _mediaEvents = MutableSharedFlow<EventNotification>(extraBufferCapacity = 32)
    val mediaEvents: SharedFlow<EventNotification> = _mediaEvents.asSharedFlow()

    private val _systemEvents = MutableSharedFlow<EventNotification>(extraBufferCapacity = 32)
    val systemEvents: SharedFlow<EventNotification> = _systemEvents.asSharedFlow()

    private val _networkEvents = MutableSharedFlow<EventNotification>(extraBufferCapacity = 32)
    val networkEvents: SharedFlow<EventNotification> = _networkEvents.asSharedFlow()

    private val _browserEvents = MutableSharedFlow<EventNotification>(extraBufferCapacity = 32)
    val browserEvents: SharedFlow<EventNotification> = _browserEvents.asSharedFlow()

    private val _workflowEvents = MutableSharedFlow<EventNotification>(extraBufferCapacity = 32)
    val workflowEvents: SharedFlow<EventNotification> = _workflowEvents.asSharedFlow()

    init {
        startEventClassifier()
    }

    /**
     * 启动事件分类器
     */
    private fun startEventClassifier() {
        eventCollectorJob?.cancel()
        eventCollectorJob = scope.launch {
            p2pClient.events.collect { event ->
                classifyAndEmitEvent(event)
            }
        }
    }

    /**
     * 分类并发送事件到对应的流
     */
    private suspend fun classifyAndEmitEvent(event: EventNotification) {
        val method = event.method
        when {
            method.startsWith("file.") -> _fileEvents.emit(event)
            method.startsWith("ai.") -> _aiEvents.emit(event)
            method.startsWith("media.") -> _mediaEvents.emit(event)
            method.startsWith("system.") || method.startsWith("process.") -> _systemEvents.emit(event)
            method.startsWith("network.") || method.startsWith("wifi.") -> _networkEvents.emit(event)
            method.startsWith("browser.") || method.startsWith("tab.") -> _browserEvents.emit(event)
            method.startsWith("workflow.") -> _workflowEvents.emit(event)
        }

        // 通知所有匹配的订阅
        subscriptions.values.forEach { sub ->
            if (sub.matches(event)) {
                sub.callback(event)
            }
        }
    }

    /**
     * 订阅事件
     *
     * @param eventTypes 要订阅的事件类型列表
     * @param filters 过滤条件
     * @param callback 事件回调
     * @return 订阅 ID
     */
    suspend fun subscribe(
        eventTypes: List<String>,
        filters: Map<String, Any> = emptyMap(),
        callback: suspend (EventNotification) -> Unit
    ): Result<String> {
        return try {
            val subscriptionId = "sub-${System.currentTimeMillis()}-${(Math.random() * 100000).toInt()}"

            // 向服务器注册订阅
            val params = mutableMapOf<String, Any>(
                "subscriptionId" to subscriptionId,
                "eventTypes" to eventTypes
            )
            if (filters.isNotEmpty()) {
                params["filters"] = filters
            }

            val result = commandClient.invoke<Map<String, Any>>("events.subscribe", params)

            if (result.isFailure) {
                return Result.failure(result.exceptionOrNull() ?: Exception("Subscribe failed"))
            }

            // 保存本地订阅信息
            subscriptions[subscriptionId] = EventSubscriptionInfo(
                subscriptionId = subscriptionId,
                eventTypes = eventTypes,
                filters = filters,
                callback = callback
            )

            Timber.d("Subscribed to events: $eventTypes with id: $subscriptionId")
            Result.success(subscriptionId)
        } catch (e: Exception) {
            Timber.e(e, "Failed to subscribe to events")
            Result.failure(e)
        }
    }

    /**
     * 取消订阅
     */
    suspend fun unsubscribe(subscriptionId: String): Result<Unit> {
        return try {
            // 向服务器取消订阅
            val params = mapOf("subscriptionId" to subscriptionId)
            commandClient.invoke<Map<String, Any>>("events.unsubscribe", params)

            // 移除本地订阅
            subscriptions.remove(subscriptionId)

            Timber.d("Unsubscribed: $subscriptionId")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Failed to unsubscribe: $subscriptionId")
            Result.failure(e)
        }
    }

    /**
     * 取消所有订阅
     */
    suspend fun unsubscribeAll(): Int {
        var count = 0
        val ids = subscriptions.keys.toList()

        for (id in ids) {
            val result = unsubscribe(id)
            if (result.isSuccess) {
                count++
            }
        }

        Timber.i("Unsubscribed $count/${ids.size} subscriptions")
        return count
    }

    /**
     * 获取活跃订阅列表
     */
    fun getActiveSubscriptions(): List<EventSubscriptionInfo> {
        return subscriptions.values.toList()
    }

    // ==================== 便捷订阅方法 ====================

    /**
     * 订阅文件传输进度
     */
    fun subscribeFileTransferProgress(): Flow<FileTransferProgress> {
        return p2pClient.fileTransferProgress
    }

    /**
     * 订阅通用进度更新
     */
    fun subscribeProgressUpdates(): Flow<ProgressNotification> {
        return p2pClient.progressUpdates
    }

    /**
     * 订阅特定方法的事件
     */
    fun subscribeToMethod(method: String): Flow<EventNotification> {
        return p2pClient.events.filter { it.method == method }
    }

    /**
     * 订阅特定前缀的事件
     */
    fun subscribeToPrefix(prefix: String): Flow<EventNotification> {
        return p2pClient.events.filter { it.method.startsWith(prefix) }
    }

    // ==================== 预定义订阅 ====================

    /**
     * 订阅剪贴板变更
     */
    suspend fun subscribeClipboardChanges(
        callback: suspend (EventNotification) -> Unit
    ): Result<String> {
        return subscribe(listOf("clipboard.change"), emptyMap(), callback)
    }

    /**
     * 订阅通知
     */
    suspend fun subscribeNotifications(
        callback: suspend (EventNotification) -> Unit
    ): Result<String> {
        return subscribe(listOf("notification.received", "notification.clicked"), emptyMap(), callback)
    }

    /**
     * 订阅工作流进度
     */
    suspend fun subscribeWorkflowProgress(
        workflowId: String? = null,
        callback: suspend (EventNotification) -> Unit
    ): Result<String> {
        val filters = if (workflowId != null) mapOf("workflowId" to workflowId) else emptyMap()
        return subscribe(listOf("workflow.progress", "workflow.completed", "workflow.failed"), filters, callback)
    }

    /**
     * 订阅进程监控
     */
    suspend fun subscribeProcessMonitor(
        pid: Int? = null,
        callback: suspend (EventNotification) -> Unit
    ): Result<String> {
        val filters = if (pid != null) mapOf("pid" to pid) else emptyMap()
        return subscribe(listOf("process.monitor.update", "process.exit"), filters, callback)
    }

    /**
     * 订阅电池状态
     */
    suspend fun subscribeBatteryStatus(
        callback: suspend (EventNotification) -> Unit
    ): Result<String> {
        return subscribe(listOf("power.battery.state", "power.charging.state"), emptyMap(), callback)
    }

    /**
     * 订阅网络状态变更
     */
    suspend fun subscribeNetworkStatus(
        callback: suspend (EventNotification) -> Unit
    ): Result<String> {
        return subscribe(listOf("network.state.change", "network.wifi.state"), emptyMap(), callback)
    }

    /**
     * 订阅浏览器标签页事件
     */
    suspend fun subscribeBrowserTabs(
        callback: suspend (EventNotification) -> Unit
    ): Result<String> {
        return subscribe(listOf("browser.tab.created", "browser.tab.closed", "browser.tab.updated"), emptyMap(), callback)
    }

    /**
     * 清理资源
     */
    fun cleanup() {
        eventCollectorJob?.cancel()
        subscriptions.clear()
    }
}

/**
 * 事件订阅信息
 */
data class EventSubscriptionInfo(
    val subscriptionId: String,
    val eventTypes: List<String>,
    val filters: Map<String, Any>,
    val callback: suspend (EventNotification) -> Unit,
    val createdAt: Long = System.currentTimeMillis()
) {
    /**
     * 检查事件是否匹配订阅
     */
    fun matches(event: EventNotification): Boolean {
        // 检查事件类型
        if (!eventTypes.any { type ->
            event.method == type || event.method.startsWith("$type.")
        }) {
            return false
        }

        // 检查过滤条件
        if (filters.isNotEmpty()) {
            for ((key, value) in filters) {
                val eventValue = event.params[key]
                if (eventValue != value) {
                    return false
                }
            }
        }

        return true
    }
}
