package com.chainlesschain.android.feature.blockchain.presentation.wallet

import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.blockchain.model.SupportedChain
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.common.viewmodel.BaseViewModel
import com.chainlesschain.android.core.common.viewmodel.UiEvent
import com.chainlesschain.android.core.common.viewmodel.UiState
import com.chainlesschain.android.feature.blockchain.data.manager.WalletManager
import com.chainlesschain.android.feature.blockchain.domain.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for wallet screens
 */
@HiltViewModel
class WalletViewModel @Inject constructor(
    private val walletManager: WalletManager
) : BaseViewModel<WalletUiState, WalletEvent>(WalletUiState()) {

    init {
        loadWallets()
        observeActiveWallet()
    }

    private fun loadWallets() {
        viewModelScope.launch {
            walletManager.wallets.collectLatest { wallets ->
                updateState { copy(wallets = wallets, isLoading = false) }
            }
        }
    }

    private fun observeActiveWallet() {
        viewModelScope.launch {
            walletManager.activeWallet.collectLatest { wallet ->
                updateState { copy(activeWallet = wallet) }
                wallet?.let { refreshBalance(it) }
            }
        }
    }

    fun createWallet(name: String, chain: SupportedChain = SupportedChain.ETHEREUM) {
        launchSafely {
            updateState { copy(isCreating = true) }

            val options = CreateWalletOptions(
                name = name,
                chain = chain,
                setAsDefault = currentState.wallets.isEmpty()
            )

            when (val result = walletManager.createWallet(options)) {
                is Result.Success -> {
                    sendEvent(WalletEvent.WalletCreated(result.data))
                    sendEvent(WalletEvent.ShowMessage("Wallet created successfully"))
                }
                is Result.Error -> {
                    sendEvent(WalletEvent.ShowError(result.message ?: "Failed to create wallet"))
                }
                else -> {}
            }

            updateState { copy(isCreating = false) }
        }
    }

    fun importWallet(
        name: String,
        importType: ImportType,
        value: String,
        chain: SupportedChain = SupportedChain.ETHEREUM
    ) {
        launchSafely {
            updateState { copy(isImporting = true) }

            val options = ImportWalletOptions(
                name = name,
                chain = chain,
                importType = importType,
                value = value,
                setAsDefault = currentState.wallets.isEmpty()
            )

            when (val result = walletManager.importWallet(options)) {
                is Result.Success -> {
                    sendEvent(WalletEvent.WalletImported(result.data))
                    sendEvent(WalletEvent.ShowMessage("Wallet imported successfully"))
                }
                is Result.Error -> {
                    sendEvent(WalletEvent.ShowError(result.message ?: "Failed to import wallet"))
                }
                else -> {}
            }

            updateState { copy(isImporting = false) }
        }
    }

    fun selectWallet(walletId: String) {
        launchSafely {
            walletManager.setActiveWallet(walletId)
        }
    }

    fun deleteWallet(walletId: String) {
        launchSafely {
            when (val result = walletManager.deleteWallet(walletId)) {
                is Result.Success -> {
                    sendEvent(WalletEvent.WalletDeleted(walletId))
                    sendEvent(WalletEvent.ShowMessage("Wallet deleted"))
                }
                is Result.Error -> {
                    sendEvent(WalletEvent.ShowError(result.message ?: "Failed to delete wallet"))
                }
                else -> {}
            }
        }
    }

    fun renameWallet(walletId: String, newName: String) {
        launchSafely {
            when (val result = walletManager.renameWallet(walletId, newName)) {
                is Result.Success -> {
                    sendEvent(WalletEvent.ShowMessage("Wallet renamed"))
                }
                is Result.Error -> {
                    sendEvent(WalletEvent.ShowError(result.message ?: "Failed to rename wallet"))
                }
                else -> {}
            }
        }
    }

    fun refreshBalance(wallet: Wallet? = currentState.activeWallet) {
        wallet ?: return

        launchSafely {
            updateState { copy(isRefreshingBalance = true) }

            when (val result = walletManager.getBalance(wallet)) {
                is Result.Success -> {
                    val balances = currentState.balances.toMutableMap()
                    balances[wallet.id] = result.data
                    updateState { copy(balances = balances) }
                }
                is Result.Error -> {
                    sendEvent(WalletEvent.ShowError("Failed to fetch balance"))
                }
                else -> {}
            }

            updateState { copy(isRefreshingBalance = false) }
        }
    }

    fun refreshAllBalances() {
        launchSafely {
            updateState { copy(isRefreshingBalance = true) }

            val balances = walletManager.getAllBalances()
            updateState { copy(balances = balances, isRefreshingBalance = false) }
        }
    }

    fun exportMnemonic(walletId: String) {
        launchSafely {
            when (val result = walletManager.exportMnemonic(walletId)) {
                is Result.Success -> {
                    sendEvent(WalletEvent.MnemonicExported(result.data))
                }
                is Result.Error -> {
                    sendEvent(WalletEvent.ShowError(result.message ?: "Failed to export mnemonic"))
                }
                else -> {}
            }
        }
    }

    fun exportPrivateKey(walletId: String) {
        launchSafely {
            when (val result = walletManager.exportPrivateKey(walletId)) {
                is Result.Success -> {
                    sendEvent(WalletEvent.PrivateKeyExported(result.data))
                }
                is Result.Error -> {
                    sendEvent(WalletEvent.ShowError(result.message ?: "Failed to export private key"))
                }
                else -> {}
            }
        }
    }

    fun copyAddress(address: String) {
        sendEvent(WalletEvent.AddressCopied(address))
    }

    fun showWalletDetail(wallet: Wallet) {
        sendEvent(WalletEvent.NavigateToDetail(wallet.id))
    }

    fun showCreateWallet() {
        sendEvent(WalletEvent.NavigateToCreate)
    }

    fun showImportWallet() {
        sendEvent(WalletEvent.NavigateToImport)
    }

    fun filterByChain(chain: SupportedChain?) {
        updateState { copy(selectedChain = chain) }
    }
}

/**
 * Wallet UI State
 */
data class WalletUiState(
    val wallets: List<Wallet> = emptyList(),
    val activeWallet: Wallet? = null,
    val balances: Map<String, WalletBalance> = emptyMap(),
    val selectedChain: SupportedChain? = null,
    val isLoading: Boolean = true,
    val isCreating: Boolean = false,
    val isImporting: Boolean = false,
    val isRefreshingBalance: Boolean = false
) : UiState {

    val filteredWallets: List<Wallet>
        get() = if (selectedChain != null) {
            wallets.filter { it.chain == selectedChain }
        } else {
            wallets
        }

    val hasWallets: Boolean
        get() = wallets.isNotEmpty()

    fun getBalance(walletId: String): WalletBalance? = balances[walletId]
}

/**
 * Wallet UI Events
 */
sealed class WalletEvent : UiEvent {
    data class WalletCreated(val wallet: Wallet) : WalletEvent()
    data class WalletImported(val wallet: Wallet) : WalletEvent()
    data class WalletDeleted(val walletId: String) : WalletEvent()
    data class MnemonicExported(val mnemonic: String) : WalletEvent()
    data class PrivateKeyExported(val privateKey: String) : WalletEvent()
    data class AddressCopied(val address: String) : WalletEvent()
    data class NavigateToDetail(val walletId: String) : WalletEvent()
    data object NavigateToCreate : WalletEvent()
    data object NavigateToImport : WalletEvent()
    data class ShowMessage(val message: String) : WalletEvent()
    data class ShowError(val error: String) : WalletEvent()
}
