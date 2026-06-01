package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.domain.model.AppRole
import com.chainlesschain.android.feature.familyguard.domain.model.RoleLockState
import kotlinx.coroutines.flow.Flow

/**
 * 角色选择 + 24h 锁状态机仓库 (FAMILY-04).
 *
 * 验收准则:
 *   1. observeLockState() 返回 3 态之一 (Unselected | LockPending | Locked)
 *   2. select(role) 保存到 DataStore 并刷新 state
 *   3. tryChangeRole(): 仅 LockPending 时允许; Locked 拒绝
 *
 * 时间裁决基线: FAMILY-60 起用 TimeAuthority.authoritativeNow() (锚定单调钟),
 * 防孩子改设备时钟把锁"调过期"绕过 (配对+同步后生效; 未同步退墙钟 baseline)。
 */
interface RolePreferencesRepository {

    fun observeLockState(): Flow<RoleLockState>

    /** 写新角色 + selectedAt = clock.now(). 触发 state 流转 → LockPending。 */
    suspend fun select(role: AppRole)

    /**
     * @return true 表示允许并已切换; false 表示已被 Locked, 拒绝。
     * 用 sync 而非 Flow 因为 UI 触发点是用户点 Confirm 按钮, 需要立即拿到结果。
     */
    suspend fun tryChangeRole(role: AppRole): Boolean

    /** 仅测试 / 重置 app data 流程使用; v0.1 UI 无入口。 */
    suspend fun reset()
}
