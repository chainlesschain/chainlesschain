package com.chainlesschain.android.core.blockchain.di

import android.content.Context
import com.chainlesschain.android.core.blockchain.crypto.BiometricSigner
import com.chainlesschain.android.core.blockchain.crypto.KeystoreManager
import com.chainlesschain.android.core.blockchain.crypto.WalletCoreAdapter
import com.chainlesschain.android.core.blockchain.rpc.BlockchainRPCClient
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for core blockchain dependencies
 */
@Module
@InstallIn(SingletonComponent::class)
object BlockchainCoreModule {

    @Provides
    @Singleton
    fun provideBlockchainRPCClient(): BlockchainRPCClient {
        return BlockchainRPCClient()
    }

    @Provides
    @Singleton
    fun provideWalletCoreAdapter(): WalletCoreAdapter {
        return WalletCoreAdapter()
    }

    @Provides
    @Singleton
    fun provideKeystoreManager(
        @ApplicationContext context: Context
    ): KeystoreManager {
        return KeystoreManager(context)
    }

    @Provides
    @Singleton
    fun provideBiometricSigner(
        @ApplicationContext context: Context,
        keystoreManager: KeystoreManager,
        walletCoreAdapter: WalletCoreAdapter
    ): BiometricSigner {
        return BiometricSigner(context, keystoreManager, walletCoreAdapter)
    }
}
