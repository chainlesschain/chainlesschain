package com.chainlesschain.android.remote.session

import android.content.Context
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Framework-free JVM coverage for the Xiaomi (MIUI) regId source. The Xiaomi
 * MiPush SDK is absent from the unit-test classpath, so the default reflection
 * path exercises the "SDK unavailable → null" branch for real.
 */
class XiaomiTokenProviderTest {

    private val context = mockk<Context>(relaxed = true)

    @Test
    fun `returns the regId from the injected fetcher`() = runBlocking {
        val provider = XiaomiTokenProvider(context, fetcher = { "mi-regid-123" })
        assertEquals("mi-regid-123", provider.getToken())
    }

    @Test
    fun `exposes the xiaomi provider tag`() {
        assertEquals("xiaomi", XiaomiTokenProvider(context).provider)
    }

    @Test
    fun `treats a blank regId as null`() = runBlocking {
        assertNull(XiaomiTokenProvider(context, fetcher = { "   " }).getToken())
        assertNull(XiaomiTokenProvider(context, fetcher = { null }).getToken())
    }

    @Test
    fun `degrades to null when the fetcher throws`() = runBlocking {
        val provider = XiaomiTokenProvider(context, fetcher = { throw IllegalStateException("no sdk") })
        assertNull(provider.getToken())
    }

    @Test
    fun `default reflection path returns null without the xiaomi sdk on the classpath`() = runBlocking {
        // com.xiaomi.mipush.sdk.MiPushClient is not a unit-test dependency →
        // Class.forName fails and the provider yields null instead of crashing.
        assertNull(XiaomiTokenProvider(context).getToken())
    }
}
