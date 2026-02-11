package com.chainlesschain.android.remote.ui.connection

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.PeerInfo
import com.chainlesschain.android.remote.p2p.ReconnectionEvent
import com.chainlesschain.android.remote.p2p.ReconnectionStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 连接状态 ViewModel
 *
 * 管理P2P连接状态、重连进度和设备信息
 */
@HiltViewModel
class ConnectionViewModel @Inject constructor(
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI State
    private val _uiState = MutableStateFlow(ConnectionUiState())
    val uiState: StateFlow<ConnectionUiState> = _uiState.asStateFlow()

    // Events
    private val _events = MutableSharedFlow<ConnectionEvent>()
    val events: SharedFlow<ConnectionEvent> = _events.asSharedFlow()

    // Expose P2P client states directly
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState
    val connectedPeer: StateFlow<PeerInfo?> = p2pClient.connectedPeer

    init {
        // Observe connection state changes
        viewModelScope.launch {
            p2pClient.connectionState.collect { state ->
                _uiState.value = _uiState.value.copy(
                    connectionState = state,
                    isConnected = state == ConnectionState.CONNECTED,
                    isConnecting = state == ConnectionState.CONNECTING,
                    isReconnecting = state == ConnectionState.RECONNECTING
                )

                when (state) {
                    ConnectionState.CONNECTED -> {
                        _events.emit(ConnectionEvent.Connected)
                    }
                    ConnectionState.DISCONNECTED -> {
                        _events.emit(ConnectionEvent.Disconnected)
                    }
                    ConnectionState.ERROR -> {
                        _events.emit(ConnectionEvent.Error("Connection error"))
                    }
                    else -> {}
                }
            }
        }

        // Observe peer info changes
        viewModelScope.launch {
            p2pClient.connectedPeer.collect { peer ->
                _uiState.value = _uiState.value.copy(
                    connectedPeer = peer,
                    connectedSince = peer?.connectedAt
                )
            }
        }

        // Observe reconnection events
        viewModelScope.launch {
            p2pClient.reconnectionEvents.collect { event ->
                handleReconnectionEvent(event)
            }
        }
    }

    private suspend fun handleReconnectionEvent(event: ReconnectionEvent) {
        when (event) {
            is ReconnectionEvent.Scheduled -> {
                _uiState.value = _uiState.value.copy(
                    reconnectAttempt = event.attempt,
                    nextReconnectDelayMs = event.delayMs
                )
                _events.emit(ConnectionEvent.ReconnectScheduled(event.attempt, event.delayMs))
            }
            is ReconnectionEvent.Attempting -> {
                _uiState.value = _uiState.value.copy(
                    reconnectAttempt = event.attempt
                )
                _events.emit(ConnectionEvent.ReconnectAttempting(event.attempt))
            }
            is ReconnectionEvent.Success -> {
                _uiState.value = _uiState.value.copy(
                    reconnectAttempt = 0,
                    nextReconnectDelayMs = 0
                )
                _events.emit(ConnectionEvent.ReconnectSuccess(event.attempts))
            }
            is ReconnectionEvent.Failed -> {
                _uiState.value = _uiState.value.copy(
                    reconnectAttempt = event.attempts,
                    error = event.reason
                )
                _events.emit(ConnectionEvent.ReconnectFailed(event.reason))
            }
            is ReconnectionEvent.HeartbeatTimeout -> {
                _events.emit(ConnectionEvent.HeartbeatTimeout(event.lastReceivedMs))
            }
        }
    }

    /**
     * Connect to a device
     */
    fun connect(peerId: String, peerDID: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isConnecting = true,
                error = null
            )

            p2pClient.connect(peerId, peerDID)
                .onSuccess {
                    _uiState.value = _uiState.value.copy(isConnecting = false)
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isConnecting = false,
                        error = e.message
                    )
                    _events.emit(ConnectionEvent.Error(e.message ?: "Connection failed"))
                }
        }
    }

    /**
     * Disconnect from current device
     */
    fun disconnect() {
        p2pClient.disconnect()
    }

    /**
     * Enable or disable auto-reconnect
     */
    fun setAutoReconnect(enabled: Boolean) {
        p2pClient.setAutoReconnect(enabled)
        _uiState.value = _uiState.value.copy(autoReconnectEnabled = enabled)
    }

    /**
     * Cancel pending reconnect
     */
    fun cancelReconnect() {
        p2pClient.cancelReconnect()
        _uiState.value = _uiState.value.copy(
            reconnectAttempt = 0,
            nextReconnectDelayMs = 0
        )
    }

    /**
     * Get reconnection status
     */
    fun getReconnectionStatus(): ReconnectionStatus {
        return p2pClient.getReconnectionStatus()
    }

    /**
     * Calculate connection duration
     */
    fun getConnectionDuration(): Long {
        val connectedSince = _uiState.value.connectedSince ?: return 0
        return System.currentTimeMillis() - connectedSince
    }

    /**
     * Format connection duration as string
     */
    fun formatConnectionDuration(): String {
        val durationMs = getConnectionDuration()
        if (durationMs <= 0) return "--:--"

        val seconds = (durationMs / 1000) % 60
        val minutes = (durationMs / (1000 * 60)) % 60
        val hours = durationMs / (1000 * 60 * 60)

        return if (hours > 0) {
            String.format("%d:%02d:%02d", hours, minutes, seconds)
        } else {
            String.format("%02d:%02d", minutes, seconds)
        }
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
data class ConnectionUiState(
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val isConnected: Boolean = false,
    val isConnecting: Boolean = false,
    val isReconnecting: Boolean = false,
    val autoReconnectEnabled: Boolean = true,
    val connectedPeer: PeerInfo? = null,
    val connectedSince: Long? = null,
    val reconnectAttempt: Int = 0,
    val nextReconnectDelayMs: Long = 0,
    val error: String? = null
)

/**
 * Events
 */
sealed class ConnectionEvent {
    data object Connected : ConnectionEvent()
    data object Disconnected : ConnectionEvent()
    data class Error(val message: String) : ConnectionEvent()
    data class ReconnectScheduled(val attempt: Int, val delayMs: Long) : ConnectionEvent()
    data class ReconnectAttempting(val attempt: Int) : ConnectionEvent()
    data class ReconnectSuccess(val totalAttempts: Int) : ConnectionEvent()
    data class ReconnectFailed(val reason: String) : ConnectionEvent()
    data class HeartbeatTimeout(val lastReceivedMs: Long) : ConnectionEvent()
}
