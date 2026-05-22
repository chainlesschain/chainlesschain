package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.pdh.LocalCcRunner
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * §2.9 — 本机操作账本卡片。镜像推文 §"每次操作都有账本"：
 *
 * > 谁、什么时候、对哪条数据做了什么动作（采集 / 查询 / 提问 / 删除），
 * > 全部有记录可查。你随时知道自己的数据被怎么用过。
 *
 * 跟 [HubAuditScreen] 区别：本卡是 **本机** vault 的 audit (走 LocalCcRunner →
 * 本机 cc subprocess → 本机 vault.db)，HubAuditScreen 是 **桌面** vault 的
 * audit (走 PersonalDataHubCommands RPC → 桌面 hub)。一个手机 / 一个桌面，
 * 两套审计，互不串扰。
 *
 * 行数据来源是 `cc hub recent-audit --limit 50 --json`，固定 limit=50；
 * 真要翻更多走 v0.2 (分页)。limit=50 是 §2.9 hand-off doc 写死的。
 *
 * 用 itemsIndexed + composite key (`row-${idx}-${row.at}`) 防 burst-collision
 * — 1305 rows 入库时同毫秒多条 audit，纯 `row.at` 做 key 会 measureLazyList
 * crash（参 memory `compose_lazycolumn_key_burst_collision.md`）。
 *
 * heightIn(max = 400.dp) — 嵌在 HubLocalScreen 的 outer LazyColumn 里，外
 * 层会处理滚动；本卡的内层 LazyColumn 只在 50 行真填满 400dp 时滚。
 * 注：嵌套 LazyColumn 是 Compose 反模式但本场景不可避（外层 LazyColumn
 * 6+ section + 本卡是其中一个 item）；固定 max height 避免 measure 死循环。
 */
@Composable
fun HubAuditCard(
    state: HubLocalViewModel.LocalAuditState,
    globalBusy: Boolean,
    onRefresh: () -> Unit,
    onClearError: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val df = remember { SimpleDateFormat("MM-dd HH:mm:ss", Locale.getDefault()) }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "操作账本",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "推文承诺：每次操作都有账本 — 谁、何时、做了什么。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedButton(
                    onClick = onRefresh,
                    enabled = !state.isLoading && !globalBusy,
                ) { Text(if (state.rows.isEmpty()) "加载" else "刷新") }
            }

            // last refresh stamp
            state.lastRefreshAt?.let { ts ->
                Spacer(Modifier.height(4.dp))
                Text(
                    "上次读取：${df.format(Date(ts))}（最多显示 50 条）",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.height(12.dp))

            when {
                state.errorMessage != null -> AuditErrorRow(
                    message = state.errorMessage,
                    onDismiss = onClearError,
                )
                state.isLoading -> Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 16.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.size(12.dp))
                    Text(
                        "正在读取本机审计日志…",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                state.rows.isEmpty() && state.lastRefreshAt == null -> Text(
                    "点击 加载 读取本机 vault 最近的操作记录。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                state.rows.isEmpty() -> Text(
                    "暂无审计记录。先到 基础数据 / 内容平台 等卡片做一次同步，记录会出现在这里。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                else -> {
                    Text(
                        "${state.rows.size} 条记录（最新在上）",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(6.dp))
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 400.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        itemsIndexed(
                            items = state.rows,
                            key = { idx, row -> "row-$idx-${row.at}" },
                        ) { _, row -> AuditRowItem(row = row, df = df) }
                    }
                }
            }
        }
    }
}

@Composable
private fun AuditRowItem(
    row: LocalCcRunner.AuditRow,
    df: SimpleDateFormat,
) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = row.action.ifBlank { "(unknown)" },
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = actionColor(row.action),
                )
                Spacer(Modifier.weight(1f))
                Text(
                    text = if (row.at > 0L) df.format(Date(row.at)) else "—",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            val subtitle = buildString {
                row.adapter?.let { append("adapter: ").append(it) }
                row.eventId?.let {
                    if (isNotEmpty()) append("  ·  ")
                    append("eventId: ").append(it.take(12))
                    if (it.length > 12) append("…")
                }
            }
            if (subtitle.isNotEmpty()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun AuditErrorRow(message: String, onDismiss: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                "读取审计日志失败",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                TextButton(onClick = onDismiss) { Text("知道了") }
            }
        }
    }
}

private val INGEST_COLORS = listOf("ingest", "sync")
private val ASK_COLORS = listOf("ask", "query")
private val DESTRUCTIVE_COLORS = listOf("destroy", "delete", "unregister")

@Composable
private fun actionColor(action: String): androidx.compose.ui.graphics.Color {
    val lc = action.lowercase()
    return when {
        DESTRUCTIVE_COLORS.any { lc.contains(it) } -> MaterialTheme.colorScheme.error
        ASK_COLORS.any { lc.contains(it) } -> MaterialTheme.colorScheme.tertiary
        INGEST_COLORS.any { lc.contains(it) } -> MaterialTheme.colorScheme.primary
        else -> MaterialTheme.colorScheme.onSurface
    }
}
