package com.chainlesschain.android.sync

import com.chainlesschain.android.remote.webrtc.DiscoveredPeer
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * [FamilyGuardSyncConnector] 纯逻辑单测：offerer 选举 + 发现-匹配-拨号目标筛选。
 * WebRTC 拨号/应答本身设备阻塞，不在此覆盖。
 */
class FamilyGuardSyncConnectorTest {

    private fun peer(
        did: String,
        peerId: String = "peer-$did",
        online: Boolean = true,
    ) = DiscoveredPeer(
        peerId = peerId,
        deviceName = "dev",
        ipAddress = "",
        did = did,
        deviceType = "mobile",
        platform = "android",
        isOnline = online,
    )

    // ---- electOfferer ----

    @Test
    fun `electOfferer is deterministic and opposite on the two sides`() {
        val a = "did:key:aaa"
        val b = "did:key:bbb"
        assertTrue(FamilyGuardSyncConnector.electOfferer(a, b))   // a < b → a offers
        assertFalse(FamilyGuardSyncConnector.electOfferer(b, a))  // b waits
    }

    // ---- matchPeersToConnect ----

    @Test
    fun `smaller-did side connects as offerer (initiator)`() {
        val me = "did:key:aaa"          // smaller → I offer
        val guardian = "did:key:zzz"
        val targets = FamilyGuardSyncConnector.matchPeersToConnect(
            myDid = me,
            peerDids = listOf(guardian),
            discovered = listOf(peer(guardian, peerId = "p-zzz")),
        )
        assertEquals(1, targets.size)
        assertEquals(guardian, targets[0].did)
        assertTrue(targets[0].isInitiator)   // offerer
    }

    @Test
    fun `larger-did side connects as responder (non-initiator)`() {
        val me = "did:key:zzz"          // larger → I respond
        val guardian = "did:key:aaa"
        val targets = FamilyGuardSyncConnector.matchPeersToConnect(
            myDid = me,
            peerDids = listOf(guardian),
            discovered = listOf(peer(guardian)),
        )
        assertEquals(1, targets.size)
        assertEquals(guardian, targets[0].did)
        assertFalse(targets[0].isInitiator)  // responder — still connects, just waits for offer
    }

    @Test
    fun `offline, self, unknown-did, blank-peerId and already-connected are filtered`() {
        val me = "did:key:aaa"
        val guardian = "did:key:ggg"
        val other = "did:key:ooo"
        val targets = FamilyGuardSyncConnector.matchPeersToConnect(
            myDid = me,
            peerDids = listOf(guardian, "did:key:offline", "did:key:conn", "did:key:blank"),
            discovered = listOf(
                peer(guardian),                                   // ✓ valid target
                peer(me),                                         // self → skip
                peer(other),                                      // not a paired peer → skip
                peer("did:key:offline", online = false),          // offline → skip
                peer("did:key:conn"),                             // already connected → skip
                peer("did:key:blank", peerId = ""),               // blank peerId → skip
            ),
            alreadyConnected = setOf("did:key:conn"),
        )
        assertEquals(listOf("did:key:ggg"), targets.map { it.did })
    }

    @Test
    fun `duplicate dids dedupe to first peerId`() {
        val me = "did:key:aaa"
        val guardian = "did:key:ggg"
        val targets = FamilyGuardSyncConnector.matchPeersToConnect(
            myDid = me,
            peerDids = listOf(guardian),
            discovered = listOf(
                peer(guardian, peerId = "first"),
                peer(guardian, peerId = "second"),
            ),
        )
        assertEquals(1, targets.size)
        assertEquals("first", targets[0].peerId)
    }

    @Test
    fun `no paired peers yields no targets`() {
        val targets = FamilyGuardSyncConnector.matchPeersToConnect(
            myDid = "did:key:aaa",
            peerDids = emptyList(),
            discovered = listOf(peer("did:key:ggg")),
        )
        assertTrue(targets.isEmpty())
    }
}
