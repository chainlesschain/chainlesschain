package com.chainlesschain.android.feature.blockchain.data.manager

import com.chainlesschain.android.core.blockchain.crypto.HDWalletDerivation
import com.chainlesschain.android.core.blockchain.crypto.KeystoreManager
import com.chainlesschain.android.core.blockchain.crypto.MnemonicStrength
import com.chainlesschain.android.core.blockchain.crypto.WalletCoreAdapter
import com.chainlesschain.android.core.blockchain.model.NetworkConfig
import com.chainlesschain.android.core.blockchain.model.SupportedChain
import com.chainlesschain.android.core.blockchain.rpc.BlockchainRPCClient
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.blockchain.data.repository.WalletRepository
import com.chainlesschain.android.feature.blockchain.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import java.math.BigDecimal
import java.math.BigInteger
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * HD Wallet management
 * Handles wallet creation, import, balance fetching, etc.
 */
@Singleton
class WalletManager @Inject constructor(
    private val walletCoreAdapter: WalletCoreAdapter,
    private val keystoreManager: KeystoreManager,
    private val rpcClient: BlockchainRPCClient,
    private val walletRepository: WalletRepository
) {
    private val _activeWallet = MutableStateFlow<Wallet?>(null)
    val activeWallet = _activeWallet.asStateFlow()

    private val _wallets = MutableStateFlow<List<Wallet>>(emptyList())
    val wallets = _wallets.asStateFlow()

    /**
     * Initialize manager - load wallets from database
     */
    suspend fun initialize() {
        walletRepository.getAllWallets().collect { walletList ->
            _wallets.value = walletList
            // Set active wallet if not set
            if (_activeWallet.value == null) {
                _activeWallet.value = walletList.find { it.isDefault }
                    ?: walletList.firstOrNull()
            }
        }
    }

    /**
     * Create new HD wallet
     */
    suspend fun createWallet(options: CreateWalletOptions): Result<Wallet> {
        Timber.d("Creating new wallet: ${options.name}")

        // Generate mnemonic
        val strength = when (options.mnemonicStrength) {
            24 -> MnemonicStrength.WORDS_24
            else -> MnemonicStrength.WORDS_12
        }

        val mnemonicResult = walletCoreAdapter.generateMnemonic(strength)
        if (mnemonicResult is Result.Error) {
            return Result.error(mnemonicResult.exception, "Failed to generate mnemonic")
        }

        val mnemonic = (mnemonicResult as Result.Success).data

        // Derive seed and private key
        val seedResult = walletCoreAdapter.mnemonicToSeed(mnemonic, options.passphrase)
        if (seedResult is Result.Error) {
            return Result.error(seedResult.exception, "Failed to derive seed")
        }

        val seed = (seedResult as Result.Success).data
        val derivationPath = HDWalletDerivation.DerivationPath.forChain(options.chain)

        val privateKeyResult = walletCoreAdapter.derivePrivateKey(
            seed = seed,
            chain = options.chain,
            accountIndex = options.accountIndex
        )
        if (privateKeyResult is Result.Error) {
            return Result.error(privateKeyResult.exception, "Failed to derive private key")
        }

        val privateKey = (privateKeyResult as Result.Success).data

        // Derive address
        val addressResult = walletCoreAdapter.privateKeyToAddress(privateKey, options.chain)
        if (addressResult is Result.Error) {
            return Result.error(addressResult.exception, "Failed to derive address")
        }

        val address = (addressResult as Result.Success).data

        // Create wallet object
        val walletId = UUID.randomUUID().toString()
        val wallet = Wallet(
            id = walletId,
            name = options.name,
            address = address,
            chain = options.chain,
            walletType = WalletType.INTERNAL,
            provider = WalletProvider.BUILTIN,
            derivationPath = derivationPath.toString(),
            isDefault = options.setAsDefault || _wallets.value.isEmpty(),
            metadata = WalletMetadata(
                accountIndex = options.accountIndex,
                addressIndex = 0
            )
        )

        // Store private key securely
        keystoreManager.storePrivateKey(walletId, privateKey)
        keystoreManager.storeMnemonic(walletId, mnemonic)

        // Save to database
        val saveResult = walletRepository.saveWallet(wallet)
        if (saveResult is Result.Error) {
            // Clean up on failure
            keystoreManager.deletePrivateKey(walletId)
            keystoreManager.deleteMnemonic(walletId)
            return Result.error(saveResult.exception, "Failed to save wallet")
        }

        // Update active wallet if needed
        if (wallet.isDefault) {
            _activeWallet.value = wallet
        }

        Timber.d("Wallet created: ${wallet.shortAddress()}")
        return Result.success(wallet)
    }

    /**
     * Import wallet from mnemonic/private key
     */
    suspend fun importWallet(options: ImportWalletOptions): Result<Wallet> {
        Timber.d("Importing wallet: ${options.name}")

        val (privateKey, address) = when (options.importType) {
            ImportType.MNEMONIC -> {
                // Validate mnemonic
                if (!walletCoreAdapter.validateMnemonic(options.value)) {
                    return Result.error(
                        IllegalArgumentException("Invalid mnemonic"),
                        "Invalid mnemonic phrase"
                    )
                }

                // Derive from mnemonic
                val seedResult = walletCoreAdapter.mnemonicToSeed(options.value, options.passphrase)
                if (seedResult is Result.Error) {
                    return Result.error(seedResult.exception, "Failed to derive seed")
                }

                val seed = (seedResult as Result.Success).data
                val pkResult = walletCoreAdapter.derivePrivateKey(seed, options.chain)
                if (pkResult is Result.Error) {
                    return Result.error(pkResult.exception, "Failed to derive private key")
                }

                val pk = (pkResult as Result.Success).data
                val addrResult = walletCoreAdapter.privateKeyToAddress(pk, options.chain)
                if (addrResult is Result.Error) {
                    return Result.error(addrResult.exception, "Failed to derive address")
                }

                pk to (addrResult as Result.Success).data
            }

            ImportType.PRIVATE_KEY -> {
                // Parse private key
                val pkBytes = try {
                    options.value.removePrefix("0x")
                        .chunked(2)
                        .map { it.toInt(16).toByte() }
                        .toByteArray()
                } catch (e: Exception) {
                    return Result.error(e, "Invalid private key format")
                }

                if (pkBytes.size != 32) {
                    return Result.error(
                        IllegalArgumentException("Invalid private key length"),
                        "Private key must be 32 bytes"
                    )
                }

                val addrResult = walletCoreAdapter.privateKeyToAddress(pkBytes, options.chain)
                if (addrResult is Result.Error) {
                    return Result.error(addrResult.exception, "Failed to derive address")
                }

                pkBytes to (addrResult as Result.Success).data
            }

            ImportType.KEYSTORE -> {
                // TODO: Implement keystore decryption
                return Result.error(
                    UnsupportedOperationException("Keystore import not implemented"),
                    "Keystore import coming soon"
                )
            }
        }

        // Check if wallet already exists
        val existingWallet = _wallets.value.find {
            it.address.equals(address, ignoreCase = true) && it.chain == options.chain
        }
        if (existingWallet != null) {
            return Result.error(
                IllegalStateException("Wallet already exists"),
                "This wallet is already imported"
            )
        }

        // Create wallet object
        val walletId = UUID.randomUUID().toString()
        val wallet = Wallet(
            id = walletId,
            name = options.name,
            address = address,
            chain = options.chain,
            walletType = WalletType.INTERNAL,
            provider = WalletProvider.BUILTIN,
            derivationPath = options.derivationPath,
            isDefault = options.setAsDefault || _wallets.value.isEmpty()
        )

        // Store private key
        keystoreManager.storePrivateKey(walletId, privateKey)
        if (options.importType == ImportType.MNEMONIC) {
            keystoreManager.storeMnemonic(walletId, options.value)
        }

        // Save to database
        val saveResult = walletRepository.saveWallet(wallet)
        if (saveResult is Result.Error) {
            keystoreManager.deletePrivateKey(walletId)
            return Result.error(saveResult.exception, "Failed to save wallet")
        }

        if (wallet.isDefault) {
            _activeWallet.value = wallet
        }

        Timber.d("Wallet imported: ${wallet.shortAddress()}")
        return Result.success(wallet)
    }

    /**
     * Get wallet balance
     */
    suspend fun getBalance(wallet: Wallet): Result<WalletBalance> {
        val config = NetworkConfig.default(wallet.chain)

        val balanceResult = rpcClient.getBalance(config, wallet.address)
        if (balanceResult is Result.Error) {
            return Result.error(balanceResult.exception, "Failed to fetch balance")
        }

        val balanceWei = (balanceResult as Result.Success).data
        val balanceEth = formatBalance(balanceWei, wallet.chain.decimals)

        return Result.success(
            WalletBalance(
                walletId = wallet.id,
                chain = wallet.chain,
                nativeBalance = balanceWei.toString(),
                nativeBalanceFormatted = "$balanceEth ${wallet.chain.symbol}"
            )
        )
    }

    /**
     * Get all wallet balances
     */
    suspend fun getAllBalances(): Map<String, WalletBalance> {
        val balances = mutableMapOf<String, WalletBalance>()

        for (wallet in _wallets.value) {
            val result = getBalance(wallet)
            if (result is Result.Success) {
                balances[wallet.id] = result.data
            }
        }

        return balances
    }

    /**
     * Set active wallet
     */
    suspend fun setActiveWallet(walletId: String): Result<Unit> {
        val wallet = _wallets.value.find { it.id == walletId }
            ?: return Result.error(
                IllegalArgumentException("Wallet not found"),
                "Wallet not found"
            )

        _activeWallet.value = wallet

        // Update default status in database
        _wallets.value.forEach { w ->
            if (w.isDefault && w.id != walletId) {
                walletRepository.saveWallet(w.copy(isDefault = false))
            }
        }
        walletRepository.saveWallet(wallet.copy(isDefault = true))

        return Result.success(Unit)
    }

    /**
     * Delete wallet
     */
    suspend fun deleteWallet(walletId: String): Result<Unit> {
        val wallet = _wallets.value.find { it.id == walletId }
            ?: return Result.error(
                IllegalArgumentException("Wallet not found"),
                "Wallet not found"
            )

        // Delete from secure storage
        keystoreManager.deletePrivateKey(walletId)
        keystoreManager.deleteMnemonic(walletId)

        // Delete from database
        val result = walletRepository.deleteWallet(walletId)

        // Update active wallet if needed
        if (_activeWallet.value?.id == walletId) {
            _activeWallet.value = _wallets.value.filter { it.id != walletId }.firstOrNull()
        }

        return result
    }

    /**
     * Export mnemonic (requires authentication)
     */
    suspend fun exportMnemonic(walletId: String): Result<String> {
        return keystoreManager.retrieveMnemonic(walletId)
    }

    /**
     * Export private key (requires authentication)
     */
    suspend fun exportPrivateKey(walletId: String): Result<String> {
        val result = keystoreManager.retrievePrivateKey(walletId)
        if (result is Result.Error) {
            return Result.error(result.exception, result.message)
        }

        val privateKey = (result as Result.Success).data
        val hexKey = "0x" + privateKey.joinToString("") { "%02x".format(it) }

        // Clear from memory
        privateKey.fill(0)

        return Result.success(hexKey)
    }

    /**
     * Rename wallet
     */
    suspend fun renameWallet(walletId: String, newName: String): Result<Unit> {
        val wallet = _wallets.value.find { it.id == walletId }
            ?: return Result.error(
                IllegalArgumentException("Wallet not found"),
                "Wallet not found"
            )

        return walletRepository.saveWallet(wallet.copy(name = newName, updatedAt = System.currentTimeMillis()))
    }

    /**
     * Get wallets for specific chain
     */
    fun getWalletsForChain(chain: SupportedChain): Flow<List<Wallet>> {
        return walletRepository.getWalletsByChain(chain)
    }

    // ==================== Private Helpers ====================

    private fun formatBalance(weiBalance: BigInteger, decimals: Int): String {
        val divisor = BigDecimal.TEN.pow(decimals)
        val balance = BigDecimal(weiBalance).divide(divisor, decimals, java.math.RoundingMode.HALF_UP)
        return balance.stripTrailingZeros().toPlainString()
    }
}
