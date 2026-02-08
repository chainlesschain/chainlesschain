package com.chainlesschain.android.feature.filebrowser.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.feature.filebrowser.data.scanner.MediaStoreScanner
import com.chainlesschain.android.feature.filebrowser.ui.components.FileListItem
import com.chainlesschain.android.feature.filebrowser.ui.components.FilePreviewDialog
import com.chainlesschain.android.feature.filebrowser.ui.components.FileBrowserSettingsDialog
import com.chainlesschain.android.feature.filebrowser.ui.components.FileImportDialog
import com.chainlesschain.android.feature.filebrowser.ui.components.FileStatisticsCard
import com.chainlesschain.android.feature.filebrowser.viewmodel.GlobalFileBrowserViewModel

/**
 * Global File Browser Screen
 *
 * Full-featured file browsing UI with:
 * - Permission handling
 * - MediaStore scanning with progress
 * - Category filtering with per-category counts
 * - Search and sort
 * - File statistics dashboard
 * - File import to projects
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GlobalFileBrowserScreen(
    projectId: String?,
    availableProjects: List<ProjectEntity> = emptyList(),
    onNavigateBack: () -> Unit,
    onFileImported: (String) -> Unit,
    viewModel: GlobalFileBrowserViewModel = hiltViewModel()
) {
    // State
    val permissionGranted by viewModel.permissionGranted.collectAsState()
    val scanProgress by viewModel.scanProgress.collectAsState()
    val uiState by viewModel.uiState.collectAsState()
    val files by viewModel.files.collectAsState()
    val selectedCategory by viewModel.selectedCategory.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()
    val sortBy by viewModel.sortBy.collectAsState()
    val sortDirection by viewModel.sortDirection.collectAsState()
    @Suppress("UNUSED_VARIABLE")
    val aiClassifications by viewModel.aiClassifications.collectAsState()
    val isClassifying by viewModel.isClassifying.collectAsState()
    val statistics by viewModel.statistics.collectAsState()

    var showSearchBar by remember { mutableStateOf(false) }
    var statisticsExpanded by remember { mutableStateOf(false) }
    var fileToPreview by remember { mutableStateOf<ExternalFileEntity?>(null) }
    var fileToImport by remember { mutableStateOf<ExternalFileEntity?>(null) }
    var showSettings by remember { mutableStateOf(false) }

    val context = androidx.compose.ui.platform.LocalContext.current

    // Permission launcher
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions.values.all { it }) {
            viewModel.onPermissionsGranted()
        }
    }

    // Request permissions on first launch
    LaunchedEffect(Unit) {
        if (!permissionGranted) {
            val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                arrayOf(
                    Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO,
                    Manifest.permission.READ_MEDIA_AUDIO
                )
            } else {
                arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
            permissionLauncher.launch(permissions)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (showSearchBar) {
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = { viewModel.searchFiles(it) },
                            placeholder = { Text("搜索文件...") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true
                        )
                    } else {
                        Text(text = "文件浏览器")
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回"
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { showSearchBar = !showSearchBar }) {
                        Icon(Icons.Default.Search, contentDescription = "搜索")
                    }
                    IconButton(
                        onClick = {
                            viewModel.classifyVisibleFiles(context.contentResolver)
                        },
                        enabled = !isClassifying && files.isNotEmpty()
                    ) {
                        Icon(Icons.Default.AutoAwesome, contentDescription = "AI分类")
                    }
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新")
                    }
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, contentDescription = "设置")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        },
        floatingActionButton = {
            if (permissionGranted && scanProgress !is MediaStoreScanner.ScanProgress.Scanning) {
                FloatingActionButton(
                    onClick = { viewModel.startScan() }
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = "扫描文件")
                }
            }
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Permission request UI
            if (!permissionGranted) {
                PermissionRequiredContent(
                    onRequestPermission = {
                        val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            arrayOf(
                                Manifest.permission.READ_MEDIA_IMAGES,
                                Manifest.permission.READ_MEDIA_VIDEO,
                                Manifest.permission.READ_MEDIA_AUDIO
                            )
                        } else {
                            arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
                        }
                        permissionLauncher.launch(permissions)
                    }
                )
            } else {
                // Category tabs with file counts
                CategoryTabRow(
                    selectedCategory = selectedCategory,
                    onCategorySelected = { viewModel.selectCategory(it) },
                    statistics = statistics
                )

                // Sort bar
                SortBar(
                    sortBy = sortBy,
                    sortDirection = sortDirection,
                    onSortByChange = { viewModel.setSortBy(it) },
                    onToggleSortDirection = { viewModel.toggleSortDirection() }
                )

                // Scan progress indicator
                when (val progress = scanProgress) {
                    is MediaStoreScanner.ScanProgress.Scanning -> {
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth(),
                            progress = { if (progress.total > 0) progress.current.toFloat() / progress.total else 0f }
                        )
                        Text(
                            text = "扫描中: ${progress.currentType} (${progress.current}/${progress.total})",
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                        )
                    }
                    is MediaStoreScanner.ScanProgress.Completed -> {
                        Text(
                            text = "扫描完成: ${progress.totalFiles} 个文件",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                        )
                    }
                    is MediaStoreScanner.ScanProgress.Error -> {
                        Text(
                            text = "扫描错误: ${progress.message}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                        )
                    }
                    else -> {}
                }

                // File statistics card
                statistics?.let { stats ->
                    FileStatisticsCard(
                        statistics = stats,
                        isExpanded = statisticsExpanded,
                        onToggleExpanded = { statisticsExpanded = !statisticsExpanded }
                    )
                }

                // AI Classification progress indicator
                if (isClassifying) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp
                        )
                        Text(
                            text = "AI 分类中...",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }

                // File list
                when (uiState) {
                    is GlobalFileBrowserViewModel.FileBrowserUiState.Loading -> {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator()
                        }
                    }

                    is GlobalFileBrowserViewModel.FileBrowserUiState.Empty -> {
                        EmptyStateContent()
                    }

                    is GlobalFileBrowserViewModel.FileBrowserUiState.Error -> {
                        ErrorStateContent(
                            message = (uiState as GlobalFileBrowserViewModel.FileBrowserUiState.Error).message,
                            onRetry = { viewModel.refresh() }
                        )
                    }

                    is GlobalFileBrowserViewModel.FileBrowserUiState.Success -> {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(vertical = 8.dp)
                        ) {
                            items(files, key = { it.id }) { file ->
                                FileListItem(
                                    file = file,
                                    onFileClick = { fileToPreview = file },
                                    onImportClick = {
                                        if (projectId != null) {
                                            viewModel.importFile(file.id, projectId)
                                            onFileImported(file.id)
                                        } else {
                                            fileToImport = file
                                        }
                                    },
                                    onFavoriteClick = { viewModel.toggleFavorite(file.id) },
                                    showImportButton = true,
                                    thumbnailCache = viewModel.thumbnailCache
                                )
                                HorizontalDivider()
                            }
                        }
                    }
                }
            }
        }
    }

    // File preview dialog
    fileToPreview?.let { file ->
        FilePreviewDialog(
            file = file,
            onDismiss = { fileToPreview = null },
            textRecognizer = viewModel.textRecognizer,
            fileSummarizer = viewModel.fileSummarizer
        )
    }

    // Settings dialog
    if (showSettings) {
        FileBrowserSettingsDialog(
            onDismiss = { showSettings = false },
            onClearCache = {
                viewModel.clearCache()
            }
        )
    }

    // File import dialog
    fileToImport?.let { file ->
        FileImportDialog(
            file = file,
            projectId = projectId,
            availableProjects = availableProjects,
            onDismiss = { fileToImport = null },
            onImport = { selectedProjectId ->
                viewModel.importFile(file.id, selectedProjectId)
                onFileImported(file.id)
                fileToImport = null
            }
        )
    }
}

/**
 * Category Tab Row with optional file counts
 */
@Composable
private fun CategoryTabRow(
    selectedCategory: FileCategory?,
    onCategorySelected: (FileCategory?) -> Unit,
    statistics: GlobalFileBrowserViewModel.FileBrowserStatistics? = null
) {
    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            val totalLabel = if (statistics != null) "全部 (${statistics.totalFiles})" else "全部"
            FilterChip(
                selected = selectedCategory == null,
                onClick = { onCategorySelected(null) },
                label = { Text(totalLabel) }
            )
        }

        items(FileCategory.values()) { category ->
            val categoryCount = statistics?.categories
                ?.find { it.category == category.name }?.count
            val displayName = when (category) {
                FileCategory.DOCUMENT -> "文档"
                FileCategory.IMAGE -> "图片"
                FileCategory.VIDEO -> "视频"
                FileCategory.AUDIO -> "音频"
                FileCategory.ARCHIVE -> "压缩包"
                FileCategory.CODE -> "代码"
                FileCategory.OTHER -> "其他"
            }
            val label = if (categoryCount != null && categoryCount > 0) {
                "$displayName ($categoryCount)"
            } else {
                displayName
            }
            FilterChip(
                selected = selectedCategory == category,
                onClick = { onCategorySelected(category) },
                label = { Text(label) }
            )
        }
    }
}

/**
 * Sort Bar
 */
@Composable
private fun SortBar(
    sortBy: GlobalFileBrowserViewModel.SortBy,
    sortDirection: GlobalFileBrowserViewModel.SortDirection,
    onSortByChange: (GlobalFileBrowserViewModel.SortBy) -> Unit,
    onToggleSortDirection: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GlobalFileBrowserViewModel.SortBy.values().forEach { sort ->
                FilterChip(
                    selected = sortBy == sort,
                    onClick = { onSortByChange(sort) },
                    label = {
                        Text(
                            when (sort) {
                                GlobalFileBrowserViewModel.SortBy.NAME -> "名称"
                                GlobalFileBrowserViewModel.SortBy.SIZE -> "大小"
                                GlobalFileBrowserViewModel.SortBy.DATE -> "日期"
                                GlobalFileBrowserViewModel.SortBy.TYPE -> "类型"
                            }
                        )
                    }
                )
            }
        }

        TextButton(onClick = onToggleSortDirection) {
            Text(if (sortDirection == GlobalFileBrowserViewModel.SortDirection.ASC) "↑ 升序" else "↓ 降序")
        }
    }
}

/**
 * Permission Required Content
 */
@Composable
private fun PermissionRequiredContent(onRequestPermission: () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(24.dp)
        ) {
            Text(
                text = "需要存储权限",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onSurface
            )

            Text(
                text = "文件浏览器需要访问您的设备存储以扫描和显示文件。",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 16.dp)
            )

            Button(
                onClick = onRequestPermission,
                modifier = Modifier.padding(top = 24.dp)
            ) {
                Text("授予权限")
            }
        }
    }
}

/**
 * Empty State Content
 */
@Composable
private fun EmptyStateContent() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(24.dp)
        ) {
            Text(
                text = "未找到文件",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onSurface
            )

            Text(
                text = "点击右下角的按钮开始扫描文件",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 16.dp)
            )
        }
    }
}

/**
 * Error State Content
 */
@Composable
private fun ErrorStateContent(message: String, onRetry: () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(24.dp)
        ) {
            Text(
                text = "加载失败",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.error
            )

            Text(
                text = message,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 16.dp)
            )

            Button(
                onClick = onRetry,
                modifier = Modifier.padding(top = 24.dp)
            ) {
                Text("重试")
            }
        }
    }
}
