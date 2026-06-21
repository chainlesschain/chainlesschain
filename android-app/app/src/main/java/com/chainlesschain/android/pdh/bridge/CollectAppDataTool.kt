package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.social.douyin.DouyinLocalCollector
import com.chainlesschain.android.pdh.social.douyin.DouyinSignBridge
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouLocalCollector
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouSignBridge
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoLocalCollector
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoSignBridge
import com.chainlesschain.android.pdh.social.weibo.WeiboLocalCollector
import com.chainlesschain.android.pdh.social.bilibili.BilibiliLocalCollector
import com.chainlesschain.android.pdh.social.xiaohongshu.XhsLocalCollector
import com.chainlesschain.android.pdh.social.xiaohongshu.XhsSignBridge
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
 * Dispatches to the on-device app collectors and ingests via
 * `cc hub sync-adapter <provider>` (decision #15 "方案 i", reuses the proven L2
 * ingest path — no cc-bundle change needed). When there is no stored credential,
 * returns `assist_required` (design §3.6 human-in-loop: log in via the app, then
 * retry) instead of failing.
 *
 * Two classes of collector:
 *   - cookie-only (no signing): weibo / bilibili / 12306
 *   - signing-gated (WebSignBridge): douyin / xiaohongshu / toutiao / kuaishou —
 *     the tool wires the collector's `signProvider` to the matching SignBridge
 *     for the call, then shuts the bridge down (the bridge handles its WebView
 *     on Dispatchers.Main internally, so it's safe from this background call).
 *
 * Android-bound (stored creds + network + WebView + cc subprocess) → validated
 * on-device (needs a real logged-in account for a full collect).
 */
class CollectAppDataTool(
    private val ccRunner: LocalCcRunner,
    private val weibo: WeiboLocalCollector,
    private val bilibili: BilibiliLocalCollector,
    private val kyfw12306: Kyfw12306LocalCollector,
    private val douyin: DouyinLocalCollector,
    private val douyinSign: DouyinSignBridge,
    private val xhs: XhsLocalCollector,
    private val xhsSign: XhsSignBridge,
    private val toutiao: ToutiaoLocalCollector,
    private val toutiaoSign: ToutiaoSignBridge,
    private val kuaishou: KuaishouLocalCollector,
    private val kuaishouSign: KuaishouSignBridge,
) : PdhTool {

    override val name = "collect_app_data"
    override val description =
        "Collect your data from an app via its stored login into the vault " +
            "(weibo/bilibili/12306/douyin/xiaohongshu/toutiao/kuaishou). Returns " +
            "assist_required (log in via the app first) if there is no stored credential."
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
            "douyin" -> signed(douyinSign) {
                douyin.signProvider = douyinSign
                toSnap(douyin.snapshot())
            } to "social-douyin"
            "xiaohongshu", "xhs" -> signed(xhsSign) {
                xhs.signProvider = xhsSign
                toSnap(xhs.snapshot())
            } to "social-xiaohongshu"
            "toutiao" -> signed(toutiaoSign) {
                toutiao.signProvider = toutiaoSign
                toSnap(toutiao.snapshot())
            } to "social-toutiao"
            "kuaishou" -> signed(kuaishouSign) {
                kuaishou.signProvider = kuaishouSign
                toSnap(kuaishou.snapshot())
            } to "social-kuaishou"
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
                // §3.5.15: a correlation token so the chat's 引导卡 can resume via
                // {type:resume,token,…} (structured) instead of a plain user turn.
                put("resumeToken", "collect_app_data:$app")
                // §3.6: one-tap "打开 App" — the chat opens this target so the user
                // doesn't have to manually switch apps to log in. The package name
                // (no scheme) is launched by getLaunchIntentForPackage on the UI side.
                APP_PACKAGES[app]?.let { put("deepLink", it) }
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

    /** Run a signing-gated snapshot, always shutting the WebView bridge after. */
    private inline fun signed(
        sign: com.chainlesschain.android.pdh.social.SignProvider,
        block: () -> Snap,
    ): Snap = try {
        block()
    } finally {
        sign.shutdown()
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
        is BilibiliLocalCollector.SnapshotResult.StaleCookie -> Snap(null, 0, true, null)
        is BilibiliLocalCollector.SnapshotResult.Failed -> Snap(null, 0, false, r.reason)
    }

    private fun toSnap(r: Kyfw12306LocalCollector.SnapshotResult): Snap = when (r) {
        is Kyfw12306LocalCollector.SnapshotResult.Ok -> Snap(r.snapshotPath, r.totalEvents, false, null)
        is Kyfw12306LocalCollector.SnapshotResult.NoCredentials -> Snap(null, 0, true, null)
        is Kyfw12306LocalCollector.SnapshotResult.Failed -> Snap(null, 0, false, r.reason)
    }

    private fun toSnap(r: DouyinLocalCollector.SnapshotResult): Snap = when (r) {
        is DouyinLocalCollector.SnapshotResult.Ok -> Snap(r.snapshotPath, r.totalEvents, false, null)
        is DouyinLocalCollector.SnapshotResult.NoCredentials -> Snap(null, 0, true, null)
        is DouyinLocalCollector.SnapshotResult.Failed -> Snap(null, 0, false, r.reason)
    }

    private fun toSnap(r: XhsLocalCollector.SnapshotResult): Snap = when (r) {
        is XhsLocalCollector.SnapshotResult.Ok -> Snap(r.snapshotPath, r.totalEvents, false, null)
        is XhsLocalCollector.SnapshotResult.NoCredentials -> Snap(null, 0, true, null)
        is XhsLocalCollector.SnapshotResult.Failed -> Snap(null, 0, false, r.reason)
    }

    private fun toSnap(r: ToutiaoLocalCollector.SnapshotResult): Snap = when (r) {
        is ToutiaoLocalCollector.SnapshotResult.Ok -> Snap(r.snapshotPath, r.totalEvents, false, null)
        is ToutiaoLocalCollector.SnapshotResult.NoCredentials -> Snap(null, 0, true, null)
        is ToutiaoLocalCollector.SnapshotResult.Failed -> Snap(null, 0, false, r.reason)
    }

    private fun toSnap(r: KuaishouLocalCollector.SnapshotResult): Snap = when (r) {
        is KuaishouLocalCollector.SnapshotResult.Ok -> Snap(r.snapshotPath, r.totalEvents, false, null)
        is KuaishouLocalCollector.SnapshotResult.NoCredentials -> Snap(null, 0, true, null)
        is KuaishouLocalCollector.SnapshotResult.Failed -> Snap(null, 0, false, r.reason)
    }

    companion object {
        private val SUPPORTED =
            listOf("weibo", "bilibili", "12306", "douyin", "xiaohongshu", "toutiao", "kuaishou")

        /** app key → Android package, for the 引导卡's one-tap "打开 App" (§3.6). */
        private val APP_PACKAGES = mapOf(
            "weibo" to "com.sina.weibo",
            "bilibili" to "tv.danmaku.bili",
            "12306" to "com.MobileTicket",
            "douyin" to "com.ss.android.ugc.aweme",
            "xiaohongshu" to "com.xingin.xhs",
            "toutiao" to "com.ss.android.article.news",
            "kuaishou" to "com.smile.gifmaker",
        )
    }
}
