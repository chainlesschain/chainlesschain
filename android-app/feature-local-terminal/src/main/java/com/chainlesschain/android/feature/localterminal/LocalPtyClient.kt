package com.chainlesschain.android.feature.localterminal

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import timber.log.Timber
import java.util.concurrent.atomic.AtomicReference

/**
 * Coroutine wrapper over [PtyNative] that owns one pty + one child process for
 * the lifetime of a single shell session.
 *
 * Phase 1.2 surface (per docs/design/Android_Local_Terminal.md §4 Sub-phase 1.2):
 *
 *   suspend fun start(cfg: PtySessionConfig): Result<Unit>
 *   fun writeStdin(bytes: ByteArray)
 *   val stdoutFlow: SharedFlow<ByteArray>
 *   val exitFlow: SharedFlow<Int>
 *   fun resize(rows: Int, cols: Int)
 *   suspend fun shutdown()
 *
 * Threading model:
 *
 *  - The [readLoop] coroutine blocks on JNI read() — it lives on an IO
 *    dispatcher (default [Dispatchers.IO]) and is unblocked either by EOF
 *    (slave hangup propagated as 0 from JNI) or by closing the master fd
 *    from outside via [shutdown].
 *  - [writeStdin] is synchronous wrt the JNI write() syscall; serialised by
 *    [writeMutex] so concurrent callers never interleave bytes mid-buffer.
 *    Mutex is OK to block the calling thread briefly because a pty master
 *    write only suspends on a full kernel buffer (4-16 KB), which is rare
 *    for terminal-paced input.
 *  - [shutdown] sequences SIGTERM (try [PtyNative.killpg] first per Phase 1.1
 *    diagnostic showing pgid==pid works; fall back to [PtyNative.kill] if
 *    killpg returns ESRCH) → wait up to [shutdownGracePeriodMs] for waitpid
 *    → SIGKILL → final waitpid. All bracketed by [stateLock] so a second
 *    shutdown call no-ops.
 */
class LocalPtyClient(
    private val scope: CoroutineScope,
    private val native: PtyNative = DefaultPtyNative(),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val shutdownGracePeriodMs: Long = 5_000L,
) {
    enum class State { IDLE, STARTING, RUNNING, SHUTTING_DOWN, EXITED }

    data class Config(
        val executable: String,
        val argv: Array<String>,
        val envp: Array<String>,
        val cwd: String? = null,
        val rows: Int = 24,
        val cols: Int = 80,
        /** Read-loop chunk size — typically 8 KB is the sweet spot for pty
         *  master reads on Linux/Android. */
        val readBufferSize: Int = 8192,
    )

    /** PTY/process state. AtomicReference so reads in [shutdown] and [start]
     *  see a coherent value without holding [stateLock] for the whole check. */
    private val stateRef = AtomicReference(State.IDLE)
    val state: State get() = stateRef.get()

    private val stateLock = Mutex()
    private val writeMutex = Mutex()

    private var masterFd: Int = -1
    private var childPid: Int = -1
    private var readJob: Job? = null
    private var waitJob: Job? = null

    private val _stdoutFlow = MutableSharedFlow<ByteArray>(
        replay = 0,
        extraBufferCapacity = 256,
    )
    val stdoutFlow: SharedFlow<ByteArray> = _stdoutFlow.asSharedFlow()

    private val _exitFlow = MutableSharedFlow<Int>(
        replay = 1,
        extraBufferCapacity = 0,
    )
    val exitFlow: SharedFlow<Int> = _exitFlow.asSharedFlow()

    /** Open a pty, spawn the child, start read+wait loops. Returns IDEMPOTENT
     *  success if already running; returns failure if a previous shutdown
     *  hasn't completed. */
    suspend fun start(config: Config): Result<Unit> = stateLock.withLock {
        when (stateRef.get()) {
            State.RUNNING -> return@withLock Result.success(Unit)
            State.STARTING, State.SHUTTING_DOWN -> return@withLock Result.failure(
                PtyException("Cannot start: state=${stateRef.get()}")
            )
            State.EXITED -> return@withLock Result.failure(
                PtyException("Cannot restart an EXITED client; create a new instance")
            )
            State.IDLE -> { /* fall through */ }
        }
        stateRef.set(State.STARTING)

        val fds = native.openPty()
        if (fds.size != 2 || fds[0] < 0) {
            stateRef.set(State.IDLE)
            return@withLock Result.failure(
                PtyException("openPty failed: errno=${-fds[0]}")
            )
        }
        masterFd = fds[0]
        val slaveFd = fds[1]

        // Push initial window size before spawning so the child's first read
        // of TIOCGWINSZ returns sane dimensions.
        native.setWinsize(masterFd, config.rows, config.cols, 0, 0)

        val pid = native.spawn(
            slaveFd, masterFd,
            config.executable, config.argv, config.envp, config.cwd,
        )
        if (pid <= 0) {
            native.close(masterFd)
            masterFd = -1
            stateRef.set(State.IDLE)
            return@withLock Result.failure(
                PtyException("spawn failed: errno=${-pid}")
            )
        }
        childPid = pid
        stateRef.set(State.RUNNING)

        readJob = scope.launch(ioDispatcher) { readLoop(config.readBufferSize) }
        waitJob = scope.launch(ioDispatcher) { waitLoop() }

        Result.success(Unit)
    }

    /** Write bytes to the pty master. Blocks briefly under [writeMutex] if a
     *  concurrent write is in flight. Throws if the session is not RUNNING. */
    suspend fun writeStdin(bytes: ByteArray): Int {
        val s = stateRef.get()
        if (s != State.RUNNING) {
            throw PtyException("writeStdin in state=$s; expected RUNNING")
        }
        if (bytes.isEmpty()) return 0

        return writeMutex.withLock {
            // Re-check after acquiring the lock — shutdown may have raced.
            if (stateRef.get() != State.RUNNING) {
                throw PtyException("writeStdin: state changed to ${stateRef.get()} during lock wait")
            }
            withContext(ioDispatcher) {
                var written = 0
                while (written < bytes.size) {
                    val n = native.write(masterFd, bytes, written, bytes.size - written)
                    if (n <= 0) {
                        // Negative errno or EOF on master is fatal for writes.
                        throw PtyException("write failed at offset=$written errno=${-n}")
                    }
                    written += n
                }
                written
            }
        }
    }

    /** Push a new terminal size to the master pty. Best-effort: errors are
     *  logged but do not throw because resize is typically non-critical. */
    fun resize(rows: Int, cols: Int) {
        val fd = masterFd
        if (fd < 0 || stateRef.get() != State.RUNNING) return
        val rc = native.setWinsize(fd, rows, cols, 0, 0)
        if (rc != 0) {
            Timber.tag("LocalPtyClient").w("setWinsize($rows,$cols) failed: errno=${-rc}")
        }
    }

    /**
     * Escalate child termination: SIGTERM → wait gracePeriodMs → SIGKILL →
     * waitpid → close master.
     *
     * Safe to call multiple times: idempotent under [stateLock]. Safe to call
     * before [start] (no-op). Safe to call from any coroutine.
     */
    suspend fun shutdown() {
        stateLock.withLock {
            val s = stateRef.get()
            if (s == State.IDLE || s == State.EXITED) return@withLock
            if (s == State.SHUTTING_DOWN) return@withLock  // already in progress
            stateRef.set(State.SHUTTING_DOWN)

            val pid = childPid
            if (pid > 0) {
                // Try killpg first (covers any grandchildren mksh forked). If
                // that returns ESRCH (Phase 1.1 trap on Xiaomi/MIUI), fall
                // back to plain kill on the recorded pid.
                val killpgRc = native.killpg(pid, LocalPtyNative.SIGTERM)
                if (killpgRc < 0) {
                    Timber.tag("LocalPtyClient").d(
                        "killpg($pid, TERM) -> errno=${-killpgRc}; falling back to kill()"
                    )
                    val killRc = native.kill(pid, LocalPtyNative.SIGTERM)
                    if (killRc < 0) {
                        Timber.tag("LocalPtyClient").w(
                            "kill($pid, TERM) -> errno=${-killRc} (process may already be gone)"
                        )
                    }
                }

                // waitJob is the only thing that calls waitpid; await it.
                val reaped = withTimeoutOrNull(shutdownGracePeriodMs) {
                    waitJob?.join()
                }
                if (reaped == null) {
                    // Escalate. SIGKILL by either pg or pid; we don't care which works.
                    Timber.tag("LocalPtyClient").w(
                        "SIGTERM grace period elapsed; escalating to SIGKILL"
                    )
                    native.killpg(pid, LocalPtyNative.SIGKILL)
                    native.kill(pid, LocalPtyNative.SIGKILL)
                    waitJob?.join()
                }
            }

            // Stop the read loop. Closing the master fd makes the blocked
            // read() return either 0 (EOF) or -EBADF, which the loop treats
            // as terminal.
            if (masterFd >= 0) {
                native.close(masterFd)
                masterFd = -1
            }
            readJob?.join()

            childPid = -1
            stateRef.set(State.EXITED)
        }
    }

    private suspend fun readLoop(bufferSize: Int) {
        val buf = ByteArray(bufferSize)
        try {
            while (true) {
                val fd = masterFd
                if (fd < 0) break
                val n = native.read(fd, buf, 0, buf.size)
                when {
                    n > 0 -> {
                        val chunk = buf.copyOfRange(0, n)
                        // Suspend if the consumer hasn't drained the buffer —
                        // typical terminal output is bursty, so 256 slots is
                        // usually plenty. emit() over tryEmit() is intentional
                        // (we don't want to silently drop user-visible bytes).
                        _stdoutFlow.emit(chunk)
                    }
                    n == 0 -> {
                        // EOF — slave hangup, child has closed all writers.
                        break
                    }
                    else -> {
                        // Real error. EBADF means the master fd was closed
                        // from another thread (shutdown); treat as terminal.
                        if (-n != LocalPtyNative.EBADF) {
                            Timber.tag("LocalPtyClient").e("read failed: errno=${-n}")
                        }
                        break
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (t: Throwable) {
            Timber.tag("LocalPtyClient").e(t, "readLoop crashed")
        }
    }

    private suspend fun waitLoop() {
        val pid = childPid
        if (pid <= 0) return
        try {
            val exitCode = withContext(ioDispatcher) { native.waitpid(pid) }
            _exitFlow.emit(exitCode)
        } catch (e: CancellationException) {
            throw e
        } catch (t: Throwable) {
            Timber.tag("LocalPtyClient").e(t, "waitLoop crashed")
        }
    }
}

/** Thrown when the pty/child enters an unexpected state. */
class PtyException(message: String) : RuntimeException(message)
