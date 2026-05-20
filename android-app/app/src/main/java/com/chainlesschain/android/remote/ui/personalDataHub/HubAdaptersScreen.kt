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
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Phase 14.1 — Hub Adapter 管理屏
 *
 * - 列出所有注册 Adapter (listAdapters)
 * - 每行显示 name / version / sensitivity / capabilities
 * - 「同步」按钮触发 syncAdapter (Mutating — 默认无 ApprovalUI)
 * - 「刷新」按钮重新拉列表
 */
@Composable
fun HubAdaptersScreen(
    viewModel: HubAdaptersViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "已注册 Adapter (${state.adapters.size})",
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

            if (state.isLoading) {
                CircularProgressIndicator(modifier = Modifier.size(28.dp))
            }
            state.errorMessage?.let { err ->
                Text(err, color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.size(6.dp))
            }

            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(state.adapters, key = { it.name }) { adapter ->
                    AdapterRow(
                        name = adapter.name,
                        version = adapter.version,
                        sensitivity = adapter.sensitivity,
                        capabilities = adapter.capabilities,
                        isSyncing = state.syncingAdapter == adapter.name,
                        onSync = { viewModel.sync(adapter.name) }
                    )
                }
            }
        }
    }
}

@Composable
private fun AdapterRow(
    name: String,
    version: String,
    sensitivity: String?,
    capabilities: List<String>,
    isSyncing: Boolean,
    onSync: () -> Unit
) {
    Card(colors = CardDefaults.cardColors()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(name, fontWeight = FontWeight.SemiBold)
                    sensitivity?.let { s ->
                        Spacer(Modifier.size(6.dp))
                        Text("[$s]", style = MaterialTheme.typography.labelSmall,
                            color = when (s) {
                                "high", "critical" -> MaterialTheme.colorScheme.error
                                "medium" -> MaterialTheme.colorScheme.tertiary
                                else -> MaterialTheme.colorScheme.onSurfaceVariant
                            })
                    }
                }
                Text("v$version", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (capabilities.isNotEmpty()) {
                    Text(capabilities.joinToString(" · "),
                        style = MaterialTheme.typography.labelSmall)
                }
            }
            Button(onClick = onSync, enabled = !isSyncing) {
                Text(if (isSyncing) "同步中…" else "同步")
            }
        }
    }
}
