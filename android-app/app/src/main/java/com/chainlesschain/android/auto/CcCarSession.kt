package com.chainlesschain.android.auto

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session
import com.chainlesschain.android.feature.ai.data.voice.VoiceModeManager
import dagger.hilt.android.EntryPointAccessors

/**
 * v1.2 #1 Android Auto Phase 1 — Session 入口，每次 Auto host attach 调一次。
 *
 * Phase 1：从 [AutoEntryPoint] 抓单例 [VoiceModeManager] 注给 [VoiceModeScreen]。
 *
 * 可测性：constructor 注入 `voiceManagerProvider`，生产环境 default lambda 走 Hilt
 * 抓取；单测可传入 fake manager（绕开 Hilt application graph）。
 */
class CcCarSession(
    private val voiceManagerProvider: (Session) -> VoiceModeManager = { session ->
        EntryPointAccessors.fromApplication(
            session.carContext.applicationContext,
            AutoEntryPoint::class.java,
        ).voiceModeManager()
    },
) : Session() {
    override fun onCreateScreen(intent: Intent): Screen =
        VoiceModeScreen(carContext, voiceManagerProvider(this))
}
