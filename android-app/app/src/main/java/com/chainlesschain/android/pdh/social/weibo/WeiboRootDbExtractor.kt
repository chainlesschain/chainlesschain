package com.chainlesschain.android.pdh.social.weibo

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
 * Phase 7.4 — Android in-APK root Weibo DB extractor (path B).
 *
 * Reads `/data/data/com.sina.weibo/databases/` `*.db` files via `su -c "cp ..."`
 * cohort copy (WAL/SHM siblings included) + standard Android
 * SQLiteDatabase open. **v0.1 assumes plaintext SQLite** per P7.3 §6
 * prediction. If real-device probe (P7.3 §3) reveals SQLCipher, v0.2
 * adds key-derivation hook (mirror of WeChat 12.10 pattern).
 *
 * **Schema visibility is the weakest of Mode B platforms** — plan §6.2
 * says Weibo Mode B = "零公开资料 → 从零逆向". v0.1 ships defensive
 * PRAGMA-based column picker + multi-table-name probing so first-pass
 * users hit early on what's actually there. The schema-drift warnings
 * surface what's missing → P7.3 §3 dump fills the gap → v0.2 commit.
 *
 * Output JSON follows `social-weibo` snapshot mode (kinds: post /
 * favourite / follow, schemaVersion=1 — search is sqlite-mode-only,
 * snapshot doesn't accept).
 *
 * Pipeline mirrors P7.1/P7.2:
 *   1. uid from [WeiboRootCredentialsStore]
 *   2. [RootShellRunner.isSuAvailable] gate → NoRoot if false
 *   3. Try candidate DB filenames; first existing wins → DbCohortCopier
 *   4. SQLiteDatabase opens read-only
 *      - if open fails with "file is not a database" → SQLCipher likely;
 *        surface clear hint pointing to P7.3 §3.4-3.6 frida path
 *   5. parsePost + parseFavourite + parseFollow with PRAGMA defensive picker
 *   6. Write staging JSON matching social-weibo schemaVersion=1
 */
@Singleton
class WeiboRootDbExtractor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: WeiboRootCredentialsStore,
    private val runner: RootShellRunner,
    private val cohortCopier: DbCohortCopier,
) {

    sealed class ExtractResult {
        data class Ok(
            val stagingJsonPath: String,
            val postCount: Int,
            val favouriteCount: Int,
            val followCount: Int,
            val totalRows: Int,
            val extractedAtMs: Long,
            val dbFilename: String,
            val hadPostTable: Boolean,
            val hadFavouriteTable: Boolean,
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
        val uid = credentialsStore.getUid()
            ?: return@withContext ExtractResult.NoCredentials

        if (!runner.isSuAvailable()) {
            return@withContext ExtractResult.NoRoot
        }

        val availableDbs = lsDatabaseDir(WEIBO_DB_REMOTE_DIR)
        val pickedDb = DB_FILENAME_CANDIDATES.firstOrNull { it in availableDbs }
            ?: return@withContext ExtractResult.SourceDbMissing
        val remoteDb = "$WEIBO_DB_REMOTE_DIR/$pickedDb"

        val stagingDir = File(
            context.cacheDir,
            "weibo-root-staging-${System.currentTimeMillis()}",
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
            Timber.w(t, "WeiboRootDbExtractor: SQLite open failed for %s", localDb.absolutePath)
            cohortCopier.cleanup(localDb)
            stagingDir.deleteRecursively()
            val msg = t.message ?: t.javaClass.simpleName
            // Plan §6.2 + P7.3 §6 predict SQLCipher possible. "file is not a
            // database" is the canonical SQLite-rejects-cipher-stream message
            // — surface clear next-step hint to P7.3 frida path so v0.1
            // failure isn't a dead end.
            val isLikelyCipher = msg.contains("file is not a database") ||
                msg.contains("not an error") // SQLCipher v3 sometimes throws this
            val cipherHint = if (isLikelyCipher) {
                " — 可能是 SQLCipher 加密 (P7.3 §3.4-3.6 frida hook path 解锁 v0.2)"
            } else ""
            return@withContext ExtractResult.Failed(
                reason = if (isLikelyCipher) "likely-sqlcipher" else "open-error",
                message = "$msg$cipherHint",
            )
        }

        try {
            val warnings = mutableListOf<String>()
            val (posts, hadPostTable) = parsePost(db, warnings)
            val (favourites, hadFavouriteTable) = parseFavourite(db, warnings)
            val (follows, hadFollowTable) = parseFollow(db, warnings)

            val snapshottedAt = System.currentTimeMillis()
            val json = assembleSnapshotJson(
                uid = uid,
                snapshottedAt = snapshottedAt,
                posts = posts,
                favourites = favourites,
                follows = follows,
            )
            val stagingJson = File(stagingDir, STAGING_JSON_NAME)
            stagingJson.writeText(json.toString(), Charsets.UTF_8)

            ExtractResult.Ok(
                stagingJsonPath = stagingJson.absolutePath,
                postCount = posts.size,
                favouriteCount = favourites.size,
                followCount = follows.size,
                totalRows = posts.size + favourites.size + follows.size,
                extractedAtMs = snapshottedAt,
                dbFilename = pickedDb,
                hadPostTable = hadPostTable,
                hadFavouriteTable = hadFavouriteTable,
                hadFollowTable = hadFollowTable,
                schemaDriftWarnings = warnings.toList(),
            )
        } catch (t: Throwable) {
            Timber.e(t, "WeiboRootDbExtractor: parse/dump failed")
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
     * Parse post / mblog (微博). v0.1 best-guess candidates from Weibo
     * web data model + path A endpoint observations. Real schema TBD via
     * P7.3 §3 — defensive picker absorbs drift.
     *
     * Column candidates:
     *   - mid: mid / mblog_id / id / weibo_id (required, the long mblog id)
     *   - text: text / content / status / body
     *   - createdAt: created_at / create_time / time / timestamp
     *   - userId: user_id / uid / author_id
     *   - reposts: reposts_count / reposts / retweet_count
     *   - comments: comments_count / comments
     *   - attitudes: attitudes_count / attitudes / likes_count
     */
    private fun parsePost(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<PostRow>, Boolean> {
        val candidateTables = listOf("status", "mblog", "weibo", "feed", "home_status")
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val midCol = pickCol(columns, listOf("mid", "mblog_id", "id", "weibo_id"))
        val timeCol = pickCol(columns, listOf("created_at", "create_time", "time", "timestamp"))
        if (midCol == null || timeCol == null) {
            warnings.add(
                "$table missing required columns (mid + time); have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val textCol = pickCol(columns, listOf("text", "content", "status_content", "body"))
        val userIdCol = pickCol(columns, listOf("user_id", "uid", "author_id"))
        val repostsCol = pickCol(columns, listOf("reposts_count", "reposts", "retweet_count"))
        val commentsCol = pickCol(columns, listOf("comments_count", "comments"))
        val attitudesCol = pickCol(columns, listOf("attitudes_count", "attitudes", "likes_count"))

        val selectFields = mutableListOf("$midCol AS mid", "$timeCol AS createdAt")
        if (textCol != null) selectFields.add("$textCol AS text")
        if (userIdCol != null) selectFields.add("$userIdCol AS userId")
        if (repostsCol != null) selectFields.add("$repostsCol AS reposts")
        if (commentsCol != null) selectFields.add("$commentsCol AS comments")
        if (attitudesCol != null) selectFields.add("$attitudesCol AS attitudes")

        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM $table ORDER BY $timeCol DESC LIMIT $LIMIT_POST"
        val rows = mutableListOf<PostRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("$table query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxMid = c.getColumnIndex("mid")
            val idxTime = c.getColumnIndex("createdAt")
            val idxText = c.getColumnIndex("text")
            val idxUser = c.getColumnIndex("userId")
            val idxReposts = c.getColumnIndex("reposts")
            val idxComments = c.getColumnIndex("comments")
            val idxAttitudes = c.getColumnIndex("attitudes")
            while (c.moveToNext()) {
                val mid = if (idxMid >= 0) safeGetString(c, idxMid) else null
                if (mid.isNullOrBlank()) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    PostRow(
                        mid = mid,
                        createdAtMs = time?.let { normalizeEpochMs(it) },
                        text = if (idxText >= 0) c.getString(idxText) else null,
                        userId = if (idxUser >= 0) safeGetString(c, idxUser) else null,
                        reposts = if (idxReposts >= 0 && !c.isNull(idxReposts)) c.getInt(idxReposts) else null,
                        comments = if (idxComments >= 0 && !c.isNull(idxComments)) c.getInt(idxComments) else null,
                        attitudes = if (idxAttitudes >= 0 && !c.isNull(idxAttitudes)) c.getInt(idxAttitudes) else null,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    /**
     * Parse favourite (收藏). Column candidates:
     *   - statusId: status_id / mid / mblog_id (required)
     *   - savedAt: fav_time / favorite_time / created_at / time (optional)
     *   - text: text / content (optional)
     *   - userId: user_id (optional, who posted the favourited status)
     */
    private fun parseFavourite(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<FavouriteRow>, Boolean> {
        val candidateTables = listOf("favorite", "favourite", "fav", "saved_status", "collection")
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val statusIdCol = pickCol(columns, listOf("status_id", "mid", "mblog_id"))
        if (statusIdCol == null) {
            warnings.add(
                "$table missing status_id column; have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val timeCol = pickCol(columns, listOf("fav_time", "favorite_time", "created_at", "time"))
        val textCol = pickCol(columns, listOf("text", "content"))
        val userIdCol = pickCol(columns, listOf("user_id", "uid"))

        val selectFields = mutableListOf("$statusIdCol AS statusId")
        if (timeCol != null) selectFields.add("$timeCol AS savedAt")
        if (textCol != null) selectFields.add("$textCol AS text")
        if (userIdCol != null) selectFields.add("$userIdCol AS userId")

        val orderClause = if (timeCol != null) " ORDER BY $timeCol DESC" else ""
        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM $table$orderClause LIMIT $LIMIT_FAVOURITE"
        val rows = mutableListOf<FavouriteRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("$table query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxStatusId = c.getColumnIndex("statusId")
            val idxTime = c.getColumnIndex("savedAt")
            val idxText = c.getColumnIndex("text")
            val idxUser = c.getColumnIndex("userId")
            while (c.moveToNext()) {
                val statusId = if (idxStatusId >= 0) safeGetString(c, idxStatusId) else null
                if (statusId.isNullOrBlank()) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    FavouriteRow(
                        statusId = statusId,
                        savedAtMs = time?.let { normalizeEpochMs(it) },
                        text = if (idxText >= 0) c.getString(idxText) else null,
                        userId = if (idxUser >= 0) safeGetString(c, idxUser) else null,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    /**
     * Parse follow (关注). Column candidates:
     *   - followedUid: uid / followed_uid / user_id / target_uid (required)
     *   - screenName: screen_name / name / nickname (optional)
     *   - followedAt: follow_time / created_at / time (optional)
     *   - avatar: avatar / profile_image_url / face (optional)
     */
    private fun parseFollow(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<FollowRow>, Boolean> {
        val candidateTables = listOf("attention", "follow", "friend", "subscription", "followed_user")
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val uidCol = pickCol(columns, listOf("uid", "followed_uid", "user_id", "target_uid"))
        if (uidCol == null) {
            warnings.add(
                "$table missing uid column; have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val nameCol = pickCol(columns, listOf("screen_name", "name", "nickname"))
        val timeCol = pickCol(columns, listOf("follow_time", "created_at", "time"))
        val avatarCol = pickCol(columns, listOf("avatar", "profile_image_url", "face"))

        val selectFields = mutableListOf("$uidCol AS followedUid")
        if (nameCol != null) selectFields.add("$nameCol AS screenName")
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
            val idxUid = c.getColumnIndex("followedUid")
            val idxName = c.getColumnIndex("screenName")
            val idxTime = c.getColumnIndex("followedAt")
            val idxAvatar = c.getColumnIndex("avatar")
            while (c.moveToNext()) {
                val uid = if (idxUid >= 0) safeGetString(c, idxUid) else null
                if (uid.isNullOrBlank()) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    FollowRow(
                        followedUid = uid,
                        screenName = if (idxName >= 0) c.getString(idxName) else null,
                        followedAtMs = time?.let { normalizeEpochMs(it) },
                        avatar = if (idxAvatar >= 0) c.getString(idxAvatar) else null,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    // ─── Helpers (same shape as Toutiao/Bilibili) ────────────────────────

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
            Timber.d(t, "WeiboRootDbExtractor: PRAGMA table_info(%s) failed", table)
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
     * Assemble staging JSON matching social-weibo SNAPSHOT_SCHEMA_VERSION=1.
     * Kinds: post / favourite / follow (search is sqlite-mode-only, not
     * snapshot-accepted).
     */
    private fun assembleSnapshotJson(
        uid: String,
        snapshottedAt: Long,
        posts: List<PostRow>,
        favourites: List<FavouriteRow>,
        follows: List<FollowRow>,
    ): JSONObject {
        val account = JSONObject().apply {
            put("uid", uid)
            put("displayName", "")
        }
        val events = JSONArray()

        posts.forEach { p ->
            val ev = JSONObject().apply {
                put("kind", "post")
                put("id", "post-${p.mid}")
                put("capturedAt", p.createdAtMs ?: snapshottedAt)
                put("mid", p.mid)
                put("text", p.text ?: JSONObject.NULL)
                put("userId", p.userId ?: JSONObject.NULL)
                put("reposts", p.reposts ?: 0)
                put("comments", p.comments ?: 0)
                put("attitudes", p.attitudes ?: 0)
            }
            events.put(ev)
        }
        favourites.forEach { f ->
            val ev = JSONObject().apply {
                put("kind", "favourite")
                put("id", "fav-${f.statusId}")
                put("capturedAt", f.savedAtMs ?: snapshottedAt)
                put("statusId", f.statusId)
                put("text", f.text ?: JSONObject.NULL)
                put("userId", f.userId ?: JSONObject.NULL)
            }
            events.put(ev)
        }
        follows.forEach { f ->
            val ev = JSONObject().apply {
                put("kind", "follow")
                put("id", "follow-${f.followedUid}")
                put("capturedAt", f.followedAtMs ?: snapshottedAt)
                put("followedUid", f.followedUid)
                put("screenName", f.screenName ?: JSONObject.NULL)
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
            Timber.d(t, "WeiboRootDbExtractor: ls %s failed", dir)
            emptySet()
        }
    }

    // ─── Internal row DTOs ──────────────────────────────────────────────

    internal data class PostRow(
        val mid: String,
        val createdAtMs: Long?,
        val text: String?,
        val userId: String?,
        val reposts: Int?,
        val comments: Int?,
        val attitudes: Int?,
    )

    internal data class FavouriteRow(
        val statusId: String,
        val savedAtMs: Long?,
        val text: String?,
        val userId: String?,
    )

    internal data class FollowRow(
        val followedUid: String,
        val screenName: String?,
        val followedAtMs: Long?,
        val avatar: String?,
    )

    companion object {
        const val WEIBO_DB_REMOTE_DIR =
            "/data/data/com.sina.weibo/databases"

        /**
         * v0.1 candidate DB filenames in priority order — best-effort
         * guesses (zero public refs, no decompile available). P7.3 §3
         * probe fills the actual list. Update once user runs the probe.
         */
        val DB_FILENAME_CANDIDATES: List<String> = listOf(
            "weibo.db",
            "mblog.db",
            "feed.db",
            "user.db",
            "home_feed.db",
            "weibo_pro.db",
            "status.db",
        )

        const val STAGING_JSON_NAME = "social-weibo-root.json"
        const val SNAPSHOT_SCHEMA_VERSION = 1
        const val LIMIT_POST = 5_000
        const val LIMIT_FAVOURITE = 2_000
        const val LIMIT_FOLLOW = 5_000
    }
}
