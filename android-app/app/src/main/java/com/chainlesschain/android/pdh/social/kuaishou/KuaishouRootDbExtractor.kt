package com.chainlesschain.android.pdh.social.kuaishou

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
 * Phase 7.6 — Android in-APK root Kuaishou DB extractor (path B).
 *
 * Reads `/data/data/com.smile.gifmaker/databases/` `*.db` files via
 * `su -c "cp ..."` cohort copy + standard Android SQLiteDatabase open.
 *
 * **v0.1 与 Xhs 并列期望失败率最高** per plan §6.6: Kuaishou DB 几乎确定
 * 自研加密或 SQLCipher + libmsaoaidsec.so 反 frida 极高强度. v0.1 ship 是
 * user-explicit "Mode B 全面 5 平台" override; 真机大概率命中
 * `likely-sqlcipher` banner 跳 v2.0 frida + libmsaoaidsec neuter 路径。
 *
 * **Note on libmsaoaidsec.so**: libmsaoaidsec runs in the **Kuaishou app
 * process** (NS_sig3 签名 SDK + 反 frida 守护). `su -c "cp"` copies db
 * file in a **separate process** — libmsaoaidsec cannot reach it. So
 * v0.1 file-copy path is safe; libmsaoaidsec only matters in v2.0 if
 * we need frida injection for key derivation.
 *
 * Output JSON follows `social-kuaishou` snapshot mode. Mode B targets
 * 3 of 4 valid kinds (watch / collect / search). KIND_PROFILE is the
 * user themselves and is derived from credentialsStore — not from DB —
 * so skip in Mode B v0.1.
 *
 * Pipeline mirrors P7.5 (Xhs):
 *   1. uid from [KuaishouRootCredentialsStore]
 *   2. [RootShellRunner.isSuAvailable] gate → NoRoot if false
 *   3. Try candidate DB filenames; first existing wins → DbCohortCopier
 *   4. SQLiteDatabase opens read-only
 *      - if open fails with "file is not a database" → SQLCipher /
 *        自研 cipher; surface explicit v2.0 transition hint
 *   5. parseWatch + parseCollect + parseSearch with PRAGMA defensive picker
 *   6. Write staging JSON matching social-kuaishou schemaVersion=1
 */
@Singleton
class KuaishouRootDbExtractor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: KuaishouRootCredentialsStore,
    private val runner: RootShellRunner,
    private val cohortCopier: DbCohortCopier,
) {

    sealed class ExtractResult {
        data class Ok(
            val stagingJsonPath: String,
            val watchCount: Int,
            val collectCount: Int,
            val searchCount: Int,
            val totalRows: Int,
            val extractedAtMs: Long,
            val dbFilename: String,
            val hadWatchTable: Boolean,
            val hadCollectTable: Boolean,
            val hadSearchTable: Boolean,
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

        val availableDbs = lsDatabaseDir(KUAISHOU_DB_REMOTE_DIR)
        val pickedDb = DB_FILENAME_CANDIDATES.firstOrNull { it in availableDbs }
            ?: return@withContext ExtractResult.SourceDbMissing
        val remoteDb = "$KUAISHOU_DB_REMOTE_DIR/$pickedDb"

        val stagingDir = File(
            context.cacheDir,
            "kuaishou-root-staging-${System.currentTimeMillis()}",
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
            Timber.w(t, "KuaishouRootDbExtractor: SQLite open failed for %s", localDb.absolutePath)
            cohortCopier.cleanup(localDb)
            stagingDir.deleteRecursively()
            val msg = t.message ?: t.javaClass.simpleName
            // Plan §6.6: Kuaishou DB **likely SQLCipher or 自研 cipher**.
            // "file is not a database" is the canonical SQLite-rejects-
            // cipher-stream shape — surface explicit v2.0 transition pointer.
            val isLikelyCipher = msg.contains("file is not a database") ||
                msg.contains("not an error")
            val cipherHint = if (isLikelyCipher) {
                " — Kuaishou DB 几乎确定 SQLCipher 或自研加密 + libmsaoaidsec.so 反 frida (v2.0 路径: frida + libmsaoaidsec neuter + key 派生 hook, 见 Phase 7 plan §6.6)"
            } else ""
            return@withContext ExtractResult.Failed(
                reason = if (isLikelyCipher) "likely-sqlcipher" else "open-error",
                message = "$msg$cipherHint",
            )
        }

        try {
            val warnings = mutableListOf<String>()
            val (watch, hadWatchTable) = parseWatch(db, uid, warnings)
            val (collect, hadCollectTable) = parseCollect(db, warnings)
            val (search, hadSearchTable) = parseSearch(db, warnings)

            val snapshottedAt = System.currentTimeMillis()
            val json = assembleSnapshotJson(
                uid = uid,
                snapshottedAt = snapshottedAt,
                watch = watch,
                collect = collect,
                search = search,
            )
            val stagingJson = File(stagingDir, STAGING_JSON_NAME)
            stagingJson.writeText(json.toString(), Charsets.UTF_8)

            ExtractResult.Ok(
                stagingJsonPath = stagingJson.absolutePath,
                watchCount = watch.size,
                collectCount = collect.size,
                searchCount = search.size,
                totalRows = watch.size + collect.size + search.size,
                extractedAtMs = snapshottedAt,
                dbFilename = pickedDb,
                hadWatchTable = hadWatchTable,
                hadCollectTable = hadCollectTable,
                hadSearchTable = hadSearchTable,
                schemaDriftWarnings = warnings.toList(),
            )
        } catch (t: Throwable) {
            Timber.e(t, "KuaishouRootDbExtractor: parse/dump failed")
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
     * Parse watch history (观看历史). Column candidates:
     *   - photoId: photo_id / id / video_id / item_id (required)
     *   - watchedAt: watched_at / play_time / created_at / time
     *   - title: title / caption / desc
     *   - authorId: user_id / author_id / poster_id
     *   - authorName: author_name / nickname
     *   - duration: duration_ms / duration
     */
    private fun parseWatch(
        db: SQLiteDatabase,
        uid: String,
        warnings: MutableList<String>,
    ): Pair<List<WatchRow>, Boolean> {
        val candidateTables = listOf(
            "play_history", "watch_history", "video_history", "history", "watched_photo",
        )
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val photoIdCol = pickCol(columns, listOf("photo_id", "id", "video_id", "item_id"))
        val timeCol = pickCol(columns, listOf("watched_at", "play_time", "created_at", "time"))
        if (photoIdCol == null || timeCol == null) {
            warnings.add(
                "$table missing required columns (photo_id + time); have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val titleCol = pickCol(columns, listOf("title", "caption", "desc"))
        val authorIdCol = pickCol(columns, listOf("user_id", "author_id", "poster_id"))
        val authorNameCol = pickCol(columns, listOf("author_name", "nickname"))
        val durationCol = pickCol(columns, listOf("duration_ms", "duration"))

        val selectFields = mutableListOf("$photoIdCol AS photoId", "$timeCol AS watchedAt")
        if (titleCol != null) selectFields.add("$titleCol AS title")
        if (authorIdCol != null) selectFields.add("$authorIdCol AS authorId")
        if (authorNameCol != null) selectFields.add("$authorNameCol AS authorName")
        if (durationCol != null) selectFields.add("$durationCol AS duration")

        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM $table ORDER BY $timeCol DESC LIMIT $LIMIT_WATCH"
        val rows = mutableListOf<WatchRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("$table query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxPhoto = c.getColumnIndex("photoId")
            val idxTime = c.getColumnIndex("watchedAt")
            val idxTitle = c.getColumnIndex("title")
            val idxAuthorId = c.getColumnIndex("authorId")
            val idxAuthorName = c.getColumnIndex("authorName")
            val idxDuration = c.getColumnIndex("duration")
            while (c.moveToNext()) {
                val photoId = if (idxPhoto >= 0) safeGetString(c, idxPhoto) else null
                if (photoId.isNullOrBlank()) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    WatchRow(
                        photoId = photoId,
                        watchedAtMs = time?.let { normalizeEpochMs(it) },
                        title = if (idxTitle >= 0) c.getString(idxTitle) else null,
                        authorId = if (idxAuthorId >= 0) safeGetString(c, idxAuthorId) else null,
                        authorName = if (idxAuthorName >= 0) c.getString(idxAuthorName) else null,
                        durationMs = if (idxDuration >= 0 && !c.isNull(idxDuration)) c.getLong(idxDuration) else null,
                        ownerUid = uid,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    /**
     * Parse collect (收藏). Column candidates:
     *   - photoId: photo_id / id / collected_id (required)
     *   - collectedAt: collected_at / created_at / time
     *   - title: title / caption
     *   - authorId: author_id / user_id
     */
    private fun parseCollect(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<CollectRow>, Boolean> {
        val candidateTables = listOf("collect", "favorite", "starred", "saved", "my_collection")
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val photoIdCol = pickCol(columns, listOf("photo_id", "id", "collected_id", "video_id"))
        if (photoIdCol == null) {
            warnings.add(
                "$table missing photo_id column; have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val timeCol = pickCol(columns, listOf("collected_at", "created_at", "time"))
        val titleCol = pickCol(columns, listOf("title", "caption"))
        val authorIdCol = pickCol(columns, listOf("author_id", "user_id"))

        val selectFields = mutableListOf("$photoIdCol AS photoId")
        if (timeCol != null) selectFields.add("$timeCol AS collectedAt")
        if (titleCol != null) selectFields.add("$titleCol AS title")
        if (authorIdCol != null) selectFields.add("$authorIdCol AS authorId")

        val orderClause = if (timeCol != null) " ORDER BY $timeCol DESC" else ""
        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM $table$orderClause LIMIT $LIMIT_COLLECT"
        val rows = mutableListOf<CollectRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("$table query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxPhoto = c.getColumnIndex("photoId")
            val idxTime = c.getColumnIndex("collectedAt")
            val idxTitle = c.getColumnIndex("title")
            val idxAuthor = c.getColumnIndex("authorId")
            while (c.moveToNext()) {
                val photoId = if (idxPhoto >= 0) safeGetString(c, idxPhoto) else null
                if (photoId.isNullOrBlank()) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    CollectRow(
                        photoId = photoId,
                        collectedAtMs = time?.let { normalizeEpochMs(it) },
                        title = if (idxTitle >= 0) c.getString(idxTitle) else null,
                        authorId = if (idxAuthor >= 0) safeGetString(c, idxAuthor) else null,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    /**
     * Parse search history (搜索历史). Column candidates:
     *   - query: query / keyword / text / search_word (required)
     *   - searchedAt: searched_at / created_at / time
     */
    private fun parseSearch(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<SearchRow>, Boolean> {
        val candidateTables = listOf(
            "search_history", "search", "query_history", "recent_search", "search_word",
        )
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val queryCol = pickCol(columns, listOf("query", "keyword", "text", "search_word"))
        if (queryCol == null) {
            warnings.add(
                "$table missing query column; have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val timeCol = pickCol(columns, listOf("searched_at", "created_at", "time"))

        val selectFields = mutableListOf("$queryCol AS query")
        if (timeCol != null) selectFields.add("$timeCol AS searchedAt")

        val orderClause = if (timeCol != null) " ORDER BY $timeCol DESC" else ""
        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM $table$orderClause LIMIT $LIMIT_SEARCH"
        val rows = mutableListOf<SearchRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("$table query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxQuery = c.getColumnIndex("query")
            val idxTime = c.getColumnIndex("searchedAt")
            while (c.moveToNext()) {
                val query = if (idxQuery >= 0) safeGetString(c, idxQuery) else null
                if (query.isNullOrBlank()) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    SearchRow(
                        query = query,
                        searchedAtMs = time?.let { normalizeEpochMs(it) },
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    // ─── Helpers (same shape as Xhs/Weibo) ──────────────────────────────

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
            Timber.d(t, "KuaishouRootDbExtractor: PRAGMA table_info(%s) failed", table)
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
     * Assemble staging JSON matching social-kuaishou SNAPSHOT_SCHEMA_VERSION=1.
     * Mode B emits 3 kinds: watch / collect / search. KIND_PROFILE is the
     * user themselves and is derivable from credentialsStore — skip here
     * (path A's snapshot includes profile from visionProfilePhotoList).
     */
    private fun assembleSnapshotJson(
        uid: String,
        snapshottedAt: Long,
        watch: List<WatchRow>,
        collect: List<CollectRow>,
        search: List<SearchRow>,
    ): JSONObject {
        val account = JSONObject().apply {
            put("uid", uid)
            put("displayName", "")
        }
        val events = JSONArray()

        watch.forEach { w ->
            val ev = JSONObject().apply {
                put("kind", "watch")
                put("id", "watch-${w.photoId}")
                put("capturedAt", w.watchedAtMs ?: snapshottedAt)
                put("photoId", w.photoId)
                put("title", w.title ?: JSONObject.NULL)
                put("authorId", w.authorId ?: JSONObject.NULL)
                put("authorName", w.authorName ?: JSONObject.NULL)
                put("durationMs", w.durationMs ?: 0)
                put("ownerUid", w.ownerUid)
            }
            events.put(ev)
        }
        collect.forEach { co ->
            val ev = JSONObject().apply {
                put("kind", "collect")
                put("id", "collect-${co.photoId}")
                put("capturedAt", co.collectedAtMs ?: snapshottedAt)
                put("photoId", co.photoId)
                put("title", co.title ?: JSONObject.NULL)
                put("authorId", co.authorId ?: JSONObject.NULL)
            }
            events.put(ev)
        }
        search.forEach { s ->
            val ev = JSONObject().apply {
                put("kind", "search")
                // id 用 query + time hash 防同词多次搜索 dedup 误删
                val sig = s.query.hashCode().toString(16) + "-" + (s.searchedAtMs ?: snapshottedAt)
                put("id", "search-$sig")
                put("capturedAt", s.searchedAtMs ?: snapshottedAt)
                put("query", s.query)
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
            Timber.d(t, "KuaishouRootDbExtractor: ls %s failed", dir)
            emptySet()
        }
    }

    // ─── Internal row DTOs ──────────────────────────────────────────────

    internal data class WatchRow(
        val photoId: String,
        val watchedAtMs: Long?,
        val title: String?,
        val authorId: String?,
        val authorName: String?,
        val durationMs: Long?,
        val ownerUid: String,
    )

    internal data class CollectRow(
        val photoId: String,
        val collectedAtMs: Long?,
        val title: String?,
        val authorId: String?,
    )

    internal data class SearchRow(
        val query: String,
        val searchedAtMs: Long?,
    )

    companion object {
        const val KUAISHOU_DB_REMOTE_DIR =
            "/data/data/com.smile.gifmaker/databases"

        /**
         * v0.1 candidate DB filenames in priority order — best-effort
         * guesses (zero public refs per plan §6.6). P7.6.0 真机探测 fills
         * the actual list. Update once user runs the probe.
         */
        val DB_FILENAME_CANDIDATES: List<String> = listOf(
            "kwai.db",
            "kuaishou.db",
            "gif.db",
            "video.db",
            "feed.db",
            "user.db",
            "history.db",
        )

        const val STAGING_JSON_NAME = "social-kuaishou-root.json"
        const val SNAPSHOT_SCHEMA_VERSION = 1
        const val LIMIT_WATCH = 5_000
        const val LIMIT_COLLECT = 2_000
        const val LIMIT_SEARCH = 500
    }
}
