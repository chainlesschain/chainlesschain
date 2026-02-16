package com.chainlesschain.android.remote.ui.notification

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.NotificationCommands
import com.chainlesschain.android.remote.commands.NotificationHistoryItem
import com.chainlesschain.android.remote.commands.NotificationPriority
import com.chainlesschain.android.remote.commands.NotificationSettings
import com.chainlesschain.android.remote.events.RemoteEventDispatcher
import com.chainlesschain.android.remote.notification.LocalNotificationManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * 通知中心 ViewModel
 *
 * 管理通知历史、设置和跨设备通知同步
 */
@HiltViewModel
class NotificationCenterViewModel @Inject constructor(
    private val notificationCommands: NotificationCommands,
    private val localNotificationManager: LocalNotificationManager,
    private val eventDispatcher: RemoteEventDispatcher
) : ViewModel() {

    // UI State
    private val _uiState = MutableStateFlow(NotificationCenterUiState())
    val uiState: StateFlow<NotificationCenterUiState> = _uiState.asStateFlow()

    // Events
    private val _events = MutableSharedFlow<NotificationCenterEvent>()
    val events: SharedFlow<NotificationCenterEvent> = _events.asSharedFlow()

    // Expose local notification manager states
    val unreadCount: StateFlow<Int> = localNotificationManager.unreadCount
    val notificationsEnabled: StateFlow<Boolean> = localNotificationManager.notificationsEnabled

    init {
        // Listen for new notifications
        viewModelScope.launch {
            eventDispatcher.notificationReceived.collect { event ->
                // Add to the top of the list
                val currentNotifications = _uiState.value.notifications.toMutableList()
                val newItem = NotificationHistoryItem(
                    id = event.notificationId,
                    title = event.title,
                    body = event.body,
                    priority = event.priority,
                    read = false,
                    source = event.source,
                    createdAt = event.timestamp,
                    data = event.data
                )
                currentNotifications.add(0, newItem)

                _uiState.value = _uiState.value.copy(
                    notifications = currentNotifications,
                    unreadCount = _uiState.value.unreadCount + 1
                )

                _events.emit(NotificationCenterEvent.NewNotification(newItem))
            }
        }

        // Load initial data
        loadNotifications()
        loadSettings()
    }

    /**
     * Load notification history
     */
    fun loadNotifications(limit: Int = 50, offset: Int = 0, unreadOnly: Boolean = false) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            notificationCommands.getHistory(limit, offset, unreadOnly)
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(
                        notifications = response.notifications,
                        totalCount = response.total,
                        unreadCount = response.unreadCount,
                        isLoading = false,
                        error = null
                    )
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message
                    )
                }
        }
    }

    /**
     * Load notification settings
     */
    fun loadSettings() {
        viewModelScope.launch {
            notificationCommands.getSettings()
                .onSuccess { settings ->
                    _uiState.value = _uiState.value.copy(settings = settings)
                }
                .onFailure { e ->
                    Timber.e(e, "Failed to load notification settings")
                }
        }
    }

    /**
     * Send notification to PC
     */
    fun sendToPC(
        title: String,
        body: String,
        priority: NotificationPriority = NotificationPriority.NORMAL
    ) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSending = true)

            notificationCommands.send(title, body, priority = priority)
                .onSuccess {
                    _uiState.value = _uiState.value.copy(isSending = false)
                    _events.emit(NotificationCenterEvent.NotificationSent(title))
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isSending = false,
                        error = e.message
                    )
                }
        }
    }

    /**
     * Broadcast notification to all devices
     */
    fun broadcast(title: String, body: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSending = true)

            notificationCommands.broadcast(title, body)
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(isSending = false)
                    _events.emit(NotificationCenterEvent.NotificationBroadcast(
                        title,
                        response.deliveredCount
                    ))
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isSending = false,
                        error = e.message
                    )
                }
        }
    }

    /**
     * Mark notification as read
     */
    fun markAsRead(notificationId: String) {
        viewModelScope.launch {
            notificationCommands.markAsRead(notificationId)
                .onSuccess {
                    val updated = _uiState.value.notifications.map { item ->
                        if (item.id == notificationId) {
                            item.copy(read = true, readAt = System.currentTimeMillis())
                        } else {
                            item
                        }
                    }
                    _uiState.value = _uiState.value.copy(
                        notifications = updated,
                        unreadCount = (_uiState.value.unreadCount - 1).coerceAtLeast(0)
                    )
                }
        }
    }

    /**
     * Mark all notifications as read
     */
    fun markAllAsRead() {
        viewModelScope.launch {
            notificationCommands.markAllAsRead()
                .onSuccess { response ->
                    val updated = _uiState.value.notifications.map { item ->
                        item.copy(read = true, readAt = System.currentTimeMillis())
                    }
                    _uiState.value = _uiState.value.copy(
                        notifications = updated,
                        unreadCount = 0
                    )
                    localNotificationManager.clearUnreadCount()
                    _events.emit(NotificationCenterEvent.AllMarkedAsRead(response.markedCount))
                }
        }
    }

    /**
     * Delete notification
     */
    fun deleteNotification(notificationId: String) {
        viewModelScope.launch {
            notificationCommands.delete(notificationId)
                .onSuccess {
                    val updated = _uiState.value.notifications.filterNot { it.id == notificationId }
                    _uiState.value = _uiState.value.copy(notifications = updated)
                }
        }
    }

    /**
     * Clear all notifications
     */
    fun clearAll() {
        viewModelScope.launch {
            notificationCommands.clearAll()
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(
                        notifications = emptyList(),
                        unreadCount = 0
                    )
                    localNotificationManager.cancelAll()
                    _events.emit(NotificationCenterEvent.AllCleared(response.clearedCount))
                }
        }
    }

    /**
     * Update notification settings
     */
    fun updateSettings(
        enabled: Boolean? = null,
        quietHoursEnabled: Boolean? = null,
        quietHoursStart: String? = null,
        quietHoursEnd: String? = null,
        soundEnabled: Boolean? = null
    ) {
        viewModelScope.launch {
            notificationCommands.updateSettings(
                enabled = enabled,
                quietHoursEnabled = quietHoursEnabled,
                quietHoursStart = quietHoursStart,
                quietHoursEnd = quietHoursEnd,
                soundEnabled = soundEnabled
            )
                .onSuccess { response ->
                    response.settings?.let { settings ->
                        _uiState.value = _uiState.value.copy(settings = settings)
                    }
                    _events.emit(NotificationCenterEvent.SettingsUpdated)
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
        }
    }

    /**
     * Toggle local notifications
     */
    fun toggleLocalNotifications(enabled: Boolean) {
        localNotificationManager.setNotificationsEnabled(enabled)
    }

    /**
     * Refresh notifications
     */
    fun refresh() {
        loadNotifications()
    }

    /**
     * Clear error
     */
    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}

/**
 * UI State
 */
@Immutable
data class NotificationCenterUiState(
    val notifications: List<NotificationHistoryItem> = emptyList(),
    val settings: NotificationSettings = NotificationSettings(),
    val totalCount: Int = 0,
    val unreadCount: Int = 0,
    val isLoading: Boolean = false,
    val isSending: Boolean = false,
    val error: String? = null
)

/**
 * Events
 */
sealed class NotificationCenterEvent {
    data class NewNotification(val notification: NotificationHistoryItem) : NotificationCenterEvent()
    data class NotificationSent(val title: String) : NotificationCenterEvent()
    data class NotificationBroadcast(val title: String, val deliveredCount: Int) : NotificationCenterEvent()
    data class AllMarkedAsRead(val count: Int) : NotificationCenterEvent()
    data class AllCleared(val count: Int) : NotificationCenterEvent()
    data object SettingsUpdated : NotificationCenterEvent()
}
