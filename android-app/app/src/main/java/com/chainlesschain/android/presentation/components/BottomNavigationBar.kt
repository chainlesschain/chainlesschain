package com.chainlesschain.android.presentation.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * 底部导航栏组件
 *
 * 性能优化：
 * 1. 使用 @Immutable 注解标记数据类
 * 2. 使用 key 参数优化列表重组
 * 3. 避免在 onClick 中创建新 lambda
 */
@Composable
fun BottomNavigationBar(
    selectedTab: Int,
    onTabSelected: (Int) -> Unit
) {
    NavigationBar {
        bottomNavItems.forEachIndexed { index, item ->
            // 使用 key 确保 Compose 正确追踪每个 item
            key(item.label) {
                NavigationBarItem(
                    icon = {
                        Icon(
                            imageVector = if (selectedTab == index) {
                                item.selectedIcon
                            } else {
                                item.unselectedIcon
                            },
                            contentDescription = item.label
                        )
                    },
                    label = { Text(item.label) },
                    selected = selectedTab == index,
                    onClick = { onTabSelected(index) }
                )
            }
        }
    }
}

/**
 * 底部导航项数据类
 *
 * @Immutable 注解告诉 Compose 这个类是不可变的，
 * 可以跳过对它的 equals 检查，提升重组性能
 */
@Immutable
data class BottomNavItem(
    val label: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
)

/**
 * 底部导航项列表
 * 4个tab: 首页、项目、探索、收藏
 */
val bottomNavItems = listOf(
    BottomNavItem(
        label = "首页",
        selectedIcon = Icons.Filled.Home,
        unselectedIcon = Icons.Outlined.Home
    ),
    BottomNavItem(
        label = "项目",
        selectedIcon = Icons.Filled.FolderOpen,
        unselectedIcon = Icons.Outlined.FolderOpen
    ),
    BottomNavItem(
        label = "探索",
        selectedIcon = Icons.Filled.Explore,
        unselectedIcon = Icons.Outlined.Explore
    ),
    BottomNavItem(
        label = "收藏",
        selectedIcon = Icons.Filled.Bookmark,
        unselectedIcon = Icons.Outlined.BookmarkBorder
    )
)
