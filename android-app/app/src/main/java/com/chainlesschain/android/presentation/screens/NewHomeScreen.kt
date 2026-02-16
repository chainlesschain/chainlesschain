package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.chainlesschain.android.R
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel

/**
 * 新首页设计
 * 参考设计稿：顶部用户头像、品牌区域、功能入口网格、底部输入框
 * 包含三大核心功能入口：
 * 1. 知识库管理 - 个人第二大脑
 * 2. 去中心化社交 - DID身份、P2P加密通讯
 * 3. 项目管理 & 数字资产 - 项目管理、文件管理、智能合约
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewHomeScreen(
    viewModel: AuthViewModel,
    onProfileClick: () -> Unit = {},
    onNavigateToUsageStatistics: () -> Unit = {},
    onNavigateToKnowledgeList: () -> Unit = {},
    onNavigateToAIChat: () -> Unit = {},
    onNavigateToLLMSettings: () -> Unit = {},
    onNavigateToSocialFeed: () -> Unit = {},
    onNavigateToMyQRCode: () -> Unit = {},
    onNavigateToQRScanner: () -> Unit = {},
    onNavigateToProjectTab: () -> Unit = {},
    onNavigateToFileBrowser: () -> Unit = {},
    onNavigateToRemoteControl: () -> Unit = {},
    onNavigateToP2P: () -> Unit = {},
    socialUnreadCount: Int = 0
) {
    val uiState by viewModel.uiState.collectAsState()
    var inputText by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
        .background(MaterialTheme.colorScheme.surface)
    ) {
        // 顶部栏 - 用户头像
        HomeTopBar(
            onProfileClick = onProfileClick,
            onNavigateToUsageStatistics = onNavigateToUsageStatistics
        )

        // 主内容区域 - 添加滚动支持
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(24.dp))

            // 品牌区域
            BrandSection()

            Spacer(modifier = Modifier.height(32.dp))

            // 功能入口网格 (3x3 = 9个核心功能)
            FunctionEntryGrid(
                onNavigateToUsageStatistics = onNavigateToUsageStatistics,
                onNavigateToKnowledgeList = onNavigateToKnowledgeList,
                onNavigateToAIChat = onNavigateToAIChat,
                onNavigateToLLMSettings = onNavigateToLLMSettings,
                onNavigateToSocialFeed = onNavigateToSocialFeed,
                onNavigateToMyQRCode = onNavigateToMyQRCode,
                onNavigateToQRScanner = onNavigateToQRScanner,
                onNavigateToProjectTab = onNavigateToProjectTab,
                onNavigateToFileBrowser = onNavigateToFileBrowser,
                onNavigateToRemoteControl = onNavigateToRemoteControl,
                onNavigateToP2P = onNavigateToP2P,
                socialUnreadCount = socialUnreadCount
            )

            Spacer(modifier = Modifier.height(16.dp))
        }

        // 底部输入框
        ChatInputBar(
            value = inputText,
            onValueChange = { inputText = it },
            onSendMessage = { message ->
                inputText = ""
                onNavigateToAIChat()
            },
            onVoiceInput = {
                // Voice input will be available in a future release
            }
        )
    }
}

/**
 * 首页顶部栏
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeTopBar(
    onProfileClick: () -> Unit,
    onNavigateToUsageStatistics: () -> Unit
) {
    TopAppBar(
        title = { },
        actions = {
            // 使用统计入口
            IconButton(onClick = onNavigateToUsageStatistics) {
                Icon(
                    imageVector = Icons.Default.Analytics,
                    contentDescription = stringResource(R.string.home_usage_statistics),
                    tint = MaterialTheme.colorScheme.onSurface
                )
            }

            // 用户头像按钮
            IconButton(onClick = onProfileClick) {
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Person,
                        contentDescription = stringResource(R.string.home_profile_center),
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    )
}

/**
 * 品牌区域
 */
@Composable
fun BrandSection() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // 应用图标/吉祥物
        Box(
            modifier = Modifier
                .size(80.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.AutoAwesome,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(48.dp)
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // 应用名称
        Text(
            text = "ChainlessChain",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface
        )

        Spacer(modifier = Modifier.height(4.dp))

        // 副标题
        Text(
            text = stringResource(R.string.home_subtitle),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * 功能入口网格
 * 展示三大核心功能：知识库管理、去中心化社交、项目管理/数字资产
 */
@Composable
fun FunctionEntryGrid(
    onNavigateToUsageStatistics: () -> Unit = {},
    onNavigateToKnowledgeList: () -> Unit = {},
    onNavigateToAIChat: () -> Unit = {},
    onNavigateToLLMSettings: () -> Unit = {},
    onNavigateToSocialFeed: () -> Unit = {},
    onNavigateToMyQRCode: () -> Unit = {},
    onNavigateToQRScanner: () -> Unit = {},
    onNavigateToProjectTab: () -> Unit = {},
    onNavigateToFileBrowser: () -> Unit = {},
    onNavigateToRemoteControl: () -> Unit = {},
    onNavigateToP2P: () -> Unit = {},
    socialUnreadCount: Int = 0
) {
    // 10 个核心功能入口，采用"8宫格 + 更多"布局
    val context = LocalContext.current
    val functionItems = remember(
        onNavigateToUsageStatistics,
        onNavigateToKnowledgeList,
        onNavigateToAIChat,
        onNavigateToLLMSettings,
        onNavigateToSocialFeed,
        onNavigateToMyQRCode,
        onNavigateToQRScanner,
        onNavigateToProjectTab,
        onNavigateToFileBrowser,
        onNavigateToP2P,
        onNavigateToRemoteControl,
        socialUnreadCount
    ) {
        listOf(
            // 第一行：知识库管理（个人第二大脑）
            FunctionEntryItem(context.getString(R.string.feature_knowledge_base), Icons.Outlined.Book, Color(0xFFFF6B9D), FeatureGroup.CORE_WORK, onClick = onNavigateToKnowledgeList),
            FunctionEntryItem(context.getString(R.string.feature_ai_chat), Icons.Outlined.Chat, Color(0xFF4CAF50), FeatureGroup.CORE_WORK, onClick = onNavigateToAIChat),
            FunctionEntryItem(context.getString(R.string.feature_llm_settings), Icons.Outlined.Settings, Color(0xFF2196F3), FeatureGroup.CORE_WORK, onClick = onNavigateToLLMSettings),

            // 第二行：去中心化社交（DID + P2P）
            FunctionEntryItem(context.getString(R.string.feature_social_feed), Icons.Outlined.Forum, Color(0xFF9C27B0), FeatureGroup.CORE_SOCIAL, onClick = onNavigateToSocialFeed, badgeCount = socialUnreadCount),
            FunctionEntryItem(context.getString(R.string.feature_my_qrcode), Icons.Outlined.QrCode2, Color(0xFFE91E63), FeatureGroup.CORE_SOCIAL, onClick = onNavigateToMyQRCode),
            FunctionEntryItem(context.getString(R.string.feature_scan_qrcode), Icons.Outlined.QrCodeScanner, Color(0xFFFF9800), FeatureGroup.CORE_SOCIAL, onClick = onNavigateToQRScanner),

            // 第三行：项目管理 & 数字资产 & 设备管理
            FunctionEntryItem(context.getString(R.string.feature_project_management), Icons.Outlined.Assignment, Color(0xFF00BCD4), FeatureGroup.CORE_WORK, onClick = onNavigateToProjectTab),
            FunctionEntryItem(context.getString(R.string.feature_file_browser), Icons.Outlined.FolderOpen, Color(0xFF8BC34A), FeatureGroup.CORE_WORK, onClick = onNavigateToFileBrowser),
            // P2P设备管理
            FunctionEntryItem(context.getString(R.string.feature_p2p_devices), Icons.Outlined.Devices, Color(0xFFFF5722), FeatureGroup.DEVICE_CONNECTION, onClick = onNavigateToP2P),
            // 远程控制
            FunctionEntryItem(context.getString(R.string.feature_remote_control), Icons.Outlined.Computer, Color(0xFF673AB7), FeatureGroup.DEVICE_CONNECTION, onClick = onNavigateToRemoteControl),
            // 第四行：统计分析
            FunctionEntryItem(context.getString(R.string.home_usage_statistics), Icons.Outlined.Analytics, Color(0xFF3F51B5), FeatureGroup.DATA_STATISTICS, onClick = onNavigateToUsageStatistics)
        )
    }
    var showMoreSheet by remember { mutableStateOf(false) }
    val primaryItems = functionItems.take(8)
    val remainingItems = functionItems.drop(8)
    val displayItems = primaryItems + FunctionEntryItem(
        title = stringResource(R.string.common_more),
        icon = Icons.Outlined.MoreHoriz,
        color = Color(0xFF607D8B),
        group = FeatureGroup.SYSTEM,
        onClick = { showMoreSheet = true }
    )

    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        modifier = Modifier
            .fillMaxWidth()
            .height(360.dp), // 固定高度，保持首页视觉紧凑
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        userScrollEnabled = false  // 由父容器处理滚动
    ) {
        items(displayItems, key = { it.title }) { item ->
            FunctionEntryCard(
                icon = item.icon,
                title = item.title,
                backgroundColor = item.color,
                onClick = item.onClick ?: {},
                badgeCount = item.badgeCount
            )
        }
    }

    if (showMoreSheet) {
        val deviceItems = remainingItems.filter { it.group == FeatureGroup.DEVICE_CONNECTION }
        val dataItems = remainingItems.filter { it.group == FeatureGroup.DATA_STATISTICS }
        val otherItems = remainingItems - deviceItems.toSet() - dataItems.toSet()

        ModalBottomSheet(
            onDismissRequest = { showMoreSheet = false }
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Text(
                    text = stringResource(R.string.home_more_features),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(12.dp))

                if (deviceItems.isNotEmpty()) {
                    Text(
                        text = stringResource(R.string.home_section_devices),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    deviceItems.forEach { item ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 10.dp)
                                .clickable {
                                    showMoreSheet = false
                                    item.onClick?.invoke()
                                },
                            colors = CardDefaults.cardColors(
                                containerColor = item.color.copy(alpha = 0.15f)
                            )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(14.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = item.icon,
                                    contentDescription = item.title,
                                    tint = item.color
                                )
                                Text(
                                    text = item.title,
                                    style = MaterialTheme.typography.titleMedium
                                )
                            }
                        }
                    }
                }

                if (dataItems.isNotEmpty()) {
                    Text(
                        text = stringResource(R.string.home_section_data),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    dataItems.forEach { item ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 10.dp)
                                .clickable {
                                    showMoreSheet = false
                                    item.onClick?.invoke()
                                },
                            colors = CardDefaults.cardColors(
                                containerColor = item.color.copy(alpha = 0.15f)
                            )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(14.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = item.icon,
                                    contentDescription = item.title,
                                    tint = item.color
                                )
                                Text(
                                    text = item.title,
                                    style = MaterialTheme.typography.titleMedium
                                )
                            }
                        }
                    }
                }

                if (otherItems.isNotEmpty()) {
                    Text(
                        text = stringResource(R.string.home_section_other),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    otherItems.forEach { item ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 10.dp)
                                .clickable {
                                    showMoreSheet = false
                                    item.onClick?.invoke()
                                },
                            colors = CardDefaults.cardColors(
                                containerColor = item.color.copy(alpha = 0.15f)
                            )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(14.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = item.icon,
                                    contentDescription = item.title,
                                    tint = item.color
                                )
                                Text(
                                    text = item.title,
                                    style = MaterialTheme.typography.titleMedium
                                )
                            }
                        }
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }
}

/**
 * 功能入口卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FunctionEntryCard(
    icon: ImageVector,
    title: String,
    backgroundColor: Color,
    onClick: () -> Unit,
    badgeCount: Int = 0
) {
    Card(
        modifier = Modifier
            .aspectRatio(1f)
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = backgroundColor.copy(alpha = 0.15f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            if (badgeCount > 0) {
                BadgedBox(
                    badge = {
                        Badge {
                            Text(if (badgeCount > 99) "99+" else badgeCount.toString())
                        }
                    }
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = title,
                        tint = backgroundColor,
                        modifier = Modifier.size(32.dp)
                    )
                }
            } else {
                Icon(
                    imageVector = icon,
                    contentDescription = title,
                    tint = backgroundColor,
                    modifier = Modifier.size(32.dp)
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center
            )
        }
    }
}

/**
 * 底部聊天输入栏
 */
@Composable
fun ChatInputBar(
    value: String,
    onValueChange: (String) -> Unit,
    onSendMessage: (String) -> Unit,
    onVoiceInput: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 8.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 输入框
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.weight(1f),
                placeholder = {
                    Text(
                        text = stringResource(R.string.home_hint_message_or_voice),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                },
                shape = RoundedCornerShape(24.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                    focusedBorderColor = MaterialTheme.colorScheme.primary
                ),
                singleLine = true,
                trailingIcon = {
                    if (value.isEmpty()) {
                        // 语音按钮
                        IconButton(onClick = onVoiceInput) {
                            Icon(
                                imageVector = Icons.Default.Mic,
                                contentDescription = stringResource(R.string.home_voice_input),
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                }
            )

            // 发送按钮
            if (value.isNotEmpty()) {
                FilledIconButton(
                    onClick = { onSendMessage(value) },
                    modifier = Modifier.size(48.dp)
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = stringResource(R.string.common_send)
                    )
                }
            }
        }
    }
}

/**
 * 功能入口数据类
 */
data class FunctionEntryItem(
    val title: String,
    val icon: ImageVector,
    val color: Color,
    val group: FeatureGroup,
    val onClick: (() -> Unit)? = null,
    val badgeCount: Int = 0
)

enum class FeatureGroup {
    CORE_WORK,
    CORE_SOCIAL,
    DEVICE_CONNECTION,
    DATA_STATISTICS,
    SYSTEM
}
