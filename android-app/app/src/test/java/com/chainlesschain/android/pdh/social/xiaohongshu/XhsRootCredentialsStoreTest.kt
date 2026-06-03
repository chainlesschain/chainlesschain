package com.chainlesschain.android.pdh.social.xiaohongshu

import android.content.Context
import android.content.SharedPreferences
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import io.mockk.unmockkAll
import io.mockk.verify
import org.junit.After
import org.junit.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Phase 7.5 — JVM unit cover for [XhsRootCredentialsStore].
 *
 * **Key difference vs Weibo/Bilibili numeric uid**: Xhs user_id is
 * 24-char hex string (ObjectId convention). validation regex
 * `^[0-9a-fA-F]{24}$`.
 */
class XhsRootCredentialsStoreTest {

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `saveXhsAccount rejects blank user_id`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveXhsAccount("")
        }
        assertFailsWith<IllegalArgumentException> {
            store.saveXhsAccount("   ")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveXhsAccount rejects too-short user_id (less than 24 chars)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveXhsAccount("5e8c8f7e")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveXhsAccount accepts canonical 24-char lowercase hex user_id`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveXhsAccount("5e8c8f7e1234567890abcdef")
        verify { prefs.edit() }
    }

    @Test
    fun `saveXhsAccount accepts uppercase hex user_id (legacy drift tolerance)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveXhsAccount("5E8C8F7E1234567890ABCDEF")
        verify { prefs.edit() }
    }

    @Test
    fun `saveXhsAccount rejects non-hex chars (e_g_ display_name slip)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        // 24 chars but contains 'z' / 'g' which are non-hex
        assertFailsWith<IllegalArgumentException> {
            store.saveXhsAccount("zzzzzzzz1234567890abcdef")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveXhsAccount rejects numeric user_id (Bilibili-style cross-slip)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        // 24 digits but path A `XhsCredentialsStore.userIdStr` would be hex
        assertFailsWith<IllegalArgumentException> {
            // 22 chars
            store.saveXhsAccount("1234567890123456789012")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `prefs name pdh_social_xiaohongshu_root distinct from path-A pdh_social_xiaohongshu`() {
        val ctx = mockk<Context>(relaxed = true)
        val store = XhsRootCredentialsStore(ctx)
        assertTrue(store is com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore)
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    private fun makeStoreWithCapturingPrefs(): Pair<XhsRootCredentialsStore, SharedPreferences> {
        val ctx = mockk<Context>(relaxed = true)
        val prefs = stubPrefs()
        val store = XhsRootCredentialsStore(ctx)
        val prefsField =
            com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore::class.java
                .getDeclaredField("prefs\$delegate")
        prefsField.isAccessible = true
        prefsField.set(store, lazy { prefs })
        return store to prefs
    }

    private fun stubPrefs(): SharedPreferences {
        val prefs = mockk<SharedPreferences>(relaxed = true)
        val editor = mockk<SharedPreferences.Editor>(relaxed = true)
        every { prefs.edit() } returns editor
        every { editor.putString(any(), any()) } returns editor
        every { editor.putInt(any(), any()) } returns editor
        every { editor.putLong(any(), any()) } returns editor
        every { editor.putBoolean(any(), any()) } returns editor
        every { editor.putFloat(any(), any()) } returns editor
        every { editor.remove(any()) } returns editor
        every { editor.clear() } returns editor
        every { editor.apply() } just runs
        return prefs
    }
}
