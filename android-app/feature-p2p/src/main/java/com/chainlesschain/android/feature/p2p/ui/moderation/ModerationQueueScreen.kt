package com.chainlesschain.android.feature.p2p.ui.moderation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.ContentType
import com.chainlesschain.android.core.database.entity.ModerationStatus
import com.chainlesschain.android.feature.p2p.R
import com.chainlesschain.android.feature.p2p.repository.moderation.ModerationSeverity
import com.chainlesschain.android.feature.p2p.moderation.ViolationCategory
import com.chainlesschain.android.feature.p2p.repository.moderation.ModerationQueueItem
import java.text.SimpleDateFormat
import java.util.*

/**
 * 审核队列Screen
 *
 * 用于管理员/审核员查看和处理待审核内容
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModerationQueueScreen(
    onNavigateBack: () -> Unit,
    viewModel: ModerationQueueViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // 显示Snackbar消息
    LaunchedEffect(uiState.message) {
        uiState.message?.let { message ->
            snackbarHostState.showSnackbar(message)
            viewModel.clearMessage()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.content_moderation)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = {
                    // 统计Badge
                    uiState.statistics?.let { stats ->
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.padding(horizontal = 8.dp)
                        ) {
                            StatisticsBadge(
                                label = stringResource(R.string.stat_pending),
                                count = stats.pendingCount,
                                color = MaterialTheme.colorScheme.primary
                            )
                            if (stats.appealingCount > 0) {
                                StatisticsBadge(
                                    label = stringResource(R.string.stat_appeal),
                                    count = stats.appealingCount,
                                    color = MaterialTheme.colorScheme.tertiary
                                )
                            }
                        }
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 筛选标签
            FilterTabs(
                selectedTab = uiState.currentTab,
                onTabSelected = { viewModel.selectTab(it) },
                pendingCount = uiState.statistics?.pendingCount ?: 0,
                appealingCount = uiState.statistics?.appealingCount ?: 0
            )

            Divider()

            // 内容列表
            when {
                uiState.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                uiState.items.isEmpty() -> {
                    EmptyQueueView(currentTab = uiState.currentTab)
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(
                            items = uiState.items,
                            key = { it.id }
                        ) { item ->
                            ModerationQueueItemCard(
                                item = item,
                                onApprove = { viewModel.approveContent(item.id) },
                                onReject = { viewModel.rejectContent(item.id) },
                                onDelete = { viewModel.deleteContent(item.id) },
                                onApproveAppeal = { viewModel.approveAppeal(item.id) },
                                onRejectAppeal = { viewModel.rejectAppeal(item.id) }
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * 筛选标签
 */
@Composable
private fun FilterTabs(
    selectedTab: ModerationTab,
    onTabSelected: (ModerationTab) -> Unit,
    pendingCount: Int,
    appealingCount: Int
) {
    TabRow(selectedTabIndex = selectedTab.ordinal) {
        ModerationTab.values().forEach { tab ->
            Tab(
                selected = selectedTab == tab,
                onClick = { onTabSelected(tab) },
                text = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            when (tab) {
                                ModerationTab.PENDING -> stringResource(R.string.tab_pending)
                                ModerationTab.APPEALING -> stringResource(R.string.tab_appealing)
                                ModerationTab.ALL -> stringResource(R.string.tab_all)
                            }
                        )
                        when (tab) {
                            ModerationTab.PENDING -> {
                                if (pendingCount > 0) {
                                    Badge { Text(pendingCount.toString()) }
                                }
                            }
                            ModerationTab.APPEALING -> {
                                if (appealingCount > 0) {
                                    Badge { Text(appealingCount.toString()) }
                                }
                            }
                            else -> {}
                        }
                    }
                }
            )
        }
    }
}

/**
 * 统计徽章
 */
@Composable
private fun StatisticsBadge(
    label: String,
    count: Int,
    color: Color
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = color.copy(alpha = 0.1f)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = color
            )
            Text(
                text = count.toString(),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = color
            )
        }
    }
}

/**
 * 审核项目卡片
 */
@Composable
private fun ModerationQueueItemCard(
    item: ModerationQueueItem,
    onApprove: () -> Unit,
    onReject: () -> Unit,
    onDelete: () -> Unit,
    onApproveAppeal: () -> Unit,
    onRejectAppeal: () -> Unit
) {
    var showFullContent by remember { mutableStateOf(false) }
    var showAppealDialog by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 头部：作者信息
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = item.authorName ?: stringResource(R.string.unknown_user),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = item.authorDid.take(16) + "...",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                // 内容类型标签
                ContentTypeBadge(item.contentType)
            }

            // 内容文本
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        MaterialTheme.colorScheme.surfaceVariant,
                        RoundedCornerShape(8.dp)
                    )
                    .padding(12.dp)
            ) {
                Text(
                    text = item.content,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = if (showFullContent) Int.MAX_VALUE else 3,
                    overflow = TextOverflow.Ellipsis
                )
                if (item.content.length > 100) {
                    TextButton(
                        onClick = { showFullContent = !showFullContent },
                        modifier = Modifier.align(Alignment.End)
                    ) {
                        Text(if (showFullContent) stringResource(R.string.show_less) else stringResource(R.string.show_more))
                    }
                }
            }

            // AI审核结果
            AIResultSection(item = item)

            // 等待时长提示
            if (item.isHighPriority()) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error
                        )
                        Text(
                            text = stringResource(R.string.waiting_hours_high_priority, item.getWaitingHours()),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            } else {
                Text(
                    text = stringResource(R.string.waiting_hours, item.getWaitingHours()),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 申诉信息
            if (item.appealText != null && item.appealAt != null) {
                AppealSection(
                    appealText = item.appealText,
                    appealAt = item.appealAt
                )
            }

            Divider()

            // 操作按钮
            if (item.status == ModerationStatus.PENDING) {
                PendingActions(
                    onApprove = onApprove,
                    onReject = onReject,
                    onDelete = onDelete
                )
            } else if (item.status == ModerationStatus.APPEALING) {
                AppealingActions(
                    onApprove = onApproveAppeal,
                    onReject = onRejectAppeal
                )
            }
        }
    }
}

/**
 * 内容类型徽章
 */
@Composable
private fun ContentTypeBadge(contentType: ContentType) {
    val (icon, label) = when (contentType) {
        ContentType.POST -> Icons.Default.Article to stringResource(R.string.content_type_post)
        ContentType.COMMENT -> Icons.Default.Comment to stringResource(R.string.content_type_comment)
        ContentType.MESSAGE -> Icons.Default.Message to stringResource(R.string.content_type_message)
    }

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.secondaryContainer
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                icon,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSecondaryContainer
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer
            )
        }
    }
}

/**
 * AI审核结果区域
 */
@Composable
private fun AIResultSection(item: ModerationQueueItem) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = stringResource(R.string.moderation_info),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold
        )

        // 违规类型
        item.violationType?.let { vType ->
            Text(
                text = stringResource(R.string.violation_type_label, vType.name),
                style = MaterialTheme.typography.bodySmall
            )
        }

        // 严重程度
        item.severity?.let { severity ->
            SeverityIndicator(severity)
        }

        // 原因和建议
        item.reason?.let { reason ->
            Text(
                text = stringResource(R.string.reason_label, reason),
                style = MaterialTheme.typography.bodySmall
            )
        }
        item.suggestion?.let { suggestion ->
            Text(
                text = stringResource(R.string.suggestion_label, suggestion),
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

/**
 * 违规类型芯片
 */
@Composable
private fun ViolationCategoryChip(category: ViolationCategory) {
    AssistChip(
        onClick = { },
        label = { Text(category.displayName) },
        leadingIcon = {
            Icon(
                Icons.Default.Warning,
                contentDescription = null,
                modifier = Modifier.size(16.dp)
            )
        }
    )
}

/**
 * 严重程度指示器
 */
@Composable
private fun SeverityIndicator(severity: ModerationSeverity) {
    val (color, label) = when (severity) {
        ModerationSeverity.LOW -> Color(0xFF4CAF50) to severity.displayName
        ModerationSeverity.MEDIUM -> Color(0xFFFFA726) to severity.displayName
        ModerationSeverity.HIGH -> Color(0xFFFF7043) to severity.displayName
        ModerationSeverity.CRITICAL -> MaterialTheme.colorScheme.error to severity.displayName
    }

    Surface(
        shape = RoundedCornerShape(8.dp),
        color = color.copy(alpha = 0.1f)
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            style = MaterialTheme.typography.labelMedium,
            color = color,
            fontWeight = FontWeight.Bold
        )
    }
}

/**
 * 申诉信息区域
 */
@Composable
private fun AppealSection(appealText: String, appealAt: Long) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                MaterialTheme.colorScheme.tertiaryContainer,
                RoundedCornerShape(8.dp)
            )
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Gavel,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onTertiaryContainer
            )
            Text(
                text = stringResource(R.string.user_appeal),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onTertiaryContainer
            )
        }
        Text(
            text = appealText,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onTertiaryContainer
        )
        Text(
            text = formatTimestamp(appealAt),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.7f)
        )
    }
}

/**
 * 待审核操作按钮
 */
@Composable
private fun PendingActions(
    onApprove: () -> Unit,
    onReject: () -> Unit,
    onDelete: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // 批准
        FilledTonalButton(
            onClick = onApprove,
            modifier = Modifier.weight(1f),
            colors = ButtonDefaults.filledTonalButtonColors(
                containerColor = Color(0xFF4CAF50).copy(alpha = 0.1f),
                contentColor = Color(0xFF4CAF50)
            )
        ) {
            Icon(Icons.Default.Check, contentDescription = null)
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.approve))
        }

        // 拒绝
        OutlinedButton(
            onClick = onReject,
            modifier = Modifier.weight(1f)
        ) {
            Icon(Icons.Default.Close, contentDescription = null)
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.reject))
        }

        // 删除
        FilledTonalButton(
            onClick = onDelete,
            modifier = Modifier.weight(1f),
            colors = ButtonDefaults.filledTonalButtonColors(
                containerColor = MaterialTheme.colorScheme.errorContainer,
                contentColor = MaterialTheme.colorScheme.error
            )
        ) {
            Icon(Icons.Default.Delete, contentDescription = null)
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.delete))
        }
    }
}

/**
 * 申诉中操作按钮
 */
@Composable
private fun AppealingActions(
    onApprove: () -> Unit,
    onReject: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // 批准申诉
        FilledTonalButton(
            onClick = onApprove,
            modifier = Modifier.weight(1f),
            colors = ButtonDefaults.filledTonalButtonColors(
                containerColor = Color(0xFF4CAF50).copy(alpha = 0.1f),
                contentColor = Color(0xFF4CAF50)
            )
        ) {
            Icon(Icons.Default.CheckCircle, contentDescription = null)
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.approve_appeal))
        }

        // 拒绝申诉
        OutlinedButton(
            onClick = onReject,
            modifier = Modifier.weight(1f)
        ) {
            Icon(Icons.Default.Cancel, contentDescription = null)
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.reject_appeal))
        }
    }
}

/**
 * 空队列视图
 */
@Composable
private fun EmptyQueueView(currentTab: ModerationTab) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Icon(
                Icons.Default.CheckCircle,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Text(
                text = when (currentTab) {
                    ModerationTab.PENDING -> stringResource(R.string.no_pending_content)
                    ModerationTab.APPEALING -> stringResource(R.string.no_appeal_items)
                    ModerationTab.ALL -> stringResource(R.string.no_moderation_records)
                },
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 格式化时间戳
 */
private fun formatTimestamp(timestamp: Long): String {
    val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
    return sdf.format(Date(timestamp))
}
