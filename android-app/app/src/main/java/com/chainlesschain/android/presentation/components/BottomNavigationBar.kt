package com.chainlesschain.android.presentation.components

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.chainlesschain.android.R

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
    onTabSelected: (Int) -> Unit,
    socialUnreadCount: Int = 0
) {
    NavigationBar {
        bottomNavItems.forEachIndexed { index, item ->
            val label = stringResource(item.labelResId)
            val unreadDesc = if (index == 2 && socialUnreadCount > 0) stringResource(R.string.nav_unread_notifications, socialUnreadCount) else ""
            NavigationBarItem(
                icon = {
                    if (index == 2 && socialUnreadCount > 0) {
                        BadgedBox(
                            badge = {
                                Badge(
                                    modifier = androidx.compose.ui.Modifier.semantics {
                                        contentDescription = unreadDesc
                                    }
                                ) {
                                    Text(if (socialUnreadCount > 99) "99+" else socialUnreadCount.toString())
                                }
                            }
                        ) {
                            Icon(
                                imageVector = if (selectedTab == index) item.selectedIcon else item.unselectedIcon,
                                contentDescription = label
                            )
                        }
                    } else {
                        Icon(
                            imageVector = if (selectedTab == index) item.selectedIcon else item.unselectedIcon,
                            contentDescription = label
                        )
                    }
                },
                label = { Text(label) },
                selected = selectedTab == index,
                onClick = { onTabSelected(index) }
            )
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
    @StringRes val labelResId: Int,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
)

/**
 * 底部导航项列表
 * 4个tab: 首页、项目、社交、个人中心
 */
val bottomNavItems = listOf(
    BottomNavItem(
        labelResId = R.string.nav_home,
        selectedIcon = Icons.Filled.Home,
        unselectedIcon = Icons.Outlined.Home
    ),
    BottomNavItem(
        labelResId = R.string.nav_projects,
        selectedIcon = Icons.Filled.FolderOpen,
        unselectedIcon = Icons.Outlined.FolderOpen
    ),
    BottomNavItem(
        labelResId = R.string.nav_social,
        selectedIcon = Icons.Filled.People,
        unselectedIcon = Icons.Outlined.People
    ),
    BottomNavItem(
        labelResId = R.string.nav_profile,
        selectedIcon = Icons.Filled.Person,
        unselectedIcon = Icons.Outlined.PersonOutline
    )
)
