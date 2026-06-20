package com.chainlesschain.android.pdh

/**
 * §3.5.18 透明度审计视图(纯逻辑核)—— module 101 Phase 2。
 *
 * 前面几节(§3.5.10/16 出境、§3.5.17 操作)一路"写"台账、§3.5.13 留了画像纠正 seam;
 * 本核是它们的**读侧数据模型** + 过滤/摘要:三段——AI 画像(可纠)、出境台账、操作
 * (行为)台账。诚实原则:**不隐藏任何出境/操作**,"0 条"也如实显示(§13.3/§13.4)。
 *
 * 台账写入(§3.5.10/16/17 持久化)、画像快照(instinct/memory)、完整透明度首页与
 * 画像纠正 UI 是 device/集成层(纠正动作经 §3.5.13 FeedbackSignal)。**纯函数、可单测**。
 */
object PdhTransparency {

    /** 出境台账条目:某类数据/摘要 何时去了哪、走哪档。 */
    data class EgressEntry(
        val epochMs: Long,
        val category: String,
        val destination: String,
        val tier: String,
    )

    /** 操作(行为)台账条目:AI 替你办过的事务。 */
    data class ActionEntry(
        val epochMs: Long,
        val action: String,
        val target: String,
        val result: String,
        val approvedBy: String,
    )

    /** AI 画像条目(可纠正 → §3.5.13)。 */
    data class ProfileItem(val id: String, val statement: String)

    /** 出境台账:按类别过滤(null=全部),按时间倒序(最新在前)。 */
    fun filterEgress(entries: List<EgressEntry>, category: String? = null): List<EgressEntry> =
        entries.filter { category == null || it.category == category }
            .sortedByDescending { it.epochMs }

    /** 操作台账:按动作过滤(null=全部),按时间倒序。 */
    fun filterActions(entries: List<ActionEntry>, action: String? = null): List<ActionEntry> =
        entries.filter { action == null || it.action == action }
            .sortedByDescending { it.epochMs }

    /** 诚实摘要:0 也如实说,绝不隐藏(§13.3 透明度)。 */
    fun egressSummary(entries: List<EgressEntry>): String =
        if (entries.isEmpty()) "尚无数据出过端" else "共 ${entries.size} 条出境记录"

    fun actionSummary(entries: List<ActionEntry>): String =
        if (entries.isEmpty()) "AI 还没替你办过事" else "共 ${entries.size} 条操作记录"

    fun profileSummary(items: List<ProfileItem>): String =
        if (items.isEmpty()) "AI 还没学到关于你的偏好" else "AI 学到 ${items.size} 条关于你的理解(可纠正)"
}
