package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.URL
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Real-HTTP integration test of the PDH bridge Ktor shell: a live
 * embeddedServer(CIO) (which runs on a plain JVM, not just Android) driven by
 * HttpURLConnection — proving the same connect / list / call / Bearer-auth path
 * the CLI MCP client (pdh-bridge.js → MCPClient) hits on-device, plus the
 * lockfile lifecycle. Headless: PdhBridgeServer references no Android API.
 */
class PdhBridgeServerTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private var server: PdhBridgeServer? = null

    @After
    fun tearDown() {
        server?.stop()
    }

    private fun startServer(): PdhBridgeServer {
        val dir = tmp.newFolder("pdh-bridge")
        val s = PdhBridgeServer(
            lockDir = dir,
            tools = StubPdhToolHost.tools(),
            appUid = 10306,
            nowMs = { 1_700_000_000_000L },
            pid = { 4242L },
        )
        val res = s.start()
        assertTrue(res.isSuccess, "server should start: ${res.exceptionOrNull()?.message}")
        server = s
        return s
    }

    /** POST with a brief connection-refused retry (CIO bind can lag start()). */
    private fun post(url: String, body: String, token: String?): Pair<Int, String> {
        var lastErr: Exception? = null
        repeat(20) {
            try {
                val conn = (URL(url).openConnection() as HttpURLConnection)
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = 2000
                conn.readTimeout = 5000
                conn.setRequestProperty("Content-Type", "application/json")
                if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader()?.readText() ?: ""
                return code to text
            } catch (e: ConnectException) {
                lastErr = e
                Thread.sleep(50)
            }
        }
        throw lastErr ?: IllegalStateException("connect failed")
    }

    @Test
    fun start_writes_lockfile_then_stop_removes_it() {
        val s = startServer()
        val lock = File(tmp.root, "pdh-bridge/${s.boundPort}.json")
        assertTrue(lock.exists(), "lockfile written on start")
        val obj = Json.parseToJsonElement(lock.readText()).jsonObject
        assertEquals("pdh-bridge", obj["kind"]!!.jsonPrimitive.content)
        assertEquals(s.token, obj["token"]!!.jsonPrimitive.content)
        assertEquals(s.boundPort, obj["port"]!!.jsonPrimitive.int)
        s.stop()
        assertFalse(lock.exists(), "lockfile removed on stop")
    }

    @Test
    fun initialize_over_http_returns_protocol_version() {
        val s = startServer()
        val (code, text) = post(
            s.url!!,
            """{"jsonrpc":"2.0","id":1,"method":"initialize"}""",
            s.token,
        )
        assertEquals(200, code)
        val res = Json.parseToJsonElement(text).jsonObject["result"]!!.jsonObject
        assertEquals("2024-11-05", res["protocolVersion"]!!.jsonPrimitive.content)
    }

    @Test
    fun tools_call_ping_over_http_returns_pong() {
        val s = startServer()
        val (code, text) = post(
            s.url!!,
            """{"jsonrpc":"2.0","id":2,"method":"tools/call",""" +
                """"params":{"name":"pdh_ping","arguments":{}}}""",
            s.token,
        )
        assertEquals(200, code)
        val content = Json.parseToJsonElement(text).jsonObject["result"]!!
            .jsonObject["content"]!!.jsonArray
        assertEquals("pong", content[0].jsonObject["text"]!!.jsonPrimitive.content)
    }

    @Test
    fun wrong_bearer_is_401() {
        val s = startServer()
        val (code, _) = post(
            s.url!!,
            """{"jsonrpc":"2.0","id":3,"method":"initialize"}""",
            "wrong-token",
        )
        assertEquals(401, code)
    }

    @Test
    fun notification_is_202() {
        val s = startServer()
        val (code, _) = post(
            s.url!!,
            """{"jsonrpc":"2.0","method":"notifications/initialized"}""",
            s.token,
        )
        assertEquals(202, code)
    }
}
