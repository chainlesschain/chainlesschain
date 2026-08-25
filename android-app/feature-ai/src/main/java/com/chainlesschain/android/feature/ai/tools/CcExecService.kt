package com.chainlesschain.android.feature.ai.tools

import com.chainlesschain.android.feature.localterminal.LocalFilesystemBootstrapper
import com.chainlesschain.android.feature.localterminal.PtyEnvironment
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import timber.log.Timber
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.util.stream.Stream
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
        val launch = try {
            prepareLaunch(argv, cwd)
        } catch (e: Exception) {
            return@withContext CcResult.Error("ProcessBuilder.start() failed: ${e.message}")
        }
        val pb = ProcessBuilder(launch.argv).directory(cwd).redirectErrorStream(false)
        pb.environment().clear()
        pb.environment().putAll(env)

        val startedAt = System.currentTimeMillis()
        val proc = try {
            pb.start()
        } catch (e: Exception) {
            return@withContext CcResult.Error("ProcessBuilder.start() failed: ${e.message}")
        }

        // B28 fix: drain stdout/stderr asynchronously while waiting for exit.
        // JVM pipe buffer (4-64KB platform-dependent) will fill if cc CLI writes
        // more than that without us reading — child blocks on write(), parent
        // blocks on waitFor() → deadlock until timeout. Two async drains keep
        // both pipes flowing. Caps each at PIPE_DRAIN_HARD_LIMIT to avoid OOM
        // on a runaway subprocess; truncation marker is appended on overflow.
        try {
            coroutineScope {
                val stdoutDrain = async(Dispatchers.IO) { drainStream(proc.inputStream) }
                val stderrDrain = async(Dispatchers.IO) { drainStream(proc.errorStream) }
                val exited = withTimeoutOrNull(timeoutMs) {
                    runInterruptible { proc.waitFor() }
                    true
                }
                val durationMs = System.currentTimeMillis() - startedAt

                if (exited == null) {
                    destroyProcessTree(proc, launch.pidFile)
                    // Descendants inherit stdout/stderr. Kill the complete tree before
                    // closing our endpoints so their file descriptors cannot keep the
                    // blocking drain coroutines alive.
                    closeProcessPipes(proc)
                    stdoutDrain.cancelAndJoin(); stderrDrain.cancelAndJoin()
                    CcResult.Error("timeout after ${timeoutMs}ms (process killed)")
                } else {
                    val stdoutBytes = stdoutDrain.await()
                    val stderrBytes = stderrDrain.await()
                    CcResult.Ok(
                        exitCode = proc.exitValue(),
                        stdout = decodeAndTruncate(stdoutBytes, STDOUT_TRUNCATE_BYTES),
                        stderr = decodeAndTruncate(stderrBytes, STDERR_TRUNCATE_BYTES),
                        durationMs = durationMs,
                    )
                }
            }
        } catch (ce: CancellationException) {
            destroyProcessTree(proc, launch.pidFile)
            closeProcessPipes(proc)
            throw ce
        } finally {
            launch.pidFile?.delete()
        }
    }

    /**
     * Android's [Process] API has no pid/descendants methods. On Android only,
     * run the requested argv through a constant shell program which records its
     * pid and then `exec`s `"$@"`. Arguments remain separate and are never
     * interpolated into shell source. JVM 9+ hosts use Process.descendants via
     * reflection and do not need the wrapper.
     */
    private fun prepareLaunch(argv: List<String>, cwd: File): ProcessLaunch {
        if (hasJvmDescendantsApi()) return ProcessLaunch(argv, null)

        val shell = when {
            File(ANDROID_SHELL).canExecute() -> ANDROID_SHELL
            File(UNIX_SHELL).canExecute() -> UNIX_SHELL
            else -> return ProcessLaunch(argv, null)
        }
        val pidFile = File.createTempFile("cc-exec-", ".pid", cwd)
        check(pidFile.delete()) { "cannot prepare process pid file: ${pidFile.absolutePath}" }
        return ProcessLaunch(
            argv = listOf(shell, "-c", PID_CAPTURE_SCRIPT, "cc-exec", pidFile.absolutePath) + argv,
            pidFile = pidFile,
        )
    }

    private fun hasJvmDescendantsApi(): Boolean = Process::class.java.methods.any {
        it.name == "descendants" && it.parameterCount == 0
    }

    /**
     * Drain an InputStream into a ByteArray, capped at [PIPE_DRAIN_HARD_LIMIT] bytes.
     * After cap, continues to read+discard so the child process can keep writing
     * (preserves exit on EOF) but stops accumulating to RAM.
     */
    private fun drainStream(stream: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        var totalKept = 0
        stream.use { input ->
            while (true) {
                val read = try {
                    input.read(buf)
                } catch (_: Exception) { -1 }
                if (read < 0) break
                if (totalKept < PIPE_DRAIN_HARD_LIMIT) {
                    val take = minOf(read, PIPE_DRAIN_HARD_LIMIT - totalKept)
                    out.write(buf, 0, take)
                    totalKept += take
                }
                // Else: keep reading to keep pipe flowing, but discard.
            }
        }
        return out.toByteArray()
    }

    private fun destroyProcessTree(proc: Process, pidFile: File?) {
        val handledByJvm = destroyJvmDescendants(proc)
        if (!handledByJvm) destroyAndroidDescendants(pidFile)
        destroyProcess(proc)
    }

    /**
     * Use Java 9's process-tree API on CI/desktop JVMs without statically
     * referencing ProcessHandle (which is absent from the Android API stubs).
     */
    private fun destroyJvmDescendants(proc: Process): Boolean {
        val descendantsMethod = Process::class.java.methods.firstOrNull {
            it.name == "descendants" && it.parameterCount == 0
        } ?: return false

        return try {
            @Suppress("UNCHECKED_CAST")
            val stream = descendantsMethod.invoke(proc) as Stream<Any>
            val descendants = stream.use { it.iterator().asSequence().toList() }
            val processHandleClass = Class.forName("java.lang.ProcessHandle")
            val destroyForcibly = processHandleClass.getMethod("destroyForcibly")
            val isAlive = processHandleClass.getMethod("isAlive")

            descendants.asReversed().forEach { handle ->
                destroyForcibly.invoke(handle)
            }
            waitForJvmDescendants(descendants, isAlive)
            true
        } catch (e: Throwable) {
            Timber.tag(TAG).w(e, "destroyJvmDescendants failed")
            false
        }
    }

    private fun waitForJvmDescendants(descendants: List<Any>, isAlive: java.lang.reflect.Method) {
        val deadlineNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(DESCENDANT_KILL_GRACE_MS)
        while (System.nanoTime() < deadlineNanos) {
            val anyAlive = descendants.any { handle ->
                try {
                    isAlive.invoke(handle) as Boolean
                } catch (_: Exception) {
                    false
                }
            }
            if (!anyAlive) return
            Thread.sleep(DESCENDANT_POLL_MS)
        }
    }

    /** Android fallback: enumerate the recorded process through Linux procfs. */
    private fun destroyAndroidDescendants(pidFile: File?) {
        val rootPid = try {
            pidFile?.takeIf { it.isFile }?.readText()?.trim()?.toIntOrNull()
        } catch (e: Exception) {
            Timber.tag(TAG).w(e, "read process pid failed")
            null
        } ?: return

        val descendants = collectProcDescendants(rootPid)
        descendants.forEach { pid -> sendAndroidSignal(pid, SIGNAL_TERM) }
        if (descendants.isNotEmpty()) Thread.sleep(DESCENDANT_POLL_MS)
        descendants.filter { File("/proc/$it").exists() }
            .forEach { pid -> sendAndroidSignal(pid, SIGNAL_KILL) }
    }

    private fun collectProcDescendants(rootPid: Int): List<Int> {
        val seen = LinkedHashSet<Int>()
        val postOrder = ArrayList<Int>()

        fun visit(pid: Int, depth: Int) {
            if (depth > MAX_PROCESS_TREE_DEPTH || seen.size >= MAX_PROCESS_TREE_SIZE) return
            val children = try {
                File("/proc/$pid/task/$pid/children").readText()
                    .trim()
                    .split(Regex("\\s+"))
                    .mapNotNull(String::toIntOrNull)
            } catch (_: Exception) {
                emptyList()
            }
            for (child in children) {
                if (child > 0 && seen.add(child)) {
                    visit(child, depth + 1)
                    postOrder += child
                }
            }
        }

        visit(rootPid, 0)
        return postOrder
    }

    private fun sendAndroidSignal(pid: Int, signal: Int) {
        try {
            val osClass = Class.forName("android.system.Os")
            osClass.getMethod("kill", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
                .invoke(null, pid, signal)
        } catch (e: Throwable) {
            Timber.tag(TAG).w(e, "kill(%d, %d) failed", pid, signal)
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

    private fun closeProcessPipes(proc: Process) {
        for (stream in listOf(proc.inputStream, proc.errorStream, proc.outputStream)) {
            try {
                stream.close()
            } catch (e: Exception) {
                Timber.tag(TAG).d(e, "closeProcessPipes failed")
            }
        }
    }

    companion object {
        private const val TAG = "CcExecService"
        const val DEFAULT_TIMEOUT_MS: Long = 30_000L
        const val STDOUT_TRUNCATE_BYTES: Int = 4096
        const val STDERR_TRUNCATE_BYTES: Int = 4096
        // B28 fix: cap drained pipe bytes per stream. 256KB headroom over the
        // 4KB displayed limit covers any reasonable cc CLI output while bounding
        // worst-case memory under a runaway subprocess.
        internal const val PIPE_DRAIN_HARD_LIMIT: Int = 256 * 1024
        private const val GRACE_KILL_MS: Long = 200L
        private const val DESCENDANT_KILL_GRACE_MS: Long = 200L
        private const val DESCENDANT_POLL_MS: Long = 10L
        private const val MAX_PROCESS_TREE_DEPTH: Int = 64
        private const val MAX_PROCESS_TREE_SIZE: Int = 1024
        private const val SIGNAL_TERM: Int = 15
        private const val SIGNAL_KILL: Int = 9
        private const val ANDROID_SHELL: String = "/system/bin/sh"
        private const val UNIX_SHELL: String = "/bin/sh"
        private const val PID_CAPTURE_SCRIPT: String =
            "printf '%s\\n' \"\u0024\u0024\" > \"\u00241\"; shift; exec \"\u0024@\""

        val FORBIDDEN_ENV_PREFIXES: List<String> = listOf(
            "OPENAI_", "ANTHROPIC_", "DEEPSEEK_", "DASHSCOPE_",
            "GEMINI_", "VOLCENGINE_", "MOONSHOT_", "ERNIE_",
            "ZHIPU_", "SPARK_", "CC_UI_",
        )
    }
}

private data class ProcessLaunch(
    val argv: List<String>,
    val pidFile: File?,
)

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
