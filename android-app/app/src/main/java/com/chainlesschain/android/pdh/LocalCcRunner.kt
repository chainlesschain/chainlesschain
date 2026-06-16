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
        // 防幻觉信号 — `cc hub ask --json` 透出的 hallucinatedCitations 条数
        // （LLM 引用但 vault 里不存在的 event id，见 analysis.js validateCitations）。
        // >0 → UI 显警示条。旧 cc 不带该字段时默认 0，向后兼容。
        val hallucinatedCount: Int = 0,
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
        // First-run sync on device: bs3mc cold-load + LocalVault open + adapter
        // wiring (50+ adapters) + KG/RAG derivation. EntityResolver embedding
        // stage is now auto-skipped in-APK — wiring.js detects PREFIX starting
        // with /data/data/com.chainlesschain.android and disables the embedding
        // + LLM stages so no Ollama ECONNREFUSED retry burn (prior comment
        // here described pre-skip-logic behaviour; superseded 2026-05-2x).
        //
        // 240s is the per-adapter ceiling for social/messaging cold-start;
        // system-data-android first-run ~1300 entities fits. For high-volume
        // social snapshots (Weibo / Bilibili posts in the thousands) prefer
        // passing [limit] so the JS side caps event ingest — without it the
        // cc subprocess can still exceed 240s on per-entity SQLCipher writes
        // + BM25 index updates regardless of embedding skip.
        timeoutMs: Long = 240_000L,
        // Caps adapter event ingest via `--limit N` flag. The snapshot file
        // is unaffected — full data stays staged on disk; only the JS-side
        // sync loop terminates after N events. Use to keep first-time syncs
        // inside the timeout while throughput per-entity is being profiled.
        // Null = no cap (cc behaviour: ingest everything in the snapshot).
        limit: Int? = null,
        // 2026-05-23 real-device UX feedback: 4-minute spinner with zero
        // progress hint is unfriendly. When non-null, gets invoked at spawn
        // (once) and then every 10s while the subprocess is still alive so
        // the UI can render "金库写入中（N s）" — at least the user knows
        // work is happening + how long it's been at it.
        onProgress: ((String) -> Unit)? = null,
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
        // 2026-05-25 trap #24 v3 — no File.exists() pre-flight here. The
        // check was racy: it ran AFTER bootstrap() released its mutex but
        // BEFORE ProcessBuilder.start(), and another tab's concurrent
        // bootstrap could wipe bin/ in that window. Bootstrapper now
        // rebuilds bin/ atomically via symlink-slot swap (see
        // LocalFilesystemBootstrapper.rebuildBinAtomically), so if bootstrap
        // returned success the shims are present. If they're somehow truly
        // absent (e.g. corrupted install), the ProcessBuilder.start() below
        // surfaces the real ENOENT as a "spawn-failed" reason — strictly
        // more informative than the silent false-positive the old gate gave.

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
        val command = buildList {
            add(mkshPath.absolutePath)
            add(ccPath.absolutePath)
            add("hub"); add("sync-adapter"); add(adapterName)
            add("--input"); add(inputPath)
            // Caller-supplied cap (see [limit] param doc above). Validated
            // positive to avoid `--limit 0` masquerading as "ingest none" —
            // cc reads <=0 as Infinity per cmdSyncAdapter in hub.js.
            if (limit != null && limit > 0) {
                add("--limit"); add(limit.toString())
            }
            add("--json")
        }

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

        onProgress?.invoke("金库写入中…")
        val ccStartMs = System.currentTimeMillis()

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

        // Heartbeat thread: emit elapsed-seconds progress every 10s so the UI
        // can show "金库写入中（30s）". Sole purpose is UX during the silent
        // cc subprocess phase — does not affect timeout or shutdown.
        val tickerStop = java.util.concurrent.atomic.AtomicBoolean(false)
        val tickerThread = if (onProgress != null) {
            Thread {
                try {
                    while (!tickerStop.get()) {
                        java.lang.Thread.sleep(10_000L)
                        if (tickerStop.get()) break
                        val elapsedS = (System.currentTimeMillis() - ccStartMs) / 1000L
                        onProgress.invoke("金库写入中（${elapsedS}s）…")
                    }
                } catch (_: InterruptedException) {
                    // expected when process finishes before timeout
                } catch (t: Throwable) {
                    Timber.w(t, "LocalCcRunner: ticker thread exited unexpectedly")
                }
            }.also { it.start() }
        } else null

        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        tickerStop.set(true)
        tickerThread?.interrupt()
        if (!finished) {
            process.destroyForcibly()
            stdoutThread.join(500)
            stderrThread.join(500)
            tickerThread?.join(500)
            return@withContext CcResult.Failed(
                reason = "timeout after ${timeoutMs}ms",
                exitCode = null,
                stderr = stderrBuilder.toString().take(2000),
            )
        }
        stdoutThread.join(2_000)
        stderrThread.join(2_000)
        tickerThread?.join(500)
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
        // Gate dropped — see trap #24 v3 note on syncAdapter above.
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
        // Gate dropped — see trap #24 v3 note on syncAdapter above.
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

    /** Row shape mirrored from vault.queryEvents() in personal-data-hub/lib/vault.js
     * `_rowToEvent`. Only the fields used by the in-APK preview UI are surfaced;
     * full row stays in [rawJson] for callers that want it (e.g. event-detail
     * sheet reuse). */
    data class EventRow(
        val id: String,
        val subtype: String,
        val occurredAt: Long,
        val ingestedAt: Long,
        val sourceAdapter: String?,
        val summary: String?,
        val rawJson: String,
        // Stop-gap for parallel-session HubBrowserRenderers.kt (commit 7b9815381) —
        // category renderers (chat / email) read event.actor for from-label。
        // 默认 null，等并行 session 在 _runCcJson() / queryEvents JSON 解析里补 actor 字段后即可生效。
        val actor: String? = null,
    )

    sealed class QueryEventsResult {
        data class Ok(val rows: List<EventRow>) : QueryEventsResult()
        data class Failed(val reason: String, val exitCode: Int?) : QueryEventsResult()
    }

    /**
     * `cc hub query-events [--adapter <name>] [--limit <n>] --json` →
     * 最近 N 条事件 (vault.queryEvents() default sort = occurredAt DESC).
     *
     * 用途：HubLocalScreen "看本机数据" 入口，回答 "微博同步成功但 AI 说没内容"
     * 类问题 — 让用户能直接看到 vault 里到底有没有真东西，不用进终端。
     * 同步成功但 UI 看不到 = 视野缺失，加这条 method 让 UI 能直接 dump 样本。
     *
     * @param adapter null = 不过滤 (取所有 adapter)；否则只取该 adapter 写的
     * @param limit   default 5 — 用户预览样本，多了 UI 列表难看
     */
    suspend fun queryEvents(
        adapter: String? = null,
        limit: Int = 5,
        timeoutMs: Long = 20_000L,
    ): QueryEventsResult = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext QueryEventsResult.Failed(
                reason = "bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}",
                exitCode = null,
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")
        // Gate dropped — see trap #24 v3 note on syncAdapter above.
        val command = buildList {
            add(mkshPath.absolutePath)
            add(ccPath.absolutePath)
            add("hub"); add("query-events")
            if (!adapter.isNullOrBlank()) {
                add("--adapter"); add(adapter)
            }
            if (limit > 0) {
                add("--limit"); add(limit.toString())
            }
            add("--json")
        }
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
            return@withContext QueryEventsResult.Failed(
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
                Timber.w(t, "LocalCcRunner.queryEvents: stdout reader exited via exception")
            }
        }.also { it.start() }
        val stderrThread = Thread {
            try {
                process.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stderrBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.queryEvents: stderr reader exited via exception")
            }
        }.also { it.start() }
        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            stdoutThread.join(500)
            stderrThread.join(500)
            return@withContext QueryEventsResult.Failed("timeout after ${timeoutMs}ms", null)
        }
        stdoutThread.join(2_000)
        stderrThread.join(2_000)
        val exit = process.exitValue()
        val stdout = stdoutBuilder.toString()
        if (exit != 0) {
            val errMsg = try {
                JSONObject(stdout.trim()).optString("error", "").takeIf { it.isNotEmpty() }
            } catch (_: Exception) { null }
            return@withContext QueryEventsResult.Failed(
                reason = errMsg ?: "cc exited with code $exit",
                exitCode = exit,
            )
        }
        try {
            val arr = org.json.JSONArray(stdout.trim())
            val rows = buildList {
                for (i in 0 until arr.length()) {
                    val ev = arr.optJSONObject(i) ?: continue
                    val src = ev.optJSONObject("source")
                    val content = ev.optJSONObject("content")
                    // content shape varies per-adapter — pick "text" / "title" /
                    // "summary" / "label" first, then fall back to first non-null
                    // string field for a best-effort preview line.
                    val summary = content?.let { c ->
                        c.optString("text", "").takeIf { it.isNotEmpty() }
                            ?: c.optString("title", "").takeIf { it.isNotEmpty() }
                            ?: c.optString("summary", "").takeIf { it.isNotEmpty() }
                            ?: c.optString("label", "").takeIf { it.isNotEmpty() }
                            ?: firstNonEmptyStringField(c)
                    }
                    add(
                        EventRow(
                            id = ev.optString("id", ""),
                            subtype = ev.optString("subtype", ""),
                            occurredAt = ev.optLong("occurredAt", 0L),
                            ingestedAt = ev.optLong("ingestedAt", 0L),
                            sourceAdapter = src?.optString("adapter", "")?.takeIf { it.isNotEmpty() },
                            summary = summary,
                            rawJson = ev.toString(),
                        )
                    )
                }
            }
            QueryEventsResult.Ok(rows = rows)
        } catch (e: Exception) {
            QueryEventsResult.Failed(
                reason = "parse-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = exit,
            )
        }
    }

    private fun firstNonEmptyStringField(obj: JSONObject): String? {
        val keys = obj.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            val v = obj.opt(k)
            if (v is String && v.isNotEmpty()) return v
        }
        return null
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
        // Gate dropped — see trap #24 v3 note on syncAdapter above.
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
        // Gate dropped — see trap #24 v3 note on syncAdapter above.
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
     * @param maxFacts 端侧小模型预算覆写。Qwen2.5-1.5B 实战指令跟随窗口只有 2-4K
     *                  token，桌面默认 80 facts (prompt ~5K) 会撑爆。本机调用默认
     *                  传 20 → prompt ≈ 1.5K，留足回答空间。null 走 cc 默认。
     * @param maxQueryLimit Vault `queryEvents.limit` 覆写。配合 [maxFacts] 减少
     *                       事实候选池扫描；默认 50 (cc 默认 200)。
     * @param timeoutMs wall-clock budget. 60s was the original target ("first
     *                  token + decode at 8-15 tok/s") but real-device 2026-05-27
     *                  Xiaomi 24115RA8EC showed cold-start cc spawn + bs3mc
     *                  require + SQLCipher PBKDF2-100K key derive + MediaPipe
     *                  first-token bootstrap routinely eats 30-50s BEFORE
     *                  generation even starts, then a 200-token answer adds
     *                  another 20-40s. 60s caused silent timeouts mid-answer
     *                  and the user saw "几个联系人" never respond. Bumped to
     *                  240s to match `runCommand` water-line; LLM tail / hang
     *                  recovery still works, just patient. UX side should
     *                  surface a "thinking..." indicator if this becomes a
     *                  pattern. Future S4: route to cloud LLM by default on
     *                  Android (per memory pdh_a3_3tier_llm_routing.md).
     */
    suspend fun askQuestion(
        question: String,
        ollamaUrl: String? = null,
        acceptNonLocal: Boolean = false,
        maxFacts: Int? = 20,
        maxQueryLimit: Int? = 50,
        timeoutMs: Long = 240_000L,
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
        // Gate dropped — see trap #24 v3 note on syncAdapter above.

        val command = buildList {
            add(mkshPath.absolutePath)
            add(ccPath.absolutePath)
            add("hub"); add("ask"); add(question)
            add("--json")
            if (acceptNonLocal) add("--accept-non-local")
            // Small-model budget — see KDoc on [maxFacts] / [maxQueryLimit].
            // Only emit flags when caller passed a positive int; null / ≤0
            // means "let cc fall back to its own defaults".
            if (maxFacts != null && maxFacts > 0) {
                add("--max-facts"); add(maxFacts.toString())
            }
            if (maxQueryLimit != null && maxQueryLimit > 0) {
                add("--max-query-limit"); add(maxQueryLimit.toString())
            }
        }

        // Telemetry for "is the small-model budget really making it to cc?"
        // Grep logcat: `adb logcat | grep PDH-ASK` to see this line on every ask.
        Timber.d(
            "PDH-ASK askQuestion: q=%s acceptNonLocal=%s maxFacts=%s maxQueryLimit=%s ollamaUrl=%s",
            question.take(60),
            acceptNonLocal,
            maxFacts,
            maxQueryLimit,
            ollamaUrl ?: "(default)",
        )

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

        // Surface cc-side budget telemetry to logcat regardless of exit code.
        // AnalysisEngine writes `[PDH-ASK] ask effMaxFacts=… gathered=…` lines
        // to stderr — without this they get swallowed on the success path.
        if (stderr.isNotEmpty()) {
            stderr.lineSequence()
                .filter { it.contains("[PDH-ASK]") }
                .forEach { Timber.d("PDH-ASK %s", it.removePrefix("[PDH-ASK] ").trim()) }
        }

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

    /**
     * Result for [retrieveContext] — RAG preflight that gathers facts +
     * builds LLM messages WITHOUT invoking any LLM. Bridges CLOUD_ANDROID
     * route to the same RAG context the LOCAL_DEVICE / LAN_OLLAMA / DESKTOP
     * routes get via cc ask.
     */
    sealed class RetrieveContextResult {
        data class Ok(val context: RetrieveContext) : RetrieveContextResult()
        data class Failed(val reason: String, val exitCode: Int?, val stderr: String?) : RetrieveContextResult()
    }

    /**
     * Parsed shape of `cc hub retrieve-context --json` stdout. Mirrors
     * AnalysisEngine.retrieveContext() in packages/personal-data-hub/lib/
     * analysis.js — pre-assembled prompt messages + factIds for citation
     * validation. The caller POSTs `messages` to its own LLM provider.
     */
    data class RetrieveContext(
        val messages: List<com.chainlesschain.android.remote.commands.PromptMessage>,
        val factIds: List<String>,
        val factCount: Int,
        val truncated: Int,
        val systemPrompt: String,
    )

    /**
     * §S4 治本 — RAG preflight for the CLOUD_ANDROID route.
     *
     * Spawns `cc hub retrieve-context "<q>" --max-facts N --max-query-limit M`
     * and parses the JSON stdout. NO LLM is called by cc — the caller is
     * responsible for POSTing the returned messages to its own (cloud or
     * local) LLM provider.
     *
     * Why: prior to 2026-05-27 the `submitAskViaCloudAndroid` path
     * (HubLocalViewModel) ran a raw cloud chat with the user question as
     * the only message — zero RAG context — so the LLM hallucinated
     * "I don't have access to your contacts". Stitching retrieve-context
     * in front of the cloud chat gives the cloud LLM the same FACTS +
     * TOTALS preamble that the local LLM gets via `cc ask`.
     *
     * Timeout 90s — retrieveContext does no LLM call so the budget is
     * just node spawn (~1s) + bs3mc load (~1-2s) + vault open + key
     * derive (~1-3s) + queryEvents/Persons/Items (~50-100ms) + buildPrompt
     * (~ms). 60s is safe; 90s gives headroom for SQLCipher key derivation
     * on lower-end devices.
     */
    suspend fun retrieveContext(
        question: String,
        maxFacts: Int? = 20,
        maxQueryLimit: Int? = 50,
        timeoutMs: Long = 90_000L,
    ): RetrieveContextResult = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext RetrieveContextResult.Failed(
                reason = "bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}",
                exitCode = null,
                stderr = null,
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")

        val command = buildList {
            add(mkshPath.absolutePath)
            add(ccPath.absolutePath)
            add("hub")
            add("retrieve-context")
            add(question)
            if (maxFacts != null && maxFacts > 0) {
                add("--max-facts")
                add(maxFacts.toString())
            }
            if (maxQueryLimit != null && maxQueryLimit > 0) {
                add("--max-query-limit")
                add(maxQueryLimit.toString())
            }
        }

        Timber.tag("LocalCcRunner\$retrieveContext").d(
            "PDH-RC retrieveContext: q=%s maxFacts=%s maxQueryLimit=%s",
            question.take(80), maxFacts, maxQueryLimit,
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
            return@withContext RetrieveContextResult.Failed(
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
                Timber.w(t, "LocalCcRunner.retrieveContext: stdout reader exited via exception")
            }
        }.also { it.start() }
        val stderrThread = Thread {
            try {
                process.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stderrBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.retrieveContext: stderr reader exited via exception")
            }
        }.also { it.start() }

        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            stdoutThread.join(500)
            stderrThread.join(500)
            return@withContext RetrieveContextResult.Failed(
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

        if (stderr.isNotEmpty()) {
            stderr.lineSequence()
                .filter { it.contains("[PDH-ASK]") }
                .forEach { Timber.d("PDH-RC %s", it.removePrefix("[PDH-ASK] ").trim()) }
        }

        if (exit != 0) {
            val errMsg = try {
                JSONObject(stdout.trim()).optString("error", "").takeIf { it.isNotEmpty() }
            } catch (_: Exception) {
                null
            }
            return@withContext RetrieveContextResult.Failed(
                reason = errMsg ?: "cc exited with code $exit",
                exitCode = exit,
                stderr = stderr.take(2000),
            )
        }

        val context = try {
            parseRetrieveContext(stdout)
        } catch (e: Exception) {
            Timber.w(e, "LocalCcRunner.retrieveContext: failed to parse cc stdout: %s", stdout.take(500))
            return@withContext RetrieveContextResult.Failed(
                reason = "parse-failed: ${e.message}",
                exitCode = exit,
                stderr = stderr.take(2000),
            )
        }
        RetrieveContextResult.Ok(context = context)
    }

    private fun parseRetrieveContext(stdout: String): RetrieveContext {
        val obj = JSONObject(stdout.trim())
        val messagesArr = obj.optJSONArray("messages")
        val messages = buildList {
            if (messagesArr != null) {
                for (i in 0 until messagesArr.length()) {
                    val m = messagesArr.optJSONObject(i) ?: continue
                    add(
                        com.chainlesschain.android.remote.commands.PromptMessage(
                            role = m.optString("role", "user"),
                            content = m.optString("content", ""),
                        )
                    )
                }
            }
        }
        val factIdsArr = obj.optJSONArray("factIds")
        val factIds = buildList {
            if (factIdsArr != null) {
                for (i in 0 until factIdsArr.length()) {
                    val id = factIdsArr.optString(i)
                    if (id.isNotEmpty()) add(id)
                }
            }
        }
        return RetrieveContext(
            messages = messages,
            factIds = factIds,
            factCount = obj.optInt("factCount", 0),
            truncated = obj.optInt("truncated", 0),
            systemPrompt = obj.optString("systemPrompt", ""),
        )
    }

    private fun parseAskReport(stdout: String): AskReport {
        val obj = JSONObject(stdout.trim())
        val citationsArr = obj.optJSONArray("citations")
        val citations = buildList {
            if (citationsArr != null) {
                for (i in 0 until citationsArr.length()) {
                    // AnalysisEngine.ask() 回传 citations 是 event-id **字符串**数组
                    // （analysis.js 的 `known`）。旧代码只认对象形态 → optJSONObject
                    // 对字符串元素恒返 null → citations 永远为空，"依据" chip 全丢。
                    // 防御性兼容两种形态：对象元素取 eventId 字段，字符串元素直接用。
                    val asObj = citationsArr.optJSONObject(i)
                    val eventId = asObj?.optString("eventId", "") ?: citationsArr.optString(i, "")
                    if (eventId.isEmpty()) continue
                    add(
                        AskReport.Citation(
                            eventId = eventId,
                            excerpt = asObj?.optString("excerpt", "")?.takeIf { it.isNotEmpty() },
                            source = asObj?.optString("source", "")?.takeIf { it.isNotEmpty() },
                        )
                    )
                }
            }
        }
        // hallucinatedCitations 是 id 字符串数组（analysis.js 的 `unknown`）；只取条数驱动 UI。
        val hallucinatedCount = obj.optJSONArray("hallucinatedCitations")?.length() ?: 0
        return AskReport(
            answer = obj.optString("answer", ""),
            citations = citations,
            llmName = obj.optString("llmName", "").takeIf { it.isNotEmpty() },
            isLocal = obj.optBoolean("isLocal", true),
            durationMs = obj.optLong("durationMs", 0L),
            hallucinatedCount = hallucinatedCount,
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

    /**
     * §2.1 A3.5 — runs `cc config set <key> <value>` non-interactively.
     *
     * Used by AiBackendSettingsViewModel to keep cc's persistent
     * `.chainlesschain/config.json` in sync with the in-app
     * [com.chainlesschain.android.pdh.llm.LlmPreferences] toggle, so that
     * future `cc ask` invocations (from anywhere — terminal feature, future
     * cc subprocess calls) pick up the user's choice.
     *
     * Returns:
     *  - Result.success(Unit) — cc exited 0
     *  - Result.failure(IllegalStateException) — bootstrap missing / spawn /
     *    timeout / non-zero exit. Caller may log+ignore (Settings toggle is
     *    fire-and-forget; the in-memory flag is already updated).
     *
     * Quoting: `value` is passed as a separate argv element via ProcessBuilder
     * so spaces / shell metacharacters are safe. No shell interpolation.
     */
    suspend fun setCcConfigValue(
        key: String,
        value: String,
        timeoutMs: Long = 15_000L,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext Result.failure(
                IllegalStateException("bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}"),
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")
        // Gate dropped — see trap #24 v3 note on syncAdapter above.
        val command = listOf(
            mkshPath.absolutePath,
            ccPath.absolutePath,
            "config", "set", key, value,
        )
        val envList = ptyEnvironment.envp().toList()
        val pb = ProcessBuilder(command).apply {
            val envMap = environment()
            envMap.clear()
            for (kv in envList) {
                val eq = kv.indexOf('=')
                if (eq > 0) envMap[kv.substring(0, eq)] = kv.substring(eq + 1)
            }
            redirectErrorStream(true)
            directory(bootstrapper.homeDir)
        }
        val process = try {
            pb.start()
        } catch (e: Exception) {
            return@withContext Result.failure(
                IllegalStateException("spawn-failed: ${e.message ?: e.javaClass.simpleName}", e),
            )
        }
        val outBuilder = StringBuilder()
        val readerThread = Thread {
            try {
                process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) outBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner.setCcConfigValue: reader exited via exception")
            }
        }.also { it.start() }
        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            readerThread.join(500)
            return@withContext Result.failure(
                IllegalStateException("timeout after ${timeoutMs}ms"),
            )
        }
        readerThread.join(2_000)
        val exit = process.exitValue()
        if (exit != 0) {
            return@withContext Result.failure(
                IllegalStateException("cc exited $exit: ${outBuilder.toString().trim().take(500)}"),
            )
        }
        Timber.d("LocalCcRunner.setCcConfigValue: set %s = %s", key, value)
        Result.success(Unit)
    }

    // ─── Phase 16 Vault Browser — search / facet-counts ─────────────────
    //
    // Wraps `cc hub search --json` and `cc hub facet-counts --json`. Returns
    // structured result rows + cursor for paginated load. Mirrors WS topic
    // semantics in packages/cli/src/gateways/ws/personal-data-hub-protocol.js
    // and vault.searchEvents in packages/personal-data-hub/lib/vault.js.

    data class Cursor(val occurredAt: Long, val id: String)

    sealed class SearchResult {
        data class Ok(
            val rows: List<EventRow>,
            val nextCursor: Cursor?,
            val mode: String,        // "fts5" | "like"
            val shortQuery: Boolean, // true when q was dropped (sub-trigram-min)
        ) : SearchResult()
        data class Failed(val reason: String, val exitCode: Int?) : SearchResult()
    }

    sealed class FacetCountsResult {
        data class Ok(
            val byCategory: Map<String, Int>,
            val byAdapter: Map<String, Int>,
            val bySubtype: Map<String, Int>,
            val total: Int,
            val mode: String,
            val shortQuery: Boolean,
        ) : FacetCountsResult()
        data class Failed(val reason: String, val exitCode: Int?) : FacetCountsResult()
    }

    suspend fun searchEvents(
        q: String? = null,
        adapter: String? = null,
        category: String? = null,
        subtype: String? = null,
        since: Long? = null,
        until: Long? = null,
        cursor: Cursor? = null,
        limit: Int = 50,
        timeoutMs: Long = 30_000L,
    ): SearchResult = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext SearchResult.Failed(
                reason = "bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}",
                exitCode = null,
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")
        // Gate dropped — see trap #24 v3 note on syncAdapter above.
        val command = buildList {
            add(mkshPath.absolutePath)
            add(ccPath.absolutePath)
            add("hub"); add("search")
            if (!q.isNullOrBlank()) { add("--q"); add(q) }
            if (!adapter.isNullOrBlank()) { add("--adapter"); add(adapter) }
            if (!category.isNullOrBlank()) { add("--category"); add(category) }
            if (!subtype.isNullOrBlank()) { add("--subtype"); add(subtype) }
            if (since != null && since > 0) { add("--since"); add(since.toString()) }
            if (until != null && until > 0) { add("--until"); add(until.toString()) }
            if (cursor != null) { add("--cursor"); add("${cursor.occurredAt}:${cursor.id}") }
            if (limit > 0) { add("--limit"); add(limit.toString()) }
            add("--json")
        }
        val (stdout, stderr, exit, timedOut) = _runCcJson(command, timeoutMs)
        if (timedOut) return@withContext SearchResult.Failed("timeout after ${timeoutMs}ms", null)
        if (exit != 0) {
            val errMsg = try {
                JSONObject(stdout.trim()).optString("error", "").takeIf { it.isNotEmpty() }
            } catch (_: Exception) { null }
            return@withContext SearchResult.Failed(
                reason = errMsg ?: "cc exited $exit: ${stderr.take(300)}",
                exitCode = exit,
            )
        }
        try {
            val obj = JSONObject(stdout.trim())
            val arr = obj.optJSONArray("rows") ?: org.json.JSONArray()
            val rows = buildList {
                for (i in 0 until arr.length()) {
                    val ev = arr.optJSONObject(i) ?: continue
                    val src = ev.optJSONObject("source")
                    val content = ev.optJSONObject("content")
                    val summary = content?.let { c ->
                        c.optString("text", "").takeIf { it.isNotEmpty() }
                            ?: c.optString("title", "").takeIf { it.isNotEmpty() }
                            ?: c.optString("subject", "").takeIf { it.isNotEmpty() }
                            ?: c.optString("summary", "").takeIf { it.isNotEmpty() }
                            ?: firstNonEmptyStringField(c)
                    }
                    add(
                        EventRow(
                            id = ev.optString("id", ""),
                            subtype = ev.optString("subtype", ""),
                            occurredAt = ev.optLong("occurredAt", 0L),
                            ingestedAt = ev.optLong("ingestedAt", 0L),
                            sourceAdapter = src?.optString("adapter", "")?.takeIf { it.isNotEmpty() },
                            summary = summary,
                            rawJson = ev.toString(),
                        )
                    )
                }
            }
            val nextCur = obj.optJSONObject("nextCursor")?.let { c ->
                Cursor(c.optLong("occurredAt", 0L), c.optString("id", ""))
            }
            SearchResult.Ok(
                rows = rows,
                nextCursor = nextCur,
                mode = obj.optString("mode", "like"),
                shortQuery = obj.optBoolean("shortQuery", false),
            )
        } catch (e: Exception) {
            SearchResult.Failed(
                reason = "parse-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = exit,
            )
        }
    }

    suspend fun facetCounts(
        q: String? = null,
        since: Long? = null,
        until: Long? = null,
        timeoutMs: Long = 15_000L,
    ): FacetCountsResult = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext FacetCountsResult.Failed(
                reason = "bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}",
                exitCode = null,
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")
        // Gate dropped — see trap #24 v3 note on syncAdapter above.
        val command = buildList {
            add(mkshPath.absolutePath)
            add(ccPath.absolutePath)
            add("hub"); add("facet-counts")
            if (!q.isNullOrBlank()) { add("--q"); add(q) }
            if (since != null && since > 0) { add("--since"); add(since.toString()) }
            if (until != null && until > 0) { add("--until"); add(until.toString()) }
            add("--json")
        }
        val (stdout, stderr, exit, timedOut) = _runCcJson(command, timeoutMs)
        if (timedOut) return@withContext FacetCountsResult.Failed("timeout after ${timeoutMs}ms", null)
        if (exit != 0) {
            val errMsg = try {
                JSONObject(stdout.trim()).optString("error", "").takeIf { it.isNotEmpty() }
            } catch (_: Exception) { null }
            return@withContext FacetCountsResult.Failed(
                reason = errMsg ?: "cc exited $exit: ${stderr.take(300)}",
                exitCode = exit,
            )
        }
        try {
            val obj = JSONObject(stdout.trim())
            FacetCountsResult.Ok(
                byCategory = _jsonObjectToIntMap(obj.optJSONObject("byCategory")),
                byAdapter = _jsonObjectToIntMap(obj.optJSONObject("byAdapter")),
                bySubtype = _jsonObjectToIntMap(obj.optJSONObject("bySubtype")),
                total = obj.optInt("total", 0),
                mode = obj.optString("mode", "like"),
                shortQuery = obj.optBoolean("shortQuery", false),
            )
        } catch (e: Exception) {
            FacetCountsResult.Failed(
                reason = "parse-failed: ${e.message ?: e.javaClass.simpleName}",
                exitCode = exit,
            )
        }
    }

    sealed class OverviewResult {
        data class Ok(val report: OverviewReport) : OverviewResult()
        data class Failed(val reason: String, val exitCode: Int?) : OverviewResult()
    }

    /**
     * ② 跨 app 数据总览 — runs `cc hub run-skill analysis.overview --json` and
     * parses the cross-app aggregate (byApp / byType / spend / topContacts) for
     * the 数据总览 tab. Reuses _runCcJson.
     */
    suspend fun runOverview(
        since: Long? = null,
        until: Long? = null,
        timeoutMs: Long = 30_000L,
    ): OverviewResult = withContext(Dispatchers.IO) {
        val ensure = bootstrapper.bootstrap()
        if (ensure.isFailure) {
            return@withContext OverviewResult.Failed(
                reason = "bootstrap-failed: ${ensure.exceptionOrNull()?.message ?: "unknown"}",
                exitCode = null,
            )
        }
        val ccPath = File(bootstrapper.prefixDir, "bin/cc")
        val mkshPath = File(bootstrapper.prefixDir, "bin/mksh")
        val command = buildList {
            add(mkshPath.absolutePath)
            add(ccPath.absolutePath)
            add("hub"); add("run-skill"); add("analysis.overview")
            if (since != null && since > 0) { add("--since"); add(since.toString()) }
            if (until != null && until > 0) { add("--until"); add(until.toString()) }
            add("--json")
        }
        val (stdout, stderr, exit, timedOut) = _runCcJson(command, timeoutMs)
        if (timedOut) return@withContext OverviewResult.Failed("timeout after ${timeoutMs}ms", null)
        if (exit != 0) {
            val errMsg = try {
                JSONObject(stdout.trim()).optString("error", "").takeIf { it.isNotEmpty() }
            } catch (_: Exception) { null }
            // 设备上 bundled 的 cc 若早于 analysis.overview 上线（pdh < 0.4.26），
            // run-skill 会回 "Unknown skill: analysis.overview. Available: ..."。
            // 把这条裸错误翻成可操作提示，而不是吓人的原始串（真机首报此症 2026-06-16）。
            val friendly = if (errMsg != null && isUnknownSkillError(errMsg)) {
                "数据总览需要更新本机 cc 组件（当前版本不含 analysis.overview）。请更新到含该技能的 APK。"
            } else {
                errMsg ?: "cc exited $exit: ${stderr.take(300)}"
            }
            return@withContext OverviewResult.Failed(reason = friendly, exitCode = exit)
        }
        try {
            OverviewResult.Ok(parseOverview(stdout.trim()))
        } catch (e: Exception) {
            OverviewResult.Failed("parse-failed: ${e.message ?: e.javaClass.simpleName}", exit)
        }
    }

    private fun _jsonObjectToIntMap(obj: JSONObject?): Map<String, Int> {
        if (obj == null) return emptyMap()
        val out = mutableMapOf<String, Int>()
        val keys = obj.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            out[k] = obj.optInt(k, 0)
        }
        return out
    }

    /**
     * Spawn cc with the given argv, capture stdout/stderr/exit. Returns
     * (stdout, stderr, exitCode, timedOut). On timeout exitCode = -1.
     *
     * Extracted from the search / facetCounts duplication; pre-Phase-16
     * methods inline this same boilerplate (queryEvents / exportVault /
     * etc.) — left untouched to avoid colliding with parallel-session edits.
     */
    private fun _runCcJson(
        command: List<String>,
        timeoutMs: Long,
    ): _CcSpawnOut {
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
            return _CcSpawnOut("", "spawn-failed: ${e.message ?: e.javaClass.simpleName}", -1, false)
        }
        val stdoutBuilder = StringBuilder()
        val stderrBuilder = StringBuilder()
        val stdoutThread = Thread {
            try {
                process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stdoutBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner._runCcJson: stdout reader exited via exception")
            }
        }.also { it.start() }
        val stderrThread = Thread {
            try {
                process.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) stderrBuilder.append(line).append('\n')
                }
            } catch (t: Throwable) {
                Timber.w(t, "LocalCcRunner._runCcJson: stderr reader exited via exception")
            }
        }.also { it.start() }
        val finished = process.waitFor(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            stdoutThread.join(500)
            stderrThread.join(500)
            return _CcSpawnOut(stdoutBuilder.toString(), stderrBuilder.toString(), -1, true)
        }
        stdoutThread.join(2_000)
        stderrThread.join(2_000)
        return _CcSpawnOut(
            stdout = stdoutBuilder.toString(),
            stderr = stderrBuilder.toString(),
            exitCode = process.exitValue(),
            timedOut = false,
        )
    }

    private data class _CcSpawnOut(
        val stdout: String,
        val stderr: String,
        val exitCode: Int,
        val timedOut: Boolean,
    )
}

// ─── ② analysis.overview parsing (top-level, pure → JVM-testable) ──────────

data class OverviewContact(
    val personId: String,
    val name: String?,
    val interactions: Int,
)

data class OverviewReport(
    val totalEvents: Int,
    val appsActive: Int,
    val topAppName: String?,
    val byApp: List<Pair<String, Int>>,
    val byType: List<Pair<String, Int>>,
    val topContacts: List<OverviewContact>,
    val spendTotal: Double,
    val spendCurrency: String?,
)

/**
 * True when a cc error string means the requested analysis skill isn't
 * registered in the bundled cc (older pdh). Matches the CLI's
 * "Unknown skill: ..." and the pdh lib's "unknown analysis skill: ...".
 */
internal fun isUnknownSkillError(msg: String): Boolean {
    val m = msg.lowercase()
    return m.contains("unknown") && m.contains("skill")
}

/** Parse `cc hub run-skill analysis.overview --json` stdout into [OverviewReport]. */
internal fun parseOverview(json: String): OverviewReport {
    fun String.cleanOrNull(): String? = takeIf { it.isNotEmpty() && it != "null" }
    val obj = JSONObject(json)
    val summary = obj.optJSONObject("summary") ?: JSONObject()
    fun pairs(arr: org.json.JSONArray?, key: String): List<Pair<String, Int>> {
        if (arr == null) return emptyList()
        val out = ArrayList<Pair<String, Int>>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            out.add(o.optString(key) to o.optInt("count"))
        }
        return out
    }
    val contacts = ArrayList<OverviewContact>()
    obj.optJSONArray("topContacts")?.let { arr ->
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            contacts.add(
                OverviewContact(
                    personId = o.optString("personId"),
                    name = o.optString("name").cleanOrNull(),
                    interactions = o.optInt("interactions"),
                ),
            )
        }
    }
    val spending = obj.optJSONObject("spending")
    return OverviewReport(
        totalEvents = summary.optInt("totalEvents"),
        appsActive = summary.optInt("appsActive"),
        topAppName = summary.optString("topAppName").cleanOrNull(),
        byApp = pairs(obj.optJSONArray("byApp"), "app"),
        byType = pairs(obj.optJSONArray("byType"), "type"),
        topContacts = contacts,
        spendTotal = spending?.optDouble("total", 0.0) ?: 0.0,
        spendCurrency = spending?.optString("currency")?.cleanOrNull(),
    )
}
