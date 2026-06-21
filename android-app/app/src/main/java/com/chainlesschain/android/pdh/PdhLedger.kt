package com.chainlesschain.android.pdh

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §3.5.18 透明度台账的本地持久化(append-only,端侧、不出端)—— module 101 Phase 2。
 *
 * 出境台账(数据/摘要何时去了哪,§3.5.10/16)+ 操作台账(AI 替你办过的事务,§3.5.17)。
 * 写侧在此(本地 JSON,有界保留最近 [MAX] 条防无限增长),读侧渲染走 [PdhTransparency]。
 * 台账本身隐私敏感(行为轨迹)→ 仅本机;best-effort,绝不因写台账崩聊天(§13.4)。
 *
 * 薄持久化适配层(device-bound,JSON IO);判定/过滤/摘要的纯逻辑在 [PdhTransparency]
 * (已单测)。VM 测试 mock 本类。
 */
@Singleton
class PdhLedger @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val egressFile: File get() = File(context.filesDir, "pdh-egress-ledger.json")
    private val actionFile: File get() = File(context.filesDir, "pdh-action-ledger.json")

    @Synchronized
    fun appendEgress(entry: PdhTransparency.EgressEntry) {
        val arr = readArray(egressFile)
        arr.put(
            JSONObject().apply {
                put("t", entry.epochMs)
                put("cat", entry.category)
                put("dest", entry.destination)
                put("tier", entry.tier)
            },
        )
        writeBounded(egressFile, arr)
    }

    @Synchronized
    fun appendAction(entry: PdhTransparency.ActionEntry) {
        val arr = readArray(actionFile)
        arr.put(
            JSONObject().apply {
                put("t", entry.epochMs)
                put("action", entry.action)
                put("target", entry.target)
                put("result", entry.result)
                put("by", entry.approvedBy)
            },
        )
        writeBounded(actionFile, arr)
    }

    fun readEgress(): List<PdhTransparency.EgressEntry> = readArray(egressFile).mapObjects { o ->
        PdhTransparency.EgressEntry(
            epochMs = o.optLong("t"),
            category = o.optString("cat"),
            destination = o.optString("dest"),
            tier = o.optString("tier"),
        )
    }

    fun readActions(): List<PdhTransparency.ActionEntry> = readArray(actionFile).mapObjects { o ->
        PdhTransparency.ActionEntry(
            epochMs = o.optLong("t"),
            action = o.optString("action"),
            target = o.optString("target"),
            result = o.optString("result"),
            approvedBy = o.optString("by"),
        )
    }

    private fun readArray(file: File): JSONArray = try {
        if (file.exists()) JSONArray(file.readText()) else JSONArray()
    } catch (_: Throwable) {
        JSONArray()
    }

    /** Keep only the most recent [MAX] entries (append-only but bounded). */
    private fun writeBounded(file: File, arr: JSONArray) {
        try {
            val start = (arr.length() - MAX).coerceAtLeast(0)
            val trimmed = if (start == 0) {
                arr
            } else {
                JSONArray().also { out -> for (i in start until arr.length()) out.put(arr.get(i)) }
            }
            file.writeText(trimmed.toString())
        } catch (_: Throwable) {
            // best-effort — never crash the chat over a ledger write
        }
    }

    private inline fun <T> JSONArray.mapObjects(f: (JSONObject) -> T): List<T> =
        (0 until length()).mapNotNull { i -> (opt(i) as? JSONObject)?.let(f) }

    companion object {
        /** 每本台账最多保留的条目数(防文件无限增长)。 */
        const val MAX = 500
    }
}
