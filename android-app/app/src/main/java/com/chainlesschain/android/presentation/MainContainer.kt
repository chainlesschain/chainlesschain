package com.chainlesschain.android.presentation

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel
import com.chainlesschain.android.presentation.components.BottomNavigationBar
import com.chainlesschain.android.presentation.screens.*

/**
 * 主容器，包含底部导航栏和各个页面
 * 4个tab: 首页、项目、探索、收藏
 *
 * 性能优化：
 * 1. 使用 rememberSaveable 保存 Tab 状态（进程终止后恢复）
 * 2. 使用 key 参数优化 when 分支重组
 * 3. 提取回调函数避免重复创建 lambda
 */
@Composable
fun MainContainer(
    onLogout: () -> Unit,
    onNavigateToProjectDetail: (String) -> Unit = {},
    viewModel: AuthViewModel = hiltViewModel()
) {
    // 使用 rememberSaveable 保存状态（进程重建后恢复）
    var selectedTab by rememberSaveable { mutableStateOf(0) }
    var showProfileDialog by rememberSaveable { mutableStateOf(false) }

    // 提取回调函数，避免重复创建 lambda（减少重组）
    val onProfileClick = remember {
        { showProfileDialog = true }
    }

    val onDismissDialog = remember {
        { showProfileDialog = false }
    }

    val onLogoutClick = remember(onLogout) {
        {
            showProfileDialog = false
            onLogout()
        }
    }

    Scaffold(
        bottomBar = {
            BottomNavigationBar(
                selectedTab = selectedTab,
                onTabSelected = { selectedTab = it }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 使用 key 优化重组，确保正确的 Composable 对应正确的 Tab
            when (selectedTab) {
                0 -> key("home") {
                    NewHomeScreen(
                        viewModel = viewModel,
                        onProfileClick = onProfileClick
                    )
                }
                1 -> key("project") {
                    ProjectScreen(
                        onProjectClick = onNavigateToProjectDetail
                    )
                }
                2 -> key("explore") {
                    ExploreScreen()
                }
                3 -> key("bookmark") {
                    BookmarkScreen()
                }
            }
        }
    }

    // 个人资料弹窗
    if (showProfileDialog) {
        ProfileDialog(
            onDismiss = onDismissDialog,
            onLogout = onLogoutClick,
            viewModel = viewModel
        )
    }
}
