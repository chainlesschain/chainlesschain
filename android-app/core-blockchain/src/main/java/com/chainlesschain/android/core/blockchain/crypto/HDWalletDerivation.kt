package com.chainlesschain.android.core.blockchain.crypto

import com.chainlesschain.android.core.blockchain.model.SupportedChain
import kotlinx.serialization.Serializable

/**
 * BIP44 HD Wallet derivation path utilities
 */
object HDWalletDerivation {

    /**
     * BIP44 derivation path structure
     * m / purpose' / coin_type' / account' / change / address_index
     */
    @Serializable
    data class DerivationPath(
        val purpose: Int = 44,
        val coinType: Int,
        val account: Int = 0,
        val change: Int = 0, // 0 = external, 1 = internal (change addresses)
        val addressIndex: Int = 0
    ) {
        /**
         * Get full path string
         */
        override fun toString(): String {
            return "m/$purpose'/$coinType'/$account'/$change/$addressIndex"
        }

        /**
         * Get account path (without change and address_index)
         */
        fun accountPath(): String {
            return "m/$purpose'/$coinType'/$account'"
        }

        /**
         * Get next address in sequence
         */
        fun nextAddress(): DerivationPath {
            return copy(addressIndex = addressIndex + 1)
        }

        /**
         * Get next account
         */
        fun nextAccount(): DerivationPath {
            return copy(account = account + 1, addressIndex = 0)
        }

        companion object {
            /**
             * Parse path string
             */
            fun parse(path: String): DerivationPath {
                val parts = path.removePrefix("m/").split("/")
                require(parts.size >= 3) { "Invalid derivation path" }

                return DerivationPath(
                    purpose = parts[0].removeSuffix("'").toInt(),
                    coinType = parts[1].removeSuffix("'").toInt(),
                    account = parts[2].removeSuffix("'").toInt(),
                    change = parts.getOrNull(3)?.toInt() ?: 0,
                    addressIndex = parts.getOrNull(4)?.toInt() ?: 0
                )
            }

            /**
             * Create default path for chain
             */
            fun forChain(chain: SupportedChain): DerivationPath {
                return DerivationPath(
                    coinType = getCoinType(chain)
                )
            }
        }
    }

    /**
     * Get BIP44 coin type for chain
     * https://github.com/satoshilabs/slips/blob/master/slip-0044.md
     */
    fun getCoinType(chain: SupportedChain): Int {
        return when (chain) {
            // Ethereum and EVM chains typically use 60
            SupportedChain.ETHEREUM -> 60
            SupportedChain.GOERLI -> 60
            SupportedChain.SEPOLIA -> 60
            SupportedChain.BSC -> 60  // Uses ETH addresses
            SupportedChain.POLYGON -> 60
            SupportedChain.MUMBAI -> 60
            SupportedChain.AVALANCHE -> 60
            SupportedChain.ARBITRUM -> 60
            SupportedChain.OPTIMISM -> 60
            SupportedChain.FANTOM -> 60
            SupportedChain.CRONOS -> 60
            SupportedChain.BASE -> 60
            SupportedChain.ZKSYNC -> 60
            SupportedChain.LINEA -> 60
        }
    }

    /**
     * Derivation path presets
     */
    object Presets {
        // Standard BIP44 for Ethereum
        val ETHEREUM_DEFAULT = DerivationPath(coinType = 60)

        // Ledger Live uses m/44'/60'/account'/0/0
        val LEDGER_LIVE = DerivationPath(coinType = 60)

        // MEW/MyCrypto uses m/44'/60'/0'/0/address
        val MEW_DEFAULT = DerivationPath(coinType = 60)

        // Some wallets use m/44'/60'/0'/address (no change)
        val LEGACY = DerivationPath(coinType = 60, change = 0)
    }

    /**
     * Generate multiple addresses for an account
     */
    fun generateAddressPaths(
        chain: SupportedChain,
        account: Int = 0,
        startIndex: Int = 0,
        count: Int = 10
    ): List<DerivationPath> {
        val coinType = getCoinType(chain)
        return (startIndex until startIndex + count).map { index ->
            DerivationPath(
                coinType = coinType,
                account = account,
                addressIndex = index
            )
        }
    }

    /**
     * Check if path is valid
     */
    fun isValidPath(path: String): Boolean {
        return try {
            DerivationPath.parse(path)
            true
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Get common derivation paths for wallets
     */
    fun commonPaths(chain: SupportedChain): List<DerivationPath> {
        val coinType = getCoinType(chain)
        return listOf(
            // Standard BIP44
            DerivationPath(coinType = coinType, account = 0, addressIndex = 0),
            DerivationPath(coinType = coinType, account = 0, addressIndex = 1),
            DerivationPath(coinType = coinType, account = 0, addressIndex = 2),
            // Second account
            DerivationPath(coinType = coinType, account = 1, addressIndex = 0),
            // Legacy paths
            DerivationPath(purpose = 44, coinType = coinType, account = 0, change = 0, addressIndex = 0),
        )
    }
}

/**
 * Extended key data
 */
@Serializable
data class ExtendedKey(
    val privateKey: String,  // Hex encoded
    val publicKey: String,   // Hex encoded
    val chainCode: String,   // Hex encoded
    val path: HDWalletDerivation.DerivationPath,
    val fingerprint: String? = null,
    val parentFingerprint: String? = null,
    val depth: Int = 0
) {
    /**
     * Check if this is a master key
     */
    val isMaster: Boolean
        get() = depth == 0 && parentFingerprint == null

    /**
     * Get xpub (serialized extended public key)
     */
    fun xpub(version: ByteArray = MAINNET_PUBLIC): String {
        // Serialize extended public key
        // Version (4) + Depth (1) + Parent Fingerprint (4) + Child Number (4) + Chain Code (32) + Key (33)
        return "" // Implementation needed
    }

    /**
     * Get xprv (serialized extended private key)
     */
    fun xprv(version: ByteArray = MAINNET_PRIVATE): String {
        // Serialize extended private key
        return "" // Implementation needed
    }

    companion object {
        // Version bytes for serialization
        val MAINNET_PUBLIC = byteArrayOf(0x04, 0x88.toByte(), 0xB2.toByte(), 0x1E)
        val MAINNET_PRIVATE = byteArrayOf(0x04, 0x88.toByte(), 0xAD.toByte(), 0xE4.toByte())
        val TESTNET_PUBLIC = byteArrayOf(0x04, 0x35.toByte(), 0x87.toByte(), 0xCF.toByte())
        val TESTNET_PRIVATE = byteArrayOf(0x04, 0x35.toByte(), 0x83.toByte(), 0x94.toByte())
    }
}

/**
 * Address info with derivation details
 */
@Serializable
data class DerivedAddress(
    val address: String,
    val path: HDWalletDerivation.DerivationPath,
    val publicKey: String,
    val chain: SupportedChain
) {
    /**
     * Get checksummed address (EIP-55)
     */
    fun checksumAddress(): String {
        // Implement EIP-55 checksum
        return address
    }
}
