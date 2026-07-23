package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * D6.1 + D6.2 — 邮箱 4 provider sub-cards (推文 §"邮箱: QQ / Gmail / 163 /
 * Outlook").
 *
 * 4 provider 卡均已接通凭据配置、IMAP 采集、快照导入和退出操作。
 * v0.2 (§2.3 D6.2 本 commit): button 真接通 — onProviderLogin 弹凭据 dialog
 * → 提交 → EmailCredentialsStore + EmailLocalCollector + cc hub sync
 * email-imap。已登录卡 button 改 "同步" + "退出"。
 */
@Composable
fun EmailProvidersGroup(
    states: Map<String, HubLocalViewModel.EmailCardState>,
    globalBusy: Boolean,
    onProviderLogin: (providerKey: String) -> Unit,
    onProviderSync: (providerKey: String) -> Unit,
    onProviderLogout: (providerKey: String) -> Unit,
    onClearError: (providerKey: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val vendorMeta = listOf(
        EmailProviderMeta("qq", "QQ 邮箱", "imap.qq.com:993", "Web 端开 IMAP/SMTP + 授权码"),
        EmailProviderMeta("gmail", "Gmail", "imap.gmail.com:993", "Google 两步验证 + 16 位 App Password"),
        EmailProviderMeta("netease163", "163 邮箱", "imap.163.com:993", "Web 端开 IMAP/SMTP + 客户端授权码"),
        EmailProviderMeta("outlook", "Outlook", "outlook.office365.com:993", "支持 IMAP / App Password"),
    )
    Column(modifier = modifier.fillMaxWidth()) {
        vendorMeta.forEachIndexed { idx, meta ->
            val state = states[meta.providerKey] ?: HubLocalViewModel.EmailCardState(
                vendorKey = meta.providerKey,
                displayName = meta.displayName,
            )
            EmailProviderRowCard(
                meta = meta,
                state = state,
                globalBusy = globalBusy,
                onLogin = { onProviderLogin(meta.providerKey) },
                onSync = { onProviderSync(meta.providerKey) },
                onLogout = { onProviderLogout(meta.providerKey) },
                onClearError = { onClearError(meta.providerKey) },
            )
            if (idx < vendorMeta.lastIndex) Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun EmailProviderRowCard(
    meta: EmailProviderMeta,
    state: HubLocalViewModel.EmailCardState,
    globalBusy: Boolean,
    onLogin: () -> Unit,
    onSync: () -> Unit,
    onLogout: () -> Unit,
    onClearError: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.fillMaxWidth(0.6f)) {
                    Text(
                        meta.displayName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        meta.imapHostHint,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        when {
                            state.lastSyncAt != null ->
                                "上次同步 ${state.lastSyncCount} 封 · ${meta.authNote}"
                            state.hasCredentials -> "已配置，未同步 · ${meta.authNote}"
                            else -> meta.authNote
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (state.hasCredentials) {
                    Column(horizontalAlignment = Alignment.End) {
                        Button(
                            onClick = onSync,
                            enabled = !globalBusy && !state.isSyncing,
                        ) { Text(if (state.isSyncing) "同步中…" else "同步") }
                        Spacer(Modifier.height(4.dp))
                        TextButton(onClick = onLogout, enabled = !state.isSyncing) {
                            Text("退出", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                } else {
                    Button(onClick = onLogin, enabled = !globalBusy) { Text("登录") }
                }
            }
            if (state.errorMessage != null) {
                Spacer(Modifier.height(8.dp))
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            state.errorMessage,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.fillMaxWidth(0.85f),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        TextButton(onClick = onClearError) { Text("知道") }
                    }
                }
            }
        }
    }
}

private data class EmailProviderMeta(
    val providerKey: String,
    val displayName: String,
    val imapHostHint: String,
    val authNote: String,
)
