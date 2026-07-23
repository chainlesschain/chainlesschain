package com.chainlesschain.android.pdh.social.toutiao

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
 * Phase 7.1 — Android in-APK root Toutiao DB extractor (path B).
 *
 * Reads `/data/data/com.ss.android.article.news/databases/` `*.db` files via
 * `su -c "cp ..."` cohort copy (WAL/SHM siblings included) + standard
 * Android SQLiteDatabase open. Toutiao uses **plaintext SQLite** —
 * **no SQLCipher**, **no frida hook needed** — same pattern as Douyin
 * (字节系 framework推论 + abrignoni DFIR analog).
 *
 * Mirror of the Node-side path C
 * `packages/personal-data-hub/lib/adapters/social-toutiao-adb/`, but
 * the path-B output JSON schema follows `social-toutiao` snapshot
 * mode (kinds: profile / read / collection / search, schemaVersion=1).
 *
 * **v0.1 schema status**: DB filename + table names are best-effort
 * guesses pending real-device 探测 (P7.1.0). The defensive PRAGMA
 * table_info + column-candidate picker handles known drift; if all
 * candidate names miss, returns SourceDbMissing or empty tables with
 * a schema-drift warning so the user can supply the real names.
 *
 * Pipeline:
 *   1. uid from [ToutiaoRootCredentialsStore]
 *   2. [RootShellRunner.isSuAvailable] gate → NoRoot if false
 *   3. Try candidate DB filenames in priority order; first existing
 *      file wins → [DbCohortCopier.copy] pulls main+WAL+SHM
 *   4. SQLiteDatabase opens local copy read-only
 *   5. parseReadHistory + parseCollection + parseSearchHistory each
 *      with PRAGMA-based defensive column picking
 *   6. Write staging JSON matching social-toutiao schemaVersion=1
 *
 * Test seam: [openDatabase] is a `var` for JVM unit tests; [lsDatabaseDir]
 * is also injectable for the "which DB files exist" probe.
 */
@Singleton
class ToutiaoRootDbExtractor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: ToutiaoRootCredentialsStore,
    private val runner: RootShellRunner,
    private val cohortCopier: DbCohortCopier,
) {

    sealed class ExtractResult {
        data class Ok(
            val stagingJsonPath: String,
            val readCount: Int,
            val collectionCount: Int,
            val searchCount: Int,
            val totalRows: Int,
            val extractedAtMs: Long,
            val dbFilename: String,
            val hadReadTable: Boolean,
            val hadCollectionTable: Boolean,
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

        // Step 1: pick the first existing DB file from the candidate list.
        // v0.1 ships with best-effort guesses; real-device 探测 confirms.
        val availableDbs = lsDatabaseDir(TOUTIAO_DB_REMOTE_DIR)
        val pickedDb = DB_FILENAME_CANDIDATES.firstOrNull { it in availableDbs }
            ?: return@withContext ExtractResult.SourceDbMissing
        val remoteDb = "$TOUTIAO_DB_REMOTE_DIR/$pickedDb"

        val stagingDir = File(
            context.cacheDir,
            "toutiao-root-staging-${System.currentTimeMillis()}",
        )
        if (!stagingDir.mkdirs()) {
            return@withContext ExtractResult.Failed(
                reason = "staging-mkdir-failed",
                message = "could not create staging dir at ${stagingDir.absolutePath}",
            )
        }
        val localDb = File(stagingDir, pickedDb)

        // Step 2: copy the WAL-consistent database cohort.
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

        // Step 3: open local copy.
        val db = try {
            openDatabase(localDb.absolutePath)
        } catch (t: Throwable) {
            Timber.w(t, "ToutiaoRootDbExtractor: SQLite open failed for %s", localDb.absolutePath)
            cohortCopier.cleanup(localDb)
            stagingDir.deleteRecursively()
            return@withContext ExtractResult.Failed(
                reason = "open-error",
                message = t.message ?: t.javaClass.simpleName,
            )
        }

        try {
            val warnings = mutableListOf<String>()
            val (reads, hadReadTable) = parseReadHistory(db, warnings)
            val (collections, hadCollectionTable) = parseCollection(db, warnings)
            val (searches, hadSearchTable) = parseSearchHistory(db, warnings)

            val snapshottedAt = System.currentTimeMillis()
            val json = assembleSnapshotJson(
                uid = uid,
                snapshottedAt = snapshottedAt,
                reads = reads,
                collections = collections,
                searches = searches,
            )
            val stagingJson = File(stagingDir, STAGING_JSON_NAME)
            stagingJson.writeText(json.toString(), Charsets.UTF_8)

            ExtractResult.Ok(
                stagingJsonPath = stagingJson.absolutePath,
                readCount = reads.size,
                collectionCount = collections.size,
                searchCount = searches.size,
                totalRows = reads.size + collections.size + searches.size,
                extractedAtMs = snapshottedAt,
                dbFilename = pickedDb,
                hadReadTable = hadReadTable,
                hadCollectionTable = hadCollectionTable,
                hadSearchTable = hadSearchTable,
                schemaDriftWarnings = warnings.toList(),
            )
        } catch (t: Throwable) {
            Timber.e(t, "ToutiaoRootDbExtractor: parse/dump failed")
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
     * Parse `read_history` table.
     *
     * Column candidates (first match wins):
     *   - itemId: item_id / group_id / id / _id (required)
     *   - title: title / article_title / display_title
     *   - readTime: read_time / time / create_time / timestamp (required for ordering)
     *   - category: category / cell_type
     *   - author: author / source / media_name
     *   - readDuration: read_duration / duration / stay_time
     */
    private fun parseReadHistory(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<ReadRow>, Boolean> {
        val columns = readTableColumns(db, "read_history") ?: return Pair(emptyList(), false)
        val itemCol = pickCol(columns, listOf("item_id", "group_id", "id", "_id"))
        val timeCol = pickCol(columns, listOf("read_time", "time", "create_time", "timestamp"))
        if (itemCol == null || timeCol == null) {
            warnings.add(
                "read_history missing required columns (itemId/readTime); have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val titleCol = pickCol(columns, listOf("title", "article_title", "display_title"))
        val catCol = pickCol(columns, listOf("category", "cell_type"))
        val authorCol = pickCol(columns, listOf("author", "source", "media_name"))
        val durCol = pickCol(columns, listOf("read_duration", "duration", "stay_time"))

        val selectFields = mutableListOf(
            "$itemCol AS itemId",
            "$timeCol AS readTime",
        )
        if (titleCol != null) selectFields.add("$titleCol AS title")
        if (catCol != null) selectFields.add("$catCol AS category")
        if (authorCol != null) selectFields.add("$authorCol AS author")
        if (durCol != null) selectFields.add("$durCol AS readDuration")

        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM read_history ORDER BY $timeCol DESC LIMIT $LIMIT_READ"

        val rows = mutableListOf<ReadRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("read_history query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxItem = c.getColumnIndex("itemId")
            val idxTime = c.getColumnIndex("readTime")
            val idxTitle = c.getColumnIndex("title")
            val idxCat = c.getColumnIndex("category")
            val idxAuthor = c.getColumnIndex("author")
            val idxDur = c.getColumnIndex("readDuration")
            while (c.moveToNext()) {
                val item = if (idxItem >= 0) safeGetString(c, idxItem) else null
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                if (item.isNullOrBlank()) continue
                rows.add(
                    ReadRow(
                        itemId = item,
                        readTimeMs = time?.let { normalizeEpochMs(it) },
                        title = if (idxTitle >= 0) c.getString(idxTitle) else null,
                        category = if (idxCat >= 0) c.getString(idxCat) else null,
                        author = if (idxAuthor >= 0) c.getString(idxAuthor) else null,
                        readDuration = if (idxDur >= 0 && !c.isNull(idxDur)) c.getInt(idxDur) else null,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    /**
     * Parse `collection_article` (saved articles).
     *
     * Column candidates:
     *   - itemId: item_id / group_id / id (required)
     *   - savedAt: save_time / collection_time / time / create_time
     *   - title: title / article_title
     *   - category: category
     *   - author: author / source
     */
    private fun parseCollection(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<CollectionRow>, Boolean> {
        val columns = readTableColumns(db, "collection_article") ?: return Pair(emptyList(), false)
        val itemCol = pickCol(columns, listOf("item_id", "group_id", "id"))
        if (itemCol == null) {
            warnings.add(
                "collection_article missing itemId column; have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val timeCol = pickCol(columns, listOf("save_time", "collection_time", "time", "create_time"))
        val titleCol = pickCol(columns, listOf("title", "article_title"))
        val catCol = pickCol(columns, listOf("category"))
        val authorCol = pickCol(columns, listOf("author", "source"))

        val selectFields = mutableListOf("$itemCol AS itemId")
        if (timeCol != null) selectFields.add("$timeCol AS savedAt")
        if (titleCol != null) selectFields.add("$titleCol AS title")
        if (catCol != null) selectFields.add("$catCol AS category")
        if (authorCol != null) selectFields.add("$authorCol AS author")

        val orderClause = if (timeCol != null) " ORDER BY $timeCol DESC" else ""
        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM collection_article$orderClause LIMIT $LIMIT_COLLECTION"
        val rows = mutableListOf<CollectionRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("collection_article query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxItem = c.getColumnIndex("itemId")
            val idxTime = c.getColumnIndex("savedAt")
            val idxTitle = c.getColumnIndex("title")
            val idxCat = c.getColumnIndex("category")
            val idxAuthor = c.getColumnIndex("author")
            while (c.moveToNext()) {
                val item = if (idxItem >= 0) safeGetString(c, idxItem) else null
                if (item.isNullOrBlank()) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    CollectionRow(
                        itemId = item,
                        savedAtMs = time?.let { normalizeEpochMs(it) },
                        title = if (idxTitle >= 0) c.getString(idxTitle) else null,
                        category = if (idxCat >= 0) c.getString(idxCat) else null,
                        author = if (idxAuthor >= 0) c.getString(idxAuthor) else null,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    /**
     * Parse `search_history`.
     *
     * Column candidates:
     *   - keyword: keyword / query / content (required)
     *   - searchAt: search_time / time / create_time / timestamp
     */
    private fun parseSearchHistory(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<SearchRow>, Boolean> {
        val columns = readTableColumns(db, "search_history") ?: return Pair(emptyList(), false)
        val kwCol = pickCol(columns, listOf("keyword", "query", "content"))
        if (kwCol == null) {
            warnings.add(
                "search_history missing keyword column; have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val timeCol = pickCol(columns, listOf("search_time", "time", "create_time", "timestamp"))

        val selectFields = mutableListOf("$kwCol AS keyword")
        if (timeCol != null) selectFields.add("$timeCol AS searchAt")
        val orderClause = if (timeCol != null) " ORDER BY $timeCol DESC" else ""
        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM search_history$orderClause LIMIT $LIMIT_SEARCH"

        val rows = mutableListOf<SearchRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("search_history query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxKw = c.getColumnIndex("keyword")
            val idxTime = c.getColumnIndex("searchAt")
            while (c.moveToNext()) {
                val kw = if (idxKw >= 0) c.getString(idxKw) else null
                if (kw.isNullOrBlank()) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(SearchRow(keyword = kw, searchAtMs = time?.let { normalizeEpochMs(it) }))
            }
        }
        return Pair(rows, true)
    }

    // ─── Helpers ────────────────────────────────────────────────────────

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
            Timber.d(t, "ToutiaoRootDbExtractor: PRAGMA table_info(%s) failed", table)
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

    /** Normalize epoch — Toutiao stores some times as seconds, others as ms. */
    private fun normalizeEpochMs(v: Long): Long = if (v in 1_000_000_000L..9_999_999_999L) v * 1000L else v

    /**
     * Assemble staging JSON matching social-toutiao SNAPSHOT_SCHEMA_VERSION=1.
     * Mirrors Node-side `social-toutiao-adb/snapshot-builder.js` byte-for-byte:
     * same kinds (read / collection / search), same id format
     * (read-<itemId> / collect-<itemId> / search-<kw>:<ts>).
     */
    private fun assembleSnapshotJson(
        uid: String,
        snapshottedAt: Long,
        reads: List<ReadRow>,
        collections: List<CollectionRow>,
        searches: List<SearchRow>,
    ): JSONObject {
        val account = JSONObject().apply {
            put("uid", uid)
            put("displayName", "")
        }
        val events = JSONArray()

        reads.forEach { r ->
            val ev = JSONObject().apply {
                put("kind", "read")
                put("id", "read-${r.itemId}")
                put("capturedAt", r.readTimeMs ?: snapshottedAt)
                put("itemId", r.itemId)
                put("title", r.title ?: JSONObject.NULL)
                put("category", r.category ?: JSONObject.NULL)
                put("author", r.author ?: JSONObject.NULL)
                put("readDuration", r.readDuration ?: 0)
                put("source", JSONObject.NULL) // unknown via DB
            }
            events.put(ev)
        }
        collections.forEach { c ->
            val ev = JSONObject().apply {
                put("kind", "collection")
                put("id", "collect-${c.itemId}")
                put("capturedAt", c.savedAtMs ?: snapshottedAt)
                put("itemId", c.itemId)
                put("title", c.title ?: JSONObject.NULL)
                put("category", c.category ?: JSONObject.NULL)
                put("author", c.author ?: JSONObject.NULL)
            }
            events.put(ev)
        }
        searches.forEachIndexed { idx, s ->
            val ts = s.searchAtMs ?: (snapshottedAt - idx * 1000L)
            val ev = JSONObject().apply {
                put("kind", "search")
                put("id", "search-${s.keyword}:$ts")
                put("capturedAt", ts)
                put("keyword", s.keyword)
                put("searchAt", ts)
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

    /**
     * Open the local-copy sqlite. JVM unit tests swap with sqlite-jdbc.
     */
    internal var openDatabase: (path: String) -> SQLiteDatabase = { path ->
        SQLiteDatabase.openDatabase(path, null, SQLiteDatabase.OPEN_READONLY)
    }

    /**
     * List `.db` filenames in the remote databases dir via `su -c ls`.
     * Test seam — JVM tests inject a Set without spawning su.
     *
     * Real impl best-effort: returns empty Set on failure so the caller
     * SourceDbMissing-fails cleanly.
     */
    internal var lsDatabaseDir: (dir: String) -> Set<String> = { dir ->
        try {
            val out = runner.execAndCapture("ls $dir 2>/dev/null") ?: ""
            out.split("\n", "\r")
                .map { it.trim() }
                .filter { it.endsWith(".db") }
                .toSet()
        } catch (t: Throwable) {
            Timber.d(t, "ToutiaoRootDbExtractor: ls %s failed", dir)
            emptySet()
        }
    }

    // ─── Internal row DTOs ──────────────────────────────────────────────

    internal data class ReadRow(
        val itemId: String,
        val readTimeMs: Long?,
        val title: String?,
        val category: String?,
        val author: String?,
        val readDuration: Int?,
    )

    internal data class CollectionRow(
        val itemId: String,
        val savedAtMs: Long?,
        val title: String?,
        val category: String?,
        val author: String?,
    )

    internal data class SearchRow(
        val keyword: String,
        val searchAtMs: Long?,
    )

    companion object {
        const val TOUTIAO_DB_REMOTE_DIR =
            "/data/data/com.ss.android.article.news/databases"

        /**
         * v0.1 candidate DB filenames in priority order — best-effort
         * guesses pending P7.1.0 real-device 探测. Update once user runs
         * `adb shell run-as ls /data/data/com.ss.android.article.news/databases/`.
         */
        val DB_FILENAME_CANDIDATES: List<String> = listOf(
            "article.db",
            "bdtracker_v3.db",
            "applog_stats.db",
            "tnc.db",
            "favorite.db",
            "history.db",
        )

        const val STAGING_JSON_NAME = "social-toutiao-root.json"
        const val SNAPSHOT_SCHEMA_VERSION = 1
        const val LIMIT_READ = 5_000
        const val LIMIT_COLLECTION = 2_000
        const val LIMIT_SEARCH = 1_000
    }
}
