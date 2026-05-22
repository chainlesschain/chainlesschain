package com.chainlesschain.android.pdh.social.douyin

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.2 — persists the Douyin web cookie + sec_user_id + last-sync metadata.
 *
 * 与 Bilibili/Weibo 同模板（AES-256-GCM via AndroidKeyStore master key）。
 * 抖音 cookie 字段 sessionid / sessionid_ss / sid_guard / passport_csrf_token /
 * uid_tt 等等高权限 token，必须 sealed storage；EncryptedSharedPreferences
 * 在 master-key rotation / keystore 损坏时会抛，safeGet 兜底返 null =
 * "未登录" 引导重 login。
 *
 * Schema:
 *   - "cookie"        : 完整 Cookie header value (含 sessionid/uid_tt/...)
 *   - "secUid"        : String, 抖音 Base64-like 稳定 ID (MS4wLjABA…)，需
 *                       async fetch /passport/account/info/v2/ 拿到后写入
 *   - "shortId"       : 抖音 numeric short ID (从 cookie 的 uid_tt 直读)
 *   - "displayName"   : optional 用户可见 label
 *   - "lastSyncAtMs"  : Long epoch-ms of last successful snapshot
 *   - "lastSyncCount" : Int total events written by last sync
 */
@Singleton
class DouyinCredentialsStore @Inject constructor(
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
            val secUid = prefs.getString(KEY_SEC_UID, null)
            cookie != null && cookie.isNotBlank() && secUid != null && secUid.isNotBlank()
        } catch (t: Throwable) {
            Timber.w(t, "DouyinCredentialsStore.hasCredentials threw — treating as unauthenticated")
            false
        }
    }

    fun getCookie(): String? = safeGet { prefs.getString(KEY_COOKIE, null) }

    fun getSecUid(): String? = safeGet { prefs.getString(KEY_SEC_UID, null)?.takeIf { it.isNotBlank() } }

    fun getShortId(): String? = safeGet { prefs.getString(KEY_SHORT_ID, null)?.takeIf { it.isNotBlank() } }

    fun getDisplayName(): String? = safeGet { prefs.getString(KEY_DISPLAY_NAME, null) }

    fun getLastSyncAt(): Long? = safeGet { prefs.getLong(KEY_LAST_SYNC_AT, 0L).takeIf { it > 0L } }

    fun getLastSyncCount(): Int = safeGet { prefs.getInt(KEY_LAST_SYNC_COUNT, 0) } ?: 0

    fun saveCredentials(
        cookie: String,
        secUid: String,
        shortId: String?,
        displayName: String?,
    ) {
        try {
            prefs.edit()
                .putString(KEY_COOKIE, cookie)
                .putString(KEY_SEC_UID, secUid)
                .putString(KEY_SHORT_ID, shortId ?: "")
                .putString(KEY_DISPLAY_NAME, displayName ?: "")
                .apply()
        } catch (t: Throwable) {
            Timber.e(t, "DouyinCredentialsStore.saveCredentials failed")
        }
    }

    fun recordSync(at: Long, count: Int) {
        try {
            prefs.edit()
                .putLong(KEY_LAST_SYNC_AT, at)
                .putInt(KEY_LAST_SYNC_COUNT, count)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "DouyinCredentialsStore.recordSync failed (non-fatal)")
        }
    }

    fun clear() {
        try {
            prefs.edit().clear().apply()
        } catch (t: Throwable) {
            Timber.w(t, "DouyinCredentialsStore.clear failed")
        }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "DouyinCredentialsStore: read failed")
        null
    }

    companion object {
        private const val PREFS_NAME = "pdh_social_douyin"
        private const val KEY_COOKIE = "cookie"
        private const val KEY_SEC_UID = "secUid"
        private const val KEY_SHORT_ID = "shortId"
        private const val KEY_DISPLAY_NAME = "displayName"
        private const val KEY_LAST_SYNC_AT = "lastSyncAtMs"
        private const val KEY_LAST_SYNC_COUNT = "lastSyncCount"
    }
}
