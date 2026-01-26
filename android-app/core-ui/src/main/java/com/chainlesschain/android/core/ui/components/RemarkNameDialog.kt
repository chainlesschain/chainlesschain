package com.chainlesschain.android.core.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * 备注名编辑对话框
 *
 * @param currentRemarkName 当前备注名（可能为空）
 * @param originalNickname 原始昵称（用于提示）
 * @param onDismiss 取消回调
 * @param onConfirm 确认回调，参数为新的备注名（null表示清除备注）
 */
@Composable
fun RemarkNameDialog(
    currentRemarkName: String?,
    originalNickname: String,
    onDismiss: () -> Unit,
    onConfirm: (String?) -> Unit
) {
    var remarkName by remember { mutableStateOf(currentRemarkName ?: "") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text("设置备注名")
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // 原始昵称提示
                Text(
                    text = "原始昵称: $originalNickname",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // 备注名输入框
                OutlinedTextField(
                    value = remarkName,
                    onValueChange = { remarkName = it },
                    label = { Text("备注名") },
                    placeholder = { Text("输入备注名") },
                    singleLine = true,
                    trailingIcon = {
                        if (remarkName.isNotEmpty()) {
                            IconButton(onClick = { remarkName = "" }) {
                                Icon(
                                    imageVector = Icons.Default.Clear,
                                    contentDescription = "清除"
                                )
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                )

                // 提示文字
                Text(
                    text = "备注名仅自己可见，不会同步给对方",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    // 如果输入为空，则传递null表示清除备注
                    val finalRemarkName = remarkName.trim().ifEmpty { null }
                    onConfirm(finalRemarkName)
                }
            ) {
                Text("保存")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}
