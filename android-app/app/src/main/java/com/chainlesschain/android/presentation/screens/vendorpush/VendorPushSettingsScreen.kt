package com.chainlesschain.android.presentation.screens.vendorpush

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.push.vendor.PushVendor

/**
 * v1.1 issue #19 P1：Settings → 国内推送厂商 Compose 屏。
 *
 * Auto 行（默认）+ 4 vendor + FCM RadioGroup。每行显示安装状态 chip + 厂商名 + 当前
 * token (如有) + SDK 依赖说明。底部"重置为自动"按钮 + "返回"。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VendorPushSettingsScreen(
    onBack: () -> Unit = {},
    viewModel: VendorPushSettingsViewModel = hiltViewModel(),
) {
    val override by viewModel.userOverride.collectAsState()
    val current = viewModel.currentSelection
    val autoDetected = viewModel.autoDetected

    Scaffold(
        topBar = { TopAppBar(title = { Text("国内推送厂商") }) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // 顶部说明 + 当前选择
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    ),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            "FCM 国内不可达，需各家厂商 SDK 推送",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "当前生效：${current.displayName} ${if (override == null) "(auto-detect)" else "(用户 override)"}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "auto-detect (Build.MANUFACTURER)：${autoDetected.displayName}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            // Auto 行
            item {
                VendorRadioRow(
                    label = "Auto-detect (推荐)",
                    description = "按设备品牌自动选 — 当前 → ${autoDetected.displayName}",
                    badge = "默认",
                    selected = override == null,
                    integrated = true,  // auto 模式总是 ready
                    onClick = { viewModel.setOverride(null) },
                )
            }

            // 4 vendor + FCM
            for (vendor in PushVendor.values()) {
                item(key = vendor.name) {
                    val integrated = viewModel.isIntegrated(vendor)
                    val token = viewModel.currentToken(vendor)
                    VendorRadioRow(
                        label = vendor.displayName,
                        description = vendor.sdkArtifact,
                        badge = if (integrated) "已集成" else "v1.1 stub",
                        selected = override == vendor,
                        integrated = integrated,
                        token = token,
                        onClick = { viewModel.setOverride(vendor) },
                    )
                }
            }

            // 底部安装提示 + 文档链接
            item {
                Spacer(Modifier.height(8.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                    ),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            "⚠️ 4 厂商均 v1.1 stub",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "v1.1 提供架构骨架 + Settings UI + 4 厂商详细接入指南。" +
                                "v1.2 真集成需用户在各开发者控制台申请 credentials → 改 stub 为真 SDK 调用。" +
                                "详见 docs/guides/Vendor_Push_Setup.md。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                }
                Spacer(Modifier.height(4.dp))
                OutlinedButton(
                    onClick = onBack,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("返回") }
            }
        }
    }
}

@Composable
private fun VendorRadioRow(
    label: String,
    description: String,
    badge: String,
    selected: Boolean,
    integrated: Boolean,
    token: String? = null,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, onClick = onClick),
        shape = RoundedCornerShape(10.dp),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            RadioButton(selected = selected, onClick = null)
            Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        label,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(0.dp))
                    Surface(
                        shape = RoundedCornerShape(4.dp),
                        color = if (integrated) MaterialTheme.colorScheme.primaryContainer
                        else MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.padding(start = 6.dp),
                    ) {
                        Text(
                            " $badge ",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (integrated) MaterialTheme.colorScheme.onPrimaryContainer
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Text(
                    description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                token?.let {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "token: ${it.take(20)}…",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
        }
    }
}
