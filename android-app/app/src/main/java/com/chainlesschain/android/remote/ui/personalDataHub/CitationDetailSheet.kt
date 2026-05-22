package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.pdh.LocalCcRunner
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 推文 §"AI 给出处 · 点一下看原文" 的 bottom sheet — citation chip 点击后
 * 显事件原文。封装 ModalBottomSheet + 加载态/Not found/错误态/Ok 4 个 UI 分支。
 *
 * Caller (HubLocalScreen / HubLocalAskScreen) 只需在 LazyColumn / Column 之
 * 外渲一次本 Composable，传入 state + onDismiss。state.visible 控制显示。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CitationDetailSheet(
    state: HubLocalViewModel.CitationDetailState,
    onDismiss: () -> Unit,
) {
    if (!state.visible) return
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(modifier = Modifier.padding(16.dp).fillMaxWidth()) {
            Text(
                "事件原文",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(8.dp))
            when {
                state.loading -> {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "正在加载 event id: ${state.eventId}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                state.notFound -> {
                    Text(
                        "未找到该事件 (id: ${state.eventId}) — 可能已被销毁",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                state.errorMessage != null -> {
                    Text(
                        "加载失败: ${state.errorMessage}",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                state.event != null -> {
                    EventDetailBody(event = state.event)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun EventDetailBody(event: LocalCcRunner.VaultEvent) {
    Column {
        DetailRow("ID", event.id)
        DetailRow("类型", event.subtype)
        DetailRow("来源", event.source)
        event.title?.let { DetailRow("标题", it) }
        event.actor?.let { DetailRow("Actor", it) }
        event.amount?.let { amt ->
            val cur = event.currency ?: ""
            DetailRow("金额", if (cur.isNotEmpty()) "$amt $cur" else amt.toString())
        }
        event.startedAt?.let {
            DetailRow("发生时间", isoFormatter.format(Date(it)))
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

private val isoFormatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
