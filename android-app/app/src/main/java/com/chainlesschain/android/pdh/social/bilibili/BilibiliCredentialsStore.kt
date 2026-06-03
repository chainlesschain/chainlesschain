package com.chainlesschain.android.pdh.social.bilibili

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A8 v0.1 — persists the Bilibili browser cookie + UID + last-sync timestamp.
 *
 * Backed by EncryptedSharedPreferences (AES-256-GCM under a master key from
 * AndroidKeyStore). The cookie is a high-value secret (full account access)
 * so we deliberately avoid plain SharedPreferences which leaves data
 * readable to anyone with adb on a debuggable build.
 *
 * Schema (intentionally flat):
 *   - "cookie"        : full Cookie header value as captured by WebView
 *   - "uid"           : Long, parsed from DedeUserID at login time
 *   - "displayName"   : optional user-visible label (we don't fetch /me;
 *                       UID alone is enough). Empty string default.
 *   - "lastSyncAtMs"  : Long epoch-ms of last successful snapshot
 *   - "lastSyncCount" : Int total events written by last sync (UI display)
 */
@Singleton
class BilibiliCredentialsStore @Inject constructor(
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
            val cookie = prefs.getString(KEY_COOKIE, null)
            val uid = prefs.getLong(KEY_UID, 0L)
            cookie != null && cookie.isNotBlank() && uid > 0L
        } catch (t: Throwable) {
            // EncryptedSharedPreferences can throw on master-key rotation /
            // keystore corruption (rare but real on factory reset). Treat as
            // "not logged in"; user re-logs.
            Timber.w(t, "BilibiliCredentialsStore.hasCredentials threw — treating as unauthenticated")
            false
        }
    }

    fun getCookie(): String? = safeGet { prefs.getString(KEY_COOKIE, null) }

    fun getUid(): Long? = safeGet { prefs.getLong(KEY_UID, 0L).takeIf { it > 0L } }

    fun getDisplayName(): String? = safeGet { prefs.getString(KEY_DISPLAY_NAME, null) }

    fun getLastSyncAt(): Long? = safeGet { prefs.getLong(KEY_LAST_SYNC_AT, 0L).takeIf { it > 0L } }

    fun getLastSyncCount(): Int = safeGet { prefs.getInt(KEY_LAST_SYNC_COUNT, 0) } ?: 0

    fun saveCredentials(cookie: String, uid: Long, displayName: String?) {
        try {
            prefs.edit()
                .putString(KEY_COOKIE, cookie)
                .putLong(KEY_UID, uid)
                .putString(KEY_DISPLAY_NAME, displayName ?: "")
                .apply()
        } catch (t: Throwable) {
            Timber.e(t, "BilibiliCredentialsStore.saveCredentials failed")
        }
    }

    fun recordSync(at: Long, count: Int) {
        try {
            prefs.edit()
                .putLong(KEY_LAST_SYNC_AT, at)
                .putInt(KEY_LAST_SYNC_COUNT, count)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "BilibiliCredentialsStore.recordSync failed (non-fatal)")
        }
    }

    fun clear() {
        try {
            prefs.edit().clear().apply()
        } catch (t: Throwable) {
            Timber.w(t, "BilibiliCredentialsStore.clear failed")
        }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "BilibiliCredentialsStore: read failed")
        null
    }

    companion object {
        private const val PREFS_NAME = "pdh_social_bilibili"
        private const val KEY_COOKIE = "cookie"
        private const val KEY_UID = "uid"
        private const val KEY_DISPLAY_NAME = "displayName"
        private const val KEY_LAST_SYNC_AT = "lastSyncAtMs"
        private const val KEY_LAST_SYNC_COUNT = "lastSyncCount"
    }
}
