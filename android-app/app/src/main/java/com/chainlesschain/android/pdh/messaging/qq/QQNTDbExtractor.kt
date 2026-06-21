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
 * QQNT message tables use numeric-id columns (reversed from the user's decrypted
 * fixture): `40050`=time(epoch s), `40020`=peer/group uid, `40030`/`40021`=sender
 * uin, `40011`=msg type, `40800`=message-body protobuf BLOB. Text is pulled
 * heuristically by [QQNTMessageText] (Phase 2 = real proto parse).
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
            count += dumpMsgTable(db, "c2c_msg_table", isGroup = false, events = events)
            count += dumpMsgTable(db, "group_msg_table", isGroup = true, events = events)

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
        events: JSONArray,
    ): Int {
        val sql =
            "SELECT \"40001\",\"40011\",\"40021\",\"40030\",\"40020\",\"40050\",\"40800\" " +
                "FROM \"$table\" ORDER BY \"40050\" DESC LIMIT 5000"
        var n = 0
        try {
            db.rawQuery(sql, null).use { c ->
                while (c.moveToNext()) {
                    val msgId = c.getString(0)?.takeIf { it.isNotBlank() } ?: continue
                    val msgType = c.getString(1)?.toLongOrNull() ?: 0L
                    val sender = c.getString(3)?.takeIf { it.isNotBlank() } ?: c.getString(2).orEmpty()
                    val peer = c.getString(4).orEmpty()
                    val timeS = c.getString(5)?.toLongOrNull() ?: 0L
                    val body = try { c.getBlob(6) } catch (_: Throwable) { null }
                    val text = QQNTMessageText.extract(body)
                    // skip pure-empty rows (no text + no attachment)
                    if (text.isBlank()) continue
                    events.put(
                        JSONObject().apply {
                            put("kind", "message")
                            put("id", "msg-$msgId")
                            put("capturedAt", if (timeS > 1_000_000_000_000L) timeS else timeS * 1000)
                            put("msgId", msgId)
                            put("msgType", msgType)
                            put("senderUin", sender)
                            put("peerUin", peer)
                            put("isGroup", isGroup)
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
}
