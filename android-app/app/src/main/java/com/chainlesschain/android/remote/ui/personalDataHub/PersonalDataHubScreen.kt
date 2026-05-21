package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

/**
 * Phase 14.1 — 个人数据中台容器屏
 *
 * 四 Tab：提问 / Adapters / 审计 / 本机数据。前三 tab 走 PersonalDataHubCommands
 * (DC RPC 到对端桌面 hub)。第 4 tab 是 Plan A v0.1 落地——直接在 Android 端
 * 调 ContentResolver + PackageManager 写本地 vault.db，桌面离线也可用。
 * 每个 sub-screen 独立 ViewModel（hiltViewModel）+ 独立 reload，互不耦合。
 */
@Composable
fun PersonalDataHubScreen(
    modifier: Modifier = Modifier,
    initialTab: Int = 0,
) {
    var tab by remember { mutableStateOf(initialTab.coerceIn(0, 3)) }
    val titles = listOf("提问", "Adapter", "审计", "本机数据")

    // statusBarsPadding inset: PersonalDataHubScreen lives under the system
    // status bar (it has no Scaffold topBar above). Without this the tab row
    // is hidden behind the status bar text — surfaced on Xiaomi 24115RA8EC
    // real device 2026-05-21.
    Column(modifier = modifier.fillMaxSize().statusBarsPadding()) {
        TabRow(selectedTabIndex = tab) {
            titles.forEachIndexed { idx, title ->
                Tab(
                    selected = tab == idx,
                    onClick = { tab = idx },
                    text = { Text(title) }
                )
            }
        }
        when (tab) {
            0 -> HubAskScreen()
            1 -> HubAdaptersScreen()
            2 -> HubAuditScreen()
            3 -> HubLocalScreen()
            else -> Text("?", color = MaterialTheme.colorScheme.error)
        }
    }
}
