package com.chainlesschain.android.call

import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import com.chainlesschain.android.call.ui.CallHost
import android.content.Context
import com.chainlesschain.android.core.ui.theme.ChainlessChainTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * FAMILY-67 通话全屏 Activity（P3）。锁屏/后台来电经全屏 intent 拉起本页（[setShowWhenLocked] +
 * [setTurnScreenOn] 越过锁屏并点亮屏幕）。内容即全局 [CallHost]（渲染当前通话单例状态）。
 *
 * 通话结束（状态变 null）→ finish。语音通话激活时用 PROXIMITY_SCREEN_OFF_WAKE_LOCK 贴耳息屏。
 */
@AndroidEntryPoint
class CallActivity : ComponentActivity() {

    @Inject lateinit var callManager: CallManager

    private var proximityLock: PowerManager.WakeLock? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showWhenLockedAndTurnScreenOn()

        setContent {
            ChainlessChainTheme {
                CallHost()
            }
        }

        // 结束即关页；语音激活时贴耳息屏。
        lifecycleScope.launch {
            callManager.callState.collect { s ->
                if (s == null) {
                    releaseProximity()
                    if (!isFinishing) finish()
                    return@collect
                }
                val audioActive = s.state == CallState.ACTIVE && s.media == CallMediaType.AUDIO
                if (audioActive) acquireProximity() else releaseProximity()
            }
        }
    }

    private fun showWhenLockedAndTurnScreenOn() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            )
        }
    }

    @Suppress("WakelockTimeout")
    private fun acquireProximity() {
        if (proximityLock?.isHeld == true) return
        runCatching {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return
            proximityLock = pm.newWakeLock(
                PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK,
                "chainlesschain:call_proximity",
            ).also { it.acquire() }
            Timber.d("[Call] proximity wakelock acquired")
        }
    }

    private fun releaseProximity() {
        runCatching { proximityLock?.takeIf { it.isHeld }?.release() }
        proximityLock = null
    }

    override fun onDestroy() {
        releaseProximity()
        super.onDestroy()
    }
}
