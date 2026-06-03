package com.chainlesschain.android.feature.blockchain.data.repository

import com.chainlesschain.android.core.blockchain.model.SupportedChain
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.blockchain.domain.model.Transaction
import com.chainlesschain.android.feature.blockchain.domain.model.TransactionStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for transaction data
 */
@Singleton
class TransactionRepository @Inject constructor() {

    // In-memory storage (will be replaced with Room DAO)
    private val transactionsStore = MutableStateFlow<Map<String, Transaction>>(emptyMap())

    /**
     * Get all transactions
     */
    fun getAllTransactions(): Flow<List<Transaction>> {
        return transactionsStore.map {
            it.values.toList().sortedByDescending { tx -> tx.createdAt }
        }
    }

    /**
     * Get transactions for address
     */
    fun getTransactionsForAddress(
        address: String,
        chain: SupportedChain
    ): Flow<List<Transaction>> {
        return transactionsStore.map { transactions ->
            transactions.values
                .filter { tx ->
                    tx.chain == chain &&
                            (tx.from.equals(address, ignoreCase = true) ||
                                    tx.to?.equals(address, ignoreCase = true) == true)
                }
                .sortedByDescending { it.createdAt }
        }
    }

    /**
     * Get pending transactions
     */
    fun getPendingTransactions(): Flow<List<Transaction>> {
        return transactionsStore.map { transactions ->
            transactions.values
                .filter { it.status == TransactionStatus.PENDING }
                .sortedByDescending { it.createdAt }
        }
    }

    /**
     * Get transaction by hash
     */
    suspend fun getTransactionByHash(hash: String): Transaction? {
        return transactionsStore.value.values.find {
            it.hash.equals(hash, ignoreCase = true)
        }
    }

    /**
     * Get transaction by ID
     */
    suspend fun getTransactionById(id: String): Transaction? {
        return transactionsStore.value[id]
    }

    /**
     * Save transaction
     */
    suspend fun saveTransaction(transaction: Transaction): Result<Unit> {
        return try {
            transactionsStore.value = transactionsStore.value + (transaction.id to transaction)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "Failed to save transaction")
        }
    }

    /**
     * Update transaction status
     */
    suspend fun updateTransactionStatus(
        txHash: String,
        status: TransactionStatus,
        blockNumber: Long? = null,
        gasUsed: Long? = null
    ): Result<Unit> {
        val tx = getTransactionByHash(txHash)
            ?: return Result.error(
                IllegalArgumentException("Transaction not found"),
                "Transaction not found"
            )

        val updatedTx = tx.copy(
            status = status,
            blockNumber = blockNumber ?: tx.blockNumber,
            gasUsed = gasUsed ?: tx.gasUsed,
            timestamp = if (status == TransactionStatus.CONFIRMED) System.currentTimeMillis() else tx.timestamp
        )

        return saveTransaction(updatedTx)
    }

    /**
     * Delete transaction
     */
    suspend fun deleteTransaction(id: String): Result<Unit> {
        return try {
            transactionsStore.value = transactionsStore.value - id
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "Failed to delete transaction")
        }
    }

    /**
     * Get transactions by type
     */
    fun getTransactionsByType(
        address: String,
        chain: SupportedChain,
        types: List<com.chainlesschain.android.feature.blockchain.domain.model.TransactionType>
    ): Flow<List<Transaction>> {
        return transactionsStore.map { transactions ->
            transactions.values
                .filter { tx ->
                    tx.chain == chain &&
                            tx.type in types &&
                            (tx.from.equals(address, ignoreCase = true) ||
                                    tx.to?.equals(address, ignoreCase = true) == true)
                }
                .sortedByDescending { it.createdAt }
        }
    }

    /**
     * Count transactions for address
     */
    suspend fun countTransactions(address: String, chain: SupportedChain): Int {
        return transactionsStore.value.values.count { tx ->
            tx.chain == chain &&
                    (tx.from.equals(address, ignoreCase = true) ||
                            tx.to?.equals(address, ignoreCase = true) == true)
        }
    }
}
