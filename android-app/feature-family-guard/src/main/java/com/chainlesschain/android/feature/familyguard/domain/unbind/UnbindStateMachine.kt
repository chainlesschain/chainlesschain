package com.chainlesschain.android.feature.familyguard.domain.unbind

/**
 * Family-friend 关系解绑状态机 (FAMILY-15). 主文档 §3.1 v0.2:
 *
 * 状态:
 *   active → unbind_pending (24h 冷却)
 *   unbind_pending → active (任一方撤销; 清冷却字段)
 *   unbind_pending → unbound (冷却到期, Worker / forceFinalize 触发)
 *
 * 注意 emergency_unbound / frozen 不在本状态机内 — 前者由 FAMILY-16 处理,
 * 后者由 multi-parent governance (FAMILY-17) 触发。
 */
interface UnbindStateMachine {

    /** active → unbind_pending; 写 unbind_cooldown_until = now + [COOLDOWN_MS]. */
    suspend fun requestUnbind(
        relationshipId: Long,
        requesterDid: String,
    ): UnbindResult

    /**
     * unbind_pending → active; 任一方都可调 (主文档: "任一方撤销 → 回 active").
     * 已 active 时返 [UnbindResult.Success] (幂等) — 防止双方同时撤销 race
     * 后第二个调 fail。
     */
    suspend fun cancelUnbind(relationshipId: Long): UnbindResult

    /**
     * unbind_pending → unbound; 必须 now ≥ cooldown_until 才生效。
     * Worker 周期调; 或 forceFinalize 接 Worker 不可用时手动触发。
     */
    suspend fun finalizeUnbind(relationshipId: Long): UnbindResult

    /**
     * 主文档 §3.1 v0.2: "单方未响应 → 申请方可在到期后 +6h 强制解绑 (防失联)".
     * 实际上 finalizeUnbind 不需要额外的 6h 检查 (Worker 会到点就走);
     * forceFinalize 等价于在 cooldown_until 时刻立即触发 finalizeUnbind, 区别仅
     * 是调用者要求 reasonHash 写 audit (留 FAMILY-Audit 落地)。
     *
     * 调用方 (requester UI) 应在 cooldown_until + 6h 之后才暴露此入口给用户。
     */
    suspend fun forceFinalize(
        relationshipId: Long,
        requesterDid: String,
    ): UnbindResult

    /** Worker 入口: 查所有冷却到期的 pending 关系并 finalize 它们。返成功数。 */
    suspend fun reconcileExpired(): Int

    companion object {
        /** 24h 冷却 — 主文档 §3.1 v0.2 硬编码. */
        const val COOLDOWN_MS: Long = 24L * 60L * 60L * 1000L

        /** 强制解绑的"未响应"宽限期; 申请方需等到 cooldown_until + 这段时间才可强 finalize。 */
        const val FORCE_GRACE_MS: Long = 6L * 60L * 60L * 1000L
    }
}
