package com.chainlesschain.android.pdh.social.common

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import timber.log.Timber

/**
 * Phase B0 — abstract base for path-B (in-APK root) credentials stores.
 *
 * Lifts the EncryptedSharedPreferences boilerplate + safeGet
 * defensive-read pattern + uid/lastSync/lastError common fields out of
 * WeChatCredentialsStore + QQCredentialsStore. The 6 new platform
 * stores subclass this; WeChat / QQ keep their bespoke stores (changing
 * those would re-trigger Trap 1 — EncryptedSharedPreferences first-create
 * race under MIUI 14 — for no real benefit).
 *
 * Subclass adds platform-specific fields (e.g. Douyin needs `secUid` +
 * `webViewCookieBlob`) via the [editPlatformExtras] hook called inside
 * [saveAccount]'s atomic edit.
 *
 * Defensive read: every getter wraps in [safeGet] because
 * EncryptedSharedPreferences can throw on master-key rotation /
 * keystore corruption (rare but real on factory reset; treat as "not
 * logged in", user re-saves).
 *
 * The store does NOT manage db keys — that's [LocalRootCollector]
 * impl's job (frida hook / md5 derivation / XOR-IMEI lookup). Stores
 * persist only stable per-account identifiers.
 *
 * @param context  app context — used to create EncryptedSharedPreferences
 * @param prefsName  per-platform SharedPreferences filename (e.g.
 *                   `"pdh_social_douyin"`); MUST be unique across the
 *                   `pdh_social_*` family
 */
abstract class BaseRootCredentialsStore(
    protected val context: Context,
    private val prefsName: String,
) {

    protected val prefs: SharedPreferences by lazy {
        try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                prefsName,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (t: Throwable) {
            // EncryptedSharedPreferences can fail on first-create under
            // MIUI 14 (Trap 1). Fall back to plain SharedPreferences so
            // the user isn't blocked entirely — log loudly so the issue
            // surfaces in Crashlytics. uid/lastSync are not catastrophic
            // if leaked to ADB; UI surfaces a "security 降级" banner.
            Timber.e(t, "BaseRootCredentialsStore: EncryptedSharedPreferences create failed for %s; falling back to plain", prefsName)
            context.getSharedPreferences("${prefsName}_plain", Context.MODE_PRIVATE)
        }
    }

    /**
     * Whether the user has completed the account dialog (uid present
     * and non-blank). Subclasses with multi-field credentials override
     * this — e.g. QQ requires both uin AND imei.
     */
    open fun hasCredentials(): Boolean = !getUid().isNullOrBlank()

    fun getUid(): String? = safeGet { prefs.getString(KEY_UID, null)?.takeIf { it.isNotBlank() } }

    fun getLastSyncAt(): Long? = safeGet { prefs.getLong(KEY_LAST_SYNC_AT, 0L).takeIf { it > 0L } }

    fun getLastSyncCount(): Int = safeGet { prefs.getInt(KEY_LAST_SYNC_COUNT, 0) } ?: 0

    fun getLastErrorCode(): Int = safeGet { prefs.getInt(KEY_LAST_ERROR_CODE, 0) } ?: 0

    fun getLastErrorMessage(): String? = safeGet { prefs.getString(KEY_LAST_ERROR_MESSAGE, null) }

    /**
     * Atomically save the user's account uid + any platform-specific
     * extras the subclass needs. The platform-extras hook fires inside
     * the same `edit().apply()` so the write is atomic (no observable
     * mid-state where uid is set but extras aren't).
     */
    fun saveAccount(uid: String, vararg extras: Pair<String, Any?>) {
        try {
            require(uid.isNotBlank()) { "uid must not be blank" }
            prefs.edit().apply {
                putString(KEY_UID, uid)
                extras.forEach { (k, v) ->
                    when (v) {
                        null -> remove(k)
                        is String -> putString(k, v)
                        is Int -> putInt(k, v)
                        is Long -> putLong(k, v)
                        is Boolean -> putBoolean(k, v)
                        is Float -> putFloat(k, v)
                        else -> throw IllegalArgumentException(
                            "saveAccount extra '$k' must be String/Int/Long/Boolean/Float; was ${v::class.simpleName}",
                        )
                    }
                }
                apply()
            }
        } catch (t: Throwable) {
            Timber.e(t, "BaseRootCredentialsStore.saveAccount failed for %s", prefsName)
            throw t  // re-throw — caller must know save didn't persist
        }
    }

    fun recordSync(atMs: Long, count: Int) {
        try {
            prefs.edit()
                .putLong(KEY_LAST_SYNC_AT, atMs)
                .putInt(KEY_LAST_SYNC_COUNT, count)
                .putInt(KEY_LAST_ERROR_CODE, 0)
                .remove(KEY_LAST_ERROR_MESSAGE)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "BaseRootCredentialsStore.recordSync failed (non-fatal)")
        }
    }

    fun recordError(code: Int, message: String?) {
        try {
            prefs.edit()
                .putInt(KEY_LAST_ERROR_CODE, code)
                .putString(KEY_LAST_ERROR_MESSAGE, message ?: "")
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "BaseRootCredentialsStore.recordError failed (non-fatal)")
        }
    }

    fun clear() {
        try {
            prefs.edit().clear().apply()
        } catch (t: Throwable) {
            Timber.w(t, "BaseRootCredentialsStore.clear failed for %s", prefsName)
        }
    }

    /**
     * Subclasses use this for platform-specific getters that need the
     * same defensive try/catch as the built-in ones. EncryptedSharedPreferences
     * throws on keystore corruption — treat as "not set" and let UI
     * re-prompt rather than crash.
     */
    protected fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "BaseRootCredentialsStore: read failed for %s", prefsName)
        null
    }

    companion object {
        /** Common field keys — subclasses must NOT redefine these. */
        const val KEY_UID = "uid"
        const val KEY_LAST_SYNC_AT = "lastSyncAtMs"
        const val KEY_LAST_SYNC_COUNT = "lastSyncCount"
        const val KEY_LAST_ERROR_CODE = "lastErrorCode"
        const val KEY_LAST_ERROR_MESSAGE = "lastErrorMessage"
    }
}
