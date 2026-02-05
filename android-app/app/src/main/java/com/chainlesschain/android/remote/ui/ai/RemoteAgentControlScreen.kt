package com.chainlesschain.android.remote.ui.ai

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.hilt.navigation.compose.hiltViewModel

@Composable
fun RemoteAgentControlScreen(
    viewModel: RemoteAgentControlViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    Text("Remote agent control is temporarily simplified for build stability.")
}
