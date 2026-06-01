package com.chainlesschain.android.remote.webrtc

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * FAMILY-31 验收: CallNegotiator 角色协商 —— 字典序确定性 + 互补 + echo-loop 防御 +
 * 人造 collision 退让恰好一端。
 */
class CallNegotiatorTest {

    private val negotiator = CallNegotiator()

    @Test
    fun `lexicographically smaller peer is INITIATOR`() {
        assertEquals(CallRole.INITIATOR, negotiator.decideRole("peer-aaa", "peer-bbb"))
        assertEquals(CallRole.RESPONDER, negotiator.decideRole("peer-bbb", "peer-aaa"))
    }

    @Test
    fun `both sides compute complementary roles (exactly one initiator)`() {
        val a = "did:chain:alice"
        val b = "did:chain:bob"
        val roleA = negotiator.decideRole(a, b) // alice's view
        val roleB = negotiator.decideRole(b, a) // bob's view
        // 恰好一端 INITIATOR、一端 RESPONDER（无双 offer glare）。
        assertTrue(
            (roleA == CallRole.INITIATOR) != (roleB == CallRole.INITIATOR),
            "exactly one side must be INITIATOR (got $roleA / $roleB)",
        )
    }

    @Test
    fun `isInitiator mirrors decideRole`() {
        assertTrue(negotiator.isInitiator("a", "z"))
        assertFalse(negotiator.isInitiator("z", "a"))
    }

    @Test
    fun `echo-loop guard throws when local equals target`() {
        assertFailsWith<IllegalArgumentException> {
            negotiator.decideRole("did:chain:self", "did:chain:self")
        }
        assertFailsWith<IllegalArgumentException> {
            negotiator.shouldRetryOnCollision("x", "x")
        }
    }

    @Test
    fun `collision retry - lexicographically larger backs off, smaller holds`() {
        assertTrue(negotiator.shouldRetryOnCollision("peer-bbb", "peer-aaa"))
        assertFalse(negotiator.shouldRetryOnCollision("peer-aaa", "peer-bbb"))
    }

    @Test
    fun `collision retry picks exactly one side (no deadlock, no double-retry)`() {
        val a = "did:chain:alice"
        val b = "did:chain:bob"
        val aRetries = negotiator.shouldRetryOnCollision(a, b)
        val bRetries = negotiator.shouldRetryOnCollision(b, a)
        assertTrue(aRetries != bRetries, "exactly one side must retry (got $aRetries / $bRetries)")
    }

    @Test
    fun `the side that retries is the responder side (consistent with role assignment)`() {
        // 字典序大者: decideRole=RESPONDER 且 shouldRetryOnCollision=true → 退让方一致。
        val large = "peer-zzz"
        val small = "peer-aaa"
        assertEquals(CallRole.RESPONDER, negotiator.decideRole(large, small))
        assertTrue(negotiator.shouldRetryOnCollision(large, small))
        assertEquals(CallRole.INITIATOR, negotiator.decideRole(small, large))
        assertFalse(negotiator.shouldRetryOnCollision(small, large))
    }

    @Test
    fun `collision retry delay is 200ms per Spike 2 section 5-2`() {
        assertEquals(200L, CallNegotiator.COLLISION_RETRY_MS)
    }
}
