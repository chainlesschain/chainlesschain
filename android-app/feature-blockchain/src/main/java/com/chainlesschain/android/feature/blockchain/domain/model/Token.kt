package com.chainlesschain.android.feature.blockchain.domain.model

import com.chainlesschain.android.core.blockchain.model.SupportedChain
import kotlinx.serialization.Serializable

/**
 * Token domain model (ERC20, etc.)
 */
@Serializable
data class Token(
    val id: String,
    val address: String,
    val chain: SupportedChain,
    val name: String,
    val symbol: String,
    val decimals: Int,
    val logoUrl: String? = null,
    val isNative: Boolean = false,
    val isVerified: Boolean = false,
    val coingeckoId: String? = null,
    val price: TokenPrice? = null,
    val metadata: TokenMetadata? = null
) {
    /**
     * Get unique identifier across chains
     */
    val uniqueId: String
        get() = "${chain.chainId}:$address"

    /**
     * Format amount from raw to display
     */
    fun formatAmount(rawAmount: String): String {
        return try {
            val value = rawAmount.toBigDecimal()
            val divisor = java.math.BigDecimal.TEN.pow(decimals)
            val formatted = value.divide(divisor, decimals, java.math.RoundingMode.HALF_UP)
            formatted.stripTrailingZeros().toPlainString()
        } catch (e: Exception) {
            "0"
        }
    }

    /**
     * Parse display amount to raw
     */
    fun parseAmount(displayAmount: String): String {
        return try {
            val value = displayAmount.toBigDecimal()
            val multiplier = java.math.BigDecimal.TEN.pow(decimals)
            val raw = value.multiply(multiplier)
            raw.toBigInteger().toString()
        } catch (e: Exception) {
            "0"
        }
    }

    companion object {
        /**
         * Create native token for chain
         */
        fun nativeToken(chain: SupportedChain): Token {
            return Token(
                id = "native_${chain.chainId}",
                address = "0x0000000000000000000000000000000000000000",
                chain = chain,
                name = chain.name,
                symbol = chain.symbol,
                decimals = chain.decimals,
                isNative = true,
                isVerified = true
            )
        }
    }
}

/**
 * Token price information
 */
@Serializable
data class TokenPrice(
    val usd: Double,
    val usd24hChange: Double? = null,
    val usd24hVolume: Double? = null,
    val marketCap: Double? = null,
    val updatedAt: Long = System.currentTimeMillis()
)

/**
 * Token metadata
 */
@Serializable
data class TokenMetadata(
    val description: String? = null,
    val website: String? = null,
    val twitter: String? = null,
    val telegram: String? = null,
    val discord: String? = null,
    val totalSupply: String? = null,
    val circulatingSupply: String? = null,
    val contractCreator: String? = null,
    val isProxy: Boolean = false,
    val implementationAddress: String? = null
)

/**
 * Token allowance
 */
@Serializable
data class TokenAllowance(
    val token: Token,
    val owner: String,
    val spender: String,
    val allowance: String, // Raw amount
    val allowanceFormatted: String,
    val isUnlimited: Boolean = false
)

/**
 * Token transfer
 */
@Serializable
data class TokenTransfer(
    val token: Token,
    val from: String,
    val to: String,
    val amount: String,
    val amountFormatted: String,
    val transactionHash: String,
    val blockNumber: Long,
    val timestamp: Long,
    val logIndex: Int
)

/**
 * Popular tokens by chain
 */
object PopularTokens {
    val ETHEREUM = listOf(
        Token(
            id = "eth_usdt",
            address = "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            chain = SupportedChain.ETHEREUM,
            name = "Tether USD",
            symbol = "USDT",
            decimals = 6,
            isVerified = true,
            coingeckoId = "tether"
        ),
        Token(
            id = "eth_usdc",
            address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            chain = SupportedChain.ETHEREUM,
            name = "USD Coin",
            symbol = "USDC",
            decimals = 6,
            isVerified = true,
            coingeckoId = "usd-coin"
        ),
        Token(
            id = "eth_dai",
            address = "0x6B175474E89094C44Da98b954EesdeB131e560d7F",
            chain = SupportedChain.ETHEREUM,
            name = "Dai Stablecoin",
            symbol = "DAI",
            decimals = 18,
            isVerified = true,
            coingeckoId = "dai"
        ),
        Token(
            id = "eth_weth",
            address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            chain = SupportedChain.ETHEREUM,
            name = "Wrapped Ether",
            symbol = "WETH",
            decimals = 18,
            isVerified = true,
            coingeckoId = "weth"
        )
    )

    val BSC = listOf(
        Token(
            id = "bsc_busd",
            address = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
            chain = SupportedChain.BSC,
            name = "BUSD Token",
            symbol = "BUSD",
            decimals = 18,
            isVerified = true
        ),
        Token(
            id = "bsc_usdt",
            address = "0x55d398326f99059fF775485246999027B3197955",
            chain = SupportedChain.BSC,
            name = "Tether USD",
            symbol = "USDT",
            decimals = 18,
            isVerified = true
        )
    )

    val POLYGON = listOf(
        Token(
            id = "polygon_usdc",
            address = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
            chain = SupportedChain.POLYGON,
            name = "USD Coin (PoS)",
            symbol = "USDC",
            decimals = 6,
            isVerified = true
        ),
        Token(
            id = "polygon_usdt",
            address = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
            chain = SupportedChain.POLYGON,
            name = "Tether USD",
            symbol = "USDT",
            decimals = 6,
            isVerified = true
        )
    )

    fun forChain(chain: SupportedChain): List<Token> {
        return when (chain) {
            SupportedChain.ETHEREUM -> ETHEREUM
            SupportedChain.BSC -> BSC
            SupportedChain.POLYGON -> POLYGON
            else -> emptyList()
        }
    }
}
