package com.chainlesschain.android.auto

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session

/**
 * v1.2 #1 Android Auto Phase 0 — Session 入口，每次 Auto host attach 调一次。
 *
 * Session 生命周期与 Activity 类似但由 Auto host 管。onCreateScreen 必返一个
 * 初始 [Screen]；Phase 0 返占位 [VoiceModeScreen] 显示 "Voice Mode loading..."
 * 卡。后续 Phase 1 同 Screen 接 voice button → ASR pipeline。
 */
class CcCarSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen = VoiceModeScreen(carContext)
}
