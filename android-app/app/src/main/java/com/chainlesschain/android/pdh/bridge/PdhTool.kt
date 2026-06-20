package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * One MCP tool exposed by the PDH bridge (the Android device-capability server,
 * design module 101). Phase 0 hosts stubs ([StubPdhToolHost]); Phase 1 wires
 * real collect / query / file / task tools backed by Kotlin (collectors,
 * ContentResolver, WebSignBridge, FAMILY executors).
 *
 * No Android / Ktor dependency on this interface → the protocol core that
 * drives it ([PdhBridgeProtocol]) is unit-testable on a plain JVM.
 */
interface PdhTool {
    /** Tool name, surfaced to the agent as `mcp__pdh__<name>`. */
    val name: String

    /** One-line human/LLM description. */
    val description: String

    /** JSON Schema for the tool's arguments (an `object` schema). */
    val inputSchema: JsonObject

    /**
     * Run the tool. Return either an MCP content result (a `{content:[...]}`
     * object — passed through) or any JSON value (wrapped as a single text
     * block). THROW to surface an `isError` result to the caller: a tool
     * failure is reported in-band, NOT as a JSON-RPC transport error.
     */
    fun call(args: JsonObject): JsonElement
}
