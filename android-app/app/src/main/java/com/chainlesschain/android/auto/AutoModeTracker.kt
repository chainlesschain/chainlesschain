package com.chainlesschain.android.auto

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.2 #1 Android Auto Phase 2 — Auto host attach 状态全局追踪。
 *
 * [CcCarAppService.onCreate] / [onDestroy] 翻转 [isAutoActive]，让其它模块（如
 * [com.chainlesschain.android.push.NotificationCenter]）按 Auto 模式裁剪 UI：
 *   - Auto active：Marketplace / SystemAlert 类别通知额外推到 [AutoPushBus]，
 *     VoiceModeScreen 显示语音/大按钮审批卡，不弹手机端横幅卡。
 *   - Auto inactive：常规手机 NotificationManagerCompat.notify 路径。
 *
 * 单例：Hilt @Singleton，整个 process 共享一份；Auto host 同一时刻只能 attach
 * 一次（CarApp framework guarantee）。
 */
@Singleton
class AutoModeTracker @Inject constructor() {

    private val _isAutoActive = MutableStateFlow(false)
    val isAutoActive: StateFlow<Boolean> = _isAutoActive.asStateFlow()

    fun markActive() {
        _isAutoActive.value = true
        Timber.i("AutoModeTracker: Auto host attached")
    }

    fun markInactive() {
        _isAutoActive.value = false
        Timber.i("AutoModeTracker: Auto host detached")
    }
}
