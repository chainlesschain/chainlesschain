package com.chainlesschain.android.pdh.social.common

/**
 * Phase B0 — shared contract for root-mode in-APK PDH collectors.
 *
 * The 6 platforms targeted by the multipath plan (Bilibili / Weibo /
 * Xhs / Douyin / Toutiao / Kuaishou) implement this interface for
 * path-B (APK-internal root + local DB read). WeChat and QQ predate
 * this abstraction and keep their bespoke `SnapshotResult` nested
 * classes; do NOT migrate them — HubLocalViewModel + 50+ unit tests
 * already pattern-match on those types.
 *
 * Design choices, lifted from WeChatLocalCollector / QQLocalCollector:
 *
 *  - `Ok` carries a free-form `perCategoryCounts: Map<String, Int>`
 *    instead of WeChat's hard-coded `contactCount/messageCount/
 *    chatroomCount` so each platform can describe its own taxonomy
 *    (Douyin: "msg" / "follow"; Bilibili: "history" / "favorite") —
 *    callers iterate the map instead of switching on field names.
 *  - `diagnosticFields: Map<String, String>` carries platform-specific
 *    one-off context (keyProvider, pragmaProfile, libVersion). UI
 *    renders these inline; tests assert specific keys per platform.
 *  - `NoDbKey(provider)` carries WHICH provider's key was missing so
 *    error banners can say "frida hook never ran" vs "saved md5 key
 *    rotated".
 *
 * See `docs/design/PDH_Social_Multipath_Local_Collection_Plan.md`
 * §5.1 for the rationale and §6 for per-platform mapping.
 */
interface LocalRootCollector {

    /**
     * Run a single end-to-end sync. Implementations must:
     *   1. Check credentials → return [LocalSnapshotResult.NoCredentials]
     *      if user hasn't completed account dialog
     *   2. Check root via [RootShellRunner.isSuAvailable] → return
     *      [LocalSnapshotResult.NoRoot] if device isn't rooted (UI
     *      should then surface a "改用桌面端" deep-link)
     *   3. Extract DB cohort via [DbCohortCopier] + decrypt (platform-
     *      specific) + dump staging JSON
     *   4. On success record sync via the platform's credentials store
     *      and return [LocalSnapshotResult.Ok] with the staging path
     *      that `cc hub sync-adapter <plat> --input <path>` consumes
     *
     * Must be safe to call concurrently from multiple coroutines —
     * implementations should guard with an internal Mutex (Bootstrap
     * race [[android-bootstrap-singleton-mutex-race]]).
     */
    suspend fun snapshot(): LocalSnapshotResult
}

/**
 * Shared error taxonomy. Platform implementations return one of these;
 * HubLocalViewModel maps each to a banner string + suggested action.
 *
 * Compared to WeChat's nested SnapshotResult:
 *  - `contactCount/messageCount/chatroomCount` → `perCategoryCounts` Map
 *  - `keyProvider` (WeChat-specific) → `diagnosticFields` Map
 *  - `FridaInjectFailed` (WeChat-only) → folded into `Failed("frida-...")`
 *    with the same reason strings so UI can still discriminate by prefix
 */
sealed class LocalSnapshotResult {

    /**
     * Snapshot written to disk. [snapshotPath] is the absolute path to
     * a JSON file containing the platform's PDH events array.
     */
    data class Ok(
        val snapshotPath: String,
        val totalEvents: Int,
        /**
         * Per-category breakdown, e.g.
         *   {"msg": 1234, "follow": 56, "favorite": 7}
         * Sum must equal [totalEvents]. UI uses this for the per-card
         * "1234 条消息 / 56 个关注 / 7 条收藏" subtext.
         */
        val perCategoryCounts: Map<String, Int>,
        val snapshottedAt: Long,
        /**
         * Free-form platform-specific context. Common keys (not enforced):
         *  - "keyProvider"   — md5 / frida / xor / plain
         *  - "pragmaProfile" — wcdb-legacy / sqlcipher-v3 / sqlcipher-v4
         *  - "libVersion"    — target app version code from PackageManager
         *  - "schemaVersion" — collector snapshot schema version
         */
        val diagnosticFields: Map<String, String> = emptyMap(),
    ) : LocalSnapshotResult()

    /** User hasn't entered uid / platform-specific creds yet. */
    object NoCredentials : LocalSnapshotResult()

    /** Device isn't rooted (su not available). */
    object NoRoot : LocalSnapshotResult()

    /**
     * SQLCipher path — key extraction never produced a usable key.
     * [provider] tells UI whether to suggest "re-trigger frida hook"
     * vs "re-enter IMEI for md5 derivation".
     */
    data class NoDbKey(val provider: String) : LocalSnapshotResult()

    /**
     * DB copy / open / dump failed. [reason] is a short stable code
     * for tests; [message] is the human-readable tail for UI.
     *
     * Standard reason codes (other platforms may add their own):
     *   - "source-db-missing"  — app not installed or wrong uid
     *   - "copy-failed"        — su cp returned non-zero
     *   - "decrypt-failed"     — SQLCipher rejected key
     *   - "frida-binary-missing" / "frida-hook-timeout" / "frida-inject-failed"
     *   - "schema-drift"       — required table / column not found
     */
    data class ExtractFailed(val reason: String, val message: String? = null) : LocalSnapshotResult()

    /** Catch-all for anything not classified above. */
    data class Failed(val reason: String, val message: String? = null) : LocalSnapshotResult()
}
