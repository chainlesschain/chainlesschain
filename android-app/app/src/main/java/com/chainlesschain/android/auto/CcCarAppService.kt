package com.chainlesschain.android.auto

import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator
import dagger.hilt.android.AndroidEntryPoint

/**
 * v1.2 #1 Android Auto Phase 0 — Car app service entry point。
 *
 * 设计文档 §10：车载场景独占价值是开车 hands-free 对话桌面 LLM + 关键审批推送。
 * Android Auto 严格限制 UI（template-based，不允许任意 Compose），Surface 仅 Voice
 * Mode + 简化 ApprovalUI；ChatPanel / 复杂 UI 不暴露车载（驾驶安全）。
 *
 * Phase 0 (本 commit)：CarAppService + Session 骨架 + 占位 MessageTemplate "Voice
 * Mode loading..."。仅验证 manifest service entry + Auto host 能 launch。
 *
 * Phase 1 (下个 commit)：wire AsrEngineRouter 走 voice 输入 + REMOTE chat → TTS。
 * Phase 2：PushNotifier Marketplace / SystemCritical 类别在 Auto 模式下读出。
 * Phase 3：DHU emulator setup doc + 安全 disclaimer。
 *
 * @AndroidEntryPoint：Phase 1+ 用 Hilt 注入 AsrEngineRouter / ChatService 等；
 * Phase 0 没注入物，但提前标避免后续重启 Hilt graph。
 */
@AndroidEntryPoint
class CcCarAppService : CarAppService() {
    /**
     * HostValidator 决定哪些 Auto host 可加载本 CarApp。debug 期用 ALLOW_ALL_HOSTS_VALIDATOR
     * 让 DHU emulator 直接联调；生产 release 必须切到 [HostValidator.Builder]
     * 列白名单 (Google Auto host signature) 防恶意 host 接管 voice 通道。
     *
     * v1.2 Phase 0：debug-only 用 ALLOW_ALL；Phase 3 release polish 切真名单。
     */
    override fun createHostValidator(): HostValidator =
        HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session = CcCarSession()
}
