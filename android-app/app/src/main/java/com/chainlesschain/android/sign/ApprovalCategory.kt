package com.chainlesschain.android.sign

/**
 * 审批场景分类（M4 ApprovalUI）。
 *
 * 不同 category 渲染不同的 Dialog 标题 / icon / 引导文案。M5 阶段仅有 [Sign]，
 * M4 扩到 4 类对应设计文档 §5.4 ApprovalUI："Cowork 投票 / Marketplace 大额支付 /
 * 关键操作审批"。
 */
enum class ApprovalCategory(val displayLabel: String) {
    /** 签名请求（默认）。M5 SignAsService 走这条路。 */
    Sign("签名请求"),

    /** Cowork 多智能体审批（spawnTeam / approveTask 等）。 */
    Cowork("Cowork 任务审批"),

    /** Marketplace 大额支付 / DID 凭证签发 — 强 ApprovalUI 必备。 */
    Marketplace("交易审批"),

    /** 系统级关键操作（shutdown / process kill / cookie 注入）。 */
    SystemCritical("关键操作审批");

    companion object {
        /**
         * 从原始 method 字符串推断 category。
         *
         * 规则（与 23 *Commands.kt 命名空间对齐）：
         *  - `sign.*` → [Sign]
         *  - `cowork.*` 或 method 中含 "Cowork" → [Cowork]
         *  - `marketplace.*` / `ai.deleteConversation` 等高敏 AI 删除 → [Marketplace]
         *  - 其他（system.* / extension.* / power.*）→ [SystemCritical]
         *  - null / blank → [SystemCritical]（保守路径）
         */
        fun fromMethod(method: String?): ApprovalCategory {
            if (method.isNullOrBlank()) return SystemCritical
            return when {
                method.startsWith("sign.") -> Sign
                method.startsWith("cowork.") -> Cowork
                method.startsWith("marketplace.") -> Marketplace
                else -> SystemCritical
            }
        }
    }
}
