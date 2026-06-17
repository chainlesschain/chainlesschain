package com.chainlesschain.android.sync

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.PeerInfo
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * [FamilyGuardSyncConnector] 纯逻辑单测：offerer 选举 + 直接按 DID 的建连目标筛选 +
 * connectOnce 单趟建连（单连接守卫 + 连上即停）。
 * WebRTC 拨号/应答本身设备阻塞，不在此覆盖（真机联调验证）。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FamilyGuardSyncConnectorTest {

    private fun relEntity(did: String): FamilyRelationshipEntity =
        mockk { every { friendDid } returns did }

    private fun peer(d: String): PeerInfo = mockk { every { did } returns d }

    private fun connector(
        p2p: P2PClient,
        repo: FamilyRelationshipRepository,
    ): FamilyGuardSyncConnector =
        FamilyGuardSyncConnector(p2p, mockk(relaxed = true), mockk(relaxed = true), repo)

    // ---- electOfferer ----

    @Test
    fun `electOfferer is deterministic and opposite on the two sides`() {
        val a = "did:key:aaa"
        val b = "did:key:bbb"
        assertTrue(FamilyGuardSyncConnector.electOfferer(a, b))   // a < b → a offers
        assertFalse(FamilyGuardSyncConnector.electOfferer(b, a))  // b responds
    }

    // ---- targetsFor ----

    @Test
    fun `smaller-did side connects as offerer (initiator)`() {
        val me = "did:key:aaa"          // smaller → I offer
        val guardian = "did:key:zzz"
        val targets = FamilyGuardSyncConnector.targetsFor(
            myDid = me,
            peerDids = listOf(guardian),
        )
        assertEquals(1, targets.size)
        assertEquals(guardian, targets[0].did)
        assertTrue(targets[0].isInitiator)   // offerer
    }

    @Test
    fun `larger-did side connects as responder (non-initiator)`() {
        val me = "did:key:zzz"          // larger → I respond
        val guardian = "did:key:aaa"
        val targets = FamilyGuardSyncConnector.targetsFor(
            myDid = me,
            peerDids = listOf(guardian),
        )
        assertEquals(1, targets.size)
        assertEquals(guardian, targets[0].did)
        assertFalse(targets[0].isInitiator)  // responder — still connects, just waits for offer
    }

    @Test
    fun `self, blank and already-connected are filtered`() {
        val me = "did:key:aaa"
        val targets = FamilyGuardSyncConnector.targetsFor(
            myDid = me,
            peerDids = listOf("did:key:ggg", me, "", "did:key:conn"),
            alreadyConnected = setOf("did:key:conn"),
        )
        assertEquals(listOf("did:key:ggg"), targets.map { it.did })
    }

    @Test
    fun `duplicate dids dedupe`() {
        val me = "did:key:aaa"
        val guardian = "did:key:ggg"
        val targets = FamilyGuardSyncConnector.targetsFor(
            myDid = me,
            peerDids = listOf(guardian, guardian),
        )
        assertEquals(1, targets.size)
        assertEquals(guardian, targets[0].did)
    }

    @Test
    fun `no paired peers yields no targets`() {
        val targets = FamilyGuardSyncConnector.targetsFor(
            myDid = "did:key:aaa",
            peerDids = emptyList(),
        )
        assertTrue(targets.isEmpty())
    }

    // ---- connectOnce（单趟建连）----

    @Test
    fun `connectOnce skips dialing when a paired peer is already connected`() = runTest {
        // 已与某已配对 peer 连上 → 单连接守卫：不再拨号（否则会把好连接拆掉）
        val p2p = mockk<P2PClient>(relaxed = true)
        every { p2p.connectedPeers } returns MutableStateFlow(mapOf("did:key:peer" to peer("did:key:peer")))
        val repo = mockk<FamilyRelationshipRepository>(relaxed = true)
        every { repo.observeAllActive() } returns flowOf(listOf(relEntity("did:key:peer")))

        val pending = connector(p2p, repo).connectOnce("did:key:me")

        assertEquals(0, pending)
        coVerify(exactly = 0) { p2p.connectFamilyPeer(any(), any(), any()) }
    }

    @Test
    fun `connectOnce dials all unconnected paired peers and returns their count`() = runTest {
        val p2p = mockk<P2PClient>(relaxed = true)
        val connected = MutableStateFlow<Map<String, PeerInfo>>(emptyMap())
        every { p2p.connectedPeers } returns connected
        // 拨号"成功"但不改 connectedPeers（模拟仍在协商）→ 不触发连上即停，两个都拨
        coEvery { p2p.connectFamilyPeer("did:key:p1", any(), any()) } returns Result.success(Unit)
        coEvery { p2p.connectFamilyPeer("did:key:p2", any(), any()) } returns Result.success(Unit)
        val repo = mockk<FamilyRelationshipRepository>(relaxed = true)
        every { repo.observeAllActive() } returns
            flowOf(listOf(relEntity("did:key:p1"), relEntity("did:key:p2")))

        // me 字典序最小 → 对两个 peer 都是 offerer，两个都是 target
        val pending = connector(p2p, repo).connectOnce("did:key:aaa")

        assertEquals(2, pending)
        coVerify(exactly = 1) { p2p.connectFamilyPeer("did:key:p1", "did:key:aaa", any()) }
        coVerify(exactly = 1) { p2p.connectFamilyPeer("did:key:p2", "did:key:aaa", any()) }
    }

    @Test
    fun `connectOnce stops dialing once a connection is established`() = runTest {
        val p2p = mockk<P2PClient>(relaxed = true)
        val connected = MutableStateFlow<Map<String, PeerInfo>>(emptyMap())
        every { p2p.connectedPeers } returns connected
        // 第一个 peer 拨号成功 → connectedPeers 出现它 → 连上即停，不再拨第二个
        coEvery { p2p.connectFamilyPeer("did:key:p1", any(), any()) } answers {
            connected.value = mapOf("did:key:p1" to peer("did:key:p1"))
            Result.success(Unit)
        }
        coEvery { p2p.connectFamilyPeer("did:key:p2", any(), any()) } returns Result.success(Unit)
        val repo = mockk<FamilyRelationshipRepository>(relaxed = true)
        every { repo.observeAllActive() } returns
            flowOf(listOf(relEntity("did:key:p1"), relEntity("did:key:p2")))

        val pending = connector(p2p, repo).connectOnce("did:key:aaa")

        assertEquals(2, pending) // 返回 targets.size，不因 break 改变
        coVerify(exactly = 1) { p2p.connectFamilyPeer("did:key:p1", any(), any()) }
        coVerify(exactly = 0) { p2p.connectFamilyPeer("did:key:p2", any(), any()) }
    }
}
