package com.chainlesschain.android.remote

import com.chainlesschain.android.remote.client.RemoteCommandClient
import com.chainlesschain.android.remote.client.StreamingCommandClient
import com.chainlesschain.android.remote.commands.*
import com.chainlesschain.android.remote.events.EventSubscriptionClient
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.PeerInfo
import com.chainlesschain.android.remote.p2p.ReconnectionEvent
import com.chainlesschain.android.remote.p2p.ReconnectionStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 远程连接管理器
 *
 * 统一管理 P2P 连接和所有远程命令客户端
 */
@Singleton
class RemoteConnectionManager @Inject constructor(
    private val p2pClient: P2PClient,
    private val commandClient: RemoteCommandClient,
    private val streamingClient: StreamingCommandClient,
    private val eventClient: EventSubscriptionClient,

    // ==================== 命令处理器 ====================
    val file: FileCommands,
    val desktop: DesktopCommands,
    val system: SystemCommands,
    val ai: AICommands,
    val media: MediaCommands,
    val knowledge: KnowledgeCommands,
    val network: NetworkCommands,
    val storage: StorageCommands,
    val process: ProcessCommands,
    val power: PowerCommands,
    val systemInfo: SystemInfoCommands,
    val browser: BrowserCommands,
    val extension: ExtensionCommands,
    val security: SecurityCommands,
    val input: InputCommands,
    val display: DisplayCommands,
    val application: ApplicationCommands,
    val workflow: WorkflowCommands,
    val notification: NotificationCommands,
    val clipboard: ClipboardCommands,
    val history: HistoryCommands,
    val device: DeviceCommands,
    val userBrowser: UserBrowserCommands
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // ==================== 连接状态 ====================
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState
    val connectedPeer: StateFlow<PeerInfo?> = p2pClient.connectedPeer
    val reconnectionEvents: SharedFlow<ReconnectionEvent> = p2pClient.reconnectionEvents

    private val _isReady = MutableStateFlow(false)
    val isReady: StateFlow<Boolean> = _isReady.asStateFlow()

    init {
        // 监听连接状态变化
        scope.launch {
            connectionState.collect { state ->
                _isReady.value = state == ConnectionState.CONNECTED
                Timber.d("Connection state changed: $state, isReady: ${_isReady.value}")
            }
        }
    }

    /**
     * 连接到 PC
     */
    suspend fun connect(pcPeerId: String, pcDID: String): Result<Unit> {
        Timber.i("Connecting to PC: $pcPeerId")
        return p2pClient.connect(pcPeerId, pcDID)
    }

    /**
     * 断开连接
     */
    fun disconnect() {
        Timber.i("Disconnecting from PC")
        eventClient.cleanup()
        p2pClient.disconnect()
    }

    /**
     * 临时断开连接（保留自动重连）
     */
    fun disconnectTemporary() {
        Timber.i("Temporary disconnect")
        p2pClient.disconnectTemporary()
    }

    /**
     * 设置自动重连
     */
    fun setAutoReconnect(enabled: Boolean) {
        p2pClient.setAutoReconnect(enabled)
    }

    /**
     * 取消重连尝试
     */
    fun cancelReconnect() {
        p2pClient.cancelReconnect()
    }

    /**
     * 获取重连状态
     */
    fun getReconnectionStatus(): ReconnectionStatus {
        return p2pClient.getReconnectionStatus()
    }

    // ==================== 客户端访问 ====================

    /**
     * 获取基础命令客户端
     */
    fun getCommandClient(): RemoteCommandClient = commandClient

    /**
     * 获取流式命令客户端
     */
    fun getStreamingClient(): StreamingCommandClient = streamingClient

    /**
     * 获取事件订阅客户端
     */
    fun getEventClient(): EventSubscriptionClient = eventClient

    // ==================== 便捷方法 ====================

    /**
     * 发送命令（简化调用）
     */
    suspend fun <T> invoke(
        method: String,
        params: Map<String, Any> = emptyMap(),
        timeout: Long = 30000
    ): Result<T> {
        return commandClient.invoke(method, params, timeout)
    }

    /**
     * 发送命令（带重试）
     */
    suspend fun <T> invokeWithRetry(
        method: String,
        params: Map<String, Any> = emptyMap(),
        maxRetries: Int = 3,
        retryDelay: Long = 1000
    ): Result<T> {
        return commandClient.invokeWithRetry(method, params, maxRetries, retryDelay)
    }

    /**
     * 取消命令
     */
    suspend fun cancelCommand(commandId: String, reason: String = "Cancelled"): Result<Unit> {
        return commandClient.cancelCommand(commandId, reason)
    }

    /**
     * 取消所有待处理命令
     */
    suspend fun cancelAllPendingCommands(reason: String = "Batch cancel"): Int {
        return commandClient.cancelAllPendingCommands(reason)
    }

    // ==================== 健康检查 ====================

    /**
     * Ping 远程 PC
     */
    suspend fun ping(): Result<Long> {
        val startTime = System.currentTimeMillis()
        return try {
            val result = commandClient.invoke<Map<String, Any>>("system.ping")
            if (result.isSuccess) {
                val latency = System.currentTimeMillis() - startTime
                Result.success(latency)
            } else {
                Result.failure(result.exceptionOrNull() ?: Exception("Ping failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * 获取远程系统信息
     */
    suspend fun getRemoteSystemInfo(): Result<Map<String, Any>> {
        return systemInfo.getFullReport().map { it.toMap() }
    }

    /**
     * 检查连接健康状态
     */
    suspend fun checkHealth(): Result<ConnectionHealth> {
        return try {
            val pingResult = ping()
            val latency = pingResult.getOrNull()

            val state = connectionState.value
            val isConnected = state == ConnectionState.CONNECTED
            val reconnectStatus = getReconnectionStatus()

            Result.success(ConnectionHealth(
                isConnected = isConnected,
                state = state,
                latencyMs = latency,
                isReconnecting = reconnectStatus.isReconnecting,
                reconnectAttempts = reconnectStatus.attempts,
                autoReconnectEnabled = reconnectStatus.autoReconnectEnabled
            ))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ==================== 快速操作 ====================

    /**
     * 截取屏幕截图
     */
    suspend fun takeScreenshot(
        displayId: Int? = null,
        format: String = "png"
    ): Result<ScreenshotResponse> {
        return desktop.screenshot(displayId, format)
    }

    /**
     * 发送文本输入
     */
    suspend fun sendText(text: String): Result<TypeTextResponse> {
        return input.typeText(text)
    }

    /**
     * 发送按键
     */
    suspend fun sendKey(key: String, modifiers: List<String> = emptyList()): Result<KeyPressResponse> {
        if (modifiers.isNotEmpty()) {
            val comboResult = input.sendKeyCombo(key, modifiers)
            return comboResult.map { KeyPressResponse(it.success, it.key, it.message) }
        }
        return input.sendKeyPress(key)
    }

    /**
     * 点击鼠标
     */
    suspend fun mouseClick(
        x: Int,
        y: Int,
        button: String = "left"
    ): Result<MouseClickResponse> {
        return input.mouseClick(button, x, y)
    }

    /**
     * AI 聊天
     */
    suspend fun chat(
        message: String,
        conversationId: String? = null,
        model: String? = null
    ): Result<ChatResponse> {
        return ai.chat(message, conversationId, model)
    }

    /**
     * 读取文件
     */
    suspend fun readFile(
        path: String,
        encoding: String = "utf-8"
    ): Result<ReadFileResponse> {
        return file.readFile(path, encoding)
    }

    /**
     * 写入文件
     */
    suspend fun writeFile(
        path: String,
        content: String,
        encoding: String = "utf-8"
    ): Result<WriteFileResponse> {
        return file.writeFile(path, content, encoding)
    }

    /**
     * 执行系统命令
     */
    suspend fun executeCommand(
        command: String,
        args: List<String> = emptyList(),
        workingDirectory: String? = null
    ): Result<ExecCommandResponse> {
        return system.execCommand(command, args, workingDirectory)
    }

    /**
     * 获取剪贴板内容
     */
    suspend fun getClipboard(): Result<ClipboardContent> {
        return clipboard.get()
    }

    /**
     * 设置剪贴板内容
     */
    suspend fun setClipboard(text: String): Result<ClipboardSetResponse> {
        return clipboard.set(text)
    }
}

/**
 * 连接健康状态
 */
data class ConnectionHealth(
    val isConnected: Boolean,
    val state: ConnectionState,
    val latencyMs: Long?,
    val isReconnecting: Boolean,
    val reconnectAttempts: Int,
    val autoReconnectEnabled: Boolean
) {
    val isHealthy: Boolean get() = isConnected && (latencyMs ?: Long.MAX_VALUE) < 1000
}

/**
 * 扩展函数：将响应转换为 Map
 */
private fun ScreenshotResponse.toMap(): Map<String, Any> = mapOf(
    "imageData" to imageData,
    "width" to width,
    "height" to height,
    "format" to format
)

private fun FullSystemReportResponse.toMap(): Map<String, Any> {
    val result = mutableMapOf<String, Any>(
        "success" to success,
        "generatedAt" to generatedAt,
        "system" to system,
        "hardware" to hardware,
        "cpu" to cpu,
        "memory" to memory
    )
    gpus?.let { result["gpus"] = it }
    disks?.let { result["disks"] = it }
    network?.let { result["network"] = it }
    battery?.let { result["battery"] = it }
    return result
}
