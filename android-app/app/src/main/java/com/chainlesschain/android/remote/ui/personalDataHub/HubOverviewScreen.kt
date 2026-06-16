package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.pdh.OverviewReport

/**
 * ② 数据总览 tab — cross-app decision snapshot from analysis.overview:
 * 活跃 app / 事件类型 / 跨 app 消费 / 高频联系人。Read-only aggregate, no raw content.
 */
@Composable
fun HubOverviewScreen(
    modifier: Modifier = Modifier,
    viewModel: HubOverviewViewModel = hiltViewModel(),
    onGoCollect: (() -> Unit)? = null,
) {
    val state by viewModel.uiState.collectAsState()
    Column(modifier = modifier.fillMaxSize().padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("跨 app 数据总览", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.weight(1f))
            OutlinedButton(onClick = viewModel::load) { Text("刷新") }
        }
        Spacer(modifier = Modifier.height(8.dp))
        when {
            state.loading ->
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            state.errorMessage != null ->
                Text("加载失败：${state.errorMessage}", color = MaterialTheme.colorScheme.error)
            state.report == null || state.report!!.totalEvents == 0 ->
                Column {
                    Text("还没有数据", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        "先到「本机数据」采集一次再回来看跨 app 总览。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (onGoCollect != null) {
                        Spacer(modifier = Modifier.height(12.dp))
                        OutlinedButton(onClick = onGoCollect) { Text("去「本机数据」采集") }
                    }
                }
            else -> OverviewBody(state.report!!)
        }
    }
}

@Composable
private fun OverviewBody(r: OverviewReport) {
    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Text(
            "共 ${r.totalEvents} 条事件 · 跨 ${r.appsActive} 个 app",
            style = MaterialTheme.typography.bodyLarge,
        )
        if (r.spendTotal != 0.0) {
            Text(
                "跨 app 消费合计：${r.spendTotal} ${r.spendCurrency ?: ""}".trim(),
                color = MaterialTheme.colorScheme.primary,
            )
        }
        Section("各 app 活跃度") { kvRows(r.byApp) }
        Section("事件类型") { kvRows(r.byType) }
        if (r.topContacts.isNotEmpty()) {
            Section("高频联系人") {
                r.topContacts.take(10).forEach { c ->
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(c.name ?: c.personId, style = MaterialTheme.typography.bodyMedium)
                        Text("${c.interactions}", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Spacer(modifier = Modifier.height(14.dp))
    Text(title, style = MaterialTheme.typography.titleSmall)
    Spacer(modifier = Modifier.height(4.dp))
    content()
}

@Composable
private fun kvRows(pairs: List<Pair<String, Int>>) {
    if (pairs.isEmpty()) {
        Text("无", color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    pairs.take(12).forEach { (k, v) ->
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(k, style = MaterialTheme.typography.bodyMedium)
            Text("$v", style = MaterialTheme.typography.bodyMedium)
        }
    }
}
