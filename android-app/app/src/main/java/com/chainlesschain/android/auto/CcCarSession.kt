package com.chainlesschain.android.auto

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session
import com.chainlesschain.android.feature.ai.data.voice.VoiceModeManager
import dagger.hilt.android.EntryPointAccessors

/**
 * v1.2 #1 Android Auto — Session 入口，每次 Auto host attach 调一次。
 *
 * Phase 1：注入 [VoiceModeManager] 给 [VoiceModeScreen]。
 * Phase 2：再注入 [AutoPushBus]，Screen 订阅 push 事件显示审批模板。
 *
 * 可测性：constructor 接 lambda，生产 default 走 Hilt EntryPointAccessors，
 * 单测可传 fake 实例（绕开 Hilt application graph）。
 */
class CcCarSession(
    private val voiceManagerProvider: (Session) -> VoiceModeManager = { session ->
        EntryPointAccessors.fromApplication(
            session.carContext.applicationContext,
            AutoEntryPoint::class.java,
        ).voiceModeManager()
    },
    private val pushBusProvider: (Session) -> AutoPushBus = { session ->
        EntryPointAccessors.fromApplication(
            session.carContext.applicationContext,
            AutoEntryPoint::class.java,
        ).autoPushBus()
    },
) : Session() {
    override fun onCreateScreen(intent: Intent): Screen =
        VoiceModeScreen(carContext, voiceManagerProvider(this), pushBusProvider(this))
}
