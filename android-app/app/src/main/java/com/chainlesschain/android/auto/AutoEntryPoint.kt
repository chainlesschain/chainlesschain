package com.chainlesschain.android.auto

import com.chainlesschain.android.feature.ai.data.voice.VoiceModeManager
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/**
 * v1.2 #1 Android Auto — Hilt entry-point for non-injectable car-app classes。
 *
 * `androidx.car.app.Screen` 不是 ViewModel / Activity / Composable，Hilt 不会自动
 * 注入。从 [CcCarAppService] @AndroidEntryPoint 拿到 application context 后用
 * `EntryPointAccessors.fromApplication(context, AutoEntryPoint::class.java)` 抓
 * 单例（feature-ai / Auto 模块的 Singletons 都在 Application graph）。
 *
 * 添加新依赖：在此 interface 加新方法，Hilt 会从 SingletonComponent 解析。
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface AutoEntryPoint {
    fun voiceModeManager(): VoiceModeManager

    /** Phase 2：Auto 模式下接收 Marketplace / SystemAlert 通知的 bus。 */
    fun autoPushBus(): AutoPushBus
}
