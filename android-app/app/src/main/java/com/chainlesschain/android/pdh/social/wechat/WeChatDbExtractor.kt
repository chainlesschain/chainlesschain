package com.chainlesschain.android.pdh.social.wechat

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.zetetic.database.sqlcipher.SQLiteConnection
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteDatabaseHook
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 12.10.3 — copies the encrypted WeChat database off `/data/data/
 * com.tencent.mm/MicroMsg/<md5-uin>/EnMicroMsg.db` and dumps raw rows to
 * a staging JSON the desktop wechat adapter can normalize via `cc hub
 * sync-adapter wechat --input <staging.json>`.
 *
 * **Key flow** (mirrors desktop `packages/personal-data-hub/lib/adapters/
 * wechat/db-reader.js` `KNOWN_PRAGMA_PROFILES` 1:1):
 *
 *   - 7.x md5 path: 7-char hex from MD5(imei+uin)[:7] (sjqz parity —
 *     `C:\code\sjqz\src\mobile_forensics\parsers\wechat_decrypt.py:
 *     calculate_wechat_key`). IMEI auto-detect on Android 10+ is gated
 *     behind READ_PHONE_STATE which is restricted, so user supplies IMEI
 *     manually via the login dialog. Key is re-derived every extract —
 *     never cached — so changing devices doesn't strand a stale key.
 *
 *   - 8.x frida path: 64-char hex (32 raw bytes) captured by frida
 *     sqlite3_key_v2 hook (Phase 12.10.4) and persisted in CredentialsStore.
 *     Per user real-device experience: this is the more reliable path
 *     in practice — IMEI READ_PHONE_STATE restrictions on modern Android
 *     make md5 path frequently impractical.
 *
 * **PRAGMA profile fallback** (3-profile loop matches desktop):
 *
 *   1. wcdb-legacy (WeChat <8.0): cipher_compatibility=1, kdf_iter=4000,
 *      use_hmac=OFF, page_size=1024 — applied in preKey hook BEFORE the key
 *      derivation runs, else SQLCipher defaults to v4 KDF (256_000 iter)
 *      and the open succeeds silently but every SELECT throws "file is
 *      not a database".
 *   2. sqlcipher-v3 (some PC WeChat builds): cipher_compatibility=3,
 *      kdf_iter=64000
 *   3. sqlcipher-v4 (newest SQLCipher default): cipher_compatibility=4
 *
 * Each profile opens, sets PRAGMAs, probes `SELECT count(*) FROM
 * sqlite_master`. On probe failure, close + try next profile.
 *
 * **WAL + SHM cohort copy** (Trap 7 from design doc): SQLite's WAL mode
 * means recent writes live in `.db-wal` until checkpoint. Copying only
 * `.db` strands those writes — either we get stale data, or the WAL header
 * mismatch crashes the open as "database corrupt". We copy all 3 files
 * (`.db`, `.db-wal`, `.db-shm`) atomically and trust SQLCipher to
 * checkpoint on open.
 *
 * **STATUS**: real impl. Requires:
 *   - `net.zetetic:sqlcipher-android:4.12.0` (already in core-database deps)
 *   - Magisk-su for cross-user file copy
 *   - Phase 12.10.4 frida injection if keyProvider="frida" (this class
 *     consumes the persisted key only)
 *
 * Test seam: [openDatabase] is a var so unit tests can swap in a fake
 * SQLiteDatabase factory. Cohort copy via [suExec] is also a var.
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
            /** Diagnostic — which PRAGMA profile actually opened the DB. */
            val pragmaProfile: String,
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
     * Run the full extract pipeline. Returns within a few seconds on
     * success; up to ~30s on cohort copy + DB open failure path.
     */
    suspend fun extract(): ExtractResult = withContext(Dispatchers.IO) {
        val uin = credentialsStore.getUin()
            ?: return@withContext ExtractResult.NoCredentials

        val keyProvider = credentialsStore.getKeyProvider() ?: "frida"
        val keyMaterial = when (keyProvider) {
            "md5" -> {
                val imei = credentialsStore.getImei()
                    ?: return@withContext ExtractResult.Failed(
                        "missing-imei",
                        "keyProvider=md5 requires imei (re-enter via login dialog)",
                    )
                val derived = calculateMd5Key(imei, uin)
                KeyMaterial.Text(derived)
            }
            "frida" -> {
                val hex = credentialsStore.getDbKeyHex()
                    ?: return@withContext ExtractResult.NoDbKey
                if (hex.length != 64 || !hex.all { it.isHexDigit() }) {
                    return@withContext ExtractResult.Failed(
                        "bad-key-hex",
                        "dbKeyHex must be 64 hex chars; got ${hex.length}",
                    )
                }
                KeyMaterial.RawHex(hex.lowercase())
            }
            else -> return@withContext ExtractResult.Failed(
                "bad-key-provider",
                "unknown keyProvider: $keyProvider",
            )
        }

        // 1. Locate source DB. WeChat user dir is MD5("mm$uin")[:32] —
        //    full 32 chars (not the 7-char key prefix). Cf. WeChatLocalCollector
        //    docstring + sjqz find_uin_from_files comment.
        val srcDirMd5 = md5("mm$uin")
        val srcDir = "/data/data/com.tencent.mm/MicroMsg/$srcDirMd5"
        val srcDb = "$srcDir/EnMicroMsg.db"

        // Kotlin disallows named arguments for function types (var suExec
        // is a (String, Long) -> Boolean lambda) — pass positionally.
        if (!suExec("test -f $srcDb", 5_000)) {
            return@withContext ExtractResult.SourceDbMissing
        }

        // 2. Copy DB cohort (main + wal + shm) into app cache via su.
        val stagingRoot = File(context.cacheDir, "wechat-staging").also { it.mkdirs() }
        val stagingDb = File(stagingRoot, "EnMicroMsg.db").also { if (it.exists()) it.delete() }
        val cohortCopyResult = copyDbCohortViaSu(srcDb, stagingRoot)
        if (cohortCopyResult.isFailure) {
            val err = cohortCopyResult.exceptionOrNull()
            return@withContext if (err?.message?.contains("su not available", ignoreCase = true) == true) {
                ExtractResult.NoRoot
            } else {
                ExtractResult.CopyFailed(err?.message ?: "unknown copy error")
            }
        }

        // 3. Try opening with each PRAGMA profile until one decrypts.
        val openResult = tryOpenWithProfiles(stagingDb, keyMaterial)
        val (db, profileName) = when (openResult) {
            is OpenAttempt.Ok -> openResult.db to openResult.profile.name
            is OpenAttempt.Failed -> {
                // Clean up staging on decrypt failure to avoid disk leak.
                stagingRoot.deleteRecursively()
                return@withContext ExtractResult.DecryptFailed(
                    "all ${KNOWN_PRAGMA_PROFILES.size} pragma profiles failed; last: " +
                        openResult.lastError,
                )
            }
        }

        try {
            // 4. Dump tables to staging JSON.
            val stagingJson = File(stagingRoot, "wechat-staging.json")
            val counts = dumpTables(db, stagingJson, srcVersion = profileName)
            val nowMs = System.currentTimeMillis()

            ExtractResult.Ok(
                stagingJsonPath = stagingJson.absolutePath,
                contactCount = counts.contacts,
                messageCount = counts.messages,
                chatroomCount = counts.chatrooms,
                totalRows = counts.total,
                extractedAtMs = nowMs,
                pragmaProfile = profileName,
            )
        } catch (t: Throwable) {
            Timber.e(t, "WeChatDbExtractor: dumpTables failed (profile=$profileName)")
            ExtractResult.Failed("dump-failed", t.message)
        } finally {
            try { db.close() } catch (_: Throwable) { /* ignore */ }
            // Wipe encrypted staging db (key material implied). Keep JSON for
            // the caller (WeChatLocalCollector hands it to cc syncAdapter).
            try { stagingDb.delete() } catch (_: Throwable) { /* ignore */ }
            File(stagingRoot, "EnMicroMsg.db-wal").takeIf { it.exists() }?.delete()
            File(stagingRoot, "EnMicroMsg.db-shm").takeIf { it.exists() }?.delete()
        }
    }

    // ─── Key derivation (sjqz wechat_decrypt.py:calculate_wechat_key) ───────

    sealed class KeyMaterial {
        /** 7.x md5 path — 7-char lowercase hex, PBKDF2-derived by SQLCipher. */
        data class Text(val key: String) : KeyMaterial()
        /** 8.x frida path — 64-char hex, decoded to 32 raw bytes (no KDF). */
        data class RawHex(val hex: String) : KeyMaterial()
    }

    /**
     * MD5(imei + uin)[:7] lowercase. Byte-identical to sjqz
     * `wechat_decrypt.py:calculate_wechat_key(imei, uin)`. Visible for
     * testing — unit test compares against sjqz reference vectors.
     */
    internal fun calculateMd5Key(imei: String, uin: String): String {
        val raw = imei + uin
        val md5 = MessageDigest.getInstance("MD5").digest(raw.toByteArray(Charsets.UTF_8))
        val hex = md5.joinToString("") { "%02x".format(it) }
        return hex.substring(0, 7).lowercase()
    }

    // ─── PRAGMA profile fallback (mirrors desktop KNOWN_PRAGMA_PROFILES) ────

    /**
     * A SQLCipher cipher-compatibility profile. Each profile lists the
     * pragmas to execute BEFORE the key takes effect — they affect KDF
     * iteration count, HMAC usage, and page size which all participate in
     * key derivation. Setting them after the key is set is a no-op (or
     * worse, silently uses defaults and the open succeeds but every SELECT
     * throws).
     */
    data class PragmaProfile(val name: String, val preKeyPragmas: List<String>)

    private val knownProfiles: List<PragmaProfile> get() = KNOWN_PRAGMA_PROFILES

    private sealed class OpenAttempt {
        data class Ok(val db: SQLiteDatabase, val profile: PragmaProfile) : OpenAttempt()
        data class Failed(val lastError: String) : OpenAttempt()
    }

    private fun tryOpenWithProfiles(
        stagingDb: File,
        keyMaterial: KeyMaterial,
    ): OpenAttempt {
        ensureNativeLibsLoaded()
        var lastError: String? = null
        for (profile in knownProfiles) {
            val attempted = AtomicBoolean(false)
            try {
                // SQLCipher 4.12 (net.zetetic) — hook callbacks now receive
                // SQLiteConnection (not SQLiteDatabase). execSQL → execute with
                // null bindArgs + null CancellationSignal.
                val hook = object : SQLiteDatabaseHook {
                    override fun preKey(db: SQLiteConnection) {
                        attempted.set(true)
                        for (p in profile.preKeyPragmas) {
                            db.execute(p, null, null)
                        }
                    }
                    override fun postKey(db: SQLiteConnection) { /* no-op */ }
                }
                val pwdBytes = when (keyMaterial) {
                    // SQLCipher PBKDF2-derives 7-char hex into the AES key
                    // via the profile's KDF settings.
                    is KeyMaterial.Text -> keyMaterial.key.toByteArray(Charsets.UTF_8)
                    // For raw 32-byte key path SQLCipher needs the "x'...'"
                    // syntax to skip KDF entirely. We pass the bracket-encoded
                    // bytes as the password — net.zetetic will pass them
                    // through verbatim and SQLCipher's key parser recognizes
                    // the hex literal.
                    is KeyMaterial.RawHex -> "x'${keyMaterial.hex}'".toByteArray(Charsets.UTF_8)
                }
                val db = openDatabase(stagingDb.absolutePath, pwdBytes, hook)
                // Probe — if KDF was wrong, open succeeds silently but
                // sqlite_master throws "file is not a database".
                val cursor = db.rawQuery("SELECT count(*) FROM sqlite_master", null)
                cursor.use { c ->
                    val ok = c.moveToFirst() && c.getInt(0) >= 0
                    if (ok) {
                        return OpenAttempt.Ok(db, profile)
                    }
                }
                db.close()
                lastError = "profile=${profile.name} probe returned no rows"
            } catch (t: Throwable) {
                lastError = "profile=${profile.name} ${t.javaClass.simpleName}: ${t.message}"
                Timber.d("WeChatDbExtractor: profile %s failed: %s", profile.name, t.message)
            }
        }
        return OpenAttempt.Failed(lastError ?: "no profiles attempted")
    }

    /** Test seam — overridden in unit tests to inject a fake driver. */
    internal var openDatabase: (path: String, pwd: ByteArray, hook: SQLiteDatabaseHook) -> SQLiteDatabase =
        { path, pwd, hook ->
            SQLiteDatabase.openDatabase(
                path,
                pwd,
                null /* cursor factory */,
                SQLiteDatabase.OPEN_READONLY,
                null /* error handler */,
                hook,
            )
        }

    private val nativeLibLoaded = AtomicBoolean(false)
    private fun ensureNativeLibsLoaded() {
        if (nativeLibLoaded.compareAndSet(false, true)) {
            try {
                System.loadLibrary("sqlcipher")
            } catch (t: Throwable) {
                Timber.w(t, "WeChatDbExtractor: System.loadLibrary(sqlcipher) failed — possibly already loaded by core-database")
            }
        }
    }

    // ─── su-backed file ops (Trap 7 cohort copy) ────────────────────────────

    /**
     * Copy `srcDb` + its `-wal` + `-shm` siblings into [dstDir]. Returns
     * Result.failure with "su not available" if root isn't accessible.
     *
     * Mode `0644` lets the app's UID read the file after copy (su cp would
     * keep WeChat's `u0_a<n>` ownership otherwise).
     */
    internal fun copyDbCohortViaSu(srcDb: String, dstDir: File): Result<Unit> {
        if (!isSuAvailable()) {
            return Result.failure(IllegalStateException("su not available"))
        }
        val dstPath = File(dstDir, "EnMicroMsg.db").absolutePath
        val walSrc = "$srcDb-wal"
        val shmSrc = "$srcDb-shm"
        // Best-effort: -wal/-shm may not exist if WeChat checkpointed
        // recently. We don't gate on them.
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
        Timber.d(t, "WeChatDbExtractor: su availability probe failed")
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
                Timber.w("WeChatDbExtractor: suExec failed (exit=${proc.exitValue()}): %s", tail)
            }
            ok
        }
    } catch (t: Throwable) {
        Timber.w(t, "WeChatDbExtractor: suExec threw")
        false
    }

    // ─── Row dump ───────────────────────────────────────────────────────────

    private data class RowCounts(val contacts: Int, val messages: Int, val chatrooms: Int) {
        val total: Int get() = contacts + messages + chatrooms
    }

    /**
     * Dump the 3 PDH-relevant WeChat tables to a staging JSON the desktop
     * adapter consumes via `cc hub sync-adapter wechat --input <path>`.
     *
     * Schema is intentionally **raw** — column names match the WeChat DB
     * 1:1 (modulo case-drift defence via [resolveColumn]). The desktop
     * `packages/personal-data-hub/lib/adapters/wechat/normalize.js`
     * canonicalizes into Person/Event/Item entities; doing it on Android
     * would split the truth source 2-way and drift (per design doc §1
     * "复用策略").
     *
     * Output shape:
     *   {
     *     "version": "12.10.3",
     *     "pragmaProfile": "wcdb-legacy",
     *     "extractedAtMs": 1716383021000,
     *     "tables": {
     *       "rcontact":  [ { "username": "...", ... }, ... ],
     *       "message":   [ ... ],
     *       "chatroom":  [ ... ]
     *     }
     *   }
     */
    private fun dumpTables(
        db: SQLiteDatabase,
        out: File,
        srcVersion: String,
    ): RowCounts {
        val tablesArr = JSONObject()

        // rcontact — desktop db-reader.js fetchContacts() filter parity
        // (skip @stranger + fake_* per sjqz wechat.py:262-263).
        val rcontactCols = listOf("username", "alias", "nickname", "conRemark", "type")
        val contactRows = queryRows(
            db,
            table = "rcontact",
            wantedCols = rcontactCols,
            limit = 5000,
            where = "username NOT LIKE '%@stranger' AND username NOT LIKE 'fake_%'",
        )
        tablesArr.put("rcontact", JSONArray(contactRows))

        // message — sjqz/desktop schema
        val messageCols = listOf("msgId", "msgSvrId", "talker", "content", "type", "createTime", "isSend", "status")
        val messageRows = queryRows(
            db,
            table = "message",
            wantedCols = messageCols,
            limit = 10_000,
            orderBy = "msgSvrId ASC",
        )
        tablesArr.put("message", JSONArray(messageRows))

        // chatroom — group chats
        val chatroomCols = listOf("chatroomname", "memberlist", "displayname", "roomowner")
        val chatroomRows = queryRows(
            db,
            table = "chatroom",
            wantedCols = chatroomCols,
            limit = 1000,
        )
        tablesArr.put("chatroom", JSONArray(chatroomRows))

        val root = JSONObject().apply {
            put("version", "12.10.3")
            put("pragmaProfile", srcVersion)
            put("extractedAtMs", System.currentTimeMillis())
            put("tables", tablesArr)
        }
        out.writeText(root.toString(2), Charsets.UTF_8)

        return RowCounts(
            contacts = contactRows.size,
            messages = messageRows.size,
            chatrooms = chatroomRows.size,
        )
    }

    /**
     * Resolve column names via `PRAGMA table_info` so case-drift across
     * WeChat versions doesn't blow up the SELECT with "no such column".
     * Missing columns are silently skipped (logged at debug) — caller
     * adjusts schema expectations as new WeChat builds ship.
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
            Timber.w(t, "WeChatDbExtractor: PRAGMA table_info($table) failed — table missing?")
            return emptyList()
        }
        if (actualMap.isEmpty()) return emptyList()

        val resolved = wantedCols.mapNotNull { wanted ->
            val actual = actualMap[wanted.lowercase()]
            if (actual == null) {
                Timber.d("WeChatDbExtractor: $table missing column $wanted (have: ${actualMap.values.joinToString()})")
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
                        when (c.getType(idx)) {
                            android.database.Cursor.FIELD_TYPE_NULL -> obj.put(col, JSONObject.NULL)
                            android.database.Cursor.FIELD_TYPE_INTEGER -> obj.put(col, c.getLong(idx))
                            android.database.Cursor.FIELD_TYPE_FLOAT -> obj.put(col, c.getDouble(idx))
                            android.database.Cursor.FIELD_TYPE_STRING -> obj.put(col, c.getString(idx))
                            android.database.Cursor.FIELD_TYPE_BLOB -> {
                                // base64 — keep raw bytes recoverable upstream
                                val blob = c.getBlob(idx)
                                obj.put(col, android.util.Base64.encodeToString(blob, android.util.Base64.NO_WRAP))
                            }
                            else -> obj.put(col, JSONObject.NULL)
                        }
                    }
                    add(obj)
                }
            }
        }
    }

    // ─── misc ───────────────────────────────────────────────────────────────

    private fun md5(input: String): String {
        val bytes = MessageDigest.getInstance("MD5").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun Char.isHexDigit(): Boolean =
        this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

    companion object {
        /**
         * SQLCipher cipher-compatibility profiles to try in order. Mirrors
         * desktop `packages/personal-data-hub/lib/adapters/wechat/db-reader.js`
         * `KNOWN_PRAGMA_PROFILES` 1:1. Order matters — wcdb-legacy first
         * because it's the most common WeChat <8.0 layout; v3 / v4 handle
         * newer/PC variants.
         */
        val KNOWN_PRAGMA_PROFILES: List<PragmaProfile> = listOf(
            PragmaProfile(
                name = "wcdb-legacy",
                preKeyPragmas = listOf(
                    "PRAGMA cipher_compatibility = 1",
                    "PRAGMA cipher_default_kdf_iter = 4000",
                    "PRAGMA cipher_default_use_hmac = OFF",
                    "PRAGMA cipher_default_page_size = 1024",
                ),
            ),
            PragmaProfile(
                name = "sqlcipher-v3",
                preKeyPragmas = listOf(
                    "PRAGMA cipher_compatibility = 3",
                    "PRAGMA cipher_default_kdf_iter = 64000",
                ),
            ),
            PragmaProfile(
                name = "sqlcipher-v4",
                preKeyPragmas = listOf(
                    "PRAGMA cipher_compatibility = 4",
                ),
            ),
        )
    }
}
