package com.chainlesschain.android.feature.familyguard.domain.model

/**
 * 角色锁状态机 (FAMILY-04). 3 态对齐 ticket 验收准则:
 *   - [Unselected]: 首启, 没选过
 *   - [LockPending]: 选过 < 24h, 仍可撤回 (防误选)
 *   - [Locked]: 选过 > 24h, 角色永久锁
 */
sealed interface RoleLockState {

    /** 未选: 显角色选择 UI。 */
    data object Unselected : RoleLockState

    /**
     * 已选锁定中 (selected < 24h ago, 仍可改).
     *
     * @property role 已选择的角色
     * @property selectedAtMs 选定时刻 (epoch ms, FAMILY-60 起走 TimeAuthority 权威时间;
     *   配对+同步后防改钟绕过, 未同步时退墙钟 baseline)。
     * @property lockAtMs `selectedAtMs + 24h` 计算结果; 用于 UI 倒计时显示。
     */
    data class LockPending(
        val role: AppRole,
        val selectedAtMs: Long,
        val lockAtMs: Long,
    ) : RoleLockState

    /**
     * 已锁 (selected > 24h ago, 永久).
     *
     * v0.1: 锁后无 UI 提供 unlock; 真要换角色需走"重置 app data"流程
     * (Settings → Apps → ChainlessChain → 清除数据)。后续版本可加 PIN-protected
     * unlock。
     */
    data class Locked(
        val role: AppRole,
        val selectedAtMs: Long,
    ) : RoleLockState
}

/** 已选角色 (LockPending / Locked) 或 null (Unselected)。 */
fun RoleLockState.selectedRole(): AppRole? = when (this) {
    is RoleLockState.LockPending -> role
    is RoleLockState.Locked -> role
    RoleLockState.Unselected -> null
}
