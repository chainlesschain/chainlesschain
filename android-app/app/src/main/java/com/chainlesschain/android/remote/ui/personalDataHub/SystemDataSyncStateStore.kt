package com.chainlesschain.android.remote.ui.personalDataHub

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Persists the system-data (contacts + apps) card's "last synced" metadata so
 * the UI can recall it across process death / Activity recreate / reopen.
 *
 * Before this store existed [HubLocalViewModel.SystemDataCardState] lived only
 * in memory, so reopening the app surfaced as "未同步" even though the vault.db
 * (filesDir/.chainlesschain/hub/) had been populated by a previous successful
 * `cc syncAdapter` call — the data was on disk, the *memory of having synced*
 * was not. Users would re-press 同步, the adapter would dedup, and they'd see
 * the same row count again, but the UX felt redundant.
 *
 * Schema (intentionally flat, mirrors [com.chainlesschain.android.pdh.social.bilibili.BilibiliCredentialsStore]):
 *   - "lastSnapshotAtMs" : Long epoch-ms of last successful snapshot
 *   - "contactsCount"    : Int contacts captured at that snapshot
 *   - "appsCount"        : Int installed apps captured
 *   - "ingested"         : Int rows reported written by `cc syncAdapter`
 *
 * Encrypted-prefs even though this is just metadata (no PII) because the
 * counts are a privacy signal (user has N contacts) and we already pay the
 * master-key cost from sibling credential stores.
 */
@Singleton
class SystemDataSyncStateStore @Inject constructor(
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

    fun getLastSnapshotAt(): Long? = safeGet {
        prefs.getLong(KEY_LAST_SNAPSHOT_AT, 0L).takeIf { it > 0L }
    }

    fun getContactsCount(): Int = safeGet { prefs.getInt(KEY_CONTACTS_COUNT, 0) } ?: 0

    fun getAppsCount(): Int = safeGet { prefs.getInt(KEY_APPS_COUNT, 0) } ?: 0

    fun getIngested(): Int = safeGet { prefs.getInt(KEY_INGESTED, 0) } ?: 0

    fun recordSync(at: Long, contactsCount: Int, appsCount: Int, ingested: Int) {
        try {
            prefs.edit()
                .putLong(KEY_LAST_SNAPSHOT_AT, at)
                .putInt(KEY_CONTACTS_COUNT, contactsCount)
                .putInt(KEY_APPS_COUNT, appsCount)
                .putInt(KEY_INGESTED, ingested)
                .apply()
        } catch (t: Throwable) {
            Timber.w(t, "SystemDataSyncStateStore.recordSync failed (non-fatal)")
        }
    }

    fun clear() {
        try {
            prefs.edit().clear().apply()
        } catch (t: Throwable) {
            Timber.w(t, "SystemDataSyncStateStore.clear failed")
        }
    }

    private fun <T> safeGet(block: () -> T?): T? = try {
        block()
    } catch (t: Throwable) {
        Timber.w(t, "SystemDataSyncStateStore: read failed")
        null
    }

    companion object {
        private const val PREFS_NAME = "pdh_system_data_sync_state"
        private const val KEY_LAST_SNAPSHOT_AT = "lastSnapshotAtMs"
        private const val KEY_CONTACTS_COUNT = "contactsCount"
        private const val KEY_APPS_COUNT = "appsCount"
        private const val KEY_INGESTED = "ingested"
    }
}
