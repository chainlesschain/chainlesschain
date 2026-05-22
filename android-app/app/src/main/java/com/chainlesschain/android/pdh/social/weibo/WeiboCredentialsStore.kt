package com.chainlesschain.android.pdh.social.weibo

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.2 — persists the Weibo m.weibo.cn cookie + UID + last-sync metadata.
 *
 * 与 BilibiliCredentialsStore 同模板（AES-256-GCM via AndroidKeyStore master
 * key）。微博 cookie 字段 SUB/SUBP/_T_WM/MLOGIN 都是高权限 token，必须 sealed
 * storage；EncryptedSharedPreferences 在 master-key rotation / keystore 损坏时
 * 会抛，safeGet 兜底返 null = "未登录" 引导重 login。
 *
 * Schema:
 *   - "cookie"        : 完整 Cookie header value (含 SUB/SUBP/_T_WM)
 *   - "uid"           : Long, 不再可从 cookie 直读（与 Bilibili 不同），需
 *                       async fetch /api/config 拿到后写入
 *   - "displayName"   : optional 用户可见 label
 *   - "lastSyncAtMs"  : Long epoch-ms of last successful snapshot
 *   - "lastSyncCount" : Int total events written by last sync
 */
@Singleton
class WeiboCredentialsStore @Inject constructor(
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
            Timber.w(t, "WeiboCredentialsStore.hasCredentials threw — treating as unauthenticated")
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
            Timber.e(t, "WeiboCredentialsStore.saveCredentials failed")
        }
    }

    fun recordSync(at: Long, count: Int) {
        try {
            prefs.edit()
                .putLong(KEY_LAST_SYNC_AT, at)
                .putInt(KEY_LAST_SYNC_COUNT, count)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "WeiboCredentialsStore.recordSync failed (non-fatal)")
        }
    }

    fun clear() {
        try {
            prefs.edit().clear().apply()
        } catch (t: Throwable) {
            Timber.w(t, "WeiboCredentialsStore.clear failed")
        }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "WeiboCredentialsStore: read failed")
        null
    }

    companion object {
        private const val PREFS_NAME = "pdh_social_weibo"
        private const val KEY_COOKIE = "cookie"
        private const val KEY_UID = "uid"
        private const val KEY_DISPLAY_NAME = "displayName"
        private const val KEY_LAST_SYNC_AT = "lastSyncAtMs"
        private const val KEY_LAST_SYNC_COUNT = "lastSyncCount"
    }
}
