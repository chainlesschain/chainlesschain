package com.chainlesschain.android.auto

import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * v1.2 #1 Android Auto — Car app service entry point。
 *
 * 设计文档 §10：车载场景独占价值是开车 hands-free 对话桌面 LLM + 关键审批推送。
 * Android Auto 严格限制 UI（template-based，不允许任意 Compose），Surface 仅 Voice
 * Mode + 简化 ApprovalUI；ChatPanel / 复杂 UI 不暴露车载（驾驶安全）。
 *
 * Phase 0：CarAppService + Session + 占位 MessageTemplate。
 * Phase 1：VoiceModeManager 接通 (AsrEngine → REMOTE chat → TTS)。
 * Phase 2 (本 commit)：[AutoModeTracker] active 翻转；Marketplace / SystemAlert
 *   类别通知通过 [AutoPushBus] 进 VoiceModeScreen 显示语音读出 + 大按钮审批。
 * Phase 3：DHU emulator setup doc + release HostValidator 切真名单。
 *
 * @AndroidEntryPoint：Hilt 注入 [AutoModeTracker] (Singleton 与 NotificationCenter
 * 共享同一实例，让 push 路由能读 Auto 状态)。
 */
@AndroidEntryPoint
class CcCarAppService : CarAppService() {

    @Inject lateinit var autoModeTracker: AutoModeTracker

    override fun onCreate() {
        super.onCreate()
        autoModeTracker.markActive()
    }

    override fun onDestroy() {
        autoModeTracker.markInactive()
        super.onDestroy()
    }

    /**
     * HostValidator 决定哪些 Auto host 可加载本 CarApp。debug 期用 ALLOW_ALL_HOSTS_VALIDATOR
     * 让 DHU emulator 直接联调；生产 release 必须切到 [HostValidator.Builder]
     * 列白名单 (Google Auto host signature) 防恶意 host 接管 voice 通道。
     *
     * Phase 3 release polish 切真名单。
     */
    override fun createHostValidator(): HostValidator =
        HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session = CcCarSession()
}
