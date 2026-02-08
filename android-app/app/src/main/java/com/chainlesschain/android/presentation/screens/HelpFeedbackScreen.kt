package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * 帮助与反馈页面
 * 常见问题、使用教程、问题反馈、联系方式
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpFeedbackScreen(
    onNavigateBack: () -> Unit
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var feedbackText by remember { mutableStateOf("") }
    var showFeedbackDialog by remember { mutableStateOf(false) }
    var showSubmittedDialog by remember { mutableStateOf(false) }

    val faqItems = remember {
        listOf(
            FAQItem(
                question = "如何创建知识库？",
                answer = "在首页点击「知识库」入口，进入知识库列表后点击右上角「+」按钮即可创建新的知识库条目。支持文本、文档等多种格式。"
            ),
            FAQItem(
                question = "如何配置AI模型？",
                answer = "进入「我的」>「AI配置」，选择LLM提供商（如豆包/OpenAI/Ollama等），填入API密钥即可完成配置。推荐先使用「AI测试」验证连接。"
            ),
            FAQItem(
                question = "P2P设备连接失败怎么办？",
                answer = "请确保两台设备在同一网络环境下，检查防火墙设置是否允许P2P通信。若使用远程连接，请确保信令服务器可达。"
            ),
            FAQItem(
                question = "数据如何备份？",
                answer = "进入「设置」>「数据管理」，可以导出个人数据。应用使用SQLCipher加密存储，数据默认保存在应用私有目录中。"
            ),
            FAQItem(
                question = "如何保障数据安全？",
                answer = "应用采用AES-256加密数据库，支持PIN码和生物识别解锁。P2P通信使用Signal协议端到端加密，身份基于DID去中心化标识。"
            )
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("帮助与反馈", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 快捷操作
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    HelpActionCard(
                        icon = Icons.Default.BugReport,
                        title = "报告问题",
                        modifier = Modifier.weight(1f),
                        onClick = { showFeedbackDialog = true }
                    )
                    HelpActionCard(
                        icon = Icons.Default.Lightbulb,
                        title = "功能建议",
                        modifier = Modifier.weight(1f),
                        onClick = { showFeedbackDialog = true }
                    )
                    HelpActionCard(
                        icon = Icons.Default.Email,
                        title = "联系我们",
                        modifier = Modifier.weight(1f),
                        onClick = {
                            val intent = android.content.Intent(android.content.Intent.ACTION_SENDTO).apply {
                                data = android.net.Uri.parse("mailto:support@chainlesschain.com")
                                putExtra(android.content.Intent.EXTRA_SUBJECT, "ChainlessChain 反馈")
                            }
                            try { context.startActivity(intent) } catch (_: Exception) {}
                        }
                    )
                }
            }

            // 常见问题
            item {
                Text(
                    text = "常见问题",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            items(faqItems) { faq ->
                FAQCard(faq = faq)
            }

            // 使用教程
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "使用教程",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            item {
                TutorialCard(
                    icon = Icons.Default.PlayCircle,
                    title = "快速入门",
                    description = "了解ChainlessChain的核心功能和基本操作"
                )
            }

            item {
                TutorialCard(
                    icon = Icons.Default.SmartToy,
                    title = "AI对话进阶",
                    description = "掌握多模型配置、提示词优化和Token管理"
                )
            }

            item {
                TutorialCard(
                    icon = Icons.Default.Devices,
                    title = "设备互联",
                    description = "配置P2P连接，实现跨设备协作和远程控制"
                )
            }

            item {
                TutorialCard(
                    icon = Icons.Default.Security,
                    title = "安全指南",
                    description = "了解加密机制、DID身份和密钥管理"
                )
            }
        }
    }

    // 反馈对话框
    if (showFeedbackDialog) {
        AlertDialog(
            onDismissRequest = { showFeedbackDialog = false },
            title = { Text("提交反馈") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "请描述您遇到的问题或建议：",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    OutlinedTextField(
                        value = feedbackText,
                        onValueChange = { feedbackText = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 120.dp),
                        placeholder = { Text("请输入反馈内容...") },
                        maxLines = 6
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showFeedbackDialog = false
                        if (feedbackText.isNotBlank()) {
                            showSubmittedDialog = true
                            feedbackText = ""
                        }
                    },
                    enabled = feedbackText.isNotBlank()
                ) {
                    Text("提交")
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showFeedbackDialog = false
                    feedbackText = ""
                }) {
                    Text("取消")
                }
            }
        )
    }

    // 提交成功提示
    if (showSubmittedDialog) {
        AlertDialog(
            onDismissRequest = { showSubmittedDialog = false },
            icon = { Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.primary) },
            title = { Text("提交成功") },
            text = { Text("感谢您的反馈！我们会尽快处理。") },
            confirmButton = {
                TextButton(onClick = { showSubmittedDialog = false }) {
                    Text("好的")
                }
            }
        )
    }
}

/**
 * 快捷操作卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpActionCard(
    icon: ImageVector,
    title: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Card(
        modifier = modifier,
        onClick = onClick,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(24.dp)
            )
            Text(
                text = title,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
        }
    }
}

/**
 * FAQ可展开卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FAQCard(faq: FAQItem) {
    var expanded by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = { expanded = !expanded },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        ),
        shape = RoundedCornerShape(12.dp)
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
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        imageVector = Icons.Default.QuestionAnswer,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                    Text(
                        text = faq.question,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Medium
                    )
                }
                Icon(
                    imageVector = if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (expanded) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = faq.answer,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * 教程卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TutorialCard(
    icon: ImageVector,
    title: String,
    description: String
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = {
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://docs.chainlesschain.com"))
            try { context.startActivity(intent) } catch (_: Exception) {}
        },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(20.dp)
                )
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * FAQ数据类
 */
data class FAQItem(
    val question: String,
    val answer: String
)
