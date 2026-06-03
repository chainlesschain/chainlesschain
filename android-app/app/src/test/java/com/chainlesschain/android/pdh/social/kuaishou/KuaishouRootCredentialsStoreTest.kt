package com.chainlesschain.android.pdh.social.kuaishou

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
 * Phase 7.6 — JVM unit cover for [KuaishouRootCredentialsStore].
 * Mirrors WeiboRootCredentialsStoreTest. uid validation: numeric ≥6 digits.
 */
class KuaishouRootCredentialsStoreTest {

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `saveKuaishouAccount rejects blank uid`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveKuaishouAccount("")
        }
        assertFailsWith<IllegalArgumentException> {
            store.saveKuaishouAccount("   ")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveKuaishouAccount rejects passToken cookie blob (path-A leakage guard)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        // Kuaishou passToken is base64url-ish, not numeric
        assertFailsWith<IllegalArgumentException> {
            store.saveKuaishouAccount("ChNwYXNzcG9ydC5wYXNzVG9rZW4SEXAt73Yh-1xs_y3Q4qGv-1n0HRoB")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveKuaishouAccount rejects too-short uid (less than 6 digits)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveKuaishouAccount("12345")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveKuaishouAccount accepts 6-digit minimal uid (legacy account floor)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveKuaishouAccount("123456")
        verify { prefs.edit() }
    }

    @Test
    fun `saveKuaishouAccount accepts canonical 9-10 digit modern uid`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveKuaishouAccount("1234567890")
        verify { prefs.edit() }
    }

    @Test
    fun `saveKuaishouAccount rejects mixed alphanumeric (e_g_ kuaiId slip)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveKuaishouAccount("kwaiUser123")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `prefs name pdh_social_kuaishou_root distinct from path-A pdh_social_kuaishou`() {
        val ctx = mockk<Context>(relaxed = true)
        val store = KuaishouRootCredentialsStore(ctx)
        assertTrue(store is com.chainlesschain.android.pdh.social.common.BaseRootCredentialsStore)
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    private fun makeStoreWithCapturingPrefs(): Pair<KuaishouRootCredentialsStore, SharedPreferences> {
        val ctx = mockk<Context>(relaxed = true)
        val prefs = stubPrefs()
        val store = KuaishouRootCredentialsStore(ctx)
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
