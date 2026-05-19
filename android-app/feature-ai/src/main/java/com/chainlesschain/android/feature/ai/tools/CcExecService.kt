package com.chainlesschain.android.feature.ai.tools

import com.chainlesschain.android.feature.localterminal.LocalFilesystemBootstrapper
import com.chainlesschain.android.feature.localterminal.PtyEnvironment
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import timber.log.Timber
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Runs an allow-listed `cc <command> <subargs>` invocation against the
 * Phase 2.5 Termux-equivalent Node + cc CLI bundle.
 *
 * Design: docs/design/Android_AI_Chat_CC_Exec_Tool.md §3.1 + §4.2.
 * MUST be called AFTER CcAllowlist.check + applyDefaults — no re-validation here.
 */
@Singleton
class CcExecService @Inject constructor(
    private val bootstrapper: LocalFilesystemBootstrapper,
    private val ptyEnvironment: PtyEnvironment,
) {

    suspend fun run(
        command: String,
        subargs: List<String>,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    ): CcResult {
        val node = nodeBinaryPath
        val ccJs = ccJsEntryPath

        if (!File(node).exists()) {
            return CcResult.Error(
                reason = "Termux Node binary missing — open the Local Terminal tab once to trigger Phase 2.5 bootstrap",
                expectedPath = node,
            )
        }
        if (!File(ccJs).exists()) {
            return CcResult.Error(
                reason = "cc CLI snapshot missing — Phase 2.5 assets not extracted, restart app",
                expectedPath = ccJs,
            )
        }

        val argv = buildArgv(node, ccJs, command, subargs)
        val env = buildFilteredEnv()
        val cwd = bootstrapper.homeDir
        return executeArgv(argv, env, cwd, timeoutMs)
    }

    internal fun buildArgv(
        node: String, ccJs: String, command: String, subargs: List<String>,
    ): List<String> = buildList(2 + 1 + subargs.size) {
        add(node); add(ccJs); add(command); addAll(subargs)
    }

    internal fun buildFilteredEnv(): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (kv in ptyEnvironment.envp()) {
            val idx = kv.indexOf('=')
            if (idx <= 0) continue
            val k = kv.substring(0, idx)
            if (FORBIDDEN_ENV_PREFIXES.any { k.startsWith(it) }) continue
            out[k] = kv.substring(idx + 1)
        }
        return out
    }

    internal fun decodeAndTruncate(bytes: ByteArray, limit: Int): String {
        if (bytes.size <= limit) return String(bytes, Charsets.UTF_8)
        val head = String(bytes.copyOf(limit), Charsets.UTF_8)
        return head + "\n... [TRUNCATED, total=${bytes.size} bytes]"
    }

    internal val nodeBinaryPath: String
        get() = "${bootstrapper.prefixDir.absolutePath}/bin/node"

    internal val ccJsEntryPath: String
        get() = "${bootstrapper.prefixDir.absolutePath}/lib/node_modules/chainlesschain/bin/chainlesschain.js"

    internal suspend fun executeArgv(
        argv: List<String>, env: Map<String, String>, cwd: File, timeoutMs: Long,
    ): CcResult = withContext(Dispatchers.IO) {
        val pb = ProcessBuilder(argv).directory(cwd).redirectErrorStream(false)
        pb.environment().clear()
        pb.environment().putAll(env)

        val startedAt = System.currentTimeMillis()
        val proc = try {
            pb.start()
        } catch (e: Exception) {
            return@withContext CcResult.Error("ProcessBuilder.start() failed: ${e.message}")
        }

        try {
            val exited = withTimeoutOrNull(timeoutMs) {
                runInterruptible { proc.waitFor() }
                true
            }
            val durationMs = System.currentTimeMillis() - startedAt

            if (exited == null) {
                destroyProcess(proc)
                CcResult.Error("timeout after ${timeoutMs}ms (process killed)")
            } else {
                val stdoutBytes = proc.inputStream.use { it.readBytes() }
                val stderrBytes = proc.errorStream.use { it.readBytes() }
                CcResult.Ok(
                    exitCode = proc.exitValue(),
                    stdout = decodeAndTruncate(stdoutBytes, STDOUT_TRUNCATE_BYTES),
                    stderr = decodeAndTruncate(stderrBytes, STDERR_TRUNCATE_BYTES),
                    durationMs = durationMs,
                )
            }
        } catch (ce: CancellationException) {
            destroyProcess(proc)
            throw ce
        }
    }

    private fun destroyProcess(proc: Process) {
        if (!proc.isAlive) return
        try {
            proc.destroy()
            if (!proc.waitFor(GRACE_KILL_MS, TimeUnit.MILLISECONDS)) proc.destroyForcibly()
        } catch (e: Exception) {
            Timber.tag(TAG).w(e, "destroyProcess failed")
        }
    }

    companion object {
        private const val TAG = "CcExecService"
        const val DEFAULT_TIMEOUT_MS: Long = 30_000L
        const val STDOUT_TRUNCATE_BYTES: Int = 4096
        const val STDERR_TRUNCATE_BYTES: Int = 4096
        private const val GRACE_KILL_MS: Long = 200L

        val FORBIDDEN_ENV_PREFIXES: List<String> = listOf(
            "OPENAI_", "ANTHROPIC_", "DEEPSEEK_", "DASHSCOPE_",
            "GEMINI_", "VOLCENGINE_", "MOONSHOT_", "ERNIE_",
            "ZHIPU_", "SPARK_", "CC_UI_",
        )
    }
}

sealed class CcResult {
    data class Ok(
        val exitCode: Int,
        val stdout: String,
        val stderr: String,
        val durationMs: Long,
    ) : CcResult()

    data class Error(
        val reason: String,
        val expectedPath: String? = null,
    ) : CcResult()
}
