package com.chainlesschain.android.pdh.social.toutiao

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v0.1 — persists the Toutiao web cookie + uid + last-sync metadata.
 *
 * 与 Bilibili/Weibo/Douyin 同模板（AES-256-GCM via AndroidKeyStore master key）。
 * 头条 cookie 含 passport_uid / sessid / multi_sids 等高敏 token，必须 sealed
 * storage；EncryptedSharedPreferences 在 master-key rotation / keystore 损坏
 * 时会抛，safeGet 兜底返 null = "未登录" 引导重 login（与同套件保持一致）。
 *
 * Schema:
 *   - "cookie"        : 完整 Cookie header value
 *   - "uid"           : 数字 uid (从 cookie passport_uid / multi_sids 抽)
 *   - "displayName"   : optional 用户可见 label（v0.2 网络接通后写入；v0.1 留空）
 *   - "lastSyncAtMs"  : Long epoch-ms of last successful snapshot
 *   - "lastSyncCount" : Int total events written by last sync (v0.1 始终 0)
 */
@Singleton
class ToutiaoCredentialsStore @Inject constructor(
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
            val uid = prefs.getString(KEY_UID, null)
            cookie != null && cookie.isNotBlank() && uid != null && uid.isNotBlank()
        } catch (t: Throwable) {
            Timber.w(t, "ToutiaoCredentialsStore.hasCredentials threw — treating as unauthenticated")
            false
        }
    }

    fun getCookie(): String? = safeGet { prefs.getString(KEY_COOKIE, null) }

    fun getUid(): String? = safeGet { prefs.getString(KEY_UID, null)?.takeIf { it.isNotBlank() } }

    fun getDisplayName(): String? = safeGet { prefs.getString(KEY_DISPLAY_NAME, null)?.takeIf { it.isNotBlank() } }

    fun getLastSyncAt(): Long? = safeGet { prefs.getLong(KEY_LAST_SYNC_AT, 0L).takeIf { it > 0L } }

    fun getLastSyncCount(): Int = safeGet { prefs.getInt(KEY_LAST_SYNC_COUNT, 0) } ?: 0

    fun saveCredentials(cookie: String, uid: String, displayName: String? = null) {
        try {
            prefs.edit()
                .putString(KEY_COOKIE, cookie)
                .putString(KEY_UID, uid)
                .apply {
                    if (!displayName.isNullOrBlank()) putString(KEY_DISPLAY_NAME, displayName)
                    else remove(KEY_DISPLAY_NAME)
                }
                .apply()
        } catch (t: Throwable) {
            Timber.e(t, "ToutiaoCredentialsStore.saveCredentials failed")
        }
    }

    fun recordSync(at: Long, count: Int) {
        try {
            prefs.edit()
                .putLong(KEY_LAST_SYNC_AT, at)
                .putInt(KEY_LAST_SYNC_COUNT, count)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "ToutiaoCredentialsStore.recordSync failed (non-fatal)")
        }
    }

    fun clear() {
        try {
            prefs.edit().clear().apply()
        } catch (t: Throwable) {
            Timber.w(t, "ToutiaoCredentialsStore.clear failed")
        }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "ToutiaoCredentialsStore: read failed")
        null
    }

    companion object {
        private const val PREFS_NAME = "pdh_social_toutiao"
        private const val KEY_COOKIE = "cookie"
        private const val KEY_UID = "uid"
        private const val KEY_DISPLAY_NAME = "displayName"
        private const val KEY_LAST_SYNC_AT = "lastSyncAtMs"
        private const val KEY_LAST_SYNC_COUNT = "lastSyncCount"
    }
}
