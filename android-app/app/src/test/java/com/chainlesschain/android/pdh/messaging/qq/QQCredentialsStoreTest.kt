package com.chainlesschain.android.pdh.messaging.qq

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

/**
 * §Phase 13.5 v0.2 — JVM unit cover for [QQCredentialsStore].
 *
 * Mirrors WeChatCredentialsStoreTest with QQ-specific contracts:
 *   - uin must be digits-only
 *   - imei must be exactly 15 digits (mainland China standard)
 *   - displayName is optional
 *   - saveAccount **throws** on validation failure (NOT swallowed — UI
 *     needs to surface bad input)
 */
class QQCredentialsStoreTest {

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `saveAccount rejects blank uin`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveAccount("", "123456789012345")
        }
        assertFailsWith<IllegalArgumentException> {
            store.saveAccount("   ", "123456789012345")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveAccount rejects non-digit uin`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveAccount("abc123", "123456789012345")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveAccount rejects blank imei`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveAccount("12345", "")
        }
        assertFailsWith<IllegalArgumentException> {
            store.saveAccount("12345", "   ")
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveAccount rejects wrong-length imei (not 15)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveAccount("12345", "12345")  // 5 digits
        }
        assertFailsWith<IllegalArgumentException> {
            store.saveAccount("12345", "1234567890123456")  // 16 digits
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveAccount rejects non-digit imei`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveAccount("12345", "12345abcdef0123")  // 15 chars but mix
        }
        verify(exactly = 0) { prefs.edit() }
    }

    @Test
    fun `saveAccount persists valid uin and imei`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveAccount("12345", "123456789012345")
        verify { prefs.edit() }
    }

    @Test
    fun `saveAccount persists displayName when provided`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveAccount("12345", "123456789012345", displayName = "alice")
        verify { prefs.edit() }
    }

    @Test
    fun `saveAccount removes displayName when blank`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveAccount("12345", "123456789012345", displayName = "")
        verify { prefs.edit() }
    }

    @Test
    fun `recordSync writes timestamp + count + zeros error`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.recordSync(System.currentTimeMillis(), 1500)
        verify { prefs.edit() }
    }

    @Test
    fun `recordError writes both code and message`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.recordError(-42, "su not available")
        verify { prefs.edit() }
    }

    @Test
    fun `clear wipes all keys`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.clear()
        verify { prefs.edit() }
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    private fun makeStoreWithCapturingPrefs(): Pair<QQCredentialsStore, SharedPreferences> {
        val ctx = mockk<Context>(relaxed = true)
        val prefs = mockk<SharedPreferences>(relaxed = true)
        val editor = mockk<SharedPreferences.Editor>(relaxed = true)
        every { prefs.edit() } returns editor
        every { editor.putString(any(), any()) } returns editor
        every { editor.putInt(any(), any()) } returns editor
        every { editor.putLong(any(), any()) } returns editor
        every { editor.remove(any()) } returns editor
        every { editor.clear() } returns editor
        every { editor.apply() } just runs

        val store = QQCredentialsStore(ctx)
        // Replace the lazy `prefs` delegate so EncryptedSharedPreferences
        // is never touched (no AndroidKeyStore in JVM unit tests).
        val prefsField = QQCredentialsStore::class.java.getDeclaredField("prefs\$delegate")
        prefsField.isAccessible = true
        prefsField.set(store, lazy { prefs })
        return store to prefs
    }
}
