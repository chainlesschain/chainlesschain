package com.chainlesschain.android.core.blockchain.model

import kotlinx.serialization.Serializable

/**
 * Supported blockchain networks (14 chains)
 * Based on iOS Blockchain module configuration
 */
@Serializable
enum class SupportedChain(
    val chainId: Int,
    val chainName: String,
    val symbol: String,
    val decimals: Int,
    val isTestnet: Boolean = false,
    val explorerUrl: String,
    val defaultRpcUrl: String
) {
    // Mainnet chains
    ETHEREUM(
        chainId = 1,
        chainName = "Ethereum",
        symbol = "ETH",
        decimals = 18,
        explorerUrl = "https://etherscan.io",
        defaultRpcUrl = "https://eth.llamarpc.com"
    ),

    BSC(
        chainId = 56,
        chainName = "BNB Smart Chain",
        symbol = "BNB",
        decimals = 18,
        explorerUrl = "https://bscscan.com",
        defaultRpcUrl = "https://bsc-dataseed.binance.org"
    ),

    POLYGON(
        chainId = 137,
        chainName = "Polygon",
        symbol = "MATIC",
        decimals = 18,
        explorerUrl = "https://polygonscan.com",
        defaultRpcUrl = "https://polygon-rpc.com"
    ),

    AVALANCHE(
        chainId = 43114,
        chainName = "Avalanche C-Chain",
        symbol = "AVAX",
        decimals = 18,
        explorerUrl = "https://snowtrace.io",
        defaultRpcUrl = "https://api.avax.network/ext/bc/C/rpc"
    ),

    ARBITRUM(
        chainId = 42161,
        chainName = "Arbitrum One",
        symbol = "ETH",
        decimals = 18,
        explorerUrl = "https://arbiscan.io",
        defaultRpcUrl = "https://arb1.arbitrum.io/rpc"
    ),

    OPTIMISM(
        chainId = 10,
        chainName = "Optimism",
        symbol = "ETH",
        decimals = 18,
        explorerUrl = "https://optimistic.etherscan.io",
        defaultRpcUrl = "https://mainnet.optimism.io"
    ),

    FANTOM(
        chainId = 250,
        chainName = "Fantom",
        symbol = "FTM",
        decimals = 18,
        explorerUrl = "https://ftmscan.com",
        defaultRpcUrl = "https://rpc.ftm.tools"
    ),

    CRONOS(
        chainId = 25,
        chainName = "Cronos",
        symbol = "CRO",
        decimals = 18,
        explorerUrl = "https://cronoscan.com",
        defaultRpcUrl = "https://evm.cronos.org"
    ),

    BASE(
        chainId = 8453,
        chainName = "Base",
        symbol = "ETH",
        decimals = 18,
        explorerUrl = "https://basescan.org",
        defaultRpcUrl = "https://mainnet.base.org"
    ),

    ZKSYNC(
        chainId = 324,
        chainName = "zkSync Era",
        symbol = "ETH",
        decimals = 18,
        explorerUrl = "https://explorer.zksync.io",
        defaultRpcUrl = "https://mainnet.era.zksync.io"
    ),

    LINEA(
        chainId = 59144,
        chainName = "Linea",
        symbol = "ETH",
        decimals = 18,
        explorerUrl = "https://lineascan.build",
        defaultRpcUrl = "https://rpc.linea.build"
    ),

    // Testnet chains
    GOERLI(
        chainId = 5,
        chainName = "Goerli",
        symbol = "ETH",
        decimals = 18,
        isTestnet = true,
        explorerUrl = "https://goerli.etherscan.io",
        defaultRpcUrl = "https://goerli.infura.io/v3/public"
    ),

    SEPOLIA(
        chainId = 11155111,
        chainName = "Sepolia",
        symbol = "ETH",
        decimals = 18,
        isTestnet = true,
        explorerUrl = "https://sepolia.etherscan.io",
        defaultRpcUrl = "https://rpc.sepolia.org"
    ),

    MUMBAI(
        chainId = 80001,
        chainName = "Polygon Mumbai",
        symbol = "MATIC",
        decimals = 18,
        isTestnet = true,
        explorerUrl = "https://mumbai.polygonscan.com",
        defaultRpcUrl = "https://rpc-mumbai.maticvigil.com"
    );

    companion object {
        /**
         * Get chain by chainId
         */
        fun fromChainId(chainId: Int): SupportedChain? {
            return entries.find { it.chainId == chainId }
        }

        /**
         * Get all mainnet chains
         */
        fun mainnets(): List<SupportedChain> {
            return entries.filter { !it.isTestnet }
        }

        /**
         * Get all testnet chains
         */
        fun testnets(): List<SupportedChain> {
            return entries.filter { it.isTestnet }
        }

        /**
         * Get default chain (Ethereum mainnet)
         */
        fun default(): SupportedChain = ETHEREUM
    }
}
