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
 *   - "imei"              : String? — 15-char device IMEI; required ONLY for
 *                                     md5 keyProvider (7.x). 8.x frida path
 *                                     leaves this null. Android 10+ READ_PHONE_STATE
 *                                     restrictions make IMEI auto-detect
 *                                     unreliable — user types it manually
 *                                     in the UIN dialog when keyProvider=md5.
 *   - "dbKeyHex"          : String? — for keyProvider=frida: 64-char hex
 *                                     (32 raw bytes) captured from frida
 *                                     sqlite3_key_v2 hook. for keyProvider=md5:
 *                                     7-char lowercase hex derived from
 *                                     MD5(imei+uin)[:7] at extract time —
 *                                     NOT persisted (re-derived each call
 *                                     so changing IMEI doesn't strand a
 *                                     stale key).
 *   - "keyProvider"       : String — "md5" / "frida" (functional gate, not
 *                                     just diagnostic — picks key derivation
 *                                     path in WeChatDbExtractor)
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

    fun getImei(): String? = safeGet { prefs.getString(KEY_IMEI, null)?.takeIf { it.isNotBlank() } }

    fun getDbKeyHex(): String? = safeGet { prefs.getString(KEY_DB_KEY_HEX, null)?.takeIf { it.isNotBlank() } }

    fun getKeyProvider(): String? = safeGet { prefs.getString(KEY_KEY_PROVIDER, null) }

    fun getLastSyncAt(): Long? = safeGet { prefs.getLong(KEY_LAST_SYNC_AT, 0L).takeIf { it > 0L } }

    fun getLastSyncCount(): Int = safeGet { prefs.getInt(KEY_LAST_SYNC_COUNT, 0) } ?: 0

    fun getLastErrorCode(): Int = safeGet { prefs.getInt(KEY_LAST_ERROR_CODE, 0) } ?: 0

    fun getLastErrorMessage(): String? = safeGet { prefs.getString(KEY_LAST_ERROR_MESSAGE, null) }

    /**
     * Save the user-provided uin + the keyProvider hint chosen by env-probe.
     * Called from [HubLocalViewModel.confirmWechatUin] after user enters
     * uin in the login dialog. For md5 keyProvider, [imei] is also required
     * (user types it in the dialog). For frida keyProvider, [imei] is null.
     *
     * dbKeyHex is null at this point and populated later by FridaInjector
     * (8.0+ frida path). md5 path does NOT persist dbKeyHex — the key is
     * derived on every extract from imei + uin so a user changing devices
     * doesn't strand a stale key in the store.
     */
    fun saveAccount(uin: String, keyProvider: String, imei: String? = null) {
        try {
            require(uin.isNotBlank()) { "uin must not be blank" }
            require(keyProvider in setOf("md5", "frida")) {
                "keyProvider must be 'md5' or 'frida'; was: $keyProvider"
            }
            if (keyProvider == "md5") {
                require(!imei.isNullOrBlank()) {
                    "imei is required when keyProvider='md5' (used for MD5(imei+uin)[:7] key derivation)"
                }
            }
            prefs.edit().apply {
                putString(KEY_UIN, uin)
                putString(KEY_KEY_PROVIDER, keyProvider)
                if (!imei.isNullOrBlank()) putString(KEY_IMEI, imei) else remove(KEY_IMEI)
                apply()
            }
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
        private const val KEY_IMEI = "imei"
        private const val KEY_DB_KEY_HEX = "dbKeyHex"
        private const val KEY_KEY_PROVIDER = "keyProvider"
        private const val KEY_LAST_SYNC_AT = "lastSyncAtMs"
        private const val KEY_LAST_SYNC_COUNT = "lastSyncCount"
        private const val KEY_LAST_ERROR_CODE = "lastErrorCode"
        private const val KEY_LAST_ERROR_MESSAGE = "lastErrorMessage"
    }
}
