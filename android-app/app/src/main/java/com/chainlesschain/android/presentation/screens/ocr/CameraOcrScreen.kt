package com.chainlesschain.android.presentation.screens.ocr

import android.Manifest
import android.content.Context
import android.net.Uri
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.ai.data.ocr.CameraOcrState
import java.io.File

/**
 * M3 D1 CameraOCR 演示屏。
 *
 * 取图：用 `ActivityResultContracts.TakePicture()` 拉系统相机；JPEG 落 cacheDir，
 *      FileProvider URI 透传相机 app。完成后 launcher 回调把 [File] 给 viewModel.
 *
 * 流程：
 *   Idle → 按"拍照" → 系统相机 → 回调 processImage(jpeg) → Encoding → Recognizing →
 *   Recognized → 用户编辑文字 + 输入标题 → "保存到 KB" → Saving → Saved → "再来一张" 回 Idle.
 *
 * CameraX in-app preview / 实时识别留 follow-up（这一版优先打通端到端 demo）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CameraOcrScreen(
    onBack: () -> Unit = {},
    viewModel: CameraOcrViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val lastLocation by viewModel.lastLocation.collectAsState()
    val context = LocalContext.current

    // 当前等待结果的 jpeg 临时文件
    var pendingFile by remember { mutableStateOf<File?>(null) }
    var pendingUri by remember { mutableStateOf<Uri?>(null) }
    var editedText by remember { mutableStateOf("") }
    var noteTitle by remember { mutableStateOf("") }
    var attachLocation by remember { mutableStateOf(false) }

    val takePicture = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicture()
    ) { success ->
        val f = pendingFile
        if (success && f != null && f.length() > 0) {
            viewModel.processImage(f)
        } else {
            // 用户取消或文件空：清掉临时文件
            f?.delete()
        }
        pendingFile = null
        pendingUri = null
    }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            launchCamera(context, takePicture) { f, uri ->
                pendingFile = f
                pendingUri = uri
            }
        }
    }

    val locationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        attachLocation = granted  // 拒绝时回 false，用户能从 UI 看到 toggle 自动关
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("拍照识别 → 知识库") }) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                "拍发票、名片、白板字 → 桌面 LLM OCR → 一键存进知识库",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))

            // 附带 GPS 开关 (M3 D2)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.LocationOn,
                        contentDescription = null,
                        modifier = Modifier.height(20.dp),
                        tint = if (attachLocation) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(0.dp))
                    Column {
                        Text(" 附带位置", style = MaterialTheme.typography.titleSmall)
                        Text(
                            text = lastLocation?.let { tag ->
                                " 当前: %.4f, %.4f (±%dm)".format(
                                    tag.latitude, tag.longitude, tag.accuracyMeters.toInt(),
                                )
                            } ?: " 保存时取一次 GPS 写入笔记头部",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Switch(
                    checked = attachLocation,
                    onCheckedChange = { wantOn ->
                        if (wantOn) {
                            locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                        } else {
                            attachLocation = false
                        }
                    },
                )
            }
            Spacer(Modifier.height(8.dp))

            // 状态卡
            StateCard(state)

            Spacer(Modifier.height(16.dp))

            // 主操作按钮组
            when (state) {
                is CameraOcrState.Idle, is CameraOcrState.Failed -> {
                    Button(
                        onClick = {
                            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.PhotoCamera, contentDescription = null)
                        Spacer(Modifier.height(0.dp))
                        Text("  拍照")
                    }
                }
                is CameraOcrState.Recognized -> {
                    val recognized = state as CameraOcrState.Recognized
                    // 自动塞 OCR 文本到编辑框（仅初次）
                    if (editedText.isEmpty()) {
                        editedText = recognized.text
                    }
                    OutlinedTextField(
                        value = noteTitle,
                        onValueChange = { noteTitle = it },
                        label = { Text("标题") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = editedText,
                        onValueChange = { editedText = it },
                        label = { Text("OCR 文本（可编辑）") },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedButton(
                            onClick = {
                                editedText = ""
                                noteTitle = ""
                                viewModel.reset()
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text("丢弃") }
                        Button(
                            onClick = {
                                val title = noteTitle.ifBlank { "OCR ${System.currentTimeMillis()}" }
                                viewModel.saveToKb(
                                    title = title,
                                    contentOverride = editedText,
                                    attachLocation = attachLocation,
                                )
                            },
                            enabled = editedText.isNotBlank(),
                            modifier = Modifier.weight(1f),
                        ) { Text(if (attachLocation) "保存 + 📍" else "保存到 KB") }
                    }
                }
                is CameraOcrState.Saved -> {
                    Button(
                        onClick = {
                            editedText = ""
                            noteTitle = ""
                            viewModel.reset()
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("再来一张") }
                }
                else -> {
                    // Encoding / Recognizing / Saving — 进度由 StateCard 显示，禁用主按钮
                }
            }

            Spacer(Modifier.height(12.dp))

            OutlinedButton(
                onClick = onBack,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("返回") }
        }
    }
}

@Composable
private fun StateCard(state: CameraOcrState) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        )
    ) {
        Box(modifier = Modifier.padding(16.dp), contentAlignment = Alignment.CenterStart) {
            when (val s = state) {
                is CameraOcrState.Idle -> Text("待拍照…", style = MaterialTheme.typography.bodyMedium)
                is CameraOcrState.Encoding -> ProgressRow("正在准备图片…")
                is CameraOcrState.Recognizing -> ProgressRow("桌面 LLM 识别中…")
                is CameraOcrState.Recognized -> Column {
                    Text(
                        "识别完成（语言 ${s.language}，置信度 ${"%.0f".format(s.confidence * 100)}%）",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                is CameraOcrState.Saving -> ProgressRow("正在保存「${s.title}」到知识库…")
                is CameraOcrState.Saved -> Column {
                    Text(
                        "✅ 已保存「${s.title}」",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        "noteId=${s.noteId}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                is CameraOcrState.Failed -> Column {
                    Text(
                        "⚠️ ${stageLabel(s.stage)}失败",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                    Text(s.message, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun ProgressRow(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(
            modifier = Modifier.height(18.dp),
            strokeWidth = 2.dp,
        )
        Spacer(Modifier.height(0.dp))
        Text("  $text", style = MaterialTheme.typography.bodyMedium)
    }
}

private fun stageLabel(stage: CameraOcrState.Failed.Stage): String = when (stage) {
    CameraOcrState.Failed.Stage.ENCODE -> "图片编码"
    CameraOcrState.Failed.Stage.RECOGNIZE -> "OCR"
    CameraOcrState.Failed.Stage.SAVE -> "保存"
}

private fun launchCamera(
    context: Context,
    launcher: androidx.activity.result.ActivityResultLauncher<Uri>,
    onTempReady: (File, Uri) -> Unit,
) {
    val cacheDir = File(context.cacheDir, "ocr").apply { mkdirs() }
    val tmp = File(cacheDir, "ocr_${System.currentTimeMillis()}.jpg")
    val uri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        tmp,
    )
    onTempReady(tmp, uri)
    launcher.launch(uri)
}
