package com.chainlesschain.android.presentation.screens.voice

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.ai.data.voice.VoiceModeState

/**
 * VoiceMode 演示屏 - M3 D1。
 *
 * 设计取舍：
 * - 不强求集成进 ChatScreen（那是更大改动，留 v0.7 follow-up）
 * - 长按麦克风启动录音 → 抬起播放 pipeline，连续模式自动循环
 * - 错误状态独立提示，用户可点 "重试"
 *
 * 权限处理：进入屏幕时一次性 launchPermissionRequest，未授权则 startRecording 时 manager
 * 返回 Failed(PERMISSION)，UI 显示"前往设置授予"。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoiceModeScreen(
    onBack: () -> Unit = {},
    viewModel: VoiceModeViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { _ -> /* 结果交给 manager.startRecording 自检 */ }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("语音对话") },
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // 顶部说明
            Text(
                text = "长按下方麦克风说话；松开后桌面 LLM 回复并朗读。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(Modifier.height(16.dp))

            // 连续模式开关
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text("连续模式", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "回复完成自动再次开始录音",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = viewModel.continuousMode,
                    onCheckedChange = { viewModel.continuousMode = it },
                )
            }

            Spacer(Modifier.height(8.dp))

            // 当前转录 / 回复
            ConversationPanel(state)

            Spacer(Modifier.height(24.dp))

            // 中央麦克风
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(180.dp),
                contentAlignment = Alignment.Center
            ) {
                MicButton(
                    state = state,
                    onPress = {
                        // 触发权限请求；权限已授时 launcher 立即回调，未授时 OS 弹窗
                        permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        viewModel.startRecording()
                    },
                    onRelease = {
                        if (state is VoiceModeState.Recording) {
                            viewModel.stopAndProcess()
                        }
                    },
                )
            }

            Spacer(Modifier.height(16.dp))

            // 辅助按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedButton(
                    onClick = { viewModel.cancel() },
                    modifier = Modifier.weight(1f),
                ) { Text("取消") }
                OutlinedButton(
                    onClick = { viewModel.resetConversation() },
                    modifier = Modifier.weight(1f),
                ) { Text("新会话") }
            }

            Spacer(Modifier.height(8.dp))

            OutlinedButton(
                onClick = onBack,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("返回") }
        }
    }
}

@Composable
private fun ConversationPanel(state: VoiceModeState) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            when (val s = state) {
                is VoiceModeState.Idle -> Text(
                    "等待你的语音输入…",
                    style = MaterialTheme.typography.bodyMedium,
                )
                is VoiceModeState.Recording -> Text(
                    "🎙️ 正在录音…松开以识别",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                is VoiceModeState.Transcribing -> Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text("正在识别…", style = MaterialTheme.typography.bodyMedium)
                }
                is VoiceModeState.Thinking -> Column {
                    LabeledText("你说", s.userText)
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                        )
                        Spacer(Modifier.size(8.dp))
                        Text("助手思考中…", style = MaterialTheme.typography.bodyMedium)
                    }
                }
                is VoiceModeState.Speaking -> Column {
                    LabeledText("你说", s.userText)
                    Spacer(Modifier.height(8.dp))
                    LabeledText("助手", s.replyText)
                    Spacer(Modifier.height(4.dp))
                    Text("🔊 正在朗读…", style = MaterialTheme.typography.bodySmall)
                }
                is VoiceModeState.Done -> Column {
                    LabeledText("你说", s.userText)
                    Spacer(Modifier.height(8.dp))
                    LabeledText("助手", s.replyText)
                }
                is VoiceModeState.Failed -> Column {
                    Text(
                        "⚠️ ${stageLabel(s.stage)}阶段失败",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(s.message, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun LabeledText(label: String, content: String) {
    Column {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
        )
        Text(content, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun stageLabel(stage: VoiceModeState.Failed.Stage): String = when (stage) {
    VoiceModeState.Failed.Stage.PERMISSION -> "权限"
    VoiceModeState.Failed.Stage.RECORDING -> "录音"
    VoiceModeState.Failed.Stage.TRANSCRIBE -> "识别"
    VoiceModeState.Failed.Stage.CHAT -> "对话"
    VoiceModeState.Failed.Stage.TTS -> "语音合成"
    VoiceModeState.Failed.Stage.PLAY -> "播放"
}

@Composable
private fun MicButton(
    state: VoiceModeState,
    onPress: () -> Unit,
    onRelease: () -> Unit,
) {
    val isRecording = state is VoiceModeState.Recording
    val color = when {
        isRecording -> MaterialTheme.colorScheme.error
        state is VoiceModeState.Transcribing ||
            state is VoiceModeState.Thinking ||
            state is VoiceModeState.Speaking -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.primary
    }
    FilledIconButton(
        onClick = {
            if (isRecording) onRelease() else onPress()
        },
        modifier = Modifier.size(120.dp).clip(CircleShape),
        colors = IconButtonDefaults.filledIconButtonColors(containerColor = color),
    ) {
        Icon(
            imageVector = if (isRecording) Icons.Default.Stop else Icons.Default.Mic,
            contentDescription = if (isRecording) "完成" else "开始录音",
            modifier = Modifier.size(56.dp),
            tint = Color.White,
        )
    }
}
