package com.chainlesschain.android.remote.session

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Framework-free JVM coverage for the OPPO (HeyTap) regId source. The OPPO Push
 * SDK is absent from the unit-test classpath, so the default reflection path
 * exercises the "SDK unavailable → null" branch for real.
 */
class OppoTokenProviderTest {

    @Test
    fun `returns the regId from the injected fetcher`() = runBlocking {
        val provider = OppoTokenProvider(fetcher = { "oppo-regid-123" })
        assertEquals("oppo-regid-123", provider.getToken())
    }

    @Test
    fun `exposes the oppo provider tag`() {
        assertEquals("oppo", OppoTokenProvider().provider)
    }

    @Test
    fun `treats a blank regId as null`() = runBlocking {
        assertNull(OppoTokenProvider(fetcher = { "   " }).getToken())
        assertNull(OppoTokenProvider(fetcher = { null }).getToken())
    }

    @Test
    fun `degrades to null when the fetcher throws`() = runBlocking {
        val provider = OppoTokenProvider(fetcher = { throw IllegalStateException("no sdk") })
        assertNull(provider.getToken())
    }

    @Test
    fun `default reflection path returns null without the oppo sdk on the classpath`() = runBlocking {
        // com.heytap.msp.push.HeytapPushManager is not a unit-test dependency →
        // Class.forName fails and the provider yields null instead of crashing.
        assertNull(OppoTokenProvider().getToken())
    }
}
