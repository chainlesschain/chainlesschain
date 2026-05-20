package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.remote.commands.HubHealth

/**
 * Phase 14.1 — Hub Health Card
 *
 * 4 件套健康状态：vault / llm / kgSink / ragSink。每件套展示 ok 状态（绿 = ok / 红 = down /
 * 灰 = 未知），副字段给出 schemaVersion / llm name / isLocal。
 */
@Composable
fun HubHealthCard(health: HubHealth?) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
        ) {
            Text(
                "中台健康",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(8.dp))
            if (health == null) {
                Text(
                    "加载中…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                return@Column
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                StatusPill(
                    label = "Vault",
                    ok = health.vault.ok,
                    sub = health.vault.schemaVersion?.let { "schema v$it" }
                )
                StatusPill(
                    label = "LLM",
                    ok = health.llm.ok,
                    sub = buildString {
                        append(health.llm.name ?: "?")
                        append(if (health.llm.isLocal) " (本地)" else " (非本地)")
                    }
                )
            }
            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                StatusPill(label = "KG sink", ok = health.kgSink.ok, sub = null)
                StatusPill(label = "RAG sink", ok = health.ragSink.ok, sub = null)
            }
        }
    }
}

@Composable
private fun StatusPill(label: String, ok: Boolean, sub: String?) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .background(
                    color = if (ok) Color(0xFF22C55E) else Color(0xFFEF4444),
                    shape = CircleShape
                )
        )
        Spacer(Modifier.size(6.dp))
        Column {
            Text(label, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
            sub?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
        }
    }
}
