package com.chainlesschain.android.remote.ui.personalDataHub

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Plan A v0.1 — 4th tab "本机数据" inside PersonalDataHubScreen.
 *
 * Distinguishing this tab from the other three:
 *  - 提问 / Adapter / 审计 → remote (RPC into the paired desktop's hub)
 *  - 本机数据             → local (in-APK cc subprocess writes to a local
 *                          vault.db at filesDir/.chainlesschain/hub/)
 *
 * Single CTA = "刷新" — produces a snapshot via ContentResolver + Package-
 * Manager and pipes it through cc hub sync-adapter. Permission gate uses
 * [ActivityResultContracts.RequestPermission] for READ_CONTACTS; apps need
 * no runtime permission.
 */
@Composable
fun HubLocalScreen(
    viewModel: HubLocalViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { _ ->
        // System dialog returned; re-read grant state then kick off refresh
        // regardless — if the user declined, snapshot still runs but
        // contactsCount = 0 and the permission card stays red.
        viewModel.refreshPermissionState()
        viewModel.refresh()
    }

    LaunchedEffect(Unit) {
        viewModel.refreshPermissionState()
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            Text(
                "本机数据",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "从本机通讯录与已装应用读取数据并写入本地中台数据库（不离开手机）。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))

            // Permission card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = if (state.contactsPermissionGranted)
                        MaterialTheme.colorScheme.surfaceVariant
                    else
                        MaterialTheme.colorScheme.errorContainer,
                ),
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        if (state.contactsPermissionGranted) "通讯录权限：已授权" else "通讯录权限：未授权",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = if (state.contactsPermissionGranted)
                            MaterialTheme.colorScheme.onSurfaceVariant
                        else
                            MaterialTheme.colorScheme.onErrorContainer,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        if (state.contactsPermissionGranted)
                            "通讯录读取可用。已装应用不需要额外权限。"
                        else
                            "授权后可读取联系人，否则本次只采集已装应用。",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (state.contactsPermissionGranted)
                            MaterialTheme.colorScheme.onSurfaceVariant
                        else
                            MaterialTheme.colorScheme.onErrorContainer,
                    )
                    if (!state.contactsPermissionGranted) {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = { permissionLauncher.launch(Manifest.permission.READ_CONTACTS) },
                            enabled = !state.isLoading,
                        ) { Text("申请通讯录权限") }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // Counts row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                CountCard(label = "联系人", value = state.contactsCount, modifier = Modifier.weight(1f))
                Spacer(Modifier.size(8.dp))
                CountCard(label = "已装应用", value = state.appsCount, modifier = Modifier.weight(1f))
                Spacer(Modifier.size(8.dp))
                CountCard(label = "本次入库", value = state.ingested, modifier = Modifier.weight(1f))
            }

            Spacer(Modifier.height(12.dp))

            // Last sync line
            val lastTxt = state.lastSnapshotAt?.let { formatLastSync(it) }
            Text(
                if (lastTxt != null) "上次同步：$lastTxt" else "未同步过",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            // MIUI / 华为 EMUI / 部分 OEM ROM 在 manifest 已含 QUERY_ALL_PACKAGES
            // 时仍拦截 getInstalledPackages(); 表现为只返回 App 自己 (count == 1)。
            // 当出现此症状给一句话指引；用户授权后下次 刷新 应见正常数量 (~100+)。
            if (state.lastSnapshotAt != null && state.appsCount <= 1) {
                Spacer(Modifier.height(8.dp))
                Surface(
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Text(
                        "已装应用只看到 ${state.appsCount} 个 — 部分 ROM (MIUI / EMUI) " +
                            "拦截了应用列表读取。请到「设置 → 应用管理 → ChainlessChain " +
                            "→ 权限管理」开启「查看已安装应用列表」，然后再点刷新。",
                        modifier = Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            // CTA row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (state.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                    )
                    Spacer(Modifier.size(8.dp))
                }
                Button(
                    onClick = {
                        if (state.contactsPermissionGranted) {
                            viewModel.refresh()
                        } else {
                            permissionLauncher.launch(Manifest.permission.READ_CONTACTS)
                        }
                    },
                    enabled = !state.isLoading,
                ) {
                    Text(if (state.isLoading) "同步中…" else "刷新")
                }
            }

            if (state.isLoading) {
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                state.phase?.let { phase ->
                    Spacer(Modifier.height(4.dp))
                    Text(
                        phase,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            state.errorMessage?.let { err ->
                Spacer(Modifier.height(12.dp))
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Text(
                        err,
                        modifier = Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun CountCard(label: String, value: Int, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(value.toString(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(2.dp))
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private val syncFormatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

private fun formatLastSync(epochMs: Long): String = syncFormatter.format(Date(epochMs))
