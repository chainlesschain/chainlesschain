package com.chainlesschain.android.remote.offline

import android.content.Context
import android.content.SharedPreferences
import io.mockk.every
import io.mockk.mockk
import io.mockk.unmockkAll
import io.mockk.verify
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals

/**
 * v1.2 prep #1：[OfflineQueuePreferences] 单测 — TTL persist + clamp 边界。
 */
class OfflineQueuePreferencesTest {

    private lateinit var context: Context
    private lateinit var sp: SharedPreferences
    private lateinit var editor: SharedPreferences.Editor
    // backing store for SharedPreferences mock
    private val store = mutableMapOf<String, Int>()

    @Before
    fun setup() {
        unmockkAll()
        store.clear()
        context = mockk(relaxed = true)
        sp = mockk(relaxed = true)
        editor = mockk(relaxed = true)
        every { context.getSharedPreferences(any(), any()) } returns sp
        every { sp.getInt(any(), any()) } answers {
            val key = firstArg<String>()
            val default = secondArg<Int>()
            store[key] ?: default
        }
        every { sp.edit() } returns editor
        every { editor.putInt(any(), any()) } answers {
            val key = firstArg<String>()
            val value = secondArg<Int>()
            store[key] = value
            editor
        }
        every { editor.apply() } returns Unit
        every { editor.commit() } returns true
    }

    @After
    fun tearDown() = unmockkAll()

    @Test
    fun `default TTL is 7 days (v1_0 compat)`() {
        val prefs = OfflineQueuePreferences(context)
        assertEquals(7, prefs.ttlDays.value)
        assertEquals(7L * 24 * 60 * 60 * 1000, prefs.ttlMillis)
    }

    @Test
    fun `setTtlDays persists and exposes via StateFlow`() {
        val prefs = OfflineQueuePreferences(context)
        prefs.setTtlDays(14)
        assertEquals(14, prefs.ttlDays.value)
        assertEquals(14L * 24 * 60 * 60 * 1000, prefs.ttlMillis)
        verify { editor.putInt("ttl_days", 14) }
    }

    @Test
    fun `setTtlDays clamps below MIN to 1 day`() {
        val prefs = OfflineQueuePreferences(context)
        prefs.setTtlDays(0)
        assertEquals(1, prefs.ttlDays.value)
        prefs.setTtlDays(-100)
        assertEquals(1, prefs.ttlDays.value)
    }

    @Test
    fun `setTtlDays clamps above MAX to 90 days`() {
        val prefs = OfflineQueuePreferences(context)
        prefs.setTtlDays(365)
        assertEquals(90, prefs.ttlDays.value)
        prefs.setTtlDays(Int.MAX_VALUE)
        assertEquals(90, prefs.ttlDays.value)
    }

    @Test
    fun `setTtlDays in middle range stored as-is`() {
        val prefs = OfflineQueuePreferences(context)
        for (d in listOf(1, 7, 14, 30, 60, 90)) {
            prefs.setTtlDays(d)
            assertEquals(d, prefs.ttlDays.value)
        }
    }

    @Test
    fun `loaded value clamped if persistence had out-of-range value`() {
        // 模拟旧版本 / 手动改 SharedPreferences 留下越界值
        store["ttl_days"] = 200
        val prefs = OfflineQueuePreferences(context)
        assertEquals(90, prefs.ttlDays.value)
    }

    @Test
    fun `QUICK_PICK_DAYS list contains common picks`() {
        assertEquals(listOf(1, 7, 14, 30), OfflineQueuePreferences.QUICK_PICK_DAYS)
    }

    @Test
    fun `MIN MAX DEFAULT constants sane`() {
        assertEquals(1, OfflineQueuePreferences.MIN_TTL_DAYS)
        assertEquals(90, OfflineQueuePreferences.MAX_TTL_DAYS)
        assertEquals(7, OfflineQueuePreferences.DEFAULT_TTL_DAYS)
    }
}
