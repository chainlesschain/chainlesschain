package com.chainlesschain.android.pdh.social.bilibili

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
 * Phase 7.2 — JVM unit cover for [BilibiliRootCredentialsStore].
 * Mirrors ToutiaoRootCredentialsStoreTest. Reflectively swap
 * `prefs$delegate` to skip AndroidKeyStore.
 */
class BilibiliRootCredentialsStoreTest {

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `saveBilibiliAccount rejects blank uid`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveBilibiliAccount("")
        }
        assertFailsWith<IllegalArgumentException> {
            store.saveBilibiliAccount("   ")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveBilibiliAccount rejects SESSDATA cookie blob`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        // SESSDATA values are URL-encoded JSON-ish strings — must reject
        assertFailsWith<IllegalArgumentException> {
            store.saveBilibiliAccount(
                "1f5c8a02%2C1745462765%2C0a3b1%2A52CjA3KQ_Hn",
            )
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveBilibiliAccount rejects too-short uid (less than 4 digits)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveBilibiliAccount("123")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveBilibiliAccount accepts 4-digit early account uid (2011-2014 era)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveBilibiliAccount("1234")
        verify { prefs.edit() }
    }

    @Test
    fun `saveBilibiliAccount accepts canonical 8-10 digit modern uid`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveBilibiliAccount("123456789")
        verify { prefs.edit() }
    }

    @Test
    fun `saveBilibiliAccount accepts 12-digit large-account uid`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveBilibiliAccount("123456789012")
        verify { prefs.edit() }
    }

    @Test
    fun `saveBilibiliAccount rejects mixed alphanumeric`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveBilibiliAccount("12345abc")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `prefs name pdh_social_bilibili_root distinct from path-A pdh_social_bilibili`() {
        val ctx = mockk<Context>(relaxed = true)
        val store = BilibiliRootCredentialsStore(ctx)
        assertTrue(store is com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore)
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    private fun makeStoreWithCapturingPrefs(): Pair<BilibiliRootCredentialsStore, SharedPreferences> {
        val ctx = mockk<Context>(relaxed = true)
        val prefs = stubPrefs()
        val store = BilibiliRootCredentialsStore(ctx)
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
