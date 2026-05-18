package com.chainlesschain.android.remote.ui.security

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
import com.chainlesschain.android.remote.commands.ActiveUser
import com.chainlesschain.android.remote.commands.LoginRecord
import com.chainlesschain.android.remote.commands.FirewallProfile
import com.chainlesschain.android.remote.commands.AntivirusProduct
import com.chainlesschain.android.remote.commands.PendingUpdate
import com.chainlesschain.android.remote.p2p.ConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SecurityInfoScreen(
    viewModel: SecurityInfoViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val securitySummary by viewModel.securitySummary.collectAsState()
    val activeUsers by viewModel.activeUsers.collectAsState()
    val currentUser by viewModel.currentUser.collectAsState()
    val loginHistory by viewModel.loginHistory.collectAsState()
    val firewallProfiles by viewModel.firewallProfiles.collectAsState()
    val antivirusProducts by viewModel.antivirusProducts.collectAsState()
    val pendingUpdates by viewModel.pendingUpdates.collectAsState()

    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf(
        stringResource(R.string.rs_sec_tab_overview),
        stringResource(R.string.rs_sec_tab_users),
        stringResource(R.string.rs_sec_tab_protection),
        stringResource(R.string.rs_sec_tab_updates)
    )

    val isConnected = connectionState == ConnectionState.CONNECTED

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.rs_sec_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.common_refresh))
                    }
                    IconButton(
                        onClick = { viewModel.lockWorkstation() },
                        enabled = isConnected && !uiState.isExecuting
                    ) {
                        Icon(Icons.Default.Lock, contentDescription = stringResource(R.string.rs_sec_lock))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            TabRow(selectedTabIndex = selectedTab) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = {
                            selectedTab = index
                            when (index) {
                                1 -> viewModel.loadLoginHistory()
                                2 -> {
                                    viewModel.loadFirewallStatus()
                                    viewModel.loadAntivirusStatus()
                                    viewModel.loadEncryptionStatus()
                                }
                                3 -> viewModel.loadUpdates()
                            }
                        },
                        text = { Text(title) }
                    )
                }
            }

            // 错误提示
            uiState.error?.let { error ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(error, color = MaterialTheme.colorScheme.onErrorContainer)
                        IconButton(onClick = { viewModel.clearError() }) {
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.rs_sec_dismiss))
                        }
                    }
                }
            }

            // 最后操作
            uiState.lastAction?.let { action ->
                Text(
                    text = action,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }

            // 加载指示器
            if (uiState.isLoading || uiState.isExecuting) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            when (selectedTab) {
                0 -> OverviewTab(
                    securitySummary = securitySummary,
                    activeUsers = activeUsers,
                    currentUser = currentUser
                )
                1 -> UsersTab(
                    activeUsers = activeUsers,
                    currentUser = currentUser,
                    loginHistory = loginHistory
                )
                2 -> ProtectionTab(
                    uiState = uiState,
                    firewallProfiles = firewallProfiles,
                    antivirusProducts = antivirusProducts
                )
                3 -> UpdatesTab(
                    pendingCount = uiState.pendingUpdateCount,
                    updates = pendingUpdates
                )
            }
        }
    }
}

@Composable
private fun OverviewTab(
    securitySummary: com.chainlesschain.android.remote.commands.SecuritySummary?,
    activeUsers: List<ActiveUser>,
    currentUser: String?
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 安全状态卡片
        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                ) {
                    Text(
                        text = stringResource(R.string.rs_sec_overview),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(12.dp))

                    securitySummary?.let { summary ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceEvenly
                        ) {
                            SecurityStatusItem(
                                icon = Icons.Default.Security,
                                label = stringResource(R.string.rs_sec_firewall),
                                enabled = summary.firewallEnabled
                            )
                            SecurityStatusItem(
                                icon = Icons.Default.HealthAndSafety,
                                label = stringResource(R.string.rs_sec_antivirus),
                                enabled = summary.antivirusInstalled
                            )
                            SecurityStatusItem(
                                icon = Icons.Default.Lock,
                                label = stringResource(R.string.rs_sec_encryption),
                                enabled = summary.encryptionEnabled
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        summary.pendingUpdates?.let { count ->
                            if (count > 0) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        Icons.Default.Warning,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.error
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(stringResource(R.string.rs_sec_pending_updates_fmt, count))
                                }
                            }
                        }
                        Text(
                            stringResource(R.string.rs_sec_platform_fmt, summary.platform),
                            style = MaterialTheme.typography.bodySmall
                        )
                    } ?: Text(stringResource(R.string.rs_sec_loading))
                }
            }
        }

        // 当前用户
        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Person, contentDescription = null)
                    Spacer(modifier = Modifier.width(12.dp))
                    Column {
                        Text(stringResource(R.string.rs_sec_current_user), fontWeight = FontWeight.Bold)
                        Text(currentUser ?: stringResource(R.string.rs_sec_unknown))
                    }
                }
            }
        }

        // 活动用户
        item {
            Text(
                stringResource(R.string.rs_sec_active_users_fmt, activeUsers.size),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold
            )
        }

        if (activeUsers.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.rs_sec_no_active_users),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            items(activeUsers, key = { it.username }) { user ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            if (user.username == currentUser) Icons.Default.Person else Icons.Default.PersonOutline,
                            contentDescription = null,
                            tint = if (user.username == currentUser) MaterialTheme.colorScheme.primary
                                   else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(user.username, fontWeight = FontWeight.Medium)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                user.domain?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                user.terminal?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                user.logonType?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SecurityStatusItem(
    icon: ImageVector,
    label: String,
    enabled: Boolean?
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(
            icon,
            contentDescription = null,
            tint = when (enabled) {
                true -> MaterialTheme.colorScheme.primary
                false -> MaterialTheme.colorScheme.error
                null -> MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.size(32.dp)
        )
        Text(label, style = MaterialTheme.typography.bodySmall)
        Text(
            when (enabled) {
                true -> stringResource(R.string.rs_sec_status_on)
                false -> stringResource(R.string.rs_sec_status_off)
                null -> stringResource(R.string.rs_sec_status_na)
            },
            style = MaterialTheme.typography.labelSmall,
            color = when (enabled) {
                true -> MaterialTheme.colorScheme.primary
                false -> MaterialTheme.colorScheme.error
                null -> MaterialTheme.colorScheme.onSurfaceVariant
            }
        )
    }
}

@Composable
private fun UsersTab(
    activeUsers: List<ActiveUser>,
    currentUser: String?,
    loginHistory: List<LoginRecord>
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Text(
                stringResource(R.string.rs_sec_login_history),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold
            )
        }

        if (loginHistory.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.rs_sec_no_login_history),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            items(loginHistory, key = { "${it.username}_${it.time}" }) { record ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Login,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                record.username ?: stringResource(R.string.rs_sec_unknown),
                                fontWeight = FontWeight.Medium
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                record.time?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                record.type?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            }
                            record.terminal?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProtectionTab(
    uiState: SecurityInfoUiState,
    firewallProfiles: List<FirewallProfile>,
    antivirusProducts: List<AntivirusProduct>
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 防火墙
        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Security, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(stringResource(R.string.rs_sec_firewall), fontWeight = FontWeight.Bold)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        stringResource(
                            R.string.rs_sec_status_enabled_fmt,
                            if (uiState.firewallEnabled == true) stringResource(R.string.rs_sec_enabled) else stringResource(R.string.rs_sec_disabled)
                        ),
                        color = if (uiState.firewallEnabled == true) MaterialTheme.colorScheme.primary
                               else MaterialTheme.colorScheme.error
                    )
                    uiState.firewallType?.let { Text(stringResource(R.string.rs_sec_type_fmt, it)) }

                    if (firewallProfiles.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(stringResource(R.string.rs_sec_profiles), style = MaterialTheme.typography.labelMedium)
                        firewallProfiles.forEach { profile ->
                            Row {
                                Text(stringResource(R.string.rs_sec_profile_line_fmt, profile.name))
                                Text(
                                    if (profile.enabled) stringResource(R.string.rs_sec_status_on) else stringResource(R.string.rs_sec_status_off),
                                    color = if (profile.enabled) MaterialTheme.colorScheme.primary
                                           else MaterialTheme.colorScheme.error
                                )
                            }
                        }
                    }
                }
            }
        }

        // 杀毒软件
        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.HealthAndSafety, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(stringResource(R.string.rs_sec_antivirus), fontWeight = FontWeight.Bold)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        stringResource(
                            R.string.rs_sec_status_enabled_fmt,
                            if (uiState.antivirusInstalled == true) stringResource(R.string.rs_sec_installed) else stringResource(R.string.rs_sec_not_detected)
                        ),
                        color = if (uiState.antivirusInstalled == true) MaterialTheme.colorScheme.primary
                               else MaterialTheme.colorScheme.error
                    )

                    if (antivirusProducts.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(stringResource(R.string.rs_sec_products), style = MaterialTheme.typography.labelMedium)
                        antivirusProducts.forEach { product ->
                            Text(stringResource(R.string.rs_sec_product_line_fmt, product.name))
                        }
                    }
                }
            }
        }

        // 加密
        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Lock, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(stringResource(R.string.rs_sec_disk_encryption), fontWeight = FontWeight.Bold)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        stringResource(
                            R.string.rs_sec_status_enabled_fmt,
                            if (uiState.encryptionEnabled == true) stringResource(R.string.rs_sec_enabled) else stringResource(R.string.rs_sec_disabled)
                        ),
                        color = if (uiState.encryptionEnabled == true) MaterialTheme.colorScheme.primary
                               else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    uiState.encryptionType?.let { Text(stringResource(R.string.rs_sec_type_fmt, it)) }
                    uiState.encryptionPercentage?.let {
                        Text(stringResource(R.string.rs_sec_progress_fmt, it))
                        LinearProgressIndicator(
                            progress = { it / 100f },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun UpdatesTab(
    pendingCount: Int?,
    updates: List<PendingUpdate>
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = if ((pendingCount ?: 0) > 0)
                        MaterialTheme.colorScheme.errorContainer
                    else MaterialTheme.colorScheme.primaryContainer
                )
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        if ((pendingCount ?: 0) > 0) Icons.Default.Warning else Icons.Default.CheckCircle,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = when {
                            pendingCount == null -> stringResource(R.string.rs_sec_checking_updates)
                            pendingCount == 0 -> stringResource(R.string.rs_sec_up_to_date)
                            else -> stringResource(R.string.rs_sec_updates_available_fmt, pendingCount)
                        },
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        if (updates.isNotEmpty()) {
            item {
                Text(
                    stringResource(R.string.rs_sec_pending_updates_section),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )
            }

            items(updates, key = { it.kb ?: it.title }) { update ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.SystemUpdate,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(update.title, fontWeight = FontWeight.Medium)
                            update.kb?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}
