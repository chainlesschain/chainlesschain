package com.chainlesschain.android.pdh.messaging.qq

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 13.5 v0.2 — persists QQ account state for the Android in-app
 * collector (see docs/design/Android_QQ_InApp_XorDecrypt_Collector.md
 * — TODO: write this design doc in a follow-up).
 *
 * Backed by EncryptedSharedPreferences (AES-256-GCM via AndroidKeyStore
 * master key). All fields are sensitivity=high — `uin` is personally
 * identifying and `imei` is functionally the encryption key for every
 * message body in QQ's per-uin SQLite DB (XOR-cycled per sjqz qq.py).
 *
 * Schema (intentionally flat — no nested JSON, no migrations needed):
 *   - "uin"               : String — QQ numeric uin (e.g. "12345")
 *   - "imei"              : String — 15-digit device IMEI used as the XOR
 *                                    cycle key for every msgData blob. User
 *                                    enters manually in the QQ login dialog
 *                                    because Android 10+ READ_PHONE_STATE
 *                                    restrictions make auto-detect unreliable.
 *   - "displayName"       : String? — optional UI label
 *   - "lastSyncAtMs"      : Long — epoch ms of last successful snapshot
 *   - "lastSyncCount"     : Int — events ingested by last sync (UI display)
 *   - "lastErrorCode"     : Int — non-zero when last attempt failed
 *   - "lastErrorMessage"  : String? — Bilibili-style error surfacing
 *
 * Mirrors [com.chainlesschain.android.pdh.social.wechat.WeChatCredentialsStore]
 * deliberately — same lifecycle (saveAccount → recordSync → clear), same
 * safeGet defensive read pattern. Key differences from WeChat:
 *   - QQ has no keyProvider gate ("md5" vs "frida") — IMEI is the key
 *   - QQ has no dbKeyHex — the DB itself is plain SQLite, not SQLCipher
 *   - imei is REQUIRED at saveAccount time (not optional like WeChat's md5)
 */
@Singleton
class QQCredentialsStore @Inject constructor(
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
            val imei = prefs.getString(KEY_IMEI, null)
            uin != null && uin.isNotBlank() && imei != null && imei.isNotBlank()
        } catch (t: Throwable) {
            // EncryptedSharedPreferences can throw on master-key rotation /
            // keystore corruption (rare but real on factory reset). Treat as
            // "not logged in"; user re-saves.
            Timber.w(t, "QQCredentialsStore.hasCredentials threw — treating as unauthenticated")
            false
        }
    }

    fun getUin(): String? = safeGet { prefs.getString(KEY_UIN, null)?.takeIf { it.isNotBlank() } }

    fun getImei(): String? = safeGet { prefs.getString(KEY_IMEI, null)?.takeIf { it.isNotBlank() } }

    fun getDisplayName(): String? = safeGet { prefs.getString(KEY_DISPLAY_NAME, null)?.takeIf { it.isNotBlank() } }

    fun getLastSyncAt(): Long? = safeGet { prefs.getLong(KEY_LAST_SYNC_AT, 0L).takeIf { it > 0L } }

    fun getLastSyncCount(): Int = safeGet { prefs.getInt(KEY_LAST_SYNC_COUNT, 0) } ?: 0

    fun getLastErrorCode(): Int = safeGet { prefs.getInt(KEY_LAST_ERROR_CODE, 0) } ?: 0

    fun getLastErrorMessage(): String? = safeGet { prefs.getString(KEY_LAST_ERROR_MESSAGE, null) }

    /**
     * Save the user-provided uin + imei. Called from HubLocalViewModel.
     * confirmQQUinImei after user enters both fields in the QQ login dialog.
     *
     * Both fields validated — uin must be digits, imei must be 15 digits.
     * Throws IllegalArgumentException on validation failure so the UI can
     * surface a clear error rather than a silent persist of bad data.
     */
    fun saveAccount(uin: String, imei: String, displayName: String? = null) {
        try {
            require(uin.isNotBlank()) { "uin must not be blank" }
            require(uin.all { it.isDigit() }) { "uin must be digits only (was '$uin')" }
            require(imei.isNotBlank()) { "imei must not be blank" }
            require(imei.length == 15) {
                "imei must be 15 digits (mainland China standard); was ${imei.length} chars"
            }
            require(imei.all { it.isDigit() }) { "imei must be digits only" }
            prefs.edit().apply {
                putString(KEY_UIN, uin)
                putString(KEY_IMEI, imei)
                if (!displayName.isNullOrBlank()) putString(KEY_DISPLAY_NAME, displayName) else remove(KEY_DISPLAY_NAME)
                apply()
            }
        } catch (t: Throwable) {
            Timber.e(t, "QQCredentialsStore.saveAccount failed")
            throw t  // re-throw — UI must surface validation errors
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
            Timber.w(t, "QQCredentialsStore.recordSync failed (non-fatal)")
        }
    }

    fun recordError(code: Int, message: String?) {
        try {
            prefs.edit()
                .putInt(KEY_LAST_ERROR_CODE, code)
                .putString(KEY_LAST_ERROR_MESSAGE, message ?: "")
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "QQCredentialsStore.recordError failed (non-fatal)")
        }
    }

    fun clear() {
        try {
            prefs.edit().clear().apply()
        } catch (t: Throwable) {
            Timber.w(t, "QQCredentialsStore.clear failed")
        }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "QQCredentialsStore: read failed")
        null
    }

    companion object {
        private const val PREFS_NAME = "pdh_messaging_qq"
        private const val KEY_UIN = "uin"
        private const val KEY_IMEI = "imei"
        private const val KEY_DISPLAY_NAME = "displayName"
        private const val KEY_LAST_SYNC_AT = "lastSyncAtMs"
        private const val KEY_LAST_SYNC_COUNT = "lastSyncCount"
        private const val KEY_LAST_ERROR_CODE = "lastErrorCode"
        private const val KEY_LAST_ERROR_MESSAGE = "lastErrorMessage"
    }
}
