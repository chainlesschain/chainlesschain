package com.chainlesschain.android.remote.call

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chainlesschain.android.remote.webrtc.CallBanner
import com.chainlesschain.android.remote.webrtc.CallKind

/**
 * 孩子端来电屏（FAMILY-37）。Incoming 显接听/拒绝；RED_ALERT 类（旁观/强接通）挂红色横幅
 * （合规知情）。强接通（URGENT）按设计自动接听 — 这里仍给孩子可见的红横幅 + 接听态。
 */
@Composable
fun ChildIncomingCallScreen(
    onClose: () -> Unit,
    viewModel: FamilyCallViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when (val s = state) {
            is FamilyCallUiState.Incoming -> {
                CallBannerIfNeeded(s.callKind)
                Text("来电", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                Text("来自：${s.fromPeerId}")
                Text("类型：${s.callKind}")
                Button(onClick = { viewModel.acceptIncoming() }, modifier = Modifier.fillMaxWidth()) {
                    Text("接听")
                }
                OutlinedButton(
                    onClick = { viewModel.rejectIncoming(); onClose() },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("拒绝")
                }
            }

            is FamilyCallUiState.Connected -> {
                CallBannerIfNeeded(s.callKind)
                Text("通话中 (${s.callKind})", style = MaterialTheme.typography.titleMedium)
                Button(onClick = { /* hangup needs peer; child hangup wired by host */ }, modifier = Modifier.fillMaxWidth()) {
                    Text("挂断")
                }
            }

            is FamilyCallUiState.Ended -> {
                Text("通话结束${s.reason?.let { "（$it）" } ?: ""}")
                OutlinedButton(onClick = { viewModel.dismiss(); onClose() }, modifier = Modifier.fillMaxWidth()) {
                    Text("关闭")
                }
            }

            is FamilyCallUiState.Error -> {
                Text("出错：${s.message}", color = MaterialTheme.colorScheme.error)
                OutlinedButton(onClick = { viewModel.dismiss(); onClose() }, modifier = Modifier.fillMaxWidth()) {
                    Text("关闭")
                }
            }

            FamilyCallUiState.Idle, is FamilyCallUiState.Outgoing -> {
                // 无来电（或本端正主叫）— 来电屏不渲染内容。
                Text("暂无来电")
            }
        }
    }
}

@Composable
private fun CallBannerIfNeeded(kind: CallKind) {
    if (kind.banner == CallBanner.RED_ALERT) {
        Row(
            modifier = Modifier.fillMaxWidth().background(Color(0xFFD32F2F)).padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val label = when (kind) {
                CallKind.SILENT_OBSERVE -> "● 家长正在旁观"
                CallKind.URGENT -> "● 紧急强接通"
                else -> "● 监管中"
            }
            Text(label, color = Color.White, fontWeight = FontWeight.Bold)
        }
    }
}
