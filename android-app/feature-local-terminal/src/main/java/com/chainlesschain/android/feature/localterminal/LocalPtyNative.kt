package com.chainlesschain.android.feature.localterminal

/**
 * Thin JNI surface for the local-terminal PTY (Phase 1.1).
 *
 * All native methods return their value via positive ints / arrays, and signal
 * failure with **negative errno** values. The Kotlin layer ([LocalPtyClient]
 * in Phase 1.2) translates these into typed [PtyException]s; this class is
 * deliberately allocation-light and exception-free so it can be called from
 * tight IO loops.
 *
 * Method conventions:
 *
 *  - [nativeOpenPty] — returns `[masterFd, slaveFd]`. If `masterFd < 0`, that
 *    int is the negated errno and the slot at index 1 is `-1`.
 *  - [nativeSpawn] — returns the spawned child's pid (positive) or `-errno`.
 *    The slave fd is always closed in the parent after spawn (success or
 *    failure), so the caller MUST NOT use it again.
 *  - [nativeRead] — blocking; returns `0` on EOF (slave hangup translated
 *    from EIO), positive bytes-read otherwise, `-errno` on real failure.
 *  - [nativeWrite] — returns bytes-written or `-errno`. Short writes are
 *    legal; caller loops.
 *  - [nativeSetWinsize] / [nativeKillpg] / [nativeClose] — `0` on success,
 *    `-errno` on failure.
 *  - [nativeWaitpid] — exit status `0..255` for normal exit, `-signum`
 *    (negative) when the process was killed by a signal. The conventional
 *    POSIX encoding (`WEXITSTATUS`/`WTERMSIG`) is preserved.
 *
 * Threading: a JVM thread that calls [nativeRead] blocks until data arrives
 * or the slave hangs up. Callers must invoke from a dedicated IO dispatcher
 * thread (e.g. `Dispatchers.IO`); never from `Main` or from a coroutine that
 * needs to be cancellable mid-syscall (the syscall doesn't honor coroutine
 * cancellation — only `nativeClose(masterFd)` from another thread will
 * unblock it).
 */
internal class LocalPtyNative {

    init {
        ensureLoaded()
    }

    /** Sanity probe, returns "phase-1.1-real-pty" (was "phase-0.1-skeleton"
     *  before this phase landed). */
    external fun nativeVersion(): String

    /** Allocate a master/slave pty pair. Returned IntArray is always length 2.
     *  On success both fds are >= 0; on failure `[masterFd] < 0` carries the
     *  negated errno. */
    external fun nativeOpenPty(): IntArray

    /**
     * Spawn a child with [executable] using [argv] arguments and [envp]
     * environment. Child's stdin/stdout/stderr are redirected to [slaveFd];
     * the parent retains [masterFd] for I/O.
     *
     * IMPORTANT: on return the slave fd is *closed in the parent* regardless
     * of success — never reuse it.
     *
     * @return child pid (positive) on success, `-errno` on failure.
     */
    external fun nativeSpawn(
        slaveFd: Int,
        masterFd: Int,
        executable: String,
        argv: Array<String>,
        envp: Array<String>,
        cwd: String?
    ): Int

    /**
     * Write [length] bytes from [data] starting at [offset] to [masterFd].
     * Short writes are possible; caller loops on partial writes.
     */
    external fun nativeWrite(
        masterFd: Int,
        data: ByteArray,
        offset: Int,
        length: Int
    ): Int

    /**
     * Blocking read up to [length] bytes from [masterFd] into [buffer] at
     * [offset]. Returns `0` when the child has closed all writers (slave
     * hangup → EIO → translated to EOF).
     */
    external fun nativeRead(
        masterFd: Int,
        buffer: ByteArray,
        offset: Int,
        length: Int
    ): Int

    /** Set terminal dimensions. xpixel/ypixel can be 0 if unknown. */
    external fun nativeSetWinsize(
        masterFd: Int,
        rows: Int,
        cols: Int,
        xpixel: Int,
        ypixel: Int
    ): Int

    /** Send [signum] (e.g. SIGTERM=15, SIGKILL=9) to the process group rooted
     *  at [pid]. Kills the shell and any descendants it spawned — IFF
     *  POSIX_SPAWN_SETSID actually elevated the child to a new pgroup at
     *  spawn time. Verify via [nativeGetpgid] first; prefer [nativeKill] if
     *  pgid != pid. */
    external fun nativeKillpg(pid: Int, signum: Int): Int

    /** Send [signum] to a single [pid] (not the process group). Safer
     *  fallback when [nativeKillpg] returns -ESRCH because the spawn-time
     *  POSIX_SPAWN_SETSID didn't elevate the child. */
    external fun nativeKill(pid: Int, signum: Int): Int

    /** Read the process-group id of [pid] (or 0 = self). Used to verify
     *  whether POSIX_SPAWN_SETSID actually applied — if `pgid != pid`, the
     *  child stayed in our pgroup and [nativeKillpg] will not work. */
    external fun nativeGetpgid(pid: Int): Int

    /** Block until [pid] exits. Returns exit code 0..255 for normal exit, or
     *  the negative of the signal that killed it. */
    external fun nativeWaitpid(pid: Int): Int

    /** Close an fd (used to drop master fd without going through waitpid). */
    external fun nativeClose(fd: Int): Int

    companion object {
        @Volatile
        private var libraryLoaded = false

        @JvmStatic
        fun ensureLoaded() {
            if (!libraryLoaded) synchronized(this) {
                if (!libraryLoaded) {
                    System.loadLibrary("pty_jni")
                    libraryLoaded = true
                }
            }
        }

        // POSIX signal numbers (Linux/Android values; keep these as constants
        // here instead of hard-coding magic numbers at call sites).
        const val SIGINT  = 2
        const val SIGKILL = 9
        const val SIGTERM = 15

        // Common errno values that the Kotlin layer wants to discriminate.
        const val EAGAIN = 11
        const val EBADF  = 9
        const val EINVAL = 22
        const val ENOENT = 2
        const val EIO    = 5
        const val EPERM  = 1
    }
}
