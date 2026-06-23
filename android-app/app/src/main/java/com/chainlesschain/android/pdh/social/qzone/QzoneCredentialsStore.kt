package com.chainlesschain.android.pdh.social.qzone

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Persists the QQ空间 (Qzone) web cookie + uin + last-sync metadata.
 *
 * 与 Toutiao/Bilibili/Weibo 同模板（AES-256-GCM via AndroidKeyStore master key）。
 * Qzone cookie 含 p_skey / skey / p_uin 等高敏登录票据，必须 sealed storage；
 * EncryptedSharedPreferences 在 master-key rotation / keystore 损坏时会抛，
 * safeGet 兜底返 null = "未登录" 引导重 login（与同套件保持一致）。
 *
 * 与其它平台不同：Qzone 没有本地库，采集走 API（cc hub collect-qzone），所以
 * 这里存的 cookie 就是采集凭据本身（in-APK cc 用它算 g_tk 拉 feed）。cookie 里的
 * qzone-domain p_skey 才是关键（base .qq.com skey 会被拒 "请先登录空间"）。
 *
 * Schema:
 *   - "cookie"        : 完整 Cookie header value（含 uin + p_skey）
 *   - "uid"           : 数字 uin（从 cookie uin=o0<uin> 抽）
 *   - "displayName"   : optional 用户可见 label
 *   - "lastSyncAtMs"  : Long epoch-ms of last successful collect
 *   - "lastSyncCount" : Int total events written by last collect
 */
@Singleton
class QzoneCredentialsStore @Inject constructor(
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
            cookie != null && cookie.isNotBlank() && cookie.contains("p_skey")
        } catch (t: Throwable) {
            Timber.w(t, "QzoneCredentialsStore.hasCredentials threw — treating as unauthenticated")
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
            Timber.e(t, "QzoneCredentialsStore.saveCredentials failed")
        }
    }

    fun recordSync(at: Long, count: Int) {
        try {
            prefs.edit()
                .putLong(KEY_LAST_SYNC_AT, at)
                .putInt(KEY_LAST_SYNC_COUNT, count)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "QzoneCredentialsStore.recordSync failed (non-fatal)")
        }
    }

    fun clear() {
        try {
            prefs.edit().clear().apply()
        } catch (t: Throwable) {
            Timber.w(t, "QzoneCredentialsStore.clear failed")
        }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "QzoneCredentialsStore: read failed")
        null
    }

    /** Parse the numeric uin from a Qzone cookie (`uin=o0<uin>`). */
    fun extractUid(cookie: String): String? {
        val m = Regex("(?:^|;\\s*)uin=o0?(\\d+)").find(cookie)
        return m?.groupValues?.get(1)
    }

    /**
     * Write the stored cookie to a staging file the in-APK cc can read, and
     * return its absolute path (null if no cookie). Kept off argv — cc reads it
     * via `--cookie-file`. Caller MUST [clearCookieFile] after collection: it
     * holds the qzone login ticket in plaintext on disk.
     */
    fun stageCookieFile(): String? {
        val cookie = getCookie() ?: return null
        return try {
            val dir = java.io.File(context.filesDir, ".chainlesschain/staging").apply { mkdirs() }
            val f = java.io.File(dir, "qzone-cookie.txt")
            f.writeText(cookie, Charsets.UTF_8)
            f.absolutePath
        } catch (t: Throwable) {
            Timber.e(t, "QzoneCredentialsStore.stageCookieFile failed")
            null
        }
    }

    fun clearCookieFile() {
        try {
            java.io.File(context.filesDir, ".chainlesschain/staging/qzone-cookie.txt").delete()
        } catch (_: Throwable) { /* best-effort */ }
    }

    companion object {
        private const val PREFS_NAME = "pdh_social_qzone"
        private const val KEY_COOKIE = "cookie"
        private const val KEY_UID = "uid"
        private const val KEY_DISPLAY_NAME = "displayName"
        private const val KEY_LAST_SYNC_AT = "lastSyncAtMs"
        private const val KEY_LAST_SYNC_COUNT = "lastSyncCount"
    }
}
