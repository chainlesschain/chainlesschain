package com.chainlesschain.android.feature.familyguard.domain.permission

/**
 * FAMILY-14 主接口. 调用方每次执行家庭关系相关动作前调一次 [check]; 拿到
 * [PermissionDecision] 决定是否继续。
 *
 * 实现 ([com.chainlesschain.android.feature.familyguard.data.permission.
 * FamilyPermissionCheckerImpl]) 走:
 *   1. FamilyRelationshipRepository.findByFriendDid(targetDid) 找 active 关系
 *   2. readPermissions 解码 JSON → FamilyPermissions
 *   3. 按 action 类型决定 Allow / Deny
 *
 * 不在此层做:
 *   - quiet hours 命中判定 (那是 FAMILY-25 Sync engine 权限过滤层职责)
 *   - 多家长冲突解决 (FAMILY-17 RuleMerger)
 *   - M4 enforce_level 走第几档 (FAMILY-Enforce body)
 *   - KYC 闸 (FAMILY-13 配对阶段处理)
 */
interface FamilyPermissionChecker {

    suspend fun check(action: FamilyAction, targetDid: String): PermissionDecision
}
