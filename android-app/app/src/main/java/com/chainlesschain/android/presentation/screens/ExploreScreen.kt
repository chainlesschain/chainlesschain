package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.annotation.StringRes
import com.chainlesschain.android.R
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch
import kotlin.random.Random

/**
 * 探索页面（社交内容流）
 * 参考设计稿：分类标签、瀑布流卡片、社交交互
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExploreScreen() {
    var selectedCategory by remember { mutableStateOf(ExploreContentCategory.ALL) }
    var showSearchBar by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // 模拟探索内容数据
    val exploreContents = remember {
        listOf(
            ExploreContent(
                id = "1",
                title = context.getString(R.string.explore_sample_1_title),
                description = context.getString(R.string.explore_sample_1_desc),
                category = ExploreContentCategory.CREATIVE_DESIGN,
                imageUrl = null,
                viewCount = 2345,
                likeCount = 189,
                author = context.getString(R.string.explore_sample_1_author),
                height = 200
            ),
            ExploreContent(
                id = "2",
                title = context.getString(R.string.explore_sample_2_title),
                description = context.getString(R.string.explore_sample_2_desc),
                category = ExploreContentCategory.FINANCE,
                viewCount = 5678,
                likeCount = 432,
                author = context.getString(R.string.explore_sample_2_author),
                height = 160
            ),
            ExploreContent(
                id = "3",
                title = context.getString(R.string.explore_sample_3_title),
                description = context.getString(R.string.explore_sample_3_desc),
                category = ExploreContentCategory.PHOTOGRAPHY,
                imageUrl = null,
                viewCount = 1234,
                likeCount = 98,
                author = context.getString(R.string.explore_sample_3_author),
                height = 220
            ),
            ExploreContent(
                id = "4",
                title = context.getString(R.string.explore_sample_4_title),
                description = context.getString(R.string.explore_sample_4_desc),
                category = ExploreContentCategory.EDUCATION,
                viewCount = 8901,
                likeCount = 756,
                author = context.getString(R.string.explore_sample_4_author),
                height = 150
            ),
            ExploreContent(
                id = "5",
                title = context.getString(R.string.explore_sample_5_title),
                description = context.getString(R.string.explore_sample_5_desc),
                category = ExploreContentCategory.LIFESTYLE,
                imageUrl = null,
                viewCount = 3456,
                likeCount = 234,
                author = context.getString(R.string.explore_sample_5_author),
                height = 180
            ),
            ExploreContent(
                id = "6",
                title = context.getString(R.string.explore_sample_6_title),
                description = context.getString(R.string.explore_sample_6_desc),
                category = ExploreContentCategory.CREATIVE_DESIGN,
                viewCount = 4567,
                likeCount = 321,
                author = context.getString(R.string.explore_sample_6_author),
                height = 170
            ),
            ExploreContent(
                id = "7",
                title = context.getString(R.string.explore_sample_7_title),
                description = context.getString(R.string.explore_sample_7_desc),
                category = ExploreContentCategory.EDUCATION,
                viewCount = 6789,
                likeCount = 543,
                author = context.getString(R.string.explore_sample_7_author),
                height = 190
            ),
            ExploreContent(
                id = "8",
                title = context.getString(R.string.explore_sample_8_title),
                description = context.getString(R.string.explore_sample_8_desc),
                category = ExploreContentCategory.PHOTOGRAPHY,
                imageUrl = null,
                viewCount = 2345,
                likeCount = 187,
                author = context.getString(R.string.explore_sample_8_author),
                height = 210
            )
        )
    }

    // 筛选内容
    val filteredContents = remember(selectedCategory, exploreContents) {
        if (selectedCategory == ExploreContentCategory.ALL) {
            exploreContents
        } else {
            exploreContents.filter { it.category == selectedCategory }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) }
    ) { scaffoldPadding ->
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(scaffoldPadding)
            .background(MaterialTheme.colorScheme.background)
    ) {
        // 顶部栏
        TopAppBar(
            title = { Text(stringResource(R.string.explore_title), fontWeight = FontWeight.Bold) },
            actions = {
                IconButton(onClick = { showSearchBar = !showSearchBar }) {
                    Icon(Icons.Default.Search, contentDescription = stringResource(R.string.common_search))
                }
                IconButton(onClick = {
                    scope.launch { snackbarHostState.showSnackbar(context.getString(R.string.common_feature_in_development)) }
                }) {
                    Icon(Icons.Default.Add, contentDescription = stringResource(R.string.common_share))
                }
            }
        )

        // 分类标签
        ExploreCategoryTabs(
            selectedCategory = selectedCategory,
            onCategorySelected = { selectedCategory = it }
        )

        // 瀑布流内容
        LazyVerticalStaggeredGrid(
            columns = StaggeredGridCells.Fixed(2),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalItemSpacing = 12.dp
        ) {
            items(filteredContents, key = { it.id }) { content ->
                ExploreContentCard(
                    content = content,
                    onClick = {
                        scope.launch { snackbarHostState.showSnackbar(context.getString(R.string.common_feature_in_development)) }
                    },
                    onLike = { },
                    onBookmark = { }
                )
            }
        }
    }
    } // end Scaffold
}

/**
 * 探索分类标签栏
 */
@Composable
fun ExploreCategoryTabs(
    selectedCategory: ExploreContentCategory,
    onCategorySelected: (ExploreContentCategory) -> Unit
) {
    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(ExploreContentCategory.entries) { category ->
            ExploreCategoryChip(
                category = category,
                selected = selectedCategory == category,
                onClick = { onCategorySelected(category) }
            )
        }
    }
}

/**
 * 分类芯片
 */
@Composable
fun ExploreCategoryChip(
    category: ExploreContentCategory,
    selected: Boolean,
    onClick: () -> Unit
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = {
            Text(
                text = stringResource(category.labelResId),
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
            )
        },
        leadingIcon = if (selected) {
            {
                Icon(
                    imageVector = category.icon,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
            }
        } else null,
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
            selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer
        )
    )
}

/**
 * 探索内容卡片（瀑布流样式）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExploreContentCard(
    content: ExploreContent,
    onClick: () -> Unit,
    onLike: () -> Unit,
    onBookmark: () -> Unit
) {
    var isLiked by remember { mutableStateOf(false) }
    var isBookmarked by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val likeScale = remember { Animatable(1f) }
    val likeTint by animateColorAsState(
        targetValue = if (isLiked) Color(0xFFE91E63) else MaterialTheme.colorScheme.onSurfaceVariant,
        animationSpec = spring(stiffness = Spring.StiffnessLow),
        label = "likeTint"
    )

    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column {
            // 图片区域（如果有）
            if (content.imageUrl != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(content.height.dp)
                ) {
                    AsyncImage(
                        model = ImageRequest.Builder(LocalContext.current)
                            .data(content.imageUrl)
                            .crossfade(true)
                            .build(),
                        contentDescription = content.title,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                        placeholder = ColorPainter(MaterialTheme.colorScheme.surfaceVariant),
                        error = ColorPainter(MaterialTheme.colorScheme.errorContainer)
                    )

                    // 渐变遮罩
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(
                                Brush.verticalGradient(
                                    colors = listOf(
                                        Color.Transparent,
                                        Color.Black.copy(alpha = 0.3f)
                                    ),
                                    startY = 0.5f * content.height
                                )
                            )
                    )

                    // 分类标签
                    Surface(
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(8.dp),
                        color = content.category.color.copy(alpha = 0.9f),
                        shape = RoundedCornerShape(6.dp)
                    ) {
                        Text(
                            text = stringResource(content.category.labelResId),
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            } else {
                // 无图片时显示颜色占位
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height((content.height * 0.6f).dp)
                        .background(
                            Brush.linearGradient(
                                colors = listOf(
                                    content.category.color.copy(alpha = 0.3f),
                                    content.category.color.copy(alpha = 0.1f)
                                )
                            )
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = content.category.icon,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = content.category.color.copy(alpha = 0.5f)
                    )

                    // 分类标签
                    Surface(
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(8.dp),
                        color = content.category.color.copy(alpha = 0.9f),
                        shape = RoundedCornerShape(6.dp)
                    ) {
                        Text(
                            text = stringResource(content.category.labelResId),
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }

            // 内容区域
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // 标题
                Text(
                    text = content.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                // 描述
                Text(
                    text = content.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                // 底部信息栏
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // 作者
                    Text(
                        text = content.author,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    // 互动按钮
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // 浏览数
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Visibility,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = formatExploreCount(content.viewCount),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        // 点赞（带弹跳动画）
                        IconButton(
                            onClick = {
                                isLiked = !isLiked
                                onLike()
                                scope.launch {
                                    likeScale.animateTo(
                                        1.3f,
                                        animationSpec = spring(
                                            dampingRatio = Spring.DampingRatioMediumBouncy,
                                            stiffness = Spring.StiffnessLow
                                        )
                                    )
                                    likeScale.animateTo(
                                        1f,
                                        animationSpec = spring(
                                            dampingRatio = Spring.DampingRatioMediumBouncy,
                                            stiffness = Spring.StiffnessLow
                                        )
                                    )
                                }
                            },
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(
                                imageVector = if (isLiked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                                contentDescription = stringResource(R.string.explore_like),
                                modifier = Modifier
                                    .size(16.dp)
                                    .scale(likeScale.value),
                                tint = likeTint
                            )
                        }

                        // 收藏
                        IconButton(
                            onClick = {
                                isBookmarked = !isBookmarked
                                onBookmark()
                            },
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(
                                imageVector = if (isBookmarked) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                                contentDescription = stringResource(R.string.explore_bookmark),
                                modifier = Modifier.size(16.dp),
                                tint = if (isBookmarked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * 格式化数字显示
 */
fun formatExploreCount(count: Int): String {
    return when {
        count < 1000 -> count.toString()
        count < 10000 -> "${count / 1000}.${(count % 1000) / 100}k"
        count < 1000000 -> "${count / 1000}k"
        else -> "${count / 1000000}.${(count % 1000000) / 100000}M"
    }
}

/**
 * 探索内容数据类
 */
data class ExploreContent(
    val id: String,
    val title: String,
    val description: String,
    val category: ExploreContentCategory,
    val imageUrl: String? = null,
    val viewCount: Int = 0,
    val likeCount: Int = 0,
    val author: String = "",
    val createdAt: LocalDateTime = LocalDateTime.now(),
    val height: Int = 180 // 用于瀑布流不同高度
)

/**
 * 探索内容分类
 */
enum class ExploreContentCategory(
    @StringRes val labelResId: Int,
    val icon: ImageVector,
    val color: Color
) {
    ALL(R.string.explore_cat_all, Icons.Outlined.Explore, Color(0xFF2196F3)),
    PHOTOGRAPHY(R.string.explore_cat_photography, Icons.Outlined.CameraAlt, Color(0xFFE91E63)),
    EDUCATION(R.string.explore_cat_education, Icons.Outlined.School, Color(0xFF4CAF50)),
    FINANCE(R.string.explore_cat_finance, Icons.Outlined.TrendingUp, Color(0xFFFF9800)),
    CREATIVE_DESIGN(R.string.explore_cat_creative_design, Icons.Outlined.Palette, Color(0xFF9C27B0)),
    LIFESTYLE(R.string.explore_cat_lifestyle, Icons.Outlined.Celebration, Color(0xFF00BCD4))
}
