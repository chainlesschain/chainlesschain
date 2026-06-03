package com.chainlesschain.android.sign

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * v1.2 #20 P0.3 — [MultisigState] validation + helper 测试。
 *
 * 协议层校验 (init block) 在桌面 schema 漂移 / 重放伪造时 fail-fast；UI helper
 * 测确认 "X/Y" 显示 + final-signer 判断对各种 m/n 组合都对。
 */
class MultisigStateTest {

    private val twoOfTwo = MultisigState(
        m = 2,
        n = 2,
        collected = 1,
        signerDids = listOf("did:cc:phone", "did:cc:desktop-ukey"),
        pendingSigners = listOf("did:cc:phone"),
    )

    private val twoOfThreeMid = MultisigState(
        m = 2,
        n = 3,
        collected = 0,
        signerDids = listOf("did:cc:phone", "did:cc:desktop", "did:cc:tablet"),
        pendingSigners = listOf("did:cc:phone", "did:cc:desktop", "did:cc:tablet"),
    )

    @Test
    fun `valid 2-of-2 round-trips`() {
        assertEquals(2, twoOfTwo.m)
        assertEquals(2, twoOfTwo.n)
        assertEquals(1, twoOfTwo.collected)
        assertEquals(2, twoOfTwo.signerDids.size)
    }

    @Test
    fun `progressLabel reflects post-sign count`() {
        // 2-of-2 collected=1 → phone 签后 = 2/2
        assertEquals("2 / 2", twoOfTwo.progressLabel())
        // 2-of-3 collected=0 → 首签后 = 1/2（不是 1/3，因为 m=2 是阈值）
        assertEquals("1 / 2", twoOfThreeMid.progressLabel())
    }

    @Test
    fun `progressLabel caps at m when collected already at threshold`() {
        // collected 已等于 m 的退化情况不该让 X 超过 Y
        val edge = MultisigState(
            m = 2,
            n = 3,
            collected = 2,
            signerDids = listOf("a", "b", "c"),
            pendingSigners = emptyList(),
        )
        assertEquals("2 / 2", edge.progressLabel())
    }

    @Test
    fun `isFinalSigner true when collected+1 reaches m`() {
        assertTrue(twoOfTwo.isFinalSigner()) // 1+1=2 >= 2
        assertFalse(twoOfThreeMid.isFinalSigner()) // 0+1=1 < 2
    }

    @Test
    fun `remainingAfterThisSign clamps at zero`() {
        assertEquals(0, twoOfTwo.remainingAfterThisSign()) // m-collected-1 = 0
        assertEquals(1, twoOfThreeMid.remainingAfterThisSign()) // 2-0-1 = 1
        val overSigned = MultisigState(
            m = 2,
            n = 3,
            collected = 3,
            signerDids = listOf("a", "b", "c"),
            pendingSigners = emptyList(),
        )
        assertEquals(0, overSigned.remainingAfterThisSign())
    }

    @Test
    fun `shortDid truncates long DIDs and leaves short ones intact`() {
        val long = "did:cc:abcdefghijklmnopqrstuvwxyz0123456789"
        val short = twoOfTwo.shortDid(long)
        assertTrue("expected ellipsis", short.contains("…"))
        assertTrue("expected prefix", short.startsWith("did:cc:abc"))

        val literal = "did:cc:short"
        assertEquals(literal, twoOfTwo.shortDid(literal))
    }

    @Test
    fun `init rejects m greater than n`() {
        val ex = assertThrows(IllegalArgumentException::class.java) {
            MultisigState(
                m = 3,
                n = 2,
                collected = 0,
                signerDids = listOf("a", "b"),
                pendingSigners = emptyList(),
            )
        }
        assertTrue(ex.message!!.contains("m must be in 1..n"))
    }

    @Test
    fun `init rejects m equal zero`() {
        val ex = assertThrows(IllegalArgumentException::class.java) {
            MultisigState(
                m = 0,
                n = 2,
                collected = 0,
                signerDids = listOf("a", "b"),
                pendingSigners = emptyList(),
            )
        }
        assertTrue(ex.message!!.contains("m must be in 1..n"))
    }

    @Test
    fun `init rejects signerDids size mismatch`() {
        val ex = assertThrows(IllegalArgumentException::class.java) {
            MultisigState(
                m = 2,
                n = 3,
                collected = 0,
                signerDids = listOf("a", "b"), // size 2 ≠ n=3
                pendingSigners = emptyList(),
            )
        }
        assertTrue(ex.message!!.contains("signerDids size"))
    }

    @Test
    fun `init rejects pendingSigners not subset of signerDids`() {
        val ex = assertThrows(IllegalArgumentException::class.java) {
            MultisigState(
                m = 2,
                n = 2,
                collected = 0,
                signerDids = listOf("a", "b"),
                pendingSigners = listOf("c"), // not in signerDids
            )
        }
        assertTrue(ex.message!!.contains("not in signerDids"))
    }

    @Test
    fun `init rejects collected greater than n`() {
        val ex = assertThrows(IllegalArgumentException::class.java) {
            MultisigState(
                m = 2,
                n = 2,
                collected = 5,
                signerDids = listOf("a", "b"),
                pendingSigners = emptyList(),
            )
        }
        assertTrue(ex.message!!.contains("collected must be in 0..n"))
    }
}
