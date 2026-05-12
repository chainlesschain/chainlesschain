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
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * v1.2 #1 Android Auto Phase 1 — Voice Mode Screen 接 AsrEngine → REMOTE chat → TTS。
 *
 * 设计：
 *   - 持有 [VoiceModeManager]（feature-ai 单例）。点击 Mic action → [startOrStop]。
 *   - 订阅 manager.state；每次 state 切换调 [invalidate] 触发 [onGetTemplate] 重渲染。
 *   - state machine: Idle → Recording → Transcribing → Thinking → Speaking → Done / Failed。
 *
 * 安全合规（Android Auto template constraints）：
 *   - 不暴露 ChatPanel 等触摸密集 UI，全 voice driven + 大按钮 confirm。
 *   - 司机驾车时只能通过方向盘 voice 键或大 Mic 按钮触发录音（最少触摸交互）。
 *
 * Lifecycle：Screen 自带 lifecycle (CREATED/STARTED/RESUMED)。我们在 onCreate 启动
 * 一个 collect job，DESTROYED 时自动撤销（lifecycleScope 跟 Screen lifecycle 走）。
 *
 * Phase 2 增量点：state=Thinking/Speaking 期间接 Push 类别审批弹层；
 * Phase 3 polish: Refresh action 改成 "回 Idle 状态" + 增加 Continuous 模式 toggle。
 */
class VoiceModeScreen(
    carContext: CarContext,
    private val voiceManager: VoiceModeManager,
) : Screen(carContext) {

    private var collectJob: Job? = null

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) {
                collectJob = lifecycleScope.launch {
                    voiceManager.state.collect { _ ->
                        // 状态变化必须主动 invalidate；Auto host 不会自动观察
                        // suspend collector，必须手动通知。
                        invalidate()
                    }
                }
            }

            override fun onDestroy(owner: LifecycleOwner) {
                collectJob?.cancel()
                collectJob = null
                // Screen destroy 时取消录音/播放，防孤儿后台资源
                voiceManager.cancel()
            }
        })
    }

    override fun onGetTemplate(): Template {
        val state = voiceManager.state.value
        val body = buildBody(state)
        val builder = MessageTemplate.Builder(body)
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

    /** 抽出来便于单测：state → 卡片文案。 */
    private fun buildBody(state: VoiceModeState): String = when (state) {
        is VoiceModeState.Idle -> "按下 🎤 开始录音\n开车场景仅支持语音对话。"
        is VoiceModeState.Recording -> "🔴 正在听...\n说完后按停止。"
        is VoiceModeState.Transcribing -> "识别中..."
        is VoiceModeState.Thinking -> "你说: ${state.userText}\n\n桌面正在思考..."
        is VoiceModeState.Speaking -> "你说: ${state.userText}\n\n回复: ${state.replyText}"
        is VoiceModeState.Done -> "回复: ${state.replyText}"
        is VoiceModeState.Failed -> "出错 (${state.stage}): ${state.message}"
    }

    private fun startRecording() {
        val ok = voiceManager.startRecording()
        if (!ok) {
            Timber.w("VoiceModeScreen.startRecording: 拒启动，state=${voiceManager.state.value}")
        }
        // 不需要手动 invalidate — state collector 监听到变化会自动 invalidate
    }

    private fun stopAndProcess() {
        lifecycleScope.launch {
            voiceManager.stopAndProcess()
        }
    }

    // 测试钩子：让单测可以直接 build MessageTemplate 不经 onGetTemplate 内部
    internal fun bodyFor(state: VoiceModeState): String = buildBody(state)
}
