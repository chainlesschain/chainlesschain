package com.chainlesschain.android.remote.ui.system

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.hilt.navigation.compose.hiltViewModel

@Composable
fun SystemMonitorScreen(
    viewModel: SystemMonitorViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    Text("System monitor is temporarily simplified for build stability.")
}
