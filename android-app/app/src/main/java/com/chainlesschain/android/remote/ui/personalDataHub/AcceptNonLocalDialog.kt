package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable

/**
 * Phase 14.1 — 非本地 LLM 二次确认对话框
 *
 * 桌面 AnalysisEngine 隐私 gate 拒绝非本地 LLM 时弹此弹窗。用户点击「我同意」后
 * ViewModel 携 `acceptNonLocal=true` 重发同一问题；点击「取消」则丢弃。
 */
@Composable
fun AcceptNonLocalDialog(
    onAccept: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("当前 LLM 不是本地模型") },
        text = {
            Text(
                "桌面端 LLM 不在本地白名单（如 Anthropic / 火山 / Gemini / DeepSeek 等）。" +
                "继续提问会把你的事件摘要发到该提供方。\n\n" +
                "如果你接受这个风险（例：仅本次需更强模型），点「我同意」；否则建议先在桌面端切回 Ollama。"
            )
        },
        confirmButton = {
            TextButton(onClick = onAccept) { Text("我同意，继续") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        }
    )
}
