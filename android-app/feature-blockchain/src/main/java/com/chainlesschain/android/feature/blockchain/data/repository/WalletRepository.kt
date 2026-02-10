package com.chainlesschain.android.feature.blockchain.data.repository

import com.chainlesschain.android.core.blockchain.model.SupportedChain
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.blockchain.domain.model.Wallet
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for wallet data
 * In-memory implementation for now, will be connected to Room database
 */
@Singleton
class WalletRepository @Inject constructor() {

    // In-memory storage (will be replaced with Room DAO)
    private val walletsStore = MutableStateFlow<Map<String, Wallet>>(emptyMap())

    /**
     * Get all wallets as Flow
     */
    fun getAllWallets(): Flow<List<Wallet>> {
        return walletsStore.map { it.values.toList().sortedByDescending { w -> w.createdAt } }
    }

    /**
     * Get wallets by chain
     */
    fun getWalletsByChain(chain: SupportedChain): Flow<List<Wallet>> {
        return walletsStore.map { wallets ->
            wallets.values
                .filter { it.chain == chain }
                .sortedByDescending { it.createdAt }
        }
    }

    /**
     * Get wallet by ID
     */
    suspend fun getWalletById(id: String): Wallet? {
        return walletsStore.value[id]
    }

    /**
     * Get wallet by address
     */
    suspend fun getWalletByAddress(address: String, chain: SupportedChain): Wallet? {
        return walletsStore.value.values.find {
            it.address.equals(address, ignoreCase = true) && it.chain == chain
        }
    }

    /**
     * Save wallet
     */
    suspend fun saveWallet(wallet: Wallet): Result<Unit> {
        return try {
            walletsStore.value = walletsStore.value + (wallet.id to wallet)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "Failed to save wallet")
        }
    }

    /**
     * Delete wallet
     */
    suspend fun deleteWallet(id: String): Result<Unit> {
        return try {
            walletsStore.value = walletsStore.value - id
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "Failed to delete wallet")
        }
    }

    /**
     * Get default wallet
     */
    suspend fun getDefaultWallet(): Wallet? {
        return walletsStore.value.values.find { it.isDefault }
    }

    /**
     * Update wallet
     */
    suspend fun updateWallet(wallet: Wallet): Result<Unit> {
        return saveWallet(wallet.copy(updatedAt = System.currentTimeMillis()))
    }

    /**
     * Count wallets
     */
    suspend fun countWallets(): Int {
        return walletsStore.value.size
    }
}
