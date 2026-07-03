package com.chainlesschain.android.remote.session

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Covers the ordered multi-provider resolution used at pair time: first
 * non-blank token wins, throwing/null providers are skipped, and an all-absent
 * fleet resolves to null (host → relay + local notifications).
 */
class RemoteSessionPushTokenResolverTest {

    private fun provider(tag: String, token: () -> String?) =
        object : RemoteSessionPushTokenProvider {
            override val provider = tag
            override suspend fun getToken(): String? = token()
        }

    @Test
    fun `returns the first provider that yields a token`() = runBlocking {
        val resolver = RemoteSessionPushTokenResolver(
            listOf(
                provider("fcm") { "fcm-tok" },
                provider("vivo") { "vivo-tok" },
            ),
        )
        val resolved = resolver.resolve()
        assertEquals("fcm-tok", resolved?.token)
        assertEquals("fcm", resolved?.provider)
    }

    @Test
    fun `falls through to the next provider when an earlier one is unavailable`() = runBlocking {
        val resolver = RemoteSessionPushTokenResolver(
            listOf(
                provider("fcm") { null },      // Firebase absent (domestic ROM)
                provider("vivo") { "vivo-tok" },
            ),
        )
        val resolved = resolver.resolve()
        assertEquals("vivo-tok", resolved?.token)
        assertEquals("vivo", resolved?.provider)
    }

    @Test
    fun `skips a provider that throws rather than aborting resolution`() = runBlocking {
        val resolver = RemoteSessionPushTokenResolver(
            listOf(
                provider("fcm") { throw IllegalStateException("boom") },
                provider("vivo") { "vivo-tok" },
            ),
        )
        assertEquals("vivo", resolver.resolve()?.provider)
    }

    @Test
    fun `treats a blank token as unavailable and keeps looking`() = runBlocking {
        val resolver = RemoteSessionPushTokenResolver(
            listOf(
                provider("fcm") { "   " },
                provider("vivo") { "vivo-tok" },
            ),
        )
        assertEquals("vivo", resolver.resolve()?.provider)
    }

    @Test
    fun `resolves to null when every provider is unavailable`() = runBlocking {
        val resolver = RemoteSessionPushTokenResolver(
            listOf(
                provider("fcm") { null },
                provider("vivo") { null },
            ),
        )
        assertNull(resolver.resolve())
    }

    @Test
    fun `resolves to null for an empty provider list`() = runBlocking {
        assertNull(RemoteSessionPushTokenResolver(emptyList()).resolve())
    }
}
