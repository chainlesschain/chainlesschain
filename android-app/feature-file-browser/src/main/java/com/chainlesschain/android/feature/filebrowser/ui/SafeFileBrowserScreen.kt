package com.chainlesschain.android.feature.filebrowser.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.ProjectEntity

/**
 * Safe File Browser Screen with Error Boundary
 *
 * 简单包装 GlobalFileBrowserScreen，在 ViewModel 初始化失败时显示错误 UI
 * 注意：由于 Compose 限制，无法使用 try-catch 包装 Composable
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SafeFileBrowserScreen(
    projectId: String?,
    availableProjects: List<ProjectEntity> = emptyList(),
    onNavigateBack: () -> Unit,
    onFileImported: (String) -> Unit = {}
) {
    // 使用 rememberSaveable 保存错误状态
    var initializationFailed by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    if (initializationFailed) {
        // 显示错误 UI
        ErrorFileBrowserUI(
            errorMessage = errorMessage ?: "文件浏览器初始化失败",
            onNavigateBack = onNavigateBack,
            onRetry = {
                initializationFailed = false
                errorMessage = null
            }
        )
    } else {
        // 尝试显示正常的文件浏览器
        // 如果崩溃，用户可以通过日志诊断
        GlobalFileBrowserScreen(
            projectId = projectId,
            availableProjects = availableProjects,
            onNavigateBack = onNavigateBack,
            onFileImported = onFileImported
        )
    }
}

/**
 * Error UI for File Browser
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ErrorFileBrowserUI(
    errorMessage: String,
    onNavigateBack: () -> Unit,
    onRetry: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("文件浏览器") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回"
                        )
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // 错误图标
            Icon(
                imageVector = Icons.Default.Error,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.error
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 错误标题
            Text(
                text = "文件浏览器启动失败",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.error
            )

            Spacer(modifier = Modifier.height(8.dp))

            // 错误消息
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp)
                ) {
                    Text(
                        text = "错误详情：",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onErrorContainer
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = errorMessage,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // 可能的原因
            Card(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp)
                ) {
                    Text(
                        text = "可能的原因：",
                        style = MaterialTheme.typography.titleSmall
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = """
                        • 数据库初始化失败
                        • 依赖注入配置错误
                        • 存储权限未授予
                        • AI 组件加载失败
                        • 设备存储空间不足
                        """.trimIndent(),
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // 操作按钮
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = onNavigateBack,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("返回")
                }

                Button(
                    onClick = onRetry,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("重试")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // 调试提示
            Text(
                text = "请使用以下命令收集崩溃日志：\n\nadb logcat -c\n(点击文件浏览)\nadb logcat -d > crash.log",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}
