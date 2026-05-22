package com.chainlesschain.android.pdh.social.wechat

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 12.10.2 — persists WeChat account state for the Android in-app
 * collector (see docs/design/Android_WeChat_InApp_Frida_Collector.md).
 *
 * Backed by EncryptedSharedPreferences (AES-256-GCM under a master key
 * from AndroidKeyStore). All fields are sensitivity=high — `uin` is
 * personally-identifying and `dbKeyHex` is the SQLCipher master key for
 * the user's WeChat database. Plain SharedPreferences would leak both
 * to anyone with adb on a debuggable build.
 *
 * Schema (intentionally flat — no nested JSON, no migrations needed):
 *   - "uin"               : String — WeChat numeric UIN (e.g. "1234567890")
 *   - "dbKeyHex"          : String? — 64-char hex (32 bytes) SQLCipher key
 *                                     null until first frida hook succeeds
 *                                     (8.0+ path) or md5 derivation done
 *                                     (7.x path)
 *   - "keyProvider"       : String — "md5" / "frida" (diagnostic only)
 *   - "lastSyncAtMs"      : Long — epoch ms of last successful snapshot
 *   - "lastSyncCount"     : Int — events ingested by last sync (UI display)
 *   - "lastErrorCode"     : Int — non-zero when last attempt failed
 *   - "lastErrorMessage"  : String? — Bilibili-style error surfacing
 *
 * Mirrors [com.chainlesschain.android.pdh.social.bilibili.BilibiliCredentialsStore]
 * deliberately — same lifecycle (saveCredentials → recordSync → clear),
 * same safeGet defensive read pattern, same single-edit batching.
 */
@Singleton
class WeChatCredentialsStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun hasCredentials(): Boolean {
        return try {
            val uin = prefs.getString(KEY_UIN, null)
            uin != null && uin.isNotBlank()
        } catch (t: Throwable) {
            // EncryptedSharedPreferences can throw on master-key rotation /
            // keystore corruption (rare but real on factory reset). Treat as
            // "not logged in"; user re-saves.
            Timber.w(t, "WeChatCredentialsStore.hasCredentials threw — treating as unauthenticated")
            false
        }
    }

    fun getUin(): String? = safeGet { prefs.getString(KEY_UIN, null)?.takeIf { it.isNotBlank() } }

    fun getDbKeyHex(): String? = safeGet { prefs.getString(KEY_DB_KEY_HEX, null)?.takeIf { it.isNotBlank() } }

    fun getKeyProvider(): String? = safeGet { prefs.getString(KEY_KEY_PROVIDER, null) }

    fun getLastSyncAt(): Long? = safeGet { prefs.getLong(KEY_LAST_SYNC_AT, 0L).takeIf { it > 0L } }

    fun getLastSyncCount(): Int = safeGet { prefs.getInt(KEY_LAST_SYNC_COUNT, 0) } ?: 0

    fun getLastErrorCode(): Int = safeGet { prefs.getInt(KEY_LAST_ERROR_CODE, 0) } ?: 0

    fun getLastErrorMessage(): String? = safeGet { prefs.getString(KEY_LAST_ERROR_MESSAGE, null) }

    /**
     * Save the user-provided uin + the keyProvider hint chosen by env-probe.
     * Called from [HubLocalViewModel.confirmWechatUin] after user enters
     * uin in the login dialog. dbKeyHex is null at this point; populated
     * later by FridaInjector (8.0+) or md5 derivation (7.x).
     */
    fun saveAccount(uin: String, keyProvider: String) {
        try {
            require(uin.isNotBlank()) { "uin must not be blank" }
            require(keyProvider in setOf("md5", "frida")) {
                "keyProvider must be 'md5' or 'frida'; was: $keyProvider"
            }
            prefs.edit()
                .putString(KEY_UIN, uin)
                .putString(KEY_KEY_PROVIDER, keyProvider)
                .apply()
        } catch (t: Throwable) {
            Timber.e(t, "WeChatCredentialsStore.saveAccount failed")
        }
    }

    fun setDbKeyHex(dbKeyHex: String) {
        try {
            require(dbKeyHex.length == 64) {
                "dbKeyHex must be 64 hex chars (32 bytes); was ${dbKeyHex.length}"
            }
            require(dbKeyHex.all { it.isHexDigit() }) {
                "dbKeyHex must contain only hex chars [0-9a-fA-F]"
            }
            prefs.edit().putString(KEY_DB_KEY_HEX, dbKeyHex).apply()
        } catch (t: Throwable) {
            Timber.e(t, "WeChatCredentialsStore.setDbKeyHex failed")
            throw t  // re-throw — caller must know key wasn't persisted
        }
    }

    fun recordSync(at: Long, count: Int) {
        try {
            prefs.edit()
                .putLong(KEY_LAST_SYNC_AT, at)
                .putInt(KEY_LAST_SYNC_COUNT, count)
                .putInt(KEY_LAST_ERROR_CODE, 0)
                .remove(KEY_LAST_ERROR_MESSAGE)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "WeChatCredentialsStore.recordSync failed (non-fatal)")
        }
    }

    fun recordError(code: Int, message: String?) {
        try {
            prefs.edit()
                .putInt(KEY_LAST_ERROR_CODE, code)
                .putString(KEY_LAST_ERROR_MESSAGE, message ?: "")
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "WeChatCredentialsStore.recordError failed (non-fatal)")
        }
    }

    fun clear() {
        try {
            prefs.edit().clear().apply()
        } catch (t: Throwable) {
            Timber.w(t, "WeChatCredentialsStore.clear failed")
        }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "WeChatCredentialsStore: read failed")
        null
    }

    private fun Char.isHexDigit(): Boolean = this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

    companion object {
        private const val PREFS_NAME = "pdh_social_wechat"
        private const val KEY_UIN = "uin"
        private const val KEY_DB_KEY_HEX = "dbKeyHex"
        private const val KEY_KEY_PROVIDER = "keyProvider"
        private const val KEY_LAST_SYNC_AT = "lastSyncAtMs"
        private const val KEY_LAST_SYNC_COUNT = "lastSyncCount"
        private const val KEY_LAST_ERROR_CODE = "lastErrorCode"
        private const val KEY_LAST_ERROR_MESSAGE = "lastErrorMessage"
    }
}
