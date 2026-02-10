package com.chainlesschain.android.feature.blockchain.presentation.wallet

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chainlesschain.android.feature.blockchain.domain.model.Wallet
import com.chainlesschain.android.feature.blockchain.domain.model.WalletBalance
import kotlinx.coroutines.flow.collectLatest

/**
 * Wallet list screen
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletListScreen(
    onNavigateToCreate: () -> Unit,
    onNavigateToImport: () -> Unit,
    onNavigateToDetail: (String) -> Unit,
    viewModel: WalletViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val clipboardManager = LocalClipboardManager.current
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is WalletEvent.NavigateToCreate -> onNavigateToCreate()
                is WalletEvent.NavigateToImport -> onNavigateToImport()
                is WalletEvent.NavigateToDetail -> onNavigateToDetail(event.walletId)
                is WalletEvent.AddressCopied -> {
                    clipboardManager.setText(AnnotatedString(event.address))
                    snackbarHostState.showSnackbar("Address copied")
                }
                is WalletEvent.ShowMessage -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is WalletEvent.ShowError -> {
                    snackbarHostState.showSnackbar(event.error)
                }
                else -> {}
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Wallets") },
                actions = {
                    IconButton(onClick = { viewModel.refreshAllBalances() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                }
            )
        },
        floatingActionButton = {
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                SmallFloatingActionButton(
                    onClick = { viewModel.showImportWallet() }
                ) {
                    Icon(Icons.Default.Download, contentDescription = "Import")
                }
                FloatingActionButton(
                    onClick = { viewModel.showCreateWallet() }
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Create")
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        if (uiState.isLoading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else if (!uiState.hasWallets) {
            EmptyWalletState(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                onCreateClick = { viewModel.showCreateWallet() },
                onImportClick = { viewModel.showImportWallet() }
            )
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(
                    items = uiState.filteredWallets,
                    key = { it.id }
                ) { wallet ->
                    WalletCard(
                        wallet = wallet,
                        balance = uiState.getBalance(wallet.id),
                        isActive = wallet.id == uiState.activeWallet?.id,
                        isRefreshing = uiState.isRefreshingBalance,
                        onClick = { viewModel.showWalletDetail(wallet) },
                        onCopyAddress = { viewModel.copyAddress(wallet.address) },
                        onSelect = { viewModel.selectWallet(wallet.id) }
                    )
                }
            }
        }
    }
}

@Composable
private fun WalletCard(
    wallet: Wallet,
    balance: WalletBalance?,
    isActive: Boolean,
    isRefreshing: Boolean,
    onClick: () -> Unit,
    onCopyAddress: () -> Unit,
    onSelect: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (isActive) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surface
            }
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = wallet.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = wallet.shortAddress(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    IconButton(onClick = onCopyAddress) {
                        Icon(
                            Icons.Default.ContentCopy,
                            contentDescription = "Copy address",
                            modifier = Modifier.size(20.dp)
                        )
                    }
                    if (!isActive) {
                        IconButton(onClick = onSelect) {
                            Icon(
                                Icons.Default.CheckCircle,
                                contentDescription = "Set as active",
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                AssistChip(
                    onClick = {},
                    label = { Text(wallet.chain.name) },
                    leadingIcon = {
                        Text(
                            text = wallet.chain.symbol,
                            style = MaterialTheme.typography.labelSmall
                        )
                    }
                )

                if (isRefreshing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp
                    )
                } else {
                    Text(
                        text = balance?.nativeBalanceFormatted ?: "--",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            if (isActive) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Active",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

@Composable
private fun EmptyWalletState(
    modifier: Modifier = Modifier,
    onCreateClick: () -> Unit,
    onImportClick: () -> Unit
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.AccountBalanceWallet,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.6f)
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "No Wallets Yet",
            style = MaterialTheme.typography.headlineSmall
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "Create a new wallet or import an existing one",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(24.dp))

        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            OutlinedButton(onClick = onImportClick) {
                Icon(
                    Icons.Default.Download,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("Import")
            }

            Button(onClick = onCreateClick) {
                Icon(
                    Icons.Default.Add,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("Create")
            }
        }
    }
}
