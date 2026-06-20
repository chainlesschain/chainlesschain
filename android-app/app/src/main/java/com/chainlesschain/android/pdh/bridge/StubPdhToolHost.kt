package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Phase 0 stub tools — they weld the connect / dispatch path end-to-end without
 * touching real collectors (those arrive in Phase 1). `pdh_ping` is a liveness
 * probe; `list_collectors` returns a placeholder so the agent sees the
 * (eventual) capability-surface shape. This is the design's "假工具焊死 connect
 * 链路" — once the CLI side (pdh-bridge.js) connects and lists/calls these, the
 * whole bridge protocol is proven before any real Android capability is wired.
 */
object StubPdhToolHost {

    fun tools(): List<PdhTool> = listOf(Ping, ListCollectors)

    private fun objectSchema(): JsonObject = buildJsonObject {
        put("type", "object")
        putJsonObject("properties") {}
    }

    private object Ping : PdhTool {
        override val name = "pdh_ping"
        override val description = "Liveness probe for the PDH bridge (Phase 0 stub)."
        override val inputSchema = objectSchema()
        override fun call(args: JsonObject): JsonElement = JsonPrimitive("pong")
    }

    private object ListCollectors : PdhTool {
        override val name = "list_collectors"
        override val description =
            "List available data collectors (Phase 0 stub — empty until Phase 1)."
        override val inputSchema = objectSchema()
        override fun call(args: JsonObject): JsonElement = buildJsonObject {
            putJsonArray("collectors") {}
            put("note", "stub: real collectors wired in Phase 1")
        }
    }
}
