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
 * 家长端通话屏（FAMILY-37）。Idle 时给发起入口（语音/视频/旁观/强接通 + 强接通剩余配额）；
 * Outgoing/Connected 显状态 + 挂断；RED_ALERT 类（旁观/强接通）挂红色横幅。
 */
@Composable
fun ParentCallScreen(
    targetPeerId: String,
    targetDid: String,
    onClose: () -> Unit,
    viewModel: FamilyCallViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("家庭通话", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)

        when (val s = state) {
            is FamilyCallUiState.Idle -> {
                val remaining = viewModel.urgentQuotaRemaining(targetDid)
                Button(onClick = { viewModel.startCall(targetPeerId, targetDid, CallKind.AUDIO) }, modifier = Modifier.fillMaxWidth()) {
                    Text("语音通话")
                }
                Button(onClick = { viewModel.startCall(targetPeerId, targetDid, CallKind.VIDEO) }, modifier = Modifier.fillMaxWidth()) {
                    Text("视频通话")
                }
                OutlinedButton(onClick = { viewModel.silentObserve(targetPeerId, targetDid) }, modifier = Modifier.fillMaxWidth()) {
                    Text("静音旁观")
                }
                OutlinedButton(
                    onClick = { viewModel.urgentForce(targetPeerId, targetDid) },
                    enabled = remaining > 0,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("强接通（今日剩余 $remaining 次）")
                }
            }

            is FamilyCallUiState.Outgoing -> {
                CallBannerIfNeeded(s.callKind)
                Text("呼叫中… (${s.callKind})", style = MaterialTheme.typography.titleMedium)
                HangupButton { viewModel.hangup(targetPeerId) }
            }

            is FamilyCallUiState.Connected -> {
                CallBannerIfNeeded(s.callKind)
                Text("通话中 (${s.callKind})", style = MaterialTheme.typography.titleMedium)
                HangupButton { viewModel.hangup(targetPeerId) }
            }

            is FamilyCallUiState.Ended -> {
                Text("通话结束${s.reason?.let { "（$it）" } ?: ""}")
                CloseButton { viewModel.dismiss(); onClose() }
            }

            is FamilyCallUiState.Error -> {
                Text("通话失败：${s.message}", color = MaterialTheme.colorScheme.error)
                CloseButton { viewModel.dismiss(); onClose() }
            }

            is FamilyCallUiState.Incoming -> {
                // 家长端通常不进 Incoming（孩子端来电屏处理）；兜底显挂断。
                Text("来电：${s.callId}")
                HangupButton { viewModel.hangup(s.fromPeerId) }
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
            Text("● 监管中：${kind}", color = Color.White, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun HangupButton(onClick: () -> Unit) {
    Button(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text("挂断") }
}

@Composable
private fun CloseButton(onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text("关闭") }
}
