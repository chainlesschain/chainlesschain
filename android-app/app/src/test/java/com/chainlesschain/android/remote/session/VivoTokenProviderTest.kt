package com.chainlesschain.android.remote.session

import android.content.Context
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Framework-free JVM coverage for the vivo regId source. The vivo Push SDK is
 * absent from the unit-test classpath, so the default reflection path exercises
 * the "SDK unavailable → null" branch for real.
 */
class VivoTokenProviderTest {

    private val context = mockk<Context>(relaxed = true)

    @Test
    fun `returns the regId from the injected fetcher`() = runBlocking {
        val provider = VivoTokenProvider(context, fetcher = { "vivo-regid-123" })
        assertEquals("vivo-regid-123", provider.getToken())
    }

    @Test
    fun `exposes the vivo provider tag`() {
        assertEquals("vivo", VivoTokenProvider(context).provider)
    }

    @Test
    fun `treats a blank regId as null`() = runBlocking {
        assertNull(VivoTokenProvider(context, fetcher = { "   " }).getToken())
        assertNull(VivoTokenProvider(context, fetcher = { null }).getToken())
    }

    @Test
    fun `degrades to null when the fetcher throws`() = runBlocking {
        val provider = VivoTokenProvider(context, fetcher = { throw IllegalStateException("no sdk") })
        assertNull(provider.getToken())
    }

    @Test
    fun `default reflection path returns null without the vivo sdk on the classpath`() = runBlocking {
        // com.vivo.push.PushClient is not a unit-test dependency → Class.forName
        // fails and the provider yields null instead of crashing.
        assertNull(VivoTokenProvider(context).getToken())
    }
}
