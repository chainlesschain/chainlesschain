package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.pdh.email.EmailVendor

/**
 * §2.3 D6.2 — IMAP 凭据输入 dialog. 4 vendor 通用 dialog (host/port 默认从
 * [EmailVendor] 派生但用户可改 — 公司自建邮箱场景)。
 *
 * 字段：
 *  - email user (邮箱地址，自动加 @<vendor 默认 domain> 提示)
 *  - password (IMAP 密码 / 授权码 / App Password — 显隐切换)
 *  - imapHost (default 从 vendor 派生)
 *  - imapPort (default 993)
 *
 * Confirm 按钮 enabled 条件：user 非空 + password 非空 + host 非空 + port>0。
 *
 * Gmail vendor 警告：authNote 告诉用户 OAuth v0.2.1 / 临时用 App Password。
 */
@Composable
fun EmailCredentialsDialog(
    vendor: EmailVendor,
    initialUser: String? = null,
    initialPassword: String? = null,
    initialHost: String? = null,
    initialPort: Int? = null,
    onConfirm: (user: String, password: String, imapHost: String, imapPort: Int) -> Unit,
    onCancel: () -> Unit,
) {
    var user by remember { mutableStateOf(initialUser ?: "") }
    var password by remember { mutableStateOf(initialPassword ?: "") }
    var imapHost by remember { mutableStateOf(initialHost ?: vendor.imapHost) }
    var imapPortText by remember { mutableStateOf((initialPort ?: vendor.imapPort).toString()) }
    var showPassword by remember { mutableStateOf(false) }

    val parsedPort = imapPortText.toIntOrNull() ?: -1
    val canConfirm = user.isNotBlank() && password.isNotBlank() &&
        imapHost.isNotBlank() && parsedPort in 1..65_535

    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("${vendor.displayName} 凭据") },
        text = {
            Column {
                Text(
                    vendor.authNote,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = user,
                    onValueChange = { user = it.trim() },
                    label = { Text("邮箱地址") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text(if (vendor == EmailVendor.GMAIL) "App Password (16 位)" else "授权码 / 密码") },
                    singleLine = true,
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        TextButton(onClick = { showPassword = !showPassword }) {
                            Text(if (showPassword) "隐藏" else "显示")
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedTextField(
                        value = imapHost,
                        onValueChange = { imapHost = it.trim() },
                        label = { Text("IMAP host") },
                        singleLine = true,
                        modifier = Modifier.weight(2f),
                    )
                    OutlinedTextField(
                        value = imapPortText,
                        onValueChange = { imapPortText = it.filter { c -> c.isDigit() }.take(5) },
                        label = { Text("端口") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                            keyboardType = KeyboardType.Number,
                        ),
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "密码 / 授权码不会离开本机，加密保存在 EncryptedSharedPreferences。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(user, password, imapHost, parsedPort) },
                enabled = canConfirm,
            ) { Text("保存并同步") }
        },
        dismissButton = {
            TextButton(onClick = onCancel) { Text("取消") }
        },
    )
}
