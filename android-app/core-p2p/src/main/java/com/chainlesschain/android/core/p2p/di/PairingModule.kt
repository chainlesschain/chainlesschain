package com.chainlesschain.android.core.p2p.di

import com.chainlesschain.android.core.p2p.pairing.DefaultPairingMessageBus
import com.chainlesschain.android.core.p2p.pairing.PairingMessageBus
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * v1.1 W3.3b：把 [DefaultPairingMessageBus] 绑到 [PairingMessageBus] 接口。
 * 单独 abstract class 因为 [P2PNetworkModule] 是 `object` 不能用 @Binds。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class PairingModule {
    @Binds
    @Singleton
    abstract fun bindPairingMessageBus(
        impl: DefaultPairingMessageBus,
    ): PairingMessageBus
}
