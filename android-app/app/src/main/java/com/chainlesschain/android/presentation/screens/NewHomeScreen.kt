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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
    onNavigateToKnowledgeList: () -> Unit = {},
    onNavigateToAIChat: () -> Unit = {},
    onNavigateToLLMSettings: () -> Unit = {},
    onNavigateToSocialFeed: () -> Unit = {},
    onNavigateToMyQRCode: () -> Unit = {},
    onNavigateToQRScanner: () -> Unit = {},
    onNavigateToProjectTab: () -> Unit = {},
    onNavigateToFileBrowser: () -> Unit = {},
    onNavigateToRemoteControl: () -> Unit = {},
    onNavigateToP2P: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    var inputText by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        // 顶部栏 - 用户头像
        HomeTopBar(onProfileClick = onProfileClick)

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
                onNavigateToKnowledgeList = onNavigateToKnowledgeList,
                onNavigateToAIChat = onNavigateToAIChat,
                onNavigateToLLMSettings = onNavigateToLLMSettings,
                onNavigateToSocialFeed = onNavigateToSocialFeed,
                onNavigateToMyQRCode = onNavigateToMyQRCode,
                onNavigateToQRScanner = onNavigateToQRScanner,
                onNavigateToProjectTab = onNavigateToProjectTab,
                onNavigateToFileBrowser = onNavigateToFileBrowser,
                onNavigateToRemoteControl = onNavigateToRemoteControl,
                onNavigateToP2P = onNavigateToP2P
            )

            Spacer(modifier = Modifier.height(16.dp))
        }

        // 底部输入框
        ChatInputBar(
            value = inputText,
            onValueChange = { inputText = it },
            onSendMessage = { message ->
                // TODO: 处理发送消息
                inputText = ""
            },
            onVoiceInput = {
                // TODO: 处理语音输入
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
    onProfileClick: () -> Unit
) {
    TopAppBar(
        title = { },
        actions = {
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
                        contentDescription = "个人中心",
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
            text = "你的AI办公空间",
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
    onNavigateToKnowledgeList: () -> Unit = {},
    onNavigateToAIChat: () -> Unit = {},
    onNavigateToLLMSettings: () -> Unit = {},
    onNavigateToSocialFeed: () -> Unit = {},
    onNavigateToMyQRCode: () -> Unit = {},
    onNavigateToQRScanner: () -> Unit = {},
    onNavigateToProjectTab: () -> Unit = {},
    onNavigateToFileBrowser: () -> Unit = {},
    onNavigateToRemoteControl: () -> Unit = {},
    onNavigateToP2P: () -> Unit = {}
) {
    // 9 个核心功能入口，覆盖三大核心板块
    val functionItems = remember(
        onNavigateToKnowledgeList,
        onNavigateToAIChat,
        onNavigateToLLMSettings,
        onNavigateToSocialFeed,
        onNavigateToMyQRCode,
        onNavigateToQRScanner,
        onNavigateToProjectTab,
        onNavigateToFileBrowser,
        onNavigateToP2P,
        onNavigateToRemoteControl
    ) {
        listOf(
            // 第一行：知识库管理（个人第二大脑）
            FunctionEntryItem("知识库", Icons.Outlined.Book, Color(0xFFFF6B9D), onClick = onNavigateToKnowledgeList),
            FunctionEntryItem("AI对话", Icons.Outlined.Chat, Color(0xFF4CAF50), onClick = onNavigateToAIChat),
            FunctionEntryItem("LLM设置", Icons.Outlined.Settings, Color(0xFF2196F3), onClick = onNavigateToLLMSettings),

            // 第二行：去中心化社交（DID + P2P）
            FunctionEntryItem("社交广场", Icons.Outlined.Forum, Color(0xFF9C27B0), onClick = onNavigateToSocialFeed),
            FunctionEntryItem("我的二维码", Icons.Outlined.QrCode2, Color(0xFFE91E63), onClick = onNavigateToMyQRCode),
            FunctionEntryItem("扫码添加", Icons.Outlined.QrCodeScanner, Color(0xFFFF9800), onClick = onNavigateToQRScanner),

            // 第三行：项目管理 & 数字资产 & 设备管理
            FunctionEntryItem("项目管理", Icons.Outlined.Assignment, Color(0xFF00BCD4), onClick = onNavigateToProjectTab),
            FunctionEntryItem("文件浏览", Icons.Outlined.FolderOpen, Color(0xFF8BC34A), onClick = onNavigateToFileBrowser),
            // P2P设备管理
            FunctionEntryItem("P2P设备", Icons.Outlined.Devices, Color(0xFFFF5722), onClick = onNavigateToP2P)
        )
    }

    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        modifier = Modifier
            .fillMaxWidth()
            .height(360.dp), // 固定高度以适配3行卡片 (每行约120dp)
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        userScrollEnabled = false  // 由父容器处理滚动
    ) {
        items(functionItems) { item ->
            FunctionEntryCard(
                icon = item.icon,
                title = item.title,
                backgroundColor = item.color,
                onClick = item.onClick ?: {}
            )
        }
    }
}

/**
 * 功能入口卡片
 */
@Composable
fun FunctionEntryCard(
    icon: ImageVector,
    title: String,
    backgroundColor: Color,
    onClick: () -> Unit
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
            Icon(
                imageVector = icon,
                contentDescription = title,
                tint = backgroundColor,
                modifier = Modifier.size(32.dp)
            )
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
                        text = "发消息或按住说话...",
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
                                contentDescription = "语音输入",
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
                        imageVector = Icons.Default.Send,
                        contentDescription = "发送"
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
    val onClick: (() -> Unit)? = null
)
