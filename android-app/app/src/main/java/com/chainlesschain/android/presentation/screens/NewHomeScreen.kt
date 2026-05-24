package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.style.TextOverflow
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Toast
import androidx.compose.material3.AlertDialog
import androidx.core.content.ContextCompat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.material.icons.outlined.WarningAmber
import com.chainlesschain.android.R
import com.chainlesschain.android.feature.ai.presentation.ConversationViewModel
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel
import com.chainlesschain.android.presentation.screens.peers.PairedDevicesViewModel
import java.util.Locale
import timber.log.Timber

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
    onNavigateToAIChatWithMessage: (String) -> Unit = {},
    // 最近会话点击 → 打开对应 Chat 路由（filling the gap below the function grid）
    onNavigateToConversation: (String) -> Unit = {},
    onNavigateToLLMSettings: () -> Unit = {},
    onNavigateToSocialFeed: () -> Unit = {},
    onNavigateToMyQRCode: () -> Unit = {},
    onNavigateToQRScanner: () -> Unit = {},
    onNavigateToProjectTab: () -> Unit = {},
    onNavigateToFileBrowser: () -> Unit = {},
    onNavigateToRemoteControl: () -> Unit = {},
    onNavigateToLocalTerminal: () -> Unit = {},
    onNavigateToP2P: () -> Unit = {},
    // Plan A v0.1 — 本机数据中台入口；走 in-APK cc + ContentResolver/PackageManager。
    onNavigateToLocalDataHub: () -> Unit = {},
    // 2026-05-24 — 首页快捷入口跳 AndroidLocalModelScreen（Gemma/Qwen .task 下载 + 测试）
    onNavigateToLocalModel: () -> Unit = {},
    // 2026-05-24 — 首页 更多 sheet "版本更新"，触发 UpdateViewModel.checkForUpdates(silent=false)
    onCheckForUpdates: () -> Unit = {},
    // 用户反馈："设置里扫描桌面 QR 按钮隐藏太深放首页来；首页要显示连接桌面的状态"
    onNavigateToScanDesktopPairing: () -> Unit = {},
    // v1.3+ 点已连接桌面卡片 → 进 RemoteControl 操作页（带 pcPeerId）
    onNavigateToRemoteOperate: (String) -> Unit = {},
    socialUnreadCount: Int = 0,
    homeStatusViewModel: HomeStatusViewModel = hiltViewModel(),
    pairedDevicesViewModel: PairedDevicesViewModel = hiltViewModel(),
    conversationViewModel: ConversationViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val isLlmConfigured by homeStatusViewModel.isLlmConfigured.collectAsStateWithLifecycle()
    val voiceState by homeStatusViewModel.voiceState.collectAsStateWithLifecycle()
    // v1.3+：首页桌面连接卡读 *持久化* 列表（不再读 live WS 连接 — 扫码完信令
    // 立刻断，那个列表永远空，首页永远显示「未连接」）。
    val pairedDesktops by pairedDevicesViewModel.persistedDesktops.collectAsStateWithLifecycle()
    val recentConversations by conversationViewModel.conversations
        .collectAsStateWithLifecycle(initialValue = emptyList())
    var inputText by remember { mutableStateOf("") }
    val context = LocalContext.current

    // RECORD_AUDIO 运行时权限
    val audioPermLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            homeStatusViewModel.startRecording()
        } else {
            Toast.makeText(
                context,
                "未授予麦克风权限。设置 → 应用 → ChainlessChain → 权限",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    // 语音识别完成 / 失败副作用：把 transcript 灌进输入框；error 弹 toast
    LaunchedEffect(voiceState.phase, voiceState.transcript, voiceState.errorMessage) {
        when (voiceState.phase) {
            HomeStatusViewModel.VoicePhase.Done -> {
                voiceState.transcript?.let { text ->
                    inputText = if (inputText.isBlank()) text else "$inputText $text"
                }
                homeStatusViewModel.clearVoiceResult()
            }
            HomeStatusViewModel.VoicePhase.Error -> {
                voiceState.errorMessage?.let { msg ->
                    Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                }
                homeStatusViewModel.clearVoiceResult()
            }
            else -> Unit
        }
    }

    // 每次首页重新出现都刷一次（覆盖从 LLM 设置页返回的场景）
    LaunchedEffect(Unit) {
        homeStatusViewModel.refresh()
    }

    // 系统 SpeechRecognizer Intent —— 弹出系统语音识别面板，返回 zh-CN 文本。
    // 注意：v1 用 Android 内置 Google STT；后续若要切到豆包 ASR 需要单独
    // Volcengine 语音技术 AppID/Token/Cluster（与 ARK LLM key 不同账户）。
    // 语音识别相关 launchers / dialogs 已全部移除（C 方案：暂不支持）

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
            Spacer(modifier = Modifier.height(16.dp))

            // 未配置 LLM 时的提示 banner（点击进入 LLM 设置）
            if (!isLlmConfigured) {
                LlmNotConfiguredBanner(onClick = onNavigateToLLMSettings)
                Spacer(modifier = Modifier.height(12.dp))
            }

            // 桌面连接状态卡片（用户反馈：首页要显示连接桌面的状态 + 扫描 QR 入口）
            DesktopConnectionCard(
                connectedCount = pairedDesktops.size,
                onScanClick = onNavigateToScanDesktopPairing,
                // 已连接时点卡片 → 进 RemoteControl 远程操作页（带第一个已配对桌面的 pcPeerId）。
                // v1.4 单一桌面占大多数；多桌面情况后续加选择 sheet。
                onManageClick = {
                    val first = pairedDesktops.firstOrNull()
                    if (first != null) {
                        onNavigateToRemoteOperate(first.pcPeerId)
                    } else {
                        onNavigateToP2P()
                    }
                },
            )

            // slogan 已搬到 HomeTopBar；body 不再保留品牌/口号区，
            // 给项目管理那排腾出空间（用户反馈：底部显示不全）
            Spacer(modifier = Modifier.height(8.dp))

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
                onNavigateToLocalTerminal = onNavigateToLocalTerminal,
                onNavigateToP2P = onNavigateToP2P,
                onNavigateToLocalDataHub = onNavigateToLocalDataHub,
                onNavigateToLocalModel = onNavigateToLocalModel,
                onCheckForUpdates = onCheckForUpdates,
                socialUnreadCount = socialUnreadCount
            )

            // 最近会话 — 占据网格下方原本的留白，最多 5 条横向滚动
            if (recentConversations.isNotEmpty()) {
                Spacer(modifier = Modifier.height(16.dp))
                RecentConversationsRow(
                    conversations = recentConversations.take(5),
                    onClick = onNavigateToConversation,
                    onSeeAll = onNavigateToAIChat,
                )
            }

            Spacer(modifier = Modifier.height(16.dp))
        }

        // 语音录音 / 识别中 — 自定义美化对话框
        when (voiceState.phase) {
            HomeStatusViewModel.VoicePhase.Recording ->
                VoiceRecordingDialog(
                    onStop = { homeStatusViewModel.stopAndTranscribe() },
                    onCancel = { homeStatusViewModel.cancelRecording() }
                )
            HomeStatusViewModel.VoicePhase.Transcribing ->
                VoiceTranscribingDialog()
            else -> Unit
        }

        // 底部输入框
        ChatInputBar(
            value = inputText,
            onValueChange = { inputText = it },
            onSendMessage = { message ->
                if (message.isNotBlank()) {
                    val toSend = message
                    inputText = ""
                    onNavigateToAIChatWithMessage(toSend)
                }
            },
            onVoiceInput = {
                Timber.tag("VoiceInput").i("mic tapped (SeedASR flow)")
                if (!voiceState.asrConfigured) {
                    Toast.makeText(
                        context,
                        "未配置 SeedASR API Key（设置 → LLM 设置 → 语音识别）",
                        Toast.LENGTH_LONG
                    ).show()
                } else {
                    val granted = ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.RECORD_AUDIO
                    ) == PackageManager.PERMISSION_GRANTED
                    if (granted) {
                        homeStatusViewModel.startRecording()
                    } else {
                        audioPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    }
                }
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
        title = {
            // 左上：logo + 品牌 + 口号（与官网 hero 文案对齐）
            // 用户反馈：左上方看不到 logo 和品牌；口号也搬进头部 → 让出 body 给内容
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Image(
                    painter = painterResource(id = R.mipmap.ic_launcher),
                    contentDescription = null,
                    modifier = Modifier
                        .size(32.dp)
                        .clip(RoundedCornerShape(8.dp))
                )
                Spacer(modifier = Modifier.width(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(
                        text = "ChainlessChain",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1
                    )
                    Text(
                        text = stringResource(R.string.home_subtitle),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        },
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
        ),
        // MainContainer 的 Scaffold 已经把 statusBars inset 应用到内容区，
        // 这里再用 TopAppBarDefaults.windowInsets (默认含 statusBars) 会双计 →
        // 头部出现一大块空白。归零让 TopAppBar 紧贴 Scaffold 边界。
        windowInsets = WindowInsets(0, 0, 0, 0),
    )
}

/**
 * 未配置 LLM API Key 时的首页提示条
 */
@Composable
fun LlmNotConfiguredBanner(onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.55f),
        tonalElevation = 0.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Icon(
                imageVector = Icons.Outlined.WarningAmber,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onErrorContainer,
                modifier = Modifier.size(20.dp)
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "尚未配置 LLM API Key",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onErrorContainer
                )
                Text(
                    text = "点此前往 LLM 设置 → 选择模型并填入 API Key",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.85f)
                )
            }
            Icon(
                imageVector = Icons.AutoMirrored.Filled.Send,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.7f),
                modifier = Modifier.size(16.dp)
            )
        }
    }
}

/**
 * 桌面连接状态卡片（用户反馈："首页要显示连接桌面的状态" + "扫描桌面 QR 按钮放首页来"）。
 *
 * connectedCount = 0：橙色 banner + "扫描桌面 QR" 大按钮
 * connectedCount > 0：绿色 banner + "已连接 N 台" + 点击进设备管理
 */
@Composable
fun DesktopConnectionCard(
    connectedCount: Int,
    onScanClick: () -> Unit,
    onManageClick: () -> Unit,
) {
    val isConnected = connectedCount > 0
    val bgColor = if (isConnected)
        Color(0xFF52c41a).copy(alpha = 0.15f)
    else
        MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
    val accentColor = if (isConnected)
        Color(0xFF389e0d)
    else
        MaterialTheme.colorScheme.primary

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = if (isConnected) onManageClick else onScanClick),
        shape = RoundedCornerShape(12.dp),
        color = bgColor,
        tonalElevation = 0.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector = if (isConnected) Icons.Outlined.CloudDone
                    else Icons.Outlined.CloudOff,
                contentDescription = null,
                tint = accentColor,
                modifier = Modifier.size(28.dp),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = if (isConnected) "已连接 $connectedCount 台桌面"
                        else "未连接桌面",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = accentColor,
                )
                Text(
                    text = if (isConnected) "点击查看 / 管理已配对设备"
                        else "点击扫描桌面 QR 完成配对，开启项目 / 知识库同步",
                    style = MaterialTheme.typography.bodySmall,
                    color = accentColor.copy(alpha = 0.85f),
                )
            }
            if (!isConnected) {
                FilledTonalButton(
                    onClick = onScanClick,
                    colors = ButtonDefaults.filledTonalButtonColors(
                        containerColor = accentColor.copy(alpha = 0.2f),
                        contentColor = accentColor,
                    ),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Icon(
                        imageVector = Icons.Default.QrCodeScanner,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("扫描", style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

/**
 * 品牌区域
 */
@Composable
fun RecentConversationsRow(
    conversations: List<com.chainlesschain.android.feature.ai.domain.model.Conversation>,
    onClick: (String) -> Unit,
    onSeeAll: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "最近会话",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onSeeAll, contentPadding = PaddingValues(horizontal = 8.dp)) {
                Text(text = "查看全部", style = MaterialTheme.typography.labelMedium)
            }
        }
        Spacer(modifier = Modifier.height(4.dp))
        // 5 张 chip 用 Row + horizontalScroll 即可，不需要 LazyRow 的 recycler
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            conversations.forEach { conv ->
                Card(
                    modifier = Modifier
                        .width(180.dp)
                        .height(72.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .clickable { onClick(conv.id) },
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            text = conv.title.ifBlank { "未命名会话" },
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = formatRelativeTime(conv.updatedAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

private fun formatRelativeTime(epochMillis: Long): String {
    val diff = System.currentTimeMillis() - epochMillis
    return when {
        diff < 60_000L -> "刚刚"
        diff < 3_600_000L -> "${diff / 60_000L} 分钟前"
        diff < 86_400_000L -> "${diff / 3_600_000L} 小时前"
        diff < 604_800_000L -> "${diff / 86_400_000L} 天前"
        else -> {
            val d = java.text.SimpleDateFormat("MM-dd", java.util.Locale.getDefault())
            d.format(java.util.Date(epochMillis))
        }
    }
}

@Composable
fun CompactSlogan() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth()
    ) {
        // 主 slogan — 与官网 hero h1 对齐
        Text(
            text = stringResource(R.string.home_subtitle),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(2.dp))
        // 副 tagline — 与官网 hero h1 下方 p 对齐
        Text(
            text = stringResource(R.string.home_tagline),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
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
    onNavigateToLocalTerminal: () -> Unit = {},
    onNavigateToP2P: () -> Unit = {},
    onNavigateToLocalDataHub: () -> Unit = {},
    onNavigateToLocalModel: () -> Unit = {},
    onCheckForUpdates: () -> Unit = {},
    socialUnreadCount: Int = 0
) {
    // 8宫格 + 更多 sheet 布局
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
        onNavigateToLocalTerminal,
        onNavigateToLocalDataHub,
        onNavigateToLocalModel,
        onCheckForUpdates,
        socialUnreadCount
    ) {
        listOf(
            // Row 1：本地终端 + 本机数据 + LLM 设置
            FunctionEntryItem("本地终端", Icons.Outlined.Terminal, Color(0xFF455A64), FeatureGroup.CORE_WORK, onClick = onNavigateToLocalTerminal),
            FunctionEntryItem("本机数据", Icons.Outlined.Storage, Color(0xFF26A69A), FeatureGroup.CORE_WORK, onClick = onNavigateToLocalDataHub),
            FunctionEntryItem(context.getString(R.string.feature_llm_settings), Icons.Outlined.Settings, Color(0xFF2196F3), FeatureGroup.CORE_WORK, onClick = onNavigateToLLMSettings),

            // Row 2：本机模型 抢 原 社交广场 位 + 二维码两件套
            // user feedback 2026-05-24：首页加本机模型快捷入口；社交广场降到 更多 sheet
            FunctionEntryItem(context.getString(R.string.feature_local_model), Icons.Outlined.PhoneAndroid, Color(0xFF9C27B0), FeatureGroup.CORE_WORK, onClick = onNavigateToLocalModel),
            FunctionEntryItem(context.getString(R.string.feature_my_qrcode), Icons.Outlined.QrCode2, Color(0xFFE91E63), FeatureGroup.CORE_SOCIAL, onClick = onNavigateToMyQRCode),
            FunctionEntryItem(context.getString(R.string.feature_scan_qrcode), Icons.Outlined.QrCodeScanner, Color(0xFFFF9800), FeatureGroup.CORE_SOCIAL, onClick = onNavigateToQRScanner),

            // Row 3：版本更新 + 文件浏览 (+ auto 更多)
            // user feedback 2026-05-24 round 2：版本更新 和 项目管理 swap —— 版本更新 promote 到 row 3 cell 1，项目管理 demoted 到 更多 sheet
            FunctionEntryItem(context.getString(R.string.feature_check_update), Icons.Outlined.SystemUpdate, Color(0xFF607D8B), FeatureGroup.SYSTEM, onClick = onCheckForUpdates),
            FunctionEntryItem(context.getString(R.string.feature_file_browser), Icons.Outlined.FolderOpen, Color(0xFF8BC34A), FeatureGroup.CORE_WORK, onClick = onNavigateToFileBrowser),

            // 更多 sheet items —— take(8) 之后这些走 ModalBottomSheet
            // 社交广场 demoted from row 2 cell 1（让位 本机模型）
            FunctionEntryItem(context.getString(R.string.feature_social_feed), Icons.Outlined.Forum, Color(0xFF9C27B0), FeatureGroup.CORE_SOCIAL, onClick = onNavigateToSocialFeed, badgeCount = socialUnreadCount),
            // 项目管理 — demoted from row 3 cell 1（让位 版本更新）
            FunctionEntryItem(context.getString(R.string.feature_project_management), Icons.Outlined.Assignment, Color(0xFF00BCD4), FeatureGroup.CORE_WORK, onClick = onNavigateToProjectTab),
            // 知识库 — demoted from row 3 cell 3
            FunctionEntryItem(context.getString(R.string.feature_knowledge_base), Icons.Outlined.Book, Color(0xFFFF6B9D), FeatureGroup.CORE_WORK, onClick = onNavigateToKnowledgeList),
            // AI 对话 — 依赖远控桌面 LLM，离线不可用
            FunctionEntryItem(context.getString(R.string.feature_ai_chat), Icons.Outlined.Chat, Color(0xFF4CAF50), FeatureGroup.CORE_WORK, onClick = onNavigateToAIChat),
            FunctionEntryItem(context.getString(R.string.feature_p2p_devices), Icons.Outlined.Devices, Color(0xFFFF5722), FeatureGroup.DEVICE_CONNECTION, onClick = onNavigateToP2P),
            FunctionEntryItem(context.getString(R.string.feature_remote_control), Icons.Outlined.Computer, Color(0xFF673AB7), FeatureGroup.DEVICE_CONNECTION, onClick = onNavigateToRemoteControl),
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
    // Claude 风：所有卡片用统一 surfaceVariant 底，图标包圆形浅色 chip（保留原色作 accent，alpha 0.18）
    Card(
        modifier = Modifier
            .aspectRatio(1f)
            // 显式 clip 到圆角，确保 ripple / 子元素不会越界出方角（解决底部那行看上去"少圆角"）
            .clip(RoundedCornerShape(18.dp))
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
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
            // 图标 chip
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(backgroundColor.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center
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
                            modifier = Modifier.size(22.dp)
                        )
                    }
                } else {
                    Icon(
                        imageVector = icon,
                        contentDescription = title,
                        tint = backgroundColor,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
            Spacer(modifier = Modifier.height(10.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
                maxLines = 2
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
