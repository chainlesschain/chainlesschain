package com.chainlesschain.android.pdh.social.wechat

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 12.10.3 — copies the encrypted WeChat database off `/data/data/
 * com.tencent.mm/MicroMsg/<md5-uin>/EnMicroMsg.db` and dumps raw rows to
 * a staging JSON the desktop wechat adapter can normalize via `cc hub
 * sync-adapter wechat --input <staging.json>`.
 *
 * **STATUS**: stub only. Real implementation requires:
 *   - net.zetetic:sqlcipher-android:4.12.0 (already in core-database deps)
 *   - Magisk-su access for cross-user file copy
 *   - PRAGMA configuration matching the desktop side's
 *     `KNOWN_PRAGMA_PROFILES` (see
 *     `packages/personal-data-hub/lib/adapters/wechat/db-reader.js`)
 *   - WAL + SHM file cohort copy (else stale read or "file is not a
 *     database" errors — see design doc §3.3 Trap 7)
 *
 * See [`docs/design/Android_WeChat_InApp_Frida_Collector.md`](../../../../../../../../../docs/design/Android_WeChat_InApp_Frida_Collector.md) §3.3.
 */
@Singleton
class WeChatDbExtractor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: WeChatCredentialsStore,
) {

    sealed class ExtractResult {
        data class Ok(
            val stagingJsonPath: String,
            val contactCount: Int,
            val messageCount: Int,
            val chatroomCount: Int,
            val totalRows: Int,
            val extractedAtMs: Long,
        ) : ExtractResult()

        object NoCredentials : ExtractResult()
        object NoDbKey : ExtractResult()
        object NoRoot : ExtractResult()
        object SourceDbMissing : ExtractResult()
        data class CopyFailed(val message: String) : ExtractResult()
        data class DecryptFailed(val message: String) : ExtractResult()
        data class Failed(val reason: String, val message: String? = null) : ExtractResult()
    }

    /**
     * Run the full extract pipeline: locate src → su cp → SQLCipher open →
     * row dump → staging.json write.
     *
     * **STUB**: real impl is Phase 12.10.3. Returns [ExtractResult.Failed]
     * with `reason="not-implemented"` so the orchestrator surfaces "改用
     * 桌面端" guidance to the user.
     */
    suspend fun extract(): ExtractResult = withContext(Dispatchers.IO) {
        val uin = credentialsStore.getUin()
            ?: return@withContext ExtractResult.NoCredentials
        val keyHex = credentialsStore.getDbKeyHex()
            ?: return@withContext ExtractResult.NoDbKey

        Timber.w(
            "WeChatDbExtractor.extract called for uin=%s keyHexPrefix=%s... — STUB " +
                "(Phase 12.10.3 not yet implemented). Falling back to Failed(not-implemented).",
            uin,
            keyHex.take(8),
        )

        // TODO(Phase 12.10.3):
        //   1. val md5Uin = md5("mm$uin").substring(0, 7)
        //   2. val srcDb = "/data/data/com.tencent.mm/MicroMsg/$md5Uin/EnMicroMsg.db"
        //   3. assertSrcExistsViaSu(srcDb) else return SourceDbMissing
        //   4. copyDbCohortViaSu(srcDb, stagingDir)  -- main + -wal + -shm
        //   5. val db = SQLiteDatabase.openDatabase(staging.absolutePath, keyHex.hexToByteArray(), ...)
        //   6. applyKnownPragmaProfile(db)  -- cipher_compatibility=3, kdf_iter, etc
        //   7. dumpTables(db, listOf("rcontact", "message", "chatroom", "userinfo"))
        //   8. writeStagingJson(rows, stagingJsonPath)
        //   9. return ExtractResult.Ok(...)
        ExtractResult.Failed("not-implemented", "WeChatDbExtractor stub — Phase 12.10.3 pending")
    }
}
