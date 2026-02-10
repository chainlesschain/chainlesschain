package com.chainlesschain.android.core.blockchain.model

import kotlinx.serialization.Serializable

/**
 * Network configuration for a blockchain
 */
@Serializable
data class NetworkConfig(
    val chain: SupportedChain,
    val rpcUrl: String = chain.defaultRpcUrl,
    val wsUrl: String? = null,
    val apiKey: String? = null,
    val timeout: Long = 30_000L,
    val maxRetries: Int = 3,
    val enableCache: Boolean = true,
    val cacheTtlMs: Long = 60_000L
) {
    /**
     * Get the full RPC URL with API key if available
     */
    fun getFullRpcUrl(): String {
        return if (apiKey != null && rpcUrl.contains("{apiKey}")) {
            rpcUrl.replace("{apiKey}", apiKey)
        } else {
            rpcUrl
        }
    }

    companion object {
        /**
         * Create default config for a chain
         */
        fun default(chain: SupportedChain): NetworkConfig {
            return NetworkConfig(chain = chain)
        }

        /**
         * Create config with custom RPC
         */
        fun withCustomRpc(
            chain: SupportedChain,
            rpcUrl: String,
            apiKey: String? = null
        ): NetworkConfig {
            return NetworkConfig(
                chain = chain,
                rpcUrl = rpcUrl,
                apiKey = apiKey
            )
        }
    }
}

/**
 * Gas estimation result
 */
@Serializable
data class GasEstimate(
    val gasLimit: Long,
    val gasPrice: Long,
    val maxFeePerGas: Long? = null,
    val maxPriorityFeePerGas: Long? = null,
    val estimatedCostWei: Long,
    val estimatedCostEth: Double
) {
    /**
     * Check if this is EIP-1559 gas pricing
     */
    val isEip1559: Boolean
        get() = maxFeePerGas != null && maxPriorityFeePerGas != null

    companion object {
        /**
         * Calculate estimated cost in native token
         */
        fun calculateCost(gasLimit: Long, gasPrice: Long, decimals: Int): Double {
            val costWei = gasLimit * gasPrice
            return costWei.toDouble() / Math.pow(10.0, decimals.toDouble())
        }
    }
}

/**
 * Gas price tiers
 */
@Serializable
data class GasPriceTiers(
    val slow: GasEstimate,
    val standard: GasEstimate,
    val fast: GasEstimate,
    val instant: GasEstimate? = null
)
