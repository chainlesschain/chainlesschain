package com.chainlesschain.android.remote.session

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Framework-free JVM coverage for the FCM token source. The Firebase Messaging
 * SDK is absent from the unit-test classpath, so the default reflection path
 * exercises the "Firebase unavailable → null" branch for real.
 */
class FcmTokenProviderTest {

    @Test
    fun `returns the token from the injected fetcher`() = runBlocking {
        val provider = FcmTokenProvider(fetcher = { "fcm-token-123" })
        assertEquals("fcm-token-123", provider.getToken())
    }

    @Test
    fun `treats a blank token as null`() = runBlocking {
        assertNull(FcmTokenProvider(fetcher = { "   " }).getToken())
        assertNull(FcmTokenProvider(fetcher = { null }).getToken())
    }

    @Test
    fun `degrades to null when the fetcher throws`() = runBlocking {
        val provider = FcmTokenProvider(fetcher = { throw IllegalStateException("no network") })
        assertNull(provider.getToken())
    }

    @Test
    fun `default reflection path returns null without firebase on the classpath`() = runBlocking {
        // FirebaseMessaging is not a unit-test dependency → Class.forName fails
        // and the provider yields null instead of crashing.
        assertNull(FcmTokenProvider().getToken())
    }
}
