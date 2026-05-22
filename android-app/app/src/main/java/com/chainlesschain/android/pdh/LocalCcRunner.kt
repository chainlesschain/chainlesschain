package com.chainlesschain.android.pdh

import com.chainlesschain.android.feature.localterminal.LocalFilesystemBootstrapper
import com.chainlesschain.android.feature.localterminal.PtyEnvironment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Plan A v0.1 — one-shot driver around `cc hub …` for cases where we want
 * a structured JSON response rather than an interactive PTY session.
 *
 * Reuses [LocalFilesystemBootstrapper]'s `$PREFIX` layout + [PtyEnvironment]'s
 * env construction so the spawn matches what the local-terminal feature
 * uses. The cc shim at `$PREFIX/bin/cc` exec's `node chainlesschain.js`, so
 * we run it under a plain ProcessBuilder (no TTY needed for non-interactive
 * `--json` output).
 */
@Singleton
class LocalCcRunner @Inject constructor(
    private val bootstrapper: LocalFilesystemBootstrapper,
    private val ptyEnvironment: PtyEnvironment,
) {

    sealed class CcResult {
        data class Ok(val report: SyncReport, val rawJson: String) : CcResult()
        data class Failed(val reason: String, val exitCode: Int?, val stderr: String?) : CcResult()
    }

    /** Result for ask flow — see [askQuestion]. */
    sealed class AskResult {
        data class Ok(val report: AskReport, val rawJson: String) : AskResult()
        data class Failed(val reason: String, val exitCode: Int?, val stderr: String?) : AskResult()
    }

    /**
     * Parsed shape of `cc hub ask --json` stdout. Mirrors
     * AnalysisEngine.ask() return contract in
     * packages/personal-data-hub/lib/analysis.js — answer text, citations
     * pointing back at vault event ids, and llm provenance for the audit
     * trail (so users see which model answered + whether it stayed local).
     */
    data class AskReport(
        val answer: String,
        val citations: List<Citation>,
        val llmName: String?,
        val isLocal: Boolean,
        val durationMs: Long,
    ) {
        data class Citation(
            val eventId: String,
            val excerpt: String?,
            val source: String?,
        )
    }

    /**
     * `cc hub sync-adapter <name> --input <path> --json` → parsed SyncReport.
     *
     * @param adapterName which registered adapter to drive (e.g.
     *                    "system-data-android")
     * @param inputPath   path to a snapshot file the adapter reads at sync
     *                    time. Caller is responsible for writing this file
     *                    before invoking — see [LocalSystemDataSnapshotter].
     * @param timeoutMs   wall-clock budget. ~30s is plenty for 100s of
     *                    contacts + 100s of apps; bump if vault is large.
     */
    suspend fun syncAdapter(
        adapterName: String,
        inputPath: String,
        // First-run sync on device: bs3mc cold-load + LocalVault open + KG/RAG
        // derivation for ~1300 entities + EntityResolver embedding-stage
        // retries (no Ollama on device → silent-fail with network timeout
        // budget) measured 60-90s on Xiaomi 24115RA8EC 2026-05-21. 120s
        // budget gives headroom; later syncs should be much faster (vault
        // already open, embeddings cached, fewer new entities).
        timeoutMs: Long = 120_000L,
    ): CcResult = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext CcResult.Failed(
                reason = "bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}",
                exitCode = null,
                stderr = null,
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")
        if (!ccPath.exists()) {
            return@withContext CcResult.Failed(
                reason = "cc shim missing at ${ccPath.absolutePath}",
                exitCode = null,
                stderr = null,
            )
        }
        if (!mkshPath.exists()) {
            return@withContext CcResult.Failed(
                reason = "mksh shim missing at ${mkshPath.absolutePath}",
                exitCode = null,
                stderr = null,
            )
        }

        // Android W^X / SELinux: untrusted_app:s0 cannot execve a plain-text
        // script in filesDir even with +x bit (LocalPtyClient sidesteps this
        // via posix_spawn JNI in libpty_jni.so). For a plain Java
        // ProcessBuilder we instead execve mksh — its $PREFIX/bin/mksh path
        // is a symlink chain ending at nativeLibraryDir/libmksh.so, which IS
        // on the W^X whitelist — and pass cc as a *script argument*. mksh
        // reads cc as a regular file (no execve on it) and exec's $PREFIX/
        // bin/node (also a .so symlink), so the only execve syscall we make
        // is on a whitelisted library. Trap discovered via real-device 4d
        // slice 2026-05-21 (see memory android-native-lib-extract-w-x).
        val command = listOf(
            mkshPath.absolutePath,
            ccPath.absolutePath,
            "hub", "sync-adapter", adapterName,
            "--input", inputPath,
            "--json",
        )

        val envList = ptyEnvironment.envp().toList()

        val pb = ProcessBuilder(command).apply {
            // Env is a Map<String, String> — flatten PtyEnvironment.envp KEY=VALUE.
            val envMap = environment()
            envMap.clear()
            for (kv in envList) {
                val eq = kv.indexOf('=')
                if (eq > 0) envMap[kv.substring(0, eq)] = kv.substring(eq + 1)
            }
            redirectErrorStream(false)
            directory(bootstrapper.homeDir)
        }

        val process = try {
            pb.start()
        } catch (e: Exception) {
            return@withContext CcResult.Failed(
                reason = "spawn-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = null,
                stderr = null,
            )
        }

        val stdoutBuilder = StringBuilder()
        val stderrBuilder = StringBuilder()
        // Reader threads MUST catch every Throwable: when Process.waitFor()
        // reaps the child, the kernel closes its stdout/stderr FDs which
        // unblocks a thread parked in read(2) with InterruptedIOException —
        // an uncaught exception in a non-fatal Thread crashes the whole app
        // ("crashed quickly" → ActivityManager kill). Real-device repro
        // 2026-05-21 Xiaomi 24115RA8EC.
        val stdoutThread = Thread {
            try {
                process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) {
                        stdoutBuilder.append(line).append('\n')
                    }
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner: stdout reader exited via exception (likely EOF race)")
            }
        }.also { it.start() }
        val stderrThread = Thread {
            try {
                process.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) {
                        stderrBuilder.append(line).append('\n')
                    }
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner: stderr reader exited via exception (likely EOF race)")
            }
        }.also { it.start() }

        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            stdoutThread.join(500)
            stderrThread.join(500)
            return@withContext CcResult.Failed(
                reason = "timeout after ${timeoutMs}ms",
                exitCode = null,
                stderr = stderrBuilder.toString().take(2000),
            )
        }
        stdoutThread.join(2_000)
        stderrThread.join(2_000)
        val exit = process.exitValue()
        val stdout = stdoutBuilder.toString()
        val stderr = stderrBuilder.toString()

        if (exit != 0) {
            // cc hub `fail()` writes { "error": "..." } to stdout when --json,
            // but exit-code is also non-zero in that case. Surface stderr too
            // for the rare case the process died before --json could format.
            val errMsg = try {
                JSONObject(stdout.trim()).optString("error", "").takeIf { it.isNotEmpty() }
            } catch (_: Exception) {
                null
            }
            return@withContext CcResult.Failed(
                reason = errMsg ?: "cc exited with code $exit",
                exitCode = exit,
                stderr = stderr.take(2000),
            )
        }

        val report = try {
            parseSyncReport(stdout)
        } catch (e: Exception) {
            Timber.w(e, "LocalCcRunner: failed to parse cc stdout: %s", stdout.take(500))
            return@withContext CcResult.Failed(
                reason = "parse-failed: ${e.message}",
                exitCode = exit,
                stderr = stderr.take(2000),
            )
        }
        CcResult.Ok(report = report, rawJson = stdout.trim())
    }

    /** Result for destroy-vault flow. */
    sealed class DestroyResult {
        object Ok : DestroyResult()
        data class Failed(val reason: String, val exitCode: Int?) : DestroyResult()
    }

    /** Audit row shape — mirrors LocalVault.queryAudit() return. */
    data class AuditRow(
        val at: Long,
        val action: String,
        val adapter: String?,
        val eventId: String?,
    )

    sealed class RecentAuditResult {
        data class Ok(val rows: List<AuditRow>) : RecentAuditResult()
        data class Failed(val reason: String, val exitCode: Int?) : RecentAuditResult()
    }

    /**
     * `cc hub recent-audit --limit <n> --json` → 推文 §"每次操作都有账本"。
     * Returns chronologically-descending list (latest first per
     * LocalVault.queryAudit default order DESC).
     */
    suspend fun queryRecentAudit(
        limit: Int = 50,
        timeoutMs: Long = 20_000L,
    ): RecentAuditResult = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext RecentAuditResult.Failed(
                reason = "bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}",
                exitCode = null,
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")
        if (!ccPath.exists() || !mkshPath.exists()) {
            return@withContext RecentAuditResult.Failed(
                reason = "cc/mksh shim missing under ${bootstrapper.prefixDir.absolutePath}",
                exitCode = null,
            )
        }
        val command = listOf(
            mkshPath.absolutePath,
            ccPath.absolutePath,
            "hub", "recent-audit", "--limit", limit.toString(), "--json",
        )
        val envList = ptyEnvironment.envp().toList()
        val pb = ProcessBuilder(command).apply {
            val envMap = environment()
            envMap.clear()
            for (kv in envList) {
                val eq = kv.indexOf('=')
                if (eq > 0) envMap[kv.substring(0, eq)] = kv.substring(eq + 1)
            }
            redirectErrorStream(false)
            directory(bootstrapper.homeDir)
        }
        val process = try {
            pb.start()
        } catch (e: Exception) {
            return@withContext RecentAuditResult.Failed(
                reason = "spawn-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = null,
            )
        }
        val stdoutBuilder = StringBuilder()
        val stderrBuilder = StringBuilder()
        val stdoutThread = Thread {
            try {
                process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stdoutBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.audit: stdout reader exited via exception")
            }
        }.also { it.start() }
        val stderrThread = Thread {
            try {
                process.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stderrBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.audit: stderr reader exited via exception")
            }
        }.also { it.start() }
        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            stdoutThread.join(500)
            stderrThread.join(500)
            return@withContext RecentAuditResult.Failed("timeout after ${timeoutMs}ms", null)
        }
        stdoutThread.join(2_000)
        stderrThread.join(2_000)
        val exit = process.exitValue()
        val stdout = stdoutBuilder.toString()
        if (exit != 0) {
            val errMsg = try {
                org.json.JSONObject(stdout.trim()).optString("error", "").takeIf { it.isNotEmpty() }
            } catch (_: Exception) { null }
            return@withContext RecentAuditResult.Failed(
                reason = errMsg ?: "cc exited with code $exit",
                exitCode = exit,
            )
        }
        try {
            val arr = org.json.JSONArray(stdout.trim())
            val rows = buildList {
                for (i in 0 until arr.length()) {
                    val r = arr.optJSONObject(i) ?: continue
                    add(
                        AuditRow(
                            at = r.optLong("at", 0L),
                            action = r.optString("action", ""),
                            adapter = r.optString("adapter", "").takeIf { it.isNotEmpty() },
                            eventId = r.optString("eventId", "").takeIf { it.isNotEmpty() },
                        )
                    )
                }
            }
            RecentAuditResult.Ok(rows = rows)
        } catch (e: Exception) {
            RecentAuditResult.Failed(
                reason = "parse-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = exit,
            )
        }
    }

    /** Result for event-detail lookup flow. */
    sealed class EventDetailResult {
        data class Ok(val event: VaultEvent) : EventDetailResult()
        data class NotFound(val eventId: String) : EventDetailResult()
        data class Failed(val reason: String, val exitCode: Int?) : EventDetailResult()
    }

    /**
     * Parsed shape of `cc hub event-detail <id> --json` returns.
     * Mirrors LocalVault._rowToEvent() in packages/personal-data-hub/lib/vault.js
     * (id / subtype / source / title / actor / amount / currency / startedAt).
     */
    data class VaultEvent(
        val id: String,
        val subtype: String,
        val source: String,
        val title: String?,
        val actor: String?,
        val amount: Double?,
        val currency: String?,
        val startedAt: Long?,
    )

    /**
     * `cc hub event-detail <eventId> --json` → vault event row.
     *
     * 推文 §"AI 给出处" 的真接通：HubAskCard citation chip click → 本方法 →
     * vault.getEvent(id) → 详情 sheet 显原文。Idempotent + cheap (single
     * SQLite SELECT by primary key); safe to call many times during a
     * single session.
     */
    suspend fun queryEvent(
        eventId: String,
        timeoutMs: Long = 20_000L,
    ): EventDetailResult = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext EventDetailResult.Failed(
                reason = "bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}",
                exitCode = null,
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")
        if (!ccPath.exists() || !mkshPath.exists()) {
            return@withContext EventDetailResult.Failed(
                reason = "cc/mksh shim missing under ${bootstrapper.prefixDir.absolutePath}",
                exitCode = null,
            )
        }
        val command = listOf(
            mkshPath.absolutePath,
            ccPath.absolutePath,
            "hub", "event-detail", eventId, "--json",
        )
        val envList = ptyEnvironment.envp().toList()
        val pb = ProcessBuilder(command).apply {
            val envMap = environment()
            envMap.clear()
            for (kv in envList) {
                val eq = kv.indexOf('=')
                if (eq > 0) envMap[kv.substring(0, eq)] = kv.substring(eq + 1)
            }
            redirectErrorStream(false)
            directory(bootstrapper.homeDir)
        }
        val process = try {
            pb.start()
        } catch (e: Exception) {
            return@withContext EventDetailResult.Failed(
                reason = "spawn-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = null,
            )
        }
        val stdoutBuilder = StringBuilder()
        val stderrBuilder = StringBuilder()
        val stdoutThread = Thread {
            try {
                process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stdoutBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.queryEvent: stdout reader exited via exception")
            }
        }.also { it.start() }
        val stderrThread = Thread {
            try {
                process.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stderrBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.queryEvent: stderr reader exited via exception")
            }
        }.also { it.start() }
        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            stdoutThread.join(500)
            stderrThread.join(500)
            return@withContext EventDetailResult.Failed("timeout after ${timeoutMs}ms", null)
        }
        stdoutThread.join(2_000)
        stderrThread.join(2_000)
        val exit = process.exitValue()
        val stdout = stdoutBuilder.toString()
        if (exit != 0) {
            val errMsg = try {
                JSONObject(stdout.trim()).optString("error", "").takeIf { it.isNotEmpty() }
            } catch (_: Exception) { null }
            return@withContext EventDetailResult.Failed(
                reason = errMsg ?: "cc exited with code $exit",
                exitCode = exit,
            )
        }
        try {
            val obj = JSONObject(stdout.trim())
            if (!obj.optBoolean("found", false)) {
                return@withContext EventDetailResult.NotFound(eventId = obj.optString("eventId", eventId))
            }
            val ev = obj.getJSONObject("event")
            EventDetailResult.Ok(
                event = VaultEvent(
                    id = ev.optString("id", ""),
                    subtype = ev.optString("subtype", ""),
                    source = ev.optString("source", ""),
                    title = ev.optString("title", "").takeIf { it.isNotEmpty() },
                    actor = ev.optString("actor", "").takeIf { it.isNotEmpty() },
                    amount = if (ev.has("amount") && !ev.isNull("amount")) ev.optDouble("amount") else null,
                    currency = ev.optString("currency", "").takeIf { it.isNotEmpty() },
                    startedAt = if (ev.has("startedAt") && !ev.isNull("startedAt")) ev.optLong("startedAt") else null,
                ),
            )
        } catch (e: Exception) {
            EventDetailResult.Failed(
                reason = "parse-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = exit,
            )
        }
    }

    /** Result for export-vault flow. */
    sealed class ExportResult {
        data class Ok(val outputPath: String, val bytes: Long, val encrypted: Boolean) : ExportResult()
        data class Failed(val reason: String, val exitCode: Int?) : ExportResult()
    }

    /**
     * `cc hub export --output <path> --json` → vault.db + sidecars copied
     * to outputPath. 推文 §"一键带走"。
     *
     * Caller (Android UI) typically writes to a SAF-picker-acquired path
     * inside the App's accessible storage area. The exported file IS the
     * SQLCipher-encrypted vault — desktop can `cc hub import-vault <path>`
     * to reimport. No re-encryption.
     */
    suspend fun exportVault(
        outputPath: String,
        timeoutMs: Long = 60_000L,
    ): ExportResult = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext ExportResult.Failed(
                reason = "bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}",
                exitCode = null,
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")
        if (!ccPath.exists() || !mkshPath.exists()) {
            return@withContext ExportResult.Failed(
                reason = "cc/mksh shim missing under ${bootstrapper.prefixDir.absolutePath}",
                exitCode = null,
            )
        }
        val command = listOf(
            mkshPath.absolutePath,
            ccPath.absolutePath,
            "hub", "export", "--output", outputPath, "--json",
        )
        val envList = ptyEnvironment.envp().toList()
        val pb = ProcessBuilder(command).apply {
            val envMap = environment()
            envMap.clear()
            for (kv in envList) {
                val eq = kv.indexOf('=')
                if (eq > 0) envMap[kv.substring(0, eq)] = kv.substring(eq + 1)
            }
            redirectErrorStream(false)
            directory(bootstrapper.homeDir)
        }
        val process = try {
            pb.start()
        } catch (e: Exception) {
            return@withContext ExportResult.Failed(
                reason = "spawn-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = null,
            )
        }
        val stdoutBuilder = StringBuilder()
        val stderrBuilder = StringBuilder()
        val stdoutThread = Thread {
            try {
                process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stdoutBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.export: stdout reader exited via exception")
            }
        }.also { it.start() }
        val stderrThread = Thread {
            try {
                process.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stderrBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.export: stderr reader exited via exception")
            }
        }.also { it.start() }
        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            stdoutThread.join(500)
            stderrThread.join(500)
            return@withContext ExportResult.Failed("timeout after ${timeoutMs}ms", null)
        }
        stdoutThread.join(2_000)
        stderrThread.join(2_000)
        val exit = process.exitValue()
        val stdout = stdoutBuilder.toString()
        if (exit != 0) {
            val errMsg = try {
                JSONObject(stdout.trim()).optString("error", "").takeIf { it.isNotEmpty() }
            } catch (_: Exception) { null }
            return@withContext ExportResult.Failed(
                reason = errMsg ?: "cc exited with code $exit",
                exitCode = exit,
            )
        }
        try {
            val obj = JSONObject(stdout.trim())
            ExportResult.Ok(
                outputPath = obj.optString("output", outputPath),
                bytes = obj.optLong("bytes", 0L),
                encrypted = obj.optBoolean("encrypted", true),
            )
        } catch (e: Exception) {
            ExportResult.Failed(
                reason = "parse-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = exit,
            )
        }
    }

    /**
     * `cc hub destroy --confirm --json` → vault.db + WAL wiped.
     *
     * 推文 §"三道锁 · 第三把：随时能销毁"。Caller responsible for showing a
     * confirmation dialog before invoking — there is NO undo. Reuses the
     * existing cmdDestroy path in packages/cli/src/commands/hub.js (which
     * calls LocalVault.destroy() → unlinks .db + -wal + -shm + key file).
     */
    suspend fun destroyVault(timeoutMs: Long = 30_000L): DestroyResult = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext DestroyResult.Failed(
                reason = "bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}",
                exitCode = null,
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")
        if (!ccPath.exists() || !mkshPath.exists()) {
            return@withContext DestroyResult.Failed(
                reason = "cc/mksh shim missing under ${bootstrapper.prefixDir.absolutePath}",
                exitCode = null,
            )
        }
        val command = listOf(
            mkshPath.absolutePath,
            ccPath.absolutePath,
            "hub", "destroy", "--confirm", "--json",
        )
        val envList = ptyEnvironment.envp().toList()
        val pb = ProcessBuilder(command).apply {
            val envMap = environment()
            envMap.clear()
            for (kv in envList) {
                val eq = kv.indexOf('=')
                if (eq > 0) envMap[kv.substring(0, eq)] = kv.substring(eq + 1)
            }
            redirectErrorStream(false)
            directory(bootstrapper.homeDir)
        }
        val process = try {
            pb.start()
        } catch (e: Exception) {
            return@withContext DestroyResult.Failed(
                reason = "spawn-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = null,
            )
        }
        val stdoutBuilder = StringBuilder()
        val stderrBuilder = StringBuilder()
        val stdoutThread = Thread {
            try {
                process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stdoutBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.destroy: stdout reader exited via exception")
            }
        }.also { it.start() }
        val stderrThread = Thread {
            try {
                process.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stderrBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.destroy: stderr reader exited via exception")
            }
        }.also { it.start() }
        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            stdoutThread.join(500)
            stderrThread.join(500)
            return@withContext DestroyResult.Failed("timeout after ${timeoutMs}ms", null)
        }
        stdoutThread.join(2_000)
        stderrThread.join(2_000)
        val exit = process.exitValue()
        if (exit != 0) {
            val errMsg = try {
                JSONObject(stdoutBuilder.toString().trim()).optString("error", "")
                    .takeIf { it.isNotEmpty() }
            } catch (_: Exception) { null }
            return@withContext DestroyResult.Failed(
                reason = errMsg ?: "cc exited with code $exit",
                exitCode = exit,
            )
        }
        DestroyResult.Ok
    }

    /**
     * `cc hub ask "<question>" --json` → parsed AskReport.
     *
     * Conceptually mirrors [syncAdapter] but drives the analysis engine
     * instead of an adapter. Same untrusted_app SELinux context inheritance
     * via mksh-as-interpreter ensures the cc subprocess can reach a
     * Kotlin-hosted Ollama-compat LLM server on loopback (see A3 design
     * `docs/design/PDH_A3_OnDevice_LLM.md`).
     *
     * v0.1: LLM server not yet wired — if env points at no listener, cc
     * fails with "OllamaClient.chat: request failed" and we surface that
     * to the UI as "端侧 LLM 未启动". Wire-up arrives in A3.1-A3.3.
     *
     * @param question 用户原话，直接传 cc。CLI quoting handled by ProcessBuilder.
     * @param ollamaUrl LLM HTTP endpoint Kotlin hosts. v0.1 pass null →
     *                  cc uses default localhost:11434 which will fail.
     * @param acceptNonLocal A3.10 拒云开关。true → 给 cc 加 `--accept-non-local`，
     *                       让 AnalysisEngine 允许非本地 LLM。false（默认）下
     *                       cc 在 LLM 非 local 时拒答（"AnalysisEngine.ask: LLM
     *                       declared non-local"），推文 §三道锁·第二把的硬约束。
     * @param timeoutMs ~60s budget for first-token + decode of a ~200-token
     *                  answer at 8-15 tok/s (Qwen2.5-1.5B on Dimensity 7025).
     */
    suspend fun askQuestion(
        question: String,
        ollamaUrl: String? = null,
        acceptNonLocal: Boolean = false,
        timeoutMs: Long = 60_000L,
    ): AskResult = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext AskResult.Failed(
                reason = "bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}",
                exitCode = null,
                stderr = null,
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")
        if (!ccPath.exists() || !mkshPath.exists()) {
            return@withContext AskResult.Failed(
                reason = "cc/mksh shim missing under ${bootstrapper.prefixDir.absolutePath}",
                exitCode = null,
                stderr = null,
            )
        }

        val command = buildList {
            add(mkshPath.absolutePath)
            add(ccPath.absolutePath)
            add("hub"); add("ask"); add(question)
            add("--json")
            if (acceptNonLocal) add("--accept-non-local")
        }

        val envList = ptyEnvironment.envp().toList()
        val pb = ProcessBuilder(command).apply {
            val envMap = environment()
            envMap.clear()
            for (kv in envList) {
                val eq = kv.indexOf('=')
                if (eq > 0) envMap[kv.substring(0, eq)] = kv.substring(eq + 1)
            }
            // A3 HTTP-Hybrid: cc OllamaClient hits this URL. Kotlin's
            // LocalLlmServer (A3.2) MUST be listening here, otherwise the
            // analysis engine fails fast with a network error.
            if (!ollamaUrl.isNullOrBlank()) {
                envMap["CC_HUB_OLLAMA_URL"] = ollamaUrl
            }
            redirectErrorStream(false)
            directory(bootstrapper.homeDir)
        }

        val process = try {
            pb.start()
        } catch (e: Exception) {
            return@withContext AskResult.Failed(
                reason = "spawn-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = null,
                stderr = null,
            )
        }

        val stdoutBuilder = StringBuilder()
        val stderrBuilder = StringBuilder()
        val stdoutThread = Thread {
            try {
                process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stdoutBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.ask: stdout reader exited via exception")
            }
        }.also { it.start() }
        val stderrThread = Thread {
            try {
                process.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stderrBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.ask: stderr reader exited via exception")
            }
        }.also { it.start() }

        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            stdoutThread.join(500)
            stderrThread.join(500)
            return@withContext AskResult.Failed(
                reason = "timeout after ${timeoutMs}ms",
                exitCode = null,
                stderr = stderrBuilder.toString().take(2000),
            )
        }
        stdoutThread.join(2_000)
        stderrThread.join(2_000)
        val exit = process.exitValue()
        val stdout = stdoutBuilder.toString()
        val stderr = stderrBuilder.toString()

        if (exit != 0) {
            val errMsg = try {
                JSONObject(stdout.trim()).optString("error", "").takeIf { it.isNotEmpty() }
            } catch (_: Exception) {
                null
            }
            return@withContext AskResult.Failed(
                reason = errMsg ?: "cc exited with code $exit",
                exitCode = exit,
                stderr = stderr.take(2000),
            )
        }

        val report = try {
            parseAskReport(stdout)
        } catch (e: Exception) {
            Timber.w(e, "LocalCcRunner.ask: failed to parse cc stdout: %s", stdout.take(500))
            return@withContext AskResult.Failed(
                reason = "parse-failed: ${e.message}",
                exitCode = exit,
                stderr = stderr.take(2000),
            )
        }
        AskResult.Ok(report = report, rawJson = stdout.trim())
    }

    private fun parseAskReport(stdout: String): AskReport {
        val obj = JSONObject(stdout.trim())
        val citationsArr = obj.optJSONArray("citations")
        val citations = buildList {
            if (citationsArr != null) {
                for (i in 0 until citationsArr.length()) {
                    val c = citationsArr.optJSONObject(i) ?: continue
                    add(
                        AskReport.Citation(
                            eventId = c.optString("eventId", ""),
                            excerpt = c.optString("excerpt", "").takeIf { it.isNotEmpty() },
                            source = c.optString("source", "").takeIf { it.isNotEmpty() },
                        )
                    )
                }
            }
        }
        return AskReport(
            answer = obj.optString("answer", ""),
            citations = citations,
            llmName = obj.optString("llmName", "").takeIf { it.isNotEmpty() },
            isLocal = obj.optBoolean("isLocal", true),
            durationMs = obj.optLong("durationMs", 0L),
        )
    }

    data class SyncReport(
        val adapter: String,
        val status: String,
        val ingested: Int,
        val invalidCount: Int,
        val kgTriples: Int,
        val ragDocs: Int,
        val durationMs: Long,
        val error: String?,
    )

    private fun parseSyncReport(stdout: String): SyncReport {
        val obj = JSONObject(stdout.trim())
        // Registry report shape per packages/personal-data-hub/lib/registry.js
        // syncAdapter() — adapter / status / entityCounts / kgTripleCount /
        // ragDocCount / durationMs / error.
        val entityCounts = obj.optJSONObject("entityCounts")
        val ingested = if (entityCounts != null) {
            entityCounts.optInt("persons", 0) +
                entityCounts.optInt("items", 0) +
                entityCounts.optInt("events", 0) +
                entityCounts.optInt("places", 0) +
                entityCounts.optInt("topics", 0)
        } else {
            obj.optInt("ingested", 0)
        }
        return SyncReport(
            adapter = obj.optString("adapter", ""),
            status = obj.optString("status", "unknown"),
            ingested = ingested,
            invalidCount = obj.optInt("invalidCount", 0),
            kgTriples = obj.optInt("kgTripleCount", obj.optInt("kgTriples", 0)),
            ragDocs = obj.optInt("ragDocCount", obj.optInt("ragDocs", 0)),
            durationMs = obj.optLong("durationMs", 0L),
            error = obj.optString("error", "").takeIf { it.isNotEmpty() && it != "null" },
        )
    }
}
