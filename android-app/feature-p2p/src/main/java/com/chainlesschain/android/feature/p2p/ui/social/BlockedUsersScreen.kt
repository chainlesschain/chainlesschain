package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.social.BlockedUserEntity
import com.chainlesschain.android.core.ui.components.EmptyState
import com.chainlesschain.android.core.ui.components.LoadingState
import com.chainlesschain.android.core.ui.image.Avatar
import com.chainlesschain.android.core.ui.image.AvatarSize
import com.chainlesschain.android.feature.p2p.viewmodel.social.FriendViewModel
import java.text.SimpleDateFormat
import java.util.*

/**
 * 屏蔽用户列表页面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BlockedUsersScreen(
    onNavigateBack: () -> Unit,
    viewModel: FriendViewModel = hiltViewModel()
) {
    var blockedUsers by remember { mutableStateOf<List<BlockedUserEntity>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    val snackbarHostState = remember { SnackbarHostState() }

    // Blocked user list loading requires ViewModel integration with FriendRepository.getBlockedUsers()
    LaunchedEffect(Unit) {
        isLoading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("屏蔽用户") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        when {
            isLoading -> {
                LoadingState(modifier = Modifier.padding(paddingValues))
            }
            blockedUsers.isEmpty() -> {
                EmptyState(
                    title = "没有屏蔽任何用户",
                    icon = Icons.Default.Block,
                    modifier = Modifier.padding(paddingValues)
                )
            }
            else -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(
                        items = blockedUsers,
                        key = { it.id }
                    ) { blockedUser ->
                        BlockedUserCard(
                            blockedUser = blockedUser,
                            onUnblock = {
                                viewModel.unblockFriend(blockedUser.blockedDid)
                                blockedUsers = blockedUsers - blockedUser
                            }
                        )
                    }
                }
            }
        }
    }
}

/**
 * 屏蔽用户卡片
 */
@Composable
private fun BlockedUserCard(
    blockedUser: BlockedUserEntity,
    onUnblock: () -> Unit,
    modifier: Modifier = Modifier
) {
    ElevatedCard(
        modifier = modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                // 头像
                Avatar(
                    avatarUrl = null,
                    name = "用户 ${blockedUser.blockedDid.take(8)}",
                    size = AvatarSize.MEDIUM
                )

                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = "用户 ${blockedUser.blockedDid.take(8)}",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = "DID: ${blockedUser.blockedDid.take(16)}...",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "屏蔽于 ${formatDate(blockedUser.createdAt)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    blockedUser.reason?.let { reason ->
                        Text(
                            text = "原因: $reason",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }

            // 解除屏蔽按钮
            OutlinedButton(onClick = onUnblock) {
                Text("解除屏蔽")
            }
        }
    }
}

/**
 * 格式化日期
 */
private fun formatDate(timestamp: Long): String {
    val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    return sdf.format(Date(timestamp))
}
