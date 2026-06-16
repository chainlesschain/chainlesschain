package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.core.e2ee.protocol.PreKeyBundle
import com.chainlesschain.android.core.e2ee.session.InitialMessage
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.remote.p2p.e2ee.E2EEHandshakeCodec
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * FAMILY-67: [E2EEHandshakeCommandRouter]（响应方）单测。SessionManager 用 mockk。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class E2EEHandshakeCommandRouterTest {

    private lateinit var sessionManager: PersistentSessionManager
    private lateinit var router: E2EEHandshakeCommandRouter

    @Before
    fun setup() {
        sessionManager = mockk(relaxed = true)
        router = E2EEHandshakeCommandRouter(sessionManager)
    }

    @Test
    fun `e2ee_getBundle ensures init and returns encoded bundle`() = runTest {
        val bundle = PreKeyBundle(
            identityKey = byteArrayOf(1, 2),
            signedPreKey = byteArrayOf(3, 4),
            signedPreKeySignature = byteArrayOf(5, 6),
        )
        every { sessionManager.getPreKeyBundle() } returns bundle

        @Suppress("UNCHECKED_CAST")
        val result = router.route("e2ee.getBundle", emptyMap()) as Map<String, Any>

        coVerify { sessionManager.initialize() }
        val decoded = E2EEHandshakeCodec.decodeBundle(result["bundle"] as String)
        assertTrue(bundle.identityKey.contentEquals(decoded.identityKey))
    }

    @Test
    fun `e2ee_init accepts session for fromDid`() = runTest {
        val initialMessage = InitialMessage(
            identityKey = byteArrayOf(1),
            ephemeralKey = byteArrayOf(2),
            ratchetKey = byteArrayOf(3),
            oneTimePreKeyUsed = false,
        )
        val imSlot = slot<InitialMessage>()
        coEvery { sessionManager.acceptSession(any(), capture(imSlot)) } returns mockk(relaxed = true)

        @Suppress("UNCHECKED_CAST")
        val result = router.route(
            "e2ee.init",
            mapOf(
                "fromDid" to "did:key:zPeer",
                "initialMessage" to E2EEHandshakeCodec.encodeInitialMessage(initialMessage),
            ),
        ) as Map<String, Any>

        assertEquals(true, result["ok"])
        coVerify { sessionManager.acceptSession("did:key:zPeer", any()) }
        assertTrue(initialMessage.identityKey.contentEquals(imSlot.captured.identityKey))
    }

    @Test
    fun `e2ee_init missing fromDid throws`() = runTest {
        val ex = assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking {
                router.route("e2ee.init", mapOf("initialMessage" to "{}"))
            }
        }
        assertTrue(ex.message!!.contains("fromDid"))
    }

    @Test
    fun `unknown e2ee method throws`() = runTest {
        val ex = assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking {
                router.route("e2ee.bogus", emptyMap())
            }
        }
        assertTrue(ex.message!!.contains("Unknown e2ee method"))
    }
}
