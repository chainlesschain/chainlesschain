package com.chainlesschain.android.feature.familyguard.domain.sos

/**
 * SOS 状态转换结果 (FAMILY-40). 转换走 DAO 原子 SQL UPDATE + WHERE status 守卫,
 * 据影响行数判定 (同 [com.chainlesschain.android.feature.familyguard.data.unbind.UnbindStateMachineImpl]
 * 模式)。
 */
sealed interface SosTransitionResult {

    /** 转换成功。 */
    data object Success : SosTransitionResult

    /** 事件 id 不存在。 */
    data object NotFound : SosTransitionResult

    /** 当前状态不允许该转换 (e.g. 已 resolved 再 acknowledge); 附当前状态。 */
    data class InvalidState(val current: SosStatus) : SosTransitionResult

    /**
     * 误触撤销超出 5min 窗口 (FAMILY-44): 事件仍 pending 但触发已超
     * [com.chainlesschain.android.feature.familyguard.domain.repository.SosEventRepository.Companion.CANCEL_WINDOW_MS],
     * 不再允许孩子自行撤销 (走家长 resolve / 兜底升级 FAMILY-45)。
     */
    data object CancelWindowExpired : SosTransitionResult
}
