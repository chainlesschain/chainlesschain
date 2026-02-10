package com.chainlesschain.android.feature.mcp.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.mcp.data.client.MCPClientManager
import com.chainlesschain.android.feature.mcp.data.repository.MCPRepository
import com.chainlesschain.android.feature.mcp.data.repository.ServerStatistics
import com.chainlesschain.android.feature.mcp.domain.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MCPViewModel @Inject constructor(
    private val repository: MCPRepository,
    private val clientManager: MCPClientManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(MCPUiState())
    val uiState: StateFlow<MCPUiState> = _uiState.asStateFlow()

    private val _selectedServer = MutableStateFlow<MCPServer?>(null)
    val selectedServer: StateFlow<MCPServer?> = _selectedServer.asStateFlow()

    init {
        loadServers()
        observeActiveConnections()
    }

    private fun loadServers() {
        viewModelScope.launch {
            repository.getAllServers().collect { servers ->
                _uiState.update { it.copy(servers = servers, isLoading = false) }
            }
        }
    }

    private fun observeActiveConnections() {
        viewModelScope.launch {
            clientManager.activeConnections.collect { connections ->
                _uiState.update { it.copy(connectedServerIds = connections) }
            }
        }
    }

    // ==================== Server Operations ====================

    fun selectServer(server: MCPServer?) {
        _selectedServer.value = server
        server?.let { loadServerDetails(it.id) }
    }

    private fun loadServerDetails(serverId: String) {
        viewModelScope.launch {
            combine(
                repository.getToolCallsForServer(serverId),
                repository.getServerStatistics(serverId)
            ) { calls, stats ->
                Pair(calls, stats)
            }.collect { (calls, stats) ->
                _uiState.update {
                    it.copy(
                        serverToolCalls = calls,
                        serverStatistics = stats
                    )
                }
            }
        }
    }

    fun addServer(name: String, url: String, transport: MCPTransport = MCPTransport.HTTP_SSE) {
        viewModelScope.launch {
            try {
                val server = MCPServer(
                    id = "",
                    name = name,
                    url = url,
                    transport = transport
                )
                repository.addServer(server)
                _uiState.update { it.copy(message = "Server added") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun updateServer(server: MCPServer) {
        viewModelScope.launch {
            try {
                repository.updateServer(server)
                _uiState.update { it.copy(message = "Server updated") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun deleteServer(serverId: String) {
        viewModelScope.launch {
            try {
                if (clientManager.isConnected(serverId)) {
                    clientManager.disconnect(serverId)
                }
                repository.deleteServer(serverId)
                if (_selectedServer.value?.id == serverId) {
                    _selectedServer.value = null
                }
                _uiState.update { it.copy(message = "Server deleted") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    // ==================== Connection Operations ====================

    fun connectServer(serverId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            clientManager.connect(serverId)
                .onSuccess {
                    _uiState.update { it.copy(isLoading = false, message = "Connected") }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoading = false, error = e.message) }
                }
        }
    }

    fun disconnectServer(serverId: String) {
        viewModelScope.launch {
            clientManager.disconnect(serverId)
                .onSuccess {
                    _uiState.update { it.copy(message = "Disconnected") }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message) }
                }
        }
    }

    fun reconnectServer(serverId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            clientManager.reconnect(serverId)
                .onSuccess {
                    _uiState.update { it.copy(isLoading = false, message = "Reconnected") }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoading = false, error = e.message) }
                }
        }
    }

    // ==================== Tool Operations ====================

    fun callTool(serverId: String, toolName: String, arguments: Map<String, String> = emptyMap()) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            clientManager.callTool(serverId, toolName, arguments)
                .onSuccess { call ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            message = "Tool executed: ${call.toolName}",
                            lastToolResult = call.result
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoading = false, error = e.message) }
                }
        }
    }

    fun loadRecentToolCalls(limit: Int = 20) {
        viewModelScope.launch {
            repository.getRecentToolCalls(limit).collect { calls ->
                _uiState.update { it.copy(recentToolCalls = calls) }
            }
        }
    }

    // ==================== Messages ====================

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearLastToolResult() {
        _uiState.update { it.copy(lastToolResult = null) }
    }
}

data class MCPUiState(
    val isLoading: Boolean = true,
    val servers: List<MCPServer> = emptyList(),
    val connectedServerIds: Set<String> = emptySet(),
    val serverToolCalls: List<MCPToolCall> = emptyList(),
    val serverStatistics: ServerStatistics = ServerStatistics(),
    val recentToolCalls: List<MCPToolCall> = emptyList(),
    val lastToolResult: String? = null,
    val message: String? = null,
    val error: String? = null
)
