package com.chainlesschain.android.pdh.social.aichat

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §2.6 D10.2 — persists per-vendor cookie + last-sync metadata for the 9
 * AI 助手 (推文 §"AI 助手": 豆包 / 文心 / Kimi / 通义 / DeepSeek / 智谱 /
 * 混元 / 千帆 / 扣子)。
 *
 * Schema (per-vendor prefix in flat key namespace):
 *   - "<v>_cookie"         : 完整 Cookie header value
 *   - "<v>_lastSyncAtMs"   : Long epoch-ms of last successful snapshot
 *   - "<v>_lastSyncCount"  : Int total events written
 *
 * 单 store 不分 9 文件 — vendor 列表稳定（推文 §AI 助手 9 家固定），9 个
 * 分别 EncryptedSharedPreferences 实例会让 keystore master-key 派生开销 9×。
 *
 * 安全特征跟 BilibiliCredentialsStore 一致：cookie = 全权限秘密，必 AES-256-
 * GCM (AndroidKeyStore master-key)。EncryptedSharedPreferences 在 master-
 * key 轮换 / keystore 损坏时会抛，safeGet 兜底返 null = "未登录"，引导用
 * 户重新走 WebView login。
 */
@Singleton
class AiChatCredentialsStore @Inject constructor(
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
        val cookie = prefs.getString(keyCookie(vendor), null)
        cookie != null && cookie.isNotBlank()
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
            Timber.e(t, "AiChatCredentialsStore.saveCookie failed vendor=%s", vendor)
        }
    }

    fun recordSync(vendor: String, at: Long, count: Int) {
        try {
            prefs.edit()
                .putLong(keyLastSyncAt(vendor), at)
                .putInt(keyLastSyncCount(vendor), count)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "AiChatCredentialsStore.recordSync failed vendor=%s", vendor)
        }
    }

    /** 清单 vendor 凭据 — 退出登录路径。其它 vendor 不受影响。 */
    fun clear(vendor: String) {
        try {
            prefs.edit()
                .remove(keyCookie(vendor))
                .remove(keyLastSyncAt(vendor))
                .remove(keyLastSyncCount(vendor))
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "AiChatCredentialsStore.clear failed vendor=%s", vendor)
        }
    }

    /** 全清（仅给 destroy vault 路径调；不暴露在普通 UI 上）。 */
    fun clearAll() {
        try {
            prefs.edit().clear().apply()
        } catch (t: Throwable) {
            Timber.w(t, "AiChatCredentialsStore.clearAll failed")
        }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "AiChatCredentialsStore: read failed")
        null
    }

    companion object {
        private const val PREFS_NAME = "pdh_social_aichat"
        internal fun keyCookie(v: String) = "${v}_cookie"
        internal fun keyLastSyncAt(v: String) = "${v}_lastSyncAtMs"
        internal fun keyLastSyncCount(v: String) = "${v}_lastSyncCount"
    }
}
