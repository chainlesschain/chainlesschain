package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.pdh.LocalCcRunner.EventRow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Phase 16 Vault Browser — Android "我的数据" tab.
 *
 * Stateful wrapper around [HubBrowserScreenContent] — keeps the
 * Hilt-injected ViewModel out of the testable composable surface so
 * unit / instrumentation tests can render the Content directly with
 * a synthetic state (avoiding the mockk<HiltViewModel> initialization
 * trap, memory `android_mockk_viewmodel_androidtest_initializer_trap`).
 */
@Composable
fun HubBrowserScreen(
    modifier: Modifier = Modifier,
    viewModel: HubBrowserViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    HubBrowserScreenContent(
        modifier = modifier,
        state = state,
        onQueryChange = viewModel::setQuery,
        onCategorySelect = viewModel::selectCategory,
        onAdapterSelect = viewModel::selectAdapter,
        onLoadMore = viewModel::loadMore,
        onReset = viewModel::resetFilters,
        onRefresh = viewModel::search,
    )
}

/**
 * Stateless body — receives the entire UI state + callback lambdas. Used by
 * the wrapper above and directly by tests / @Preview.
 */
@Composable
fun HubBrowserScreenContent(
    modifier: Modifier = Modifier,
    state: HubBrowserUiState,
    onQueryChange: (String) -> Unit,
    onCategorySelect: (String?) -> Unit,
    onAdapterSelect: (String?) -> Unit,
    onLoadMore: () -> Unit,
    onReset: () -> Unit,
    onRefresh: () -> Unit,
) {
    Column(modifier = modifier.fillMaxSize()) {
        // Search row
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = state.q,
                onValueChange = onQueryChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text(if (state.category != null) "在「${categoryLabelFor(state.category)}」内搜索…" else "搜索关键词…") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (state.q.isNotEmpty()) {
                        IconButton(onClick = { onQueryChange("") }) {
                            Icon(Icons.Default.Clear, contentDescription = "清空")
                        }
                    }
                },
                singleLine = true,
            )
        }

        // Mode + total banner
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "共 ${state.facets.total} 条" +
                    (if (state.shortQuery) " · 关键词需至少 3 字" else "") +
                    (if (state.mode == "like") " · LIKE 兜底" else "") +
                    (if (state.rows.isNotEmpty()) " · 已显示 ${state.rows.size}" else ""),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            if (state.q.isNotEmpty() || state.category != null || state.adapter != null) {
                OutlinedButton(onClick = onReset) { Text("清空筛选") }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Category chip row
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item(key = "cat-all") {
                FilterChip(
                    selected = state.category == null,
                    onClick = { onCategorySelect(null) },
                    label = { Text("全部 (${state.facets.total})") },
                )
            }
            itemsIndexed(
                items = CATEGORY_ORDER,
                key = { idx, cat -> "cat-$idx-$cat" },
            ) { _, cat ->
                val count = state.facets.byCategory[cat] ?: 0
                FilterChip(
                    selected = state.category == cat,
                    onClick = { onCategorySelect(cat) },
                    label = { Text("${categoryLabelFor(cat)} ($count)") },
                    enabled = count > 0 || state.category == cat,
                )
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Error banner
        if (state.errorMessage != null) {
            Surface(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(8.dp),
            ) {
                Text(
                    text = state.errorMessage,
                    modifier = Modifier.padding(12.dp),
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        // Result list
        if (state.isLoading && state.rows.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else if (state.rows.isEmpty() && state.errorMessage == null) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    text = emptyHintFor(state),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // itemsIndexed + idx-prefixed key — avoids
                // measureLazyList crash when adapters burst-emit events
                // with same occurredAt millisecond (memory
                // compose_lazycolumn_key_burst_collision).
                itemsIndexed(
                    items = state.rows,
                    key = { idx, ev -> "row-$idx-${ev.id}" },
                ) { _, ev ->
                    EventRenderer(event = ev)
                }
                if (state.canLoadMore) {
                    item(key = "load-more") {
                        OutlinedButton(
                            onClick = onLoadMore,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                            enabled = !state.isAppending,
                        ) {
                            if (state.isAppending) {
                                CircularProgressIndicator(modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.size(8.dp))
                            }
                            Text("加载下一页 (${BROWSER_PAGE_SIZE} 条)")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EventCard(event: EventRow) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = formatTime(event.occurredAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.size(8.dp))
                event.sourceAdapter?.let {
                    AssistChip(
                        onClick = {},
                        label = { Text(it, fontSize = 10.sp) },
                        colors = AssistChipDefaults.assistChipColors(
                            containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                        ),
                    )
                }
                Spacer(modifier = Modifier.size(4.dp))
                Text(
                    text = event.subtype,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = event.summary ?: "(无摘要)",
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 4,
            )
        }
    }
}

private val CATEGORY_ORDER = listOf(
    "chat", "social", "email", "shopping", "travel", "system", "ai-chat", "other",
)

private fun categoryLabelFor(id: String?): String = when (id) {
    "chat" -> "社交聊天"
    "social" -> "内容平台"
    "email" -> "邮件"
    "shopping" -> "支付订单"
    "travel" -> "出行"
    "system" -> "系统数据"
    "ai-chat" -> "AI 对话"
    "other" -> "其他"
    else -> id ?: "未知"
}

private fun emptyHintFor(state: HubBrowserUiState): String = when {
    state.q.isNotEmpty() ->
        "没有匹配 \"${state.q}\" 的事件 — 换个关键词或类目试试"
    state.category != null ->
        "「${categoryLabelFor(state.category)}」类目下还没数据 — 去本机数据 tab 同步对应 adapter"
    else ->
        "Vault 里还没数据 — 去本机数据 tab 同步任意 adapter"
}

private fun formatTime(ms: Long): String {
    if (ms <= 0) return ""
    return try {
        SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(ms))
    } catch (_: Throwable) {
        ""
    }
}
