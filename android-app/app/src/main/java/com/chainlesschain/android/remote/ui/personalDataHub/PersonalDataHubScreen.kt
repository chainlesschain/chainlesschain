package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Phase 14.1 + A3.8 + Phase 16 — 个人数据中台容器屏
 *
 * 六 Tab：提问 / Adapters / 审计 / 本机数据 / 本机提问 / 数据浏览。
 *  - tab 0 提问       → HubAskScreen      → DC RPC 到对端桌面 hub（远程）
 *  - tab 1 Adapters   → HubAdaptersScreen → 同上（远程）
 *  - tab 2 审计       → HubAuditScreen    → 同上（远程）
 *  - tab 3 本机数据   → HubLocalScreen    → Plan A v0.1 in-APK cc + 本机 vault
 *  - tab 4 本机提问   → HubLocalAskScreen → A3 端侧 LLM ask flow (本机)
 *  - tab 5 数据浏览   → HubBrowserScreen  → Phase 16 vault browser (FTS5 search)
 *
 * Tab 3 与 4 共享 HubLocalViewModel 同实例（hiltViewModel scope 一致）。
 * Tab 5 用独立 HubBrowserViewModel（不需要共享态）。
 *
 * Tab index 0-4 保留不变以兼容现有 NavGraph initialTab=0/3 路由（详见
 * navigation/NavGraph.kt createRoute(initialTab) caller）。新 tab 添加在尾部
 * index 5，老 caller 无需改动。
 *
 * ScrollableTabRow 替换 TabRow：6 tab + 中文 4 字标题在 360dp 窄屏上 TabRow
 * 强分平均宽度容易挤压；scrollable 让窄屏可滑动看到全部。
 */
@Composable
fun PersonalDataHubScreen(
    modifier: Modifier = Modifier,
    initialTab: Int = 0,
    // 2026-05-24 — 首页 ChatInputBar 选「本机 RAG」路由发问 → 「查看详情」
    // 跳 PDH tab 4 时携带的预填问题；HubLocalAskScreen 监听并自动 submit。
    // 仅当 initialTab=4 时生效（其它 tab 不消费此参数）。
    askPrefill: String? = null,
) {
    var tab by remember { mutableStateOf(initialTab.coerceIn(0, 5)) }
    val titles = listOf("提问", "Adapter", "审计", "本机数据", "本机提问", "数据浏览")

    // statusBarsPadding inset: PersonalDataHubScreen lives under the system
    // status bar (it has no Scaffold topBar above). Without this the tab row
    // is hidden behind the status bar text — surfaced on Xiaomi 24115RA8EC
    // real device 2026-05-21.
    Column(modifier = modifier.fillMaxSize().statusBarsPadding()) {
        ScrollableTabRow(selectedTabIndex = tab, edgePadding = 0.dp) {
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
            4 -> HubLocalAskScreen(askPrefill = askPrefill)
            5 -> HubBrowserScreen()
            else -> Text("?", color = MaterialTheme.colorScheme.error)
        }
    }
}
