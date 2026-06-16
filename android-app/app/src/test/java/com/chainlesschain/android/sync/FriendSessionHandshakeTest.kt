package com.chainlesschain.android.sync

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.e2ee.protocol.PreKeyBundle
import com.chainlesschain.android.core.e2ee.session.E2EESession
import com.chainlesschain.android.core.e2ee.session.InitialMessage
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.e2ee.E2EEHandshakeCodec
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * FAMILY-67: [FriendSessionHandshake]（发起方）单测。P2PClient.sendCommand 经 commandSender seam
 * 替换为 fake（记录 method + 注入响应），避免 mockk 默认参数 $default 字段访问问题。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FriendSessionHandshakeTest {

    private lateinit var p2pClient: P2PClient
    private lateinit var sessionManager: PersistentSessionManager
    private lateinit var didManager: DIDManager
    private lateinit var handshake: FriendSessionHandshake

    private val sentMethods = mutableListOf<String>()
    private val sentParams = mutableListOf<Map<String, Any>>()

    @Before
    fun setup() {
        p2pClient = mockk(relaxed = true)
        sessionManager = mockk(relaxed = true)
        didManager = mockk(relaxed = true)
        handshake = FriendSessionHandshake(p2pClient, sessionManager, didManager)
    }

    private fun installSender(
        response: (String) -> kotlin.Result<Map<String, Any>>,
    ) {
        handshake.commandSender = { method, params ->
            sentMethods += method
            sentParams += params
            response(method)
        }
    }

    @Test
    fun `initiate returns true and sends no command when session exists`() = runTest {
        every { sessionManager.hasSession("did:key:zPeer") } returns true
        installSender { kotlin.Result.success(emptyMap()) }

        val ok = handshake.initiate("did:key:zPeer")

        assertTrue(ok)
        assertTrue(sentMethods.isEmpty())
    }

    @Test
    fun `initiate runs full X3DH handshake and establishes session`() = runTest {
        every { sessionManager.hasSession(any()) } returns false
        every { didManager.getCurrentDID() } returns "did:key:zMe"

        val peerBundle = PreKeyBundle(
            identityKey = byteArrayOf(1, 2, 3),
            signedPreKey = byteArrayOf(4, 5),
            signedPreKeySignature = byteArrayOf(6, 7, 8),
        )
        val initialMessage = InitialMessage(
            identityKey = byteArrayOf(9),
            ephemeralKey = byteArrayOf(10),
            ratchetKey = byteArrayOf(11),
            oneTimePreKeyUsed = false,
        )
        val fakeSession = mockk<E2EESession>(relaxed = true)
        coEvery { sessionManager.createSession("did:key:zPeer", any()) } returns Pair(fakeSession, initialMessage)

        installSender { method ->
            when (method) {
                "e2ee.getBundle" -> kotlin.Result.success(
                    mapOf("bundle" to E2EEHandshakeCodec.encodeBundle(peerBundle)),
                )
                else -> kotlin.Result.success(mapOf("ok" to true))
            }
        }

        val ok = handshake.initiate("did:key:zPeer")

        assertTrue(ok)
        assertEquals(listOf("e2ee.getBundle", "e2ee.init"), sentMethods)
        // e2ee.init 必须带发起方 DID + 可解码的 InitialMessage
        val initParams = sentParams[1]
        assertEquals("did:key:zMe", initParams["fromDid"])
        val decodedIm = E2EEHandshakeCodec.decodeInitialMessage(initParams["initialMessage"] as String)
        assertTrue(initialMessage.identityKey.contentEquals(decodedIm.identityKey))
        coVerify { sessionManager.initialize() }
        coVerify { sessionManager.createSession("did:key:zPeer", any()) }
    }

    @Test
    fun `initiate returns false and cleans up when getBundle fails`() = runTest {
        every { sessionManager.hasSession(any()) } returns false
        every { didManager.getCurrentDID() } returns "did:key:zMe"
        installSender { kotlin.Result.failure(RuntimeException("Not connected")) }

        val ok = handshake.initiate("did:key:zPeer")

        assertFalse(ok)
        assertEquals(listOf("e2ee.getBundle"), sentMethods)
        coVerify { sessionManager.deleteSession("did:key:zPeer") }
    }

    @Test
    fun `initiate returns false when no local DID`() = runTest {
        every { sessionManager.hasSession(any()) } returns false
        every { didManager.getCurrentDID() } returns null
        installSender { kotlin.Result.success(emptyMap()) }

        val ok = handshake.initiate("did:key:zPeer")

        assertFalse(ok)
        assertTrue(sentMethods.isEmpty())
    }
}
