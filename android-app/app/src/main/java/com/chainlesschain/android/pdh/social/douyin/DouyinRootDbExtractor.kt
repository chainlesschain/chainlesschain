package com.chainlesschain.android.pdh.social.douyin

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.chainlesschain.android.pdh.social.common.DbCohortCopier
import com.chainlesschain.android.pdh.social.common.RootShellRunner
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
 * Phase 2b — Android in-APK root Douyin IM DB extractor (path B).
 *
 * Reads `/data/data/com.ss.android.ugc.aweme/databases/<uid>_im.db` via
 * `su -c "cp ..."` cohort copy (WAL/SHM siblings included) + standard
 * Android SQLiteDatabase open. Douyin IM uses **plaintext SQLite** —
 * **no SQLCipher**, **no frida hook needed**, **no libmsaoaidsec.so
 * bypass** (we're not attaching to the Douyin process, we're reading
 * the FILE via root privilege).
 *
 * Byte-parity port of the Node-side parser at
 * `packages/personal-data-hub/lib/adapters/social-douyin-adb/im-db-parser.js`.
 * Same schema-drift handling (defensive column picker), same content JSON
 * extraction (via [DouyinImDbContentParser]), same epoch-unit
 * normalization. When a real-device trap surfaces on one side, fix the
 * other to match — see memory `pdh-douyin-c-path-phase-2a.md`.
 *
 * Pipeline:
 *   1. uid from [DouyinRootCredentialsStore]
 *   2. [RootShellRunner.isSuAvailable] gate → NoRoot if false
 *   3. [DbCohortCopier.copy] pulls main+WAL+SHM to app's cache dir
 *   4. SQLiteDatabase opens local copy read-only
 *   5. parseMsgTable + parseSimpleUserTable with PRAGMA table_info-based
 *      defensive column picking
 *   6. Write staging JSON matching social-douyin adapter snapshot schema
 *      (SNAPSHOT_SCHEMA_VERSION=1)
 *
 * The staging JSON format mirrors the Node-side
 * `social-douyin-adb/snapshot-builder.js`:buildSnapshot — same KIND_MESSAGE
 * and KIND_CONTACT events that social-douyin/_syncViaSnapshot consumes
 * (we extended VALID_SNAPSHOT_KINDS in Phase 2a).
 *
 * Test seam: [openDatabase] is a `var` so JVM unit tests can swap in a
 * fake SQLiteDatabase factory backed by sqlite-jdbc on a host-side
 * fixture file.
 */
@Singleton
class DouyinRootDbExtractor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: DouyinRootCredentialsStore,
    private val runner: RootShellRunner,
    private val cohortCopier: DbCohortCopier,
) {

    sealed class ExtractResult {
        data class Ok(
            val stagingJsonPath: String,
            val messageCount: Int,
            val contactCount: Int,
            val totalRows: Int,
            val extractedAtMs: Long,
            val hadMsgTable: Boolean,
            val hadSimpleUserTable: Boolean,
            val schemaDriftWarnings: List<String>,
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
     *
     * Caller (DouyinRootDbCollector) is responsible for handing
     * staging JSON path to the social-douyin adapter; this extractor
     * doesn't delete the JSON (the cohort .db gets cleaned up internally
     * after parsing — only the lightweight JSON survives).
     */
    suspend fun extract(): ExtractResult = withContext(Dispatchers.IO) {
        val uid = credentialsStore.getUid()
            ?: return@withContext ExtractResult.NoCredentials

        if (!runner.isSuAvailable()) {
            return@withContext ExtractResult.NoRoot
        }

        val remoteDb = "$DOUYIN_DB_REMOTE_DIR/${uid}_im.db"
        val stagingDir = File(
            context.cacheDir,
            "douyin-root-staging-${System.currentTimeMillis()}",
        )
        if (!stagingDir.mkdirs()) {
            return@withContext ExtractResult.Failed(
                reason = "staging-mkdir-failed",
                message = "could not create staging dir at ${stagingDir.absolutePath}",
            )
        }
        val localDb = File(stagingDir, "${uid}_im.db")

        // Step 1: copy the WAL-consistent database cohort.
        val copyResult = cohortCopier.copy(remoteDb, localDb)
        if (copyResult.isFailure) {
            cohortCopier.cleanup(localDb)
            val ex = copyResult.exceptionOrNull()
            val msg = ex?.message ?: ex?.javaClass?.simpleName ?: "unknown"
            // DbCohortCopier returns IllegalStateException("su not available")
            // for the no-root path; everything else is RuntimeException with
            // the underlying message (typically "su cp pipeline returned
            // non-zero" — could mean source file missing, permission denied,
            // disk full, etc.). We can't disambiguate without re-running, so
            // surface as CopyFailed with the full message for UI display.
            stagingDir.deleteRecursively()
            return@withContext when {
                msg.contains("su not available") -> ExtractResult.NoRoot
                msg.contains("disallowed char") -> ExtractResult.Failed(
                    reason = "invalid-uid",
                    message = "uid '$uid' from credentialsStore failed path validation: $msg",
                )
                else -> ExtractResult.CopyFailed(msg)
            }
        }

        // Step 2: open the local copy.
        val db = try {
            openDatabase(localDb.absolutePath)
        } catch (t: Throwable) {
            Timber.w(t, "DouyinRootDbExtractor: SQLite open failed for %s", localDb.absolutePath)
            cohortCopier.cleanup(localDb)
            stagingDir.deleteRecursively()
            // SQLite "database disk image is malformed" usually means we
            // copied while a write was in flight without the WAL. Less
            // commonly it means the source file isn't actually a sqlite db
            // (e.g. user pointed at a wrong uid that doesn't have a real
            // _im.db sibling). Either way Failed("open-error") with the
            // tail surfaces enough to debug.
            return@withContext ExtractResult.Failed(
                reason = "open-error",
                message = t.message ?: t.javaClass.simpleName,
            )
        }

        try {
            // Step 3: parse both tables with schema-drift defense.
            val warnings = mutableListOf<String>()
            val (messages, hadMsgTable) = parseMsgTable(db, warnings)
            val (contacts, hadSimpleUserTable) = parseSimpleUserTable(db, warnings)

            // Step 4: assemble snapshot JSON in social-douyin schemaVersion=1.
            // Mirror Node-side snapshot-builder.js:buildSnapshot byte-for-byte
            // (same composite id strategy, same fallback chain).
            val snapshottedAt = System.currentTimeMillis()
            val json = assembleSnapshotJson(
                uid = uid,
                snapshottedAt = snapshottedAt,
                messages = messages,
                contacts = contacts,
            )
            val stagingJson = File(stagingDir, STAGING_JSON_NAME)
            stagingJson.writeText(json.toString(), Charsets.UTF_8)

            ExtractResult.Ok(
                stagingJsonPath = stagingJson.absolutePath,
                messageCount = messages.size,
                contactCount = contacts.size,
                totalRows = messages.size + contacts.size,
                extractedAtMs = snapshottedAt,
                hadMsgTable = hadMsgTable,
                hadSimpleUserTable = hadSimpleUserTable,
                schemaDriftWarnings = warnings.toList(),
            )
        } catch (t: Throwable) {
            Timber.e(t, "DouyinRootDbExtractor: parse/dump failed")
            stagingDir.deleteRecursively()
            ExtractResult.Failed(
                reason = "dump-error",
                message = t.message ?: t.javaClass.simpleName,
            )
        } finally {
            try {
                db.close()
            } catch (_: Throwable) {
                // ignore
            }
            // Clean up the .db cohort right after parsing — keep only the
            // lightweight JSON for the collector to hand off. The cohort
            // can be 5-50MB; the JSON is typically <500KB.
            cohortCopier.cleanup(localDb)
        }
    }

    // ─── Schema-drift-tolerant table parsers ────────────────────────────

    /**
     * Parse the `msg` table. Returns rows + whether the table existed.
     * Mirrors `im-db-parser.js`:parseImDb msg-block byte-for-byte.
     *
     * Column candidates (first match wins):
     *   - sender: sender / from_user_id / uid
     *   - createdTime: created_time / create_time / created_at
     *   - content: content / message_content
     *   - conversationId: conversation_id / conv_id / session_id (optional)
     *   - readStatus: read_status / read / is_read (optional)
     *
     * Returns up to [LIMIT_MESSAGES] rows ordered by createdTime DESC.
     */
    private fun parseMsgTable(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<MsgRow>, Boolean> {
        val columns = readTableColumns(db, "msg") ?: return Pair(emptyList(), false)
        val senderCol = pickCol(columns, listOf("sender", "from_user_id", "uid"))
        val timeCol = pickCol(columns, listOf("created_time", "create_time", "created_at"))
        val contentCol = pickCol(columns, listOf("content", "message_content"))
        val convCol = pickCol(columns, listOf("conversation_id", "conv_id", "session_id"))
        val readCol = pickCol(columns, listOf("read_status", "read", "is_read"))

        if (senderCol == null || timeCol == null || contentCol == null) {
            warnings.add(
                "msg table missing required columns " +
                    "(sender/createdTime/content); have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true) // table exists but unusable
        }

        val selectFields = mutableListOf(
            "$senderCol AS sender",
            "$timeCol AS createdTime",
            "$contentCol AS content",
        )
        if (convCol != null) selectFields.add("$convCol AS conversationId")
        if (readCol != null) selectFields.add("$readCol AS readStatus")

        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM msg ORDER BY $timeCol DESC LIMIT $LIMIT_MESSAGES"

        val rows = mutableListOf<MsgRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("msg query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxSender = c.getColumnIndex("sender")
            val idxTime = c.getColumnIndex("createdTime")
            val idxContent = c.getColumnIndex("content")
            val idxConv = c.getColumnIndex("conversationId")
            val idxRead = c.getColumnIndex("readStatus")
            while (c.moveToNext()) {
                val senderRaw = if (idxSender >= 0) safeGetLong(c, idxSender) else null
                val createdRaw = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                val content = if (idxContent >= 0) c.getString(idxContent) else null
                val convId = if (idxConv >= 0) c.getString(idxConv) else null
                val read = if (idxRead >= 0 && !c.isNull(idxRead)) c.getInt(idxRead) else null
                rows.add(
                    MsgRow(
                        senderUid = senderRaw?.toString(),
                        conversationId = convId,
                        createdTimeMs = createdRaw?.let { DouyinImDbContentParser.normalizeEpochMs(it) },
                        text = DouyinImDbContentParser.extractTextFromContent(content),
                        readStatus = read,
                        contentBlob = content,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    /**
     * Parse the `SIMPLE_USER` table (contacts cache). Returns rows + whether
     * the table existed.
     *
     * Column candidates:
     *   - uid: UID / uid / user_id (required)
     *   - shortId: short_id / shortId / ShortId (optional)
     *   - name: name / nick_name / nickname (optional)
     *   - avatar: avatar_url / avatarUrl / avatar (optional)
     *   - followStatus: follow_status / followStatus / follow_state (optional)
     */
    private fun parseSimpleUserTable(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<ContactRow>, Boolean> {
        val columns = readTableColumns(db, "SIMPLE_USER") ?: return Pair(emptyList(), false)
        val uidCol = pickCol(columns, listOf("UID", "uid", "user_id"))
        if (uidCol == null) {
            warnings.add(
                "SIMPLE_USER table missing UID column; have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val shortIdCol = pickCol(columns, listOf("short_id", "shortId", "ShortId"))
        val nameCol = pickCol(columns, listOf("name", "nick_name", "nickname"))
        val avatarCol = pickCol(columns, listOf("avatar_url", "avatarUrl", "avatar"))
        val followCol = pickCol(columns, listOf("follow_status", "followStatus", "follow_state"))

        val selectFields = mutableListOf("$uidCol AS uid")
        if (shortIdCol != null) selectFields.add("$shortIdCol AS shortId")
        if (nameCol != null) selectFields.add("$nameCol AS name")
        if (avatarCol != null) selectFields.add("$avatarCol AS avatarUrl")
        if (followCol != null) selectFields.add("$followCol AS followStatus")

        val sql = "SELECT ${selectFields.joinToString(", ")} FROM SIMPLE_USER LIMIT $LIMIT_CONTACTS"
        val rows = mutableListOf<ContactRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("SIMPLE_USER query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxUid = c.getColumnIndex("uid")
            val idxShort = c.getColumnIndex("shortId")
            val idxName = c.getColumnIndex("name")
            val idxAvatar = c.getColumnIndex("avatarUrl")
            val idxFollow = c.getColumnIndex("followStatus")
            while (c.moveToNext()) {
                val uidRaw = if (idxUid >= 0) safeGetLong(c, idxUid) else null
                val shortRaw = if (idxShort >= 0) safeGetLong(c, idxShort) else null
                val name = if (idxName >= 0) c.getString(idxName) else null
                val avatar = if (idxAvatar >= 0) c.getString(idxAvatar) else null
                val follow =
                    if (idxFollow >= 0 && !c.isNull(idxFollow)) c.getInt(idxFollow) else null
                rows.add(
                    ContactRow(
                        uid = uidRaw?.toString(),
                        shortId = shortRaw?.toString(),
                        name = name,
                        avatarUrl = avatar,
                        followStatus = follow,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    /**
     * Read the column names of a table via PRAGMA table_info. Returns
     * null when the table doesn't exist (PRAGMA returns 0 rows).
     */
    private fun readTableColumns(db: SQLiteDatabase, table: String): Set<String>? {
        val cols = mutableSetOf<String>()
        try {
            db.rawQuery("PRAGMA table_info($table)", null).use { c ->
                val idx = c.getColumnIndex("name")
                if (idx < 0) return null
                while (c.moveToNext()) {
                    cols.add(c.getString(idx))
                }
            }
        } catch (t: Throwable) {
            Timber.d(t, "DouyinRootDbExtractor: PRAGMA table_info(%s) failed", table)
            return null
        }
        return cols.takeIf { it.isNotEmpty() }
    }

    /** Pick the first candidate that exists; null if none. */
    private fun pickCol(columns: Set<String>, candidates: List<String>): String? =
        candidates.firstOrNull { it in columns }

    /**
     * Safe cursor read — Douyin sometimes stores numeric fields as TEXT
     * (especially in older versions). Coerce both via String to avoid
     * Cursor "type mismatch" exceptions on `getLong`.
     */
    private fun safeGetLong(c: Cursor, idx: Int): Long? {
        if (idx < 0 || c.isNull(idx)) return null
        return try {
            c.getLong(idx)
        } catch (_: Throwable) {
            try {
                c.getString(idx)?.toLongOrNull()
            } catch (_: Throwable) {
                null
            }
        }
    }

    /**
     * Assemble the staging snapshot JSON matching social-douyin
     * SNAPSHOT_SCHEMA_VERSION=1. Mirrors Node-side `snapshot-builder.js`:
     * buildSnapshot — same fields, same composite id strategy.
     */
    private fun assembleSnapshotJson(
        uid: String,
        snapshottedAt: Long,
        messages: List<MsgRow>,
        contacts: List<ContactRow>,
    ): JSONObject {
        val account = JSONObject().apply {
            put("secUid", JSONObject.NULL) // unknown via pure-db extraction
            put("shortId", uid)
            put("displayName", "")
        }
        val events = JSONArray()
        messages.forEachIndexed { idx, m ->
            val idPart = when {
                m.conversationId != null && m.createdTimeMs != null ->
                    "${m.conversationId}-${m.createdTimeMs}"
                m.senderUid != null && m.createdTimeMs != null ->
                    "${m.senderUid}-${m.createdTimeMs}"
                else -> "msg-$idx"
            }
            val ev = JSONObject().apply {
                put("kind", "message")
                put("id", "msg-$idPart")
                put("capturedAt", m.createdTimeMs ?: snapshottedAt)
                put("senderUid", m.senderUid ?: JSONObject.NULL)
                put("conversationId", m.conversationId ?: JSONObject.NULL)
                put("text", m.text ?: JSONObject.NULL)
                put("readStatus", m.readStatus ?: JSONObject.NULL)
                put("contentBlob", m.contentBlob ?: JSONObject.NULL)
            }
            events.put(ev)
        }
        contacts.forEachIndexed { idx, c ->
            val ev = JSONObject().apply {
                put("kind", "contact")
                put("id", if (c.uid != null) "contact-${c.uid}" else "contact-$idx")
                put("capturedAt", snapshottedAt)
                put("uid", c.uid ?: JSONObject.NULL)
                put("shortId", c.shortId ?: JSONObject.NULL)
                put("name", c.name ?: JSONObject.NULL)
                put("avatarUrl", c.avatarUrl ?: JSONObject.NULL)
                put("followStatus", c.followStatus ?: JSONObject.NULL)
            }
            events.put(ev)
        }
        return JSONObject().apply {
            put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
            put("snapshottedAt", snapshottedAt)
            put("account", account)
            put("events", events)
        }
    }

    // ─── Test seam ──────────────────────────────────────────────────────

    /**
     * Open the local-copy sqlite. Test seam: JVM unit tests swap this out
     * with a sqlite-jdbc-backed factory pointing at a fixture file. Mirrors
     * QQDbExtractor / WeChatDbExtractor convention.
     */
    internal var openDatabase: (path: String) -> SQLiteDatabase = { path ->
        SQLiteDatabase.openDatabase(
            path,
            null,
            SQLiteDatabase.OPEN_READONLY,
        )
    }

    // ─── Internal row DTOs ──────────────────────────────────────────────

    internal data class MsgRow(
        val senderUid: String?,
        val conversationId: String?,
        val createdTimeMs: Long?,
        val text: String?,
        val readStatus: Int?,
        val contentBlob: String?,
    )

    internal data class ContactRow(
        val uid: String?,
        val shortId: String?,
        val name: String?,
        val avatarUrl: String?,
        val followStatus: Int?,
    )

    companion object {
        const val DOUYIN_DB_REMOTE_DIR =
            "/data/data/com.ss.android.ugc.aweme/databases"
        const val STAGING_JSON_NAME = "social-douyin-root.json"
        const val SNAPSHOT_SCHEMA_VERSION = 1
        const val LIMIT_MESSAGES = 10_000
        const val LIMIT_CONTACTS = 5_000
    }
}
