package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.sync.FriendSessionHandshake
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * [WebRtcSessionRecovery] 自愈逻辑单测：删旧会话 → 重握手 → 去抖。
 * 设计 `docs/internal/p2p-self-healing-e2ee-sessions.md`。
 */
class WebRtcSessionRecoveryTest {

    private lateinit var sessionManager: PersistentSessionManager
    private lateinit var handshake: FriendSessionHandshake
    private lateinit var recovery: WebRtcSessionRecovery

    private val peer = "did:key:z6MkPeerAAAAAAAAAAAAAAAA"

    @Before
    fun setup() {
        sessionManager = mockk(relaxed = true)
        handshake = mockk(relaxed = true)
        coEvery { handshake.initiate(any()) } returns true
        recovery = WebRtcSessionRecovery(sessionManager, handshake)
    }

    @Test
    fun `recover 先删发散会话再重握手`() = runTest {
        val ok = recovery.recover(peer)
        assertTrue(ok)
        coVerifyOrder {
            sessionManager.deleteSession(peer)
            handshake.initiate(peer)
        }
    }

    @Test
    fun `同 peer 短时间重复触发被去抖_只重建一次`() = runTest {
        recovery.recover(peer)
        val second = recovery.recover(peer) // 10s 内 → 去抖
        assertFalse(second)
        coVerify(exactly = 1) { sessionManager.deleteSession(peer) }
        coVerify(exactly = 1) { handshake.initiate(peer) }
    }

    @Test
    fun `不同 peer 不互相去抖`() = runTest {
        val peerB = "did:key:z6MkPeerBBBBBBBBBBBBBBBB"
        recovery.recover(peer)
        recovery.recover(peerB)
        coVerify(exactly = 1) { handshake.initiate(peer) }
        coVerify(exactly = 1) { handshake.initiate(peerB) }
    }

    @Test
    fun `握手未完成时 recover 返回 false_但仍删了旧会话`() = runTest {
        coEvery { handshake.initiate(peer) } returns false
        val ok = recovery.recover(peer)
        assertFalse(ok)
        coVerify { sessionManager.deleteSession(peer) }
    }
}
