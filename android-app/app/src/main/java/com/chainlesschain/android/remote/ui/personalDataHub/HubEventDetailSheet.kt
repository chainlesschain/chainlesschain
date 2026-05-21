package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.remote.commands.EventDetailResponse

/**
 * Phase 14.3.3.b — 共享事件详情底部 Sheet 内容。
 *
 * 历史：HubAskScreen 已有同形 private CitationDetailContent (Phase 14.1)；
 * Phase 14.3.3.b 加入 HubAuditScreen 复用同款渲染需要把它抽出来 — 此文件
 * 即用 reuse anchor。两个 caller (HubAskScreen + HubAuditScreen) 包同样的
 * ModalBottomSheet wrapper，但 Sheet 内容形态完全一致。
 *
 * 输入：从 `personal-data-hub.event-detail` 拉回来的 EventDetailResponse
 *  - event：HubEvent 核心字段（id / subtype / source / title / actor / amount / currency）
 *  - classification：Email 模板分类（账单 / 政务 / 订单 / 注册 / 出行 / 其他）
 *  - extraction：模板提取字段表 + 警告 + PDF metadata（若 attachment 是 PDF）
 *
 * UI 形态：单 Column 垂直排列；字段层级用 typography titleMedium → bodyMedium →
 * bodySmall → labelSmall 区分。复杂结构（extraction.fields Map）用 `key = value\n`
 * 多行字符串而非 row-by-row Composable —— 字段数量未知，避免无限嵌套。
 */
@Composable
internal fun HubEventDetailContent(detail: EventDetailResponse) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        Text(
            "事件详情",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(Modifier.height(8.dp))
        Text("ID: ${detail.event.id}", style = MaterialTheme.typography.bodySmall)
        Text("subtype: ${detail.event.subtype}", style = MaterialTheme.typography.bodySmall)
        Text("source: ${detail.event.source}", style = MaterialTheme.typography.bodySmall)
        detail.event.title?.let { t ->
            Spacer(Modifier.height(8.dp))
            Text(t, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        }
        detail.event.actor?.let { Text("actor: $it", style = MaterialTheme.typography.bodySmall) }
        detail.event.amount?.let { amt ->
            val cur = detail.event.currency ?: ""
            Text("amount: $amt $cur", style = MaterialTheme.typography.bodySmall)
        }
        detail.classification?.let { c ->
            Spacer(Modifier.height(8.dp))
            Text("classification: ${c.template ?: "?"}", style = MaterialTheme.typography.bodySmall)
            if (c.labels.isNotEmpty()) {
                Text("labels: ${c.labels.joinToString()}", style = MaterialTheme.typography.bodySmall)
            }
        }
        detail.extraction?.let { e ->
            Spacer(Modifier.height(8.dp))
            Text("extraction template: ${e.template ?: "?"}", style = MaterialTheme.typography.bodySmall)
            if (e.fields.isNotEmpty()) {
                Text(
                    e.fields.entries.joinToString("\n") { "${it.key} = ${it.value}" },
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
