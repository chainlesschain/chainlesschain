package com.chainlesschain.android.pdh.social.common

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
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase B0 — JVM unit cover for [BaseRootCredentialsStore].
 *
 * Tests via a concrete [TestRootCredentialsStore] subclass since the
 * base is abstract. Mirrors the WeChatCredentialsStoreTest mock pattern
 * — we bypass EncryptedSharedPreferences via reflection on the `prefs`
 * lazy delegate, then assert on edit() call shape.
 *
 * What we cover:
 *  - Common field getters (uid / lastSync / lastError) read through
 *    [BaseRootCredentialsStore.safeGet] defensive try/catch
 *  - saveAccount() validates uid non-blank, atomically writes uid +
 *    arbitrary typed extras
 *  - saveAccount() rejects unsupported extra types (only String/Int/
 *    Long/Boolean/Float allowed)
 *  - recordSync clears prior error state (parity with WeChat behavior)
 *  - recordError persists code + message
 *  - hasCredentials defaults to "uid present"; subclass can override
 *    (e.g. for multi-field stores like QQ where imei is also required)
 *
 * What we DON'T cover (gated to instrumented tests):
 *  - Real EncryptedSharedPreferences create on rooted/MIUI device
 *  - Master key rotation throw path (Trap 1)
 */
class BaseRootCredentialsStoreTest {

    @After
    fun tearDown() {
        unmockkAll()
    }

    // ─── Concrete subclass for testing ─────────────────────────────────────

    /**
     * Minimal subclass exposing only the base methods. Real platforms
     * (e.g. DouyinCredentialsStore) will add platform-specific getters
     * + override [hasCredentials] when they need multi-field validation.
     */
    private class TestRootCredentialsStore(
        context: Context,
    ) : BaseRootCredentialsStore(context, PREFS_NAME) {
        // Expose protected safeGet for direct testing
        fun <T> testSafeGet(block: () -> T?): T? = safeGet(block)

        companion object {
            const val PREFS_NAME = "pdh_test_base_root_store"
        }
    }

    /**
     * Subclass that overrides hasCredentials() to require BOTH uid AND a
     * platform-specific field — proves the override hook works.
     */
    private class MultiFieldStore(context: Context) : BaseRootCredentialsStore(context, "pdh_test_multi") {
        fun getImei(): String? = safeGet { prefs.getString("imei", null)?.takeIf { it.isNotBlank() } }
        override fun hasCredentials(): Boolean = !getUid().isNullOrBlank() && !getImei().isNullOrBlank()
    }

    // ─── Common getters via safeGet ────────────────────────────────────────

    @Test
    fun `getUid returns null when prefs throws (defensive read)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        every { prefs.getString("uid", null) } throws RuntimeException("keystore corrupted")
        // safeGet swallows + returns null instead of propagating
        assertNull(store.getUid())
    }

    @Test
    fun `getLastSyncAt returns null when never synced (Long 0 → null)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        every { prefs.getLong("lastSyncAtMs", 0L) } returns 0L
        assertNull(store.getLastSyncAt(), "0 ms is sentinel for never-synced")
    }

    @Test
    fun `getLastSyncAt returns value when set`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        every { prefs.getLong("lastSyncAtMs", 0L) } returns 1716383021000L
        assertEquals(1716383021000L, store.getLastSyncAt())
    }

    @Test
    fun `getLastSyncCount returns 0 when never synced`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        every { prefs.getInt("lastSyncCount", 0) } returns 0
        assertEquals(0, store.getLastSyncCount())
    }

    @Test
    fun `getLastErrorCode returns 0 by default`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        every { prefs.getInt("lastErrorCode", 0) } returns 0
        assertEquals(0, store.getLastErrorCode())
    }

    @Test
    fun `getLastErrorMessage returns null by default`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        every { prefs.getString("lastErrorMessage", null) } returns null
        assertNull(store.getLastErrorMessage())
    }

    @Test
    fun `safeGet swallows arbitrary throwable (Keystore corruption simulation)`() {
        val store = TestRootCredentialsStore(mockk(relaxed = true))
        val result = store.testSafeGet<String> {
            throw RuntimeException("simulated keystore failure")
        }
        assertNull(result)
    }

    // ─── saveAccount() ─────────────────────────────────────────────────────

    @Test
    fun `saveAccount rejects blank uid`() {
        val (store, _) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveAccount("")
        }
        assertFailsWith<IllegalArgumentException> {
            store.saveAccount("   ")
        }
    }

    @Test
    fun `saveAccount writes uid on minimum valid input`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        store.saveAccount("1234567890")
        verify { prefs.edit() }
    }

    @Test
    fun `saveAccount writes extras (String + Int + Long + Boolean)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        val editor = prefs.edit()  // capture for verification
        store.saveAccount(
            "1234567890",
            "secUid" to "MS4wLjABAAAA...",
            "appVersionCode" to 280001,
            "tokenExpiresAt" to 1716383021000L,
            "isPro" to true,
        )
        verify { editor.putString("uid", "1234567890") }
        verify { editor.putString("secUid", "MS4wLjABAAAA...") }
        verify { editor.putInt("appVersionCode", 280001) }
        verify { editor.putLong("tokenExpiresAt", 1716383021000L) }
        verify { editor.putBoolean("isPro", true) }
    }

    @Test
    fun `saveAccount remove() when extra value is null`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        val editor = prefs.edit()
        store.saveAccount("1234567890", "optionalField" to null)
        verify { editor.remove("optionalField") }
    }

    @Test
    fun `saveAccount rejects unsupported extra type`() {
        val (store, _) = makeStoreWithCapturingPrefs()
        assertFailsWith<IllegalArgumentException> {
            store.saveAccount("1234567890", "someMap" to mapOf("a" to "b"))
        }
    }

    // ─── recordSync / recordError ──────────────────────────────────────────

    @Test
    fun `recordSync zeros out prior error state (parity with WeChat behavior)`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        val editor = prefs.edit()
        store.recordSync(1716383021000L, 1500)
        verify { editor.putLong("lastSyncAtMs", 1716383021000L) }
        verify { editor.putInt("lastSyncCount", 1500) }
        verify { editor.putInt("lastErrorCode", 0) }
        verify { editor.remove("lastErrorMessage") }
    }

    @Test
    fun `recordError persists both code and message`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        val editor = prefs.edit()
        store.recordError(-42, "frida hook crashed")
        verify { editor.putInt("lastErrorCode", -42) }
        verify { editor.putString("lastErrorMessage", "frida hook crashed") }
    }

    @Test
    fun `recordError with null message stores empty string`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        val editor = prefs.edit()
        store.recordError(-1, null)
        verify { editor.putString("lastErrorMessage", "") }
    }

    @Test
    fun `clear wipes everything via edit dot clear`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        val editor = prefs.edit()
        store.clear()
        verify { editor.clear() }
    }

    // ─── hasCredentials override ───────────────────────────────────────────

    @Test
    fun `default hasCredentials returns true when uid present`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        every { prefs.getString("uid", null) } returns "1234567890"
        assertTrue(store.hasCredentials())
    }

    @Test
    fun `default hasCredentials returns false when uid blank`() {
        val (store, prefs) = makeStoreWithCapturingPrefs()
        every { prefs.getString("uid", null) } returns "   "
        assertFalse(store.hasCredentials())
    }

    @Test
    fun `subclass can override hasCredentials for multi-field requirement`() {
        val ctx = mockk<Context>(relaxed = true)
        val prefs = stubPrefs()
        val store = MultiFieldStore(ctx)
        replacePrefs(store, prefs)

        // uid set but imei missing → false
        every { prefs.getString("uid", null) } returns "1234567890"
        every { prefs.getString("imei", null) } returns null
        assertFalse(store.hasCredentials())

        // both set → true
        every { prefs.getString("imei", null) } returns "353918050000000"
        assertTrue(store.hasCredentials())

        // uid missing but imei set → false (uid is mandatory in base)
        every { prefs.getString("uid", null) } returns null
        assertFalse(store.hasCredentials())
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    private fun makeStoreWithCapturingPrefs(): Pair<TestRootCredentialsStore, SharedPreferences> {
        val ctx = mockk<Context>(relaxed = true)
        val prefs = stubPrefs()
        val store = TestRootCredentialsStore(ctx)
        replacePrefs(store, prefs)
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

    /**
     * Reflectively replace the lazy `prefs` delegate so we bypass
     * EncryptedSharedPreferences in JVM tests.
     */
    private fun replacePrefs(store: BaseRootCredentialsStore, prefs: SharedPreferences) {
        val prefsField = BaseRootCredentialsStore::class.java.getDeclaredField("prefs\$delegate")
        prefsField.isAccessible = true
        prefsField.set(store, lazy { prefs })
    }
}
