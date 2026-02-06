package com.chainlesschain.android.remote.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.client.RemoteCommandClient
import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.commands.SystemCommands
import com.chainlesschain.android.remote.commands.SystemInfo
import com.chainlesschain.android.remote.commands.SystemStatus
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.PeerInfo
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class RemoteControlViewModel @Inject constructor(
    private val p2pClient: P2PClient,
    private val commandClient: RemoteCommandClient,
    private val aiCommands: AICommands,
    private val systemCommands: SystemCommands
) : ViewModel() {

    private val _uiState = MutableStateFlow(RemoteControlUiState())
    val uiState: StateFlow<RemoteControlUiState> = _uiState.asStateFlow()

    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState
    val connectedPeer: StateFlow<PeerInfo?> = p2pClient.connectedPeer

    init {
        observeConnectionState()
        startAutoRefreshStatus()
    }

    private fun observeConnectionState() {
        viewModelScope.launch {
            connectionState.collectLatest { state ->
                when (state) {
                    ConnectionState.CONNECTED -> {
                        addRecentAction("Connected")
                        refreshSystemInfo()
                        refreshSystemStatus()
                    }
                    ConnectionState.DISCONNECTED, ConnectionState.ERROR -> {
                        _uiState.update { it.copy(systemStatus = null, systemInfo = null) }
                    }
                    else -> Unit
                }
            }
        }
    }

    private fun startAutoRefreshStatus() {
        viewModelScope.launch {
            while (coroutineContext.isActive) {
                delay(10_000)
                if (connectionState.value == ConnectionState.CONNECTED) {
                    refreshSystemStatus()
                }
            }
        }
    }

    fun connectToPC(pcPeerId: String, pcDID: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val result = p2pClient.connect(pcPeerId, pcDID)
            if (result.isSuccess) {
                _uiState.update { it.copy(isLoading = false) }
                addRecentAction("Connected to $pcPeerId")
            } else {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = result.exceptionOrNull()?.message ?: "Connect failed"
                    )
                }
            }
        }
    }

    fun disconnect() {
        viewModelScope.launch {
            p2pClient.disconnect()
            _uiState.update { it.copy(systemStatus = null, systemInfo = null, error = null) }
            addRecentAction("Disconnected")
        }
    }

    fun refreshSystemStatus() {
        viewModelScope.launch {
            val result = systemCommands.getStatus()
            if (result.isSuccess) {
                _uiState.update {
                    it.copy(
                        systemStatus = result.getOrNull(),
                        lastRefreshTime = System.currentTimeMillis()
                    )
                }
                addRecentAction("System status refreshed")
            } else {
                Timber.e(result.exceptionOrNull(), "Failed to refresh status")
            }
        }
    }

    fun refreshSystemInfo() {
        viewModelScope.launch {
            val result = systemCommands.getInfo()
            if (result.isSuccess) {
                _uiState.update { it.copy(systemInfo = result.getOrNull()) }
                addRecentAction("System info updated")
            } else {
                Timber.e(result.exceptionOrNull(), "Failed to refresh system info")
            }
        }
    }

    fun takeScreenshot(onSuccess: (String) -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = systemCommands.screenshot()
            _uiState.update { it.copy(isLoading = false) }
            if (result.isSuccess) {
                result.getOrNull()?.let { onSuccess(it.data) }
                addRecentAction("Screenshot requested")
            } else {
                onError(result.exceptionOrNull()?.message ?: "Screenshot failed")
            }
        }
    }

    fun sendNotification(
        title: String,
        body: String,
        onSuccess: () -> Unit,
        onError: (String) -> Unit
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = systemCommands.notify(title, body)
            _uiState.update { it.copy(isLoading = false) }
            if (result.isSuccess) {
                onSuccess()
                addRecentAction("Notification: $title")
            } else {
                onError(result.exceptionOrNull()?.message ?: "Notify failed")
            }
        }
    }

    fun setError(message: String) {
        _uiState.update { it.copy(error = message) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    private fun addRecentAction(action: String) {
        _uiState.update {
            it.copy(recentActions = (listOf(action) + it.recentActions).take(10))
        }
    }
}

data class RemoteControlUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val systemStatus: SystemStatus? = null,
    val systemInfo: SystemInfo? = null,
    val lastRefreshTime: Long = 0,
    val recentActions: List<String> = emptyList()
)
