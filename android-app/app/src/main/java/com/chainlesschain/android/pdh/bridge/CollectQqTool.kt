package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.messaging.qq.QQLocalCollector
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * module 101 · QQNT 采集方案 Phase 0 — `collect_qq`: collect QQ chat data by
 * reading the **legacy** local QQ DB (`<uin>.db`, plain SQLite, msgData XOR'd
 * with the device IMEI) directly via ROOT. No frida needed (the old format is
 * not SQLCipher) — this wires the already-built [QQLocalCollector] into the PDH
 * bridge so the agent can collect QQ without the HubLocal UI.
 *
 * Scope (honest): this is the OLD `<uin>.db` path only. Modern QQNT
 * (`nt_db/.../nt_msg.db`, SQLCipher + protobuf) is Phase 1 (frida sqlcipher
 * export) — see `docs/design/modules/101_QQNT_frida采集方案.md`. Credentials
 * (uin + 15-digit IMEI) are seeded once via 首页 → 本机数据 → QQ; re-collection
 * then reproduces with no re-entry (the reproducibility requirement).
 */
class CollectQqTool(
    private val ccRunner: LocalCcRunner,
    private val qq: QQLocalCollector,
) : PdhTool {

    override val name = "collect_qq"
    override val description =
        "Collect QQ chat data by reading the legacy local QQ database (<uin>.db, " +
            "plain SQLite, IMEI-XOR message bodies) directly via ROOT — no cookie/API, " +
            "no frida. Requires the QQ uin + device IMEI seeded once via 首页 → 本机数据 → " +
            "QQ; returns assist_required if not seeded, or an error if the device isn't " +
            "rooted. (Modern QQNT nt_msg.db is a separate frida path, not this tool.)"
    override val inputSchema = buildJsonObject {
        put("type", "object")
        put("properties", buildJsonObject {})
    }

    override fun call(args: JsonObject): JsonElement = runBlocking {
        when (val snap = qq.snapshot()) {
            QQLocalCollector.SnapshotResult.NoRoot ->
                throw RuntimeException("device is not rooted; QQ local DB read requires root")

            QQLocalCollector.SnapshotResult.NoCredentials -> buildJsonObject {
                put("status", "assist_required")
                put(
                    "instruction",
                    "采集 QQ 聊天需要先录入凭据:请到 首页 → 本机数据 → 「QQ」,填入 QQ 号(uin) " +
                        "和本机 IMEI(15 位,*#06# 可查)。录入一次后,以后 root 直采免重输,然后重试 collect_qq。",
                )
                put("reason", "qq credentials (uin+imei) not seeded")
                put("resumeToken", "collect_qq")
            }

            is QQLocalCollector.SnapshotResult.ExtractFailed ->
                throw RuntimeException(
                    "QQ extract failed: ${snap.reason}" + (snap.message?.let { " — $it" } ?: ""),
                )

            is QQLocalCollector.SnapshotResult.Failed ->
                throw RuntimeException(
                    "QQ collect failed: ${snap.reason}" + (snap.message?.let { " — $it" } ?: ""),
                )

            is QQLocalCollector.SnapshotResult.Ok -> when (
                val cc = ccRunner.syncAdapter(adapterName = "messaging-qq", inputPath = snap.snapshotPath)
            ) {
                is LocalCcRunner.CcResult.Ok -> buildJsonObject {
                    put("status", "ok")
                    put("app", "qq")
                    put("adapter", "messaging-qq")
                    put("method", "root-db-xor")
                    put("variant", "legacy-uin-db")
                    put("contacts", snap.contactCount)
                    put("groups", snap.groupCount)
                    put("messages", snap.messageCount)
                    put("collected", snap.totalEvents)
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
