package com.chainlesschain.android.push.vendor

import android.content.Context
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Framework-free JVM coverage for the reflection-wired [HuaweiPushService]. The
 * HMS SDK (`com.huawei.hms.push.HmsMessaging`) is absent from the unit-test
 * classpath, so every path exercises the "SDK unavailable → guarded no-op"
 * branch — proving the app never crashes without the SDK.
 */
class HuaweiPushServiceTest {

    private val service = HuaweiPushService(mockk<Context>(relaxed = true))

    @Test
    fun `exposes the huawei vendor tag`() {
        assertEquals(PushVendor.Huawei, service.vendor)
    }

    @Test
    fun `isIntegrated is false without the hms sdk on the classpath`() {
        assertFalse(service.isIntegrated())
    }

    @Test
    fun `initialize degrades to false without the sdk and is idempotent`() {
        assertFalse(service.initialize())
        assertFalse(service.initialize()) // second call: no crash, still false
    }

    @Test
    fun `currentToken is null (delivered async via HmsMessageService)`() {
        assertNull(service.currentToken())
    }

    @Test
    fun `shutdown is a safe no-op without the sdk`() {
        service.shutdown() // must not throw
    }
}
