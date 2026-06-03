package com.chainlesschain.android.feature.blockchain.domain.model

import com.chainlesschain.android.core.blockchain.model.SupportedChain
import kotlinx.serialization.Serializable

/**
 * Blockchain transaction domain model
 */
@Serializable
data class Transaction(
    val id: String,
    val hash: String,
    val chain: SupportedChain,
    val from: String,
    val to: String?,
    val value: String, // In wei
    val valueFormatted: String,
    val gasLimit: Long,
    val gasPrice: Long? = null,
    val maxFeePerGas: Long? = null,
    val maxPriorityFeePerGas: Long? = null,
    val gasUsed: Long? = null,
    val nonce: Long,
    val data: String? = null,
    val status: TransactionStatus,
    val blockNumber: Long? = null,
    val blockHash: String? = null,
    val timestamp: Long? = null,
    val confirmations: Int = 0,
    val type: TransactionType,
    val metadata: TransactionMetadata? = null,
    val createdAt: Long = System.currentTimeMillis()
) {
    /**
     * Check if transaction is confirmed
     */
    val isConfirmed: Boolean
        get() = status == TransactionStatus.CONFIRMED

    /**
     * Check if transaction is pending
     */
    val isPending: Boolean
        get() = status == TransactionStatus.PENDING

    /**
     * Check if transaction failed
     */
    val isFailed: Boolean
        get() = status == TransactionStatus.FAILED

    /**
     * Get gas cost in native token
     */
    val gasCost: Double?
        get() {
            val used = gasUsed ?: return null
            val price = gasPrice ?: maxFeePerGas ?: return null
            return (used * price).toDouble() / 1e18
        }

    /**
     * Get explorer URL
     */
    fun explorerUrl(): String {
        return "${chain.explorerUrl}/tx/$hash"
    }
}

/**
 * Transaction status
 */
@Serializable
enum class TransactionStatus {
    PENDING,
    CONFIRMED,
    FAILED,
    DROPPED,
    REPLACED
}

/**
 * Transaction type
 */
@Serializable
enum class TransactionType {
    NATIVE_TRANSFER,
    TOKEN_TRANSFER,
    TOKEN_APPROVAL,
    NFT_TRANSFER,
    CONTRACT_CALL,
    CONTRACT_DEPLOY,
    SWAP,
    BRIDGE,
    STAKE,
    UNSTAKE,
    CLAIM,
    UNKNOWN
}

/**
 * Transaction metadata
 */
@Serializable
data class TransactionMetadata(
    val token: Token? = null,
    val nft: NFT? = null,
    val tokenAmount: String? = null,
    val tokenAmountFormatted: String? = null,
    val contractName: String? = null,
    val methodName: String? = null,
    val methodId: String? = null, // First 4 bytes of data
    val error: String? = null,
    val revertReason: String? = null,
    val internalTransactions: List<InternalTransaction> = emptyList(),
    val logs: List<TransactionLog> = emptyList()
)

/**
 * Internal transaction (trace)
 */
@Serializable
data class InternalTransaction(
    val from: String,
    val to: String,
    val value: String,
    val valueFormatted: String,
    val type: String, // call, create, delegatecall, etc.
    val error: String? = null
)

/**
 * Transaction log (event)
 */
@Serializable
data class TransactionLog(
    val address: String,
    val topics: List<String>,
    val data: String,
    val logIndex: Int,
    val eventName: String? = null,
    val decodedData: Map<String, String>? = null
)

/**
 * Transaction request (for sending)
 */
@Serializable
data class TransactionRequest(
    val from: String,
    val to: String,
    val value: String = "0x0",
    val data: String? = null,
    val gasLimit: Long? = null,
    val gasPrice: Long? = null,
    val maxFeePerGas: Long? = null,
    val maxPriorityFeePerGas: Long? = null,
    val nonce: Long? = null,
    val chain: SupportedChain
) {
    /**
     * Check if this is EIP-1559 transaction
     */
    val isEip1559: Boolean
        get() = maxFeePerGas != null && maxPriorityFeePerGas != null
}

/**
 * Signed transaction
 */
@Serializable
data class SignedTransaction(
    val request: TransactionRequest,
    val signedData: String, // Hex encoded signed transaction
    val hash: String // Transaction hash
)

/**
 * Transaction receipt
 */
@Serializable
data class TransactionReceipt(
    val transactionHash: String,
    val blockNumber: Long,
    val blockHash: String,
    val from: String,
    val to: String?,
    val contractAddress: String?, // If contract creation
    val gasUsed: Long,
    val effectiveGasPrice: Long,
    val status: Boolean, // true = success
    val logs: List<TransactionLog>,
    val cumulativeGasUsed: Long,
    val type: Int // 0 = legacy, 2 = EIP-1559
)

/**
 * Pending transaction info
 */
@Serializable
data class PendingTransaction(
    val hash: String,
    val from: String,
    val to: String?,
    val value: String,
    val nonce: Long,
    val gasPrice: Long?,
    val maxFeePerGas: Long?,
    val createdAt: Long,
    val chain: SupportedChain
) {
    /**
     * Check if transaction might be stuck
     */
    fun isStuck(currentTimeMs: Long, thresholdMs: Long = 300_000L): Boolean {
        return currentTimeMs - createdAt > thresholdMs
    }
}

/**
 * Speed up / cancel transaction options
 */
@Serializable
data class ReplaceTransactionOptions(
    val originalHash: String,
    val type: ReplaceType,
    val gasMultiplier: Double = 1.1 // 10% increase by default
)

/**
 * Replace transaction type
 */
@Serializable
enum class ReplaceType {
    SPEED_UP, // Same transaction with higher gas
    CANCEL   // Send 0 value to self with higher gas
}
