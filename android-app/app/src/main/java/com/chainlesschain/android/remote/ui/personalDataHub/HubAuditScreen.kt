package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val FILTERS = listOf(
    null to "全部",
    "ingest" to "ingest",
    "ask" to "ask",
    "sync" to "sync",
    "register" to "register",
    "unregister" to "unregister"
)

/**
 * Phase 14.1 — Hub 审计日志屏
 *
 * `recentAudit` 反查最近 N 条审计 row，按 action filter chip 切换。每行显示
 * timestamp / action / adapter / eventId（短）/ actor / context。
 */
@Composable
fun HubAuditScreen(
    viewModel: HubAuditViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val df = remember { SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()) }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "审计日志 (${state.rows.size})",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                OutlinedButton(
                    onClick = { viewModel.reload() },
                    enabled = !state.isLoading
                ) { Text("刷新") }
            }
            Spacer(Modifier.size(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                FILTERS.forEach { (action, label) ->
                    FilterChip(
                        selected = state.actionFilter == action,
                        onClick = { viewModel.setActionFilter(action) },
                        label = { Text(label) }
                    )
                }
            }
            Spacer(Modifier.size(8.dp))

            state.errorMessage?.let { err ->
                Text(err, color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.size(6.dp))
            }

            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(state.rows, key = { it.at.toString() + (it.eventId ?: it.action) }) { row ->
                    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(row.action, fontWeight = FontWeight.SemiBold,
                                style = MaterialTheme.typography.bodySmall)
                            Spacer(Modifier.size(6.dp))
                            Text(df.format(Date(row.at)),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        row.adapter?.let { Text("adapter: $it",
                            style = MaterialTheme.typography.labelSmall) }
                        row.eventId?.let { Text("event: ${it.take(16)}…",
                            style = MaterialTheme.typography.labelSmall) }
                        row.context?.let { Text(it,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }
    }
}
