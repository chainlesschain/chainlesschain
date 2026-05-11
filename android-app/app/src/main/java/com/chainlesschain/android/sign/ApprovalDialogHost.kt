package com.chainlesschain.android.sign

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.security.strongbox.KeyTier
import com.chainlesschain.android.core.security.strongbox.StrongBoxKeyManager
import com.chainlesschain.android.feature.auth.data.biometric.BiometricAuthenticator
import kotlinx.coroutines.launch

/**
 * 全局 ApprovalDialog 宿主 Composable。挂在 [MainActivity] Compose 根下，
 * 观察 [AndroidApprovalGate.pendingRequest]，非 null 即弹出确认对话框。
 *
 * 流程：
 *  1. backend 调 `approvalGate.requestApproval(...)` → 推到 [AndroidApprovalGate.pendingRequest]
 *  2. 本 Host 检测到非 null → 弹 [ApprovalDialog]
 *  3. 用户：
 *     - 点"同意并签名"：
 *       - 若 requireBiometric=true → 调起 BiometricPrompt
 *         - 成功 → `respondToApproval(approved=true)`
 *         - 失败 / 取消 → `respondToApproval(approved=false, "biometric-failed")`
 *       - 若 requireBiometric=false → 直接 `respondToApproval(approved=true)`
 *     - 点"拒绝" → `respondToApproval(approved=false, "user-declined")`
 *     - dismiss（系统手势 / 旋转） → `cancelPending("dismissed")`
 *  4. backend coroutine 收到 ApprovalResult，继续执行（签名 / 拒签）
 *
 * 当前是为反向 sign.request 设计；后续 M4 D2 桌面侧 approval 通道接进 Android 时
 * 走同一个 gate。
 */
@Composable
fun ApprovalDialogHost(
    approvalGate: AndroidApprovalGate,
    biometricAuthenticator: BiometricAuthenticator,
    strongBoxKeyManager: StrongBoxKeyManager,
) {
    val pending by approvalGate.pendingRequest.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    pending?.let { req ->
        val activity = context as? FragmentActivity
        val tier = remember { strongBoxKeyManager.detectMaxTier() }

        ApprovalDialog(
            description = req.payloadDescription,
            payloadHash = req.payloadHash,
            requireBiometric = req.requireBiometric,
            tier = tier,
            onApprove = {
                if (!req.requireBiometric) {
                    approvalGate.respondToApproval(req.requestId, approved = true)
                    return@ApprovalDialog
                }
                if (activity == null) {
                    approvalGate.respondToApproval(
                        req.requestId,
                        approved = false,
                        deniedReason = "no-fragment-activity",
                    )
                    return@ApprovalDialog
                }
                scope.launch {
                    when (val result = biometricAuthenticator.authenticate(activity)) {
                        is Result.Success -> {
                            approvalGate.respondToApproval(req.requestId, approved = true)
                        }
                        is Result.Error -> {
                            approvalGate.respondToApproval(
                                req.requestId,
                                approved = false,
                                deniedReason = "biometric-failed: ${result.message ?: result.exception.javaClass.simpleName}",
                            )
                        }
                        Result.Loading -> {
                            // suspend authenticate() 不应返回 Loading (它要么成功要么失败)
                            // 兜底，避免 IDE / runtime 错乱
                            approvalGate.respondToApproval(
                                req.requestId,
                                approved = false,
                                deniedReason = "biometric-loading-unexpected",
                            )
                        }
                    }
                }
            },
            onDeny = {
                approvalGate.respondToApproval(
                    req.requestId,
                    approved = false,
                    deniedReason = "user-declined",
                )
            },
            onDismiss = {
                approvalGate.cancelPending("dismissed")
            },
        )
    }
}

@Composable
private fun ApprovalDialog(
    description: String,
    payloadHash: String,
    requireBiometric: Boolean,
    tier: KeyTier,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                Icons.Default.Security,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(36.dp),
            )
        },
        title = { Text("签名请求确认") },
        text = {
            Column {
                Text(
                    text = description.ifBlank { "桌面发起一次签名操作" },
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(12.dp))

                // Tier indicator
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = MaterialTheme.colorScheme.tertiaryContainer,
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Default.Lock,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onTertiaryContainer,
                                modifier = Modifier.size(14.dp),
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                tier.displayLabel,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onTertiaryContainer,
                            )
                        }
                    }
                    if (requireBiometric) {
                        Spacer(Modifier.width(8.dp))
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = MaterialTheme.colorScheme.primaryContainer,
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(
                                    Icons.Default.Fingerprint,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                    modifier = Modifier.size(14.dp),
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    "需生物识别",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))
                Text(
                    "待签名内容哈希:",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(4.dp))
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = payloadHash.take(16) + "…" + payloadHash.takeLast(8),
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(8.dp),
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "仅当确认这是你发起的操作时才同意。签名后桌面将拿到 Ed25519 签名" +
                        if (requireBiometric) "，需先通过生物识别。" else "。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = if (tier.isHardwareBacked) FontWeight.Normal else FontWeight.SemiBold,
                )
            }
        },
        confirmButton = {
            Button(
                onClick = onApprove,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                ),
            ) {
                if (requireBiometric) {
                    Icon(Icons.Default.Fingerprint, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                }
                Text(if (requireBiometric) "同意并验证" else "同意")
            }
        },
        dismissButton = {
            TextButton(onClick = onDeny) { Text("拒绝") }
        },
    )
}

