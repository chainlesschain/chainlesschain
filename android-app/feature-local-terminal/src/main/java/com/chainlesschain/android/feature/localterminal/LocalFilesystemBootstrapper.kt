package com.chainlesschain.android.feature.localterminal

import android.content.Context
import com.chainlesschain.android.feature.localterminal.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File
import java.nio.file.Files
import java.nio.file.Paths
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 2 — set up the `$PREFIX` filesystem skeleton that LocalPtyClient
 * spawns shells against. Idempotent + APK-upgrade-safe.
 *
 * Layout produced under `<filesDir>/usr/`:
 *
 *   usr/
 *   ├── bin/
 *   │   ├── mksh         → ../lib/libmksh.so
 *   │   ├── sh           → ../lib/libmksh.so
 *   │   └── <toybox cmds>→ ../lib/libtoybox.so  (only when libtoybox is built)
 *   ├── etc/
 *   │   ├── profile
 *   │   ├── mkshrc
 *   │   └── motd
 *   ├── lib/
 *   │   ├── libmksh.so   → <APK nativeLibraryDir>/libmksh.so
 *   │   └── libtoybox.so → <APK nativeLibraryDir>/libtoybox.so  (when built)
 *   ├── share/doc/
 *   ├── tmp/
 *   └── .bootstrap_version  (sentinel = BuildConfig.USR_VERSION)
 *
 * The `$HOME = <filesDir>/home/` is created separately (independent of
 * `$PREFIX`; user data persists across $PREFIX rebootstrap).
 *
 * On every `bootstrap()` invocation:
 *
 *  1. If `.bootstrap_version != BuildConfig.USR_VERSION`, wipe `$PREFIX` and
 *     reconstruct the static layout.
 *  2. ALWAYS relink `lib/lib*.so` to the current APK's `nativeLibraryDir` —
 *     APK upgrade moves that path (different install UUID), so stale
 *     absolute symlinks would break exec.
 *  3. ALWAYS sync `bin/<cmd>` symlinks to whatever libraries exist in lib/ —
 *     missing libraries (e.g. libtoybox.so on a Windows-host build) are
 *     simply skipped.
 *
 * Design choice: inline profile/mkshrc/motd text strings instead of shipping
 * `assets/usr.tar.xz` — the static content is < 1 KB compressed, so the
 * tarball overhead is not worth the extra build-time tooling. Phase 5
 * Sub-phase 2.5 will introduce `assets/` for Node.js + chainlesschain CLI
 * (separate, larger snapshot).
 */
@Singleton
class LocalFilesystemBootstrapper @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    // Hilt @Inject ctor can't have Kotlin-defaulted args, so the ioDispatcher
    // knob is hard-coded. Tests that need a deterministic dispatcher should
    // wrap calls in runBlocking with a TestScope rather than swapping it.
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO

    /** Returns the `$PREFIX` directory; safe to call before bootstrap (no
     *  side effects). */
    val prefixDir: File get() = File(context.filesDir, "usr")

    /** Returns the `$HOME` directory. Created lazily on bootstrap. */
    val homeDir: File get() = File(context.filesDir, "home")

    /** Returns `$TMPDIR` under `$PREFIX`. */
    val tmpDir: File get() = File(prefixDir, "tmp")

    /** Returns the APK's per-ABI native library directory containing
     *  libmksh.so / libtoybox.so / libpty_jni.so. Re-read every bootstrap
     *  because APK upgrade may change the path. */
    private val nativeLibraryDir: File
        get() = File(context.applicationInfo.nativeLibraryDir)

    /**
     * Initialise `$PREFIX` if needed, then relink dynamic symlinks against
     * the current APK install path. Safe to call repeatedly.
     *
     * @return Result.success(true) on first-time bootstrap (full extract),
     *         Result.success(false) when only relink was required (version
     *         match), Result.failure on IO error.
     */
    suspend fun bootstrap(): Result<Boolean> = withContext(ioDispatcher) {
        try {
            val versionFile = File(prefixDir, ".bootstrap_version")
            val targetVersion = BuildConfig.USR_VERSION
            val fullExtract = !versionFile.exists() ||
                versionFile.readText().trim() != targetVersion

            if (fullExtract) {
                Timber.tag(TAG).i("Bootstrapping \$PREFIX (target version $targetVersion)")
                wipeAndRecreate()
                writeStaticFiles()
            }

            // Always: relink lib + bin symlinks. APK upgrade may have moved
            // nativeLibraryDir, and new ABI binaries may have landed since
            // last bootstrap.
            relinkLibraries()
            relinkBinSymlinks()
            relinkNodeIfPresent()

            // Phase 2.5 — extract chainlesschain CLI snapshot from assets
            // (if present). Idempotent: re-extract only when the bundled
            // version differs from the on-disk one.
            extractCcCliIfPresent()

            // Ensure $HOME / $TMPDIR exist (untouched by $PREFIX rebootstrap).
            homeDir.mkdirs()
            tmpDir.mkdirs()

            if (fullExtract) {
                versionFile.writeText(targetVersion)
            }
            Result.success(fullExtract)
        } catch (t: Throwable) {
            Timber.tag(TAG).e(t, "Bootstrap failed")
            Result.failure(t)
        }
    }

    private fun wipeAndRecreate() {
        if (prefixDir.exists() && !prefixDir.deleteRecursively()) {
            throw java.io.IOException("Could not wipe stale \$PREFIX at $prefixDir")
        }
        listOf(
            prefixDir,
            File(prefixDir, "bin"),
            File(prefixDir, "etc"),
            File(prefixDir, "lib"),
            File(prefixDir, "share"),
            File(prefixDir, "share/doc"),
            File(prefixDir, "tmp"),
        ).forEach { dir ->
            if (!dir.mkdirs() && !dir.isDirectory) {
                throw java.io.IOException("Could not create \$PREFIX subdir: $dir")
            }
        }
    }

    private fun writeStaticFiles() {
        File(prefixDir, "etc/profile").writeText(profileContents())
        File(prefixDir, "etc/mkshrc").writeText(mkshrcContents())
        File(prefixDir, "etc/motd").writeText(motdContents())
    }

    /**
     * Re-create `lib/lib*.so` as symlinks pointing at the APK's current
     * `nativeLibraryDir`. Removes stale links from previous APK installs
     * (different install UUID).
     */
    private fun relinkLibraries() {
        val libDir = File(prefixDir, "lib")
        libDir.mkdirs()
        // Wipe any pre-existing lib/*.so symlinks; we re-establish below.
        libDir.listFiles()?.forEach { it.delete() }

        nativeLibraryDir.listFiles()
            ?.filter { it.name.endsWith(".so") }
            ?.forEach { soInApk ->
                val link = File(libDir, soInApk.name)
                try {
                    Files.createSymbolicLink(link.toPath(), soInApk.toPath())
                } catch (e: Exception) {
                    Timber.tag(TAG).w(e, "Failed to symlink ${soInApk.name}")
                }
            }
    }

    /**
     * Re-create `bin/<cmd>` symlinks pointing at `../lib/<library>.so`.
     *
     * - `bin/mksh` and `bin/sh` always point at `../lib/libmksh.so`.
     * - Each entry in [TOYBOX_COMMANDS] gets a `bin/<cmd>` → `../lib/libtoybox.so`
     *   symlink ONLY IF `lib/libtoybox.so` actually exists (i.e. the toybox
     *   build wasn't skipped on Windows). Missing toybox = clean skip; mksh
     *   still works.
     */
    private fun relinkBinSymlinks() {
        val binDir = File(prefixDir, "bin")
        binDir.mkdirs()
        binDir.listFiles()?.forEach { it.delete() }

        val mkshLib = File(prefixDir, "lib/libmksh.so")
        val toyboxLib = File(prefixDir, "lib/libtoybox.so")

        if (mkshLib.exists()) {
            createBinSymlink(binDir, "mksh", "../lib/libmksh.so")
            createBinSymlink(binDir, "sh", "../lib/libmksh.so")
        } else {
            Timber.tag(TAG).w("libmksh.so missing in \$PREFIX/lib; bin/mksh+sh skipped")
        }

        if (toyboxLib.exists()) {
            TOYBOX_COMMANDS.forEach { cmd ->
                createBinSymlink(binDir, cmd, "../lib/libtoybox.so")
            }
        } else {
            Timber.tag(TAG).i(
                "libtoybox.so not in \$PREFIX/lib (likely Windows-host build); " +
                    "skipping ${TOYBOX_COMMANDS.size} bin/<cmd> symlinks"
            )
        }
    }

    /**
     * Phase 2.5 — establish `$PREFIX/bin/node` if Termux Node.js binary
     * (`libnode.so`) shipped in our APK. Also creates `$PREFIX/bin/npm`
     * if npm-cli.js was extracted (see [extractCcCliIfPresent]).
     *
     * libnode.so is the relocated Termux Node 25 binary with RUNPATH
     * patched to `$ORIGIN` — it loads libcrypto/libssl/libicu* from the
     * same lib/<abi>/ directory at runtime. See workflow
     * `node-runtime-bundle.yml` for the patchelf details.
     */
    private fun relinkNodeIfPresent() {
        val libDir = File(prefixDir, "lib")
        val binDir = File(prefixDir, "bin")
        val nodeLib = File(libDir, "libnode.so")
        if (!nodeLib.exists()) {
            Timber.tag(TAG).i("libnode.so absent — \$PREFIX/bin/node not created (Phase 2.5 not bundled)")
            return
        }
        createBinSymlink(binDir, "node", "../lib/libnode.so")
        Timber.tag(TAG).i("\$PREFIX/bin/node → ../lib/libnode.so wired")
    }

    /**
     * Phase 2.5 — extract `assets/local-terminal/cc-cli.tgz` (if shipped)
     * to `$PREFIX/lib/node_modules/chainlesschain/`, then symlink
     * `$PREFIX/bin/{cc,chainlesschain,npm}` to the right node-modules
     * entries.
     *
     * Idempotent via `$PREFIX/var/lib/cc/.bundled-version` sentinel
     * matched against [BuildConfig.USR_VERSION] (bumped at the same
     * time as the rest of \$PREFIX changes).
     */
    private fun extractCcCliIfPresent() {
        val tgzAsset = "local-terminal/cc-cli.tgz"
        val markerFile = File(prefixDir, "var/lib/cc/.bundled-version")
        val targetVersion = BuildConfig.USR_VERSION

        // Skip if asset isn't shipped (Phase 0-4 baseline). openFd() throws
        // on compressed assets — AGP deflates .tgz inside the APK unless
        // listed in `aaptOptions.noCompress`. AssetManager.open() handles
        // both forms, so we probe by opening + reading one byte.
        val assetPresent = try {
            context.assets.open(tgzAsset).use { it.read() != -1 }
        } catch (_: Exception) {
            false
        }
        if (!assetPresent) {
            Timber.tag(TAG).i("$tgzAsset absent — cc CLI not bundled (Phase 2.5 not landed)")
            return
        }

        val ccModule = File(prefixDir, "lib/node_modules/chainlesschain")
        if (markerFile.exists() &&
            markerFile.readText().trim() == targetVersion &&
            ccModule.isDirectory
        ) {
            // Already extracted at this version — just refresh symlinks.
            wireCcCliSymlinks()
            return
        }

        Timber.tag(TAG).i("Extracting cc CLI snapshot from $tgzAsset")
        if (ccModule.exists()) ccModule.deleteRecursively()
        ccModule.parentFile?.mkdirs()

        context.assets.open(tgzAsset).use { tgzIn ->
            java.util.zip.GZIPInputStream(tgzIn).use { gzIn ->
                extractTarToDir(gzIn, ccModule)
            }
        }
        wireCcCliSymlinks()

        markerFile.parentFile?.mkdirs()
        markerFile.writeText(targetVersion)
        Timber.tag(TAG).i("cc CLI snapshot extracted → ${ccModule.absolutePath}")
    }

    /**
     * Create `$PREFIX/bin/{cc,chainlesschain,clc,clchain}` as wrapper shell
     * scripts (NOT symlinks).
     *
     * Why not symlinks: the cc CLI entrypoint is `chainlesschain.js` whose
     * shebang is `#!/usr/bin/env node` — Android has no `/usr/bin/env`, so
     * the kernel would fail with ENOENT when execve()ing the .js. We
     * sidestep this by wrapping with a `/system/bin/sh` shim that exec's
     * our bundled node directly.
     *
     * `/system/bin/sh` exists on all Android M+ devices (mksh upstream).
     * Absolute paths into `$PREFIX` are safe because filesDir is stable
     * across APK upgrades (only the per-version SHA in /data/app/<pkg>-<x>
     * changes, and that's nativeLibraryDir not filesDir).
     */
    private fun wireCcCliSymlinks() {
        val binDir = File(prefixDir, "bin")
        val prefix = prefixDir.absolutePath
        val wrapper = """
            |#!/system/bin/sh
            |# Auto-generated by LocalFilesystemBootstrapper.wireCcCliSymlinks().
            |# Avoids the `#!/usr/bin/env node` shebang trap on Android.
            |exec "$prefix/bin/node" "$prefix/lib/node_modules/chainlesschain/bin/chainlesschain.js" "${'$'}@"
            |""".trimMargin()
        for (name in listOf("cc", "chainlesschain", "clc", "clchain")) {
            val script = File(binDir, name)
            // Clean up legacy symlink shape if upgrading from earlier 2.5 attempt.
            if (java.nio.file.Files.isSymbolicLink(script.toPath()) || script.exists()) {
                script.delete()
            }
            try {
                script.writeText(wrapper)
                script.setExecutable(true, false)
            } catch (e: Exception) {
                Timber.tag(TAG).w(e, "bin/$name wrapper write failed")
            }
        }
    }

    /**
     * Minimal tar reader — extracts an uncompressed tar stream to [destDir].
     * Handles regular files, directories, and symlinks. Hand-rolled to avoid
     * the commons-compress ~600KB dep (the module already declares
     * `org.tukaani:xz` for gzip not needed; GZIPInputStream is JDK-built-in).
     */
    private fun extractTarToDir(tarIn: java.io.InputStream, destDir: File) {
        val buf = ByteArray(512)
        destDir.mkdirs()
        while (true) {
            // Read tar header (512 bytes per block)
            var read = 0
            while (read < 512) {
                val n = tarIn.read(buf, read, 512 - read)
                if (n < 0) return  // EOF, normal termination
                read += n
            }
            // All zeros = end-of-archive marker
            if (buf.all { it == 0.toByte() }) return

            val name = parseTarString(buf, 0, 100)
            if (name.isEmpty()) return
            val sizeOctal = parseTarString(buf, 124, 12).trim()
            val size = if (sizeOctal.isEmpty()) 0L else sizeOctal.toLong(8)
            val typeFlag = buf[156].toInt().toChar()
            val linkName = parseTarString(buf, 157, 100)
            val prefix = parseTarString(buf, 345, 155)
            val fullName = if (prefix.isNotEmpty()) "$prefix/$name" else name

            // npm pack output starts with `package/` — strip the leading
            // segment so we extract directly into destDir (matching `tar
            // --strip-components=1` behaviour).
            val effective = fullName.removePrefix("package/")
            if (effective.isEmpty() || effective.startsWith("/")) {
                skipPadding(tarIn, size)
                continue
            }
            val target = File(destDir, effective)

            when (typeFlag) {
                '5' -> target.mkdirs()  // directory
                '2' -> {                // symlink
                    target.parentFile?.mkdirs()
                    if (target.exists()) target.delete()
                    try {
                        Files.createSymbolicLink(target.toPath(), Paths.get(linkName))
                    } catch (_: Exception) {
                        // ignore — symlinks in npm packs are rare
                    }
                }
                else -> {                // regular file (also covers ' ')
                    target.parentFile?.mkdirs()
                    target.outputStream().use { fileOut ->
                        var remaining = size
                        while (remaining > 0) {
                            val want = minOf(remaining, 8192L).toInt()
                            val tmp = ByteArray(want)
                            var got = 0
                            while (got < want) {
                                val n = tarIn.read(tmp, got, want - got)
                                if (n < 0) return  // truncated
                                got += n
                            }
                            fileOut.write(tmp, 0, got)
                            remaining -= got
                        }
                    }
                }
            }
            skipPadding(tarIn, size)
        }
    }

    private fun parseTarString(buf: ByteArray, off: Int, len: Int): String {
        val end = (off until off + len).firstOrNull { buf[it] == 0.toByte() } ?: (off + len)
        return String(buf, off, end - off, Charsets.UTF_8)
    }

    private fun skipPadding(input: java.io.InputStream, size: Long) {
        // tar pads each entry to 512-byte boundary
        val pad = ((size + 511) / 512 * 512 - size).toInt()
        var remaining = pad
        while (remaining > 0) {
            val n = input.skip(remaining.toLong())
            if (n <= 0) break
            remaining -= n.toInt()
        }
    }

    private fun createBinSymlink(binDir: File, name: String, target: String) {
        val link = File(binDir, name)
        try {
            Files.createSymbolicLink(link.toPath(), Paths.get(target))
        } catch (e: Exception) {
            Timber.tag(TAG).w(e, "bin/$name symlink failed")
        }
    }

    // ${'$'} inside triple-quoted strings combined with mksh parameter
    // expansion like ${PWD##*/} confuses the Kotlin lexer (false "unclosed
    // comment" diagnostic). We write `__D__` as a sentinel for the literal
    // dollar character and replace at runtime — robust across Kotlin versions.
    private fun profileContents(): String = """
        # Generated by ChainlessChain LocalFilesystemBootstrapper.
        # Loaded by mksh -l. Keep changes idempotent — file is regenerated on
        # every USR_VERSION bump.

        PREFIX="__D__{PREFIX:-${prefixDir.absolutePath}}"
        export PATH="__D__PREFIX/bin:/system/bin:/system/xbin"
        export HOME="__D__{HOME:-${homeDir.absolutePath}}"
        export TMPDIR="__D__{TMPDIR:-${tmpDir.absolutePath}}"
        export SHELL="__D__PREFIX/bin/mksh"
        export TERM="__D__{TERM:-xterm-256color}"
        export LANG="__D__{LANG:-en_US.UTF-8}"
        # Static prompt — `__D__{PWD##` + slashstar + `}` would trip the Kotlin
        # lexer's nested-block-comment handling when this string sits in a
        # triple-quoted literal. We use `cc>` instead.
        export PS1='cc> '

        if [ -f "__D__PREFIX/etc/motd" ] && [ -z "__D__MOTD_SHOWN" ]; then
            cat "__D__PREFIX/etc/motd"
            MOTD_SHOWN=1
            export MOTD_SHOWN
        fi
    """.trimIndent().replace("__D__", "\$") + "\n"

    private fun mkshrcContents(): String = """
        # Per-shell mksh rc — loaded for interactive sessions.
        # ChainlessChain LocalFilesystemBootstrapper-generated; do not edit.

        # Reasonable history defaults.
        HISTFILE="__D__HOME/.mksh_history"
        HISTSIZE=1000

        # Useful aliases.
        alias ll='ls -la'
        alias ..='cd ..'
        alias ...='cd ../..'
    """.trimIndent().replace("__D__", "\$") + "\n"

    private fun motdContents(): String = """
        ChainlessChain Local Terminal
        =============================
        Powered by mksh (MirOS Korn Shell) on Android.

        Type `help` for built-in mksh commands, or any binary on __D__PATH.
        Bundled toybox provides: ls, cat, grep, find, ps, df, du, awk, sed, ...

        __D__PREFIX = ${prefixDir.absolutePath}
        __D__HOME   = ${homeDir.absolutePath}

    """.trimIndent().replace("__D__", "\$") + "\n"

    companion object {
        private const val TAG = "LocalFsBootstrap"

        /**
         * Toybox subcommands enabled in `kconfig/android_miniconfig`. When a
         * Linux/macOS CI build produces `libtoybox.so`, [relinkBinSymlinks]
         * creates `$PREFIX/bin/<cmd>` for each entry pointing at it.
         *
         * Curated subset of the ~250 commands in toybox android_miniconfig;
         * focused on commands users actually run interactively. Add more
         * here as needed — toybox dispatches by argv[0] so any of its
         * built-in commands work once symlinked.
         */
        internal val TOYBOX_COMMANDS = listOf(
            // Filesystem
            "ls", "cat", "cp", "mv", "rm", "mkdir", "rmdir", "ln", "find",
            "stat", "touch", "chmod", "chown", "chgrp", "df", "du", "pwd",
            "readlink", "realpath", "basename", "dirname", "file",
            // Text processing
            "echo", "grep", "egrep", "fgrep", "sed", "awk", "cut", "sort",
            "uniq", "tr", "head", "tail", "wc", "tee", "tac",
            // Process / system
            "ps", "kill", "killall", "uname", "whoami", "id", "groups",
            "uptime", "free", "date", "hostname", "env", "printenv",
            "true", "false", "yes", "sleep", "sync",
            // Archive / compression (often toybox-provided on Android)
            "tar", "gzip", "gunzip", "zcat",
            // Networking diag (limited under untrusted_app)
            "nc", "ping",
            // Misc
            "which", "test", "[", "expr", "seq", "rev", "base64", "md5sum",
            "sha1sum", "sha256sum",
        )
    }
}
