package com.chainlesschain.android.pdh.social.bilibili

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
 * Phase 7.2 — Android in-APK root Bilibili DB extractor (path B).
 *
 * Reads `/data/data/tv.danmaku.bili/databases/*.db` via `su -c "cp ..."`
 * cohort copy (WAL/SHM siblings included) + standard Android
 * SQLiteDatabase open. Bilibili uses **plaintext SQLite** — no SQLCipher,
 * no frida hook needed. Schema is publicly documented via
 * [bilibili-android-decompile](https://github.com/2bllw8/bilibili-android-decompile);
 * difficulty 2/5 per Phase 7 plan.
 *
 * **Plan §6.4 recommendation**: SKIP because path A SESSDATA cookie +
 * api.bilibili.com is already the optimal route. v0.1 ships anyway as a
 * fallback for offline-mode / heavy-throttle scenarios.
 *
 * Mirror of path C `social-bilibili-adb` Node side, but Mode B output
 * follows `social-bilibili` snapshot mode (kinds: history / favourite
 * / dynamic / follow, schemaVersion=1).
 *
 * **v0.1 schema status**: DB filename + table names are best-effort
 * guesses pending real-device 探测 (P7.2.0). The defensive PRAGMA
 * table_info + column-candidate picker handles known drift; if all
 * candidate names miss, returns SourceDbMissing or empty tables with
 * a schema-drift warning.
 *
 * Pipeline:
 *   1. uid from [BilibiliRootCredentialsStore]
 *   2. [RootShellRunner.isSuAvailable] gate → NoRoot if false
 *   3. Try candidate DB filenames in priority order; first existing
 *      file wins → [DbCohortCopier.copy] pulls main+WAL+SHM
 *   4. SQLiteDatabase opens local copy read-only
 *   5. parseHistory + parseFavourite + parseFollow each with
 *      PRAGMA-based defensive column picking
 *   6. Write staging JSON matching social-bilibili schemaVersion=1
 *
 * Test seam: [openDatabase] is a `var` for JVM unit tests; [lsDatabaseDir]
 * is also injectable.
 */
@Singleton
class BilibiliRootDbExtractor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: BilibiliRootCredentialsStore,
    private val runner: RootShellRunner,
    private val cohortCopier: DbCohortCopier,
) {

    sealed class ExtractResult {
        data class Ok(
            val stagingJsonPath: String,
            val historyCount: Int,
            val favouriteCount: Int,
            val followCount: Int,
            val totalRows: Int,
            val extractedAtMs: Long,
            val dbFilename: String,
            val hadHistoryTable: Boolean,
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

        val availableDbs = lsDatabaseDir(BILIBILI_DB_REMOTE_DIR)
        val pickedDb = DB_FILENAME_CANDIDATES.firstOrNull { it in availableDbs }
            ?: return@withContext ExtractResult.SourceDbMissing
        val remoteDb = "$BILIBILI_DB_REMOTE_DIR/$pickedDb"

        val stagingDir = File(
            context.cacheDir,
            "bilibili-root-staging-${System.currentTimeMillis()}",
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
            Timber.w(t, "BilibiliRootDbExtractor: SQLite open failed for %s", localDb.absolutePath)
            cohortCopier.cleanup(localDb)
            stagingDir.deleteRecursively()
            return@withContext ExtractResult.Failed(
                reason = "open-error",
                message = t.message ?: t.javaClass.simpleName,
            )
        }

        try {
            val warnings = mutableListOf<String>()
            val (history, hadHistoryTable) = parseHistory(db, warnings)
            val (favourites, hadFavouriteTable) = parseFavourite(db, warnings)
            val (follows, hadFollowTable) = parseFollow(db, warnings)

            val snapshottedAt = System.currentTimeMillis()
            val json = assembleSnapshotJson(
                uid = uid,
                snapshottedAt = snapshottedAt,
                history = history,
                favourites = favourites,
                follows = follows,
            )
            val stagingJson = File(stagingDir, STAGING_JSON_NAME)
            stagingJson.writeText(json.toString(), Charsets.UTF_8)

            ExtractResult.Ok(
                stagingJsonPath = stagingJson.absolutePath,
                historyCount = history.size,
                favouriteCount = favourites.size,
                followCount = follows.size,
                totalRows = history.size + favourites.size + follows.size,
                extractedAtMs = snapshottedAt,
                dbFilename = pickedDb,
                hadHistoryTable = hadHistoryTable,
                hadFavouriteTable = hadFavouriteTable,
                hadFollowTable = hadFollowTable,
                schemaDriftWarnings = warnings.toList(),
            )
        } catch (t: Throwable) {
            Timber.e(t, "BilibiliRootDbExtractor: parse/dump failed")
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
     * Parse view history. Column candidates (first match wins):
     *   - bvid: bvid / bv_id (preferred over avid since 2020-03)
     *   - avid: avid / av_id / aid (legacy, optional but preferred for older accounts)
     *   - title: title / video_title / display_title
     *   - viewAt: view_at / create_at / time / timestamp (required for ordering)
     *   - duration: duration / progress / total_time (optional)
     *   - uploader: uploader / up_name / mid_name (optional)
     */
    private fun parseHistory(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<HistoryRow>, Boolean> {
        val candidateTables = listOf("history", "view_history", "play_history", "video_history")
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val bvidCol = pickCol(columns, listOf("bvid", "bv_id"))
        val avidCol = pickCol(columns, listOf("avid", "av_id", "aid"))
        val timeCol = pickCol(columns, listOf("view_at", "create_at", "time", "timestamp"))
        if ((bvidCol == null && avidCol == null) || timeCol == null) {
            warnings.add(
                "$table missing required columns (bvid/avid + time); have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val titleCol = pickCol(columns, listOf("title", "video_title", "display_title"))
        val durCol = pickCol(columns, listOf("duration", "progress", "total_time"))
        val uploaderCol = pickCol(columns, listOf("uploader", "up_name", "mid_name"))

        val selectFields = mutableListOf("$timeCol AS viewAt")
        if (bvidCol != null) selectFields.add("$bvidCol AS bvid")
        if (avidCol != null) selectFields.add("$avidCol AS avid")
        if (titleCol != null) selectFields.add("$titleCol AS title")
        if (durCol != null) selectFields.add("$durCol AS duration")
        if (uploaderCol != null) selectFields.add("$uploaderCol AS uploader")

        val sql =
            "SELECT ${selectFields.joinToString(", ")} FROM $table ORDER BY $timeCol DESC LIMIT $LIMIT_HISTORY"

        val rows = mutableListOf<HistoryRow>()
        val cursor: Cursor = try {
            db.rawQuery(sql, null)
        } catch (t: Throwable) {
            warnings.add("$table query failed: ${t.message ?: t.javaClass.simpleName}")
            return Pair(emptyList(), true)
        }
        cursor.use { c ->
            val idxBvid = c.getColumnIndex("bvid")
            val idxAvid = c.getColumnIndex("avid")
            val idxTime = c.getColumnIndex("viewAt")
            val idxTitle = c.getColumnIndex("title")
            val idxDur = c.getColumnIndex("duration")
            val idxUploader = c.getColumnIndex("uploader")
            while (c.moveToNext()) {
                val bvid = if (idxBvid >= 0) safeGetString(c, idxBvid) else null
                val avid = if (idxAvid >= 0) safeGetLong(c, idxAvid) else null
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                if (bvid.isNullOrBlank() && (avid == null || avid <= 0)) continue
                rows.add(
                    HistoryRow(
                        bvid = bvid,
                        avid = avid,
                        viewAtMs = time?.let { normalizeEpochMs(it) },
                        title = if (idxTitle >= 0) c.getString(idxTitle) else null,
                        duration = if (idxDur >= 0 && !c.isNull(idxDur)) c.getInt(idxDur) else null,
                        uploader = if (idxUploader >= 0) c.getString(idxUploader) else null,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    /**
     * Parse favourite (收藏). Column candidates:
     *   - bvid / avid (one required)
     *   - savedAt: save_time / fav_time / time (optional for ordering)
     *   - title / video_title
     *   - folderName: folder_name / fav_folder_name (optional)
     *   - uploader: uploader / up_name
     */
    private fun parseFavourite(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<FavouriteRow>, Boolean> {
        val candidateTables = listOf("favourite", "favorite", "favorite_view", "fav")
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val bvidCol = pickCol(columns, listOf("bvid", "bv_id"))
        val avidCol = pickCol(columns, listOf("avid", "av_id", "aid", "fav_id"))
        if (bvidCol == null && avidCol == null) {
            warnings.add(
                "$table missing bvid/avid columns; have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val timeCol = pickCol(columns, listOf("save_time", "fav_time", "time", "create_time"))
        val titleCol = pickCol(columns, listOf("title", "video_title"))
        val folderCol = pickCol(columns, listOf("folder_name", "fav_folder_name"))
        val uploaderCol = pickCol(columns, listOf("uploader", "up_name"))

        val selectFields = mutableListOf<String>()
        if (bvidCol != null) selectFields.add("$bvidCol AS bvid")
        if (avidCol != null) selectFields.add("$avidCol AS avid")
        if (timeCol != null) selectFields.add("$timeCol AS savedAt")
        if (titleCol != null) selectFields.add("$titleCol AS title")
        if (folderCol != null) selectFields.add("$folderCol AS folderName")
        if (uploaderCol != null) selectFields.add("$uploaderCol AS uploader")

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
            val idxBvid = c.getColumnIndex("bvid")
            val idxAvid = c.getColumnIndex("avid")
            val idxTime = c.getColumnIndex("savedAt")
            val idxTitle = c.getColumnIndex("title")
            val idxFolder = c.getColumnIndex("folderName")
            val idxUploader = c.getColumnIndex("uploader")
            while (c.moveToNext()) {
                val bvid = if (idxBvid >= 0) safeGetString(c, idxBvid) else null
                val avid = if (idxAvid >= 0) safeGetLong(c, idxAvid) else null
                if (bvid.isNullOrBlank() && (avid == null || avid <= 0)) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    FavouriteRow(
                        bvid = bvid,
                        avid = avid,
                        savedAtMs = time?.let { normalizeEpochMs(it) },
                        title = if (idxTitle >= 0) c.getString(idxTitle) else null,
                        folderName = if (idxFolder >= 0) c.getString(idxFolder) else null,
                        uploader = if (idxUploader >= 0) c.getString(idxUploader) else null,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    /**
     * Parse follow (关注). Column candidates:
     *   - followedMid: mid / followed_mid / target_mid (required)
     *   - name: name / uname / nickname
     *   - followedAt: follow_time / time / create_time
     *   - face: face / avatar
     */
    private fun parseFollow(
        db: SQLiteDatabase,
        warnings: MutableList<String>,
    ): Pair<List<FollowRow>, Boolean> {
        val candidateTables = listOf("follow", "followed", "subscription", "up_follow")
        val (table, columns) = findTable(db, candidateTables)
            ?: return Pair(emptyList(), false)
        val midCol = pickCol(columns, listOf("mid", "followed_mid", "target_mid", "up_mid"))
        if (midCol == null) {
            warnings.add(
                "$table missing mid column; have: ${columns.joinToString(",")}",
            )
            return Pair(emptyList(), true)
        }
        val nameCol = pickCol(columns, listOf("name", "uname", "nickname"))
        val timeCol = pickCol(columns, listOf("follow_time", "time", "create_time"))
        val faceCol = pickCol(columns, listOf("face", "avatar"))

        val selectFields = mutableListOf("$midCol AS followedMid")
        if (nameCol != null) selectFields.add("$nameCol AS name")
        if (timeCol != null) selectFields.add("$timeCol AS followedAt")
        if (faceCol != null) selectFields.add("$faceCol AS face")

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
            val idxMid = c.getColumnIndex("followedMid")
            val idxName = c.getColumnIndex("name")
            val idxTime = c.getColumnIndex("followedAt")
            val idxFace = c.getColumnIndex("face")
            while (c.moveToNext()) {
                val mid = if (idxMid >= 0) safeGetLong(c, idxMid) else null
                if (mid == null || mid <= 0) continue
                val time = if (idxTime >= 0) safeGetLong(c, idxTime) else null
                rows.add(
                    FollowRow(
                        followedMid = mid.toString(),
                        name = if (idxName >= 0) c.getString(idxName) else null,
                        followedAtMs = time?.let { normalizeEpochMs(it) },
                        face = if (idxFace >= 0) c.getString(idxFace) else null,
                    ),
                )
            }
        }
        return Pair(rows, true)
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    /**
     * Probe a list of candidate table names; return the first one that
     * exists with the column set. Bilibili schemas vary by app version
     * — defensive lookup is essential.
     */
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
            Timber.d(t, "BilibiliRootDbExtractor: PRAGMA table_info(%s) failed", table)
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

    /** Normalize epoch — Bilibili stores some times as seconds, others ms. */
    private fun normalizeEpochMs(v: Long): Long =
        if (v in 1_000_000_000L..9_999_999_999L) v * 1000L else v

    /**
     * Assemble staging JSON matching social-bilibili SNAPSHOT_SCHEMA_VERSION=1.
     * Mirrors Node-side `social-bilibili/adapter.js`:_syncViaSnapshot byte-for-byte.
     * Same kinds (history / favourite / follow — `dynamic` requires API
     * data not in local DB, defer to path A only).
     */
    private fun assembleSnapshotJson(
        uid: String,
        snapshottedAt: Long,
        history: List<HistoryRow>,
        favourites: List<FavouriteRow>,
        follows: List<FollowRow>,
    ): JSONObject {
        val account = JSONObject().apply {
            put("uid", uid)
            put("displayName", "")
        }
        val events = JSONArray()

        history.forEach { h ->
            val idPart = h.bvid ?: h.avid?.toString() ?: "unknown"
            val ev = JSONObject().apply {
                put("kind", "history")
                put("id", "history-$idPart")
                put("capturedAt", h.viewAtMs ?: snapshottedAt)
                put("bvid", h.bvid ?: JSONObject.NULL)
                put("avid", h.avid ?: JSONObject.NULL)
                put("title", h.title ?: JSONObject.NULL)
                put("duration", h.duration ?: 0)
                put("uploader", h.uploader ?: JSONObject.NULL)
            }
            events.put(ev)
        }
        favourites.forEach { f ->
            val idPart = f.bvid ?: f.avid?.toString() ?: "unknown"
            val ev = JSONObject().apply {
                put("kind", "favourite")
                put("id", "fav-$idPart")
                put("capturedAt", f.savedAtMs ?: snapshottedAt)
                put("bvid", f.bvid ?: JSONObject.NULL)
                put("avid", f.avid ?: JSONObject.NULL)
                put("title", f.title ?: JSONObject.NULL)
                put("folderName", f.folderName ?: JSONObject.NULL)
                put("uploader", f.uploader ?: JSONObject.NULL)
            }
            events.put(ev)
        }
        follows.forEach { f ->
            val ev = JSONObject().apply {
                put("kind", "follow")
                put("id", "follow-${f.followedMid}")
                put("capturedAt", f.followedAtMs ?: snapshottedAt)
                put("followedMid", f.followedMid)
                put("name", f.name ?: JSONObject.NULL)
                put("face", f.face ?: JSONObject.NULL)
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
            Timber.d(t, "BilibiliRootDbExtractor: ls %s failed", dir)
            emptySet()
        }
    }

    // ─── Internal row DTOs ──────────────────────────────────────────────

    internal data class HistoryRow(
        val bvid: String?,
        val avid: Long?,
        val viewAtMs: Long?,
        val title: String?,
        val duration: Int?,
        val uploader: String?,
    )

    internal data class FavouriteRow(
        val bvid: String?,
        val avid: Long?,
        val savedAtMs: Long?,
        val title: String?,
        val folderName: String?,
        val uploader: String?,
    )

    internal data class FollowRow(
        val followedMid: String,
        val name: String?,
        val followedAtMs: Long?,
        val face: String?,
    )

    companion object {
        const val BILIBILI_DB_REMOTE_DIR =
            "/data/data/tv.danmaku.bili/databases"

        /**
         * v0.1 candidate DB filenames in priority order — best-effort
         * guesses pending P7.2.0 real-device 探测. Update once user runs
         * `adb shell su -c "ls /data/data/tv.danmaku.bili/databases/"`.
         */
        val DB_FILENAME_CANDIDATES: List<String> = listOf(
            "bili.db",
            "biliCommunity.db",
            "bplus.db",
            "history.db",
            "favourite.db",
            "follow.db",
        )

        const val STAGING_JSON_NAME = "social-bilibili-root.json"
        const val SNAPSHOT_SCHEMA_VERSION = 1
        const val LIMIT_HISTORY = 5_000
        const val LIMIT_FAVOURITE = 2_000
        const val LIMIT_FOLLOW = 5_000
    }
}
