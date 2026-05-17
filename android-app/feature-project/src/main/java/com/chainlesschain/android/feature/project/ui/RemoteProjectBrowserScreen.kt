package com.chainlesschain.android.feature.project.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.project.viewmodel.BrowserItem
import com.chainlesschain.android.feature.project.viewmodel.BrowserState
import com.chainlesschain.android.feature.project.viewmodel.RemoteProjectBrowserViewModel

/**
 * 浏览 PC 端项目列表 + 选择性拉取屏 — Sub-phase 10 (选项 C 单向 PC→Android)。
 *
 * 详见 docs/design/Android_Project_Remote_Terminal_Entry.md §6.10。
 *
 * UX:
 *   - 进入时 LaunchedEffect 触发 loadProjects(userId)
 *   - 列表 row 显 name / type chip / size / "已在本地" badge or "拉取" 按钮
 *   - tap "拉取" → 调 pullProject → 完成后 onPulled 跳详情或返回
 *   - 错误态显 banner（rate-limited / userId 不匹配 / 离线）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteProjectBrowserScreen(
    userId: String,
    onNavigateBack: () -> Unit,
    onProjectPulled: (String) -> Unit,
    viewModel: RemoteProjectBrowserViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val pullingId by viewModel.pullingId.collectAsState()

    LaunchedEffect(userId) {
        viewModel.loadProjects(userId)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("浏览 PC 项目") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { paddingValues ->
        when (val s = state) {
            is BrowserState.Idle, BrowserState.Loading -> LoadingBox(paddingValues)
            is BrowserState.Error -> ErrorBox(paddingValues, s.message, onRetry = {
                viewModel.loadProjects(userId)
            })
            is BrowserState.Loaded -> {
                if (s.items.isEmpty()) {
                    EmptyBox(paddingValues)
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(paddingValues),
                        contentPadding = PaddingValues(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(s.items, key = { it.remote.id }) { item ->
                            ProjectRow(
                                item = item,
                                isPulling = pullingId == item.remote.id,
                                onPull = {
                                    viewModel.pullProject(item.remote.id, userId, onProjectPulled)
                                },
                            )
                        }
                        if (s.hasMore) {
                            item {
                                Text(
                                    "显示前 ${s.items.size} / ${s.total} — 翻页待 v0.2",
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(16.dp),
                                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectRow(
    item: BrowserItem,
    isPulling: Boolean,
    onPull: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (item.alreadyLocal) {
                MaterialTheme.colorScheme.surfaceVariant
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Default.Folder,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(40.dp),
            )
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    item.remote.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    overflow = TextOverflow.Ellipsis,
                    maxLines = 1,
                )
                item.remote.description?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        overflow = TextOverflow.Ellipsis,
                        maxLines = 2,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    "${item.remote.type} · ${item.remote.fileCount ?: 0} 文件" +
                        (item.remote.totalSize?.let { " · ${formatSize(it)}" } ?: ""),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(12.dp))
            if (item.alreadyLocal) {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = "已在本地",
                    tint = MaterialTheme.colorScheme.primary,
                )
            } else if (isPulling) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
            } else {
                Button(onClick = onPull) {
                    Icon(Icons.Default.CloudDownload, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("拉取")
                }
            }
        }
    }
}

@Composable
private fun LoadingBox(paddingValues: PaddingValues) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(paddingValues),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator()
    }
}

@Composable
private fun EmptyBox(paddingValues: PaddingValues) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(paddingValues),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Default.Folder,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(64.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                "桌面端没有项目",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ErrorBox(paddingValues: PaddingValues, message: String, onRetry: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(paddingValues)
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Default.ErrorOutline,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(64.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
            Spacer(Modifier.height(16.dp))
            Button(onClick = onRetry) { Text("重试") }
        }
    }
}

private fun formatSize(bytes: Long): String {
    val units = arrayOf("B", "KB", "MB", "GB")
    var size = bytes.toDouble()
    var idx = 0
    while (size >= 1024 && idx < units.size - 1) {
        size /= 1024
        idx++
    }
    return String.format("%.1f %s", size, units[idx])
}
