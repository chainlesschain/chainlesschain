package com.chainlesschain.android.presentation.screens.asr

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.ai.data.voice.AsrEngineChoice
import com.chainlesschain.android.feature.ai.data.voice.WhisperModel
import com.chainlesschain.android.feature.ai.data.voice.WhisperModelDownloader

/**
 * v1.1 issue #19 W4：Settings → ASR 引擎 Compose 屏。
 *
 * 上半部 RadioGroup 选 Volcengine / Whisper 引擎；选 Whisper 时下半部展开模型选择
 * RadioGroup (Tiny/Base/Small) + 安装状态指示。
 *
 * v1.1 Whisper 引擎是 stub；Settings UI ready，用户切到 Whisper 后第一次 transcribe
 * 会抛 [WhisperNotInstalledException] → VoiceMode 状态 Failed.TRANSCRIBE 显示安装指引。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AsrEngineSettingsScreen(
    onBack: () -> Unit = {},
    viewModel: AsrEngineSettingsViewModel = hiltViewModel(),
) {
    val engine by viewModel.engine.collectAsState()
    val whisperModel by viewModel.whisperModel.collectAsState()
    val downloadState by viewModel.downloadState.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("ASR 引擎") }) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // 引擎选择
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            "语音识别引擎",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            "VoiceMode 录音后用哪个引擎转文字",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(8.dp))
                        EngineRadioRow(
                            choice = AsrEngineChoice.Volcengine,
                            label = "火山豆包 SeedASR (云端)",
                            description = "中文识别率高，需 API Key + 网络。首字 ~500ms。",
                            badge = "推荐",
                            current = engine,
                            onSelect = viewModel::setEngine,
                        )
                        EngineRadioRow(
                            choice = AsrEngineChoice.Whisper,
                            label = "Whisper local (离线)",
                            description = "全离线，隐私第一。v1.1 stub — 真集成 v1.2，详见文档。",
                            badge = "v1.1 stub",
                            current = engine,
                            onSelect = viewModel::setEngine,
                        )
                    }
                }
            }

            // Whisper 模型选择（仅 Whisper 时显示）
            if (engine == AsrEngineChoice.Whisper) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                "Whisper 模型",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                "ggml 模型文件大小 / 首字延迟 / 中文准确率三角平衡",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(8.dp))
                            for (model in WhisperModel.values()) {
                                ModelRadioRow(
                                    model = model,
                                    current = whisperModel,
                                    installed = viewModel.isWhisperInstalled(model),
                                    onSelect = viewModel::setWhisperModel,
                                )
                            }
                        }
                    }
                }

                // Whisper 模型下载/状态卡片 (W4c)
                item {
                    val installed = viewModel.isWhisperInstalled(whisperModel)
                    WhisperModelStatusCard(
                        model = whisperModel,
                        installed = installed,
                        downloadState = downloadState,
                        onDownload = { viewModel.downloadCurrentModel() },
                        onCancel = { viewModel.cancelDownload() },
                        onDelete = { viewModel.deleteModel() },
                    )
                }
            }

            item {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = onBack,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("返回") }
            }
        }
    }
}

@Composable
private fun EngineRadioRow(
    choice: AsrEngineChoice,
    label: String,
    description: String,
    badge: String,
    current: AsrEngineChoice,
    onSelect: (AsrEngineChoice) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(
                selected = current == choice,
                onClick = { onSelect(choice) },
            )
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        RadioButton(
            selected = current == choice,
            onClick = null,
        )
        Spacer(Modifier.height(0.dp))
        Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    label,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(0.dp))
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                    modifier = Modifier.padding(start = 6.dp),
                ) {
                    Text(
                        " $badge ",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                    )
                }
            }
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ModelRadioRow(
    model: WhisperModel,
    current: WhisperModel,
    installed: Boolean,
    onSelect: (WhisperModel) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(
                selected = current == model,
                onClick = { onSelect(model) },
            )
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        RadioButton(
            selected = current == model,
            onClick = null,
        )
        Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    model.displayName,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(0.dp))
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = if (installed) MaterialTheme.colorScheme.primaryContainer
                    else MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.padding(start = 6.dp),
                ) {
                    Text(
                        if (installed) " 已安装 " else " 待下载 ",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (installed) MaterialTheme.colorScheme.onPrimaryContainer
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text(
                "中文 ${model.accuracyHint} · 首字 ${model.firstTokenLatencyMs}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * W4c：Whisper 模型下载/状态卡片。
 *
 * 4 状态：
 *   - 未安装 + Idle → 显示「下载 ggml-XXX.bin (N MB)」按钮 + 流量提示
 *   - Downloading → 进度条 + 百分比 + 字节数 + 取消按钮
 *   - 已安装 + Idle/Success → 绿色提示 + 「删除模型」按钮
 *   - Failed → 红色错误 + 重试按钮
 */
@Composable
private fun WhisperModelStatusCard(
    model: WhisperModel,
    installed: Boolean,
    downloadState: WhisperModelDownloader.DownloadState,
    onDownload: () -> Unit,
    onCancel: () -> Unit,
    onDelete: () -> Unit,
) {
    val (containerColor, contentColor) = when {
        downloadState is WhisperModelDownloader.DownloadState.Failed ->
            MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
        installed ->
            MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        else ->
            MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = containerColor),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            when (val s = downloadState) {
                is WhisperModelDownloader.DownloadState.Downloading -> {
                    Text(
                        "正在下载 ${s.model.displayName}…",
                        style = MaterialTheme.typography.titleSmall,
                        color = contentColor,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(8.dp))
                    LinearProgressIndicator(
                        progress = { s.progress },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "${(s.progress * 100).toInt()}%  " +
                            "${formatBytes(s.bytesDownloaded)} / ${formatBytes(s.bytesTotal)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = contentColor,
                    )
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = onCancel) { Text("取消下载") }
                }
                is WhisperModelDownloader.DownloadState.Failed -> {
                    Text(
                        "❌ 下载失败",
                        style = MaterialTheme.typography.titleSmall,
                        color = contentColor,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        s.reason,
                        style = MaterialTheme.typography.bodySmall,
                        color = contentColor,
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = onDownload) { Text("重试") }
                }
                is WhisperModelDownloader.DownloadState.Success,
                WhisperModelDownloader.DownloadState.Idle -> {
                    if (installed) {
                        Text(
                            "✅ ${model.displayName} 已安装",
                            style = MaterialTheme.typography.titleSmall,
                            color = contentColor,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "可使用 Whisper 引擎（W4d 接通后 transcribe 才走 native 路径）。",
                            style = MaterialTheme.typography.bodySmall,
                            color = contentColor,
                        )
                        Spacer(Modifier.height(8.dp))
                        TextButton(onClick = onDelete) { Text("删除模型释放空间") }
                    } else {
                        Text(
                            "⚠️ ${model.displayName} 未下载",
                            style = MaterialTheme.typography.titleSmall,
                            color = contentColor,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "需 ${model.sizeMB} MB 流量（建议 Wi-Fi）。下载源：HuggingFace ggerganov/whisper.cpp。" +
                                " W4d 接通后 transcribe 走 native 路径；目前仍 stub。",
                            style = MaterialTheme.typography.bodySmall,
                            color = contentColor,
                        )
                        Spacer(Modifier.height(8.dp))
                        Button(
                            onClick = onDownload,
                            colors = ButtonDefaults.buttonColors(),
                        ) { Text("下载 ${model.ggmlFilename} (${model.sizeMB} MB)") }
                    }
                }
            }
        }
    }
}

private fun formatBytes(bytes: Long): String = when {
    bytes < 1024 -> "${bytes}B"
    bytes < 1024 * 1024 -> "${bytes / 1024}KB"
    bytes < 1024L * 1024 * 1024 -> "${bytes / 1024 / 1024}MB"
    else -> String.format("%.1fGB", bytes / 1024f / 1024f / 1024f)
}
