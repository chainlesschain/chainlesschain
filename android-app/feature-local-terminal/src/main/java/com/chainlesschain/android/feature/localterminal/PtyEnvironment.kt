package com.chainlesschain.android.feature.localterminal

import javax.inject.Inject
import javax.inject.Singleton

/**
 * Builds the env-var array passed to [LocalPtyClient.Config.envp] for shells
 * started against the `$PREFIX` layout produced by [LocalFilesystemBootstrapper].
 *
 * Centralising env construction here keeps a single source of truth — the
 * design doc §5 Trap 8 catalogues the PATH / TMPDIR / shebang gotchas; the
 * defaults below sidestep all of them.
 *
 * Phase 2 contract (subject to change in Phase 5 when termux-exec lands):
 *
 *  PATH      = $PREFIX/bin : /system/bin : /system/xbin
 *  HOME      = <filesDir>/home
 *  TMPDIR    = $PREFIX/tmp
 *  SHELL     = $PREFIX/bin/mksh
 *  TERM      = xterm-256color  (overrideable)
 *  LANG      = en_US.UTF-8     (overrideable)
 *  PREFIX    = absolute path to $PREFIX  (for scripts that need it)
 *  ENV       = $PREFIX/etc/profile  (mksh loads on -l)
 *
 * Notable omissions until Phase 5:
 *
 *  - **No `LD_PRELOAD=$PREFIX/lib/libtermux-exec.so`** — termux-exec
 *    vendoring is deferred to Sub-phase 5.4 (only matters when bundled
 *    scripts use shebangs like `#!/usr/bin/env python`).
 *  - **No PATH entry for `node_modules/.bin`** — the chainlesschain CLI
 *    snapshot lands in Phase 5 too.
 */
@Singleton
class PtyEnvironment @Inject constructor(
    private val bootstrapper: LocalFilesystemBootstrapper,
) {

    /**
     * Build env-var array suitable for [LocalPtyClient.Config.envp].
     *
     * @param extra additional or overriding env entries. `extra` keys
     *              override defaults; e.g. `mapOf("TERM" to "dumb")` for
     *              tests that don't want xterm escapes.
     * @return Array of `KEY=VALUE` strings.
     */
    fun envp(extra: Map<String, String> = emptyMap()): Array<String> {
        val prefix = bootstrapper.prefixDir.absolutePath
        val home = bootstrapper.homeDir.absolutePath
        val tmp = bootstrapper.tmpDir.absolutePath

        val defaults = mapOf(
            "PATH" to "$prefix/bin:/system/bin:/system/xbin",
            "HOME" to home,
            "TMPDIR" to tmp,
            "SHELL" to "$prefix/bin/mksh",
            "TERM" to "xterm-256color",
            "LANG" to "en_US.UTF-8",
            "PREFIX" to prefix,
            "ENV" to "$prefix/etc/profile",
        )

        val merged = defaults + extra
        return merged.entries
            .map { (k, v) -> "$k=$v" }
            .toTypedArray()
    }

    /**
     * Convenience for the canonical mksh-interactive invocation:
     * `[$PREFIX/bin/mksh, -l]` — `-l` makes mksh a login shell so it sources
     * `$PREFIX/etc/profile` and our defaults take effect inside the shell.
     */
    fun mkshLoginArgv(): Array<String> {
        val mksh = "${bootstrapper.prefixDir.absolutePath}/bin/mksh"
        return arrayOf(mksh, "-l")
    }

    /** Path to the mksh executable symlink in `$PREFIX/bin`. */
    val mkshExecutable: String
        get() = "${bootstrapper.prefixDir.absolutePath}/bin/mksh"
}
