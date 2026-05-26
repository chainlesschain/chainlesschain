package com.chainlesschain.android.pdh.social.xiaohongshu

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
 * Phase 7.5 — Android in-APK root Xhs DB extractor (path B).
 *
 * Reads `/data/data/com.xingin.xhs/databases/` `*.db` files via `su -c "cp ..."`
 * cohort copy + standard Android SQLiteDatabase open.
 *
 * **v0.1 期望 SQLCipher / libshield 路径占主导** per plan §6.5. The
 * `likely-sqlcipher` branch surfaces a clear v2.0 frida + libshield
 * bypass pointer when SQLite open hits "file is not a database". v0.1
 * is intentionally low-stake — confirms the failure shape for users so
 * v2.0 path (frida + libshield neuter) becomes the obvious next step.
 *
 * **Note on libshield.so**: libshield runs in the **Xhs app process**.
 * `su -c "cp"` copies the db file in a **separate process** — libshield
 * cannot reach it. So v0.1 file-copy path is safe; libshield only
 * matters in v2.0 if we need frida injection for SQLCipher key
 * derivation.
 *
 * Output JSON follows `social-xiaohongshu` snapshot mode (kinds:
 * note / liked / follow, schemaVersion=1 — history / like / favourite
 * are sqlite-mode-only legacy kinds, snapshot doesn't accept).
 *
 * Pipeline mirrors P7.1/P7.2/P7.4:
 *   1. user_id from [XhsRootCredentialsStore]
 *   2. [RootShellRunner.isSuAvailable] gate → NoRoot if false
 *   3. Try candidate DB filenames; first existing wins → DbCohortCopier
 *   4. SQLiteDatabase opens read-only
 *      - if open fails with "file is not a database" → SQLCipher
 *        almost certain (Xhs's modus operandi); surface explicit
 *        v2.0 transition hint
 *   5. parseNote + parseLiked + parseFollow with PRAGMA defensive picker
 *   6. Write staging JSON matching social-xiaohongshu schemaVersion=1
 */
@Singleton
class XhsRootDbExtractor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: XhsRootCredentialsStore,
    private val runner: RootShellRunner,
    private val cohortCopier: DbCohortCopier,
) {

    sealed class ExtractResult {
        data class Ok(
            val stagingJsonPath: String,
            val noteCount: Int,
            val likedCount: Int,
            val followCount: Int,
            val totalRows: Int,
            val extractedAtMs: Long,
            val dbFilename: String,
            val hadNoteTable: Boolean,
            val hadLikedTable: Boolean,
            val hadFollowTable: Boolean,
            val schemaDriftWarnings: List<String>,
        ) : ExtractResult()

        object NoCredentials : ExtractResult()
        object NoRoot : ExtractResult()
        object SourceDbMissing : ExtractResult()
        data class CopyFailed(val message: String) : ExtractResult()
        data class Failed(val reason: String, val message: String? = null) : ExtractResult()
    }

    suspend fun extract(): ExtractResult = withContext(Dispatchers.IO) {
        val userId = credentialsStore.getUid()
            ?: return@withContext ExtractResult.NoCredentials

        if (!runner.isSuAvailable()) {
            return@withContext ExtractResult.NoRoot
        }

        val availableDbs = lsDatabaseDir(XHS_DB_REMOTE_DIR)
        val pickedDb = DB_FILENAME_CANDIDATES.firstOrNull { it in availableDbs }
            ?: return@withContext ExtractResult.SourceDbMissing
        val remoteDb = "$XHS_DB_REMOTE_DIR/$pickedDb"

        val stagingDir = File(
            context.cacheDir,
            "xhs-root-staging-${System.currentTimeMillis()}",
        )
        if (!stagingDir.mkdirs()) {
            return@withContext ExtractResult.Failed(
                reason = "staging-mkdir-failed",
                message = "could not create staging dir at ${stagingDir.absolutePath}",
            )
        }
        val localDb = File(stagingDir, pickedDb)

        val copyResult = cohortCopier.copy(remoteDb, localDb)
        if (copyResult.isFailure) {
            cohortCopier.cleanup(localDb)
            val ex = copyResult.exceptionOrNull()
            val msg = ex?.message ?: ex?.javaClass?.simpleName ?: "unknown"
            stagingDir.deleteRecursively()
            return@withContext when {
                msg.contains("su not available") -> ExtractResult.NoRoot
                msg.contains("disallowed char") -> ExtractResult.Failed(
                    reason = "invalid-path",
                    message = "remote path '$remoteDb' failed validation: $msg",
                )
                else -> ExtractResult.CopyFailed(msg)
            }
        }

        val db = try {
            openDatabase(localDb.absolutePath)
        } catch (t: Throwable) {
            Timber.w(t, "XhsRootDbExtractor: SQLite open failed for %s", localDb.absolutePath)
            cohortCopier.cleanup(localDb)
            stagingDir.deleteRecursively()
            val msg = t.message ?: t.javaClass.simpleName
            // Plan §6.5: Xhs DB **likely SQLCipher**. "file is not a
            // database" is the canonical SQLite-rejects-cipher-stream
            // shape — surface explicit v2.0 transition pointer.
            val isLikelyCipher = msg.contains("file is not a database") ||
                msg.contains("not an error")
            val cipherHint = if (isLikelyCipher) {
                " — Xhs DB 几乎确定 SQLCipher 加密 + libshield.so 反 frida (v2.0 路径: frida + libshield neuter + key 派生 hook, 见 Phase 7 plan §6.5)"
            } else ""
            return@withContext ExtractResult.Failed(
                reason = if (isLikelyCipher) "likely-sqlcipher" else "open-error",
                message = "$msg$cipherHint",
            )
        }

        try {
            val warnings = mutableListOf<String>()
            val (notes, hadNoteTable) = parseNote(db, userId, warnings)
            val (liked, hadLikedTable) = parseLiked(db, warnings)
            val (follows, hadFollowTable) = parseFollow(db, warnings)

            val snapshottedAt = System.currentTimeMillis()
            val json = assembleSnapshotJson(
                userId = userId,
                snapshottedAt = snapshottedAt,
                notes = notes,
                liked = liked,
                follows = follows,
            )
            val stagingJson = File(stagingDir, STAGING_JSON_NAME)
            stagingJson.writeText(json.toString(), Charsets.UTF_8)

            ExtractResult.Ok(
                stagingJsonPath = stagingJson.absolutePath,
                noteCount = notes.size,
                likedCount = liked.size,
                followCount = follows.size,
                totalRows = notes.size + liked.size + follows.size,
                extractedAtMs = snapshottedAt,
                dbFilename = pickedDb,
                hadNoteTable = hadNoteTable,
                hadLikedTable = hadLikedTable,
                hadFollowTable = hadFollowTable,
                schemaDriftWarnings = warnings.toList(),
            )
        } catch (t: Throwable) {
            Timber.e(t, "XhsRootDbExtractor: parse/dump failed")
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
            cohortCopier.cleanup(localDb)
        }
    }

    // ─── Schema-drift-tolerant table parsers ────────────────────────────

    /**
     * Parse user-published notes (笔记). Column candidates:
     *   - noteId: note_id / id / nid / item_id (required, 24-char hex)
     *   - createdAt: created_at / create_time / timestamp / publish_time
     *   - title: title / display_title
     *   - desc: desc / description / content
     *   - type: type / note_type (normal/video)
     *   - likes: likes / liked_count
     *   - comments: comments / comments_count
     */
    private fun parseNote(
        db: SQLiteDatabase,
        userId: String,
        warnings: MutableList<String>,
    ): Pair<List<NoteRow>, Boolean> {
        val candidateTables = listOf("notes", "note", "user_notes", "my_notes", "publish_note")
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val noteIdCol = pickCol(columns, listOf("note_id", "id", "nid", "item_id"))
        val timeCol = pickCol(columns, listOf("created_at", "create_time", "timestamp", "publish_time"))
        if (noteIdCol == null || timeCol == null) {
            warnings.add(
                "$table missing required columns (note_id + time); have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val titleCol = pickCol(columns, listOf("title", "display_title"))
        val descCol = pickCol(columns, listOf("desc", "description", "content"))
        val typeCol = pickCol(columns, listOf("type", "note_type"))
        val likesCol = pickCol(columns, listOf("likes", "liked_count", "like_count"))
        val commentsCol = pickCol(columns, listOf("comments", "comments_count", "comment_count"))

        val selectFields = mutableListOf("$noteIdCol AS noteId", "$timeCol AS createdAt")
        if (titleCol != null) selectFields.add("$titleCol AS title")
        if (descCol != null) selectFields.add("$descCol AS description")
        if (typeCol != null) selectFields.add("$typeCol AS type")
        if (likesCol != null) selectFields.add("$likesCol AS likes")
        if (commentsCol != null) selectFields.add("$commentsCol AS comments")

        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM $table ORDER BY $timeCol DESC LIMIT $LIMIT_NOTE"
        val rows = mutableListOf<NoteRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("$table query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxNoteId = c.getColumnIndex("noteId")
            val idxTime = c.getColumnIndex("createdAt")
            val idxTitle = c.getColumnIndex("title")
            val idxDesc = c.getColumnIndex("description")
            val idxType = c.getColumnIndex("type")
            val idxLikes = c.getColumnIndex("likes")
            val idxComments = c.getColumnIndex("comments")
            while (c.moveToNext()) {
                val noteId = if (idxNoteId >= 0) safeGetString(c, idxNoteId) else null
                if (noteId.isNullOrBlank()) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    NoteRow(
                        noteId = noteId,
                        createdAtMs = time?.let { normalizeEpochMs(it) },
                        title = if (idxTitle >= 0) c.getString(idxTitle) else null,
                        description = if (idxDesc >= 0) c.getString(idxDesc) else null,
                        type = if (idxType >= 0) c.getString(idxType) else null,
                        likes = if (idxLikes >= 0 && !c.isNull(idxLikes)) c.getInt(idxLikes) else null,
                        comments = if (idxComments >= 0 && !c.isNull(idxComments)) c.getInt(idxComments) else null,
                        userId = userId,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    /**
     * Parse liked notes (点赞过的笔记). Column candidates:
     *   - noteId: note_id / id / liked_note_id (required)
     *   - likedAt: liked_at / created_at / time
     *   - title: title (optional, may need enrich from note table)
     *   - authorId: author_id / user_id (optional)
     */
    private fun parseLiked(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<LikedRow>, Boolean> {
        val candidateTables = listOf("liked_notes", "liked", "like_notes", "user_liked", "favourite_like")
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val noteIdCol = pickCol(columns, listOf("note_id", "id", "liked_note_id"))
        if (noteIdCol == null) {
            warnings.add(
                "$table missing note_id column; have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val timeCol = pickCol(columns, listOf("liked_at", "created_at", "time"))
        val titleCol = pickCol(columns, listOf("title"))
        val authorIdCol = pickCol(columns, listOf("author_id", "user_id"))

        val selectFields = mutableListOf("$noteIdCol AS noteId")
        if (timeCol != null) selectFields.add("$timeCol AS likedAt")
        if (titleCol != null) selectFields.add("$titleCol AS title")
        if (authorIdCol != null) selectFields.add("$authorIdCol AS authorId")

        val orderClause = if (timeCol != null) " ORDER BY $timeCol DESC" else ""
        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM $table$orderClause LIMIT $LIMIT_LIKED"
        val rows = mutableListOf<LikedRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("$table query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxNoteId = c.getColumnIndex("noteId")
            val idxTime = c.getColumnIndex("likedAt")
            val idxTitle = c.getColumnIndex("title")
            val idxAuthor = c.getColumnIndex("authorId")
            while (c.moveToNext()) {
                val noteId = if (idxNoteId >= 0) safeGetString(c, idxNoteId) else null
                if (noteId.isNullOrBlank()) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    LikedRow(
                        noteId = noteId,
                        likedAtMs = time?.let { normalizeEpochMs(it) },
                        title = if (idxTitle >= 0) c.getString(idxTitle) else null,
                        authorId = if (idxAuthor >= 0) safeGetString(c, idxAuthor) else null,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    /**
     * Parse follow (关注列表). Column candidates:
     *   - followedUserId: user_id / followed_user_id / target_id (24-char hex)
     *   - nickname: nickname / name / display_name
     *   - followedAt: follow_time / created_at / time
     *   - avatar: avatar / image
     */
    private fun parseFollow(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<FollowRow>, Boolean> {
        val candidateTables = listOf("follow_users", "following", "user_follow", "subscriptions", "attention")
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val userIdCol = pickCol(columns, listOf("user_id", "followed_user_id", "target_id", "uid"))
        if (userIdCol == null) {
            warnings.add(
                "$table missing user_id column; have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val nameCol = pickCol(columns, listOf("nickname", "name", "display_name"))
        val timeCol = pickCol(columns, listOf("follow_time", "created_at", "time"))
        val avatarCol = pickCol(columns, listOf("avatar", "image"))

        val selectFields = mutableListOf("$userIdCol AS followedUserId")
        if (nameCol != null) selectFields.add("$nameCol AS nickname")
        if (timeCol != null) selectFields.add("$timeCol AS followedAt")
        if (avatarCol != null) selectFields.add("$avatarCol AS avatar")

        val orderClause = if (timeCol != null) " ORDER BY $timeCol DESC" else ""
        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM $table$orderClause LIMIT $LIMIT_FOLLOW"
        val rows = mutableListOf<FollowRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("$table query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxUid = c.getColumnIndex("followedUserId")
            val idxName = c.getColumnIndex("nickname")
            val idxTime = c.getColumnIndex("followedAt")
            val idxAvatar = c.getColumnIndex("avatar")
            while (c.moveToNext()) {
                val uid = if (idxUid >= 0) safeGetString(c, idxUid) else null
                if (uid.isNullOrBlank()) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    FollowRow(
                        followedUserId = uid,
                        nickname = if (idxName >= 0) c.getString(idxName) else null,
                        followedAtMs = time?.let { normalizeEpochMs(it) },
                        avatar = if (idxAvatar >= 0) c.getString(idxAvatar) else null,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    // ─── Helpers (same shape as Weibo/Bilibili) ─────────────────────────

    private fun findTable(
        db: SQLiteDatabase,
        candidates: List<String>,
    ): Pair<String, Set<String>>? {
        for (table in candidates) {
            val cols = readTableColumns(db, table)
            if (!cols.isNullOrEmpty()) {
                return table to cols
            }
        }
        return null
    }

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
            Timber.d(t, "XhsRootDbExtractor: PRAGMA table_info(%s) failed", table)
            return null
        }
        return cols.takeIf { it.isNotEmpty() }
    }

    private fun pickCol(columns: Set<String>, candidates: List<String>): String? =
        candidates.firstOrNull { it in columns }

    private fun safeGetString(c: Cursor, idx: Int): String? {
        if (idx < 0 || c.isNull(idx)) return null
        return try {
            c.getString(idx)
        } catch (_: Throwable) {
            null
        }
    }

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

    private fun normalizeEpochMs(v: Long): Long =
        if (v in 1_000_000_000L..9_999_999_999L) v * 1000L else v

    /**
     * Assemble staging JSON matching social-xiaohongshu
     * SNAPSHOT_SCHEMA_VERSION=1. Kinds: note / liked / follow
     * (history / like / favourite are sqlite-mode-only legacy kinds,
     * snapshot-doesn't-accept).
     */
    private fun assembleSnapshotJson(
        userId: String,
        snapshottedAt: Long,
        notes: List<NoteRow>,
        liked: List<LikedRow>,
        follows: List<FollowRow>,
    ): JSONObject {
        val account = JSONObject().apply {
            put("userId", userId)
            put("displayName", "")
        }
        val events = JSONArray()

        notes.forEach { n ->
            val ev = JSONObject().apply {
                put("kind", "note")
                put("id", "note-${n.noteId}")
                put("capturedAt", n.createdAtMs ?: snapshottedAt)
                put("noteId", n.noteId)
                put("title", n.title ?: JSONObject.NULL)
                put("description", n.description ?: JSONObject.NULL)
                put("type", n.type ?: JSONObject.NULL)
                put("likes", n.likes ?: 0)
                put("comments", n.comments ?: 0)
                put("userId", n.userId)
            }
            events.put(ev)
        }
        liked.forEach { l ->
            val ev = JSONObject().apply {
                put("kind", "liked")
                put("id", "liked-${l.noteId}")
                put("capturedAt", l.likedAtMs ?: snapshottedAt)
                put("noteId", l.noteId)
                put("title", l.title ?: JSONObject.NULL)
                put("authorId", l.authorId ?: JSONObject.NULL)
            }
            events.put(ev)
        }
        follows.forEach { f ->
            val ev = JSONObject().apply {
                put("kind", "follow")
                put("id", "follow-${f.followedUserId}")
                put("capturedAt", f.followedAtMs ?: snapshottedAt)
                put("followedUserId", f.followedUserId)
                put("nickname", f.nickname ?: JSONObject.NULL)
                put("avatar", f.avatar ?: JSONObject.NULL)
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

    // ─── Test seams ─────────────────────────────────────────────────────

    internal var openDatabase: (path: String) -> SQLiteDatabase = { path ->
        SQLiteDatabase.openDatabase(path, null, SQLiteDatabase.OPEN_READONLY)
    }

    internal var lsDatabaseDir: (dir: String) -> Set<String> = { dir ->
        try {
            val out = runner.execAndCapture("ls $dir 2>/dev/null") ?: ""
            out.split("\n", "\r")
                .map { it.trim() }
                .filter { it.endsWith(".db") }
                .toSet()
        } catch (t: Throwable) {
            Timber.d(t, "XhsRootDbExtractor: ls %s failed", dir)
            emptySet()
        }
    }

    // ─── Internal row DTOs ──────────────────────────────────────────────

    internal data class NoteRow(
        val noteId: String,
        val createdAtMs: Long?,
        val title: String?,
        val description: String?,
        val type: String?,
        val likes: Int?,
        val comments: Int?,
        val userId: String,
    )

    internal data class LikedRow(
        val noteId: String,
        val likedAtMs: Long?,
        val title: String?,
        val authorId: String?,
    )

    internal data class FollowRow(
        val followedUserId: String,
        val nickname: String?,
        val followedAtMs: Long?,
        val avatar: String?,
    )

    companion object {
        const val XHS_DB_REMOTE_DIR =
            "/data/data/com.xingin.xhs/databases"

        /**
         * v0.1 candidate DB filenames in priority order — best-effort
         * guesses (zero public refs per plan §6.5). P7.5.0 真机探测 fills
         * the actual list. Update once user runs the probe.
         */
        val DB_FILENAME_CANDIDATES: List<String> = listOf(
            "xhs.db",
            "redbook.db",
            "notes.db",
            "discovery.db",
            "user.db",
            "xhs_cache.db",
            "red.db",
        )

        const val STAGING_JSON_NAME = "social-xiaohongshu-root.json"
        const val SNAPSHOT_SCHEMA_VERSION = 1
        const val LIMIT_NOTE = 2_000
        const val LIMIT_LIKED = 5_000
        const val LIMIT_FOLLOW = 5_000
    }
}
