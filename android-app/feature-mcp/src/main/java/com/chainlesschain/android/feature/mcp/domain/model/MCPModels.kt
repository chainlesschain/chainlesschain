package com.chainlesschain.android.feature.mcp.domain.model

import kotlinx.serialization.Serializable

/**
 * MCP Server configuration
 */
@Serializable
data class MCPServer(
    val id: String,
    val name: String,
    val description: String? = null,
    val url: String,
    val transport: MCPTransport = MCPTransport.HTTP_SSE,
    val status: ServerStatus = ServerStatus.DISCONNECTED,
    val tools: List<MCPTool> = emptyList(),
    val resources: List<MCPResource> = emptyList(),
    val securityPolicy: MCPSecurityPolicy = MCPSecurityPolicy(),
    val lastConnected: Long? = null,
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * MCP transport type
 */
@Serializable
enum class MCPTransport {
    HTTP_SSE,
    STDIO,
    WEBSOCKET
}

/**
 * Server connection status
 */
@Serializable
enum class ServerStatus {
    CONNECTED,
    CONNECTING,
    DISCONNECTED,
    ERROR
}

/**
 * MCP Tool definition
 */
@Serializable
data class MCPTool(
    val name: String,
    val description: String? = null,
    val inputSchema: String? = null, // JSON Schema
    val requiresConfirmation: Boolean = false,
    val isEnabled: Boolean = true
)

/**
 * MCP Resource definition
 */
@Serializable
data class MCPResource(
    val uri: String,
    val name: String,
    val description: String? = null,
    val mimeType: String? = null
)

/**
 * Security policy for MCP server
 */
@Serializable
data class MCPSecurityPolicy(
    val allowedTools: List<String>? = null, // null = all allowed
    val blockedTools: List<String> = emptyList(),
    val maxRequestsPerMinute: Int = 60,
    val requireConfirmation: Boolean = true,
    val allowFileAccess: Boolean = false,
    val allowNetworkAccess: Boolean = true
)

/**
 * MCP Tool call request
 */
@Serializable
data class MCPToolCall(
    val id: String,
    val serverId: String,
    val toolName: String,
    val arguments: Map<String, String> = emptyMap(),
    val status: ToolCallStatus = ToolCallStatus.PENDING,
    val result: String? = null,
    val error: String? = null,
    val startedAt: Long = System.currentTimeMillis(),
    val completedAt: Long? = null
)

/**
 * Tool call status
 */
@Serializable
enum class ToolCallStatus {
    PENDING,
    RUNNING,
    COMPLETED,
    FAILED,
    CANCELLED
}

/**
 * MCP message types
 */
@Serializable
sealed class MCPMessage {
    @Serializable
    data class Initialize(
        val protocolVersion: String = "2024-11-05",
        val capabilities: MCPCapabilities = MCPCapabilities()
    ) : MCPMessage()

    @Serializable
    data class ToolsList(val cursor: String? = null) : MCPMessage()

    @Serializable
    data class ToolCall(
        val name: String,
        val arguments: Map<String, String>
    ) : MCPMessage()

    @Serializable
    data class ResourcesList(val cursor: String? = null) : MCPMessage()

    @Serializable
    data class ResourceRead(val uri: String) : MCPMessage()
}

/**
 * MCP capabilities
 */
@Serializable
data class MCPCapabilities(
    val tools: Boolean = true,
    val resources: Boolean = true,
    val prompts: Boolean = false,
    val sampling: Boolean = false
)
