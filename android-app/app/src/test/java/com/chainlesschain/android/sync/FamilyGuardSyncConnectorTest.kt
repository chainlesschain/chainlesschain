package com.chainlesschain.android.sync

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * [FamilyGuardSyncConnector] 纯逻辑单测：offerer 选举 + 直接按 DID 的建连目标筛选。
 * WebRTC 拨号/应答本身设备阻塞，不在此覆盖（真机联调验证）。
 */
class FamilyGuardSyncConnectorTest {

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
}
