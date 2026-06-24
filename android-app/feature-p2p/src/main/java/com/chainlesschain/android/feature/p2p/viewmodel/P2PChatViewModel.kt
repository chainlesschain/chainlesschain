package com.chainlesschain.android.feature.p2p.viewmodel

import timber.log.Timber
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.entity.MessageSendStatus
import com.chainlesschain.android.core.database.entity.P2PMessageEntity
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.e2ee.verification.VerificationManager
import com.chainlesschain.android.core.e2ee.verification.VerificationMethod
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.p2p.notification.ActiveChatTracker
import com.chainlesschain.android.feature.p2p.repository.P2PMessageRepository
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import dagger.Lazy
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * P2P聊天 ViewModel
 *
 * 管理P2P设备间的聊天消息，包括：
 * - E2EE加密/解密
 * - 消息持久化
 * - 网络消息收发
 * - 消息状态管理
 */
@HiltViewModel
class P2PChatViewModel @Inject constructor(
    private val sessionManager: PersistentSessionManager,
    private val verificationManager: VerificationManager,
    private val connectionManager: P2PConnectionManager,
    private val didManager: DIDManager,
    private val messageRepository: P2PMessageRepository,
    private val activeChatTracker: ActiveChatTracker,
    private val friendRepository: Lazy<FriendRepository>,
) : ViewModel() {

    // 聊天消息列表
    private val _messages = MutableStateFlow<List<P2PMessageEntity>>(emptyList())
    val messages: StateFlow<List<P2PMessageEntity>> = _messages.asStateFlow()

    // 顶栏好友显示名：备注名 > 昵称 > 缩写 DID (无备注不再显示裸长 DID)
    private val _peerDisplayName = MutableStateFlow("")
    val peerDisplayName: StateFlow<String> = _peerDisplayName.asStateFlow()

    // 设备验证状态
    private val _isDeviceVerified = MutableStateFlow(false)
    val isDeviceVerified: StateFlow<Boolean> = _isDeviceVerified.asStateFlow()

    // 连接状态
    private val _connectionStatus = MutableStateFlow(ConnectionStatus.DISCONNECTED)
    val connectionStatus: StateFlow<ConnectionStatus> = _connectionStatus.asStateFlow()

    // UI状态
    private val _uiState = MutableStateFlow(P2PChatUiState())
    val uiState: StateFlow<P2PChatUiState> = _uiState.asStateFlow()

    // 当前对话的设备ID
    private var currentPeerId: String? = null

    // 连接/会话就绪观察 job：聊天打开后后台 connector + 握手仍在建立连接，轮询到会话就绪即恢复输入框
    @Volatile private var connectionWatcherJob: Job? = null

    // 本地设备ID (DID)
    private val localDeviceId: String
        get() = didManager.getCurrentDID() ?: ""

    init {
        // 监听接收到的消息（仅用于当前聊天的轻量 UI 反馈；实际收信/入库/通知由
        // P2PMessageRepository 的中央消费者处理，不再依赖聊天界面是否打开）。
        observeIncomingMessages()
    }

    /**
     * 加载聊天历史
     */
    fun loadChat(peerId: String) {
        currentPeerId = peerId
        // 标记「正在看这个聊天」→ 该 peer 的新消息前台时不弹通知（MessageNotifier 据此抑制）
        activeChatTracker.enter(peerId)
        Timber.d("Loading chat with peer: $peerId")

        // 顶栏显示名：备注名 > 昵称 > 缩写 DID
        viewModelScope.launch { _peerDisplayName.value = resolveDisplayName(peerId) }

        viewModelScope.launch {
            try {
                _uiState.value = _uiState.value.copy(isLoading = true, error = null)

                // 连接/会话状态 + 设备验证状态（会话已就绪时自动视为已验证）
                refreshConnectionState(peerId)

                // 加载历史消息。注意：getMessages 是**永不结束**的 Flow（持续 collect 实时更新），
                // 所以下面 finally 在 collect 期间不可达 → 不能靠 finally 关 isLoading，否则顶部
                // LinearProgressIndicator 会「一直从左走到右」转个不停。改为首帧到达即关 loading。
                messageRepository.getMessages(peerId).collect { messageList ->
                    _messages.value = messageList
                    if (_uiState.value.isLoading) {
                        _uiState.value = _uiState.value.copy(isLoading = false)
                    }
                    Timber.d("Loaded ${messageList.size} messages")
                }

            } catch (e: Exception) {
                Timber.e(e, "Failed to load chat")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = "加载聊天失败: ${e.message}"
                )
            } finally {
                _uiState.value = _uiState.value.copy(isLoading = false)
            }
        }

        // 会话可能在聊天打开后才由后台 FriendSyncConnector + FriendSessionHandshake 建立
        // （重启后尤其明显：连接需重新协商）。loadChat 的状态只取一次快照，握手完成后
        // 不会自动更新 → 输入框卡在「请先建立连接」。这里持续观察直到会话就绪，自动恢复可用。
        startConnectionWatcher(peerId)
    }

    /**
     * 刷新连接/验证状态。会话非空（已有持久化 E2EE 会话）= 之前完成过 DID 验签握手，
     * 直接视为已验证 → 清「设备未验证」横幅（验证状态在内存、重启即丢，靠这里从会话事实重建）。
     */
    /** 解析好友显示名：备注名 > 昵称 > 缩写 DID。任何异常回退缩写 DID。 */
    private suspend fun resolveDisplayName(peerId: String): String {
        val friend = runCatching {
            (friendRepository.get().getFriendByDid(peerId) as? Result.Success)?.data
        }.getOrNull()
        return friend?.remarkName?.takeIf { it.isNotBlank() }
            ?: friend?.nickname?.takeIf { it.isNotBlank() }
            ?: if (peerId.length <= 18) peerId else peerId.take(12) + "…" + peerId.takeLast(4)
    }

    private suspend fun refreshConnectionState(peerId: String) {
        val session = sessionManager.getSession(peerId)
        if (session != null) {
            _connectionStatus.value = ConnectionStatus.CONNECTED
            if (!verificationManager.isVerified(peerId)) {
                runCatching {
                    verificationManager.markAsVerified(peerId, VerificationMethod.MUTUAL_HANDSHAKE)
                }
            }
            _isDeviceVerified.value = true
        } else {
            _connectionStatus.value = ConnectionStatus.DISCONNECTED
            _isDeviceVerified.value = verificationManager.isVerified(peerId)
        }
    }

    /**
     * 轮询直到会话就绪（后台 connector + 握手完成），就绪后刷新状态并停止。切换 peer / VM 清理时取消。
     * 有上限（[MAX_CONNECTION_WATCH_ATTEMPTS] 次 ×[CONNECTION_WATCH_INTERVAL_MS]）：到顶仍未就绪即停，
     * 避免对永不连上的 peer 无限轮询耗电；手动重连 / 重开聊天 / 切换 peer 会重启观察。
     */
    private fun startConnectionWatcher(peerId: String) {
        connectionWatcherJob?.cancel()
        connectionWatcherJob = viewModelScope.launch {
            var attempts = 0
            while (currentPeerId == peerId && attempts < MAX_CONNECTION_WATCH_ATTEMPTS) {
                if (sessionManager.getSession(peerId) != null) {
                    refreshConnectionState(peerId)
                    break
                }
                attempts++
                delay(CONNECTION_WATCH_INTERVAL_MS)
            }
        }
    }


    /**
     * 发送消息
     */
    fun sendMessage(peerId: String, content: String) {
        if (content.isBlank()) return

        viewModelScope.launch {
            try {
                _uiState.value = _uiState.value.copy(isSending = true, error = null)

                // 检查会话
                val session = sessionManager.getSession(peerId)
                if (session == null) {
                    _uiState.value = _uiState.value.copy(
                        isSending = false,
                        error = "设备未连接，请先建立安全连接"
                    )
                    return@launch
                }

                // 检查本地设备ID
                if (localDeviceId.isEmpty()) {
                    _uiState.value = _uiState.value.copy(
                        isSending = false,
                        error = "本地身份未初始化"
                    )
                    return@launch
                }

                // 通过仓库发送消息（包含加密和网络发送）
                val result = messageRepository.sendMessage(peerId, localDeviceId, content)

                result.fold(
                    onSuccess = { message ->
                        Timber.d("Message sent: ${message.id}")
                        // 消息会通过Flow自动更新到UI
                    },
                    onFailure = { error ->
                        Timber.e(error, "Failed to send message")
                        _uiState.value = _uiState.value.copy(
                            error = "发送失败: ${error.message}"
                        )
                    }
                )

            } catch (e: Exception) {
                Timber.e(e, "Send message error")
                _uiState.value = _uiState.value.copy(
                    error = "发送失败: ${e.message}"
                )
            } finally {
                _uiState.value = _uiState.value.copy(isSending = false)
            }
        }
    }

    /**
     * 监听从仓库接收到的消息
     */
    private fun observeIncomingMessages() {
        viewModelScope.launch {
            messageRepository.incomingMessages.collect { message ->
                if (message.peerId == currentPeerId) {
                    // 消息已通过Flow自动更新，这里可以做额外处理
                    Timber.d("New message received for current chat: ${message.id}")
                }
            }
        }
    }

    /**
     * 聊天界面离开前台（onDispose）。清除「正在看」标记，使该 peer 后续消息恢复弹通知。
     */
    fun onChatScreenHidden() {
        currentPeerId?.let { activeChatTracker.leave(it) }
    }

    /**
     * 标记消息为已读
     */
    fun markAsRead() {
        currentPeerId?.let { peerId ->
            viewModelScope.launch {
                messageRepository.markAsRead(peerId)
            }
        }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    /**
     * 重新连接设备
     */
    fun reconnect() {
        currentPeerId?.let { peerId ->
            viewModelScope.launch {
                try {
                    _connectionStatus.value = ConnectionStatus.CONNECTING

                    // 检查会话是否存在
                    if (!sessionManager.hasSession(peerId)) {
                        _uiState.value = _uiState.value.copy(
                            error = "需要重新建立安全连接"
                        )
                        _connectionStatus.value = ConnectionStatus.DISCONNECTED
                        return@launch
                    }

                    // 重试发送失败的消息
                    messageRepository.retryFailedMessages(peerId, localDeviceId)

                    _connectionStatus.value = ConnectionStatus.CONNECTED
                    Timber.d("Reconnected to peer: $peerId")

                } catch (e: Exception) {
                    Timber.e(e, "Reconnect failed")
                    _connectionStatus.value = ConnectionStatus.DISCONNECTED
                    _uiState.value = _uiState.value.copy(
                        error = "重连失败: ${e.message}"
                    )
                }
            }
        }
    }

    /**
     * 重新发送失败的消息
     */
    fun retryFailedMessages() {
        currentPeerId?.let { peerId ->
            viewModelScope.launch {
                try {
                    messageRepository.retryFailedMessages(peerId, localDeviceId)
                } catch (e: Exception) {
                    Timber.e(e, "Failed to retry messages")
                }
            }
        }
    }

    /**
     * 删除所有消息
     */
    fun deleteAllMessages() {
        currentPeerId?.let { peerId ->
            viewModelScope.launch {
                try {
                    messageRepository.deleteMessages(peerId)
                    Timber.d("All messages deleted for peer: $peerId")
                } catch (e: Exception) {
                    Timber.e(e, "Failed to delete messages")
                    _uiState.value = _uiState.value.copy(
                        error = "删除失败: ${e.message}"
                    )
                }
            }
        }
    }

    /**
     * 搜索消息
     */
    fun searchMessages(query: String) {
        currentPeerId?.let { peerId ->
            viewModelScope.launch {
                try {
                    val results = messageRepository.searchMessages(peerId, query)
                    _messages.value = results
                } catch (e: Exception) {
                    Timber.e(e, "Search failed")
                }
            }
        }
    }

    /**
     * 清除搜索，恢复全部消息
     */
    fun clearSearch() {
        currentPeerId?.let { loadChat(it) }
    }

    override fun onCleared() {
        connectionWatcherJob?.cancel()
        currentPeerId?.let { activeChatTracker.leave(it) }
        super.onCleared()
        Timber.d("ViewModel cleared")
    }

    companion object {
        /** 会话就绪轮询间隔。 */
        private const val CONNECTION_WATCH_INTERVAL_MS = 1_500L

        /**
         * 会话就绪轮询上限（~2 分钟）。会话通常在连上后数秒内建立；到顶仍未就绪即停止轮询，
         * 避免对永不连上的 peer 后台无限耗电（观察 job 仅在聊天界面打开期间存活，onCleared 取消）。
         */
        private const val MAX_CONNECTION_WATCH_ATTEMPTS = 80
    }
}

/**
 * 连接状态
 */
enum class ConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED
}

/**
 * P2P聊天UI状态
 */
@Immutable
data class P2PChatUiState(
    val isLoading: Boolean = false,
    val isSending: Boolean = false,
    val error: String? = null
)
