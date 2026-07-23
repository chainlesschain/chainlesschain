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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * D7.1 + D7.2 — 支付与购物 sub-cards (推文 §"支付与购物: 支付宝 / 淘宝")
 *
 * 各来源使用可操作 provider 子卡。onProviderImport 在 Screen 端 launch
 * ACTION_OPEN_DOCUMENT picker，
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
    // (Android collector WebView cookie scrape 写)；当前明确只接受 JSON 导出，
    // 不把尚未验证的 HTML 页面结构当作采集能力。
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
    states: Map<String, HubLocalViewModel.TravelCardState>,
    globalBusy: Boolean,
    onProviderLogin: (providerKey: String) -> Unit,
    onProviderImport: (providerKey: String) -> Unit,
    onProviderSync: (providerKey: String) -> Unit,
    onProviderLogout: (providerKey: String) -> Unit,
    onClearError: (providerKey: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // 12306 使用已验证的登录态实时拉取；其余来源只开放本地文件导入，避免
    // 把未经官方确认的私有 API 或只有 cookie、没有事件的空快照标成成功。
    val providers = listOf(
        ProviderCard(
            key = "travel-amap",
            displayName = "高德地图",
            hint = "导入已提取的 amap.db，采集搜索、路线与收藏地点",
            sourceFormat = "SQLite DB",
        ),
        ProviderCard(
            key = "travel-baidu-map",
            displayName = "百度地图",
            hint = "导入百度地图 SQLite 数据库或结构化快照",
            sourceFormat = "SQLite DB / JSON",
        ),
        ProviderCard(
            key = "travel-tencent-map",
            displayName = "腾讯地图",
            hint = "导入包含收藏、搜索与路线事件的结构化快照",
            sourceFormat = "JSON",
        ),
        ProviderCard(
            key = "travel-ctrip",
            displayName = "携程",
            hint = "导入携程订单 JSON / JSONL；不依赖未公开的私有接口",
            sourceFormat = "JSON / JSONL",
        ),
        // 中国铁路 12306：登录后实时同步近 90 天与待出行订单。
        ProviderCard(
            key = "travel-12306",
            displayName = "12306",
            hint = "网页登录后同步近 90 天已完成订单与待出行订单",
            sourceFormat = "WebView",
        ),
    )
    Column(modifier = modifier.fillMaxWidth()) {
        providers.forEachIndexed { idx, p ->
            val state = states[p.key] ?: HubLocalViewModel.TravelCardState(
                vendorKey = p.key,
                displayName = p.displayName,
            )
            if (p.key == "travel-12306") {
                AccountProviderCardRow(
                    provider = p,
                    isLoggedIn = state.isLoggedIn,
                    isSyncing = state.isSyncing,
                    lastSyncAt = state.lastSyncAt,
                    lastSyncCount = state.lastSyncCount,
                    errorMessage = state.errorMessage,
                    globalBusy = globalBusy,
                    onLogin = { onProviderLogin(p.key) },
                    onSync = { onProviderSync(p.key) },
                    onLogout = { onProviderLogout(p.key) },
                    onClearError = { onClearError(p.key) },
                )
            } else {
                ManualImportProviderCardRow(
                    provider = p,
                    isImporting = state.isSyncing,
                    lastImportAt = state.lastSyncAt,
                    lastImportCount = state.lastSyncCount,
                    errorMessage = state.errorMessage,
                    globalBusy = globalBusy,
                    onImport = { onProviderImport(p.key) },
                    onClearError = { onClearError(p.key) },
                )
            }
            if (idx < providers.lastIndex) Spacer(Modifier.height(8.dp))
        }
    }
}

/**
 * D10.1 / D10.2 — AI 助手 sub-cards (推文 §"AI 助手: 豆包 / 文心 / Kimi /
 * 通义 / DeepSeek 等")
 *
 * 文心与千帆共用 qianfan vendor，再加豆包与即梦，共 9 个入口。全部走
 * WebView cookie capture → Android 敏感快照 → ai-chat-history → 本机 vault。
 */
@Composable
fun AiAssistantsGroup(
    states: Map<String, HubLocalViewModel.AiChatCardState>,
    globalBusy: Boolean,
    onProviderLogin: (providerKey: String) -> Unit,
    onProviderSync: (providerKey: String) -> Unit,
    onProviderLogout: (providerKey: String) -> Unit,
    onClearError: (providerKey: String) -> Unit,
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
            val state = states[p.key] ?: HubLocalViewModel.AiChatCardState(
                vendorKey = p.key,
                displayName = p.displayName,
            )
            AccountProviderCardRow(
                provider = p,
                isLoggedIn = state.isLoggedIn,
                isSyncing = state.isSyncing,
                lastSyncAt = state.lastSyncAt,
                lastSyncCount = state.lastSyncCount,
                errorMessage = state.errorMessage,
                globalBusy = globalBusy,
                onLogin = { onProviderLogin(p.key) },
                onSync = { onProviderSync(p.key) },
                onLogout = { onProviderLogout(p.key) },
                onClearError = { onClearError(p.key) },
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

/** Shared state-aware row for providers backed by encrypted credentials. */
@Composable
private fun AccountProviderCardRow(
    provider: ProviderCard,
    isLoggedIn: Boolean,
    isSyncing: Boolean,
    lastSyncAt: Long?,
    lastSyncCount: Int,
    errorMessage: String?,
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
                        when {
                            lastSyncAt != null -> "上次同步 $lastSyncCount 条"
                            isLoggedIn -> "已登录，尚未同步"
                            else -> provider.sourceFormat
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (isLoggedIn) {
                    Column(horizontalAlignment = Alignment.End) {
                        OutlinedButton(
                            onClick = onSync,
                            enabled = !globalBusy && !isSyncing,
                        ) {
                            Text(if (isSyncing) "同步中…" else "同步")
                        }
                        Spacer(Modifier.height(4.dp))
                        TextButton(
                            onClick = onLogout,
                            enabled = !globalBusy && !isSyncing,
                        ) {
                            Text("退出", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                } else {
                    OutlinedButton(onClick = onLogin, enabled = !globalBusy) {
                        Text("登录")
                    }
                }
            }
            if (errorMessage != null) {
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
                            errorMessage,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.fillMaxWidth(0.84f),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        TextButton(onClick = onClearError) { Text("知道了") }
                    }
                }
            }
        }
    }
}

@Composable
private fun ManualImportProviderCardRow(
    provider: ProviderCard,
    isImporting: Boolean,
    lastImportAt: Long?,
    lastImportCount: Int,
    errorMessage: String?,
    globalBusy: Boolean,
    onImport: () -> Unit,
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
                        if (lastImportAt != null) "上次导入 $lastImportCount 条" else provider.sourceFormat,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedButton(
                    onClick = onImport,
                    enabled = !globalBusy && !isImporting,
                ) {
                    Text(if (isImporting) "导入中…" else "导入")
                }
            }
            if (errorMessage != null) {
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
                            errorMessage,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.fillMaxWidth(0.84f),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        TextButton(onClick = onClearError) { Text("知道了") }
                    }
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
