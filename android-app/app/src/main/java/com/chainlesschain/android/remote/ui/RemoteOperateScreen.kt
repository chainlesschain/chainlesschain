package com.chainlesschain.android.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.p2p.pairing.PairedDesktopsStore
import com.chainlesschain.android.remote.client.SignalingRpcClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import javax.inject.Inject

/**
 * v1.3+ issue #21 plan C — Signaling-based 远程操控简单页。
 *
 * 不依赖 WebRTC P2P，所有命令经 [SignalingRpcClient] 走信令转发（LAN 或公网中继）。
 * UI 极简：几个 chip 按钮 + 响应 JSON 显示。先把功能验证跑通，UX 后续打磨。
 *
 * 入口：首页绿色「已连接桌面」卡片点击 → NavGraph 跳此屏。
 */
@HiltViewModel
class RemoteOperateViewModel @Inject constructor(
    private val rpc: SignalingRpcClient,
    private val pairedDesktopsStore: PairedDesktopsStore,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val pcPeerId: String = savedStateHandle.get<String>("peerId") ?: ""

    private val _state = MutableStateFlow(
        RemoteOperateState(
            pcPeerId = pcPeerId,
            desktopName = pairedDesktopsStore.devices.value
                .firstOrNull { it.pcPeerId == pcPeerId }
                ?.deviceName
                ?: pcPeerId.take(12),
        ),
    )
    val state: StateFlow<RemoteOperateState> = _state.asStateFlow()

    fun invoke(label: String, method: String, params: Map<String, Any?> = emptyMap()) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, lastError = null, lastLabel = label) }
            val r = rpc.invoke(pcPeerId, method, params)
            if (r.isSuccess) {
                _state.update {
                    it.copy(
                        busy = false,
                        lastResult = r.getOrNull()?.toString(2) ?: "(empty)",
                        lastError = null,
                    )
                }
            } else {
                _state.update {
                    it.copy(
                        busy = false,
                        lastError = r.exceptionOrNull()?.message ?: "未知错误",
                    )
                }
            }
        }
    }

    fun unpair() {
        pairedDesktopsStore.remove(pcPeerId)
    }
}

data class RemoteOperateState(
    val pcPeerId: String = "",
    val desktopName: String = "",
    val busy: Boolean = false,
    val lastLabel: String? = null,
    val lastResult: String? = null,
    val lastError: String? = null,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteOperateScreen(
    onBack: () -> Unit,
    viewModel: RemoteOperateViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("远程操控")
                        Text(
                            state.desktopName,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Surface(
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Text(
                        text = "通过信令中继与桌面通信",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "PC peer-id: ${state.pcPeerId.take(20)}…",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Text("快捷命令", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)

            CommandRow(
                buttons = listOf(
                    "Ping" to { viewModel.invoke("Ping", "system.ping") },
                    "系统状态" to { viewModel.invoke("系统状态", "system.getStatus") },
                    "系统信息" to { viewModel.invoke("系统信息", "system.getInfo") },
                ),
                busy = state.busy,
            )

            if (state.busy) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                Text(
                    text = "正在执行: ${state.lastLabel ?: ""}",
                    style = MaterialTheme.typography.labelMedium,
                )
            }

            state.lastError?.let { err ->
                Surface(
                    shape = MaterialTheme.shapes.medium,
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text(
                            "错误",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        Text(
                            err,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                }
            }

            state.lastResult?.let { res ->
                Text("响应", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Surface(
                    shape = MaterialTheme.shapes.medium,
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = res,
                        modifier = Modifier.padding(14.dp),
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    )
                }
            }

            Spacer(modifier = Modifier.height(20.dp))
            OutlinedButton(
                onClick = {
                    viewModel.unpair()
                    onBack()
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("解除配对")
            }
        }
    }
}

@Composable
private fun CommandRow(
    buttons: List<Pair<String, () -> Unit>>,
    busy: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        buttons.chunked(2).forEach { rowItems ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                rowItems.forEach { (label, onClick) ->
                    Button(
                        onClick = onClick,
                        modifier = Modifier.weight(1f),
                        enabled = !busy,
                    ) {
                        Text(label)
                    }
                }
                // 奇数个时填充空白维持对齐
                if (rowItems.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}
