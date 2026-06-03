package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.domain.model.FamilyGuardState

/**
 * 控制 FamilyGuardForegroundService 启停 + 状态切换的薄抽象 (FAMILY-05).
 *
 * ViewModel / Use Case 不直接调 [Context.startForegroundService] —— 集中走这里, 让单测可以注入 fake
 * 验证调用模式 (典型: "ViewModel 在 family-pair 建立后调 controller.setState(MONITORING)")。
 */
interface FamilyGuardServiceController {

    /**
     * 启动服务到给定 state. 安全幂等: 已运行则切 state, 未运行则 startForegroundService。
     */
    fun setState(state: FamilyGuardState)

    /** 终止服务 + 移除通知。一般不在常规路径调; v0.1 只在角色重置时调。 */
    fun stop()
}
