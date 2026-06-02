package com.chainlesschain.android.familyguard.time

import com.chainlesschain.android.core.p2p.pairing.PairedPeer
import com.chainlesschain.android.core.p2p.pairing.PairedPeersStore
import com.chainlesschain.android.remote.webrtc.FamilyTimeRpcClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * FAMILY-60 验收: [P2PParentTimeSource] 家长 peer 解析 + 委托 [FamilyTimeRpcClient]。
 * 无配对对端 → 不调 rpc 返 null; 有对端 → 用其 pcPeerId 拉取; rpc 不可达透传 null。
 */
class P2PParentTimeSourceTest {

    private fun peer(pcPeerId: String): PairedPeer =
        mockk { every { this@mockk.pcPeerId } returns pcPeerId }

    @Test
    fun `returns null and skips rpc when no peer paired`() = runTest {
        val rpc = mockk<FamilyTimeRpcClient>()
        val store = mockk<PairedPeersStore> {
            every { devices } returns MutableStateFlow(emptyList())
        }
        val src = P2PParentTimeSource(rpc, store)

        assertNull(src.fetchParentEpochMs())
        coVerify(exactly = 0) { rpc.fetchParentEpochMs(any(), any()) }
    }

    @Test
    fun `delegates to rpc with first paired peer pcPeerId`() = runTest {
        val rpc = mockk<FamilyTimeRpcClient> {
            coEvery { fetchParentEpochMs("desktop-peer-1", any()) } returns 1_717_000_000_000L
        }
        val store = mockk<PairedPeersStore> {
            every { devices } returns MutableStateFlow(listOf(peer("desktop-peer-1")))
        }
        val src = P2PParentTimeSource(rpc, store)

        assertEquals(1_717_000_000_000L, src.fetchParentEpochMs())
    }

    @Test
    fun `returns null when rpc reports parent unreachable`() = runTest {
        val rpc = mockk<FamilyTimeRpcClient> {
            coEvery { fetchParentEpochMs(any(), any()) } returns null
        }
        val store = mockk<PairedPeersStore> {
            every { devices } returns MutableStateFlow(listOf(peer("desktop-peer-1")))
        }
        val src = P2PParentTimeSource(rpc, store)

        assertNull(src.fetchParentEpochMs())
    }
}
