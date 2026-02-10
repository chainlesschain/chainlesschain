package com.chainlesschain.android.feature.blockchain.domain.model

import com.chainlesschain.android.core.blockchain.model.SupportedChain
import kotlinx.serialization.Serializable

/**
 * Wallet domain model
 */
@Serializable
data class Wallet(
    val id: String,
    val name: String,
    val address: String,
    val chain: SupportedChain,
    val walletType: WalletType,
    val provider: WalletProvider,
    val derivationPath: String? = null,
    val isDefault: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val metadata: WalletMetadata? = null
) {
    /**
     * Get shortened address for display
     */
    fun shortAddress(prefixLength: Int = 6, suffixLength: Int = 4): String {
        return if (address.length > prefixLength + suffixLength + 3) {
            "${address.take(prefixLength)}...${address.takeLast(suffixLength)}"
        } else {
            address
        }
    }

    /**
     * Check if wallet is internal (managed by app)
     */
    val isInternal: Boolean
        get() = walletType == WalletType.INTERNAL

    /**
     * Check if wallet is external (e.g., WalletConnect)
     */
    val isExternal: Boolean
        get() = walletType == WalletType.EXTERNAL
}

/**
 * Wallet type
 */
@Serializable
enum class WalletType {
    INTERNAL,   // Created/imported within the app
    EXTERNAL    // Connected via WalletConnect, etc.
}

/**
 * Wallet provider
 */
@Serializable
enum class WalletProvider {
    BUILTIN,        // App's built-in wallet
    WALLET_CONNECT, // WalletConnect
    METAMASK,       // MetaMask (via WalletConnect)
    TRUST_WALLET,   // Trust Wallet
    COINBASE,       // Coinbase Wallet
    LEDGER,         // Ledger hardware wallet
    OTHER
}

/**
 * Wallet metadata
 */
@Serializable
data class WalletMetadata(
    val iconUrl: String? = null,
    val accountIndex: Int = 0,
    val addressIndex: Int = 0,
    val isHardwareWallet: Boolean = false,
    val lastSyncedAt: Long? = null,
    val tags: List<String> = emptyList()
)

/**
 * Wallet balance
 */
@Serializable
data class WalletBalance(
    val walletId: String,
    val chain: SupportedChain,
    val nativeBalance: String,          // Raw balance in wei/smallest unit
    val nativeBalanceFormatted: String, // Formatted balance (e.g., "1.5 ETH")
    val usdValue: Double? = null,
    val tokens: List<TokenBalance> = emptyList(),
    val updatedAt: Long = System.currentTimeMillis()
)

/**
 * Token balance within a wallet
 */
@Serializable
data class TokenBalance(
    val token: Token,
    val balance: String,            // Raw balance
    val balanceFormatted: String,   // Formatted balance
    val usdValue: Double? = null
)

/**
 * Wallet with balance info
 */
data class WalletWithBalance(
    val wallet: Wallet,
    val balance: WalletBalance?
)

/**
 * Wallet creation options
 */
@Serializable
data class CreateWalletOptions(
    val name: String,
    val chain: SupportedChain = SupportedChain.ETHEREUM,
    val mnemonicStrength: Int = 12, // 12 or 24 words
    val passphrase: String = "",
    val accountIndex: Int = 0,
    val setAsDefault: Boolean = false
)

/**
 * Wallet import options
 */
@Serializable
data class ImportWalletOptions(
    val name: String,
    val chain: SupportedChain = SupportedChain.ETHEREUM,
    val importType: ImportType,
    val value: String, // Mnemonic, private key, or keystore JSON
    val password: String? = null, // For keystore
    val passphrase: String = "", // BIP39 passphrase
    val derivationPath: String? = null,
    val setAsDefault: Boolean = false
)

/**
 * Import type
 */
@Serializable
enum class ImportType {
    MNEMONIC,
    PRIVATE_KEY,
    KEYSTORE
}
