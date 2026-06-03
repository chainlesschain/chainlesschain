package com.chainlesschain.android.pdh.email

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §2.3 D6.2 — 4 邮箱 vendor cred 存储 (QQ/Gmail/163/Outlook)。
 *
 * Per-vendor schema (flat namespace with prefix):
 *   - "<v>_user"          : 用户 IMAP 账号 (邮箱地址)
 *   - "<v>_password"      : IMAP 密码 / 授权码 / App Password (secret)
 *   - "<v>_imapHost"      : 用户输入的 imap host (默认从 EmailVendor 派生，
 *                           允许用户改 — 公司自建邮箱可能改 host)
 *   - "<v>_imapPort"      : 默认 993，allow override
 *   - "<v>_lastSyncAtMs"  : Long epoch-ms
 *   - "<v>_lastSyncCount" : Int 上次同步入库邮件数
 *
 * 单 store 不分 4 文件 — 跟 AiChatCredentialsStore 同 pattern (key prefix
 * by vendor)，节省 keystore master-key 派生开销。
 *
 * 安全：AES-256-GCM masterkey 走 AndroidKeyStore。EncryptedSharedPreferences
 * 在 master-key 轮换 / keystore 损坏时抛 — safeGet 兜底返 null = "未配置"，
 * 引导重新走 dialog。
 */
@Singleton
class EmailCredentialsStore @Inject constructor(
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
        val user = prefs.getString(keyUser(vendor), null)
        val pw = prefs.getString(keyPassword(vendor), null)
        !user.isNullOrBlank() && !pw.isNullOrBlank()
    } ?: false

    fun getUser(vendor: String): String? = safeGet {
        prefs.getString(keyUser(vendor), null)?.takeIf { it.isNotBlank() }
    }

    fun getPassword(vendor: String): String? = safeGet {
        prefs.getString(keyPassword(vendor), null)?.takeIf { it.isNotBlank() }
    }

    fun getImapHost(vendor: String): String? = safeGet {
        prefs.getString(keyImapHost(vendor), null)?.takeIf { it.isNotBlank() }
    }

    fun getImapPort(vendor: String): Int? = safeGet {
        prefs.getInt(keyImapPort(vendor), 0).takeIf { it > 0 }
    }

    fun getLastSyncAt(vendor: String): Long? = safeGet {
        prefs.getLong(keyLastSyncAt(vendor), 0L).takeIf { it > 0L }
    }

    fun getLastSyncCount(vendor: String): Int = safeGet {
        prefs.getInt(keyLastSyncCount(vendor), 0)
    } ?: 0

    fun saveCredentials(
        vendor: String,
        user: String,
        password: String,
        imapHost: String,
        imapPort: Int,
    ) {
        try {
            prefs.edit()
                .putString(keyUser(vendor), user)
                .putString(keyPassword(vendor), password)
                .putString(keyImapHost(vendor), imapHost)
                .putInt(keyImapPort(vendor), imapPort)
                .apply()
        } catch (t: Throwable) {
            Timber.e(t, "EmailCredentialsStore.saveCredentials failed vendor=%s", vendor)
        }
    }

    fun recordSync(vendor: String, at: Long, count: Int) {
        try {
            prefs.edit()
                .putLong(keyLastSyncAt(vendor), at)
                .putInt(keyLastSyncCount(vendor), count)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "EmailCredentialsStore.recordSync failed vendor=%s", vendor)
        }
    }

    fun clear(vendor: String) {
        try {
            prefs.edit()
                .remove(keyUser(vendor))
                .remove(keyPassword(vendor))
                .remove(keyImapHost(vendor))
                .remove(keyImapPort(vendor))
                .remove(keyLastSyncAt(vendor))
                .remove(keyLastSyncCount(vendor))
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "EmailCredentialsStore.clear failed vendor=%s", vendor)
        }
    }

    fun clearAll() {
        try { prefs.edit().clear().apply() }
        catch (t: Throwable) { Timber.w(t, "EmailCredentialsStore.clearAll failed") }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "EmailCredentialsStore: read failed")
        null
    }

    companion object {
        private const val PREFS_NAME = "pdh_email_imap"
        internal fun keyUser(v: String) = "${v}_user"
        internal fun keyPassword(v: String) = "${v}_password"
        internal fun keyImapHost(v: String) = "${v}_imapHost"
        internal fun keyImapPort(v: String) = "${v}_imapPort"
        internal fun keyLastSyncAt(v: String) = "${v}_lastSyncAtMs"
        internal fun keyLastSyncCount(v: String) = "${v}_lastSyncCount"
    }
}
