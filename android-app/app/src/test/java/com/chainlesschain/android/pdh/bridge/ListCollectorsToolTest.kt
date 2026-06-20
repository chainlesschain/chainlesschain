package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Headless tests for the pure (Android-free) Phase 1 tools: list_collectors
 * reflects its injected collector metadata, and pdh_ping. The real
 * CollectSystemDataTool (ContentResolver + cc subprocess) is validated
 * on-device, not here.
 */
class ListCollectorsToolTest {

    private val emptyArgs = JsonObject(emptyMap())

    @Test
    fun lists_injected_collectors_with_layer_and_root() {
        val tool = ListCollectorsTool(
            listOf(
                CollectorInfo("collect_system_data", "system data", "L2", false),
                CollectorInfo("salvage_app_data", "root salvage", "L4", true),
            ),
        )
        val arr = tool.call(emptyArgs).jsonObject["collectors"]!!.jsonArray
        assertEquals(2, arr.size)
        assertEquals("collect_system_data", arr[0].jsonObject["name"]!!.jsonPrimitive.content)
        assertEquals("L2", arr[0].jsonObject["layer"]!!.jsonPrimitive.content)
        assertEquals(false, arr[0].jsonObject["requiresRoot"]!!.jsonPrimitive.boolean)
        assertEquals("L4", arr[1].jsonObject["layer"]!!.jsonPrimitive.content)
        assertEquals(true, arr[1].jsonObject["requiresRoot"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun empty_collectors_yields_empty_array() {
        val arr = ListCollectorsTool(emptyList()).call(emptyArgs).jsonObject["collectors"]!!.jsonArray
        assertTrue(arr.isEmpty())
    }

    @Test
    fun ping_returns_pong() {
        assertEquals("pong", (PdhPingTool.call(emptyArgs) as JsonPrimitive).content)
    }
}
