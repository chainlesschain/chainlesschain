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
 * D7.1 — 支付与购物 sub-cards (推文 §"支付与购物: 支付宝 / 淘宝")
 *
 * 替换原 PlaceholderCategoryCard "支付宝 / 淘宝" 单卡为 2 张 provider 子卡。
 * v0.1: SAF 文件上传 button disabled "v0.2 开放" — D7.2 接通 ACTION_OPEN_
 * DOCUMENT picker → alipay-bill 账单 CSV / shopping-taobao 订单 HTML →
 * adapter snapshot mode → in-APK cc。
 */
@Composable
fun PaymentShoppingGroup(
    onProviderImport: (providerKey: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val providers = listOf(
        ProviderCard(
            key = "alipay-bill",
            displayName = "支付宝账单",
            hint = "导出账单 CSV: App → 我的 → 账单 → 右上角 → 开具交易流水证明",
            sourceFormat = "CSV",
        ),
        ProviderCard(
            key = "shopping-taobao",
            displayName = "淘宝订单",
            hint = "导出订单 HTML: PC 端 trade.taobao.com → 我的订单 → 保存网页",
            sourceFormat = "HTML",
        ),
    )
    Column(modifier = modifier.fillMaxWidth()) {
        providers.forEachIndexed { idx, p ->
            ProviderCardRow(
                provider = p,
                actionLabel = "导入 ${p.sourceFormat}",
                onAction = { onProviderImport(p.key) },
            )
            if (idx < providers.lastIndex) Spacer(Modifier.height(8.dp))
        }
    }
}

/**
 * D8.1 — 出行 sub-cards (推文 §"出行: 高德 / 携程")
 *
 * 高德 = 历史轨迹 + 收藏地点 (需 OAuth 或 API key 授权)
 * 携程 = 订单/酒店历史 (账号同步)
 */
@Composable
fun TravelGroup(
    onProviderLogin: (providerKey: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val providers = listOf(
        ProviderCard(
            key = "travel-amap",
            displayName = "高德地图",
            hint = "历史轨迹 + 收藏地点 — 需 OAuth 授权访问",
            sourceFormat = "OAuth",
        ),
        ProviderCard(
            key = "travel-ctrip",
            displayName = "携程",
            hint = "订单 / 酒店 / 机票历史 — 账号同步",
            sourceFormat = "登录",
        ),
    )
    Column(modifier = modifier.fillMaxWidth()) {
        providers.forEachIndexed { idx, p ->
            ProviderCardRow(
                provider = p,
                actionLabel = p.sourceFormat,
                onAction = { onProviderLogin(p.key) },
            )
            if (idx < providers.lastIndex) Spacer(Modifier.height(8.dp))
        }
    }
}

/**
 * D10.1 — AI 助手 9 家 sub-cards (推文 §"AI 助手: 豆包 / 文心 / Kimi / 通义 /
 * DeepSeek 等 9 家")
 *
 * 与推文一致的 9 家：豆包 / 文心一言 / Kimi / 通义千问 / DeepSeek / 智谱 GLM /
 * 混元 / 千帆 / 扣子。注：packages/personal-data-hub Phase 10.2 实际 8 厂商
 * (DeepSeek/Kimi/通义/智谱/混元/千帆/扣子/Dreamina)，推文 §豆包/文心 是商业市
 * 占率高的 brand mention 但 PDH 端尚未真接通。AI 助手卡在 v0.1 全显 9 张 stub
 * placeholder 让推文承诺得到 UI 呈现。
 */
@Composable
fun AiAssistantsGroup(
    onProviderLogin: (providerKey: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // 推文 §"豆包 / 文心 / Kimi / 通义 / DeepSeek 等 9 家"
    val providers = listOf(
        ProviderCard("doubao", "豆包 (字节)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("wenxin", "文心一言 (百度)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("kimi", "Kimi (月之暗面)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("tongyi", "通义千问 (阿里)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("deepseek", "DeepSeek", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("zhipu", "智谱 GLM", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("hunyuan", "混元 (腾讯)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("qianfan", "千帆 (百度)", "API key → 对话历史", "API key"),
        ProviderCard("coze", "扣子 (Coze)", "网页 cookie → 对话历史", "WebView"),
    )
    Column(modifier = modifier.fillMaxWidth()) {
        providers.forEachIndexed { idx, p ->
            ProviderCardRow(
                provider = p,
                actionLabel = "登录",
                onAction = { onProviderLogin(p.key) },
            )
            if (idx < providers.lastIndex) Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun ProviderCardRow(
    provider: ProviderCard,
    actionLabel: String,
    onAction: () -> Unit,
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
                Column(modifier = Modifier.fillMaxWidth(0.62f)) {
                    Text(
                        provider.displayName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        provider.hint,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        provider.sourceFormat,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedButton(onClick = onAction, enabled = false) {
                    Text("v0.2 $actionLabel")
                }
            }
        }
    }
}

private data class ProviderCard(
    val key: String,
    val displayName: String,
    val hint: String,
    val sourceFormat: String,
)
