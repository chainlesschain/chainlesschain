package com.chainlesschain.android.feature.mcp.data.repository

import com.chainlesschain.android.feature.mcp.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for MCP server and tool data
 */
@Singleton
class MCPRepository @Inject constructor() {

    private val _servers = MutableStateFlow<Map<String, MCPServer>>(emptyMap())
    private val _toolCalls = MutableStateFlow<Map<String, MCPToolCall>>(emptyMap())

    // ==================== Servers ====================

    fun getAllServers(): Flow<List<MCPServer>> = _servers.map { it.values.toList() }

    fun getServerById(serverId: String): MCPServer? = _servers.value[serverId]

    fun getServerByIdFlow(serverId: String): Flow<MCPServer?> = _servers.map { it[serverId] }

    fun getConnectedServers(): Flow<List<MCPServer>> = _servers.map { servers ->
        servers.values.filter { it.status == ServerStatus.CONNECTED }
    }

    suspend fun addServer(server: MCPServer): MCPServer {
        val newServer = server.copy(
            id = if (server.id.isBlank()) UUID.randomUUID().toString() else server.id,
            createdAt = System.currentTimeMillis()
        )
        _servers.value = _servers.value + (newServer.id to newServer)
        return newServer
    }

    suspend fun updateServer(server: MCPServer): Boolean {
        if (!_servers.value.containsKey(server.id)) return false
        _servers.value = _servers.value + (server.id to server)
        return true
    }

    suspend fun updateServerStatus(serverId: String, status: ServerStatus): Boolean {
        val server = _servers.value[serverId] ?: return false
        val updatedServer = when (status) {
            ServerStatus.CONNECTED -> server.copy(
                status = status,
                lastConnected = System.currentTimeMillis()
            )
            else -> server.copy(status = status)
        }
        _servers.value = _servers.value + (serverId to updatedServer)
        return true
    }

    suspend fun updateServerTools(serverId: String, tools: List<MCPTool>): Boolean {
        val server = _servers.value[serverId] ?: return false
        _servers.value = _servers.value + (serverId to server.copy(tools = tools))
        return true
    }

    suspend fun updateServerResources(serverId: String, resources: List<MCPResource>): Boolean {
        val server = _servers.value[serverId] ?: return false
        _servers.value = _servers.value + (serverId to server.copy(resources = resources))
        return true
    }

    suspend fun deleteServer(serverId: String): Boolean {
        if (!_servers.value.containsKey(serverId)) return false
        _servers.value = _servers.value - serverId
        return true
    }

    // ==================== Tool Calls ====================

    fun getAllToolCalls(): Flow<List<MCPToolCall>> = _toolCalls.map { it.values.toList() }

    fun getToolCallsForServer(serverId: String): Flow<List<MCPToolCall>> = _toolCalls.map { calls ->
        calls.values.filter { it.serverId == serverId }
    }

    fun getRecentToolCalls(limit: Int = 20): Flow<List<MCPToolCall>> = _toolCalls.map { calls ->
        calls.values.sortedByDescending { it.startedAt }.take(limit)
    }

    suspend fun createToolCall(toolCall: MCPToolCall): MCPToolCall {
        val newCall = toolCall.copy(
            id = if (toolCall.id.isBlank()) UUID.randomUUID().toString() else toolCall.id,
            startedAt = System.currentTimeMillis()
        )
        _toolCalls.value = _toolCalls.value + (newCall.id to newCall)
        return newCall
    }

    suspend fun updateToolCall(toolCall: MCPToolCall): Boolean {
        if (!_toolCalls.value.containsKey(toolCall.id)) return false
        _toolCalls.value = _toolCalls.value + (toolCall.id to toolCall)
        return true
    }

    suspend fun completeToolCall(callId: String, result: String): Boolean {
        val call = _toolCalls.value[callId] ?: return false
        val completed = call.copy(
            status = ToolCallStatus.COMPLETED,
            result = result,
            completedAt = System.currentTimeMillis()
        )
        _toolCalls.value = _toolCalls.value + (callId to completed)
        return true
    }

    suspend fun failToolCall(callId: String, error: String): Boolean {
        val call = _toolCalls.value[callId] ?: return false
        val failed = call.copy(
            status = ToolCallStatus.FAILED,
            error = error,
            completedAt = System.currentTimeMillis()
        )
        _toolCalls.value = _toolCalls.value + (callId to failed)
        return true
    }

    // ==================== Statistics ====================

    fun getServerStatistics(serverId: String): Flow<ServerStatistics> = _toolCalls.map { calls ->
        val serverCalls = calls.values.filter { it.serverId == serverId }
        ServerStatistics(
            totalCalls = serverCalls.size,
            successfulCalls = serverCalls.count { it.status == ToolCallStatus.COMPLETED },
            failedCalls = serverCalls.count { it.status == ToolCallStatus.FAILED },
            averageLatency = serverCalls
                .filter { it.completedAt != null }
                .map { (it.completedAt ?: it.startedAt) - it.startedAt }
                .takeIf { it.isNotEmpty() }
                ?.average()
                ?.toLong() ?: 0L
        )
    }
}

/**
 * Server call statistics
 */
data class ServerStatistics(
    val totalCalls: Int = 0,
    val successfulCalls: Int = 0,
    val failedCalls: Int = 0,
    val averageLatency: Long = 0L
) {
    val successRate: Float
        get() = if (totalCalls > 0) successfulCalls.toFloat() / totalCalls else 0f
}
