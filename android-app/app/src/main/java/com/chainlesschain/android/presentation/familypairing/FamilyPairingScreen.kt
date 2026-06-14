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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.p2p.ui.QrCodeImage

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

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.consumeMessage()
        }
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
                when (state.mode) {
                    PairingMode.CHOOSE -> ChooseRole(
                        onParent = viewModel::chooseParent,
                        onChild = viewModel::chooseChild,
                    )
                    PairingMode.PARENT -> ParentPane(
                        state = state,
                        onGenerate = { viewModel.createInvite() },
                    )
                    PairingMode.CHILD -> ChildPane(
                        state = state,
                        onAccept = { token, code, age -> viewModel.acceptInvite(token, code, age) },
                        onConfirmKyc = { token, code, age ->
                            viewModel.acceptInvite(token, code, age, forceKycAck = true)
                        },
                        onDismissKyc = viewModel::dismissKyc,
                    )
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
            Button(onClick = onParent, modifier = Modifier.fillMaxWidth()) { Text("我是家长（生成邀请）") }
            OutlinedButton(onClick = onChild, modifier = Modifier.fillMaxWidth()) { Text("我是孩子（接受邀请）") }
            Text(
                text = "绑定经二维码 + 6 位接受码二次确认，防误扫；孩子端的「陪伴」聊天家长永远看不到。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ParentPane(state: FamilyPairingUiState, onGenerate: () -> Unit) {
    if (state.inviteToken == null) {
        Text("生成一个邀请，让孩子的手机扫码绑定。", style = MaterialTheme.typography.bodyMedium)
        Button(onClick = onGenerate, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
            if (state.busy) BusyDots() else Text("生成邀请")
        }
        return
    }

    Text("让孩子扫描二维码", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            QrCodeImage(text = state.inviteToken, size = 240.dp)
            state.acceptanceCode?.let { code ->
                Text("接受码（口头/IM 告诉孩子）", style = MaterialTheme.typography.labelMedium)
                Text(
                    text = code,
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
            Text(
                text = "10 分钟内有效。若孩子无法扫码，可把下面这段邀请内容复制发给孩子手动粘贴。",
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
    Button(onClick = onGenerate, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
        Text("重新生成")
    }
}

@Composable
private fun ChildPane(
    state: FamilyPairingUiState,
    onAccept: (String, String, String) -> Unit,
    onConfirmKyc: (String, String, String) -> Unit,
    onDismissKyc: () -> Unit,
) {
    var token by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var age by remember { mutableStateOf("") }

    if (state.revivalCode != null) {
        RevivalCodeCard(state.revivalCode)
        return
    }

    Text("接受家长的邀请", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    OutlinedTextField(
        value = token,
        onValueChange = { token = it },
        label = { Text("邀请内容（扫码或粘贴家长发来的内容）") },
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
        text = "扫描二维码（摄像头）将在后续版本接入；当前可手动粘贴邀请内容完成绑定。",
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
