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
}
