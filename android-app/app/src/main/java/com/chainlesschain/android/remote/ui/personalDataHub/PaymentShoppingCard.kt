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
 * D7.1 + D7.2 — 支付与购物 sub-cards (推文 §"支付与购物: 支付宝 / 淘宝")
 *
 * v0.1: 替换原 PlaceholderCategoryCard 单卡为 2 张 provider 子卡。
 * §2.4 D7.2 (本 commit)：button 由 disabled placeholder 升 enabled —
 * onProviderImport 在 Screen 端 launch ACTION_OPEN_DOCUMENT picker，
 * 拿到 Uri 后 VM 走 ContentResolver.openInputStream → filesDir/staging/
 * <adapter>-<ts>.<ext> → LocalCcRunner.syncAdapter(adapter, path)。
 *
 * 推文 §"诚实说" 已坦白此路径 = "采集对方主动开放的导出渠道"。v0.2 候选
 * 补充 NotificationListenerService 监听支付宝/淘宝 push 实现增量采集
 * (不替代 SAF — 二者历史/增量分工)。
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
                enabled = true,
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
    // §2.5 D8.2 — 2 路全 enable 走 WebView cookie scrape → cc hub sync
    // travel-{vendor}. 高德 v0.2 升级 OAuth 拿历史轨迹 API (lbs.amap.com)，
    // v0.1 cookie scrape 拿账户态 + 收藏；携程 cookie scrape 拿订单 + 酒店 +
    // 机票历史。p.key 必须与 TravelVendor.key 对齐 (travel-amap / travel-ctrip).
    val providers = listOf(
        ProviderCard(
            key = "travel-amap",
            displayName = "高德地图",
            hint = "网页登录 cookie → 账户 + 收藏地点 (v0.2 OAuth 加历史轨迹)",
            sourceFormat = "WebView",
        ),
        ProviderCard(
            key = "travel-ctrip",
            displayName = "携程",
            hint = "网页登录 cookie → 订单 / 酒店 / 机票历史",
            sourceFormat = "WebView",
        ),
    )
    Column(modifier = modifier.fillMaxWidth()) {
        providers.forEachIndexed { idx, p ->
            ProviderCardRow(
                provider = p,
                actionLabel = "登录",
                onAction = { onProviderLogin(p.key) },
                enabled = true,
            )
            if (idx < providers.lastIndex) Spacer(Modifier.height(8.dp))
        }
    }
}

/**
 * D10.1 / D10.2 — AI 助手 sub-cards (推文 §"AI 助手: 豆包 / 文心 / Kimi /
 * 通义 / DeepSeek 等")
 *
 * 推文原列 9 家含独立"千帆"，2026-05-22 与"文心一言"合并 (桌面 qianfan
 * adapter BASE=yiyan.baidu.com 实际就是文心一言域名) → 8 家。8 路全 enable
 * 走 WebView cookie scrape → cc hub sync ai-chat-history --vendor <k>
 * → 本机 SQLCipher vault。豆包/coze 桌面 adapter 已 wired，与其他 6 家
 * 对等。
 */
@Composable
fun AiAssistantsGroup(
    onProviderLogin: (providerKey: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // 推文 §"豆包 / 文心 / Kimi / 通义 / DeepSeek 等" 8 家（合并千帆+文心后）。
    // p.key 必须与 AiChatVendor.key 对齐（文心 entry key=qianfan，复用桌面
    // qianfan adapter）。
    val providers = listOf(
        ProviderCard("doubao", "豆包 (字节)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("qianfan", "文心一言 (百度)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("kimi", "Kimi (月之暗面)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("tongyi", "通义千问 (阿里)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("deepseek", "DeepSeek", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("zhipu", "智谱 GLM", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("hunyuan", "混元 (腾讯)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("coze", "扣子 (Coze)", "网页 cookie → 对话历史", "WebView"),
    )
    Column(modifier = modifier.fillMaxWidth()) {
        providers.forEachIndexed { idx, p ->
            ProviderCardRow(
                provider = p,
                actionLabel = "登录",
                onAction = { onProviderLogin(p.key) },
                enabled = true,
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
    enabled: Boolean = false,
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
                OutlinedButton(onClick = onAction, enabled = enabled) {
                    Text(if (enabled) actionLabel else "v0.2 $actionLabel")
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
