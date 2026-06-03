package com.chainlesschain.android.config

import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * v1.2 prep #2 — [TurnEphemeralCredentialsClient.parseResponse] + HTTPS 校验单测。
 *
 * 用 Robolectric runner 才能跑真 [org.json.JSONObject]（Android stub jar 里
 * JSONObject ctor throws "Stub!"）。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class TurnEphemeralCredentialsClientTest {

    private val client = TurnEphemeralCredentialsClient()

    @Test
    fun `parseResponse parses Twilio-shape body`() {
        val json = """
            {
                "username": "1736500000:user-id",
                "password": "secret-base64",
                "ttl": 3600,
                "uris": [
                    "turn:turn.example.com:3478?transport=tcp",
                    "turn:turn.example.com:80",
                    "turns:turn.example.com:443"
                ]
            }
        """.trimIndent()
        val creds = client.parseResponse(json)
        assertEquals("1736500000:user-id", creds.username)
        assertEquals("secret-base64", creds.password)
        assertEquals(3600L, creds.ttlSeconds)
        assertEquals(3, creds.uris.size)
        assertEquals("turn:turn.example.com:3478?transport=tcp", creds.uris[0])
    }

    @Test
    fun `parseResponse missing username throws`() {
        val json = """{"password":"x","ttl":3600,"uris":[]}"""
        assertFailsWith<IllegalArgumentException> { client.parseResponse(json) }
    }

    @Test
    fun `parseResponse missing password throws`() {
        val json = """{"username":"u","ttl":3600,"uris":[]}"""
        assertFailsWith<IllegalArgumentException> { client.parseResponse(json) }
    }

    @Test
    fun `parseResponse missing ttl falls back to 24h`() {
        val json = """{"username":"u","password":"p","uris":["turn:x:3478"]}"""
        val creds = client.parseResponse(json)
        assertEquals(TurnEphemeralCredentialsClient.DEFAULT_TTL_SEC, creds.ttlSeconds)
    }

    @Test
    fun `parseResponse missing uris yields empty list`() {
        val json = """{"username":"u","password":"p","ttl":3600}"""
        val creds = client.parseResponse(json)
        assertTrue(creds.uris.isEmpty())
    }

    @Test
    fun `parseResponse blank entries in uris filtered`() {
        val json = """{"username":"u","password":"p","ttl":3600,"uris":["turn:a:3478","",""]}"""
        val creds = client.parseResponse(json)
        assertEquals(1, creds.uris.size)
        assertEquals("turn:a:3478", creds.uris[0])
    }

    @Test
    fun `fetch rejects non-https URL`() = runTest {
        // require-fail short-circuits before any network IO; runTest 安全
        assertFailsWith<IllegalArgumentException> {
            client.fetch("http://insecure.example.com/turn-credentials")
        }
        assertFailsWith<IllegalArgumentException> {
            client.fetch("ftp://invalid")
        }
    }

    @Test
    fun `expiresAtMs and isExpired derived from ttl plus fetchedAt`() {
        val creds = TurnEphemeralCredentials(
            username = "u",
            password = "p",
            ttlSeconds = 60,
            uris = emptyList(),
            fetchedAtMs = 1000L,
        )
        assertEquals(1000L + 60_000L, creds.expiresAtMs)
        assertTrue(creds.isExpired(nowMs = 100_000L))
        assertTrue(!creds.isExpired(nowMs = 500L))
    }

    @Test
    fun `toTurnServers maps each URI to a TurnServerCredentials sharing username password`() {
        val creds = TurnEphemeralCredentials(
            username = "alice",
            password = "wonderland",
            ttlSeconds = 3600,
            uris = listOf("turn:a:3478", "turn:b:3478?transport=tcp"),
            fetchedAtMs = 0L,
        )
        val list = creds.toTurnServers()
        assertEquals(2, list.size)
        assertEquals("turn:a:3478", list[0].url)
        assertEquals("alice", list[0].username)
        assertEquals("wonderland", list[1].password)
    }

    @Test
    fun `parseResponse malformed JSON throws`() {
        assertFails { client.parseResponse("not json {") }
    }
}
