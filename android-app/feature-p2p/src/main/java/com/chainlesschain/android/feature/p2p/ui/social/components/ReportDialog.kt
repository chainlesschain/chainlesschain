package com.chainlesschain.android.feature.p2p.ui.social.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Report
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.social.ReportReason

/**
 * 举报对话框
 *
 * @param onDismiss 关闭回调
 * @param onConfirm 确认回调，参数为 (reason, description)
 */
@Composable
fun ReportDialog(
    onDismiss: () -> Unit,
    onConfirm: (ReportReason, String?) -> Unit
) {
    var selectedReason by remember { mutableStateOf<ReportReason?>(null) }
    var description by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(Icons.Default.Report, contentDescription = null)
        },
        title = {
            Text("举报动态")
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "请选择举报原因",
                    style = MaterialTheme.typography.bodyMedium
                )

                // 举报原因选择
                Column(
                    modifier = Modifier.selectableGroup(),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    ReportReasonOption(
                        reason = ReportReason.SPAM,
                        label = "垃圾信息",
                        selected = selectedReason == ReportReason.SPAM,
                        onClick = { selectedReason = ReportReason.SPAM }
                    )
                    ReportReasonOption(
                        reason = ReportReason.HARASSMENT,
                        label = "骚扰",
                        selected = selectedReason == ReportReason.HARASSMENT,
                        onClick = { selectedReason = ReportReason.HARASSMENT }
                    )
                    ReportReasonOption(
                        reason = ReportReason.MISINFORMATION,
                        label = "不实信息",
                        selected = selectedReason == ReportReason.MISINFORMATION,
                        onClick = { selectedReason = ReportReason.MISINFORMATION }
                    )
                    ReportReasonOption(
                        reason = ReportReason.INAPPROPRIATE_CONTENT,
                        label = "不当内容",
                        selected = selectedReason == ReportReason.INAPPROPRIATE_CONTENT,
                        onClick = { selectedReason = ReportReason.INAPPROPRIATE_CONTENT }
                    )
                    ReportReasonOption(
                        reason = ReportReason.COPYRIGHT_VIOLATION,
                        label = "侵犯版权",
                        selected = selectedReason == ReportReason.COPYRIGHT_VIOLATION,
                        onClick = { selectedReason = ReportReason.COPYRIGHT_VIOLATION }
                    )
                    ReportReasonOption(
                        reason = ReportReason.OTHER,
                        label = "其他",
                        selected = selectedReason == ReportReason.OTHER,
                        onClick = { selectedReason = ReportReason.OTHER }
                    )
                }

                // 可选描述
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("详细描述（可选）") },
                    placeholder = { Text("请详细描述举报原因...") },
                    maxLines = 4,
                    minLines = 2
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    selectedReason?.let { reason ->
                        onConfirm(reason, description.ifBlank { null })
                    }
                },
                enabled = selectedReason != null
            ) {
                Text("提交举报")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

/**
 * 举报原因选项
 */
@Composable
private fun ReportReasonOption(
    reason: ReportReason,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .selectable(
                selected = selected,
                onClick = onClick,
                role = Role.RadioButton
            )
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        RadioButton(
            selected = selected,
            onClick = null
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium
        )
    }
}
