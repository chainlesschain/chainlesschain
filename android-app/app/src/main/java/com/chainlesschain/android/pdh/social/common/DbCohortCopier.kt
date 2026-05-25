package com.chainlesschain.android.pdh.social.common

import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase B0 — SQLite WAL-cohort copy via su, lifted from the
 * byte-identical `copyDbCohortViaSu` implementations in
 * WeChatDbExtractor and QQDbExtractor.
 *
 * WAL/SHM coupling is Trap 7 (handbook #7) — copying only the main DB
 * misses messages flushed to `.db-wal` but not yet checkpointed back
 * to the main file. The cohort copy mirrors all three files atomically
 * (best-effort: wal/shm may be absent if the target app checkpointed
 * recently — that's not a failure).
 *
 * Mode 0644 is required because `su cp` preserves the source file's
 * owner (the target app's `u0_a<n>`), so without chmod the next read
 * from our own UID fails with EACCES.
 *
 * Path safety: the [srcDb] arg is interpolated into a shell command
 * via `su -c "..."`. Callers MUST validate it contains no shell
 * metacharacters — typical usage is a hard-coded path like
 * `"/data/data/com.example/databases/foo.db"` derived from package
 * manager, not user input. [validateSourcePath] enforces this.
 */
@Singleton
class DbCohortCopier @Inject constructor(
    private val runner: RootShellRunner,
) {

    /**
     * Copy [srcDb] + its sibling `-wal` + `-shm` into [dstDb] (must be
     * absolute path under the app's writable area). Returns
     * Result.failure on:
     *  - root not available
     *  - shell command non-zero exit
     *  - [srcDb] failing [validateSourcePath]
     *
     * Caller is responsible for cleaning up partial copies on failure.
     */
    fun copy(srcDb: String, dstDb: File, timeoutMs: Long = 30_000L): Result<Unit> {
        val validation = validateSourcePath(srcDb)
        if (validation != null) {
            return Result.failure(IllegalArgumentException(validation))
        }
        if (!runner.isSuAvailable()) {
            return Result.failure(IllegalStateException("su not available"))
        }
        val dstPath = dstDb.absolutePath
        val walSrc = "$srcDb-wal"
        val shmSrc = "$srcDb-shm"
        val script = buildScript(srcDb, dstPath, walSrc, shmSrc)
        return if (runner.exec(script, timeoutMs)) {
            Result.success(Unit)
        } else {
            Timber.w("DbCohortCopier: su cp pipeline returned non-zero for %s → %s", srcDb, dstPath)
            Result.failure(RuntimeException("su cp pipeline returned non-zero"))
        }
    }

    /**
     * Best-effort cleanup. Deletes [dstDb] + its `-wal` + `-shm`
     * siblings if they exist. Never throws — used in `finally`-style
     * error recovery so a failed copy leaves no half-state on disk.
     */
    fun cleanup(dstDb: File) {
        try {
            dstDb.takeIf { it.exists() }?.delete()
            File(dstDb.absolutePath + "-wal").takeIf { it.exists() }?.delete()
            File(dstDb.absolutePath + "-shm").takeIf { it.exists() }?.delete()
        } catch (t: Throwable) {
            Timber.w(t, "DbCohortCopier.cleanup failed (non-fatal)")
        }
    }

    companion object {
        /**
         * Reject obvious shell-injection vectors. Production callers
         * pass hard-coded paths (e.g. `/data/data/<known-pkg>/databases/<known-file>`)
         * so anything containing `;` `|` `&` `$` `` ` `` `(` `)` `<` `>`
         * `'` `"` `\n` `\r` is a programming error.
         */
        internal fun validateSourcePath(path: String): String? {
            if (path.isBlank()) return "srcDb must not be blank"
            if (!path.startsWith("/")) return "srcDb must be an absolute path"
            val dangerous = setOf(';', '|', '&', '$', '`', '(', ')', '<', '>', '\'', '"', '\n', '\r')
            for (c in path) {
                if (c in dangerous) {
                    return "srcDb contains disallowed char '$c' — refusing shell injection"
                }
            }
            return null
        }

        internal fun buildScript(srcDb: String, dstPath: String, walSrc: String, shmSrc: String): String =
            buildString {
                append("cp $srcDb $dstPath && chmod 644 $dstPath")
                append(" ; if [ -f $walSrc ] ; then cp $walSrc ${dstPath}-wal && chmod 644 ${dstPath}-wal ; fi")
                append(" ; if [ -f $shmSrc ] ; then cp $shmSrc ${dstPath}-shm && chmod 644 ${dstPath}-shm ; fi")
            }
    }
}
