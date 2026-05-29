package com.chainlesschain.android.feature.familyguard.domain.model

/**
 * 复活码验证结果 (FAMILY-08).
 *
 * 用 sealed interface 而非 boolean, 因为 UI 需区分错误原因:
 *   - [Success]: 复活码正确, 调用方 (FAMILY-16) 进入紧急解绑流程
 *   - [WrongCode]: 错误, 仍有剩余尝试次数, UI 可提示 "还有 X 次"
 *   - [LockedOut]: 锁定中, UI 显示倒计时直到 [unlockAtMs]
 *   - [NoCodeRegistered]: 该 family_relationship 还没生成过复活码 (配对流程未完成)
 *   - [AlreadyConsumed]: 已经成功验证过一次 (单次使用), 解绑已触发
 */
sealed interface RevivalCodeVerification {

    data object Success : RevivalCodeVerification

    data class WrongCode(val remainingAttempts: Int) : RevivalCodeVerification

    data class LockedOut(val unlockAtMs: Long) : RevivalCodeVerification

    data object NoCodeRegistered : RevivalCodeVerification

    data object AlreadyConsumed : RevivalCodeVerification
}
