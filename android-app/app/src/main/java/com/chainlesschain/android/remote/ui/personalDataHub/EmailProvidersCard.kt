package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * D6.1 — 邮箱 4 provider sub-cards (推文 §"邮箱: QQ / Gmail / 163 / Outlook")
 *
 * 替换原 PlaceholderCategoryCard "QQ / Gmail / 163 / Outlook" 单卡为 4 张
 * provider 子卡 (每个独立 status + 登录按钮)。让用户看到推文 §邮箱段的 4 个
 * 厂商真实存在为采集目标，而不是"一张概括卡"。
 *
 * v0.1: 4 provider 卡都是 disabled stub — D6.2 接通 IMAP UI (用户输入凭据 →
 * EmailLocalCollector → email-imap adapter snapshot mode)。
 *
 * 命名约定与 social-bilibili 一致：providerKey = "qq" / "gmail" / "netease163"
 * / "outlook"，与 packages/personal-data-hub/lib/adapters/email-imap/
 * providers.js 的 vendor field 对齐。
 */
@Composable
fun EmailProvidersGroup(
    onProviderLogin: (providerKey: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val providers = listOf(
        EmailProvider("qq", "QQ 邮箱", "imap.qq.com:993", "需开启 IMAP/SMTP + 授权码"),
        EmailProvider("gmail", "Gmail", "imap.gmail.com:993", "需 OAuth 或 App Password"),
        EmailProvider("netease163", "163 邮箱", "imap.163.com:993", "需开启 IMAP/SMTP + 客户端授权码"),
        EmailProvider("outlook", "Outlook", "outlook.office365.com:993", "支持 OAuth 直登"),
    )
    Column(modifier = modifier.fillMaxWidth()) {
        providers.forEachIndexed { idx, provider ->
            EmailProviderRowCard(
                provider = provider,
                onLogin = { onProviderLogin(provider.providerKey) },
            )
            if (idx < providers.lastIndex) Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun EmailProviderRowCard(
    provider: EmailProvider,
    onLogin: () -> Unit,
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
                Column(modifier = Modifier.fillMaxWidth(0.65f)) {
                    Text(
                        provider.displayName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        provider.imapHostHint,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        provider.authNote,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedButton(
                    onClick = onLogin,
                    enabled = false, // D6.2 待接通：IMAP 凭据表单 + EmailLocalCollector
                ) { Text("v0.2 开放") }
            }
        }
    }
}

private data class EmailProvider(
    val providerKey: String,
    val displayName: String,
    val imapHostHint: String,
    val authNote: String,
)
