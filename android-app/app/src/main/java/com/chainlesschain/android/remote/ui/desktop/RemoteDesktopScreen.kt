package com.chainlesschain.android.remote.ui.desktop

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.hilt.navigation.compose.hiltViewModel

@Composable
fun RemoteDesktopScreen(
    deviceDid: String,
    onNavigateBack: () -> Unit,
    viewModel: RemoteDesktopViewModel = hiltViewModel()
) {
    Text("Remote desktop is temporarily simplified for build stability.")
}
