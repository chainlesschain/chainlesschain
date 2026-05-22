package com.chainlesschain.android.pdh.messaging.qq

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 13.5 v0.2 — copies the QQ Android app's per-uin SQLite DB off
 * `/data/data/com.tencent.mobileqq/databases/<uin>.db` and dumps raw
 * rows to a staging JSON the messaging-qq snapshot-mode adapter consumes
 * via `cc hub sync-adapter messaging-qq --input <staging.json>`.
 *
 * **Key differences from [com.chainlesschain.android.pdh.social.wechat.WeChatDbExtractor]**:
 *   - QQ uses plain SQLite (Android stock), NOT SQLCipher — no PRAGMA
 *     profile fallback, no master-key derivation, no frida needed
 *   - Message content (`msgData` BLOB) is XOR-cycled with device IMEI per
 *     [QQXorDecryptor] (sjqz qq.py:90-112 parity)
 *   - Tables: `Friends` / `friends` / `tb_recent_contact` (probe order) /
 *     `TroopInfoV2` / `mr_friend_<MD5(peer).upper()>_New` /
 *     `mr_troop_<MD5(troop).upper()>_New`
 *
 * **Still requires su** because /data/data/com.tencent.mobileqq is owned by
 * QQ's uid (e.g. u0_a<n>). adb run-as won't work for cross-app reads
 * (SELinux untrusted_app vs untrusted_app_data domains).
 *
 * **WAL + SHM cohort copy** (same trap as WeChat): SQLite's WAL mode means
 * recent writes live in `.db-wal` until checkpoint. Copying only `.db`
 * strands those writes OR causes "database disk image is malformed" on
 * open. We copy all 3 files atomically and let SQLite checkpoint on first
 * read.
 *
 * **STATUS**: Phase 13.5 v0.2 — real impl. su path + queryRows + XOR-decrypt
 * are wired. Real-device E2E gated on Phase 13.5.6 (needs root QQ device);
 * Win dev box compiles + unit tests only.
 *
 * Test seam: [openDatabase] is a var so unit tests can swap in a fake
 * SQLiteDatabase factory. Cohort copy via [suExec] is also a var, mirroring
 * the WeChat pattern.
 */
@Singleton
class QQDbExtractor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: QQCredentialsStore,
) {

    sealed class ExtractResult {
        data class Ok(
            val stagingJsonPath: String,
            val contactCount: Int,
            val groupCount: Int,
            val messageCount: Int,
            val totalRows: Int,
            val extractedAtMs: Long,
        ) : ExtractResult()

        object NoCredentials : ExtractResult()
        object NoRoot : ExtractResult()
        object SourceDbMissing : ExtractResult()
        data class CopyFailed(val message: String) : ExtractResult()
        data class Failed(val reason: String, val message: String? = null) : ExtractResult()
    }

    /**
     * Run the full extract pipeline. Returns within a few seconds on
     * success; up to ~30s on cohort copy + DB open failure path.
     */
    suspend fun extract(): ExtractResult = withContext(Dispatchers.IO) {
        val uin = credentialsStore.getUin()
            ?: return@withContext ExtractResult.NoCredentials
        val imei = credentialsStore.getImei()
            ?: return@withContext ExtractResult.NoCredentials
        val imeiBytes = imei.toByteArray(Charsets.UTF_8)

        // 1. Locate source DB. QQ's per-uin schema:
        //   /data/data/com.tencent.mobileqq/databases/<uin>.db
        // (sjqz qq.py:5, line 125 hardcodes this path).
        val srcDb = "/data/data/com.tencent.mobileqq/databases/$uin.db"
        if (!suExec("test -f $srcDb", 5_000)) {
            return@withContext if (!isSuAvailable()) {
                ExtractResult.NoRoot
            } else {
                ExtractResult.SourceDbMissing
            }
        }

        // 2. Copy DB cohort (main + wal + shm) into app cache via su.
        val stagingRoot = File(context.cacheDir, "qq-staging").also { it.mkdirs() }
        val stagingDb = File(stagingRoot, "$uin.db").also { if (it.exists()) it.delete() }
        val cohortCopyResult = copyDbCohortViaSu(srcDb, stagingDb)
        if (cohortCopyResult.isFailure) {
            val err = cohortCopyResult.exceptionOrNull()
            return@withContext if (err?.message?.contains("su not available", ignoreCase = true) == true) {
                ExtractResult.NoRoot
            } else {
                ExtractResult.CopyFailed(err?.message ?: "unknown copy error")
            }
        }

        // 3. Open plain SQLite (no SQLCipher PRAGMAs needed).
        val db = try {
            openDatabase(stagingDb.absolutePath)
        } catch (t: Throwable) {
            stagingRoot.deleteRecursively()
            Timber.e(t, "QQDbExtractor: openDatabase failed for %s", stagingDb.absolutePath)
            return@withContext ExtractResult.Failed("open-failed", t.message)
        }

        try {
            // 4. Dump tables to staging JSON.
            val stagingJson = File(stagingRoot, "messaging-qq.json")
            val counts = dumpTables(db, stagingJson, uin = uin, imeiBytes = imeiBytes)
            val nowMs = System.currentTimeMillis()

            ExtractResult.Ok(
                stagingJsonPath = stagingJson.absolutePath,
                contactCount = counts.contacts,
                groupCount = counts.groups,
                messageCount = counts.messages,
                totalRows = counts.total,
                extractedAtMs = nowMs,
            )
        } catch (t: Throwable) {
            Timber.e(t, "QQDbExtractor: dumpTables failed")
            ExtractResult.Failed("dump-failed", t.message)
        } finally {
            try { db.close() } catch (_: Throwable) { /* ignore */ }
            // Wipe staging DB cohort — message content is decoded into the
            // JSON already so the raw DB is redundant + sensitivity=high.
            try { stagingDb.delete() } catch (_: Throwable) { /* ignore */ }
            File(stagingRoot, "$uin.db-wal").takeIf { it.exists() }?.delete()
            File(stagingRoot, "$uin.db-shm").takeIf { it.exists() }?.delete()
        }
    }

    /** Test seam — overridden in unit tests to inject a fake driver. */
    internal var openDatabase: (path: String) -> SQLiteDatabase = { path ->
        SQLiteDatabase.openDatabase(path, null, SQLiteDatabase.OPEN_READONLY)
    }

    // ─── su-backed file ops (cohort copy) ────────────────────────────────────

    /**
     * Copy `srcDb` + its `-wal` + `-shm` siblings to [dstDb]. Returns
     * Result.failure("su not available") if root isn't accessible.
     *
     * Mode 0644 lets the app's UID read the file after copy (su cp would
     * keep QQ's `u0_a<n>` ownership otherwise).
     */
    internal fun copyDbCohortViaSu(srcDb: String, dstDb: File): Result<Unit> {
        if (!isSuAvailable()) {
            return Result.failure(IllegalStateException("su not available"))
        }
        val dstPath = dstDb.absolutePath
        val walSrc = "$srcDb-wal"
        val shmSrc = "$srcDb-shm"
        val script = buildString {
            append("cp $srcDb $dstPath && chmod 644 $dstPath")
            append(" ; if [ -f $walSrc ] ; then cp $walSrc ${dstPath}-wal && chmod 644 ${dstPath}-wal ; fi")
            append(" ; if [ -f $shmSrc ] ; then cp $shmSrc ${dstPath}-shm && chmod 644 ${dstPath}-shm ; fi")
        }
        return if (suExec(script, 30_000)) {
            Result.success(Unit)
        } else {
            Result.failure(RuntimeException("su cp pipeline returned non-zero"))
        }
    }

    /** Test seam — overridden by unit tests to skip the actual exec. */
    internal var suExec: (cmd: String, timeoutMs: Long) -> Boolean = ::defaultSuExec

    /** Test seam — overridden to assert root presence without forking su. */
    internal var isSuAvailable: () -> Boolean = ::defaultIsSuAvailable

    private fun defaultIsSuAvailable(): Boolean = try {
        val proc = ProcessBuilder("su", "-c", "id -u").redirectErrorStream(true).start()
        val ok = proc.waitFor(3_000, java.util.concurrent.TimeUnit.MILLISECONDS) && proc.exitValue() == 0
        if (ok) {
            val out = proc.inputStream.bufferedReader().readText().trim()
            out == "0" || out.contains("uid=0")
        } else {
            proc.destroyForcibly()
            false
        }
    } catch (t: Throwable) {
        Timber.d(t, "QQDbExtractor: su availability probe failed")
        false
    }

    private fun defaultSuExec(cmd: String, timeoutMs: Long): Boolean = try {
        val proc = ProcessBuilder("su", "-c", cmd).redirectErrorStream(true).start()
        val finished = proc.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            proc.destroyForcibly()
            false
        } else {
            val ok = proc.exitValue() == 0
            if (!ok) {
                val tail = proc.inputStream.bufferedReader().readText().take(500)
                Timber.w("QQDbExtractor: suExec failed (exit=${proc.exitValue()}): %s", tail)
            }
            ok
        }
    } catch (t: Throwable) {
        Timber.w(t, "QQDbExtractor: suExec threw")
        false
    }

    // ─── Row dump ───────────────────────────────────────────────────────────

    private data class RowCounts(val contacts: Int, val groups: Int, val messages: Int) {
        val total: Int get() = contacts + groups + messages
    }

    /**
     * Dump the QQ tables to a staging JSON the desktop adapter consumes
     * via `cc hub sync-adapter messaging-qq --input <path>`.
     *
     * Schema follows the [QQAdapter] snapshot contract (mirror in
     * `packages/personal-data-hub/lib/adapters/messaging-qq/index.js`
     * SNAPSHOT_SCHEMA_VERSION=1):
     *
     *   {
     *     "schemaVersion": 1,
     *     "snapshottedAt": <epoch-ms>,
     *     "account": { "qq": "<uin>" },
     *     "events": [
     *       { "kind": "contact", "id": "...", "capturedAt": <ms>, ... },
     *       { "kind": "group",   "id": "...", "capturedAt": <ms>, ... },
     *       { "kind": "message", "id": "...", "capturedAt": <ms>, ... }
     *     ]
     *   }
     */
    private fun dumpTables(
        db: SQLiteDatabase,
        out: File,
        uin: String,
        imeiBytes: ByteArray,
    ): RowCounts {
        val nowMs = System.currentTimeMillis()
        val events = JSONArray()

        // 1. Contacts — probe 3 known table names across QQ version drift.
        // Friends (newer) / friends / tb_recent_contact (oldest).
        val contactRows = queryContactRows(db)
        for (row in contactRows) {
            val rowUin = row.optString("uin", "")
            if (rowUin.isBlank()) continue
            events.put(JSONObject().apply {
                put("kind", "contact")
                put("id", "contact-$rowUin")
                put("capturedAt", nowMs)
                put("uin", rowUin)
                put("nickname", row.optString("nickname", ""))
                put("remark", row.optString("remark", ""))
            })
        }

        // 2. Groups — TroopInfoV2.
        val groupRows = queryRows(
            db,
            table = "TroopInfoV2",
            wantedCols = listOf("troopuin", "troopname", "membernum", "troopowneruin"),
            limit = 1000,
        )
        for (row in groupRows) {
            val troopUin = row.optString("troopuin", "")
            if (troopUin.isBlank()) continue
            events.put(JSONObject().apply {
                put("kind", "group")
                put("id", "group-$troopUin")
                put("capturedAt", nowMs)
                put("troopUin", troopUin)
                put("troopName", row.optString("troopname", ""))
                put("memberCount", row.optLong("membernum", 0L))
                put("ownerUin", row.optString("troopowneruin", ""))
            })
        }

        // 3. Messages — sjqz qq.py:280-305 discovery query. Walk every
        //    mr_friend_*_New + mr_troop_*_New table and decrypt msgData.
        val msgTables = try {
            db.rawQuery(
                "SELECT name FROM sqlite_master WHERE type='table' " +
                    "AND (name LIKE 'mr_friend_%_New' OR name LIKE 'mr_troop_%_New')",
                null,
            ).use { c ->
                buildList<String> {
                    val nameIdx = c.getColumnIndex("name")
                    if (nameIdx < 0) return@buildList
                    while (c.moveToNext()) {
                        val n = c.getString(nameIdx) ?: continue
                        add(n)
                    }
                }
            }
        } catch (t: Throwable) {
            Timber.w(t, "QQDbExtractor: msg-table discovery failed")
            emptyList()
        }

        var messageCount = 0
        for (table in msgTables) {
            val isGroup = table.startsWith("mr_troop_")
            val msgs = queryRows(
                db,
                table = table,
                wantedCols = listOf("msgId", "msgtype", "senderuin", "time", "msgData", "issend", "frienduin", "troopuin"),
                limit = 1000,
                orderBy = "time DESC",
            )
            for (row in msgs) {
                val msgId = row.optString("msgId", "")
                if (msgId.isBlank()) continue
                // msgData column came through queryRows as base64 (BLOB→base64
                // path). Decode → XOR-decrypt.
                val msgDataB64 = row.optString("msgData", "")
                val msgDataBytes = if (msgDataB64.isNotBlank()) {
                    try {
                        android.util.Base64.decode(msgDataB64, android.util.Base64.NO_WRAP)
                    } catch (_: Throwable) {
                        null
                    }
                } else null
                val text = if (msgDataBytes != null) {
                    QQXorDecryptor.decrypt(msgDataBytes, imeiBytes)
                } else ""

                // QQ time is unix-seconds; promote to ms for snapshot consistency.
                val timeRaw = row.optLong("time", 0L)
                val capturedAt = if (timeRaw > 1e12) timeRaw else timeRaw * 1000

                events.put(JSONObject().apply {
                    put("kind", "message")
                    put("id", "msg-$msgId")
                    put("capturedAt", capturedAt)
                    put("msgId", msgId)
                    put("msgType", row.optLong("msgtype", 0L))
                    put("senderUin", row.optString("senderuin", ""))
                    put(
                        "peerUin",
                        if (isGroup) row.optString("troopuin", "")
                        else row.optString("frienduin", ""),
                    )
                    put("isGroup", isGroup)
                    put("isSend", row.optLong("issend", 0L) != 0L)
                    put("text", text)
                })
                messageCount += 1
            }
        }

        val account = JSONObject().apply { put("qq", uin) }
        val root = JSONObject().apply {
            put("schemaVersion", QQLocalCollector.SNAPSHOT_SCHEMA_VERSION)
            put("snapshottedAt", nowMs)
            put("account", account)
            put("events", events)
        }
        out.writeText(root.toString(), Charsets.UTF_8)

        return RowCounts(
            contacts = contactRows.size,
            groups = groupRows.size,
            messages = messageCount,
        )
    }

    /**
     * Contacts: probe Friends / friends / tb_recent_contact in order. The
     * column name "name" (nickname) and "remark" vary slightly across QQ
     * versions; queryRows handles case drift via PRAGMA table_info.
     */
    private fun queryContactRows(db: SQLiteDatabase): List<JSONObject> {
        // sjqz qq.py:144-166 mirrors this probe order. Each probe stops
        // on first non-empty result; if the table is missing queryRows
        // returns empty and we fall through.
        val candidates = listOf(
            // (table, columns) — column synonyms collapsed via queryRows AS
            // rename below; we always emit normalized "uin"/"nickname"/"remark".
            Triple("Friends", listOf("uin", "name", "remark"), null),
            Triple("friends", listOf("uin", "name", "remark"), null),
            Triple("tb_recent_contact", listOf("uin", "name", "remark"), null),
        )
        for ((table, cols, _) in candidates) {
            val rows = queryRows(db, table = table, wantedCols = cols, limit = 5000)
            if (rows.isNotEmpty()) {
                // Normalize column names — "name" → "nickname" in output
                return rows.map { row ->
                    JSONObject().apply {
                        put("uin", row.optString("uin", ""))
                        put("nickname", row.optString("name", ""))
                        put("remark", row.optString("remark", ""))
                    }
                }
            }
        }
        return emptyList()
    }

    /**
     * Generic table-dump. Resolves column names via `PRAGMA table_info` so
     * case-drift across QQ versions doesn't blow up the SELECT with "no
     * such column".
     */
    private fun queryRows(
        db: SQLiteDatabase,
        table: String,
        wantedCols: List<String>,
        limit: Int,
        where: String? = null,
        orderBy: String? = null,
    ): List<JSONObject> {
        val actualMap = try {
            db.rawQuery("PRAGMA table_info($table)", null).use { c ->
                buildMap<String, String> {
                    val nameIdx = c.getColumnIndex("name")
                    if (nameIdx < 0) return@buildMap
                    while (c.moveToNext()) {
                        val n = c.getString(nameIdx) ?: continue
                        put(n.lowercase(), n)
                    }
                }
            }
        } catch (t: Throwable) {
            Timber.d(t, "QQDbExtractor: PRAGMA table_info($table) failed — table missing")
            return emptyList()
        }
        if (actualMap.isEmpty()) return emptyList()

        val resolved = wantedCols.mapNotNull { wanted ->
            val actual = actualMap[wanted.lowercase()]
            if (actual == null) {
                Timber.d("QQDbExtractor: $table missing column $wanted (have: ${actualMap.values.joinToString()})")
            }
            actual
        }
        if (resolved.isEmpty()) return emptyList()

        val sql = buildString {
            append("SELECT ")
            append(resolved.joinToString(", ") { "\"$it\"" })
            append(" FROM \"$table\"")
            if (where != null) append(" WHERE ").append(where)
            if (orderBy != null) append(" ORDER BY ").append(orderBy)
            append(" LIMIT ").append(limit)
        }

        return db.rawQuery(sql, null).use { c ->
            buildList {
                while (c.moveToNext()) {
                    val obj = JSONObject()
                    for ((idx, col) in resolved.withIndex()) {
                        // Lowercase the JSON key to make snapshot output stable
                        // across QQ versions even when DB column casing drifts.
                        val outKey = col.lowercase()
                        when (c.getType(idx)) {
                            Cursor.FIELD_TYPE_NULL -> obj.put(outKey, JSONObject.NULL)
                            Cursor.FIELD_TYPE_INTEGER -> obj.put(outKey, c.getLong(idx))
                            Cursor.FIELD_TYPE_FLOAT -> obj.put(outKey, c.getDouble(idx))
                            Cursor.FIELD_TYPE_STRING -> obj.put(outKey, c.getString(idx))
                            Cursor.FIELD_TYPE_BLOB -> {
                                val blob = c.getBlob(idx)
                                obj.put(outKey, android.util.Base64.encodeToString(blob, android.util.Base64.NO_WRAP))
                            }
                            else -> obj.put(outKey, JSONObject.NULL)
                        }
                    }
                    add(obj)
                }
            }
        }
    }
}
