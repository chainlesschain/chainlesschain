package com.chainlesschain.android.pdh.social.wechat

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 12.10.4 — extracts the SQLCipher key from a live WeChat 8.0+
 * process via frida-inject.
 *
 * **STATUS**: stub only. Real injection requires a rooted Android device
 * + frida-inject arm64-v8a binary embedded in app `assets/frida/`.
 * Verification cannot happen on a Win dev box — see
 * [`docs/design/Android_WeChat_InApp_Frida_Collector.md`](../../../../../../../../../docs/design/Android_WeChat_InApp_Frida_Collector.md) §5
 * for the real-device sub-phases (12.10.4 + 12.10.6).
 *
 * Architecture (Approach A from the design doc §3.2.1):
 *
 *   1. Copy bundled `frida-inject-{arm64,arm}` from `assets/frida/` to
 *      `${filesDir}/frida-inject` + chmod 0755. App filesDir has W^X
 *      restrictions on Android 10+, so we go through `su -c cp ...` and
 *      land the binary at /data/local/tmp/ (executable from any context).
 *   2. Copy `wechat-key-hook.js` (mirrored from desktop side
 *      `packages/personal-data-hub/lib/adapters/wechat/frida-agent/`)
 *      to the same temp dir.
 *   3. Spawn `su -c "/data/local/tmp/frida-inject -p $(pidof com.tencent.mm)
 *      -s /data/local/tmp/wechat-key-hook.js --runtime=v8"`.
 *   4. Read frida-message lines from stdout, parse JSON, extract the
 *      sqlite3_key_v2 args[1] payload (32 bytes raw → 64 hex chars).
 *   5. Kill frida-inject process (it persists across WeChat reopens
 *      otherwise + WeChat anti-detection might flag the long-lived child).
 *
 * Failure modes:
 *   - `NoRoot` — `su` not on PATH or returned non-zero
 *   - `BinaryMissing` — assets/frida/frida-inject-* not bundled (build issue)
 *   - `PidofFailed` — WeChat not running (user must open WeChat first)
 *   - `HookTimedOut` — frida attached but sqlite3_key_v2 never fired in
 *                      30s window (user must trigger a chat action to
 *                      cause WeChat to open the encrypted DB)
 *   - `InjectFailed` — frida-inject returned non-zero (typically because
 *                       MIUI 14+ blocks the binary as anti-debug)
 */
@Singleton
class WeChatFridaInjector @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    sealed class KeyResult {
        data class Ok(val dbKeyHex: String, val durationMs: Long) : KeyResult()
        object NoRoot : KeyResult()
        object BinaryMissing : KeyResult()
        object PidofFailed : KeyResult()
        object HookTimedOut : KeyResult()
        data class InjectFailed(val exitCode: Int, val stderr: String) : KeyResult()
    }

    /**
     * Extract the SQLCipher key for the given uin. Returns within 30s
     * either with the key or a failure code.
     *
     * **STUB**: real implementation is Phase 12.10.4. This always returns
     * [KeyResult.BinaryMissing] so the calling collector falls through to
     * the desktop-path-please banner. See design doc §3.2.1 for the real
     * implementation sketch.
     */
    suspend fun extractKey(uin: String, timeoutMs: Long = 30_000): KeyResult =
        withContext(Dispatchers.IO) {
            Timber.w(
                "WeChatFridaInjector.extractKey called for uin=%s — STUB " +
                    "(Phase 12.10.4 not yet implemented). Falling back to BinaryMissing.",
                uin,
            )
            // TODO(Phase 12.10.4):
            //   1. assertSuAvailable() else return NoRoot
            //   2. assertBinariesBundled() else return BinaryMissing
            //   3. copyAndChmodBinaries()
            //   4. val wxPid = runSu("pidof com.tencent.mm").trim().toIntOrNull()
            //         ?: return@withContext KeyResult.PidofFailed
            //   5. val proc = runSu("frida-inject -p $wxPid -s wechat-key-hook.js")
            //   6. parse stdout JSON lines for sqlite3_key_v2 payload
            //   7. on payload hit: kill proc, return Ok(hex, duration)
            //   8. on timeoutMs without hit: kill proc, return HookTimedOut
            KeyResult.BinaryMissing
        }

    /**
     * Check whether `su` is on PATH and returns successfully. Public so
     * the collector can short-circuit before attempting extraction.
     *
     * **STUB**: real check is `Runtime.exec(arrayOf("which", "su"))` +
     * `Runtime.exec(arrayOf("su", "-c", "id"))` with uid=0 assertion.
     */
    suspend fun isSuAvailable(): Boolean = withContext(Dispatchers.IO) {
        // TODO(Phase 12.10.1): proper su availability check via Runtime.exec
        // For now, optimistically return true so the orchestrator gets to
        // the real failure path in extractKey().
        true
    }
}
