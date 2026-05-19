package com.chainlesschain.android.feature.localterminal

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
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
 * Phase 2.5 — also injects LLM API keys from the app's encrypted prefs so
 * `cc ask`, `cc agent` etc work out of the box once the user has set a key
 * in the AI settings UI. See [loadLlmKeyEnvs] for the mapping. Empty keys
 * are skipped (no `KEY=` blank entry).
 *
 * Notable omissions until Phase 5:
 *
 *  - **No `LD_PRELOAD=$PREFIX/lib/libtermux-exec.so`** — termux-exec
 *    vendoring is deferred to Sub-phase 5.4 (only matters when bundled
 *    scripts use shebangs like `#!/usr/bin/env python`).
 */
@Singleton
class PtyEnvironment @Inject constructor(
    @ApplicationContext private val context: Context,
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
            // Phase 2.5 — Node.js DT_RUNPATH was patched to $ORIGIN, so libnode.so
            // finds libcrypto/libssl/libicu* in the same lib/<abi>/ dir. But
            // libnode itself is exec'd via the `$PREFIX/bin/node` symlink whose
            // parent dir is bin/ — to keep the loader happy across symlink
            // chains, also set LD_LIBRARY_PATH explicitly.
            "LD_LIBRARY_PATH" to "$prefix/lib",
            // Where global node_modules live — chainlesschain CLI is installed
            // under $PREFIX/lib/node_modules/, so `require()` resolution from
            // the shim binary picks it up.
            "NODE_PATH" to "$prefix/lib/node_modules",
        )

        // Layer order: defaults < LLM key envs < caller-provided extras.
        val merged = defaults + loadLlmKeyEnvs() + extra
        return merged.entries
            .map { (k, v) -> "$k=$v" }
            .toTypedArray()
    }

    /**
     * Read LLM API keys from the app's `llm_config_secure` EncryptedSharedPreferences
     * (managed by feature-ai's LLMConfigManager) and project them onto the env-var
     * names cc CLI expects (see packages/cli/src/lib/llm-providers.js apiKeyEnv).
     *
     * Empty values are dropped — better to surface "API key not set" from cc
     * than to confuse it with an empty string. Returning an empty map on any
     * read error keeps the terminal bootstrap robust against EncryptedSharedPreferences
     * corruption / first-launch races.
     *
     * Keep this list in sync with:
     *   feature-ai/.../data/config/LLMConfig.kt#loadSensitiveFields()  ← source-of-truth
     *   packages/cli/src/lib/llm-providers.js#apiKeyEnv                 ← consumer
     */
    private fun loadLlmKeyEnvs(): Map<String, String> = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        val prefs = EncryptedSharedPreferences.create(
            context,
            "llm_config_secure",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
        // PrefKey from LLMConfig.kt → env var name from cc CLI's llm-providers.js
        // (apiKeyEnv field). Ernie/ChatGLM/Spark have no cc CLI standard env name;
        // we use sensible fallbacks (ERNIE_API_KEY etc) so cc can pick them up via
        // env-var-by-provider lookup if the provider gets wired in later.
        val mapping = listOf(
            "openai.apiKey" to "OPENAI_API_KEY",
            "anthropic.apiKey" to "ANTHROPIC_API_KEY",
            "deepseek.apiKey" to "DEEPSEEK_API_KEY",
            "qwen.apiKey" to "DASHSCOPE_API_KEY",
            "gemini.apiKey" to "GEMINI_API_KEY",
            "volcengine.apiKey" to "VOLCENGINE_API_KEY",
            "moonshot.apiKey" to "MOONSHOT_API_KEY",
            "ernie.apiKey" to "ERNIE_API_KEY",
            "chatglm.apiKey" to "ZHIPU_API_KEY",
            "spark.apiKey" to "SPARK_API_KEY",
        )
        mapping.mapNotNull { (prefKey, envName) ->
            val value = prefs.getString(prefKey, "") ?: ""
            if (value.isNotBlank()) envName to value else null
        }.toMap().also { keys ->
            if (keys.isNotEmpty()) {
                Timber.tag("PtyEnv").i(
                    "Injected ${keys.size} LLM key envs from app config: ${keys.keys}"
                )
            }
        }
    } catch (e: Exception) {
        Timber.tag("PtyEnv").w(e, "Failed reading llm_config_secure; cc CLI will need manual env keys")
        emptyMap()
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
