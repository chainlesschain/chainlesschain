package com.chainlesschain.android.remote.ui.personalDataHub

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Phase 14.1 + 14.3.3 — Hub Adapter 管理屏
 *
 * - 列出所有注册 Adapter (listAdapters)
 * - 每行显示 name / version / sensitivity / capabilities
 * - 「同步」按钮触发 syncAdapterStream (Phase 14.3 流式版) — Mutating，
 *   桌面端推 connecting → fetching → normalizing → done 进度事件，
 *   UI 在版本号下方显示实时进度文字
 * - 「刷新」按钮重新拉列表
 */
@Composable
fun HubAdaptersScreen(
    viewModel: HubAdaptersViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    // Path C — READ_CONTACTS runtime permission gate. The collector itself
    // gracefully degrades to empty-contacts when permission is denied (apps
    // list still works without permission), so we run the action regardless
    // of the result — the dialog is informational, not gating.
    val contactsPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _granted ->
        viewModel.collectAndIngestSystemDataAndroid()
    }

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
                    val isSyncingThis = state.syncingAdapter == adapter.name
                    AdapterRow(
                        name = adapter.name,
                        version = adapter.version,
                        sensitivity = adapter.sensitivity,
                        capabilities = adapter.capabilities,
                        isSyncing = isSyncingThis,
                        progressText = if (isSyncingThis) {
                            progressTextFor(
                                kind = state.syncProgressKind,
                                partition = state.syncProgressPartition,
                                detail = state.syncProgressDetail,
                            )
                        } else null,
                        lastIngested = state.lastReport
                            ?.takeIf { it.adapter == adapter.name }
                            ?.ingested,
                        onSync = {
                            if (adapter.name == "system-data-android") {
                                // Path C — phone-native collect → desktop ingest. Ask for
                                // READ_CONTACTS if not yet granted, then collector runs.
                                val granted = ContextCompat.checkSelfPermission(
                                    context,
                                    Manifest.permission.READ_CONTACTS,
                                ) == PackageManager.PERMISSION_GRANTED
                                if (granted) {
                                    viewModel.collectAndIngestSystemDataAndroid()
                                } else {
                                    contactsPermissionLauncher.launch(
                                        Manifest.permission.READ_CONTACTS,
                                    )
                                }
                            } else {
                                viewModel.syncStream(adapter.name)
                            }
                        }
                    )
                }
            }
        }
    }
}

/**
 * Localize a sync progress event into a 1-line UI string.
 * `null` kind = no event yet (sync just started, pre-connecting).
 * Phase 14.3.3 — matches the 4 emit kinds from desktop's runSyncStream.
 */
internal fun progressTextFor(
    kind: String?,
    partition: String?,
    detail: Map<String, Long>?,
): String {
    return when (kind) {
        null -> "同步中…"
        "connecting" -> "连接中…"
        "fetching" -> {
            val count = detail?.get("uidsScanned")
                ?: detail?.get("rowsRead")
                ?: detail?.values?.firstOrNull()
            val partText = partition?.let { " ($it)" }.orEmpty()
            "拉取中$partText" + (count?.let { " · $it 条" }.orEmpty())
        }
        "normalizing" -> {
            val built = detail?.get("eventsBuilt")
                ?: detail?.values?.firstOrNull()
            "归一化中" + (built?.let { " · $it 事件" }.orEmpty())
        }
        else -> "同步中…($kind)"
    }
}

@Composable
private fun AdapterRow(
    name: String,
    version: String,
    sensitivity: String?,
    capabilities: List<String>,
    isSyncing: Boolean,
    progressText: String?,
    lastIngested: Long?,
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
                // Phase 14.3.3 — show streaming progress while this adapter is
                // syncing; show last-sync ingested count when idle (until next
                // syncStream call clears it).
                if (isSyncing && progressText != null) {
                    Spacer(Modifier.size(4.dp))
                    Text(
                        progressText,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                } else if (!isSyncing && lastIngested != null) {
                    Spacer(Modifier.size(4.dp))
                    Text(
                        "上次 +$lastIngested 事件",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Button(onClick = onSync, enabled = !isSyncing) {
                Text(if (isSyncing) "同步中…" else "同步")
            }
        }
    }
}
