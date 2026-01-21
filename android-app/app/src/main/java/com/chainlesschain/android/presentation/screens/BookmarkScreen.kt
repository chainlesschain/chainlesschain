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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.presentation.components.EnhancedSearchBar
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * 收藏页面
 * 参考设计稿：顶部标题+搜索+添加、标签筛选、收藏内容列表
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookmarkScreen() {
    var searchQuery by remember { mutableStateOf("") }
    var selectedTag by remember { mutableStateOf<String?>(null) }

    // 模拟标签数据
    val tags = remember {
        listOf("全部", "无标签", "工作", "学习", "生活", "技术")
    }

    // 模拟收藏数据
    val bookmarks = remember {
        listOf(
            BookmarkItem(
                id = "1",
                title = "Kotlin协程完全指南",
                description = "深入理解Kotlin协程的工作原理和最佳实践，包含大量实际案例",
                type = BookmarkType.DOCUMENT,
                tags = listOf("技术", "学习"),
                createdAt = LocalDateTime.now().minusDays(1)
            ),
            BookmarkItem(
                id = "2",
                title = "AI驱动的项目管理系统",
                description = "使用人工智能优化项目管理流程，提高团队协作效率",
                type = BookmarkType.PROJECT,
                tags = listOf("工作"),
                createdAt = LocalDateTime.now().minusDays(2)
            ),
            BookmarkItem(
                id = "3",
                title = "Android Compose最佳实践",
                description = "从入门到精通，掌握Jetpack Compose的核心概念",
                type = BookmarkType.KNOWLEDGE,
                tags = listOf("技术"),
                createdAt = LocalDateTime.now().minusDays(3)
            ),
            BookmarkItem(
                id = "4",
                title = "如何构建去中心化应用",
                description = "探索区块链技术在应用开发中的实践",
                type = BookmarkType.AI_CHAT,
                tags = emptyList(),
                createdAt = LocalDateTime.now().minusDays(5)
            ),
            BookmarkItem(
                id = "5",
                title = "2024年技术趋势分析",
                description = "全面解读今年最值得关注的技术方向",
                type = BookmarkType.DOCUMENT,
                tags = listOf("学习", "技术"),
                createdAt = LocalDateTime.now().minusWeeks(1)
            )
        )
    }

    // 筛选收藏
    val filteredBookmarks = remember(selectedTag, searchQuery, bookmarks) {
        bookmarks.filter { bookmark ->
            val matchesTag = when (selectedTag) {
                null, "全部" -> true
                "无标签" -> bookmark.tags.isEmpty()
                else -> bookmark.tags.contains(selectedTag)
            }
            val matchesSearch = searchQuery.isEmpty() ||
                    bookmark.title.contains(searchQuery, ignoreCase = true) ||
                    bookmark.description.contains(searchQuery, ignoreCase = true)
            matchesTag && matchesSearch
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        // 顶部栏
        TopAppBar(
            title = { Text("我的收藏", fontWeight = FontWeight.Bold) },
            actions = {
                IconButton(onClick = { /* TODO: 搜索 */ }) {
                    Icon(Icons.Default.Search, contentDescription = "搜索")
                }
                IconButton(onClick = { /* TODO: 添加收藏 */ }) {
                    Icon(Icons.Default.Add, contentDescription = "添加")
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
                    placeholder = "搜索收藏内容...",
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
            }

            // 标签筛选
            item {
                BookmarkTagFilter(
                    tags = tags,
                    selectedTag = selectedTag ?: "全部",
                    onTagSelected = { tag ->
                        selectedTag = if (tag == "全部") null else tag
                    }
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
                        text = "全部收藏 (${filteredBookmarks.size})",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    TextButton(onClick = { /* TODO: 管理 */ }) {
                        Text("管理")
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
                        onRemove = { /* TODO: 移除收藏 */ },
                        onClick = { /* TODO: 查看详情 */ }
                    )
                }
            }
        }
    }
}

/**
 * 标签筛选器
 */
@Composable
fun BookmarkTagFilter(
    tags: List<String>,
    selectedTag: String,
    onTagSelected: (String) -> Unit
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
                onClick = { /* TODO: 新建标签 */ },
                label = { Text("+ 新建标签") },
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
                label = "总收藏"
            )
            BookmarkStatItem(
                icon = Icons.Outlined.Folder,
                value = projectCount.toString(),
                label = "项目"
            )
            BookmarkStatItem(
                icon = Icons.Outlined.Description,
                value = documentCount.toString(),
                label = "文档"
            )
            BookmarkStatItem(
                icon = Icons.Outlined.School,
                value = knowledgeCount.toString(),
                label = "知识库"
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
    val typeInfo = bookmark.type.getTypeInfo()

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
                        contentDescription = "移除收藏",
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
                    text = formatBookmarkTime(bookmark.createdAt),
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
            text = "暂无收藏内容",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "浏览探索页面，收藏感兴趣的内容",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
        )
    }
}

/**
 * 格式化收藏时间
 */
fun formatBookmarkTime(dateTime: LocalDateTime): String {
    val now = LocalDateTime.now()
    val minutes = java.time.Duration.between(dateTime, now).toMinutes()

    return when {
        minutes < 1 -> "刚刚"
        minutes < 60 -> "${minutes}分钟前"
        minutes < 1440 -> "${minutes / 60}小时前"
        minutes < 10080 -> "${minutes / 1440}天前"
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

    fun getTypeInfo(): BookmarkTypeInfo {
        return when (this) {
            PROJECT -> BookmarkTypeInfo("项目", Icons.Outlined.Folder, androidx.compose.ui.graphics.Color(0xFF4CAF50))
            DOCUMENT -> BookmarkTypeInfo("文档", Icons.Outlined.Description, androidx.compose.ui.graphics.Color(0xFF2196F3))
            KNOWLEDGE -> BookmarkTypeInfo("知识库", Icons.Outlined.School, androidx.compose.ui.graphics.Color(0xFFFF9800))
            AI_CHAT -> BookmarkTypeInfo("AI对话", Icons.Outlined.Psychology, androidx.compose.ui.graphics.Color(0xFF9C27B0))
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
