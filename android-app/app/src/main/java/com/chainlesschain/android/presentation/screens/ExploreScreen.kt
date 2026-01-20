package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.chainlesschain.android.feature.project.domain.*
import com.chainlesschain.android.presentation.components.*
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * 探索页面（重新设计）
 * 参考: iOS ExploreCardViews.swift 和现代设计规范
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExploreScreen() {
    var searchQuery by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf(ExploreCategory.ALL) }

    // 模拟数据
    val exploreItems = remember {
        listOf(
            ExploreItem(
                id = "1",
                title = "AI驱动的项目管理系统",
                description = "使用人工智能优化项目管理流程，提高团队协作效率",
                category = ExploreCategory.PROJECT,
                imageUrl = null,
                viewCount = 1234,
                likeCount = 89,
                tags = listOf("AI", "项目管理", "协作")
            ),
            ExploreItem(
                id = "2",
                title = "Kotlin协程完全指南",
                description = "深入理解Kotlin协程的工作原理和最佳实践",
                category = ExploreCategory.DOCUMENT,
                viewCount = 567,
                likeCount = 45,
                tags = listOf("Kotlin", "协程", "编程")
            ),
            ExploreItem(
                id = "3",
                title = "如何构建去中心化应用",
                description = "探索区块链技术在应用开发中的实践",
                category = ExploreCategory.AI_CHAT,
                viewCount = 890,
                likeCount = 67,
                tags = listOf("区块链", "DApp", "Web3")
            )
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        // 顶部栏
        TopAppBar(
            title = { Text("探索", fontWeight = FontWeight.Bold) },
            actions = {
                IconButton(onClick = { /* TODO: 筛选 */ }) {
                    Icon(Icons.Default.FilterList, contentDescription = "筛选")
                }
            }
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 搜索栏
            item {
                EnhancedSearchBar(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = "搜索项目、文档、对话...",
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
            }

            // 分类筛选
            item {
                CategoryFilter(
                    selectedCategory = selectedCategory,
                    onCategorySelected = { selectedCategory = it }
                )
            }

            // 热门标签
            item {
                PopularTags()
            }

            // 推荐内容标题
            item {
                Text(
                    text = "推荐内容",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
            }

            // 内容列表
            items(exploreItems.filter {
                selectedCategory == ExploreCategory.ALL || it.category == selectedCategory
            }) { item ->
                AnimatedCard(delay = 100) {
                    EnhancedExploreCard(
                        item = item,
                        onClick = { /* TODO */ }
                    )
                }
            }
        }
    }
}

/**
 * 分类筛选器
 */
@Composable
fun CategoryFilter(
    selectedCategory: ExploreCategory,
    onCategorySelected: (ExploreCategory) -> Unit
) {
    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(ExploreCategory.values()) { category ->
            FilterChip(
                selected = selectedCategory == category,
                onClick = { onCategorySelected(category) },
                label = { Text(category.displayName) },
                leadingIcon = if (selectedCategory == category) {
                    { Icon(Icons.Default.Check, null, modifier = Modifier.size(18.dp)) }
                } else null
            )
        }
    }
}

/**
 * 热门标签
 */
@Composable
fun PopularTags() {
    Column(
        modifier = Modifier.padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "热门标签",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold
        )

        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(listOf("AI", "区块链", "移动开发", "Kotlin", "Compose", "项目管理")) { tag ->
                SuggestionChip(
                    onClick = { /* TODO: 搜索标签 */ },
                    label = { Text(tag) },
                    icon = { Icon(Icons.Default.Tag, null, modifier = Modifier.size(16.dp)) }
                )
            }
        }
    }
}

/**
 * 增强的探索卡片（类似iOS的设计）
 */
@Composable
fun EnhancedExploreCard(
    item: ExploreItem,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column {
            // 图片区域（如果有）
            item.imageUrl?.let { imageUrl ->
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(180.dp)
                ) {
                    AsyncImage(
                        model = imageUrl,
                        contentDescription = item.title,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )

                    // 渐变遮罩
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(
                                Brush.verticalGradient(
                                    colors = listOf(
                                        Color.Transparent,
                                        Color.Black.copy(alpha = 0.5f)
                                    )
                                )
                            )
                    )

                    // 分类标签
                    CategoryBadge(
                        category = item.category,
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(12.dp)
                    )
                }
            }

            // 内容区域
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // 如果没有图片，显示分类标签
                if (item.imageUrl == null) {
                    CategoryBadge(category = item.category)
                }

                // 标题
                Text(
                    text = item.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                // 描述
                Text(
                    text = item.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )

                // 标签
                if (item.tags.isNotEmpty()) {
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        items(item.tags.take(3)) { tag ->
                            Tag(
                                text = tag,
                                color = MaterialTheme.colorScheme.secondaryContainer,
                                contentColor = MaterialTheme.colorScheme.onSecondaryContainer
                            )
                        }
                    }
                }

                Divider()

                // 底部信息栏
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // 统计信息
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        StatItem(
                            icon = Icons.Default.Visibility,
                            count = item.viewCount
                        )
                        StatItem(
                            icon = Icons.Default.FavoriteBorder,
                            count = item.likeCount
                        )
                    }

                    // 时间
                    Text(
                        text = formatRelativeTime(item.createdAt),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

/**
 * 分类徽章
 */
@Composable
fun CategoryBadge(
    category: ExploreCategory,
    modifier: Modifier = Modifier
) {
    val (icon, color) = when (category) {
        ExploreCategory.ALL -> Icons.Default.Apps to MaterialTheme.colorScheme.primary
        ExploreCategory.PROJECT -> Icons.Default.Folder to MaterialTheme.colorScheme.tertiary
        ExploreCategory.DOCUMENT -> Icons.Default.Description to MaterialTheme.colorScheme.secondary
        ExploreCategory.AI_CHAT -> Icons.Default.Psychology to MaterialTheme.colorScheme.primary
        ExploreCategory.KNOWLEDGE -> Icons.Default.School to Color(0xFFFFA726)
    }

    Surface(
        modifier = modifier,
        color = color.copy(alpha = 0.15f),
        shape = RoundedCornerShape(8.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = color
            )
            Text(
                text = category.displayName,
                style = MaterialTheme.typography.labelMedium,
                color = color,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

/**
 * 统计项
 */
@Composable
fun StatItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    count: Int
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = formatCount(count),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * 格式化数字
 */
fun formatCount(count: Int): String {
    return when {
        count < 1000 -> count.toString()
        count < 10000 -> "${count / 1000}.${(count % 1000) / 100}k"
        count < 1000000 -> "${count / 1000}k"
        else -> "${count / 1000000}.${(count % 1000000) / 100000}M"
    }
}

/**
 * 格式化相对时间
 */
fun formatRelativeTime(dateTime: LocalDateTime): String {
    val now = LocalDateTime.now()
    val minutes = java.time.Duration.between(dateTime, now).toMinutes()

    return when {
        minutes < 1 -> "刚刚"
        minutes < 60 -> "${minutes}分钟前"
        minutes < 1440 -> "${minutes / 60}小时前"
        minutes < 10080 -> "${minutes / 1440}天前"
        minutes < 43200 -> "${minutes / 10080}周前"
        else -> dateTime.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))
    }
}
