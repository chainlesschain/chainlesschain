package com.chainlesschain.android.core.p2p.pairing

import android.content.Context
import android.content.SharedPreferences
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * PairedDesktopsStore 单元测试 — v1.3+ issue #21 plan C。
 *
 * 用 MockK 模拟 SharedPreferences 而非 Robolectric——core-p2p 模块没有
 * Robolectric 依赖，且 SharedPreferences API surface 小，mock 比 Robolectric
 * 启动快几个数量级。
 */
class PairedDesktopsStoreTest {

    private lateinit var context: Context
    private lateinit var prefs: SharedPreferences
    private lateinit var editor: SharedPreferences.Editor

    /** 模拟 prefs 持久层：所有 putString/remove/getString 都进 backing map。 */
    private val backing = mutableMapOf<String, String?>()

    @Before
    fun setUp() {
        backing.clear()
        context = mockk(relaxed = true)
        prefs = mockk(relaxed = true)
        editor = mockk(relaxed = true)

        every { context.getSharedPreferences("paired_desktops_prefs", Context.MODE_PRIVATE) } returns prefs
        every { prefs.getString(any(), any()) } answers {
            val key = firstArg<String>()
            val default = secondArg<String?>()
            backing[key] ?: default
        }
        every { prefs.edit() } returns editor
        val putKey = slot<String>()
        val putValue = slot<String>()
        every { editor.putString(capture(putKey), capture(putValue)) } answers {
            backing[putKey.captured] = putValue.captured
            editor
        }
        val removeKey = slot<String>()
        every { editor.remove(capture(removeKey)) } answers {
            backing.remove(removeKey.captured)
            editor
        }
        every { editor.apply() } returns Unit
    }

    @Test
    fun `empty prefs returns empty list`() {
        val store = PairedDesktopsStore(context)
        assertTrue(store.devices.value.isEmpty())
    }

    @Test
    fun `upsert new desktop adds it to list and persists`() {
        val store = PairedDesktopsStore(context)
        val d = PairedDesktop(pcPeerId = "pc-1", deviceName = "Win Laptop")

        store.upsert(d)

        assertEquals(1, store.devices.value.size)
        assertEquals("pc-1", store.devices.value[0].pcPeerId)
        assertEquals("Win Laptop", store.devices.value[0].deviceName)
        // persisted to backing map (key "desktops_json")
        assertTrue(backing["desktops_json"]?.contains("pc-1") == true)
    }

    @Test
    fun `upsert same pcPeerId updates instead of duplicating and preserves pairedAt`() {
        val store = PairedDesktopsStore(context)
        val first = PairedDesktop(pcPeerId = "pc-1", deviceName = "OldName", pairedAt = 100L)
        store.upsert(first)

        val second = PairedDesktop(
            pcPeerId = "pc-1",
            deviceName = "NewName",
            pairedAt = 999L,
            lastSeenAt = 999L,
        )
        store.upsert(second)

        assertEquals(1, store.devices.value.size, "still one entry, by pcPeerId dedup")
        assertEquals("NewName", store.devices.value[0].deviceName)
        // pairedAt is preserved from first upsert (existingIdx branch)
        assertEquals(100L, store.devices.value[0].pairedAt)
    }

    @Test
    fun `remove deletes entry by pcPeerId`() {
        val store = PairedDesktopsStore(context)
        store.upsert(PairedDesktop(pcPeerId = "pc-1", deviceName = "A"))
        store.upsert(PairedDesktop(pcPeerId = "pc-2", deviceName = "B"))

        store.remove("pc-1")

        assertEquals(1, store.devices.value.size)
        assertEquals("pc-2", store.devices.value[0].pcPeerId)
    }

    @Test
    fun `clear empties list and prefs`() {
        val store = PairedDesktopsStore(context)
        store.upsert(PairedDesktop(pcPeerId = "pc-1", deviceName = "A"))

        store.clear()

        assertTrue(store.devices.value.isEmpty())
        assertNull(backing["desktops_json"])
        verify { editor.remove("desktops_json") }
    }

    @Test
    fun `corrupted prefs payload returns empty list`() {
        backing["desktops_json"] = "{not valid json["
        // re-construct so the lazy prefs load picks up the corrupted backing
        val store = PairedDesktopsStore(context)
        assertTrue(store.devices.value.isEmpty())
    }

    @Test
    fun `persisted state survives store recreation`() {
        val s1 = PairedDesktopsStore(context)
        s1.upsert(PairedDesktop(pcPeerId = "pc-1", deviceName = "Persisted"))

        val s2 = PairedDesktopsStore(context)
        assertEquals(1, s2.devices.value.size)
        assertEquals("Persisted", s2.devices.value[0].deviceName)
    }
}
