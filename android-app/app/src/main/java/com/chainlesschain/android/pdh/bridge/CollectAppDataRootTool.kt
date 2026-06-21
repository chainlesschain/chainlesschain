package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.social.bilibili.BilibiliRootDbCollector
import com.chainlesschain.android.pdh.social.common.LocalRootCollector
import com.chainlesschain.android.pdh.social.common.LocalSnapshotResult
import com.chainlesschain.android.pdh.social.douyin.DouyinRootDbCollector
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouRootDbCollector
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoRootDbCollector
import com.chainlesschain.android.pdh.social.weibo.WeiboRootDbCollector
import com.chainlesschain.android.pdh.social.xiaohongshu.XhsRootDbCollector
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
 * Phase 4 / L4 — `collect_app_data_root`: collect an app's data by reading its
 * local databases directly via ROOT (no cookie / no API call). Mirrors
 * `HubLocalViewModel.sync<App>Root`, exposed as an agent-callable tool so the
 * agent can autonomously try the root path as an alternative to
 * `collect_app_data` (cookie) — supporting the "多种方法一起、采到就行" flow.
 * Reuses the proven [LocalRootCollector]s + the same `cc hub sync-adapter`
 * ingest path; original app DBs are READ-ONLY (decision: 原库只读).
 *
 * Honest scope (decision #13 诚实降级): per-app DB schema/encryption is
 * collector-version-gated and largely "未验证" (v0.1 assumes plaintext SQLite;
 * SQLCipher apps surface `Failed("likely-sqlcipher")` with a frida hint). The
 * account uid is seeded by a one-time 本机数据 cookie login; full zero-login
 * needs root uid auto-discovery (future). When seeded, re-collection reproduces
 * with no login — the user's reproducibility requirement.
 */
class CollectAppDataRootTool(
    private val ccRunner: LocalCcRunner,
    private val weiboRoot: WeiboRootDbCollector,
    private val bilibiliRoot: BilibiliRootDbCollector,
    private val douyinRoot: DouyinRootDbCollector,
    private val xhsRoot: XhsRootDbCollector,
    private val toutiaoRoot: ToutiaoRootDbCollector,
    private val kuaishouRoot: KuaishouRootDbCollector,
) : PdhTool {

    override val name = "collect_app_data_root"
    override val description =
        "Collect an app's data by reading its local databases directly via ROOT " +
            "(no cookie/API; no login once the account is seeded) — " +
            "weibo/bilibili/douyin/xiaohongshu/toutiao/kuaishou. Prefer this as an " +
            "automatic alternative when collect_app_data has no stored cookie and " +
            "the device is rooted. Returns assist_required if root is unavailable " +
            "or the account uid hasn't been seeded yet."
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

    override fun call(args: JsonObject): JsonElement = runBlocking {
        val app = (args["app"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
        val (collector, adapter) = resolve(app)
        when (val snap = collector.snapshot()) {
            is LocalSnapshotResult.NoRoot ->
                throw RuntimeException("device is not rooted; root DB read requires root")
            is LocalSnapshotResult.NoCredentials -> buildJsonObject {
                put("status", "assist_required")
                put(
                    "instruction",
                    "root 直采「$app」还差账号 uid:请到 首页 → 本机数据 完成一次「$app」登录" +
                        "(只为拿到账号 uid,之后 root 直采免登录),然后重试 collect_app_data_root。",
                )
                put("reason", "root uid not seeded for $app (do one 本机数据 login)")
                put("resumeToken", "collect_app_data_root:$app")
            }
            // SQLCipher key extraction failed — honest degradation (decision #13),
            // not a fake success. The agent should fall back to another method.
            is LocalSnapshotResult.NoDbKey ->
                throw RuntimeException(
                    "$app root DB is encrypted and the key wasn't recovered " +
                        "(provider=${snap.provider}); needs a frida key hook — try another method.",
                )
            is LocalSnapshotResult.ExtractFailed ->
                throw RuntimeException(
                    "root extract failed for $app: ${snap.reason}" +
                        (snap.message?.let { " — $it" } ?: ""),
                )
            is LocalSnapshotResult.Failed ->
                throw RuntimeException(
                    "root collect failed for $app: ${snap.reason}" +
                        (snap.message?.let { " — $it" } ?: ""),
                )
            is LocalSnapshotResult.Ok -> when (
                val cc = ccRunner.syncAdapter(adapterName = adapter, inputPath = snap.snapshotPath)
            ) {
                is LocalCcRunner.CcResult.Ok -> buildJsonObject {
                    put("status", "ok")
                    put("app", app)
                    put("adapter", adapter)
                    put("method", "root-db")
                    put("collected", snap.totalEvents)
                    put("ingested", cc.report.ingested)
                    put("kgTriples", cc.report.kgTriples)
                    put("ragDocs", cc.report.ragDocs)
                }
                is LocalCcRunner.CcResult.Failed ->
                    throw RuntimeException("$adapter root sync failed: ${cc.reason}")
            }
        }
    }

    private fun resolve(app: String): Pair<LocalRootCollector, String> = when (app) {
        "weibo" -> weiboRoot to "social-weibo"
        "bilibili" -> bilibiliRoot to "social-bilibili"
        "douyin" -> douyinRoot to "social-douyin"
        "xiaohongshu" -> xhsRoot to "social-xiaohongshu"
        "toutiao" -> toutiaoRoot to "social-toutiao"
        "kuaishou" -> kuaishouRoot to "social-kuaishou"
        else -> throw IllegalArgumentException(
            "unsupported app: $app (supported: ${SUPPORTED.joinToString()})",
        )
    }

    companion object {
        private val SUPPORTED =
            listOf("weibo", "bilibili", "douyin", "xiaohongshu", "toutiao", "kuaishou")
    }
}
