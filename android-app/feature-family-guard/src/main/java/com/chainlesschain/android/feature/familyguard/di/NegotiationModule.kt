package com.chainlesschain.android.feature.familyguard.di

import com.chainlesschain.android.feature.familyguard.data.negotiation.NoOpGroupChatNotifier
import com.chainlesschain.android.feature.familyguard.domain.negotiation.GroupChatNotifier
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * FAMILY-62 多家长协商频道 DI 图。**独立成文件**（不并入并行改动中的 FamilyGuardBindingsModule）
 * 降冲突面（同 AnomalyModule / SosModule / FamilyGeofenceBindingsModule 策略）。
 *
 * GuardianChannelResolver / FamilyNegotiationCoordinator 是 @Inject 具象类，Hilt 直接构造，
 * 无需 @Binds；本模块只绑 GroupChatNotifier 的 NoOp 默认（:app 接 friend chat 覆盖）。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class NegotiationModule {

    @Binds
    @Singleton
    abstract fun bindGroupChatNotifier(impl: NoOpGroupChatNotifier): GroupChatNotifier
}
