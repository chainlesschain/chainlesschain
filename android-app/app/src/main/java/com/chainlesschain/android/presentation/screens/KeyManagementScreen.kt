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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Warning
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import com.chainlesschain.android.core.did.wallet.DIDIdentityMeta
import com.chainlesschain.android.core.did.wallet.MnemonicService
import com.chainlesschain.android.core.did.wallet.NewIdentityResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * DID 密钥管理（v0.37 重写：接 M2 D2+D3 wallet API）
 *
 * 升级：
 *   - 多 DID 列表（[DIDManager.listIdentities]）+ 切换激活（[DIDManager.switchActive]）
 *   - 新建 DID：含助记词 + biometric 绑定 toggle（[DIDManager.createIdentityWithMnemonic]）
 *   - 导入助记词（[DIDManager.importFromMnemonic]）
 *   - 助记词抄录确认（[DIDManager.markMnemonicVerified]）
 *   - 旧"重置 DID" 路径保留，但更明显警告（不可恢复 / 无助记词）
 *
 * 暂不实现：
 *   - 私钥导出（永远不暴露）
 *   - 删除/撤销 DID（v1.1 配 did.revoke 凭证）
 *   - BiometricPrompt 实际拦截（M2 D3 仅完成 Keystore 端 binding；UI gate 待 ApprovalGate 真接入）
 */
@HiltViewModel
class KeyManagementViewModel @Inject constructor(
    val didManager: DIDManager,
    private val mnemonicService: MnemonicService,
) : ViewModel() {

    val identity: StateFlow<DIDIdentity?> = didManager.currentIdentity
    val trustedDevices: StateFlow<List<TrustedDevice>> = didManager.trustedDevicesList

    /** 全部 DID 列表（衍生自 currentIdentity 变化，每次 active 切换重新拉一次）。 */
    val identities: StateFlow<List<DIDIdentityMeta>> = didManager.currentIdentity
        .map { didManager.listIdentities() }
        .let { flow ->
            val initial = MutableStateFlow(emptyList<DIDIdentityMeta>())
            viewModelScope.launch {
                flow.collect { initial.value = it }
            }
            initial.asStateFlow()
        }

    /** 助记词新建后的一次性 reveal payload。UI 展示完 + 用户确认后清空。 */
    private val _pendingMnemonic = MutableStateFlow<NewIdentityResult?>(null)
    val pendingMnemonic: StateFlow<NewIdentityResult?> = _pendingMnemonic.asStateFlow()

    /** 异步操作的 toast 通道。 */
    private val _toastMessage = MutableStateFlow<String?>(null)
    val toastMessage: StateFlow<String?> = _toastMessage.asStateFlow()

    fun consumeToast() {
        _toastMessage.value = null
    }

    fun createWithMnemonic(deviceName: String, requireBiometric: Boolean) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val result = didManager.createIdentityWithMnemonic(deviceName, requireBiometric)
                _pendingMnemonic.value = result
            } catch (e: Exception) {
                _toastMessage.value = "新建失败：${e.message ?: e.javaClass.simpleName}"
            }
        }
    }

    fun confirmMnemonicWrittenDown(did: String) {
        viewModelScope.launch(Dispatchers.IO) {
            didManager.markMnemonicVerified(did)
            _pendingMnemonic.value = null
            _toastMessage.value = "已标记助记词已抄录"
        }
    }

    /** 用户取消（不抄写助记词）。仍保留 DID（已加密落盘），但 mnemonicVerified = false。 */
    fun dismissMnemonicReveal() {
        _pendingMnemonic.value = null
    }

    fun importFromMnemonic(rawText: String, deviceName: String, requireBiometric: Boolean) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                // Tokenize: 把任何非字母字符当分隔（空格 / 换行 / 逗号 / "1." 序号 / 制表符
                // 全消化）。BIP-39 词全是 lowercase ASCII letters，过滤后留下纯词。
                // 兼容用户从 MnemonicRevealDialog 长按选中复制把序号一起带上的场景。
                val words = rawText
                    .lowercase()
                    .split(Regex("[^a-z]+"))
                    .filter { it.length in 3..10 } // BIP-39 词长度 3-8，留 buffer
                if (words.size !in BIP39_WORD_COUNTS) {
                    _toastMessage.value = "助记词长度错误（解析出 ${words.size} 个词；" +
                        "BIP-39 要求 12/15/18/21/24）"
                    return@launch
                }
                if (!mnemonicService.validate(words)) {
                    _toastMessage.value =
                        "助记词校验失败（可能拼写错、最后一个词不对、或来自其它词表）"
                    return@launch
                }
                val identity = didManager.importFromMnemonic(words, deviceName, requireBiometric)
                _toastMessage.value = "已导入：${identity.did.take(20)}…"
            } catch (e: Exception) {
                _toastMessage.value = "导入失败：${e.message ?: e.javaClass.simpleName}"
            }
        }
    }

    fun switchActive(did: String) {
        viewModelScope.launch(Dispatchers.IO) {
            val ok = didManager.switchActive(did)
            _toastMessage.value = if (ok) "已切换激活 DID" else "切换失败"
        }
    }

    /** 旧"重置"路径（无助记词版本）— 保留向后兼容。 */
    fun resetIdentity(deviceName: String, onDone: () -> Unit) {
        viewModelScope.launch(Dispatchers.IO) {
            didManager.createIdentity(deviceName)
            onDone()
        }
    }
}

private val BIP39_WORD_COUNTS = setOf(12, 15, 18, 21, 24)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KeyManagementScreen(
    onNavigateBack: () -> Unit,
    viewModel: KeyManagementViewModel = hiltViewModel(),
) {
    val identity by viewModel.identity.collectAsStateWithLifecycle()
    val identities by viewModel.identities.collectAsStateWithLifecycle()
    val trustedDevices by viewModel.trustedDevices.collectAsStateWithLifecycle()
    val pendingMnemonic by viewModel.pendingMnemonic.collectAsStateWithLifecycle()
    val toast by viewModel.toastMessage.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    var showCreateDialog by remember { mutableStateOf(false) }
    var showImportDialog by remember { mutableStateOf(false) }
    var showResetDialog by remember { mutableStateOf(false) }

    // ViewModel toast → snackbar bridge
    LaunchedEffect(toast) {
        toast?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.consumeToast()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("密钥管理") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        if (identity == null) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { Text("正在加载身份信息...") }
        } else {
            KeyManagementContent(
                identity = identity!!,
                identities = identities,
                trustedDevices = trustedDevices,
                contentPadding = padding,
                onCopy = { label, value ->
                    copyToClipboard(context, label, value)
                    scope.launch { snackbarHostState.showSnackbar("$label 已复制到剪贴板") }
                },
                onSwitchActive = viewModel::switchActive,
                onCreateClick = { showCreateDialog = true },
                onImportClick = { showImportDialog = true },
                onResetClick = { showResetDialog = true },
            )
        }
    }

    if (showCreateDialog) {
        CreateIdentityDialog(
            onDismiss = { showCreateDialog = false },
            onConfirm = { deviceName, requireBiometric ->
                showCreateDialog = false
                viewModel.createWithMnemonic(deviceName, requireBiometric)
            },
        )
    }

    if (showImportDialog) {
        ImportMnemonicDialog(
            onDismiss = { showImportDialog = false },
            onConfirm = { words, deviceName, requireBiometric ->
                showImportDialog = false
                viewModel.importFromMnemonic(words, deviceName, requireBiometric)
            },
        )
    }

    pendingMnemonic?.let { result ->
        MnemonicRevealDialog(
            result = result,
            onConfirmWritten = { viewModel.confirmMnemonicWrittenDown(result.identity.did) },
            onDismiss = { viewModel.dismissMnemonicReveal() },
        )
    }

    if (showResetDialog) {
        AlertDialog(
            onDismissRequest = { showResetDialog = false },
            icon = {
                Icon(
                    Icons.Default.DeleteForever,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(36.dp),
                )
            },
            title = { Text("重置当前 DID？") },
            text = {
                Text(
                    "生成全新的 DID 替代当前激活的。新 DID **不会**生成助记词——这意味着" +
                        "如果设备丢失，该 DID 永久无法恢复。\n\n" +
                        "推荐改用 \"新建 DID（含助记词）\" 路径以获得可恢复保障。\n\n" +
                        "确定要继续吗？",
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showResetDialog = false
                        viewModel.resetIdentity(android.os.Build.MODEL ?: "Unknown") {
                            scope.launch { snackbarHostState.showSnackbar("已生成新 DID（无助记词）") }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                ) { Text("确认重置") }
            },
            dismissButton = {
                TextButton(onClick = { showResetDialog = false }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun KeyManagementContent(
    identity: DIDIdentity,
    identities: List<DIDIdentityMeta>,
    trustedDevices: List<TrustedDevice>,
    contentPadding: PaddingValues,
    onCopy: (label: String, value: String) -> Unit,
    onSwitchActive: (String) -> Unit,
    onCreateClick: () -> Unit,
    onImportClick: () -> Unit,
    onResetClick: () -> Unit,
) {
    val publicKeyHex = remember(identity) { identity.keyPair.publicKey.toHex() }
    val createdAt = remember(identity.createdAt) {
        java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.SIMPLIFIED_CHINESE)
            .format(java.util.Date(identity.createdAt))
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(contentPadding),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // 激活 DID
        item {
            InfoCard(
                icon = Icons.Default.Fingerprint,
                title = "激活 DID",
                value = identity.did,
                subline = "${identity.deviceName} · 创建于 $createdAt",
                monospace = true,
                onCopy = { onCopy("DID", identity.did) },
            )
        }

        // 公钥
        item {
            InfoCard(
                icon = Icons.Default.Key,
                title = "公钥 (Ed25519, hex)",
                value = publicKeyHex,
                subline = "${identity.keyPair.publicKey.size} bytes · 用于他人验证你的签名",
                monospace = true,
                onCopy = { onCopy("公钥", publicKeyHex) },
            )
        }

        // 全部身份列表
        item {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(start = 4.dp, top = 4.dp),
            ) {
                Text(
                    text = "全部身份 (${identities.size})",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onCreateClick) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("新建")
                }
                TextButton(onClick = onImportClick) {
                    Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("导入")
                }
            }
        }
        items(identities, key = { it.did }) { meta ->
            IdentityRow(
                meta = meta,
                onSwitchActive = { onSwitchActive(meta.did) },
                onCopyDid = { onCopy("DID", meta.did) },
            )
        }

        // 可信设备
        item {
            Text(
                text = "可信设备 (${trustedDevices.size})",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(start = 4.dp, top = 4.dp),
            )
        }
        if (trustedDevices.isEmpty()) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    elevation = CardDefaults.cardElevation(0.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(Icons.Outlined.Info, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            "尚未配对任何设备。在 P2P 设备页面扫码配对后，对端 DID 会出现在这里。",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        } else {
            items(trustedDevices) { device ->
                TrustedDeviceRow(device = device, onCopyDid = { onCopy("设备 DID", device.did) })
            }
        }

        // 危险操作
        item {
            Spacer(modifier = Modifier.height(8.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "危险操作",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(start = 4.dp),
            )
        }
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.4f),
                ),
                elevation = CardDefaults.cardElevation(0.dp),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "重置当前 DID（无助记词）",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        "生成新 DID 替代当前激活。**没有**助记词备份，丢设备等于丢身份。" +
                            "推荐改用上方\"新建\"按钮含助记词路径。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.85f),
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Button(
                        onClick = onResetClick,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error,
                            contentColor = MaterialTheme.colorScheme.onError,
                        ),
                    ) {
                        Icon(Icons.Default.DeleteForever, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("重置当前 DID")
                    }
                }
            }
        }
    }
}

@Composable
private fun IdentityRow(
    meta: DIDIdentityMeta,
    onSwitchActive: () -> Unit,
    onCopyDid: () -> Unit,
) {
    val createdAt = remember(meta.createdAt) {
        java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.SIMPLIFIED_CHINESE)
            .format(java.util.Date(meta.createdAt))
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (meta.isActive) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f)
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        elevation = CardDefaults.cardElevation(0.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (meta.isActive) Icons.Default.RadioButtonChecked else Icons.Default.RadioButtonUnchecked,
                    contentDescription = if (meta.isActive) "已激活" else "未激活",
                    tint = if (meta.isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = meta.deviceName,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                if (meta.requireBiometric) {
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = MaterialTheme.colorScheme.tertiaryContainer,
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Default.Lock,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onTertiaryContainer,
                                modifier = Modifier.size(12.dp),
                            )
                            Spacer(Modifier.width(2.dp))
                            Text(
                                "Biometric",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onTertiaryContainer,
                            )
                        }
                    }
                    Spacer(Modifier.width(4.dp))
                }
                if (meta.hasMnemonic) {
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = if (meta.mnemonicVerified) {
                            MaterialTheme.colorScheme.secondaryContainer
                        } else {
                            MaterialTheme.colorScheme.errorContainer
                        },
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                if (meta.mnemonicVerified) Icons.Default.CheckCircle else Icons.Default.Warning,
                                contentDescription = null,
                                tint = if (meta.mnemonicVerified) {
                                    MaterialTheme.colorScheme.onSecondaryContainer
                                } else {
                                    MaterialTheme.colorScheme.onErrorContainer
                                },
                                modifier = Modifier.size(12.dp),
                            )
                            Spacer(Modifier.width(2.dp))
                            Text(
                                if (meta.mnemonicVerified) "已备份" else "未备份",
                                style = MaterialTheme.typography.labelSmall,
                                color = if (meta.mnemonicVerified) {
                                    MaterialTheme.colorScheme.onSecondaryContainer
                                } else {
                                    MaterialTheme.colorScheme.onErrorContainer
                                },
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(
                text = meta.did,
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "创建于 $createdAt",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onCopyDid, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.Default.ContentCopy,
                        contentDescription = "复制 DID",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                }
                if (!meta.isActive) {
                    TextButton(onClick = onSwitchActive) {
                        Icon(Icons.Default.SwapHoriz, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(2.dp))
                        Text("切换", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun CreateIdentityDialog(
    onDismiss: () -> Unit,
    onConfirm: (deviceName: String, requireBiometric: Boolean) -> Unit,
) {
    var deviceName by remember { mutableStateOf(android.os.Build.MODEL ?: "Unknown") }
    var requireBiometric by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                Icons.Default.Add,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(32.dp),
            )
        },
        title = { Text("新建 DID（含助记词）") },
        text = {
            Column {
                Text(
                    "生成全新 DID + 24 字 BIP-39 助记词。**助记词只展示一次**，必须立刻抄写。" +
                        "丢失助记词 = 设备丢失即身份丢失。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = deviceName,
                    onValueChange = { deviceName = it },
                    label = { Text("设备名称") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "绑定生物识别",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            "解锁此 DID 需 BiometricPrompt（建议高风险 DID 开启）",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(checked = requireBiometric, onCheckedChange = { requireBiometric = it })
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(deviceName.ifBlank { "Unknown" }, requireBiometric) },
                enabled = deviceName.isNotBlank(),
            ) { Text("生成") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun MnemonicRevealDialog(
    result: NewIdentityResult,
    onConfirmWritten: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                Icons.Default.Warning,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(36.dp),
            )
        },
        title = { Text("抄录助记词") },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()),
            ) {
                Text(
                    "请把以下 ${result.mnemonic.size} 个词**按顺序**抄写到纸上保存。" +
                        "这是恢复该 DID 的唯一方式 —— 截图 / 拷贝到聊天 / 邮件 / 云笔记都不安全。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
                Spacer(Modifier.height(12.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    elevation = CardDefaults.cardElevation(0.dp),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        // 4 列 grid，但 LazyColumn 内不能用 LazyGrid，所以手动分行
                        result.mnemonic.chunked(4).forEachIndexed { rowIdx, row ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                row.forEachIndexed { colIdx, word ->
                                    val n = rowIdx * 4 + colIdx + 1
                                    MnemonicWordCell(
                                        index = n,
                                        word = word,
                                        modifier = Modifier.weight(1f),
                                    )
                                }
                                // 凑齐 4 列（最后一行可能不足）
                                repeat(4 - row.size) {
                                    Spacer(Modifier.weight(1f))
                                }
                            }
                            if (rowIdx < result.mnemonic.chunked(4).size - 1) {
                                Spacer(Modifier.height(6.dp))
                            }
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))
                Text(
                    "新 DID: ${result.identity.did}",
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            Button(onClick = onConfirmWritten) { Text("我已抄录") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("稍后") }
        },
    )
}

@Composable
private fun MnemonicWordCell(index: Int, word: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(6.dp),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "$index.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.width(20.dp),
            )
            Text(
                word,
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun ImportMnemonicDialog(
    onDismiss: () -> Unit,
    onConfirm: (words: String, deviceName: String, requireBiometric: Boolean) -> Unit,
) {
    var words by remember { mutableStateOf("") }
    var deviceName by remember { mutableStateOf(android.os.Build.MODEL ?: "Restored") }
    var requireBiometric by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                Icons.Default.Download,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(32.dp),
            )
        },
        title = { Text("从助记词恢复") },
        text = {
            Column {
                Text(
                    "粘贴或输入 12/15/18/21/24 字 BIP-39 助记词（空格或逗号分隔，大小写不敏感）。" +
                        "若该 DID 已在本钱包中，会切换为激活而非重复添加。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = words,
                    onValueChange = { words = it },
                    label = { Text("助记词") },
                    placeholder = { Text("abandon abandon abandon ...") },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 100.dp),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = deviceName,
                    onValueChange = { deviceName = it },
                    label = { Text("设备名称") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "绑定生物识别",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    Switch(checked = requireBiometric, onCheckedChange = { requireBiometric = it })
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(words, deviceName.ifBlank { "Restored" }, requireBiometric) },
                enabled = words.isNotBlank() && deviceName.isNotBlank(),
            ) { Text("恢复") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun InfoCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    value: String,
    subline: String,
    monospace: Boolean,
    onCopy: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(0.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.size(8.dp))
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onCopy, modifier = Modifier.size(36.dp)) {
                    Icon(
                        Icons.Default.ContentCopy,
                        contentDescription = "复制",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = value,
                style = MaterialTheme.typography.bodySmall,
                fontFamily = if (monospace) FontFamily.Monospace else FontFamily.Default,
                fontSize = if (monospace) 12.sp else 14.sp,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = subline,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun TrustedDeviceRow(device: TrustedDevice, onCopyDid: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onCopyDid),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(0.dp),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Surface(
                modifier = Modifier.size(36.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Default.Devices,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = device.deviceName,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = device.did,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
            Icon(
                Icons.Default.ContentCopy,
                contentDescription = "复制 DID",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

private fun copyToClipboard(context: Context, label: String, value: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, value))
}

private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
