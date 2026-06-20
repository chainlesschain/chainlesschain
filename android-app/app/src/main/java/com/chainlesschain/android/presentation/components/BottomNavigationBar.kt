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
 * 底部导航 tab 的稳定标识。
 *
 * 用 enum 而非裸 Int 索引: 家庭 / AI 陪学 tab 现按本机角色动态显隐 (B 方案),
 * 显隐后列表长度变化, 裸索引会错位 (家庭 hidden 时原 index 4 的"个人中心"会塌到 3)。
 * 以 key 驱动选中态 + 内容路由, 对角色变化引起的列表增删免疫。
 */
enum class BottomTab { HOME, PROJECT, SOCIAL, FAMILY, PROFILE }

/**
 * 底部导航栏组件
 *
 * 性能优化：
 * 1. 使用 @Immutable 注解标记数据类
 * 2. 以 BottomTab key 渲染, 避免裸索引随显隐错位
 * 3. 避免在 onClick 中创建新 lambda
 */
@Composable
fun BottomNavigationBar(
    items: List<BottomNavItem>,
    selectedTab: BottomTab,
    onTabSelected: (BottomTab) -> Unit,
    socialUnreadCount: Int = 0
) {
    NavigationBar {
        items.forEach { item ->
            val label = stringResource(item.labelResId)
            val showBadge = item.tab == BottomTab.SOCIAL && socialUnreadCount > 0
            val unreadDesc =
                if (showBadge) stringResource(R.string.nav_unread_notifications, socialUnreadCount) else ""
            NavigationBarItem(
                icon = {
                    if (showBadge) {
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
                                imageVector = if (selectedTab == item.tab) item.selectedIcon else item.unselectedIcon,
                                contentDescription = label
                            )
                        }
                    } else {
                        Icon(
                            imageVector = if (selectedTab == item.tab) item.selectedIcon else item.unselectedIcon,
                            contentDescription = label
                        )
                    }
                },
                label = { Text(label) },
                selected = selectedTab == item.tab,
                onClick = { onTabSelected(item.tab) }
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
    val tab: BottomTab,
    @StringRes val labelResId: Int,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
)

/**
 * 全部底部导航项 (含家庭). 5 个 tab: 首页、项目、社交、家庭 (FAMILY-06)、个人中心。
 *
 * 家庭 tab 入口指向 :feature-family-guard FamilyShellScreen (标题 "AI 陪学"),
 * 内部展示家人 / AI 陪学 / 任务 / 积分 / 错题本 等 sub-section。
 *
 * 家庭 tab 是否出现在导航栏由 [com.chainlesschain.android.presentation.MainContainer]
 * 按本机角色 (RoleLockState: PARENT/CHILD 才显, Unselected 隐) + 一次性 force-show
 * 动态过滤; 未选角色时通过首页「更多功能」的「AI 陪学」入口进入并完成角色设置。
 */
val allBottomNavItems = listOf(
    BottomNavItem(
        tab = BottomTab.HOME,
        labelResId = R.string.nav_home,
        selectedIcon = Icons.Filled.Home,
        unselectedIcon = Icons.Outlined.Home
    ),
    // module 101 Phase 2: 把「项目」slot 换成「个人助手」(PDH 单输入框 Chat)
    BottomNavItem(
        tab = BottomTab.PROJECT,
        labelResId = R.string.nav_pdh_assistant,
        selectedIcon = Icons.Filled.AutoAwesome,
        unselectedIcon = Icons.Outlined.AutoAwesome
    ),
    BottomNavItem(
        tab = BottomTab.SOCIAL,
        labelResId = R.string.nav_social,
        selectedIcon = Icons.Filled.People,
        unselectedIcon = Icons.Outlined.People
    ),
    // FAMILY-06: 家庭 tab. Filled.FamilyRestroom 是合规且语义明确的家庭图标
    // (vs Groups 偏 "群组"); SafetyCheck 备用语义为 "守护"。
    BottomNavItem(
        tab = BottomTab.FAMILY,
        labelResId = R.string.nav_family_guard,
        selectedIcon = Icons.Filled.FamilyRestroom,
        unselectedIcon = Icons.Outlined.FamilyRestroom
    ),
    BottomNavItem(
        tab = BottomTab.PROFILE,
        labelResId = R.string.nav_profile,
        selectedIcon = Icons.Filled.Person,
        unselectedIcon = Icons.Outlined.PersonOutline
    )
)
