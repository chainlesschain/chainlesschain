package com.chainlesschain.android.presentation.familypairing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.p2p.ui.QrCodeImage
import com.chainlesschain.android.feature.p2p.ui.QRCodeScannerScreen
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/**
 * 家长↔孩子配对绑定屏 (FAMILY-13 协议接 UI)。家庭 tab「配对绑定」卡导航至此。
 *
 * 三态：先选「我是家长 / 我是孩子」→
 *   - 家长：生成邀请 → 二维码 + 可复制 token + 明文接受码 (告知孩子)。
 *   - 孩子：粘贴/扫描 token + 输入接受码 + 自报年龄 → 接受 → 成功一次性显示复活码。
 *
 * v0.1：二维码摄像头扫描为设备阻塞项，本屏提供 token 文本手动粘贴路径 (始终可用)。
 * 单设备同库可端到端跑通；真实双机还需 family_group P2P 同步 + 真 DID (见 ViewModel)。
 */
@Composable
fun FamilyPairingScreen(
    onBack: () -> Unit,
    viewModel: FamilyPairingViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // 孩子端「扫码」: 拉起摄像头扫描器 (复用 :feature-p2p), 扫到的内容回填到邀请框。
    var scanning by remember { mutableStateOf(false) }
    var scannedToken by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.consumeMessage()
        }
    }

    if (scanning) {
        QRCodeScannerScreen(
            peerId = "对方邀请",
            onQRCodeScanned = { scannedToken = it.trim(); scanning = false },
            onBack = { scanning = false },
        )
        return
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onBack) { Text("← 返回") }
                Text(
                    text = "配对绑定",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                if (state.mode != PairingMode.CHOOSE) {
                    TextButton(onClick = viewModel::reset) { Text("重选角色") }
                }
            }
            HorizontalDivider()

            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.mode == PairingMode.CHOOSE) {
                    ChooseRole(
                        onParent = viewModel::chooseParent,
                        onChild = viewModel::chooseChild,
                    )
                } else {
                    val asChild = state.mode == PairingMode.CHILD
                    when (state.action) {
                        PairingAction.MENU -> ActionMenu(
                            asChild = asChild,
                            onGenerate = viewModel::startGenerate,
                            onAccept = viewModel::startAccept,
                        )
                        PairingAction.GENERATE -> GeneratePane(
                            state = state,
                            asChild = asChild,
                            onGenerate = { viewModel.createInvite() },
                            onBack = viewModel::backToMenu,
                        )
                        PairingAction.ACCEPT -> AcceptPane(
                            state = state,
                            asChild = asChild,
                            scannedToken = scannedToken,
                            onScanConsumed = { scannedToken = null },
                            onScan = { scanning = true },
                            onAccept = { token, code, age -> viewModel.acceptInvite(token, code, age) },
                            onConfirmKyc = { token, code, age ->
                                viewModel.acceptInvite(token, code, age, forceKycAck = true)
                            },
                            onDismissKyc = viewModel::dismissKyc,
                            onBack = viewModel::backToMenu,
                            onGenerateReturnInvite = viewModel::startGenerate,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ChooseRole(onParent: () -> Unit, onChild: () -> Unit) {
    Text(
        text = "这台手机在本次绑定里是？",
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
    )
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = onParent, modifier = Modifier.fillMaxWidth()) { Text("我是家长") }
            OutlinedButton(onClick = onChild, modifier = Modifier.fillMaxWidth()) { Text("我是孩子") }
            Text(
                text = "绑定经二维码 + 6 位接受码二次确认，防误扫；孩子端的「陪伴」聊天家长永远看不到。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** 选定角色后的动作菜单。要双向可见 (各自家人页都能看到对方), 两台手机都需「生成 + 接受」各一次。 */
@Composable
private fun ActionMenu(asChild: Boolean, onGenerate: () -> Unit, onAccept: () -> Unit) {
    val other = if (asChild) "家长" else "孩子"
    Text(
        text = if (asChild) "我是孩子" else "我是家长",
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
    )
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = onGenerate, modifier = Modifier.fillMaxWidth()) { Text("生成邀请（让$other 扫/粘贴）") }
            OutlinedButton(onClick = onAccept, modifier = Modifier.fillMaxWidth()) { Text("接受$other 的邀请") }
            Text(
                text = "想互相在「家人」页看到对方：两台手机各做一次「生成」+ 一次「接受」即可双向绑定。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun GeneratePane(
    state: FamilyPairingUiState,
    asChild: Boolean,
    onGenerate: () -> Unit,
    onBack: () -> Unit,
) {
    val other = if (asChild) "家长" else "孩子"
    val clipboard = LocalClipboardManager.current

    if (state.inviteToken == null) {
        TextButton(onClick = onBack) { Text("← 返回") }
        Text("生成一个邀请，让$other 的手机扫码 / 粘贴绑定。", style = MaterialTheme.typography.bodyMedium)
        Button(onClick = onGenerate, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
            if (state.busy) BusyDots() else Text("生成邀请")
        }
        return
    }

    TextButton(onClick = onBack) { Text("← 返回") }
    Text("让$other 扫描二维码", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // ECC-L + 大尺寸: 屏对屏扫描无物理损伤, 低容错=更少模块=更易对焦扫中。
            QrCodeImage(text = state.inviteToken, size = 300.dp, eccLevel = ErrorCorrectionLevel.L)
            state.acceptanceCode?.let { code ->
                Text("接受码（口头/IM 告诉$other ）", style = MaterialTheme.typography.labelMedium)
                Text(
                    text = code,
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
            Text(
                text = "10 分钟内有效。扫码不便就点下面「复制邀请内容」发给$other 手动粘贴。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
    OutlinedTextField(
        value = state.inviteToken,
        onValueChange = {},
        readOnly = true,
        label = { Text("邀请内容（手动绑定时复制此段）") },
        modifier = Modifier.fillMaxWidth(),
        minLines = 2,
        maxLines = 4,
    )
    Button(
        onClick = { clipboard.setText(AnnotatedString(state.inviteToken)) },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("📋 复制邀请内容") }
    OutlinedButton(onClick = onGenerate, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
        Text("重新生成")
    }
}

@Composable
private fun AcceptPane(
    state: FamilyPairingUiState,
    asChild: Boolean,
    scannedToken: String?,
    onScanConsumed: () -> Unit,
    onScan: () -> Unit,
    onAccept: (String, String, String) -> Unit,
    onConfirmKyc: (String, String, String) -> Unit,
    onDismissKyc: () -> Unit,
    onBack: () -> Unit,
    onGenerateReturnInvite: () -> Unit,
) {
    val other = if (asChild) "家长" else "孩子"
    val clipboard = LocalClipboardManager.current
    var token by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var age by remember { mutableStateOf("") }

    // 扫码结果回填到邀请框 (消费一次)。
    LaunchedEffect(scannedToken) {
        scannedToken?.let {
            token = it
            onScanConsumed()
        }
    }

    if (state.revivalCode != null) {
        RevivalCodeCard(state.revivalCode)
        Spacer(Modifier.height(8.dp))
        // 当前只是单向: 对方能看到我了, 但我(及对方家人页双向)还需对方也接受我的回邀请。
        Text(
            text = "想让$other 的「家人」页也能看到你？再生成一个回邀请让 $other 接受即可双向可见。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(onClick = onGenerateReturnInvite, modifier = Modifier.fillMaxWidth()) {
            Text("↩ 生成回邀请（让$other 也能看到我）")
        }
        return
    }

    TextButton(onClick = onBack) { Text("← 返回") }
    Text("接受$other 的邀请", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    Button(onClick = onScan, modifier = Modifier.fillMaxWidth()) { Text("📷 扫码$other 的二维码") }
    OutlinedButton(
        onClick = { clipboard.getText()?.text?.let { token = it.trim() } },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("📋 粘贴剪贴板里的邀请内容") }
    Text(
        text = "—— 或手动粘贴到下面 ——",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    OutlinedTextField(
        value = token,
        onValueChange = { token = it },
        label = { Text("邀请内容（扫码 / 粘贴$other 发来的内容）") },
        modifier = Modifier.fillMaxWidth(),
        minLines = 2,
        maxLines = 4,
    )
    OutlinedTextField(
        value = code,
        onValueChange = { code = it.filter(Char::isDigit).take(6) },
        label = { Text("6 位接受码") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
    OutlinedTextField(
        value = age,
        onValueChange = { age = it.filter(Char::isDigit).take(3) },
        label = { Text("你的年龄") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
    Button(
        onClick = { onAccept(token, code, age) },
        enabled = !state.busy,
        modifier = Modifier.fillMaxWidth(),
    ) {
        if (state.busy) BusyDots() else Text("接受并绑定")
    }
    Text(
        text = "扫码 / 粘贴均可；接受码请向$other 当面/IM 确认。",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    if (state.kycPending) {
        AlertDialog(
            onDismissRequest = onDismissKyc,
            title = { Text("需监护人陪同实名验证") },
            text = {
                Text("依规定，14 岁以下需在监护人陪同下完成实名验证后才能绑定。请确认已由监护人陪同。")
            },
            confirmButton = {
                TextButton(onClick = { onConfirmKyc(token, code, age) }) { Text("已确认，继续绑定") }
            },
            dismissButton = {
                TextButton(onClick = onDismissKyc) { Text("取消") }
            },
        )
    }
}

@Composable
private fun RevivalCodeCard(revivalCode: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("🎉 绑定成功", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("请记下复活码（紧急解绑用，仅显示一次）：", style = MaterialTheme.typography.bodyMedium)
            Text(
                text = revivalCode,
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "复活码请妥善保存、不要截图上传。绑定关系可在「家人」页查看。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun BusyDots() {
    CircularProgressIndicator(
        modifier = Modifier.height(20.dp),
        strokeWidth = 2.dp,
        color = MaterialTheme.colorScheme.onPrimary,
    )
}
