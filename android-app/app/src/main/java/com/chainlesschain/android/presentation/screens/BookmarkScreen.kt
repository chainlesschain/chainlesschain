package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import android.content.Context
import com.chainlesschain.android.R
import com.chainlesschain.android.presentation.components.EnhancedSearchBar
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * 收藏页面
 * 参考设计稿：顶部标题+搜索+添加、标签筛选、收藏内容列表
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookmarkScreen(
    onNavigateBack: (() -> Unit)? = null
) {
    var searchQuery by remember { mutableStateOf("") }
    var selectedTag by remember { mutableStateOf<String?>(null) }
    var showSearchBar by remember { mutableStateOf(false) }
    var isManageMode by remember { mutableStateOf(false) }
    var showNewTagDialog by remember { mutableStateOf(false) }
    var newTagName by remember { mutableStateOf("") }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // 模拟标签数据
    val filterAllLabel = stringResource(R.string.bookmark_filter_all)
    val filterNoTagLabel = stringResource(R.string.bookmark_filter_no_tag)
    val tags = remember(filterAllLabel, filterNoTagLabel) {
        listOf(
            filterAllLabel,
            filterNoTagLabel,
            context.getString(R.string.bookmark_tag_work),
            context.getString(R.string.bookmark_tag_learning),
            context.getString(R.string.bookmark_tag_life),
            context.getString(R.string.bookmark_tag_tech)
        )
    }

    // 模拟收藏数据
    val tagTech = stringResource(R.string.bookmark_tag_tech)
    val tagLearning = stringResource(R.string.bookmark_tag_learning)
    val tagWork = stringResource(R.string.bookmark_tag_work)
    val bookmarks = remember(tagTech, tagLearning, tagWork) {
        listOf(
            BookmarkItem(
                id = "1",
                title = context.getString(R.string.bookmark_sample_1_title),
                description = context.getString(R.string.bookmark_sample_1_desc),
                type = BookmarkType.DOCUMENT,
                tags = listOf(tagTech, tagLearning),
                createdAt = LocalDateTime.now().minusDays(1)
            ),
            BookmarkItem(
                id = "2",
                title = context.getString(R.string.bookmark_sample_2_title),
                description = context.getString(R.string.bookmark_sample_2_desc),
                type = BookmarkType.PROJECT,
                tags = listOf(tagWork),
                createdAt = LocalDateTime.now().minusDays(2)
            ),
            BookmarkItem(
                id = "3",
                title = context.getString(R.string.bookmark_sample_3_title),
                description = context.getString(R.string.bookmark_sample_3_desc),
                type = BookmarkType.KNOWLEDGE,
                tags = listOf(tagTech),
                createdAt = LocalDateTime.now().minusDays(3)
            ),
            BookmarkItem(
                id = "4",
                title = context.getString(R.string.bookmark_sample_4_title),
                description = context.getString(R.string.bookmark_sample_4_desc),
                type = BookmarkType.AI_CHAT,
                tags = emptyList(),
                createdAt = LocalDateTime.now().minusDays(5)
            ),
            BookmarkItem(
                id = "5",
                title = context.getString(R.string.bookmark_sample_5_title),
                description = context.getString(R.string.bookmark_sample_5_desc),
                type = BookmarkType.DOCUMENT,
                tags = listOf(tagLearning, tagTech),
                createdAt = LocalDateTime.now().minusWeeks(1)
            )
        )
    }

    // 筛选收藏
    val filteredBookmarks = remember(selectedTag, searchQuery, bookmarks, filterAllLabel, filterNoTagLabel) {
        bookmarks.filter { bookmark ->
            val matchesTag = when (selectedTag) {
                null, filterAllLabel -> true
                filterNoTagLabel -> bookmark.tags.isEmpty()
                else -> bookmark.tags.contains(selectedTag)
            }
            val matchesSearch = searchQuery.isEmpty() ||
                    bookmark.title.contains(searchQuery, ignoreCase = true) ||
                    bookmark.description.contains(searchQuery, ignoreCase = true)
            matchesTag && matchesSearch
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) }
    ) { scaffoldPadding ->
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(scaffoldPadding)
            .background(MaterialTheme.colorScheme.surface)
    ) {
        // 顶部栏
        TopAppBar(
            title = { Text(stringResource(R.string.bookmark_title), fontWeight = FontWeight.Bold) },
            navigationIcon = {
                if (onNavigateBack != null) {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            },
            actions = {
                IconButton(onClick = { showSearchBar = !showSearchBar }) {
                    Icon(Icons.Default.Search, contentDescription = stringResource(R.string.common_search))
                }
                IconButton(onClick = {
                    scope.launch { snackbarHostState.showSnackbar(context.getString(R.string.common_feature_in_development)) }
                }) {
                    Icon(Icons.Default.Add, contentDescription = stringResource(R.string.bookmark_add))
                }
            }
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 搜索栏
            item {
                EnhancedSearchBar(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = stringResource(R.string.bookmark_search_hint),
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
            }

            // 标签筛选
            item {
                BookmarkTagFilter(
                    tags = tags,
                    selectedTag = selectedTag ?: filterAllLabel,
                    onTagSelected = { tag ->
                        selectedTag = if (tag == filterAllLabel) null else tag
                    },
                    onNewTagClick = { showNewTagDialog = true }
                )
            }

            // 收藏统计
            item {
                BookmarkStatsCard(
                    totalCount = bookmarks.size,
                    projectCount = bookmarks.count { it.type == BookmarkType.PROJECT },
                    documentCount = bookmarks.count { it.type == BookmarkType.DOCUMENT },
                    knowledgeCount = bookmarks.count { it.type == BookmarkType.KNOWLEDGE }
                )
            }

            // 收藏列表标题
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = stringResource(R.string.bookmark_all_count, filteredBookmarks.size),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    TextButton(onClick = { isManageMode = !isManageMode }) {
                        Text(if (isManageMode) stringResource(R.string.bookmark_manage_done) else stringResource(R.string.bookmark_manage))
                    }
                }
            }

            // 收藏列表
            if (filteredBookmarks.isEmpty()) {
                item {
                    EmptyBookmarkState()
                }
            } else {
                items(filteredBookmarks, key = { it.id }) { bookmark ->
                    BookmarkCard(
                        bookmark = bookmark,
                        onRemove = {
                            scope.launch {
                                snackbarHostState.showSnackbar(
                                    message = context.getString(R.string.bookmark_removed),
                                    actionLabel = context.getString(R.string.bookmark_undo),
                                    duration = SnackbarDuration.Short
                                )
                            }
                        },
                        onClick = {
                            scope.launch {
                                snackbarHostState.showSnackbar(context.getString(R.string.bookmark_view_details_developing))
                            }
                        }
                    )
                }
            }
        }
    }
    } // end Scaffold

    // 新建标签对话框
    if (showNewTagDialog) {
        AlertDialog(
            onDismissRequest = { showNewTagDialog = false },
            title = { Text(stringResource(R.string.bookmark_new_tag_title)) },
            text = {
                OutlinedTextField(
                    value = newTagName,
                    onValueChange = { newTagName = it },
                    label = { Text(stringResource(R.string.bookmark_tag_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (newTagName.isNotBlank()) {
                            scope.launch { snackbarHostState.showSnackbar(context.getString(R.string.bookmark_tag_created, newTagName)) }
                            newTagName = ""
                        }
                        showNewTagDialog = false
                    }
                ) { Text(stringResource(R.string.common_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = {
                    showNewTagDialog = false
                    newTagName = ""
                }) { Text(stringResource(R.string.common_cancel)) }
            }
        )
    }
}

/**
 * 标签筛选器
 */
@Composable
fun BookmarkTagFilter(
    tags: List<String>,
    selectedTag: String,
    onTagSelected: (String) -> Unit,
    onNewTagClick: () -> Unit = {}
) {
    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(tags) { tag ->
            FilterChip(
                selected = selectedTag == tag,
                onClick = { onTagSelected(tag) },
                label = { Text(tag) },
                leadingIcon = if (selectedTag == tag) {
                    { Icon(Icons.Default.Check, null, modifier = Modifier.size(18.dp)) }
                } else null
            )
        }

        // 新建标签按钮
        item {
            AssistChip(
                onClick = onNewTagClick,
                label = { Text(stringResource(R.string.bookmark_new_tag)) },
                colors = AssistChipDefaults.assistChipColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            )
        }
    }
}

/**
 * 收藏统计卡片
 */
@Composable
fun BookmarkStatsCard(
    totalCount: Int,
    projectCount: Int,
    documentCount: Int,
    knowledgeCount: Int
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceAround
        ) {
            BookmarkStatItem(
                icon = Icons.Outlined.Bookmark,
                value = totalCount.toString(),
                label = stringResource(R.string.bookmark_total)
            )
            BookmarkStatItem(
                icon = Icons.Outlined.Folder,
                value = projectCount.toString(),
                label = stringResource(R.string.bookmark_projects)
            )
            BookmarkStatItem(
                icon = Icons.Outlined.Description,
                value = documentCount.toString(),
                label = stringResource(R.string.bookmark_documents)
            )
            BookmarkStatItem(
                icon = Icons.Outlined.School,
                value = knowledgeCount.toString(),
                label = stringResource(R.string.bookmark_knowledge)
            )
        }
    }
}

/**
 * 收藏统计项
 */
@Composable
fun BookmarkStatItem(
    icon: ImageVector,
    value: String,
    label: String
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * 收藏卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookmarkCard(
    bookmark: BookmarkItem,
    onRemove: () -> Unit,
    onClick: () -> Unit
) {
    val context = LocalContext.current
    val typeInfo = bookmark.type.getTypeInfo(context)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        onClick = onClick,
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
            // 顶部行：类型标签 + 操作按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // 类型标签
                Surface(
                    color = typeInfo.color.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(6.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = typeInfo.icon,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = typeInfo.color
                        )
                        Text(
                            text = typeInfo.label,
                            style = MaterialTheme.typography.labelSmall,
                            color = typeInfo.color,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }

                // 移除收藏按钮
                IconButton(
                    onClick = onRemove,
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(
                        imageVector = Icons.Filled.Bookmark,
                        contentDescription = stringResource(R.string.bookmark_remove_cd),
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 标题
            Text(
                text = bookmark.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(modifier = Modifier.height(4.dp))

            // 描述
            Text(
                text = bookmark.description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(modifier = Modifier.height(12.dp))

            // 底部：标签 + 时间
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // 标签
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    bookmark.tags.take(2).forEach { tag ->
                        Surface(
                            color = MaterialTheme.colorScheme.secondaryContainer,
                            shape = RoundedCornerShape(4.dp)
                        ) {
                            Text(
                                text = tag,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSecondaryContainer
                            )
                        }
                    }
                    if (bookmark.tags.size > 2) {
                        Text(
                            text = "+${bookmark.tags.size - 2}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // 收藏时间
                Text(
                    text = formatBookmarkTime(context, bookmark.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * 空状态
 */
@Composable
fun EmptyBookmarkState() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = Icons.Outlined.BookmarkBorder,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.bookmark_empty_title),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.bookmark_empty_desc),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
        )
    }
}

/**
 * 格式化收藏时间
 */
fun formatBookmarkTime(context: Context, dateTime: LocalDateTime): String {
    val now = LocalDateTime.now()
    val minutes = java.time.Duration.between(dateTime, now).toMinutes()

    return when {
        minutes < 1 -> context.getString(R.string.common_just_now)
        minutes < 60 -> context.getString(R.string.common_minutes_ago, minutes.toInt())
        minutes < 1440 -> context.getString(R.string.common_hours_ago, (minutes / 60).toInt())
        minutes < 10080 -> context.getString(R.string.common_days_ago, (minutes / 1440).toInt())
        else -> dateTime.format(DateTimeFormatter.ofPattern("MM-dd"))
    }
}

/**
 * 收藏项数据类
 */
data class BookmarkItem(
    val id: String,
    val title: String,
    val description: String,
    val type: BookmarkType,
    val tags: List<String>,
    val createdAt: LocalDateTime
)

/**
 * 收藏类型
 */
enum class BookmarkType {
    PROJECT,
    DOCUMENT,
    KNOWLEDGE,
    AI_CHAT;

    fun getTypeInfo(context: Context): BookmarkTypeInfo {
        return when (this) {
            PROJECT -> BookmarkTypeInfo(context.getString(R.string.bookmark_type_project), Icons.Outlined.Folder, androidx.compose.ui.graphics.Color(0xFF4CAF50))
            DOCUMENT -> BookmarkTypeInfo(context.getString(R.string.bookmark_type_document), Icons.Outlined.Description, androidx.compose.ui.graphics.Color(0xFF2196F3))
            KNOWLEDGE -> BookmarkTypeInfo(context.getString(R.string.bookmark_type_knowledge), Icons.Outlined.School, androidx.compose.ui.graphics.Color(0xFFFF9800))
            AI_CHAT -> BookmarkTypeInfo(context.getString(R.string.bookmark_type_ai_chat), Icons.Outlined.Psychology, androidx.compose.ui.graphics.Color(0xFF9C27B0))
        }
    }
}

/**
 * 收藏类型信息
 */
data class BookmarkTypeInfo(
    val label: String,
    val icon: ImageVector,
    val color: androidx.compose.ui.graphics.Color
)
