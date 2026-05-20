package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
 * 三 Tab：提问 / Adapters / 审计。RemoteOperateScreen 把本屏作为第 14 tab "Hub"
 * 内嵌。每个 sub-screen 独立 ViewModel（hiltViewModel）+ 独立 reload，互不耦合。
 */
@Composable
fun PersonalDataHubScreen(
    modifier: Modifier = Modifier
) {
    var tab by remember { mutableStateOf(0) }
    val titles = listOf("提问", "Adapter", "审计")

    Column(modifier = modifier.fillMaxSize()) {
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
            else -> Text("?", color = MaterialTheme.colorScheme.error)
        }
    }
}
