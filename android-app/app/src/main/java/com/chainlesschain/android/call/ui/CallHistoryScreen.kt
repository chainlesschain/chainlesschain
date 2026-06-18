package com.chainlesschain.android.call.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CallMade
import androidx.compose.material.icons.filled.CallMissed
import androidx.compose.material.icons.filled.CallReceived
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.call.CallHistoryEntity
import com.chainlesschain.android.core.database.entity.call.CallStatus
import com.chainlesschain.android.core.database.entity.call.CallType
import com.chainlesschain.android.core.database.entity.call.MediaType
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * FAMILY-67 通话记录页。展示与某好友（或全部）的语音/视频通话历史。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CallHistoryScreen(
    peerDid: String?,
    onNavigateBack: () -> Unit,
    viewModel: CallHistoryViewModel = hiltViewModel(),
) {
    LaunchedEffect(peerDid) { viewModel.load(peerDid) }
    val records by viewModel.records.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("通话记录") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        if (records.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Text(
                    "暂无通话记录",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(padding)) {
                items(records, key = { it.id }) { rec ->
                    CallHistoryRow(rec)
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun CallHistoryRow(rec: CallHistoryEntity) {
    val (icon, tint) = when (rec.callType) {
        CallType.OUTGOING -> Icons.Filled.CallMade to Color(0xFF388E3C)
        CallType.INCOMING -> Icons.Filled.CallReceived to MaterialTheme.colorScheme.primary
        CallType.MISSED -> Icons.Filled.CallMissed to Color(0xFFD32F2F)
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(24.dp))
        if (rec.mediaType == MediaType.VIDEO) {
            Icon(Icons.Filled.Videocam, contentDescription = "视频", modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(rec.peerName, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
            Text(
                subtitle(rec),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            formatTime(rec.startTime),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun subtitle(rec: CallHistoryEntity): String {
    val media = if (rec.mediaType == MediaType.VIDEO) "视频" else "语音"
    val kind = when (rec.callType) {
        CallType.OUTGOING -> "呼出"
        CallType.INCOMING -> "呼入"
        CallType.MISSED -> "未接"
    }
    return when {
        rec.status == CallStatus.FAILED -> "$media·$kind·失败"
        rec.callType == CallType.MISSED -> "$media·未接"
        rec.duration > 0 -> "$media·$kind·${formatDuration(rec.duration)}"
        else -> "$media·$kind·未接通"
    }
}

private fun formatDuration(sec: Long): String =
    if (sec >= 60) "%d分%02d秒".format(sec / 60, sec % 60) else "${sec}秒"

private fun formatTime(ts: Long): String =
    SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(ts))
