package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
 *
 * Phase 14.3.3.b — eventId 一行变可点击，点击 → `viewModel.openEventDetail()`
 * → `personal-data-hub.event-detail` RPC → ModalBottomSheet 渲染
 * [HubEventDetailContent]（与 HubAskScreen citation sheet 同款）。Sheet loading
 * 时显示 spinner；fetch 失败显示错误文字；用户 dismiss → `closeEventDetail()`
 * 清状态。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HubAuditScreen(
    viewModel: HubAuditViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val df = remember { SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

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
                        row.eventId?.let { eid ->
                            // Phase 14.3.3.b — clickable surface for deep-link
                            // to event detail sheet. tinted to signal interactivity.
                            Text(
                                "event: ${eid.take(16)}…  ↗",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier
                                    .padding(top = 2.dp)
                                    .clickable { viewModel.openEventDetail(eid) }
                            )
                        }
                        row.context?.let { Text(it,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }

        // Phase 14.3.3.b — bottom sheet for event detail (3-state machine)
        if (state.activeEventId != null) {
            ModalBottomSheet(
                onDismissRequest = viewModel::closeEventDetail,
                sheetState = sheetState,
            ) {
                when {
                    state.isEventDetailLoading -> {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp))
                                Spacer(Modifier.size(12.dp))
                                Text("加载事件详情…", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    state.eventDetailError != null -> {
                        Column(modifier = Modifier.fillMaxWidth().padding(24.dp)) {
                            Text(
                                "无法加载事件详情",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.error,
                            )
                            Spacer(Modifier.size(6.dp))
                            Text(
                                state.eventDetailError ?: "(未知错误)",
                                style = MaterialTheme.typography.bodySmall,
                            )
                            Spacer(Modifier.size(6.dp))
                            Text(
                                "可能原因：事件已被 destroy / vault 重建后该 eventId 不存在 (per design §7 T4)",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    state.activeEventDetail != null -> {
                        HubEventDetailContent(state.activeEventDetail!!)
                    }
                }
            }
        }
    }
}
