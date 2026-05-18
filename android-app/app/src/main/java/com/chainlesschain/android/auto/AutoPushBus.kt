package com.chainlesschain.android.auto

import com.chainlesschain.android.push.NotificationPayload
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.2 #1 Android Auto Phase 2 — Auto 模式下的"语音读出 + 大按钮审批"通知通道。
 *
 * 设计：
 *   - 在 Auto 模式下，[com.chainlesschain.android.push.NotificationCenter.dispatch]
 *     除常规系统通知外，把 Marketplace / SystemAlert 类别的 payload 再 emit 到这
 *     条 bus 上。
 *   - [VoiceModeScreen] subscribe，每条事件触发显示 ApprovalTemplate 卡（大按钮
 *     "同意" / "拒绝"，Auto template constraints 允许）。
 *
 * 用 SharedFlow：multiple subscribers (理论上只有 VoiceModeScreen + 可能的单测)；
 * extraBufferCapacity=16 防 Auto 卡渲染慢时通知堆积丢；DROP_OLDEST 保留最新。
 *
 * 关于 SystemCritical：issue #20 P0.1 写的是 "Marketplace / SystemCritical"，
 * 当前 NotificationCategory 用 SystemAlert（v1.0 命名）—— Auto 视语义等价，
 * 仍走 SystemAlert 类别。Severity=Critical 时优先级最高（VoiceModeScreen 渲染
 * 时可读 severity 加重提示，留 Phase 3）。
 */
@Singleton
class AutoPushBus @Inject constructor() {

    // replay=1：让 VoiceModeScreen 在 Auto host 启动后才订阅时仍能看到最近一条
    // 待审批 payload；同时 NotificationCenter.dispatch (在 Dispatchers.Default) 与
    // 测试侧 first() 订阅之间不存在 race。Decision 事件 replay=1 仍安全 —
    // VoiceModeScreen 的 collector 主动过滤 Decision (防回路)。
    private val _events = MutableSharedFlow<AutoPushEvent>(
        replay = 1,
        extraBufferCapacity = 16,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<AutoPushEvent> = _events.asSharedFlow()

    /** NotificationCenter.dispatch 在 Auto 模式下调；非 Auto 模式无 subscriber，no-op。 */
    suspend fun emit(payload: NotificationPayload) {
        _events.emit(AutoPushEvent.Incoming(payload))
    }

    /** 用户在 VoiceModeScreen 上点了同意/拒绝，回传给业务方（reverse-RPC ApprovalCoordinator）。 */
    suspend fun userDecision(decision: AutoApprovalDecision) {
        _events.emit(AutoPushEvent.Decision(decision))
    }
}

sealed interface AutoPushEvent {
    data class Incoming(val payload: NotificationPayload) : AutoPushEvent
    data class Decision(val decision: AutoApprovalDecision) : AutoPushEvent
}

data class AutoApprovalDecision(
    val payload: NotificationPayload,
    val approved: Boolean,
)
