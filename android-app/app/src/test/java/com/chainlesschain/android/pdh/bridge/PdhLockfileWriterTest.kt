package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Headless (plain JVM) test that the lockfile the Android bridge writes is
 * exactly the schema the CLI reader (packages/cli/src/lib/pdh-bridge.js
 * `parseLock`) consumes — the cross-language interop contract for discovery.
 */
class PdhLockfileWriterTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun write_produces_lock_with_reader_schema() {
        val dir = tmp.newFolder("pdh-bridge")
        val w = PdhLockfileWriter(dir)
        val file = w.write(
            port = 53690,
            token = "tok",
            url = "http://127.0.0.1:53690/mcp",
            device = "android",
            appUid = 10306,
            startedAt = 1_700_000_000_000L,
            pid = 4242L,
        )
        assertTrue(file.exists())
        assertEquals("53690.json", file.name)

        val lock = Json.parseToJsonElement(file.readText()).jsonObject
        // Every field the cc-side parseLock reads / validates:
        assertEquals("pdh-bridge", lock["kind"]!!.jsonPrimitive.content)
        assertEquals(1, lock["version"]!!.jsonPrimitive.int)
        assertEquals("http", lock["transport"]!!.jsonPrimitive.content)
        assertEquals("http://127.0.0.1:53690/mcp", lock["url"]!!.jsonPrimitive.content)
        assertEquals(53690, lock["port"]!!.jsonPrimitive.int)
        assertEquals("android", lock["device"]!!.jsonPrimitive.content)
        assertEquals(10306, lock["appUid"]!!.jsonPrimitive.int)
        assertEquals("tok", lock["token"]!!.jsonPrimitive.content)
        assertEquals(4242L, lock["pid"]!!.jsonPrimitive.long)
        assertEquals(1_700_000_000_000L, lock["started_at"]!!.jsonPrimitive.long)
    }

    @Test
    fun remove_deletes_lock() {
        val dir = tmp.newFolder("pdh-bridge")
        val w = PdhLockfileWriter(dir)
        w.write(1, "t", "http://127.0.0.1:1/mcp", "android", 1, 1L, 1L)
        assertTrue(File(dir, "1.json").exists())
        assertTrue(w.remove(1))
        assertFalse(File(dir, "1.json").exists())
    }

    @Test
    fun generate_token_is_64_hex_chars() {
        val t = PdhLockfileWriter.generateToken()
        assertEquals(64, t.length)
        assertTrue(t.all { it in "0123456789abcdef" })
    }
}
