package com.chainlesschain.android.di

import com.chainlesschain.android.feature.ai.data.ocr.OcrBridge
import com.chainlesschain.android.remote.ocr.RemoteOcrBridge
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * 把 feature-ai 定义的 [OcrBridge] 绑定到 app 模块的 [RemoteOcrBridge] 实装。
 * 单独成 abstract 模块用 @Binds；不并 AppModule（object）避免重构。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class OcrModule {

    @Binds
    @Singleton
    abstract fun bindOcrBridge(impl: RemoteOcrBridge): OcrBridge
}
