package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.TrendingDown
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.presentation.components.*
import kotlinx.coroutines.launch

/**
 * 统计仪表板
 * 展示所有图表和可视化组件
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsDashboardScreen() {
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    // 模拟数据
    val knowledgeCategories = remember {
        listOf(
            "技术文档" to 45,
            "学习笔记" to 32,
            "项目文档" to 28,
            "个人日记" to 15,
            "其他" to 10
        )
    }

    val weeklyActivity = remember {
        listOf(
            "周一" to 12,
            "周二" to 19,
            "周三" to 15,
            "周四" to 25,
            "周五" to 22,
            "周六" to 8,
            "周日" to 5
        )
    }

    val trendData = remember {
        listOf(10f, 15f, 12f, 20f, 25f, 30f, 28f)
    }

    val skillsData = remember {
        listOf(
            "编程" to 0.85f,
            "设计" to 0.65f,
            "写作" to 0.75f,
            "管理" to 0.70f,
            "沟通" to 0.80f
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("统计分析", fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = {
                        scope.launch { snackbarHostState.showSnackbar("功能开发中") }
                    }) {
                        Icon(Icons.Default.Download, contentDescription = "导出")
                    }
                    IconButton(onClick = {
                        scope.launch { snackbarHostState.showSnackbar("功能开发中") }
                    }) {
                        Icon(Icons.Default.Settings, contentDescription = "设置")
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
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // 概览卡片
            item {
                OverviewCards()
            }

            // 知识库统计饼图
            item {
                KnowledgeStatsChart(
                    totalItems = knowledgeCategories.sumOf { it.second },
                    categories = knowledgeCategories
                )
            }

            // 每周活动柱状图
            item {
                BarChart(
                    data = weeklyActivity,
                    maxValue = 30
                )
            }

            // 趋势折线图
            item {
                LineChart(
                    data = trendData,
                    labels = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
                )
            }

            // 技能雷达图
            item {
                RadarChart(data = skillsData)
            }

            // 详细统计列表
            item {
                DetailedStatsList()
            }
        }
    }
}

/**
 * 概览卡片
 */
@Composable
fun OverviewCards() {
    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = "今日概览",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 知识库数量
            StatsCard(
                modifier = Modifier.weight(1f),
                title = "知识库",
                value = "130",
                change = "+12",
                isPositive = true,
                icon = Icons.Default.School
            )

            // 项目数量
            StatsCard(
                modifier = Modifier.weight(1f),
                title = "项目",
                value = "24",
                change = "+3",
                isPositive = true,
                icon = Icons.Default.Folder
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // AI对话次数
            StatsCard(
                modifier = Modifier.weight(1f),
                title = "AI对话",
                value = "89",
                change = "+15",
                isPositive = true,
                icon = Icons.AutoMirrored.Filled.Chat
            )

            // 任务完成率
            StatsCard(
                modifier = Modifier.weight(1f),
                title = "完成率",
                value = "78%",
                change = "+5%",
                isPositive = true,
                icon = Icons.Default.CheckCircle
            )
        }
    }
}

/**
 * 统计卡片
 */
@Composable
fun StatsCard(
    modifier: Modifier = Modifier,
    title: String,
    value: String,
    change: String,
    isPositive: Boolean,
    icon: androidx.compose.ui.graphics.vector.ImageVector
) {
    GradientCard(
        modifier = modifier,
        gradient = Brush.linearGradient(
            colors = if (isPositive) {
                listOf(
                    MaterialTheme.colorScheme.primary,
                    MaterialTheme.colorScheme.tertiary
                )
            } else {
                listOf(
                    MaterialTheme.colorScheme.error,
                    MaterialTheme.colorScheme.errorContainer
                )
            }
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                )

                Surface(
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.2f),
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(6.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                        horizontalArrangement = Arrangement.spacedBy(2.dp),
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = if (isPositive) Icons.AutoMirrored.Filled.TrendingUp else Icons.AutoMirrored.Filled.TrendingDown,
                            contentDescription = null,
                            modifier = Modifier.size(12.dp),
                            tint = MaterialTheme.colorScheme.onPrimary
                        )
                        Text(
                            text = change,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimary,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }

            Text(
                text = value,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimary
            )

            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f)
            )
        }
    }
}

/**
 * 详细统计列表
 */
@Composable
fun DetailedStatsList() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "详细统计",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )

            DetailedStatItem(
                icon = Icons.Default.Description,
                label = "文档总数",
                value = "130 篇",
                trend = "+12 本周"
            )

            HorizontalDivider()

            DetailedStatItem(
                icon = Icons.Default.Schedule,
                label = "平均响应时间",
                value = "2.3 秒",
                trend = "-0.5 优化"
            )

            HorizontalDivider()

            DetailedStatItem(
                icon = Icons.Default.Storage,
                label = "存储使用",
                value = "3.2 GB",
                trend = "总容量 10GB"
            )

            HorizontalDivider()

            DetailedStatItem(
                icon = Icons.Default.Group,
                label = "协作成员",
                value = "8 人",
                trend = "+2 本月"
            )
        }
    }
}

/**
 * 详细统计项
 */
@Composable
fun DetailedStatItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String,
    trend: String
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
    ) {
        Surface(
            color = MaterialTheme.colorScheme.primaryContainer,
            shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp)
        ) {
            Box(
                modifier = Modifier.padding(10.dp),
                contentAlignment = androidx.compose.ui.Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(24.dp)
                )
            }
        }

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = trend,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary
            )
        }

        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}
