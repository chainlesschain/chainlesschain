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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.pdh.social.SocialCookieWebViewScreen
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Plan A v0.1 + A8 — 4th tab "本机数据" inside PersonalDataHubScreen.
 *
 * Distinguishing this tab from the other three:
 *  - 提问 / Adapter / 审计 → remote (RPC into the paired desktop's hub)
 *  - 本机数据             → local (in-APK cc subprocess writes to a local
 *                          vault.db at filesDir/.chainlesschain/hub/)
 *
 * Cards rendered (v0.1):
 *  1. 本机数据 (system-data-android)  — contacts + apps via ContentResolver
 *  2. Bilibili (social-bilibili)      — login WebView + OkHttp + 4 API fetches
 *  3. 微博 / 抖音 / 小红书             — scaffold cards, stub behavior in v0.1
 *
 * Login WebView overlay: when [HubLocalViewModel.UiState.pendingLogin] is
 * non-null, we replace the card list with SocialCookieWebViewScreen so the
 * user can authenticate. Back gesture cancels.
 */
@Composable
fun HubLocalScreen(
    viewModel: HubLocalViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    val pending = state.pendingLogin
    if (pending != null) {
        SocialCookieWebViewScreen(
            loginUrl = pending.loginUrl,
            cookieDomain = pending.cookieDomain,
            displayName = pending.displayName,
            isLoginSuccess = pending.isLoginSuccess,
            onLoginComplete = { cookie ->
                if (pending.adapterName == "social-bilibili") {
                    viewModel.onBilibiliLoginCookie(cookie)
                } else {
                    viewModel.cancelLogin()
                }
            },
            onCancel = { viewModel.cancelLogin() },
        )
        return
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { _ ->
        viewModel.refreshPermissionState()
        viewModel.refreshSystemData()
    }

    LaunchedEffect(Unit) {
        viewModel.refreshPermissionState()
        viewModel.refreshBilibiliFromStore()
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
                "所有同步均写入本机加密数据库，不依赖桌面在线。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))

            SystemDataCard(
                state = state.systemData,
                globalBusy = state.globalSyncingAdapter != null,
                onRequestPermission = { permissionLauncher.launch(Manifest.permission.READ_CONTACTS) },
                onRefresh = { viewModel.refreshSystemData() },
            )

            Spacer(Modifier.height(12.dp))

            SocialAdapterCard(
                state = state.bilibili,
                globalBusy = state.globalSyncingAdapter != null,
                onLogin = { viewModel.requestBilibiliLogin() },
                onSync = { viewModel.syncBilibili() },
                onLogout = { viewModel.logoutBilibili() },
            )

            Spacer(Modifier.height(12.dp))

            SocialAdapterCard(
                state = state.weibo,
                globalBusy = state.globalSyncingAdapter != null,
                onLogin = { viewModel.requestSocialLoginStub("weibo") },
                onSync = { viewModel.requestSocialLoginStub("weibo") },
                onLogout = { /* no-op for stub */ },
            )

            Spacer(Modifier.height(12.dp))

            SocialAdapterCard(
                state = state.douyin,
                globalBusy = state.globalSyncingAdapter != null,
                onLogin = { viewModel.requestSocialLoginStub("douyin") },
                onSync = { viewModel.requestSocialLoginStub("douyin") },
                onLogout = { /* no-op for stub */ },
            )

            Spacer(Modifier.height(12.dp))

            SocialAdapterCard(
                state = state.xiaohongshu,
                globalBusy = state.globalSyncingAdapter != null,
                onLogin = { viewModel.requestSocialLoginStub("xiaohongshu") },
                onSync = { viewModel.requestSocialLoginStub("xiaohongshu") },
                onLogout = { /* no-op for stub */ },
            )
        }
    }
}

@Composable
private fun SystemDataCard(
    state: HubLocalViewModel.SystemDataCardState,
    globalBusy: Boolean,
    onRequestPermission: () -> Unit,
    onRefresh: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                "本机数据（通讯录 + 已装应用）",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                if (state.contactsPermissionGranted)
                    "权限：已授权 — 可读取联系人 + 应用列表"
                else
                    "权限：未授权 — 仅采集已装应用，联系人为 0",
                style = MaterialTheme.typography.bodySmall,
                color = if (state.contactsPermissionGranted)
                    MaterialTheme.colorScheme.onSurfaceVariant
                else
                    MaterialTheme.colorScheme.error,
            )

            Spacer(Modifier.height(12.dp))

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

            Spacer(Modifier.height(8.dp))

            val lastTxt = state.lastSnapshotAt?.let(::formatLastSync)
            Text(
                if (lastTxt != null) "上次同步：$lastTxt" else "未同步过",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

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

            Spacer(Modifier.height(12.dp))

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
                            onRefresh()
                        } else {
                            onRequestPermission()
                        }
                    },
                    enabled = !state.isLoading && !globalBusy,
                ) {
                    Text(if (state.isLoading) "同步中…" else "同步")
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
                Spacer(Modifier.height(8.dp))
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
private fun SocialAdapterCard(
    state: HubLocalViewModel.SocialCardState,
    globalBusy: Boolean,
    onLogin: () -> Unit,
    onSync: () -> Unit,
    onLogout: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (state.implemented)
                MaterialTheme.colorScheme.surfaceVariant
            else
                MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        state.displayName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(2.dp))
                    val statusLine = when {
                        !state.implemented -> "v0.2 开放（框架已就绪，API 未接通）"
                        state.isLoggedIn && state.uid != null -> "已登录 UID:${state.uid}"
                        state.isLoggedIn -> "已登录"
                        else -> "未登录"
                    }
                    Text(
                        statusLine,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (state.isSyncing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                    )
                }
            }

            if (state.lastSyncAt != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "上次同步：${formatLastSync(state.lastSyncAt)} (+${state.lastSyncCount} 事件)",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (state.isLoggedIn && state.implemented) {
                    TextButton(
                        onClick = onLogout,
                        enabled = !state.isSyncing && !globalBusy,
                    ) { Text("退出登录") }
                    Spacer(Modifier.size(8.dp))
                }
                if (!state.isLoggedIn || !state.implemented) {
                    OutlinedButton(
                        onClick = onLogin,
                        enabled = !state.isSyncing && !globalBusy,
                    ) { Text(if (state.implemented) "登录" else "了解") }
                    Spacer(Modifier.size(8.dp))
                }
                Button(
                    onClick = onSync,
                    enabled = !state.isSyncing && !globalBusy && state.implemented,
                ) {
                    Text(if (state.isSyncing) "同步中…" else "同步")
                }
            }

            state.errorMessage?.let { err ->
                Spacer(Modifier.height(8.dp))
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
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
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
