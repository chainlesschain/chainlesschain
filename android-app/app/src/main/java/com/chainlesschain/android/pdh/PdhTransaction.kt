package com.chainlesschain.android.pdh

/**
 * §3.5.17 事务执行(纯逻辑核)—— module 101 Phase 2。
 *
 * 事务 = 不可逆的真实世界副作用(发消息 / 打电话 / 花钱 / 销毁数据),风险远高于
 * 采集/入库。本核做纯决策:风险分级(决定确认强度)、是否可撤销(决定回执给不给
 * 撤销窗口)、是否需输入确认词(最高风险)、幂等键(防双击/重试重复执行)。
 *
 * 真正的 dry-run 预览 / 审批卡 / 回执 / 撤销窗口 / 审计台账 / FAMILY 执行器是
 * device/cc-bound 集成层;参数来源警示(§7.2 最后一闸)是 VM 把事务参数配对到
 * §3.5.11 的不可信 DATA。**纯函数、可单测、无 Android 依赖**。
 */
enum class TxnRisk { LOW, MEDIUM, HIGH, CRITICAL }

object PdhTransaction {

    /**
     * 事务风险分级(看工具 + 可选 input):
     *  set_reminder = LOW;manage_data_lifecycle(export) = MEDIUM;
     *  send_message/make_call = HIGH;manage_data_lifecycle(destroy)/花钱类 = CRITICAL。
     *  未知有副作用工具 → MEDIUM(仍须审批)。
     */
    fun riskOf(tool: String?, input: String? = null): TxnRisk {
        val t = (tool ?: "").lowercase()
        val i = (input ?: "").lowercase()
        return when {
            t.contains("pay") || t.contains("transfer") || t.contains("purchase") -> TxnRisk.CRITICAL
            t.contains("lifecycle") || t.contains("manage_data") ->
                if (i.contains("destroy") || i.contains("delete")) TxnRisk.CRITICAL else TxnRisk.MEDIUM
            t.contains("reminder") -> TxnRisk.LOW
            t.contains("send_message") || t.contains("make_call") ||
                t.contains("send") || t.contains("call") -> TxnRisk.HIGH
            else -> TxnRisk.MEDIUM
        }
    }

    /**
     * 是否"事务"工具(有真实世界副作用 → 走事务审批卡而非普通审批/预览)。
     * send/call/reminder/pay/transfer/purchase/lifecycle 类;采集/查询不算。
     */
    fun isTransaction(tool: String?): Boolean {
        val t = (tool ?: "").lowercase()
        return t.contains("send") || t.contains("call") || t.contains("reminder") ||
            t.contains("pay") || t.contains("transfer") || t.contains("purchase") ||
            t.contains("lifecycle") || t.contains("manage_data")
    }

    /** 最高风险(CRITICAL)须输入确认词才放行(防误触不可逆操作)。 */
    fun requiresConfirmWord(risk: TxnRisk): Boolean = risk == TxnRisk.CRITICAL

    /**
     * 是否可撤销(决定回执给不给「撤销」窗口):提醒可改、生命周期(导出/销毁走软删期)
     * 可撤;发消息/拨打/花钱 = 触达他人或不可逆 → 不可撤。
     */
    fun isReversible(tool: String?): Boolean {
        val t = (tool ?: "").lowercase()
        return t.contains("reminder") || t.contains("lifecycle") || t.contains("manage_data")
    }

    /**
     * 幂等键:同一事务(同工具 + 同参数)防双击/重试重复执行;执行器用此去重。
     * 稳定确定性(String.hashCode 规范稳定),不引随机。
     */
    fun idempotencyKey(tool: String?, input: String?): String {
        val raw = (tool ?: "") + "|" + (input ?: "")
        return "txn-" + Integer.toHexString(raw.hashCode())
    }
}
