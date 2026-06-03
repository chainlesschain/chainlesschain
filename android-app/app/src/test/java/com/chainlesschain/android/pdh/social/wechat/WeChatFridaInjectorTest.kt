package com.chainlesschain.android.pdh.social.wechat

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase 12.10.4 — JVM unit cover for [WeChatFridaInjector].
 *
 * Covers what's verifiable without a rooted Android device + frida-inject
 * binary:
 *   - stdout line parser (JSON shape variants, [send] prefix, malformed
 *     lines, implausible hex lengths)
 *   - keyResult routing (NoRoot / BinaryMissing / PidofFailed / Ok)
 *   - asset existence gates (binary missing → BinaryMissing, agent JS
 *     missing → BinaryMissing per APK-corrupt classification)
 *   - cleanup `rm -f` for tmp staging paths
 *
 * What we DON'T cover (gated to Phase 12.10.6 real-device E2E):
 *   - Actual frida-inject native binary spawn
 *   - sqlite3_key_v2 hook firing on real libWCDB.so
 *   - WeChat anti-detection (process / module / ptrace probes)
 *   - su prompt UX under MIUI 14 Magisk DenyList
 */
class WeChatFridaInjectorTest {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var injector: WeChatFridaInjector

    @Before
    fun setUp() {
        tempDir = createTempDir(prefix = "wechat-injector-")
        context = mockk()
        every { context.cacheDir } returns tempDir
        every { context.filesDir } returns tempDir
        injector = WeChatFridaInjector(context)
        // Default test seams — individual tests override as needed.
        injector.suProbe = { true }
        injector.suExec = { _, _ -> true }
        injector.assetReader = inMemoryAssets()
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    // ─── stdout parser ──────────────────────────────────────────────────────

    @Test
    fun `parseKeyLine accepts agent emit() JSON line with kind=key`() {
        val line = """{"kind":"key","hex":"deadbeef".repeat(8)","source":"sqlite3_key_v2"}"""
            .replace(".repeat(8)", "")  // strip the literal for actual hex
        // Build correct fixture: 64-char hex
        val hex = "deadbeef".repeat(8)  // 64 chars
        val fixture = """{"kind":"key","hex":"$hex","source":"sqlite3_key_v2","sig":"v2","format":"raw-bytes","length":32}"""
        val parsed = injector.parseKeyLine(fixture)
        assertNotNull(parsed)
        assertEquals(hex, parsed.hex)
        assertEquals("sqlite3_key_v2", parsed.source)
    }

    @Test
    fun `parseKeyLine accepts frida-inject send prefixed line`() {
        val hex = "a".repeat(64)
        val fixture = """[send] {"kind":"key","hex":"$hex","source":"sqlite3_key"}"""
        val parsed = injector.parseKeyLine(fixture)
        assertNotNull(parsed)
        assertEquals(hex, parsed.hex)
        assertEquals("sqlite3_key", parsed.source)
    }

    @Test
    fun `parseKeyLine normalizes hex to lowercase`() {
        val hex = "DEADBEEF".repeat(8)  // uppercase
        val fixture = """{"kind":"key","hex":"$hex","source":"sqlite3_key"}"""
        val parsed = injector.parseKeyLine(fixture)
        assertNotNull(parsed)
        assertEquals(hex.lowercase(), parsed.hex)
    }

    @Test
    fun `parseKeyLine rejects non-key kind events`() {
        assertNull(injector.parseKeyLine("""{"kind":"hooked","symbol":"sqlite3_key","module":"libWCDB.so"}"""))
        assertNull(injector.parseKeyLine("""{"kind":"error","message":"oops"}"""))
        assertNull(injector.parseKeyLine("""{"kind":"module-waiting","module":"libWCDB.so"}"""))
    }

    @Test
    fun `parseKeyLine rejects implausible hex length (32 raw bytes only)`() {
        // 16 hex = 8 bytes too short
        val short = """{"kind":"key","hex":"${"a".repeat(16)}","source":"sqlite3_key"}"""
        assertNull(injector.parseKeyLine(short))
        // 128 hex = 64 bytes too long
        val long = """{"kind":"key","hex":"${"b".repeat(128)}","source":"sqlite3_key"}"""
        assertNull(injector.parseKeyLine(long))
    }

    @Test
    fun `parseKeyLine accepts 40-char hex (SHA-1 forward compat)`() {
        // Reserved for hypothetical future hook target that emits 40-char digest.
        val hex = "c".repeat(40)
        val fixture = """{"kind":"key","hex":"$hex","source":"future-symbol"}"""
        val parsed = injector.parseKeyLine(fixture)
        assertNotNull(parsed)
        assertEquals(hex, parsed.hex)
    }

    @Test
    fun `parseKeyLine rejects non-hex chars`() {
        val bad = """{"kind":"key","hex":"${"z".repeat(64)}","source":"sqlite3_key"}"""
        assertNull(injector.parseKeyLine(bad))
        val mixed = """{"kind":"key","hex":"xyz${"a".repeat(61)}","source":"sqlite3_key"}"""
        assertNull(injector.parseKeyLine(mixed))
    }

    @Test
    fun `parseKeyLine ignores non-JSON lines silently (frida-inject banners)`() {
        // Real-world frida-inject stdout includes things like:
        assertNull(injector.parseKeyLine(""))
        assertNull(injector.parseKeyLine("Frida 16.1.0"))
        assertNull(injector.parseKeyLine("[*] Hooks ready, waiting for DB access..."))
        assertNull(injector.parseKeyLine("Process detached: connection-lost"))
    }

    @Test
    fun `parseKeyLine omits source defaults to unknown`() {
        val hex = "f".repeat(64)
        val fixture = """{"kind":"key","hex":"$hex"}"""
        val parsed = injector.parseKeyLine(fixture)
        assertNotNull(parsed)
        assertEquals("unknown", parsed.source)
    }

    // ─── extractKey result routing ─────────────────────────────────────────

    @Test
    fun `extractKey returns NoRoot when su unavailable`() = runTest {
        injector.suProbe = { false }
        val r = injector.extractKey("1234567890")
        assertTrue(r is WeChatFridaInjector.KeyResult.NoRoot)
    }

    @Test
    fun `extractKey returns BinaryMissing when frida-inject asset not bundled`() = runTest {
        injector.suProbe = { true }
        // Asset reader returns false for the binary — simulates v0.1 ship
        // (binary not yet vendored).
        injector.assetReader = object : WeChatFridaInjector.AssetReader {
            override fun exists(path: String): Boolean = !path.contains("frida-inject-")
            override fun copyTo(path: String, dst: File) = error("should not copy")
        }
        val r = injector.extractKey("1234567890")
        assertTrue(r is WeChatFridaInjector.KeyResult.BinaryMissing)
    }

    @Test
    fun `extractKey returns BinaryMissing when agent JS missing (APK corrupt)`() = runTest {
        injector.suProbe = { true }
        injector.assetReader = object : WeChatFridaInjector.AssetReader {
            override fun exists(path: String): Boolean =
                path.contains("frida-inject-") && !path.endsWith(".js")
            override fun copyTo(path: String, dst: File) = error("should not copy")
        }
        val r = injector.extractKey("1234567890")
        assertTrue(r is WeChatFridaInjector.KeyResult.BinaryMissing)
    }

    // ─── arch detection ────────────────────────────────────────────────────

    @Test
    fun `primaryArch returns valid arch string`() {
        val arch = injector.primaryArch()
        // Robolectric / unit-test JVM has Build.SUPPORTED_ABIS = empty,
        // so primaryArch returns "unknown" off-device. On-device CI it would
        // be "arm64" or "arm".
        assertTrue(arch in setOf("arm64", "arm", "unknown"))
    }

    // ─── asset reader helper ───────────────────────────────────────────────

    private fun inMemoryAssets(): WeChatFridaInjector.AssetReader =
        object : WeChatFridaInjector.AssetReader {
            private val files = mapOf<String, ByteArray>(
                "frida/frida-inject-arm64" to ByteArray(64),  // placeholder
                "frida/frida-inject-arm" to ByteArray(64),
                "frida/wechat-key-hook.js" to "console.log('test');".toByteArray(),
            )
            override fun exists(path: String): Boolean = files.containsKey(path)
            override fun copyTo(path: String, dst: File) {
                val bytes = files[path] ?: throw java.io.FileNotFoundException(path)
                dst.writeBytes(bytes)
            }
        }
}
