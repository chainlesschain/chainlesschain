package com.chainlesschain.android.feature.familyguard.domain.emergency

import kotlinx.coroutines.flow.StateFlow

/**
 * 上行 freeze 闸 (FAMILY-16).
 *
 * 主文档 §3.1 v0.2 紧急解绑: "孩子端在登录页输入复活码 → 立刻 freeze 上行
 * (不再发任何 telemetry / 不接强接通)"。
 *
 * 各上行子系统 (Sync engine FAMILY-26 / 通话 FAMILY-30 / SOS upstream
 * FAMILY-40) 需观察 [isFrozen] 流; 任一为 true 时静默丢弃所有 outgoing。
 * v0.1 仅提供 StateFlow 通道, 真实接通在各子系统 ticket 落地。
 *
 * freeze 是单向门: 一旦 freeze 不可在 UI 中 unfreeze (主文档 §3.1 v0.2:
 * "7 天后自动转 unbound; 期间孩子可撤销"); 撤销路径走 [unfreeze] (admin only,
 * 不暴露给 UI), 由 user action "撤销紧急解绑" 触发, 或 7 天后系统自动。
 */
interface UpstreamFreezer {

    val isFrozen: StateFlow<Boolean>

    /** 触发 freeze; 写入触发原因 + 时间, 后续可审计。幂等 (已 freeze 再调返 false). */
    suspend fun freeze(reason: String): Boolean

    /** 撤销 freeze; 仅在 7 天宽限期内孩子主动调 / 系统自动。 */
    suspend fun unfreeze(): Boolean
}
