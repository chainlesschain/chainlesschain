package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Headless (plain JVM) unit test of the PDH bridge MCP protocol core. Mirrors
 * the JetBrains interop coverage: initialize / tools/list / tools/call (success
 * + unknown + isError) / notification / JSON-RPC errors. Proves the protocol is
 * byte-compatible with what the CLI MCP client expects before any Ktor/Android
 * transport or real collector is wired (Phase 0 "假工具焊死 connect 链路").
 */
class PdhBridgeProtocolTest {

    private val protocol = PdhBridgeProtocol(StubPdhToolHost.tools())

    private fun req(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

    @Test
    fun initialize_returns_protocol_version_and_server_info() {
        val res = protocol.handleMessage(
            req("""{"jsonrpc":"2.0","id":1,"method":"initialize"}"""),
        )!!
        assertEquals("2.0", res["jsonrpc"]!!.jsonPrimitive.content)
        assertEquals(1, res["id"]!!.jsonPrimitive.int)
        val result = res["result"]!!.jsonObject
        assertEquals("2024-11-05", result["protocolVersion"]!!.jsonPrimitive.content)
        assertTrue(result["capabilities"]!!.jsonObject.containsKey("tools"))
        assertEquals(
            "chainlesschain-pdh-android",
            result["serverInfo"]!!.jsonObject["name"]!!.jsonPrimitive.content,
        )
    }

    @Test
    fun tools_list_lists_stub_tools_with_schema() {
        val res = protocol.handleMessage(
            req("""{"jsonrpc":"2.0","id":2,"method":"tools/list"}"""),
        )!!
        val tools = res["result"]!!.jsonObject["tools"]!!.jsonArray
        val names = tools.map { it.jsonObject["name"]!!.jsonPrimitive.content }
        assertTrue(names.contains("pdh_ping"))
        assertTrue(names.contains("list_collectors"))
        tools.forEach {
            assertTrue(it.jsonObject.containsKey("description"))
            assertEquals(
                "object",
                it.jsonObject["inputSchema"]!!.jsonObject["type"]!!.jsonPrimitive.content,
            )
        }
    }

    @Test
    fun tools_call_ping_returns_pong_text() {
        val res = protocol.handleMessage(
            req(
                """{"jsonrpc":"2.0","id":3,"method":"tools/call",""" +
                    """"params":{"name":"pdh_ping","arguments":{}}}""",
            ),
        )!!
        val content = res["result"]!!.jsonObject["content"]!!.jsonArray
        assertEquals("text", content[0].jsonObject["type"]!!.jsonPrimitive.content)
        assertEquals("pong", content[0].jsonObject["text"]!!.jsonPrimitive.content)
    }

    @Test
    fun tools_call_unknown_tool_is_rpc_error() {
        val res = protocol.handleMessage(
            req(
                """{"jsonrpc":"2.0","id":4,"method":"tools/call",""" +
                    """"params":{"name":"nope"}}""",
            ),
        )!!
        assertEquals(-32601, res["error"]!!.jsonObject["code"]!!.jsonPrimitive.int)
    }

    @Test
    fun tool_failure_is_in_band_isError_not_transport_error() {
        val throwing = object : PdhTool {
            override val name = "boom"
            override val description = "throws"
            override val inputSchema = buildJsonObject { put("type", "object") }
            override fun call(args: JsonObject): JsonElement =
                throw IllegalStateException("kaboom")
        }
        val p = PdhBridgeProtocol(listOf(throwing))
        val res = p.handleMessage(
            req(
                """{"jsonrpc":"2.0","id":5,"method":"tools/call",""" +
                    """"params":{"name":"boom","arguments":{}}}""",
            ),
        )!!
        // result envelope (NOT error), carrying isError + the surfaced message
        assertTrue(res.containsKey("result"))
        val result = res["result"]!!.jsonObject
        assertEquals(true, result["isError"]!!.jsonPrimitive.boolean)
        assertTrue(
            result["content"]!!.jsonArray[0].jsonObject["text"]!!
                .jsonPrimitive.content.contains("kaboom"),
        )
    }

    @Test
    fun notification_without_id_yields_no_response() {
        assertNull(
            protocol.handleMessage(
                req("""{"jsonrpc":"2.0","method":"notifications/initialized"}"""),
            ),
        )
    }

    @Test
    fun missing_method_is_invalid_request() {
        val res = protocol.handleMessage(req("""{"jsonrpc":"2.0","id":6}"""))!!
        assertEquals(-32600, res["error"]!!.jsonObject["code"]!!.jsonPrimitive.int)
    }

    @Test
    fun unknown_method_is_method_not_found() {
        val res = protocol.handleMessage(
            req("""{"jsonrpc":"2.0","id":7,"method":"frobnicate"}"""),
        )!!
        assertEquals(-32601, res["error"]!!.jsonObject["code"]!!.jsonPrimitive.int)
    }

    @Test
    fun resources_and_prompts_list_are_empty() {
        val r1 = protocol.handleMessage(
            req("""{"jsonrpc":"2.0","id":8,"method":"resources/list"}"""),
        )!!
        assertTrue(r1["result"]!!.jsonObject["resources"]!!.jsonArray.isEmpty())
        val r2 = protocol.handleMessage(
            req("""{"jsonrpc":"2.0","id":9,"method":"prompts/list"}"""),
        )!!
        assertTrue(r2["result"]!!.jsonObject["prompts"]!!.jsonArray.isEmpty())
    }
}
