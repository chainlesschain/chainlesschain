package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/** Metadata about one wired collector, surfaced by [ListCollectorsTool]. */
data class CollectorInfo(
    val name: String,
    val description: String,
    /** Data layer: L1 files / L2 system / L3 app-api / L4 app-db. */
    val layer: String,
    val requiresRoot: Boolean,
)

/**
 * `list_collectors` — reports which data collectors the bridge actually exposes
 * right now (vs the Phase 0 stub that always returned empty). Pure (no Android
 * deps) → unit-testable; the list is injected by [PdhToolHost].
 */
class ListCollectorsTool(private val collectors: List<CollectorInfo>) : PdhTool {

    override val name = "list_collectors"
    override val description =
        "List the data collectors this device exposes, with their data layer " +
            "and whether root is required."
    override val inputSchema = buildJsonObject {
        put("type", "object")
        putJsonObject("properties") {}
    }

    override fun call(args: JsonObject): JsonElement = buildJsonObject {
        putJsonArray("collectors") {
            collectors.forEach { c ->
                addJsonObject {
                    put("name", c.name)
                    put("description", c.description)
                    put("layer", c.layer)
                    put("requiresRoot", c.requiresRoot)
                }
            }
        }
    }
}
