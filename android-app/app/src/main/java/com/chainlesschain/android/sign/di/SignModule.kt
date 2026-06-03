package com.chainlesschain.android.sign.di

import com.chainlesschain.android.sign.AndroidApprovalGate
import com.chainlesschain.android.sign.ApprovalGate
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt binding: [AndroidApprovalGate] (Compose UI-driven) 作为
 * [ApprovalGate] 接口的生产实现，给 [SignAsService] / 反向 sign.request /
 * 未来 M4 D2 桌面 approval channel 在 Android 端使用。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class SignModule {

    @Binds
    @Singleton
    abstract fun bindApprovalGate(impl: AndroidApprovalGate): ApprovalGate
}
