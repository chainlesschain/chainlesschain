package com.chainlesschain.android.call

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dagger.hilt.android.AndroidEntryPoint
import timber.log.Timber
import javax.inject.Inject

/**
 * FAMILY-67 通话通知动作接收器（P3）。来电/通话中通知的 接听/拒接/挂断 按钮 → [CallManager]。
 * 接听后额外拉起 [CallActivity] 展示通话 UI（锁屏/后台来电也能进通话界面）。
 */
@AndroidEntryPoint
class CallActionReceiver : BroadcastReceiver() {

    @Inject lateinit var callManager: CallManager

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            CallNotifications.ACTION_ACCEPT -> {
                Timber.i("[CallAction] accept")
                callManager.accept()
                runCatching {
                    context.startActivity(
                        Intent(context, CallActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                }
            }
            CallNotifications.ACTION_REJECT -> {
                Timber.i("[CallAction] reject")
                callManager.reject()
            }
            CallNotifications.ACTION_HANGUP -> {
                Timber.i("[CallAction] hangup")
                callManager.hangup()
            }
        }
    }
}
