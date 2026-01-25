package com.chainlesschain.android.presentation

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel
import com.chainlesschain.android.presentation.components.BottomNavigationBar
import com.chainlesschain.android.presentation.screens.*

/**
 * 主容器，包含底部导航栏和各个页面
 * 4个tab: 首页、项目、探索、个人中心
 */
@Composable
fun MainContainer(
    onLogout: () -> Unit,
    onNavigateToProjectDetail: (String) -> Unit = {},
    onNavigateToLLMSettings: () -> Unit = {},
    onNavigateToLLMTest: () -> Unit = {},
    onNavigateToFileBrowser: () -> Unit = {},
    viewModel: AuthViewModel = hiltViewModel()
) {
    var selectedTab by remember { mutableStateOf(0) }
    var showProfileDialog by remember { mutableStateOf(false) }

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
            when (selectedTab) {
                0 -> NewHomeScreen(
                    viewModel = viewModel,
                    onProfileClick = { showProfileDialog = true },
                    onNavigateToFileBrowser = onNavigateToFileBrowser
                )
                1 -> ProjectScreen(
                    onProjectClick = onNavigateToProjectDetail,
                    onNavigateToFileBrowser = onNavigateToFileBrowser,
                    authViewModel = viewModel  // 传递共享的AuthViewModel实例
                )
                2 -> ExploreScreen()
                3 -> ProfileScreen(
                    onLogout = onLogout,
                    onNavigateToLLMSettings = onNavigateToLLMSettings,
                    viewModel = viewModel
                )
            }
        }
    }

    // 个人资料弹窗（从首页头像点击打开）
    if (showProfileDialog) {
        ProfileDialog(
            onDismiss = { showProfileDialog = false },
            onLogout = {
                showProfileDialog = false
                onLogout()
            },
            onNavigateToLLMSettings = {
                showProfileDialog = false
                onNavigateToLLMSettings()
            },
            onNavigateToLLMTest = {
                showProfileDialog = false
                onNavigateToLLMTest()
            },
            viewModel = viewModel
        )
    }
}
