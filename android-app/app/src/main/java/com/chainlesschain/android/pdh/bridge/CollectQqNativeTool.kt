package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.messaging.qq.QQNTNativeCollector
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * module 101 QQNT 采集方案 — `collect_qq_native`: collect modern QQ (QQNT) chats
 * **fully on-device, no frida, no PC/USB**. Decrypts nt_msg.db via the derived
 * key (MD5(MD5(uid)+rand)) in the cc bundle and ingests the messages.
 *
 * This is the working QQNT path (the frida `collect_qqnt` can't — WCDB uses
 * internal sqlite). Requires root + QQ logged in. The uid scan is slow (the
 * agent should set expectations / run it in the background).
 */
class CollectQqNativeTool(
    private val collector: QQNTNativeCollector,
) : PdhTool {

    override val name = "collect_qq_native"
    override val description =
        "Collect modern QQ (QQNT) chats fully on-device — decrypt nt_msg.db via the " +
            "derived key (no frida, no PC). Requires root + QQ logged in. Note: the uid " +
            "scan over QQ's data can take 1–3 minutes. Returns assist_required if QQ " +
            "isn't logged in, or an error if not rooted / key can't be derived."
    override val inputSchema = buildJsonObject {
        put("type", "object")
        put("properties", buildJsonObject {})
    }

    override fun call(args: JsonObject): JsonElement = runBlocking {
        when (val r = collector.snapshot()) {
            QQNTNativeCollector.Result.NoRoot ->
                throw RuntimeException("device is not rooted; QQNT decrypt requires root")

            QQNTNativeCollector.Result.NotLoggedIn -> buildJsonObject {
                put("status", "assist_required")
                put("instruction", "请先在本机登录 QQ（登录后才会生成 nt_msg.db），然后重试 collect_qq_native。")
                put("reason", "nt_msg.db not found (QQ not logged in on this device)")
                put("resumeToken", "collect_qq_native")
            }

            QQNTNativeCollector.Result.NoMatch ->
                throw RuntimeException(
                    "could not derive the nt_msg key — self uid not found among candidates " +
                        "(account may be a sub-process / formula drift). Try again after opening QQ messages.",
                )

            is QQNTNativeCollector.Result.Failed ->
                throw RuntimeException("QQNT native collect failed: ${r.reason}")

            is QQNTNativeCollector.Result.Ok -> buildJsonObject {
                put("status", "ok")
                put("app", "qq")
                put("adapter", "qq-pc")
                put("method", "derived-key-decrypt")
                put("variant", "qqnt")
                put("matchedUid", r.matchedUid)
                put("messages", r.messages)
                put("ingested", r.ingested)
            }
        }
    }
}
