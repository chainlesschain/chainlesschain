package com.chainlesschain.android.auto

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.chainlesschain.android.feature.ai.data.voice.VoiceModeManager
import com.chainlesschain.android.feature.ai.data.voice.VoiceModeState
import com.chainlesschain.android.push.NotificationPayload
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * v1.2 #1 Android Auto — Voice Mode Screen，接 ASR pipeline + Push 审批。
 *
 * Phase 1：state machine 渲染 (Idle / Recording / Transcribing / Thinking /
 *   Speaking / Done / Failed)，Mic/Stop/Cancel actions。
 * Phase 2：subscribe [AutoPushBus]，收到 Marketplace / SystemAlert 推送时显示
 *   approval 模板（大按钮"同意"/"拒绝"）。pendingApproval 不为 null 时优先于
 *   voice state 渲染；用户决定后回写 [AutoPushBus.userDecision] 并清掉 pending。
 *
 * 安全合规（Android Auto template constraints）：
 *   - 不暴露 ChatPanel 等触摸密集 UI，全 voice driven + 大按钮 confirm。
 *   - 司机驾车时只能通过方向盘 voice 键或大 Mic 按钮触发录音（最少触摸交互）。
 *
 * Lifecycle：Screen 自带 lifecycle (CREATED/STARTED/RESUMED)。CREATE 启动两个
 * collect job（voice state + push bus），DESTROYED 时撤销。
 */
class VoiceModeScreen(
    carContext: CarContext,
    private val voiceManager: VoiceModeManager,
    private val pushBus: AutoPushBus,
) : Screen(carContext) {

    private var collectVoiceJob: Job? = null
    private var collectPushJob: Job? = null

    @Volatile
    private var pendingApproval: NotificationPayload? = null

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) {
                collectVoiceJob = lifecycleScope.launch {
                    voiceManager.state.collect { _ ->
                        invalidate()
                    }
                }
                collectPushJob = lifecycleScope.launch {
                    pushBus.events.collect { event ->
                        when (event) {
                            is AutoPushEvent.Incoming -> {
                                // 同时多条到达：仅显示最新 — Auto 单 surface 单卡片
                                pendingApproval = event.payload
                                invalidate()
                            }
                            is AutoPushEvent.Decision -> {
                                // 我们自己 emit 的 Decision，不响应（防回路）
                            }
                        }
                    }
                }
            }

            override fun onDestroy(owner: LifecycleOwner) {
                collectVoiceJob?.cancel()
                collectVoiceJob = null
                collectPushJob?.cancel()
                collectPushJob = null
                voiceManager.cancel()
            }
        })
    }

    override fun onGetTemplate(): Template {
        val pending = pendingApproval
        return if (pending != null) buildApprovalTemplate(pending) else buildVoiceTemplate()
    }

    private fun buildVoiceTemplate(): Template {
        val state = voiceManager.state.value
        val builder = MessageTemplate.Builder(buildBody(state))
            .setTitle("ChainlessChain Voice")
            .setHeaderAction(Action.APP_ICON)

        when (state) {
            is VoiceModeState.Idle,
            is VoiceModeState.Done,
            is VoiceModeState.Failed -> {
                builder.addAction(
                    Action.Builder()
                        .setTitle("🎤 开始录音")
                        .setBackgroundColor(CarColor.PRIMARY)
                        .setOnClickListener { startRecording() }
                        .build(),
                )
            }
            is VoiceModeState.Recording -> {
                builder.addAction(
                    Action.Builder()
                        .setTitle("⏹ 停止")
                        .setBackgroundColor(CarColor.PRIMARY)
                        .setOnClickListener { stopAndProcess() }
                        .build(),
                )
                builder.addAction(
                    Action.Builder()
                        .setTitle("取消")
                        .setOnClickListener { voiceManager.cancel() }
                        .build(),
                )
            }
            is VoiceModeState.Transcribing,
            is VoiceModeState.Thinking,
            is VoiceModeState.Speaking -> {
                builder.addAction(
                    Action.Builder()
                        .setTitle("取消")
                        .setOnClickListener { voiceManager.cancel() }
                        .build(),
                )
            }
        }
        return builder.build()
    }

    private fun buildApprovalTemplate(payload: NotificationPayload): Template {
        return MessageTemplate.Builder(buildApprovalBody(payload))
            .setTitle(approvalTitle(payload))
            .setHeaderAction(Action.APP_ICON)
            .addAction(
                Action.Builder()
                    .setTitle("✅ 同意")
                    .setBackgroundColor(CarColor.GREEN)
                    .setOnClickListener { resolveApproval(approved = true) }
                    .build(),
            )
            .addAction(
                Action.Builder()
                    .setTitle("❌ 拒绝")
                    .setBackgroundColor(CarColor.RED)
                    .setOnClickListener { resolveApproval(approved = false) }
                    .build(),
            )
            .build()
    }

    /** state → 卡片文案（voice mode）。 */
    private fun buildBody(state: VoiceModeState): String = when (state) {
        is VoiceModeState.Idle -> "按下 🎤 开始录音\n开车场景仅支持语音对话。"
        is VoiceModeState.Recording -> "🔴 正在听...\n说完后按停止。"
        is VoiceModeState.Transcribing -> "识别中..."
        is VoiceModeState.Thinking -> "你说: ${state.userText}\n\n桌面正在思考..."
        is VoiceModeState.Speaking -> "你说: ${state.userText}\n\n回复: ${state.replyText}"
        is VoiceModeState.Done -> "回复: ${state.replyText}"
        is VoiceModeState.Failed -> "出错 (${state.stage}): ${state.message}"
    }

    /** payload → approval 卡片标题。 */
    internal fun approvalTitle(payload: NotificationPayload): String = when (payload) {
        is NotificationPayload.MarketplacePurchaseApproval -> "Marketplace 审批"
        is NotificationPayload.SystemAlertNotice -> "系统警报"
        is NotificationPayload.CoworkRequest,
        is NotificationPayload.ShareInboxSummary -> "通知"
    }

    /** payload → approval 卡片正文。 */
    internal fun buildApprovalBody(payload: NotificationPayload): String = when (payload) {
        is NotificationPayload.MarketplacePurchaseApproval ->
            "订单 ${payload.orderId}\n金额 ${payload.total} ${payload.currency}" +
                (payload.itemName?.let { "\n商品: $it" } ?: "")

        is NotificationPayload.SystemAlertNotice ->
            "${payload.title}\n\n${payload.body}\n\n[${payload.severity}]"

        is NotificationPayload.CoworkRequest ->
            "Cowork 任务 ${payload.taskId}\n${payload.summary}"

        is NotificationPayload.ShareInboxSummary ->
            "${payload.count} 条分享已入箱"
    }

    private fun resolveApproval(approved: Boolean) {
        val payload = pendingApproval ?: return
        pendingApproval = null
        lifecycleScope.launch {
            runCatching {
                pushBus.userDecision(AutoApprovalDecision(payload, approved))
            }.onFailure { Timber.w(it, "VoiceModeScreen.resolveApproval: bus emit failed") }
        }
        invalidate()
    }

    private fun startRecording() {
        val ok = voiceManager.startRecording()
        if (!ok) {
            Timber.w("VoiceModeScreen.startRecording: 拒启动，state=${voiceManager.state.value}")
        }
    }

    private fun stopAndProcess() {
        lifecycleScope.launch {
            voiceManager.stopAndProcess()
        }
    }

    // 测试钩子
    internal fun bodyFor(state: VoiceModeState): String = buildBody(state)
    internal fun setPendingApprovalForTest(payload: NotificationPayload?) {
        pendingApproval = payload
    }

    internal fun currentPendingApproval(): NotificationPayload? = pendingApproval
}
