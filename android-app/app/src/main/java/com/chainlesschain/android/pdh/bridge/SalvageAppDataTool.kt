package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.MemSalvageCollector
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
 * Phase 1, L4 (app database direct-read, key-free) — `salvage_app_data`. Runs
 * the on-device [MemSalvageCollector]: root `su` reads the target app's
 * `/proc/<pid>/mem`, salvages decrypted SQLite leaf pages, and ingests them into
 * the vault via `cc hub salvage` (decision #15 "方案 i" for the salvage path).
 *
 * L4 reality (memory `android_app_db_decryption_findings`): works on standard
 * SQLCipher apps (WeChat/QQ); Douyin's WCDB2 IM is a known dead-end (returns
 * NoDumps / tiny config DBs). The tool reports this honestly (decision #13:
 * 诚实降级,绝不编数据). Requires root + the target app alive in the foreground.
 *
 * Android-bound (root + cc subprocess) → device-validated, not headless.
 */
class SalvageAppDataTool(
    private val collector: MemSalvageCollector,
) : PdhTool {

    override val name = "salvage_app_data"
    override val description =
        "Key-free root memory salvage of an app's data into the vault " +
            "(douyin/toutiao/wechat/kuaishou/xiaohongshu/weibo). Requires root and " +
            "the target app running in the foreground."
    override val inputSchema = buildJsonObject {
        put("type", "object")
        putJsonObject("properties") {
            putJsonObject("app") {
                put("type", "string")
                put("description", "Target app key")
                putJsonArray("enum") {
                    MemSalvageCollector.TargetApp.values().forEach { add(it.appKey) }
                }
            }
        }
        putJsonArray("required") { add("app") }
    }

    override fun call(args: JsonObject): JsonElement = runBlocking {
        val appKey = (args["app"] as? JsonPrimitive)?.contentOrNull
            ?: throw IllegalArgumentException("missing required arg: app")
        val target = MemSalvageCollector.TargetApp.values().firstOrNull {
            it.appKey.equals(appKey, ignoreCase = true) ||
                it.name.equals(appKey, ignoreCase = true)
        } ?: throw IllegalArgumentException(
            "unknown app: $appKey (supported: " +
                MemSalvageCollector.TargetApp.values().joinToString { it.appKey } + ")",
        )

        when (val r = collector.collect(target)) {
            is MemSalvageCollector.Result.Ok -> buildJsonObject {
                put("status", "ok")
                put("app", target.appKey)
                put("ingested", r.ingested)
                put("salvaged", r.salvaged)
                put("dumps", r.dumps)
            }
            is MemSalvageCollector.Result.NoRoot ->
                throw RuntimeException("device is not rooted; salvage requires root")
            is MemSalvageCollector.Result.AppNotRunning -> buildJsonObject {
                // Human-in-loop assist (design §3.6): the user opens the app, then
                // re-calls the tool. Lightweight form (no resumeToken yet).
                put("status", "assist_required")
                put(
                    "instruction",
                    "请在前台打开「${target.displayName}」并进入消息/私信页,等数据加载后重试 " +
                        "salvage_app_data。",
                )
                put("reason", "target app process not alive (memory scan needs it running)")
            }
            is MemSalvageCollector.Result.NoDumps -> buildJsonObject {
                // Honest degradation — NOT a fake success (decision #13).
                put("status", "ok")
                put("app", target.appKey)
                put("ingested", 0)
                put(
                    "note",
                    "no decrypted SQLite pages recovered (app may use a non-standard " +
                        "cipher, e.g. Douyin WCDB2 IM — a known dead-end)",
                )
            }
            is MemSalvageCollector.Result.Failed ->
                throw RuntimeException("salvage failed: ${r.reason}")
        }
    }
}
