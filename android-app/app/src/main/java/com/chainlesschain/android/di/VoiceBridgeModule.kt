package com.chainlesschain.android.di

import com.chainlesschain.android.feature.ai.data.voice.VoiceChatBridge
import com.chainlesschain.android.remote.voice.RemoteVoiceChatBridge
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * 把 feature-ai 定义的 [VoiceChatBridge] 接口绑定到 app 模块的 [RemoteVoiceChatBridge]
 * 实现，让 feature-ai 的 VoiceModeManager 可在 SingletonComponent 完成注入。
 *
 * 单独成模块（abstract）以便用 @Binds；不并入 AppModule（object），避免重构 AppModule。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class VoiceBridgeModule {

    @Binds
    @Singleton
    abstract fun bindVoiceChatBridge(impl: RemoteVoiceChatBridge): VoiceChatBridge
}
