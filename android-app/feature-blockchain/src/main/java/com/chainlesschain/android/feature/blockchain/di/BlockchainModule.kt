package com.chainlesschain.android.feature.blockchain.di

import com.chainlesschain.android.core.blockchain.crypto.BiometricSigner
import com.chainlesschain.android.core.blockchain.crypto.KeystoreManager
import com.chainlesschain.android.core.blockchain.crypto.WalletCoreAdapter
import com.chainlesschain.android.core.blockchain.rpc.BlockchainRPCClient
import com.chainlesschain.android.feature.blockchain.data.manager.TransactionManager
import com.chainlesschain.android.feature.blockchain.data.manager.WalletManager
import com.chainlesschain.android.feature.blockchain.data.repository.TransactionRepository
import com.chainlesschain.android.feature.blockchain.data.repository.WalletRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt module for blockchain feature dependencies
 */
@Module
@InstallIn(SingletonComponent::class)
object BlockchainModule {

    @Provides
    @Singleton
    fun provideWalletRepository(): WalletRepository {
        return WalletRepository()
    }

    @Provides
    @Singleton
    fun provideTransactionRepository(): TransactionRepository {
        return TransactionRepository()
    }

    @Provides
    @Singleton
    fun provideWalletManager(
        walletCoreAdapter: WalletCoreAdapter,
        keystoreManager: KeystoreManager,
        rpcClient: BlockchainRPCClient,
        walletRepository: WalletRepository
    ): WalletManager {
        return WalletManager(
            walletCoreAdapter = walletCoreAdapter,
            keystoreManager = keystoreManager,
            rpcClient = rpcClient,
            walletRepository = walletRepository
        )
    }

    @Provides
    @Singleton
    fun provideTransactionManager(
        rpcClient: BlockchainRPCClient,
        keystoreManager: KeystoreManager,
        walletCoreAdapter: WalletCoreAdapter,
        transactionRepository: TransactionRepository
    ): TransactionManager {
        return TransactionManager(
            rpcClient = rpcClient,
            keystoreManager = keystoreManager,
            walletCoreAdapter = walletCoreAdapter,
            transactionRepository = transactionRepository
        )
    }
}
