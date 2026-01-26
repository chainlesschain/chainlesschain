package com.chainlesschain.android.feature.p2p.ui.call.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

/**
 * 快速拨打对话框
 *
 * 用于选择语音或视频通话
 *
 * @param contactName 联系人名称
 * @param contactDid 联系人DID
 * @param onDismiss 关闭对话框回调
 * @param onAudioCall 语音通话回调
 * @param onVideoCall 视频通话回调
 *
 * @since v0.32.0
 */
@Composable
fun QuickCallDialog(
    contactName: String,
    contactDid: String,
    onDismiss: () -> Unit,
    onAudioCall: () -> Unit,
    onVideoCall: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            shape = MaterialTheme.shapes.large
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // 标题
                Text(
                    text = "呼叫 $contactName",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )

                // 分隔线
                Divider()

                // 语音通话按钮
                OutlinedButton(
                    onClick = {
                        onAudioCall()
                        onDismiss()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = Icons.Default.Call,
                        contentDescription = null,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("语音通话")
                }

                // 视频通话按钮
                Button(
                    onClick = {
                        onVideoCall()
                        onDismiss()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = Icons.Default.Videocam,
                        contentDescription = null,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("视频通话")
                }

                // 取消按钮
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("取消")
                }
            }
        }
    }
}
