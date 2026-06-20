package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.social.bilibili.BilibiliLocalCollector
import com.chainlesschain.android.pdh.social.weibo.WeiboLocalCollector
import com.chainlesschain.android.pdh.travel.Kyfw12306LocalCollector
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Phase 1, L3 (app business data via stored login → API) — `collect_app_data`.
 * Dispatches to the cookie-only collectors (no WebSignBridge signing): weibo /
 * bilibili / 12306. Each: Kotlin collector `snapshot()` (uses a stored cookie)
 * → `cc hub sync-adapter <provider>` ingest (decision #15 "方案 i"). When there
 * is no stored credential, returns `assist_required` (design §3.6 human-in-loop:
 * log in via the app, then retry) instead of failing.
 *
 * Signing-gated apps (douyin v0.3 / xhs / toutiao / kuaishou) need WebSignBridge
 * and are intentionally NOT wired here yet — they land once the sign bridge is
 * exposed to the bridge tools.
 *
 * Android-bound (stored creds + network + cc subprocess) → device-validated.
 */
class CollectAppDataTool(
    private val ccRunner: LocalCcRunner,
    private val weibo: WeiboLocalCollector,
    private val bilibili: BilibiliLocalCollector,
    private val kyfw12306: Kyfw12306LocalCollector,
) : PdhTool {

    override val name = "collect_app_data"
    override val description =
        "Collect your data from an app via its stored login (weibo/bilibili/12306) " +
            "into the vault. Returns assist_required (log in via the app first) if " +
            "there is no stored credential."
    override val inputSchema = buildJsonObject {
        put("type", "object")
        putJsonObject("properties") {
            putJsonObject("app") {
                put("type", "string")
                put("description", "App key")
                putJsonArray("enum") { SUPPORTED.forEach { add(it) } }
            }
        }
        putJsonArray("required") { add("app") }
    }

    /** Common shape across the per-collector SnapshotResult sealed types. */
    private data class Snap(
        val path: String?,
        val events: Int,
        val noCreds: Boolean,
        val failed: String?,
    )

    override fun call(args: JsonObject): JsonElement = runBlocking {
        val app = (args["app"] as? JsonPrimitive)?.contentOrNull?.lowercase()
            ?: throw IllegalArgumentException("missing required arg: app")

        val (snap, adapter) = when (app) {
            "weibo" -> toSnap(weibo.snapshot()) to "social-weibo"
            "bilibili" -> toSnap(bilibili.snapshot()) to "social-bilibili"
            "12306" -> toSnap(kyfw12306.snapshot()) to "travel-12306"
            else -> throw IllegalArgumentException(
                "unsupported app: $app (supported: ${SUPPORTED.joinToString()})",
            )
        }

        when {
            snap.noCreds -> buildJsonObject {
                put("status", "assist_required")
                put(
                    "instruction",
                    "请先在 App 内登录「$app」(让 cookie 生效),然后重试 collect_app_data。",
                )
                put("reason", "no stored credentials for $app")
            }
            snap.failed != null -> throw RuntimeException("$app snapshot failed: ${snap.failed}")
            snap.path == null -> throw RuntimeException("$app snapshot produced no data")
            else -> when (val cc = ccRunner.syncAdapter(adapter, snap.path)) {
                is LocalCcRunner.CcResult.Ok -> buildJsonObject {
                    put("status", "ok")
                    put("app", app)
                    put("adapter", adapter)
                    put("collected", snap.events)
                    put("ingested", cc.report.ingested)
                    put("kgTriples", cc.report.kgTriples)
                    put("ragDocs", cc.report.ragDocs)
                }
                is LocalCcRunner.CcResult.Failed ->
                    throw RuntimeException("$adapter sync failed: ${cc.reason}")
            }
        }
    }

    // Per-collector result → common Snap (distinct sealed types, handled each).
    private fun toSnap(r: WeiboLocalCollector.SnapshotResult): Snap = when (r) {
        is WeiboLocalCollector.SnapshotResult.Ok -> Snap(r.snapshotPath, r.totalEvents, false, null)
        is WeiboLocalCollector.SnapshotResult.NoCredentials -> Snap(null, 0, true, null)
        is WeiboLocalCollector.SnapshotResult.Failed -> Snap(null, 0, false, r.reason)
    }

    private fun toSnap(r: BilibiliLocalCollector.SnapshotResult): Snap = when (r) {
        is BilibiliLocalCollector.SnapshotResult.Ok -> Snap(r.snapshotPath, r.totalEvents, false, null)
        is BilibiliLocalCollector.SnapshotResult.NoCredentials -> Snap(null, 0, true, null)
        // Stale/incomplete cookie → treat as "needs login again" (assist).
        is BilibiliLocalCollector.SnapshotResult.StaleCookie -> Snap(null, 0, true, null)
        is BilibiliLocalCollector.SnapshotResult.Failed -> Snap(null, 0, false, r.reason)
    }

    private fun toSnap(r: Kyfw12306LocalCollector.SnapshotResult): Snap = when (r) {
        is Kyfw12306LocalCollector.SnapshotResult.Ok -> Snap(r.snapshotPath, r.totalEvents, false, null)
        is Kyfw12306LocalCollector.SnapshotResult.NoCredentials -> Snap(null, 0, true, null)
        is Kyfw12306LocalCollector.SnapshotResult.Failed -> Snap(null, 0, false, r.reason)
    }

    companion object {
        private val SUPPORTED = listOf("weibo", "bilibili", "12306")
    }
}
