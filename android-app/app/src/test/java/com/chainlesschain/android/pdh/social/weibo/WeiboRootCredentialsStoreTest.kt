package com.chainlesschain.android.pdh.social.weibo

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
 * Phase 7.4 — JVM unit cover for [WeiboRootCredentialsStore].
 * Mirrors BilibiliRootCredentialsStoreTest. Reflectively swap
 * `prefs$delegate` to skip AndroidKeyStore.
 *
 * Weibo uid semantics: numeric ≥6 digits. Path A's
 * `WeiboCredentialsStore` writes cookies + SUB + SUBP into its own
 * `pdh_social_weibo` prefs; this path-B store only persists uid into
 * `pdh_social_weibo_root`. The two coexist.
 */
class WeiboRootCredentialsStoreTest {

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `saveWeiboAccount rejects blank uid`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveWeiboAccount("")
        }
        assertFailsWith<IllegalArgumentException> {
            store.saveWeiboAccount("   ")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveWeiboAccount rejects SUB cookie blob (path-A leakage guard)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        // Weibo SUB cookies are URL-encoded base64-ish strings, not numeric
        assertFailsWith<IllegalArgumentException> {
            store.saveWeiboAccount("_2A25LV9aHDeRhGeFM7lUW9SbIzD2IHXVowZWQrDV6PUJbktANLW")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveWeiboAccount rejects too-short uid (less than 6 digits)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveWeiboAccount("12345")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveWeiboAccount accepts 6-digit minimal uid (legacy account floor)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveWeiboAccount("100001")
        verify { prefs.edit() }
    }

    @Test
    fun `saveWeiboAccount accepts canonical 10-digit modern uid`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveWeiboAccount("1234567890")
        verify { prefs.edit() }
    }

    @Test
    fun `saveWeiboAccount rejects mixed alphanumeric (e_g_ screen_name slip)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveWeiboAccount("user12345")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `prefs name pdh_social_weibo_root distinct from path-A pdh_social_weibo`() {
        val ctx = mockk<Context>(relaxed = true)
        val store = WeiboRootCredentialsStore(ctx)
        assertTrue(store is com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore)
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    private fun makeStoreWithCapturingPrefs(): Pair<WeiboRootCredentialsStore, SharedPreferences> {
        val ctx = mockk<Context>(relaxed = true)
        val prefs = stubPrefs()
        val store = WeiboRootCredentialsStore(ctx)
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
