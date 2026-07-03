package com.chainlesschain.android.push.vendor

import android.content.Context
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Framework-free JVM coverage for the reflection-wired [XiaomiPushService]. The
 * MiPush SDK (`com.xiaomi.mipush.sdk.MiPushClient`) is absent from the unit-test
 * classpath and BuildConfig Xiaomi creds are empty, so every path exercises the
 * "SDK/creds unavailable → guarded no-op" branch — proving the app never crashes
 * without the AAR.
 */
class XiaomiPushServiceTest {

    private val service = XiaomiPushService(mockk<Context>(relaxed = true))

    @Test
    fun `exposes the xiaomi vendor tag`() {
        assertEquals(PushVendor.Xiaomi, service.vendor)
    }

    @Test
    fun `isIntegrated is false without the mipush sdk on the classpath`() {
        assertFalse(service.isIntegrated())
    }

    @Test
    fun `initialize degrades to false without creds or sdk and is idempotent`() {
        assertFalse(service.initialize())
        assertFalse(service.initialize()) // second call: no crash, still false
    }

    @Test
    fun `currentToken is null without the sdk`() {
        assertNull(service.currentToken())
    }

    @Test
    fun `shutdown is a safe no-op without the sdk`() {
        service.shutdown() // must not throw
    }
}
