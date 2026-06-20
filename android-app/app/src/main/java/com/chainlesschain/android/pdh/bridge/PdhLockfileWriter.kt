package com.chainlesschain.android.pdh.bridge

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.security.SecureRandom

/**
 * Writes / removes the PDH-bridge discovery lockfile that the CLI's reader
 * (packages/cli/src/lib/pdh-bridge.js `parseLock`) consumes:
 *   <appFiles>/.chainlesschain/pdh-bridge/<port>.json   (file 0600, dir 0700)
 *
 * Schema mirrors that reader exactly: kind="pdh-bridge" / version / transport=
 * "http" / url (localhost) / port / device / appUid / token / pid / started_at.
 * Pure JVM (java.io.File + kotlinx JSON) → unit-testable with a temp dir.
 *
 * On Android the lock dir lives under the app's private files dir, already
 * per-uid sandboxed; the 0600/0700 chmod is best-effort belt-and-suspenders
 * (matches the IDE bridge's LockfileWriter).
 */
class PdhLockfileWriter(private val dir: File) {

    fun lockDir(): File = dir

    /** Write (or overwrite) the lockfile for a running server. Returns the file. */
    fun write(
        port: Int,
        token: String,
        url: String,
        device: String,
        appUid: Int,
        startedAt: Long,
        pid: Long,
    ): File {
        dir.mkdirs()
        restrictDir(dir)

        val lock = buildJsonObject {
            put("kind", "pdh-bridge")
            put("version", 1)
            put("transport", "http")
            put("url", url)
            put("port", port)
            put("device", device)
            put("appUid", appUid)
            put("token", token)
            put("pid", pid)
            put("started_at", startedAt)
        }

        val file = File(dir, "$port.json")
        file.writeText(lock.toString(), Charsets.UTF_8)
        restrictFile(file)
        return file
    }

    /** Remove the lockfile for a port. Returns true if a file was deleted. */
    fun remove(port: Int): Boolean = File(dir, "$port.json").delete()

    private fun restrictDir(d: File) {
        // ownerOnly=true → strip group/other, keep owner. Best-effort (Android
        // app dir is already per-uid; no-op on filesystems that ignore it).
        d.setReadable(false, false); d.setReadable(true, true)
        d.setWritable(false, false); d.setWritable(true, true)
        d.setExecutable(false, false); d.setExecutable(true, true)
    }

    private fun restrictFile(f: File) {
        f.setReadable(false, false); f.setReadable(true, true)
        f.setWritable(false, false); f.setWritable(true, true)
    }

    companion object {
        /** A fresh 256-bit hex bearer token (matches the IDE bridge token shape). */
        fun generateToken(): String {
            val b = ByteArray(32)
            SecureRandom().nextBytes(b)
            return b.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        }
    }
}
