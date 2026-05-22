package com.chainlesschain.android.pdh.travel

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §2.5 D8.2 — 出行 cookie + sync state 存储 (高德 + 携程)。
 *
 * Schema (per-vendor prefix in flat namespace):
 *   - "<v>_cookie"        : full cookie header
 *   - "<v>_lastSyncAtMs"  : Long epoch-ms
 *   - "<v>_lastSyncCount" : Int 上次同步入库事件数
 *
 * 跟 AiChatCredentialsStore / EmailCredentialsStore 同 pattern。
 */
@Singleton
class TravelCredentialsStore @Inject constructor(
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

    fun hasCredentials(vendor: String): Boolean = safeGet {
        prefs.getString(keyCookie(vendor), null).let { !it.isNullOrBlank() }
    } ?: false

    fun getCookie(vendor: String): String? = safeGet {
        prefs.getString(keyCookie(vendor), null)?.takeIf { it.isNotBlank() }
    }

    fun getLastSyncAt(vendor: String): Long? = safeGet {
        prefs.getLong(keyLastSyncAt(vendor), 0L).takeIf { it > 0L }
    }

    fun getLastSyncCount(vendor: String): Int = safeGet {
        prefs.getInt(keyLastSyncCount(vendor), 0)
    } ?: 0

    fun saveCookie(vendor: String, cookie: String) {
        try {
            prefs.edit().putString(keyCookie(vendor), cookie).apply()
        } catch (t: Throwable) {
            Timber.e(t, "TravelCredentialsStore.saveCookie failed vendor=%s", vendor)
        }
    }

    fun recordSync(vendor: String, at: Long, count: Int) {
        try {
            prefs.edit()
                .putLong(keyLastSyncAt(vendor), at)
                .putInt(keyLastSyncCount(vendor), count)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "TravelCredentialsStore.recordSync failed vendor=%s", vendor)
        }
    }

    fun clear(vendor: String) {
        try {
            prefs.edit()
                .remove(keyCookie(vendor))
                .remove(keyLastSyncAt(vendor))
                .remove(keyLastSyncCount(vendor))
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "TravelCredentialsStore.clear failed vendor=%s", vendor)
        }
    }

    fun clearAll() {
        try { prefs.edit().clear().apply() }
        catch (t: Throwable) { Timber.w(t, "TravelCredentialsStore.clearAll failed") }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "TravelCredentialsStore: read failed")
        null
    }

    companion object {
        private const val PREFS_NAME = "pdh_travel_cookie"
        internal fun keyCookie(v: String) = "${v}_cookie"
        internal fun keyLastSyncAt(v: String) = "${v}_lastSyncAtMs"
        internal fun keyLastSyncCount(v: String) = "${v}_lastSyncCount"
    }
}
