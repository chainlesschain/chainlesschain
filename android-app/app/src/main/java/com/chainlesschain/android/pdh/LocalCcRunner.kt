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
        timeoutMs: Long = 30_000L,
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
        val stdoutThread = Thread {
            process.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                for (line in lines) {
                    stdoutBuilder.append(line).append('\n')
                }
            }
        }.also { it.start() }
        val stderrThread = Thread {
            process.errorStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                for (line in lines) {
                    stderrBuilder.append(line).append('\n')
                }
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
