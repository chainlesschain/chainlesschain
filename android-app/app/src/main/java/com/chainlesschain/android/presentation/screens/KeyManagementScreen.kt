package com.chainlesschain.android.presentation.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.did.manager.DIDIdentity
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.did.manager.TrustedDevice
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * DID 密钥管理页面（#18 Phase 1）
 *
 * 当前能力：
 *   - 查看当前 DID（did:key:...）+ 设备名 + 创建时间
 *   - 查看公钥 hex
 *   - 复制 DID / 公钥到剪贴板
 *   - 查看可信设备列表（pairing 过的对端）
 *   - 重置 DID（红色 destructive，二次确认）
 *
 * 暂不实现（Phase 2）：
 *   - 私钥 / 助记词导出（要叠生物识别 guard，避免一键泄露）
 *   - 助记词导入恢复（需要 BIP-39 + 重新派生 Ed25519）
 *   - U-Key / FIDO2 硬件绑定
 */
@HiltViewModel
class KeyManagementViewModel @Inject constructor(
    val didManager: DIDManager
) : ViewModel() {

    val identity: StateFlow<DIDIdentity?> = didManager.currentIdentity
    val trustedDevices: StateFlow<List<TrustedDevice>> = didManager.trustedDevicesList

    fun resetIdentity(deviceName: String, onDone: () -> Unit) {
        viewModelScope.launch(Dispatchers.IO) {
            // createIdentity 内部会 saveIdentity 覆盖旧的
            didManager.createIdentity(deviceName)
            onDone()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KeyManagementScreen(
    onNavigateBack: () -> Unit,
    viewModel: KeyManagementViewModel = hiltViewModel()
) {
    val identity by viewModel.identity.collectAsStateWithLifecycle()
    val trustedDevices by viewModel.trustedDevices.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var showResetDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("密钥管理") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回"
                        )
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        if (identity == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text("正在加载身份信息...")
            }
        } else {
            KeyManagementContent(
                identity = identity!!,
                trustedDevices = trustedDevices,
                contentPadding = padding,
                onCopy = { label, value ->
                    copyToClipboard(context, label, value)
                    scope.launch {
                        snackbarHostState.showSnackbar("$label 已复制到剪贴板")
                    }
                },
                onResetClick = { showResetDialog = true }
            )
        }
    }

    if (showResetDialog) {
        AlertDialog(
            onDismissRequest = { showResetDialog = false },
            icon = {
                Icon(
                    Icons.Default.DeleteForever,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(36.dp)
                )
            },
            title = { Text("重置身份？") },
            text = {
                Text(
                    "重置后会生成全新的 DID。当前 DID 关联的所有数据（聊天、社交、可信设备配对）将无法继续被签名验证。\n\n" +
                        "此操作不可撤销 —— 除非你已导出助记词（暂未支持），否则旧 DID 永久丢失。\n\n" +
                        "确定要继续吗？"
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showResetDialog = false
                        viewModel.resetIdentity(android.os.Build.MODEL ?: "Unknown") {
                            scope.launch {
                                snackbarHostState.showSnackbar("已生成新 DID")
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError
                    )
                ) { Text("重置") }
            },
            dismissButton = {
                TextButton(onClick = { showResetDialog = false }) { Text("取消") }
            }
        )
    }
}

@Composable
private fun KeyManagementContent(
    identity: DIDIdentity,
    trustedDevices: List<TrustedDevice>,
    contentPadding: PaddingValues,
    onCopy: (label: String, value: String) -> Unit,
    onResetClick: () -> Unit
) {
    val publicKeyHex = remember(identity) { identity.keyPair.publicKey.toHex() }
    val createdAt = remember(identity.createdAt) {
        java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.SIMPLIFIED_CHINESE)
            .format(java.util.Date(identity.createdAt))
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 当前 DID 卡片
        item {
            InfoCard(
                icon = Icons.Default.Fingerprint,
                title = "去中心化身份 (DID)",
                value = identity.did,
                subline = "${identity.deviceName} · 创建于 $createdAt",
                monospace = true,
                onCopy = { onCopy("DID", identity.did) }
            )
        }

        // 公钥卡片
        item {
            InfoCard(
                icon = Icons.Default.Key,
                title = "公钥 (Ed25519, hex)",
                value = publicKeyHex,
                subline = "${identity.keyPair.publicKey.size} bytes · 用于他人验证你的签名",
                monospace = true,
                onCopy = { onCopy("公钥", publicKeyHex) }
            )
        }

        // 可信设备
        item {
            Text(
                text = "可信设备 (${trustedDevices.size})",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(start = 4.dp, top = 4.dp)
            )
        }
        if (trustedDevices.isEmpty()) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    ),
                    elevation = CardDefaults.cardElevation(0.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(
                            Icons.Outlined.Info,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            "尚未配对任何设备。在 P2P 设备页面扫码配对后，对端 DID 会出现在这里。",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }
        } else {
            items(trustedDevices) { device ->
                TrustedDeviceRow(device = device, onCopyDid = {
                    onCopy("设备 DID", device.did)
                })
            }
        }

        // 危险区
        item {
            Spacer(modifier = Modifier.height(8.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "危险操作",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(start = 4.dp)
            )
        }
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.4f)
                ),
                elevation = CardDefaults.cardElevation(0.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "重置 DID 身份",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onErrorContainer
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        "生成全新的 DID 替换当前。旧 DID 不可恢复。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.85f)
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Button(
                        onClick = onResetClick,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error,
                            contentColor = MaterialTheme.colorScheme.onError
                        )
                    ) {
                        Icon(Icons.Default.DeleteForever, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("重置 DID")
                    }
                }
            }
        }
    }
}

@Composable
private fun InfoCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    value: String,
    subline: String,
    monospace: Boolean,
    onCopy: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(Modifier.size(8.dp))
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = onCopy, modifier = Modifier.size(36.dp)) {
                    Icon(
                        Icons.Default.ContentCopy,
                        contentDescription = "复制",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = value,
                style = MaterialTheme.typography.bodySmall,
                fontFamily = if (monospace) FontFamily.Monospace else FontFamily.Default,
                fontSize = if (monospace) 12.sp else 14.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = subline,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun TrustedDeviceRow(device: TrustedDevice, onCopyDid: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onCopyDid),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Surface(
                modifier = Modifier.size(36.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Default.Devices,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = device.deviceName,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = device.did,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1
                )
            }
            Icon(
                Icons.Default.ContentCopy,
                contentDescription = "复制 DID",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}

private fun copyToClipboard(context: Context, label: String, value: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, value))
}

private fun ByteArray.toHex(): String =
    joinToString("") { "%02x".format(it) }
