package com.chainlesschain.android.pdh.social.wechat

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 12.10.1 — orchestrates a single WeChat sync end-to-end on Android.
 *
 * Pipeline (mirrors [com.chainlesschain.android.pdh.social.bilibili.BilibiliLocalCollector]):
 *
 *   1. Read uin + key state from [WeChatCredentialsStore]
 *   2. If keyProvider="frida" and dbKeyHex is null → [WeChatFridaInjector.extractKey]
 *      → persist the key
 *   3. [WeChatDbExtractor.extract] → staging JSON file on disk
 *   4. Return [SnapshotResult] so the caller (HubLocalViewModel) can hand
 *      the path to `LocalCcRunner.syncAdapter("wechat", path)`
 *
 * **STATUS**: scaffold only. Steps 2 + 3 are stubs (see WeChatFridaInjector
 * and WeChatDbExtractor); only the orchestration flow + error mapping is
 * real here. Phase 12.10.4 + 12.10.6 unblock the stubs on a real rooted
 * device.
 *
 * Failure modes (sealed result so HubLocalViewModel can pattern-match on
 * each and surface a distinct banner):
 *   - [SnapshotResult.NoCredentials] — user hasn't entered uin yet; UI
 *     launches the uin-entry dialog
 *   - [SnapshotResult.NoRoot] — device not rooted; UI shows "改用桌面端"
 *     banner with a deep-link to the desktop quickstart
 *   - [SnapshotResult.FridaInjectFailed] — frida hook didn't extract key
 *     (binary missing / WeChat anti-detection / timeout)
 *   - [SnapshotResult.ExtractFailed] — DB copy or decrypt failed
 *   - [SnapshotResult.Failed] — catch-all with reason code
 */
@Singleton
class WeChatLocalCollector @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: WeChatCredentialsStore,
    private val fridaInjector: WeChatFridaInjector,
    private val dbExtractor: WeChatDbExtractor,
) {

    sealed class SnapshotResult {
        data class Ok(
            val snapshotPath: String,
            val contactCount: Int,
            val messageCount: Int,
            val chatroomCount: Int,
            val totalEvents: Int,
            val keyProvider: String,
            val snapshottedAt: Long,
        ) : SnapshotResult()

        object NoCredentials : SnapshotResult()
        object NoRoot : SnapshotResult()
        data class FridaInjectFailed(val reason: String) : SnapshotResult()
        data class ExtractFailed(val reason: String, val message: String? = null) : SnapshotResult()
        data class Failed(val reason: String, val message: String? = null) : SnapshotResult()
    }

    suspend fun snapshot(): SnapshotResult = withContext(Dispatchers.IO) {
        if (!credentialsStore.hasCredentials()) {
            return@withContext SnapshotResult.NoCredentials
        }
        val uin = credentialsStore.getUin()
            ?: return@withContext SnapshotResult.NoCredentials

        if (!fridaInjector.isSuAvailable()) {
            return@withContext SnapshotResult.NoRoot
        }

        // 8.0+ path needs frida-extracted key. 7.x md5 path stores the key
        // at saveAccount() time so dbKeyHex is already populated.
        val provider = credentialsStore.getKeyProvider() ?: "frida"
        if (provider == "frida" && credentialsStore.getDbKeyHex() == null) {
            when (val keyResult = fridaInjector.extractKey(uin)) {
                is WeChatFridaInjector.KeyResult.Ok -> {
                    try {
                        credentialsStore.setDbKeyHex(keyResult.dbKeyHex)
                    } catch (t: Throwable) {
                        Timber.e(t, "WeChatLocalCollector: persist dbKeyHex failed")
                        return@withContext SnapshotResult.Failed("persist-key", t.message)
                    }
                }
                WeChatFridaInjector.KeyResult.NoRoot ->
                    return@withContext SnapshotResult.NoRoot
                WeChatFridaInjector.KeyResult.BinaryMissing ->
                    return@withContext SnapshotResult.FridaInjectFailed("binary-missing")
                WeChatFridaInjector.KeyResult.PidofFailed ->
                    return@withContext SnapshotResult.FridaInjectFailed("wechat-not-running")
                WeChatFridaInjector.KeyResult.HookTimedOut ->
                    return@withContext SnapshotResult.FridaInjectFailed("hook-timeout")
                is WeChatFridaInjector.KeyResult.InjectFailed ->
                    return@withContext SnapshotResult.FridaInjectFailed(
                        "inject-failed-exit-${keyResult.exitCode}",
                    )
            }
        }

        when (val r = dbExtractor.extract()) {
            is WeChatDbExtractor.ExtractResult.Ok -> {
                val snapshotAt = r.extractedAtMs
                credentialsStore.recordSync(snapshotAt, r.totalRows)
                SnapshotResult.Ok(
                    snapshotPath = r.stagingJsonPath,
                    contactCount = r.contactCount,
                    messageCount = r.messageCount,
                    chatroomCount = r.chatroomCount,
                    totalEvents = r.totalRows,
                    keyProvider = provider,
                    snapshottedAt = snapshotAt,
                )
            }
            WeChatDbExtractor.ExtractResult.NoCredentials ->
                SnapshotResult.NoCredentials
            WeChatDbExtractor.ExtractResult.NoDbKey -> {
                // Shouldn't happen given the frida path above succeeded,
                // but defend against state desync (cred store cleared
                // between key extract and db extract).
                credentialsStore.recordError(-1, "db-key-missing-post-frida")
                SnapshotResult.Failed("db-key-missing-post-frida")
            }
            WeChatDbExtractor.ExtractResult.NoRoot ->
                SnapshotResult.NoRoot
            WeChatDbExtractor.ExtractResult.SourceDbMissing -> {
                credentialsStore.recordError(-2, "wechat-db-not-found")
                SnapshotResult.ExtractFailed("source-db-missing", "WeChat 数据库不存在 — uin 错？")
            }
            is WeChatDbExtractor.ExtractResult.CopyFailed -> {
                credentialsStore.recordError(-3, r.message)
                SnapshotResult.ExtractFailed("copy-failed", r.message)
            }
            is WeChatDbExtractor.ExtractResult.DecryptFailed -> {
                credentialsStore.recordError(-4, r.message)
                SnapshotResult.ExtractFailed("decrypt-failed", r.message)
            }
            is WeChatDbExtractor.ExtractResult.Failed -> {
                credentialsStore.recordError(-99, r.message)
                SnapshotResult.ExtractFailed(r.reason, r.message)
            }
        }
    }
}
