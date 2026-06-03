package com.chainlesschain.android.pdh.llm

import android.content.Context
import android.content.SharedPreferences
import io.mockk.Runs
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.unmockkAll
import io.mockk.verify
import org.junit.After
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §2.1 A3.5 — JVM unit cover for [LlmPreferences].
 *
 * AndroidKeyStore is unavailable in JVM unit tests, so we reflect-replace the
 * lazy prefs delegate with a mocked SharedPreferences (same pattern as
 * QQCredentialsStoreTest).
 */
class LlmPreferencesTest {

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `default value is false when prefs return default`() {
        val (store, _) = makeStoreWithCapturingPrefs(initialStored = false)
        assertFalse(store.getPreferAndroidLocal())
        assertFalse(store.preferAndroidLocal.value)
    }

    @Test
    fun `initial value reflects what is already persisted`() {
        val (store, _) = makeStoreWithCapturingPrefs(initialStored = true)
        assertTrue(store.getPreferAndroidLocal())
        assertTrue(store.preferAndroidLocal.value)
    }

    @Test
    fun `setPreferAndroidLocal(true) writes true and updates flow`() {
        val (store, prefs) = makeStoreWithCapturingPrefs(initialStored = false)
        store.setPreferAndroidLocal(true)
        assertTrue(store.preferAndroidLocal.value)
        verify { prefs.edit() }
    }

    @Test
    fun `setPreferAndroidLocal idempotent — same value does not re-write`() {
        val (store, prefs) = makeStoreWithCapturingPrefs(initialStored = true)
        store.setPreferAndroidLocal(true)
        verify(exactly = 0) { prefs.edit() }
        assertTrue(store.preferAndroidLocal.value)
    }

    @Test
    fun `setPreferAndroidLocal toggles flow value`() {
        val (store, _) = makeStoreWithCapturingPrefs(initialStored = false)
        assertFalse(store.preferAndroidLocal.value)
        store.setPreferAndroidLocal(true)
        assertTrue(store.preferAndroidLocal.value)
        store.setPreferAndroidLocal(false)
        assertFalse(store.preferAndroidLocal.value)
    }

    @Test
    fun `read failure (prefs throws) defaults to false without crash`() {
        val ctx = mockk<Context>(relaxed = true)
        val prefs = mockk<SharedPreferences>(relaxed = true)
        every { prefs.getBoolean(any(), any()) } throws SecurityException("keystore corrupt")

        val store = LlmPreferences(ctx)
        val prefsField = LlmPreferences::class.java.getDeclaredField("prefs\$delegate")
        prefsField.isAccessible = true
        prefsField.set(store, lazy { prefs })

        assertFalse(store.getPreferAndroidLocal())
        assertFalse(store.preferAndroidLocal.value)
    }

    @Test
    fun `write failure (editor throws) still updates in-memory flow`() {
        val ctx = mockk<Context>(relaxed = true)
        val prefs = mockk<SharedPreferences>(relaxed = true)
        every { prefs.getBoolean(any(), any()) } returns false
        every { prefs.edit() } throws RuntimeException("disk full")

        val store = LlmPreferences(ctx)
        val prefsField = LlmPreferences::class.java.getDeclaredField("prefs\$delegate")
        prefsField.isAccessible = true
        prefsField.set(store, lazy { prefs })

        // Should NOT throw; in-memory flow still updates so UI reflects the
        // user's choice for this session.
        store.setPreferAndroidLocal(true)
        assertTrue(store.preferAndroidLocal.value)
    }

    // ─── LAN LLM base URL ───────────────────────────────────────────────────

    @Test
    fun `lanLlmBaseUrl default is null`() {
        val (store, _) = makeStoreWithCapturingPrefs(initialStored = false, initialLanUrl = null)
        kotlin.test.assertNull(store.getLanLlmBaseUrl())
        kotlin.test.assertNull(store.lanLlmBaseUrl.value)
    }

    @Test
    fun `setLanLlmBaseUrl normalizes trailing slash and persists`() {
        val (store, prefs) = makeStoreWithCapturingPrefs(initialStored = false, initialLanUrl = null)
        store.setLanLlmBaseUrl("http://192.168.1.5:11434/")
        assertEquals("http://192.168.1.5:11434", store.lanLlmBaseUrl.value)
        verify { prefs.edit() }
    }

    @Test
    fun `setLanLlmBaseUrl blank or null clears value`() {
        val (store, _) = makeStoreWithCapturingPrefs(initialStored = false, initialLanUrl = "http://lan:11434")
        store.setLanLlmBaseUrl("   ")
        kotlin.test.assertNull(store.lanLlmBaseUrl.value)
        store.setLanLlmBaseUrl("http://lan2:11434")
        store.setLanLlmBaseUrl(null)
        kotlin.test.assertNull(store.lanLlmBaseUrl.value)
    }

    @Test
    fun `setLanLlmBaseUrl idempotent - same normalized value does not re-write`() {
        val (store, prefs) = makeStoreWithCapturingPrefs(initialStored = false, initialLanUrl = "http://x:11434")
        store.setLanLlmBaseUrl("http://x:11434/")  // trailing slash normalized to same value
        verify(exactly = 0) { prefs.edit() }
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    private fun makeStoreWithCapturingPrefs(
        initialStored: Boolean,
        initialLanUrl: String? = null,
    ): Pair<LlmPreferences, SharedPreferences> {
        val ctx = mockk<Context>(relaxed = true)
        val prefs = mockk<SharedPreferences>(relaxed = true)
        val editor = mockk<SharedPreferences.Editor>(relaxed = true)
        every { prefs.getBoolean(any(), any()) } returns initialStored
        every { prefs.getString(any(), any()) } returns initialLanUrl
        every { prefs.edit() } returns editor
        every { editor.putBoolean(any(), any()) } returns editor
        every { editor.putString(any(), any()) } returns editor
        every { editor.remove(any()) } returns editor
        every { editor.apply() } just Runs

        val store = LlmPreferences(ctx)
        val prefsField = LlmPreferences::class.java.getDeclaredField("prefs\$delegate")
        prefsField.isAccessible = true
        prefsField.set(store, lazy { prefs })
        // Reset the lazy MutableStateFlows too so they re-read with the new prefs
        val flowField = LlmPreferences::class.java.getDeclaredField("_preferAndroidLocal\$delegate")
        flowField.isAccessible = true
        flowField.set(store, lazy {
            kotlinx.coroutines.flow.MutableStateFlow(initialStored)
        })
        val lanFlowField = LlmPreferences::class.java.getDeclaredField("_lanLlmBaseUrl\$delegate")
        lanFlowField.isAccessible = true
        lanFlowField.set(store, lazy {
            kotlinx.coroutines.flow.MutableStateFlow(initialLanUrl)
        })
        return store to prefs
    }
}
