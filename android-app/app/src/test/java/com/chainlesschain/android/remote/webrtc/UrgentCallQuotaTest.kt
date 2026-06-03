package com.chainlesschain.android.remote.webrtc

import android.content.Context
import android.content.SharedPreferences
import io.mockk.every
import io.mockk.mockk
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-36 验收: UrgentCallQuota 24h 滚动窗口限 3 次 + per-target + 持久 + reset。
 * 时间走显式 nowMs。SharedPreferences 用 MockK backing-map（同 PairedPeersStoreTest）。
 */
class UrgentCallQuotaTest {

    private lateinit var context: Context
    private val backing = mutableMapOf<String, String?>()

    @Before
    fun setUp() {
        context = mockk(relaxed = true)
        val prefs: SharedPreferences = mockk(relaxed = true)
        val editor: SharedPreferences.Editor = mockk(relaxed = true)
        every { context.getSharedPreferences("urgent_call_quota_prefs", Context.MODE_PRIVATE) } returns prefs
        every { prefs.getString(any(), any()) } answers { backing[firstArg()] ?: secondArg() }
        every { prefs.edit() } returns editor
        every { editor.putString(any(), any()) } answers {
            backing[firstArg()] = secondArg()
            editor
        }
        every { editor.remove(any()) } answers {
            backing.remove(firstArg<String>())
            editor
        }
        every { editor.apply() } returns Unit
    }

    private fun quota() = UrgentCallQuota(context)

    private val kid = "did:chain:kid"
    private val t0 = 1_700_000_000_000L
    private val day = UrgentCallQuota.WINDOW_MS

    @Test
    fun `fresh target has full quota`() {
        assertEquals(3, quota().remaining(kid, t0))
    }

    @Test
    fun `consume 3 then exhausted`() {
        val q = quota()
        assertEquals(UrgentQuotaResult.Allowed(2), q.consume(kid, t0))
        assertEquals(UrgentQuotaResult.Allowed(1), q.consume(kid, t0 + 1000))
        assertEquals(UrgentQuotaResult.Allowed(0), q.consume(kid, t0 + 2000))
        val fourth = q.consume(kid, t0 + 3000)
        assertTrue(fourth is UrgentQuotaResult.Exhausted)
        // resetAtMs = 最早一次(t0) + 24h
        assertEquals(t0 + day, (fourth as UrgentQuotaResult.Exhausted).resetAtMs)
        assertEquals(0, q.remaining(kid, t0 + 3000))
    }

    @Test
    fun `24h rolling window frees slots`() {
        val q = quota()
        q.consume(kid, t0)
        q.consume(kid, t0 + 1000)
        q.consume(kid, t0 + 2000)
        assertEquals(0, q.remaining(kid, t0 + 3000))
        // 跨过最早一次的 24h 后 → 该次过期，剩余回升
        assertEquals(1, q.remaining(kid, t0 + day + 1))
        // 全部过期
        assertEquals(3, q.remaining(kid, t0 + 2000 + day + 1))
        // 过期后可再 consume
        assertEquals(UrgentQuotaResult.Allowed(2), q.consume(kid, t0 + day + 5000))
    }

    @Test
    fun `quota is per-target`() {
        val q = quota()
        val kidB = "did:chain:kidB"
        q.consume(kid, t0)
        q.consume(kid, t0)
        q.consume(kid, t0)
        assertEquals(0, q.remaining(kid, t0))
        assertEquals(3, q.remaining(kidB, t0)) // 独立
    }

    @Test
    fun `state persists across instances (SharedPreferences)`() {
        quota().consume(kid, t0)
        quota().consume(kid, t0 + 1000)
        // 新实例读同一 backing prefs
        assertEquals(1, quota().remaining(kid, t0 + 2000))
    }

    @Test
    fun `reset clears target`() {
        val q = quota()
        q.consume(kid, t0)
        q.consume(kid, t0)
        q.consume(kid, t0)
        q.reset(kid)
        assertEquals(3, q.remaining(kid, t0))
    }
}
