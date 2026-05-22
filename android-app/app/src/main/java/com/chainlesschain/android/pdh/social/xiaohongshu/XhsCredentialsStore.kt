package com.chainlesschain.android.pdh.social.xiaohongshu

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §A8 v0.2 — persists the xiaohongshu.com cookie + UID + a1 token (anti-bot
 * fingerprint required by X-S signature) + last-sync metadata.
 *
 * 与 Weibo/Bilibili 同模板 (AES-256-GCM via AndroidKeyStore master key). 关键
 * 差异：除 cookie/uid 外还存 `a1` (从 cookie 解析出来的 anti-bot 指纹)，因为
 * 小红书的 X-S 签名算法必须以 a1 作为输入；不存的话每次 sync 都要重新解 cookie
 * 找 a1，徒增出错面。
 *
 * Schema (flat):
 *   - "cookie"        : 完整 Cookie header value (含 web_session + a1 + webId)
 *   - "uid"           : Long, 从 /api/sns/web/v1/user/me 异步拿到后存
 *   - "a1"            : 从 cookie a1 字段解析的 fingerprint string
 *   - "displayName"   : optional 用户可见 label (从 user/me API 拿 nickname)
 *   - "lastSyncAtMs"  : Long epoch-ms of last successful snapshot
 *   - "lastSyncCount" : Int total events written by last sync
 */
@Singleton
class XhsCredentialsStore @Inject constructor(
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
            // 与 Weibo 不同：xhs uid 是 base64 string ("60xxxx") 不是 Long。
            // 这里用 Long(0) 作"未登录"哨兵，实际 uid 存 displayName 同样
            // 编码字段里，hasCredentials 只看 cookie 非空 + a1 非空。
            cookie != null && cookie.isNotBlank() && uid > 0L
        } catch (t: Throwable) {
            Timber.w(t, "XhsCredentialsStore.hasCredentials threw — treating as unauthenticated")
            false
        }
    }

    fun getCookie(): String? = safeGet { prefs.getString(KEY_COOKIE, null) }

    fun getUid(): Long? = safeGet { prefs.getLong(KEY_UID, 0L).takeIf { it > 0L } }

    /**
     * xhs user_id 是 24-char hex string ("5e8c8f7e..."), 不能编进 Long uid。
     * 真 user_id 走这个独立字段；Long getUid() 仅作 hasCredentials() 哨兵。
     */
    fun getUserIdStr(): String? = safeGet {
        prefs.getString(KEY_USER_ID_STR, null)?.takeIf { it.isNotBlank() }
    }

    fun getA1(): String? = safeGet { prefs.getString(KEY_A1, null)?.takeIf { it.isNotBlank() } }

    fun getDisplayName(): String? = safeGet { prefs.getString(KEY_DISPLAY_NAME, null) }

    fun getLastSyncAt(): Long? = safeGet { prefs.getLong(KEY_LAST_SYNC_AT, 0L).takeIf { it > 0L } }

    fun getLastSyncCount(): Int = safeGet { prefs.getInt(KEY_LAST_SYNC_COUNT, 0) } ?: 0

    fun saveCredentials(
        cookie: String,
        uid: Long,
        userIdStr: String,
        a1: String,
        displayName: String?,
    ) {
        try {
            prefs.edit()
                .putString(KEY_COOKIE, cookie)
                .putLong(KEY_UID, uid)
                .putString(KEY_USER_ID_STR, userIdStr)
                .putString(KEY_A1, a1)
                .putString(KEY_DISPLAY_NAME, displayName ?: "")
                .apply()
        } catch (t: Throwable) {
            Timber.e(t, "XhsCredentialsStore.saveCredentials failed")
        }
    }

    fun recordSync(at: Long, count: Int) {
        try {
            prefs.edit()
                .putLong(KEY_LAST_SYNC_AT, at)
                .putInt(KEY_LAST_SYNC_COUNT, count)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "XhsCredentialsStore.recordSync failed (non-fatal)")
        }
    }

    fun clear() {
        try {
            prefs.edit().clear().apply()
        } catch (t: Throwable) {
            Timber.w(t, "XhsCredentialsStore.clear failed")
        }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "XhsCredentialsStore: read failed")
        null
    }

    companion object {
        private const val PREFS_NAME = "pdh_social_xiaohongshu"
        private const val KEY_COOKIE = "cookie"
        private const val KEY_UID = "uid"
        private const val KEY_USER_ID_STR = "userIdStr"
        private const val KEY_A1 = "a1"
        private const val KEY_DISPLAY_NAME = "displayName"
        private const val KEY_LAST_SYNC_AT = "lastSyncAtMs"
        private const val KEY_LAST_SYNC_COUNT = "lastSyncCount"
    }
}
