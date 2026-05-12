package com.chainlesschain.android.auto

import com.chainlesschain.android.feature.ai.data.voice.VoiceModeManager
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/**
 * v1.2 #1 Android Auto Phase 1 — Hilt entry-point for non-injectable car-app classes。
 *
 * `androidx.car.app.Screen` 不是 ViewModel / Activity / Composable，Hilt 不会自动
 * 注入。从 [CcCarAppService] @AndroidEntryPoint 拿到 application context 后用
 * `EntryPointAccessors.fromApplication(context, AutoEntryPoint::class.java)` 抓
 * 单例 [VoiceModeManager]（feature-ai 已 @Singleton 注入 Application graph）。
 *
 * 添加新依赖：在此 interface 加新方法，Hilt 会从 SingletonComponent 解析。
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface AutoEntryPoint {
    fun voiceModeManager(): VoiceModeManager
}
