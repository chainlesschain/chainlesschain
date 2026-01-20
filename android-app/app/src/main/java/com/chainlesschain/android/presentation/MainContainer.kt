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
 */
@Composable
fun MainContainer(
    onLogout: () -> Unit,
    viewModel: AuthViewModel = hiltViewModel()
) {
    var selectedTab by remember { mutableStateOf(0) }

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
                0 -> NewHomeScreen(viewModel = viewModel)
                1 -> ExploreScreen()
                2 -> ProjectScreen()
                3 -> TaskScreen()
                4 -> ProfileScreen(onLogout = onLogout, viewModel = viewModel)
            }
        }
    }
}
