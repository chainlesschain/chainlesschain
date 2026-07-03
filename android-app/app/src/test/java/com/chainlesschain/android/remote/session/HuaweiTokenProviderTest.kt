package com.chainlesschain.android.remote.session

import android.content.Context
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Framework-free JVM coverage for the Huawei (HMS) token source. The HMS SDK is
 * absent from the unit-test classpath, so the default reflection path exercises
 * the "HMS unavailable → null" branch for real (and the injected-fetcher path
 * bypasses the Dispatchers.IO offload used for the blocking getToken call).
 */
class HuaweiTokenProviderTest {

    private val context = mockk<Context>(relaxed = true)

    @Test
    fun `returns the token from the injected fetcher`() = runBlocking {
        val provider = HuaweiTokenProvider(context, fetcher = { "hms-token-123" })
        assertEquals("hms-token-123", provider.getToken())
    }

    @Test
    fun `exposes the huawei provider tag`() {
        assertEquals("huawei", HuaweiTokenProvider(context).provider)
    }

    @Test
    fun `treats a blank token as null`() = runBlocking {
        assertNull(HuaweiTokenProvider(context, fetcher = { "   " }).getToken())
        assertNull(HuaweiTokenProvider(context, fetcher = { null }).getToken())
    }

    @Test
    fun `degrades to null when the fetcher throws`() = runBlocking {
        val provider = HuaweiTokenProvider(context, fetcher = { throw IllegalStateException("no sdk") })
        assertNull(provider.getToken())
    }

    @Test
    fun `default reflection path returns null without the hms sdk on the classpath`() = runBlocking {
        // com.huawei.agconnect.config.AGConnectServicesConfig is not a unit-test
        // dependency → Class.forName fails and the provider yields null (via the
        // Dispatchers.IO offload) instead of crashing.
        assertNull(HuaweiTokenProvider(context).getToken())
    }
}
