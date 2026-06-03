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
    // §2.4c 购物三联 v0.2 — 5 卡 (支付宝账单 / 淘宝 / 京东 / 美团 / 拼多多)
    // 顺序: 支付 1 + 电商 4。京东/美团/拼多多 v0.2 接 SAF JSON snapshot
    // (Android collector WebView cookie scrape 写)；HTML parser 预留 v0.3。
    // 拼多多 v0.2 无 collector — 用户需手抄 JSON 或等 v0.3 浏览器扩展
    // (mobile.yangkeduo.com 走 anti_token JS-VM 签名，没纯 Kotlin/Node 实现)。
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
        ProviderCard(
            key = "shopping-jd",
            displayName = "京东订单",
            hint = "导出订单 JSON: PC 端 order.jd.com → 我的订单 → 导出 (v0.3 加 HTML)",
            sourceFormat = "JSON",
        ),
        ProviderCard(
            key = "shopping-meituan",
            displayName = "美团订单",
            hint = "导出订单 JSON: PC 端 i.meituan.com → 我的订单 → 导出 (v0.3 加 HTML)",
            sourceFormat = "JSON",
        ),
        ProviderCard(
            key = "shopping-pinduoduo",
            displayName = "拼多多订单",
            hint = "JSON 导入: v0.2 需手抄或浏览器扩展导出 (anti_token 反爬)；v0.3 走自带扩展",
            sourceFormat = "JSON",
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
 * D8.1 + §2.5b 地图三联 — 出行 sub-cards (推文 §"出行: 高德 / 携程" +
 * 推文 §"地图: 高德 / 百度 / 腾讯地图")
 *
 * 4 卡分两类，UI 顺序 = 高德 → 百度 → 腾讯 (3 地图聚集) → 携程 (出行收尾)：
 * - 地图 3 家 (amap / baidu / tencent) = 历史轨迹 + 收藏地点 + 账户态。
 *   cookie scrape 拿账户 + 收藏；完整轨迹 v0.2 各家走 OAuth / 开发者平台 /
 *   .db SAF 导入 (各家 API 各异)
 * - 携程 1 家 = 订单/酒店/机票历史 (cookie scrape 完整链路 — web API 充足)
 */
@Composable
fun TravelGroup(
    onProviderLogin: (providerKey: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // §2.5 D8.2 + §2.5b 地图扩展 — 4 路全 enable 走 WebView cookie scrape →
    // cc hub sync travel-{vendor}. p.key 必须与 TravelVendor.key 对齐
    // (travel-amap / travel-baidu-map / travel-tencent-map / travel-ctrip).
    // 桌面 adapter snapshot mode 接 Android cookie scrape JSON，与既有 sqlite
    // mode (device-pull) 并存。
    val providers = listOf(
        ProviderCard(
            key = "travel-amap",
            displayName = "高德地图",
            hint = "网页登录 cookie → 账户 + 收藏地点 (v0.2 OAuth 加历史轨迹)",
            sourceFormat = "WebView",
        ),
        ProviderCard(
            key = "travel-baidu-map",
            displayName = "百度地图",
            hint = "网页登录 cookie → 账户 + 收藏地点 (v0.2 lbs.baidu.com 加轨迹)",
            sourceFormat = "WebView",
        ),
        ProviderCard(
            key = "travel-tencent-map",
            displayName = "腾讯地图",
            hint = "网页登录 cookie → 账户 + 收藏地点 (v0.2 lbs.qq.com 加轨迹)",
            sourceFormat = "WebView",
        ),
        ProviderCard(
            key = "travel-ctrip",
            displayName = "携程",
            hint = "网页登录 cookie → 订单 / 酒店 / 机票历史",
            sourceFormat = "WebView",
        ),
        // 2026-05-23 v0.3 新增 — 中国铁路 12306。v0.1 仅显登录卡，sync 走 cookie
        // scrape 拿账号态；订单历史 v0.2 走 /otn/queryOrder/queryMyOrder。
        ProviderCard(
            key = "travel-12306",
            displayName = "12306",
            hint = "网页登录 cookie → 账号态 (v0.2 加订单历史)",
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
    // 推文 §"豆包 / 文心 / Kimi / 通义 / DeepSeek 等" 9 家（合并千帆+文心后 8
    // 家 + 2026-05-25 加 即梦 凑回 9 家）。p.key 必须与 AiChatVendor.key 对齐
    // （文心 entry key=qianfan，复用桌面 qianfan adapter）。
    val providers = listOf(
        ProviderCard("doubao", "豆包 (字节)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("qianfan", "文心一言 (百度)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("kimi", "Kimi (月之暗面)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("tongyi", "通义千问 (阿里)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("deepseek", "DeepSeek", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("zhipu", "智谱 GLM", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("hunyuan", "混元 (腾讯)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("coze", "扣子 (Coze)", "网页 cookie → 对话历史", "WebView"),
        ProviderCard("dreamina", "即梦 (字节)", "网页 cookie → 图像/视频生成历史", "WebView"),
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
