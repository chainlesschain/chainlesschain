package com.chainlesschain.android.remote.ui

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun DeviceListScreen(
    onNavigateToDeviceDetail: (String) -> Unit = {},
    onNavigateToDeviceScan: () -> Unit = {},
    onNavigateBack: () -> Unit = {}
) {
    Text("Device list is temporarily simplified for build stability.")
}
