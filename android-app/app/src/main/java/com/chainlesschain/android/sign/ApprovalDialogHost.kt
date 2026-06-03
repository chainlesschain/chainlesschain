package com.chainlesschain.android.sign

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Warning
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
    val snackbarHostState = remember { SnackbarHostState() }

    // Snackbar 容器 — 渲染在 ApprovalDialog 同级。AlertDialog 关闭瞬间
    // pendingRequest 变 null → dialog 消失，下面的 Box 占满屏底部 align 出现 Snackbar。
    Box(modifier = Modifier.fillMaxSize()) {
        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
            snackbar = { data ->
                Snackbar(
                    snackbarData = data,
                    containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                    contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            },
        )
    }

    pending?.let { req ->
        val activity = context as? FragmentActivity
        val tier = remember { strongBoxKeyManager.detectMaxTier() }

        // 决策为同意时，如果多签链路还需其它 signer，在用户同意之后弹 Snackbar 提示
        // 等待 desktop U-Key（典型场景：phone 先签，desktop U-Key 后签）。
        val maybeShowPostSignToast: () -> Unit = {
            req.multisig?.let { ms ->
                if (!ms.isFinalSigner()) {
                    val remaining = ms.remainingAfterThisSign()
                    scope.launch {
                        // 提示文案与设计文档 §10 P0.3 验收 "签完仍 pending 时 toast
                        // '等待 desktop U-Key'" 对齐。剩余 >1 时多签 setup 即将变常态，
                        // 这里给具体数字让用户知道还差几把。
                        val msg = if (remaining <= 1) "等待 desktop U-Key"
                        else "等待 desktop U-Key 等 $remaining 个签名"
                        snackbarHostState.showSnackbar(message = msg)
                    }
                }
            }
        }

        ApprovalDialog(
            category = req.category,
            description = req.payloadDescription,
            payloadHash = req.payloadHash,
            requireBiometric = req.requireBiometric,
            multisig = req.multisig,
            tier = tier,
            onApprove = {
                if (!req.requireBiometric) {
                    approvalGate.respondToApproval(req.requestId, approved = true)
                    maybeShowPostSignToast()
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
                            maybeShowPostSignToast()
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
    category: ApprovalCategory,
    description: String,
    payloadHash: String,
    requireBiometric: Boolean,
    multisig: MultisigState?,
    tier: KeyTier,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                iconForCategory(category),
                contentDescription = null,
                tint = tintForCategory(category),
                modifier = Modifier.size(36.dp),
            )
        },
        title = { Text(titleForCategory(category)) },
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

                if (multisig != null) {
                    Spacer(Modifier.height(12.dp))
                    MultisigProgressSection(multisig)
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
                    text = footerForCategory(category, requireBiometric),
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
                    containerColor = tintForCategory(category),
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

// ===== v1.2 #20 P0.3 m-of-n 多签 progress section =====

@Composable
private fun MultisigProgressSection(state: MultisigState) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Default.Groups,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(14.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text(
                "多签进度",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(8.dp))
            Surface(
                shape = RoundedCornerShape(6.dp),
                color = MaterialTheme.colorScheme.primaryContainer,
            ) {
                Text(
                    text = state.progressLabel(),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
            Spacer(Modifier.width(6.dp))
            Text(
                text = "(本设备签后)",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        // 显示其它待签 signer（去掉本设备，本设备已在 dialog 上下文中）
        // 由于桌面给的 pendingSigners 集包含本设备，这里展示规模而非具体哪一个；
        // 用户对每个 signer DID 一般无认知，列前 2-3 个截短足够确认 "等谁"。
        val others = state.pendingSigners.take(3)
        if (others.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.HourglassEmpty,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(12.dp),
                )
                Spacer(Modifier.width(4.dp))
                val label = if (state.isFinalSigner()) {
                    "本设备为最后一签"
                } else {
                    val joined = others.joinToString("、") { state.shortDid(it) }
                    val suffix = if (state.pendingSigners.size > others.size) " +${state.pendingSigners.size - others.size}" else ""
                    "等签: $joined$suffix"
                }
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
}

// ===== M4 ApprovalUI category 适配辅助 =====

private fun iconForCategory(category: ApprovalCategory): ImageVector = when (category) {
    ApprovalCategory.Sign -> Icons.Default.Security
    ApprovalCategory.Cowork -> Icons.Default.Groups
    ApprovalCategory.Marketplace -> Icons.Default.ShoppingCart
    ApprovalCategory.SystemCritical -> Icons.Default.Warning
}

@Composable
private fun tintForCategory(category: ApprovalCategory): androidx.compose.ui.graphics.Color = when (category) {
    ApprovalCategory.Sign -> MaterialTheme.colorScheme.primary
    ApprovalCategory.Cowork -> MaterialTheme.colorScheme.primary
    ApprovalCategory.Marketplace -> MaterialTheme.colorScheme.tertiary
    ApprovalCategory.SystemCritical -> MaterialTheme.colorScheme.error
}

private fun titleForCategory(category: ApprovalCategory): String = when (category) {
    ApprovalCategory.Sign -> "签名请求确认"
    ApprovalCategory.Cowork -> "Cowork 任务审批"
    ApprovalCategory.Marketplace -> "交易审批"
    ApprovalCategory.SystemCritical -> "关键操作审批"
}

private fun footerForCategory(category: ApprovalCategory, requireBiometric: Boolean): String {
    val bioSuffix = if (requireBiometric) "，需先通过生物识别。" else "。"
    return when (category) {
        ApprovalCategory.Sign ->
            "仅当确认这是你发起的操作时才同意。签名后桌面将拿到 Ed25519 签名$bioSuffix"
        ApprovalCategory.Cowork ->
            "Cowork 多智能体协作请求审批。同意后桌面会启动该任务$bioSuffix"
        ApprovalCategory.Marketplace ->
            "⚠️ 高风险交易/支付操作，仅当 100% 确认时同意$bioSuffix"
        ApprovalCategory.SystemCritical ->
            "⚠️ 系统级关键操作（不可逆 / 影响桌面状态）。请确认这是预期行为$bioSuffix"
    }
}

