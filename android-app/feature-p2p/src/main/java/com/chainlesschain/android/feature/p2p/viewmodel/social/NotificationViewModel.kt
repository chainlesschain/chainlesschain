package com.chainlesschain.android.feature.p2p.viewmodel.social
import com.chainlesschain.android.core.common.Result

import com.chainlesschain.android.core.common.onError
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.onSuccess
import com.chainlesschain.android.core.common.viewmodel.BaseViewModel
import com.chainlesschain.android.core.common.viewmodel.UiEvent
import com.chainlesschain.android.core.common.viewmodel.UiState
import com.chainlesschain.android.core.database.entity.social.NotificationEntity
import com.chainlesschain.android.core.database.entity.social.NotificationType
import com.chainlesschain.android.feature.p2p.repository.social.NotificationRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 通知 ViewModel
 *
 * 管理应用通知、未读状态和通知类型筛选
 */
@HiltViewModel
class NotificationViewModel @Inject constructor(
    private val notificationRepository: NotificationRepository
) : BaseViewModel<NotificationUiState, NotificationEvent>(
    initialState = NotificationUiState()
) {

    init {
        loadNotifications()
        observeUnreadCount()
    }

    // ===== 数据加载 =====

    /**
     * 加载所有通知
     */
    fun loadNotifications() {
        viewModelScope.launch(exceptionHandler) {
            notificationRepository.getAllNotifications().collectLatest { result ->
                result.onSuccess { notifications ->
                    updateState {
                        copy(
                            allNotifications = notifications,
                            isLoading = false
                        )
                    }
                }.onError { error ->
                    updateState { copy(isLoading = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 加载未读通知
     */
    fun loadUnreadNotifications() {
        viewModelScope.launch(exceptionHandler) {
            notificationRepository.getUnreadNotifications().collectLatest { result ->
                result.onSuccess { notifications ->
                    updateState { copy(unreadNotifications = notifications) }
                }.onError { error ->
                    handleError(error)
                }
            }
        }
    }

    /**
     * 观察未读通知数量
     */
    private fun observeUnreadCount() {
        viewModelScope.launch(exceptionHandler) {
            notificationRepository.getUnreadCount().collectLatest { result ->
                result.onSuccess { count ->
                    updateState { copy(unreadCount = count) }
                }
            }
        }
    }

    /**
     * 加载最近通知
     */
    fun loadRecentNotifications(limit: Int = 20) {
        viewModelScope.launch(exceptionHandler) {
            notificationRepository.getRecentNotifications(limit).collectLatest { result ->
                result.onSuccess { notifications ->
                    updateState { copy(recentNotifications = notifications) }
                }.onError { error ->
                    handleError(error)
                }
            }
        }
    }

    /**
     * 按类型筛选通知
     */
    fun filterByType(type: NotificationType) {
        viewModelScope.launch(exceptionHandler) {
            updateState { copy(selectedType = type, isLoading = true) }
            notificationRepository.getNotificationsByType(type).collectLatest { result ->
                result.onSuccess { notifications ->
                    updateState {
                        copy(
                            filteredNotifications = notifications,
                            isLoading = false
                        )
                    }
                }.onError { error ->
                    updateState { copy(isLoading = false) }
                    handleError(error)
                }
            }
        }
    }

    /**
     * 清除类型筛选
     */
    fun clearTypeFilter() {
        updateState {
            copy(
                selectedType = null,
                filteredNotifications = emptyList()
            )
        }
        loadNotifications()
    }

    /**
     * 搜索通知
     */
    fun searchNotifications(query: String) {
        if (query.isBlank()) {
            loadNotifications()
            return
        }

        viewModelScope.launch(exceptionHandler) {
            updateState { copy(isSearching = true, searchQuery = query) }
            notificationRepository.searchNotifications(query).collectLatest { result ->
                result.onSuccess { notifications ->
                    updateState {
                        copy(
                            allNotifications = notifications,
                            isSearching = false
                        )
                    }
                }.onError { error ->
                    updateState { copy(isSearching = false) }
                    handleError(error)
                }
            }
        }
    }

    // ===== 通知操作 =====

    /**
     * 标记通知为已读
     */
    fun markAsRead(notificationId: String) = launchSafely {
        notificationRepository.markAsRead(notificationId)
            .onSuccess {
                // 状态会通过 Flow 自动更新
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 批量标记为已读
     */
    fun markAsRead(notificationIds: List<String>) = launchSafely {
        notificationRepository.markAsRead(notificationIds)
            .onSuccess {
                sendEvent(NotificationEvent.ShowToast("已标记为已读"))
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 标记所有通知为已读
     */
    fun markAllAsRead() = launchSafely {
        notificationRepository.markAllAsRead()
            .onSuccess {
                sendEvent(NotificationEvent.ShowToast("所有通知已标记为已读"))
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 标记通知为未读
     */
    fun markAsUnread(notificationId: String) = launchSafely {
        notificationRepository.markAsUnread(notificationId)
            .onSuccess {
                // 状态会通过 Flow 自动更新
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 删除通知
     */
    fun deleteNotification(notificationId: String) = launchSafely {
        notificationRepository.deleteNotification(notificationId)
            .onSuccess {
                sendEvent(NotificationEvent.ShowToast("通知已删除"))
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 批量删除通知
     */
    fun deleteNotifications(notificationIds: List<String>) = launchSafely {
        notificationRepository.deleteNotifications(notificationIds)
            .onSuccess {
                sendEvent(NotificationEvent.ShowToast("通知已删除"))
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 删除所有已读通知
     */
    fun deleteAllRead() = launchSafely {
        notificationRepository.deleteAllRead()
            .onSuccess {
                sendEvent(NotificationEvent.ShowToast("已删除所有已读通知"))
            }.onError { error ->
                handleError(error)
            }
    }

    /**
     * 清理旧通知（30天前）
     */
    fun cleanupOldNotifications() = launchSafely {
        val cutoffTime = System.currentTimeMillis() - (30L * 24 * 60 * 60 * 1000) // 30天
        notificationRepository.cleanupOldReadNotifications(cutoffTime)
            .onSuccess {
                sendEvent(NotificationEvent.ShowToast("已清理旧通知"))
            }.onError { error ->
                handleError(error)
            }
    }

    // ===== UI 交互 =====

    /**
     * 点击通知
     */
    fun onNotificationClick(notification: NotificationEntity) {
        // 标记为已读
        markAsRead(notification.id)

        // 根据通知类型导航
        when (notification.type) {
            NotificationType.FRIEND_REQUEST -> {
                notification.actorDid?.let {
                    sendEvent(NotificationEvent.NavigateToFriendRequest(it))
                }
            }
            NotificationType.FRIEND_ACCEPTED -> {
                notification.actorDid?.let {
                    sendEvent(NotificationEvent.NavigateToFriendProfile(it))
                }
            }
            NotificationType.POST_LIKED,
            NotificationType.POST_COMMENTED,
            NotificationType.POST_MENTIONED,
            NotificationType.POST_SHARED -> {
                notification.targetId?.let {
                    sendEvent(NotificationEvent.NavigateToPost(it))
                }
            }
            NotificationType.COMMENT_REPLIED -> {
                notification.targetId?.let {
                    sendEvent(NotificationEvent.NavigateToComment(it))
                }
            }
            NotificationType.SYSTEM -> {
                // 系统通知不需要导航
            }
        }
    }

    /**
     * 长按通知（显示操作菜单）
     */
    fun onNotificationLongClick(notification: NotificationEntity) {
        updateState {
            copy(
                selectedNotification = notification,
                showNotificationMenu = true
            )
        }
    }

    /**
     * 隐藏通知菜单
     */
    fun hideNotificationMenu() {
        updateState {
            copy(
                selectedNotification = null,
                showNotificationMenu = false
            )
        }
    }

    /**
     * 切换筛选菜单
     */
    fun toggleFilterMenu() {
        updateState { copy(showFilterMenu = !showFilterMenu) }
    }

    /**
     * 切换仅显示未读
     */
    fun toggleShowOnlyUnread() {
        val showOnlyUnread = !currentState.showOnlyUnread
        updateState { copy(showOnlyUnread = showOnlyUnread) }

        if (showOnlyUnread) {
            loadUnreadNotifications()
        } else {
            loadNotifications()
        }
    }

    /**
     * 刷新通知
     */
    fun refresh() {
        updateState { copy(isRefreshing = true) }
        loadNotifications()
        loadUnreadNotifications()
        updateState { copy(isRefreshing = false) }
    }

    /**
     * 获取各类型未读数量
     */
    fun loadUnreadCountsByType() {
        viewModelScope.launch(exceptionHandler) {
            val counts = mutableMapOf<NotificationType, Int>()

            NotificationType.values().forEach { type ->
                notificationRepository.getUnreadCountByType(type).collectLatest { result ->
                    result.onSuccess { count ->
                        counts[type] = count
                        updateState { copy(unreadCountsByType = counts) }
                    }
                }
            }
        }
    }
}

/**
 * 通知 UI 状态
 */
data class NotificationUiState(
    val allNotifications: List<NotificationEntity> = emptyList(),
    val unreadNotifications: List<NotificationEntity> = emptyList(),
    val recentNotifications: List<NotificationEntity> = emptyList(),
    val filteredNotifications: List<NotificationEntity> = emptyList(),
    val selectedNotification: NotificationEntity? = null,
    val unreadCount: Int = 0,
    val unreadCountsByType: Map<NotificationType, Int> = emptyMap(),
    val selectedType: NotificationType? = null,
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val isSearching: Boolean = false,
    val searchQuery: String = "",
    val showOnlyUnread: Boolean = false,
    val showFilterMenu: Boolean = false,
    val showNotificationMenu: Boolean = false
) : UiState

/**
 * 通知事件
 */
sealed class NotificationEvent : UiEvent {
    data class ShowToast(val message: String) : NotificationEvent()
    data class NavigateToFriendRequest(val did: String) : NotificationEvent()
    data class NavigateToFriendProfile(val did: String) : NotificationEvent()
    data class NavigateToPost(val postId: String) : NotificationEvent()
    data class NavigateToComment(val commentId: String) : NotificationEvent()
}
