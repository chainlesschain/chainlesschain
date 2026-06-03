package com.chainlesschain.android.feature.blockchain.domain.model

import com.chainlesschain.android.core.blockchain.contract.ContractABI
import com.chainlesschain.android.core.blockchain.model.SupportedChain
import kotlinx.serialization.Serializable

/**
 * Smart contract domain model
 */
@Serializable
data class SmartContract(
    val id: String,
    val address: String,
    val chain: SupportedChain,
    val name: String? = null,
    val type: ContractType,
    val abi: String? = null, // JSON ABI
    val bytecode: String? = null,
    val sourceCode: String? = null,
    val compilerVersion: String? = null,
    val isVerified: Boolean = false,
    val isProxy: Boolean = false,
    val implementationAddress: String? = null,
    val creator: String? = null,
    val creationTxHash: String? = null,
    val createdAt: Long? = null,
    val metadata: ContractMetadata? = null
) {
    /**
     * Get parsed ABI
     */
    fun parsedAbi(): ContractABI? {
        return abi?.let {
            try {
                ContractABI.fromJson(it)
            } catch (e: Exception) {
                null
            }
        }
    }

    /**
     * Get explorer URL
     */
    fun explorerUrl(): String {
        return "${chain.explorerUrl}/address/$address"
    }
}

/**
 * Contract type
 */
@Serializable
enum class ContractType {
    ERC20,
    ERC721,
    ERC1155,
    PROXY,
    MULTISIG,
    DEX,
    LENDING,
    STAKING,
    BRIDGE,
    MARKETPLACE,
    ESCROW,
    CUSTOM,
    UNKNOWN
}

/**
 * Contract metadata
 */
@Serializable
data class ContractMetadata(
    val description: String? = null,
    val website: String? = null,
    val github: String? = null,
    val audit: ContractAudit? = null,
    val license: String? = null,
    val tags: List<String> = emptyList()
)

/**
 * Contract audit info
 */
@Serializable
data class ContractAudit(
    val auditor: String,
    val reportUrl: String,
    val date: Long,
    val score: String? = null // e.g., "A+", "95/100"
)

/**
 * Contract interaction
 */
@Serializable
data class ContractInteraction(
    val contract: SmartContract,
    val walletAddress: String,
    val functionName: String,
    val functionSignature: String,
    val parameters: List<ContractParameter>,
    val value: String = "0", // ETH value to send
    val isReadOnly: Boolean,
    val estimatedGas: Long? = null
)

/**
 * Contract parameter
 */
@Serializable
data class ContractParameter(
    val name: String,
    val type: String,
    val value: String,
    val displayValue: String? = null
)

/**
 * Contract call result
 */
@Serializable
data class ContractCallResult(
    val success: Boolean,
    val outputs: List<ContractOutput>,
    val error: String? = null,
    val gasUsed: Long? = null,
    val transactionHash: String? = null // For write operations
)

/**
 * Contract output
 */
@Serializable
data class ContractOutput(
    val name: String?,
    val type: String,
    val rawValue: String, // Raw hex or serialized value
    val displayValue: String
)

/**
 * Contract event subscription
 */
@Serializable
data class ContractEventSubscription(
    val id: String,
    val contractAddress: String,
    val chain: SupportedChain,
    val eventName: String,
    val filters: Map<String, String> = emptyMap(), // Indexed parameter filters
    val fromBlock: Long? = null,
    val isActive: Boolean = true,
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * Contract event
 */
@Serializable
data class ContractEvent(
    val subscriptionId: String,
    val contractAddress: String,
    val eventName: String,
    val parameters: Map<String, String>,
    val transactionHash: String,
    val blockNumber: Long,
    val logIndex: Int,
    val timestamp: Long
)

/**
 * Deploy contract request
 */
@Serializable
data class DeployContractRequest(
    val chain: SupportedChain,
    val bytecode: String,
    val abi: String? = null,
    val constructorArgs: List<String> = emptyList(), // Encoded constructor arguments
    val name: String? = null,
    val gasLimit: Long? = null,
    val value: String = "0"
)

/**
 * Deploy contract result
 */
@Serializable
data class DeployContractResult(
    val transactionHash: String,
    val contractAddress: String?,
    val status: TransactionStatus,
    val gasUsed: Long?,
    val error: String? = null
)

/**
 * Saved contracts (user's contract book)
 */
@Serializable
data class SavedContract(
    val contract: SmartContract,
    val alias: String? = null,
    val notes: String? = null,
    val isFavorite: Boolean = false,
    val lastInteraction: Long? = null,
    val interactionCount: Int = 0,
    val addedAt: Long = System.currentTimeMillis()
)
