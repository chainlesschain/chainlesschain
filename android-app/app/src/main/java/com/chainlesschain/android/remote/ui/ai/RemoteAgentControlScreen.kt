package com.chainlesschain.android.remote.ui.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.commands.AgentAction
import com.chainlesschain.android.remote.p2p.ConnectionState
import java.text.SimpleDateFormat
import java.util.*

/**
 * 远程 Agent 控制界面
 *
 * 功能：
 * - 查看 PC 端 AI Agent 列表
 * - 启动/停止/重启 Agent
 * - 查看 Agent 状态
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteAgentControlScreen(
    viewModel: RemoteAgentControlViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val agents by viewModel.agents.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Agent 控制") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 刷新按钮
                    IconButton(
                        onClick = { viewModel.refreshAllAgents() },
                        enabled = connectionState == ConnectionState.CONNECTED
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新")
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                connectionState != ConnectionState.CONNECTED -> {
                    // 未连接提示
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Icon(
                                Icons.Default.CloudOff,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                            )
                            Text(
                                text = "未连接到 PC",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = "请先在主界面连接到 PC 设备",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                            )
                        }
                    }
                }
                agents.isEmpty() -> {
                    // 无 Agent
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Icon(
                                Icons.Default.SmartToy,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                            )
                            Text(
                                text = "暂无 Agent",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                else -> {
                    // Agent 列表
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        // 统计信息
                        item {
                            AgentStatisticsCard(agents = agents)
                        }

                        // Agent 列表
                        items(agents, key = { it.id }) { agent ->
                            AgentCard(
                                agent = agent,
                                onStart = { viewModel.controlAgent(agent.id, AgentAction.START) },
                                onStop = { viewModel.controlAgent(agent.id, AgentAction.STOP) },
                                onRestart = { viewModel.controlAgent(agent.id, AgentAction.RESTART) },
                                enabled = !uiState.isLoading
                            )
                        }
                    }
                }
            }

            // 错误提示
            uiState.error?.let { error ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                    action = {
                        TextButton(onClick = { viewModel.clearError() }) {
                            Text("关闭")
                        }
                    }
                ) {
                    Text(error)
                }
            }

            // 加载指示器
            if (uiState.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
        }
    }
}

/**
 * Agent 统计信息卡片
 */
@Composable
fun AgentStatisticsCard(agents: List<AgentInfo>) {
    val runningCount = agents.count { it.status == AgentStatus.RUNNING }
    val stoppedCount = agents.count { it.status == AgentStatus.STOPPED }
    val totalCount = agents.size

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            StatisticItem(
                label = "总数",
                value = totalCount.toString(),
                icon = Icons.Default.SmartToy
            )
            StatisticItem(
                label = "运行中",
                value = runningCount.toString(),
                icon = Icons.Default.PlayArrow,
                color = Color(0xFF4CAF50)
            )
            StatisticItem(
                label = "已停止",
                value = stoppedCount.toString(),
                icon = Icons.Default.Stop,
                color = Color(0xFF9E9E9E)
            )
        }
    }
}

/**
 * 统计项
 */
@Composable
fun StatisticItem(
    label: String,
    value: String,
    icon: ImageVector,
    color: Color = MaterialTheme.colorScheme.onPrimaryContainer
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(24.dp)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = color
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
        )
    }
}

/**
 * Agent 卡片
 */
@Composable
fun AgentCard(
    agent: AgentInfo,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onRestart: () -> Unit,
    enabled: Boolean
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 标题和状态
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Agent 图标
                    Surface(
                        modifier = Modifier.size(48.dp),
                        shape = CircleShape,
                        color = getAgentTypeColor(agent.type).copy(alpha = 0.15f)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = getAgentTypeIcon(agent.type),
                                contentDescription = null,
                                tint = getAgentTypeColor(agent.type),
                                modifier = Modifier.size(24.dp)
                            )
                        }
                    }

                    // 名称和描述
                    Column {
                        Text(
                            text = agent.name,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = agent.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // 状态指示器
                AgentStatusIndicator(status = agent.status)
            }

            // 最后更新时间
            val dateFormat = remember { SimpleDateFormat("HH:mm:ss", Locale.getDefault()) }
            Text(
                text = "最后更新: ${dateFormat.format(Date(agent.lastUpdated))}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            )

            Divider()

            // 控制按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // 启动按钮
                OutlinedButton(
                    onClick = onStart,
                    enabled = enabled && agent.status != AgentStatus.RUNNING,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        Icons.Default.PlayArrow,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("启动")
                }

                // 停止按钮
                OutlinedButton(
                    onClick = onStop,
                    enabled = enabled && agent.status == AgentStatus.RUNNING,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        Icons.Default.Stop,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("停止")
                }

                // 重启按钮
                OutlinedButton(
                    onClick = onRestart,
                    enabled = enabled && agent.status == AgentStatus.RUNNING,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        Icons.Default.Refresh,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("重启")
                }
            }
        }
    }
}

/**
 * Agent 状态指示器
 */
@Composable
fun AgentStatusIndicator(status: AgentStatus) {
    val (text, color) = when (status) {
        AgentStatus.RUNNING -> "运行中" to Color(0xFF4CAF50)
        AgentStatus.STOPPED -> "已停止" to Color(0xFF9E9E9E)
        AgentStatus.RESTARTING -> "重启中" to Color(0xFFFF9800)
        AgentStatus.ERROR -> "错误" to Color(0xFFF44336)
    }

    Surface(
        shape = CircleShape,
        color = color.copy(alpha = 0.15f)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(color)
            )
            Text(
                text = text,
                style = MaterialTheme.typography.labelMedium,
                color = color,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

/**
 * 获取 Agent 类型图标
 */
fun getAgentTypeIcon(type: AgentType): ImageVector {
    return when (type) {
        AgentType.CODE -> Icons.Default.Code
        AgentType.RESEARCH -> Icons.Default.Science
        AgentType.WRITING -> Icons.Default.Edit
        AgentType.DATA -> Icons.Default.Analytics
        AgentType.CUSTOM -> Icons.Default.SmartToy
    }
}

/**
 * 获取 Agent 类型颜色
 */
fun getAgentTypeColor(type: AgentType): Color {
    return when (type) {
        AgentType.CODE -> Color(0xFF2196F3)
        AgentType.RESEARCH -> Color(0xFF9C27B0)
        AgentType.WRITING -> Color(0xFFE91E63)
        AgentType.DATA -> Color(0xFF009688)
        AgentType.CUSTOM -> Color(0xFFFF9800)
    }
}
