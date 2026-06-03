package com.chainlesschain.android.feature.familyguard.domain.unbind

/**
 * 解绑状态机操作结果 (FAMILY-15).
 *
 * 5 子类:
 *   - [Success]: 操作成功 (request / cancel / finalize 路径)
 *   - [AlreadyUnbinding]: requestUnbind 时已 unbind_pending; 调用方应展示
 *     "已在 24h 冷却中" 而非重复发起
 *   - [NotPending]: cancelUnbind 时 status 不是 pending (active 或 unbound);
 *     幂等场景视为 no-op success; 实际错位场景 UI 需提示
 *   - [TooEarly]: finalizeUnbind 时 cooldown 未到期; Worker 不应该走到这里,
 *     forceFinalize 必须等到 cooldown_until + grace
 *   - [NotFound]: relationship id 不存在
 */
sealed interface UnbindResult {

    data object Success : UnbindResult

    data class AlreadyUnbinding(val cooldownUntilMs: Long) : UnbindResult

    data object NotPending : UnbindResult

    data class TooEarly(val cooldownUntilMs: Long) : UnbindResult

    data object NotFound : UnbindResult
}
