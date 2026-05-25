package com.chainlesschain.android.pdh.social.toutiao

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
 * Phase 7.1 — JVM unit cover for [ToutiaoRootCredentialsStore].
 *
 * Mirrors DouyinRootCredentialsStoreTest. We swap `prefs$delegate`
 * reflectively with stubbed SharedPreferences to avoid AndroidKeyStore
 * dependency.
 */
class ToutiaoRootCredentialsStoreTest {

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `saveToutiaoAccount rejects blank uid`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveToutiaoAccount("")
        }
        assertFailsWith<IllegalArgumentException> {
            store.saveToutiaoAccount("   ")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveToutiaoAccount rejects cookie blob (long Base64-ish string)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            // sessionid cookie value is alphanumeric — must reject
            store.saveToutiaoAccount("0123456789abcdef0123456789abcdef")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveToutiaoAccount rejects too-short uid (less than 6 digits)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveToutiaoAccount("12345")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveToutiaoAccount accepts 6-digit early-account uid`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveToutiaoAccount("123456")
        verify { prefs.edit() }
    }

    @Test
    fun `saveToutiaoAccount accepts canonical 10-15 digit uid`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveToutiaoAccount("1234567890")
        verify { prefs.edit() }
    }

    @Test
    fun `saveToutiaoAccount rejects mixed alphanumeric`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveToutiaoAccount("12345abc678")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `prefs name pdh_social_toutiao_root distinct from path-A pdh_social_toutiao`() {
        val ctx = mockk<Context>(relaxed = true)
        val store = ToutiaoRootCredentialsStore(ctx)
        assertTrue(store is com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore)
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    private fun makeStoreWithCapturingPrefs(): Pair<ToutiaoRootCredentialsStore, SharedPreferences> {
        val ctx = mockk<Context>(relaxed = true)
        val prefs = stubPrefs()
        val store = ToutiaoRootCredentialsStore(ctx)
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
