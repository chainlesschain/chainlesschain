package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * Liveness probe tool — kept in the production tool set (not just stubs) so the
 * agent / `cc pdh` can cheaply confirm the bridge responds. No Android deps,
 * so it stays unit-testable.
 */
object PdhPingTool : PdhTool {
    override val name = "pdh_ping"
    override val description = "Liveness probe for the PDH bridge."
    override val inputSchema = buildJsonObject {
        put("type", "object")
        putJsonObject("properties") {}
    }

    override fun call(args: JsonObject): JsonElement = JsonPrimitive("pong")
}
