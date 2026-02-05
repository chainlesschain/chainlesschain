package com.chainlesschain.android.remote.ui

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import java.text.SimpleDateFormat
import java.util.*

/**
 * 设备列表界面
 *
 * 功能：
 * - 显示已注册的 PC 设备列表
 * - 设备状态（在线/离线/等待批准）
 * - 快速连接/断开
 * - 设备详情查看
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceListScreen(
    onNavigateToDeviceDetail: (String) -> Unit = {},
    onNavigateToDeviceScan: () -> Unit = {},
    onNavigateBack: () -> Unit = {}
) {
    var showFilterDialog by remember { mutableStateOf(false) }
    var selectedFilter by remember { mutableStateOf("all") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("我的设备") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 筛选按钮
                    IconButton(onClick = { showFilterDialog = true }) {
                        Icon(Icons.Default.FilterList, contentDescription = "筛选")
                    }

                    // 扫描新设备按钮
                    IconButton(onClick = onNavigateToDeviceScan) {
                        Icon(Icons.Default.Search, contentDescription = "扫描设备")
                    }
                }
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onNavigateToDeviceScan,
                icon = { Icon(Icons.Default.Add, contentDescription = "添加设备") },
                text = { Text("添加设备") }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 统计卡片
            DeviceStatisticsCard()

            // 设备列表
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // 示例设备数据（实际应该从 ViewModel 获取）
                val devices = listOf(
                    DeviceItem(
                        deviceId = "1",
                        deviceName = "我的台式机",
                        deviceType = "Desktop",
                        status = "online",
                        osType = "Windows",
                        lastSeen = System.currentTimeMillis()
                    ),
                    DeviceItem(
                        deviceId = "2",
                        deviceName = "办公笔记本",
                        deviceType = "Laptop",
                        status = "offline",
                        osType = "Windows",
                        lastSeen = System.currentTimeMillis() - 3600000
                    ),
                    DeviceItem(
                        deviceId = "3",
                        deviceName = "MacBook Pro",
                        deviceType = "Laptop",
                        status = "pending",
                        osType = "macOS",
                        lastSeen = System.currentTimeMillis()
                    )
                )

                items(devices) { device ->
                    DeviceListItem(
                        device = device,
                        onClick = { onNavigateToDeviceDetail(device.deviceId) }
                    )
                }
            }
        }
    }

    // 筛选对话框
    if (showFilterDialog) {
        AlertDialog(
            onDismissRequest = { showFilterDialog = false },
            title = { Text("筛选设备") },
            text = {
                Column {
                    FilterOption("全部设备", selectedFilter == "all") {
                        selectedFilter = "all"
                        showFilterDialog = false
                    }
                    FilterOption("在线设备", selectedFilter == "online") {
                        selectedFilter = "online"
                        showFilterDialog = false
                    }
                    FilterOption("离线设备", selectedFilter == "offline") {
                        selectedFilter = "offline"
                        showFilterDialog = false
                    }
                    FilterOption("等待批准", selectedFilter == "pending") {
                        selectedFilter = "pending"
                        showFilterDialog = false
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showFilterDialog = false }) {
                    Text("关闭")
                }
            }
        )
    }
}

/**
 * 设备统计卡片
 */
@Composable
fun DeviceStatisticsCard() {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
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
            StatItem(
                icon = Icons.Default.Computer,
                label = "总设备",
                value = "3",
                color = MaterialTheme.colorScheme.primary
            )

            Divider(
                modifier = Modifier
                    .height(48.dp)
                    .width(1.dp)
            )

            StatItem(
                icon = Icons.Default.CheckCircle,
                label = "在线",
                value = "1",
                color = Color(0xFF4CAF50)
            )

            Divider(
                modifier = Modifier
                    .height(48.dp)
                    .width(1.dp)
            )

            StatItem(
                icon = Icons.Default.Pending,
                label = "待批准",
                value = "1",
                color = Color(0xFFFFA726)
            )
        }
    }
}

@Composable
fun StatItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String,
    color: Color
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = color,
            modifier = Modifier.size(32.dp)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * 设备列表项
 */
@Composable
fun DeviceListItem(
    device: DeviceItem,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 设备图标
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(getStatusColor(device.status).copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = getDeviceIcon(device.deviceType),
                    contentDescription = device.deviceType,
                    tint = getStatusColor(device.status),
                    modifier = Modifier.size(28.dp)
                )
            }

            Spacer(modifier = Modifier.width(16.dp))

            // 设备信息
            Column(
                modifier = Modifier.weight(1f)
            ) {
                Text(
                    text = device.deviceName,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium
                )

                Spacer(modifier = Modifier.height(4.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = getOSIcon(device.osType),
                        contentDescription = device.osType,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = device.osType,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.width(12.dp))

                    Text(
                        text = formatLastSeen(device.lastSeen),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // 状态指示器
            StatusBadge(status = device.status)
        }
    }
}

/**
 * 状态徽章
 */
@Composable
fun StatusBadge(status: String) {
    val (text, color) = when (status) {
        "online" -> "在线" to Color(0xFF4CAF50)
        "offline" -> "离线" to Color(0xFF9E9E9E)
        "pending" -> "待批准" to Color(0xFFFFA726)
        else -> "未知" to Color(0xFF757575)
    }

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = color.copy(alpha = 0.15f)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(color)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = text,
                style = MaterialTheme.typography.labelSmall,
                color = color
            )
        }
    }
}

/**
 * 筛选选项
 */
@Composable
fun FilterOption(
    text: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(
            selected = selected,
            onClick = onClick
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(text = text)
    }
}

// 辅助函数
fun getDeviceIcon(deviceType: String) = when (deviceType) {
    "Desktop" -> Icons.Default.Computer
    "Laptop" -> Icons.Default.Laptop
    else -> Icons.Default.Devices
}

fun getOSIcon(osType: String) = when (osType) {
    "Windows" -> Icons.Default.Window
    "macOS" -> Icons.Default.Laptop // Apple icon not available in Material Icons
    "Linux" -> Icons.Default.Terminal
    else -> Icons.Default.Computer
}

fun getStatusColor(status: String) = when (status) {
    "online" -> Color(0xFF4CAF50)
    "offline" -> Color(0xFF9E9E9E)
    "pending" -> Color(0xFFFFA726)
    else -> Color(0xFF757575)
}

fun formatLastSeen(timestamp: Long): String {
    val diff = System.currentTimeMillis() - timestamp
    return when {
        diff < 60000 -> "刚刚"
        diff < 3600000 -> "${diff / 60000}分钟前"
        diff < 86400000 -> "${diff / 3600000}小时前"
        else -> "${diff / 86400000}天前"
    }
}

// 数据类
data class DeviceItem(
    val deviceId: String,
    val deviceName: String,
    val deviceType: String,
    val status: String,
    val osType: String,
    val lastSeen: Long
)
