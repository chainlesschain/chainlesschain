package com.chainlesschain.android.pdh.messaging.qq

import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * module 101 QQNT 采集方案 Phase 1 — parse a **decrypted** `nt_msg.db` (produced
 * by [QQNTFridaExporter] Method C) into the `messaging-qq` staging JSON the
 * desktop adapter ingests (`cc hub sync-adapter messaging-qq --input <path>`,
 * SNAPSHOT_SCHEMA_VERSION=1 — same contract as [QQDbExtractor]).
 *
 * QQNT message tables use numeric-id columns: `40001`=19-digit message id,
 * `40003`=sequence, `40020`=sender uid, `40021`=peer/group uin,
 * `40030`=sender type, `40033`=sender uin, `40011`=message type,
 * `40040`=read state, `40050`=time(epoch s), and `40800`=message-body protobuf
 * BLOB. Text is pulled heuristically by [QQNTMessageText] (Phase 2 = real proto
 * parse).
 *
 * The DB is already plaintext here (no SQLCipher PRAGMA, no XOR). [openDatabase]
 * is a test seam.
 */
@Singleton
class QQNTDbExtractor @Inject constructor() {

    sealed class Result {
        data class Ok(val stagingJsonPath: String, val messageCount: Int) : Result()
        data class Failed(val reason: String, val message: String? = null) : Result()
    }

    /**
     * @param decryptedDbPath plaintext nt_msg.db (app-readable copy)
     * @param outDir          where to write messaging-qq.json
     * @param uin             the QQ account number (for the account block)
     */
    fun extract(decryptedDbPath: String, outDir: File, uin: String): Result {
        val db = try {
            openDatabase(decryptedDbPath)
        } catch (t: Throwable) {
            Timber.e(t, "QQNTDbExtractor: open failed for %s", decryptedDbPath)
            return Result.Failed("open-failed", t.message)
        }
        return try {
            val nowMs = System.currentTimeMillis()
            val events = JSONArray()
            var count = 0
            count += dumpMsgTable(
                db,
                "c2c_msg_table",
                isGroup = false,
                selfUin = uin,
                events = events,
            )
            count += dumpMsgTable(
                db,
                "group_msg_table",
                isGroup = true,
                selfUin = uin,
                events = events,
            )

            val root = JSONObject().apply {
                put("schemaVersion", QQLocalCollector.SNAPSHOT_SCHEMA_VERSION)
                put("snapshottedAt", nowMs)
                put("account", JSONObject().apply { put("qq", uin) })
                put("source", JSONObject().apply { put("variant", "qqnt") })
                put("events", events)
            }
            outDir.mkdirs()
            val out = File(outDir, "messaging-qq.json")
            out.writeText(root.toString(), Charsets.UTF_8)
            Result.Ok(out.absolutePath, count)
        } catch (t: Throwable) {
            Timber.e(t, "QQNTDbExtractor: dump failed")
            Result.Failed("dump-failed", t.message)
        } finally {
            try { db.close() } catch (_: Throwable) {}
        }
    }

    private fun dumpMsgTable(
        db: SQLiteDatabase,
        table: String,
        isGroup: Boolean,
        selfUin: String,
        events: JSONArray,
    ): Int {
        var n = 0
        try {
            val availableColumns = buildSet {
                db.rawQuery("PRAGMA table_info(\"$table\")", null).use { schema ->
                    val nameIndex = schema.getColumnIndexOrThrow("name")
                    while (schema.moveToNext()) {
                        schema.getString(nameIndex)?.let(::add)
                    }
                }
            }
            val missingRequired = REQUIRED_MESSAGE_COLUMNS - availableColumns
            if (missingRequired.isNotEmpty()) {
                Timber.w(
                    "QQNTDbExtractor: table %s missing required columns: %s",
                    table,
                    missingRequired.joinToString(","),
                )
                return 0
            }
            val projection = MESSAGE_COLUMNS.joinToString(",") { column ->
                if (column in availableColumns) {
                    "\"$column\""
                } else {
                    "NULL AS \"$column\""
                }
            }
            val sql =
                "SELECT $projection FROM \"$table\" ORDER BY \"40050\" DESC LIMIT 5000"
            db.rawQuery(sql, null).use { c ->
                while (c.moveToNext()) {
                    // 40001 exceeds JavaScript's safe-integer range on real QQNT
                    // databases. Keep it as decimal text from Cursor through JSON.
                    val msgId = c.getString(0)?.takeIf { it.isNotBlank() } ?: continue
                    val sequence = c.getString(1)?.takeIf { it.isNotBlank() }
                    val senderUid = c.getString(2)?.takeIf { it.isNotBlank() }
                    val peerUin = c.getString(3).orEmpty()
                    val senderType = c.getString(4)?.toLongOrNull()
                    val senderUin = c.getString(5).orEmpty()
                    val msgType = c.getString(6)?.toLongOrNull() ?: 0L
                    val readState = c.getString(7)?.toLongOrNull()
                    val timeS = c.getString(8)?.toLongOrNull() ?: 0L
                    val body = try { c.getBlob(9) } catch (_: Throwable) { null }
                    val text = QQNTMessageText.extract(body)
                    // skip pure-empty rows (no text + no attachment)
                    if (text.isBlank()) continue
                    events.put(
                        JSONObject().apply {
                            put("kind", "message")
                            put("id", "msg-$msgId")
                            put("capturedAt", if (timeS > 1_000_000_000_000L) timeS else timeS * 1000)
                            put("msgId", msgId)
                            sequence?.let { put("sequence", it) }
                            put("msgType", msgType)
                            senderUid?.let { put("senderUid", it) }
                            senderType?.let { put("senderType", it) }
                            put("senderUin", senderUin)
                            put("peerUin", peerUin)
                            readState?.let { put("readState", it) }
                            put("isGroup", isGroup)
                            put("isSend", senderUin.isNotBlank() && senderUin == selfUin)
                            put("text", text)
                        },
                    )
                    n++
                }
            }
        } catch (t: Throwable) {
            Timber.w(t, "QQNTDbExtractor: query $table failed (table may be absent)")
        }
        return n
    }

    /** Test seam — swap in a fake driver for unit tests. */
    internal var openDatabase: (path: String) -> SQLiteDatabase = { path ->
        SQLiteDatabase.openDatabase(path, null, SQLiteDatabase.OPEN_READONLY)
    }

    private companion object {
        val MESSAGE_COLUMNS = listOf(
            "40001",
            "40003",
            "40020",
            "40021",
            "40030",
            "40033",
            "40011",
            "40040",
            "40050",
            "40800",
        )
        val REQUIRED_MESSAGE_COLUMNS = setOf("40001", "40050", "40800")
    }
}
