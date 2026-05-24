package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * "看本机数据" bottom sheet — 让用户直接看 vault 里到底有没有真东西。
 *
 * 触发：SocialAdapterCard 的"看采集到的"按钮 → VM.requestVaultPreview(adapter)
 *      → 走 `cc hub query-events --adapter <name> --limit N --json` → 渲此 sheet。
 *
 * 4 个 UI 分支（与 [CitationDetailSheet] 同形）：
 *  - loading：转圈
 *  - errorMessage != null：红字错因
 *  - rows.isEmpty()：vault 真没数据（"同步成功 0 条"）
 *  - rows.isNotEmpty()：滚动列表显 id / subtype / 时间 / summary
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultPreviewSheet(
    state: HubLocalViewModel.VaultPreviewState,
    onDismiss: () -> Unit,
) {
    if (!state.open) return
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val sourceLabel = state.displayName ?: state.adapterFilter ?: "全部"
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(modifier = Modifier.padding(16.dp).fillMaxWidth()) {
            Text(
                "本机数据预览 — $sourceLabel",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "直接读 vault.db (SQLCipher 加密)，不走 AI/RAG。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            when {
                state.isLoading -> {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "查询中…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                state.errorMessage != null -> {
                    Surface(
                        color = MaterialTheme.colorScheme.errorContainer,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text(
                            "查询失败: ${state.errorMessage}",
                            modifier = Modifier.padding(12.dp),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                state.rows.isEmpty() -> {
                    Text(
                        "vault 里没有该 adapter 的事件 — sync 报告的成功可能 ingested=0",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "去本机终端跑：cc hub recent-audit --action ingest --limit 20 --json",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                else -> {
                    Text(
                        "共 ${state.rows.size} 条（最新在前）",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    state.rows.forEachIndexed { idx, row ->
                        if (idx > 0) {
                            HorizontalDivider(
                                modifier = Modifier.padding(vertical = 8.dp),
                                color = MaterialTheme.colorScheme.outlineVariant,
                            )
                        }
                        VaultPreviewRowBody(row = row)
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun VaultPreviewRowBody(row: HubLocalViewModel.VaultPreviewRow) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            row.subtype.ifEmpty { "(无 subtype)" },
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Medium,
        )
        if (row.occurredAt > 0L) {
            Text(
                isoFormatter.format(Date(row.occurredAt)),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        row.summary?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Text(
            "id: ${row.id}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private val isoFormatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
