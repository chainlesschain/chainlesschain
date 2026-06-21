package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.messaging.qq.QQNTFridaCollector
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * module 101 QQNT 采集方案 Phase 1 — `collect_qqnt`: collect MODERN QQ (QQNT)
 * chats by frida online-decrypting `nt_msg.db` (SQLCipher) via Method C
 * (`sqlcipher_export`), then parsing the protobuf messages into the vault.
 *
 * Requires root + QQ **foregrounded into 「消息」** (so its IM plugin has opened
 * the keyed DB connection frida borrows). Degrades honestly: anti-frida →
 * error; QQ not on 消息页 → assist_required. Distinct from `collect_qq`, which
 * reads the legacy plaintext `<uin>.db`.
 */
class CollectQqntTool(
    private val ccRunner: LocalCcRunner,
    private val qqnt: QQNTFridaCollector,
) : PdhTool {

    override val name = "collect_qqnt"
    override val description =
        "Collect modern QQ (QQNT) chats by frida-decrypting nt_msg.db (SQLCipher) " +
            "via online sqlcipher_export, then ingesting the messages. Requires root " +
            "and QQ open on the 消息 (messages) screen. Returns assist_required if QQ " +
            "isn't running / not on the messages screen, or an error if anti-frida " +
            "blocks the attach. Use this for current QQ; collect_qq is the legacy path."
    override val inputSchema = buildJsonObject {
        put("type", "object")
        put("properties", buildJsonObject {})
    }

    override fun call(args: JsonObject): JsonElement = runBlocking {
        when (val snap = qqnt.snapshot()) {
            QQNTFridaCollector.SnapshotResult.NoRoot ->
                throw RuntimeException("device is not rooted; QQNT frida decrypt requires root")

            QQNTFridaCollector.SnapshotResult.AppNotRunning -> buildJsonObject {
                put("status", "assist_required")
                put("instruction", "请先打开 QQ 并登录,然后重试 collect_qqnt。")
                put("reason", "QQ (com.tencent.mobileqq) not running")
                put("resumeToken", "collect_qqnt")
            }

            QQNTFridaCollector.SnapshotResult.NoExport -> buildJsonObject {
                put("status", "assist_required")
                put(
                    "instruction",
                    "请在 QQ 里打开「消息」列表(或任一聊天会话)停留几秒,让聊天数据库加载," +
                        "然后重试 collect_qqnt(frida 需要借 QQ 已打开的加密连接来导出)。",
                )
                put("reason", "QQ keyed nt_msg connection not seen (open the 消息 screen)")
                put("resumeToken", "collect_qqnt")
            }

            QQNTFridaCollector.SnapshotResult.AntiFrida ->
                throw RuntimeException(
                    "QQ anti-frida (libmsaoaidsec) blocked the attach — try the legacy collect_qq, " +
                        "or run the manual frida export.",
                )

            is QQNTFridaCollector.SnapshotResult.Failed ->
                throw RuntimeException(
                    "QQNT collect failed: ${snap.reason}" + (snap.message?.let { " — $it" } ?: ""),
                )

            is QQNTFridaCollector.SnapshotResult.Ok -> when (
                val cc = ccRunner.syncAdapter(adapterName = "messaging-qq", inputPath = snap.snapshotPath)
            ) {
                is LocalCcRunner.CcResult.Ok -> buildJsonObject {
                    put("status", "ok")
                    put("app", "qq")
                    put("adapter", "messaging-qq")
                    put("method", "frida-sqlcipher-export")
                    put("variant", "qqnt")
                    put("messages", snap.messageCount)
                    put("collected", snap.messageCount)
                    put("ingested", cc.report.ingested)
                    put("kgTriples", cc.report.kgTriples)
                    put("ragDocs", cc.report.ragDocs)
                }
                is LocalCcRunner.CcResult.Failed ->
                    throw RuntimeException("messaging-qq sync failed: ${cc.reason}")
            }
        }
    }
}
