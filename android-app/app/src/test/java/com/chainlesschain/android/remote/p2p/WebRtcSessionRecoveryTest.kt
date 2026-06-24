package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.sync.FriendSessionHandshake
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * [WebRtcSessionRecovery] 单测：offerer 门控（消除 glare）+ resync + 去抖。
 * 设计 `docs/internal/p2p-self-healing-e2ee-sessions.md` §6.0。
 *
 * offerer = DID 字典序较小方。`AAAA` < `ZZZZ`。
 */
class WebRtcSessionRecoveryTest {

    private lateinit var sessionManager: PersistentSessionManager
    private lateinit var handshake: FriendSessionHandshake
    private lateinit var didManager: DIDManager
    private lateinit var webRTCClient: com.chainlesschain.android.remote.webrtc.WebRTCClient
    private lateinit var recovery: WebRtcSessionRecovery

    private val lowDid = "did:key:z6MkAAAAAAAAAAAAAAAA"
    private val highDid = "did:key:z6MkZZZZZZZZZZZZZZZZ"

    @Before
    fun setup() {
        sessionManager = mockk(relaxed = true)
        handshake = mockk(relaxed = true)
        didManager = mockk(relaxed = true)
        webRTCClient = mockk(relaxed = true)
        coEvery { handshake.initiate(any()) } returns true
        every { webRTCClient.forwardedMessages } returns MutableSharedFlow()
        coEvery { webRTCClient.sendForwardedMessage(any(), any()) } returns Result.success(Unit)
        recovery = WebRtcSessionRecovery(sessionManager, handshake, didManager, webRTCClient)
    }

    @Test
    fun `offerer(本机 DID 较小) 先删会话再重握手`() = runTest {
        every { didManager.getCurrentDID() } returns lowDid // 本机较小 = offerer
        val ok = recovery.recover(highDid)
        assertTrue(ok)
        coVerifyOrder {
            sessionManager.deleteSession(highDid)
            handshake.initiate(highDid)
        }
        coVerify(exactly = 0) { webRTCClient.sendForwardedMessage(any(), any()) }
    }

    @Test
    fun `非 offerer(本机 DID 较大) 不 initiate_只发 resync 请 offerer 重握手`() = runTest {
        every { didManager.getCurrentDID() } returns highDid // 本机较大 = 非 offerer
        val ok = recovery.recover(lowDid)
        assertFalse(ok)
        coVerify(exactly = 1) { webRTCClient.sendForwardedMessage(lowDid, any()) }
        coVerify(exactly = 0) { handshake.initiate(any()) } // 关键：非 offerer 绝不 initiate（无 glare）
        coVerify(exactly = 0) { sessionManager.deleteSession(any()) } // 非 offerer 不删（等 acceptSession 覆盖）
    }

    @Test
    fun `offerer 同 peer 短时间重复触发被去抖`() = runTest {
        every { didManager.getCurrentDID() } returns lowDid
        recovery.recover(highDid)
        val second = recovery.recover(highDid)
        assertFalse(second)
        coVerify(exactly = 1) { handshake.initiate(highDid) }
    }

    @Test
    fun `无本机 DID 时跳过恢复`() = runTest {
        every { didManager.getCurrentDID() } returns null
        val ok = recovery.recover(highDid)
        assertFalse(ok)
        coVerify(exactly = 0) { handshake.initiate(any()) }
        coVerify(exactly = 0) { webRTCClient.sendForwardedMessage(any(), any()) }
    }

    @Test
    fun `offerer 握手未完成时 recover 返回 false`() = runTest {
        every { didManager.getCurrentDID() } returns lowDid
        coEvery { handshake.initiate(highDid) } returns false
        val ok = recovery.recover(highDid)
        assertFalse(ok)
        coVerify { sessionManager.deleteSession(highDid) }
    }
}
