package com.chainlesschain.android.feature.localterminal

/**
 * Thin abstraction over [LocalPtyNative] JNI calls so [LocalPtyClient] can be
 * unit-tested with a fake on the host JVM (no real .so loading required).
 *
 * Semantics mirror [LocalPtyNative] exactly — see that class's KDoc for the
 * positive/negative-errno return convention and the "slave fd is closed in
 * parent after spawn" rule.
 */
interface PtyNative {
    fun openPty(): IntArray
    fun spawn(
        slaveFd: Int,
        masterFd: Int,
        executable: String,
        argv: Array<String>,
        envp: Array<String>,
        cwd: String?
    ): Int
    fun write(masterFd: Int, data: ByteArray, offset: Int, length: Int): Int
    fun read(masterFd: Int, buffer: ByteArray, offset: Int, length: Int): Int
    fun setWinsize(masterFd: Int, rows: Int, cols: Int, xpixel: Int, ypixel: Int): Int
    fun killpg(pid: Int, signum: Int): Int
    fun kill(pid: Int, signum: Int): Int
    fun getpgid(pid: Int): Int
    fun waitpid(pid: Int): Int
    fun close(fd: Int): Int
}

/** Production [PtyNative] — delegates to the real JNI bridge. */
class DefaultPtyNative
internal constructor(
    private val native: LocalPtyNative,
) : PtyNative {
    /** Public ctor used outside the module: uses the canonical
     *  [LocalPtyNative] JNI bridge. The internal ctor above lets unit tests
     *  inject a fake [LocalPtyNative] without exposing the internal class
     *  through the public ABI. */
    constructor() : this(LocalPtyNative())

    override fun openPty() = native.nativeOpenPty()
    override fun spawn(
        slaveFd: Int,
        masterFd: Int,
        executable: String,
        argv: Array<String>,
        envp: Array<String>,
        cwd: String?
    ) = native.nativeSpawn(slaveFd, masterFd, executable, argv, envp, cwd)

    override fun write(masterFd: Int, data: ByteArray, offset: Int, length: Int) =
        native.nativeWrite(masterFd, data, offset, length)

    override fun read(masterFd: Int, buffer: ByteArray, offset: Int, length: Int) =
        native.nativeRead(masterFd, buffer, offset, length)

    override fun setWinsize(masterFd: Int, rows: Int, cols: Int, xpixel: Int, ypixel: Int) =
        native.nativeSetWinsize(masterFd, rows, cols, xpixel, ypixel)

    override fun killpg(pid: Int, signum: Int) = native.nativeKillpg(pid, signum)
    override fun kill(pid: Int, signum: Int) = native.nativeKill(pid, signum)
    override fun getpgid(pid: Int) = native.nativeGetpgid(pid)
    override fun waitpid(pid: Int) = native.nativeWaitpid(pid)
    override fun close(fd: Int) = native.nativeClose(fd)
}
