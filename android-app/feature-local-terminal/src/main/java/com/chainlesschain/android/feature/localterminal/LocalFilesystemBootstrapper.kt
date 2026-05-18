package com.chainlesschain.android.feature.localterminal

import android.content.Context
import com.chainlesschain.android.feature.localterminal.BuildConfig
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
    private val context: Context,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {

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
