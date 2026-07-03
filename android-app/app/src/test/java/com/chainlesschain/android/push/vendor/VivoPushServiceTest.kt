package com.chainlesschain.android.push.vendor

import android.content.Context
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Framework-free JVM coverage for the reflection-wired [VivoPushService]. The
 * vivo Push SDK (`com.vivo.push.PushClient`) is absent from the unit-test
 * classpath, so every reflection path exercises the "SDK unavailable → guarded
 * no-op" branch for real — proving the app never crashes without the AAR.
 */
class VivoPushServiceTest {

    private val service = VivoPushService(mockk<Context>(relaxed = true))

    @Test
    fun `exposes the vivo vendor tag`() {
        assertEquals(PushVendor.Vivo, service.vendor)
    }

    @Test
    fun `isIntegrated is false without the vivo sdk on the classpath`() {
        assertFalse(service.isIntegrated())
    }

    @Test
    fun `initialize degrades to false without the sdk and is idempotent`() {
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
