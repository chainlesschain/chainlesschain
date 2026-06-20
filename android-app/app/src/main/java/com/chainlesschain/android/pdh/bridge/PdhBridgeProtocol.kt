package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Pure-Kotlin MCP-over-JSON-RPC core for the PDH bridge — the Android device
 * side of module 101 (个人数据 IDE / PDH Bridge). Mirrors the JetBrains plugin's
 * `McpServer.dispatch` (packages/jetbrains-plugin/.../McpServer.java), minus the
 * HTTP / auth / session transport (handled by the Ktor shell `PdhBridgeServer`).
 *
 * Byte-compatible with what the CLI MCP client POSTs (see harness/mcp-client.js):
 * initialize / notifications/initialized / tools/list / tools/call, JSON-RPC 2.0
 * envelopes. The CLI side discovers + connects this server via
 * packages/cli/src/lib/pdh-bridge.js (reserved name `pdh` → `mcp__pdh__*`).
 *
 * No Android / Ktor dependency → unit-testable on a plain JVM (headless), the
 * "纯 JDK 协议核 可 headless 测" the design asks for.
 */
class PdhBridgeProtocol(
    private val tools: List<PdhTool>,
    private val serverName: String = "chainlesschain-pdh-android",
    private val serverVersion: String = "0.1.0",
) {

    /**
     * Handle one parsed JSON-RPC message. Returns the response envelope, or
     * `null` for a notification (no `id`) — the transport acks those with 202.
     */
    fun handleMessage(msg: JsonObject): JsonObject? {
        val id = msg["id"]
        if (id == null || id is JsonNull) return null // notification → no response

        val body: Pair<String, JsonElement> = try {
            val method = (msg["method"] as? JsonPrimitive)?.contentOrNull
            val params = msg["params"] as? JsonObject
            "result" to dispatch(method, params)
        } catch (rpc: RpcException) {
            "error" to errorObj(rpc.code, rpc.message ?: "error")
        } catch (e: Exception) {
            "error" to errorObj(-32603, e.message ?: "Internal error")
        }
        return buildJsonObject {
            put("jsonrpc", "2.0")
            put("id", id)
            put(body.first, body.second)
        }
    }

    private fun dispatch(method: String?, params: JsonObject?): JsonElement {
        if (method == null) throw RpcException(-32600, "Missing method")
        return when (method) {
            "initialize" -> buildJsonObject {
                put("protocolVersion", PROTOCOL_VERSION)
                putJsonObject("capabilities") { putJsonObject("tools") {} }
                putJsonObject("serverInfo") {
                    put("name", serverName)
                    put("version", serverVersion)
                }
            }

            "tools/list" -> buildJsonObject {
                putJsonArray("tools") {
                    tools.forEach { t ->
                        addJsonObject {
                            put("name", t.name)
                            put("description", t.description)
                            put("inputSchema", t.inputSchema)
                        }
                    }
                }
            }

            "tools/call" -> {
                val name = (params?.get("name") as? JsonPrimitive)?.contentOrNull
                val tool = tools.firstOrNull { it.name == name }
                    ?: throw RpcException(-32601, "Unknown tool: $name")
                val args = params?.get("arguments") as? JsonObject ?: EMPTY_OBJECT
                try {
                    toContentResult(tool.call(args))
                } catch (e: Exception) {
                    // Tool failure → in-band isError result, NOT a transport error.
                    errorContent(e.message)
                }
            }

            "resources/list" -> buildJsonObject { putJsonArray("resources") {} }
            "prompts/list" -> buildJsonObject { putJsonArray("prompts") {} }

            else -> throw RpcException(-32601, "Method not found: $method")
        }
    }

    /** A tool's raw return → an MCP content result (pass-through or text-wrap). */
    private fun toContentResult(out: JsonElement): JsonElement {
        if (out is JsonObject && out.containsKey("content")) return out
        val text = if (out is JsonPrimitive && out.isString) out.content else out.toString()
        return contentResult(text, isError = false)
    }

    private fun errorContent(message: String?): JsonObject =
        contentResult("Error: ${message ?: "tool error"}", isError = true)

    private fun contentResult(text: String, isError: Boolean): JsonObject = buildJsonObject {
        putJsonArray("content") {
            addJsonObject {
                put("type", "text")
                put("text", text)
            }
        }
        if (isError) put("isError", true)
    }

    private fun errorObj(code: Int, message: String): JsonObject = buildJsonObject {
        put("code", code)
        put("message", message)
    }

    companion object {
        const val PROTOCOL_VERSION = "2024-11-05"
        private val EMPTY_OBJECT = JsonObject(emptyMap())
    }
}

/** Internal carrier for a JSON-RPC error code + message. */
class RpcException(val code: Int, message: String) : Exception(message)
