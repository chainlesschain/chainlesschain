package com.chainlesschain.android.remote.ui.personalDataHub

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import timber.log.Timber
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Plan A v0.1 + A8 + A3 + D5 — 4th tab "本机数据" inside PersonalDataHubScreen.
 *
 * Distinguishing this tab from the other three:
 *  - 提问 / Adapter / 审计 → remote (RPC into the paired desktop's hub)
 *  - 本机数据             → local (in-APK cc subprocess writes to a local
 *                          vault.db at filesDir/.chainlesschain/hub/)
 *
 * D5 layout — LazyColumn 6-category grouping mirroring推文 §"已支持 19+ App / 6 大类":
 *   1. 提问 — [HubAskCard] (A3 端侧 LLM ask flow，A3.2 wire 后真出答案)
 *   2. 基础数据 — [SystemDataCard] (system-data-android: contacts + apps)
 *   3. 内容平台 — Bilibili (real) + 微博/抖音/小红书 stubs (A8 v0.2 待接通)
 *   4. 社交聊天 — 微信 ([WechatCard], Phase 12.10 scaffold — frida injector
 *      stub'd, surfaces "改用桌面端" until Phase 12.10.4 lands real injection)
 *   5. 邮箱 — QQ/Gmail/163/Outlook placeholder (D6 待开放)
 *   6. 支付与购物 — 支付宝/淘宝 placeholder (D7 待开放)
 *   7. 出行 — 高德/携程 placeholder (D8 待开放)
 *   8. AI 助手 — 9 家 placeholder (D10 待开放)
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
        // D5 — LazyColumn 6 类分组（基础数据 / 社交聊天 / 邮箱 / 支付与购物 /
        // 出行 / 内容平台 / AI 助手）镜像推文 §"已支持 19+ App / 6 大类"。未实施
        // 大类先用 PlaceholderCategoryCard 占位，每个 PR 把对应 D6-D10 真接通。
        // A3.8 — HubAskCard 浮在最顶（提问 over 本机数据），与 SystemDataCard 配对。
        val globalBusy = state.globalSyncingAdapter != null
        LazyColumn(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        ) {
            item("header") { ScreenHeader() }
            item("ask") {
                Spacer(Modifier.height(16.dp))
                HubAskCard(
                    state = state.ask,
                    onQuestionChanged = { viewModel.onAskQuestionChanged(it) },
                    onSubmit = { viewModel.askQuestion() },
                    onCitationClick = { eventId ->
                        // v0.1: 没有 cc hub event-detail subcommand，先 log
                        // 留 hook 给后续 (新 LocalCcRunner.queryEvent + 复用
                        // HubEventDetailContent sheet)。chip 上的 excerpt 已
                        // 给用户原文预览，不阻塞当前体验。
                        Timber.i("HubLocalScreen: citation deeplink TODO eventId=$eventId")
                    },
                    onDismissAnswer = { viewModel.clearAskAnswer() },
                )
            }

            // ─── 基础数据 ───────────────────────────────────────────────
            item("section-base") { SectionHeader("基础数据 · Plan A v0.1") }
            item("system-data") {
                SystemDataCard(
                    state = state.systemData,
                    globalBusy = globalBusy,
                    onRequestPermission = { permissionLauncher.launch(Manifest.permission.READ_CONTACTS) },
                    onRefresh = { viewModel.refreshSystemData() },
                )
            }

            // ─── 三道锁（推文 §"三道锁，缺一不可"）──────────────────────
            item("section-locks") { SectionHeader("三道锁") }
            item("three-locks") {
                ThreeLocksCard(
                    state = state.threeLocks,
                    globalBusy = globalBusy,
                    onAllowCloudChanged = { viewModel.setAllowCloudFallback(it) },
                    onDestroyConfirmed = { viewModel.requestDestroyVault() },
                    onClearDestroyError = { viewModel.clearDestroyError() },
                    onExportRequested = { viewModel.requestExportVault() },
                    onClearExportError = { viewModel.clearExportError() },
                )
            }

            // ─── 内容平台（推文 §"内容平台": 抖音/B站/微博/小红书）─────
            item("section-content") { SectionHeader("内容平台") }
            val contentCards = listOf(state.bilibili, state.weibo, state.douyin, state.xiaohongshu)
            items(contentCards, key = { "content-${it.adapterName}" }) { card ->
                SocialAdapterCard(
                    state = card,
                    globalBusy = globalBusy,
                    onLogin = {
                        when (card.adapterName) {
                            "social-bilibili" -> viewModel.requestBilibiliLogin()
                            else -> viewModel.requestSocialLoginStub(
                                card.adapterName.removePrefix("social-")
                            )
                        }
                    },
                    onSync = {
                        when (card.adapterName) {
                            "social-bilibili" -> viewModel.syncBilibili()
                            else -> viewModel.requestSocialLoginStub(
                                card.adapterName.removePrefix("social-")
                            )
                        }
                    },
                    onLogout = {
                        if (card.adapterName == "social-bilibili") viewModel.logoutBilibili()
                    },
                )
                Spacer(Modifier.height(8.dp))
            }

            // ─── 社交聊天（推文 §"社交聊天": 微信）─────────────────────
            item("section-im") { SectionHeader("社交聊天") }
            item("im-wechat") {
                WechatCard(
                    state = state.wechat,
                    globalBusy = globalBusy,
                    onLogin = { viewModel.requestWechatLogin() },
                    onSync = { viewModel.syncWechat() },
                    onLogout = { viewModel.logoutWechat() },
                )
                if (state.wechat.pendingUinEntry) {
                    WechatUinEntryDialog(
                        onConfirm = { uin, provider -> viewModel.confirmWechatUin(uin, provider) },
                        onCancel = { viewModel.cancelWechatLogin() },
                    )
                }
            }

            // ─── 邮箱（推文 §"邮箱": QQ/Gmail/163/Outlook）──────────────
            // D6.1: 4 provider sub-cards 替换原单 placeholder，让用户看到推文
            // 列的 4 厂商全显。D6.2 真接通 IMAP 凭据表单 + EmailLocalCollector。
            item("section-mail") { SectionHeader("邮箱") }
            item("mail-providers") {
                EmailProvidersGroup(
                    onProviderLogin = { providerKey ->
                        Timber.i("HubLocalScreen: email provider login TODO key=$providerKey")
                    },
                )
            }

            // ─── 支付与购物（推文 §"支付与购物": 支付宝 / 淘宝）────────
            // D7.1: 2 provider sub-cards (alipay-bill CSV / shopping-taobao HTML)
            item("section-pay") { SectionHeader("支付与购物") }
            item("pay-providers") {
                PaymentShoppingGroup(
                    onProviderImport = { key ->
                        Timber.i("HubLocalScreen: payment/shopping import TODO key=$key")
                    },
                )
            }

            // ─── 出行（推文 §"出行": 高德 / 携程）───────────────────────
            // D8.1: 2 provider sub-cards (travel-amap OAuth / travel-ctrip 登录)
            item("section-travel") { SectionHeader("出行") }
            item("travel-providers") {
                TravelGroup(
                    onProviderLogin = { key ->
                        Timber.i("HubLocalScreen: travel login TODO key=$key")
                    },
                )
            }

            // ─── AI 助手（推文 §"AI 助手": 9 家）──────────────────────
            // D10.1: 9 provider sub-cards 全显 (推文 §豆包/文心/Kimi/通义/
            // DeepSeek 等 9 家)。PDH Phase 10.2 已接通 8 厂商 (DeepSeek/Kimi/
            // 通义/智谱/混元/千帆/扣子/Dreamina)，UI wire D10.2。
            item("section-aichat") { SectionHeader("AI 助手") }
            item("aichat-providers") {
                AiAssistantsGroup(
                    onProviderLogin = { key ->
                        Timber.i("HubLocalScreen: AI vendor login TODO key=$key")
                    },
                )
            }

            item("bottom-spacer") { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun ScreenHeader() {
    Column {
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
    }
}

@Composable
private fun SectionHeader(title: String) {
    Column {
        Spacer(Modifier.height(20.dp))
        Text(
            title,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(8.dp))
    }
}

/**
 * D5 — 大类占位卡。每个大类在真接通前先用一张卡占位，让用户看到推文 §"6 大类"
 * 全部呈现，不会因为只有 system-data + bilibili 实装而误以为产品只有 2 张卡。
 * D6-D10 替换为真 adapter 卡阵列时把对应 item 解锁即可。
 */
@Composable
private fun PlaceholderCategoryCard(title: String, statusText: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                statusText,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
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

/**
 * Phase 12.10.1 — WeChat adapter card (replaces the prior PlaceholderCategoryCard).
 * Visually mirrors [SocialAdapterCard] but takes [HubLocalViewModel.WechatCardState]
 * directly because wechat tracks string-uin not Long-uid + has no WebView login.
 *
 * v0.1 sync path is stubbed at the collector layer — until Phase 12.10.4 ships
 * a real frida-inject binary, the "立即同步" button always surfaces a
 * "改用桌面端" banner. The login + uin entry + state persistence + UI scaffolding
 * are real and exercised by unit tests.
 */
@Composable
private fun WechatCard(
    state: HubLocalViewModel.WechatCardState,
    globalBusy: Boolean,
    onLogin: () -> Unit,
    onSync: () -> Unit,
    onLogout: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "微信",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.size(8.dp))
                Surface(
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                    shape = RoundedCornerShape(4.dp),
                ) {
                    Text(
                        "scaffold v0.1",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                if (state.isLoggedIn) {
                    "UIN: ${state.uin} · keyProvider=${state.keyProvider ?: "?"}"
                } else {
                    "需要 root + WeChat 已登录主账号。Phase 12.10 实施中。"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (state.lastSyncAt != null) {
                Spacer(Modifier.height(4.dp))
                Text(
                    "上次同步: ${syncFormatter.format(Date(state.lastSyncAt))} · +${state.lastSyncCount} 事件",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            state.errorMessage?.let { err ->
                Spacer(Modifier.height(8.dp))
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(6.dp),
                ) {
                    Text(
                        err,
                        modifier = Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!state.isLoggedIn) {
                    Button(
                        onClick = onLogin,
                        enabled = !globalBusy && !state.isSyncing,
                    ) { Text("登录 / 授权") }
                } else {
                    Button(
                        onClick = onSync,
                        enabled = !globalBusy && !state.isSyncing,
                    ) {
                        if (state.isSyncing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(14.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                            Spacer(Modifier.size(6.dp))
                            Text("同步中…")
                        } else {
                            Text("立即同步")
                        }
                    }
                    OutlinedButton(
                        onClick = onLogout,
                        enabled = !globalBusy && !state.isSyncing,
                    ) { Text("退出") }
                }
            }
        }
    }
}

/**
 * Phase 12.10.1 — uin entry dialog shown when the user taps "登录 / 授权"
 * on the WeChat card. WeChat doesn't use WebView-cookie auth like Bilibili,
 * so we just ask the user to type their numeric UIN.
 */
@Composable
private fun WechatUinEntryDialog(
    onConfirm: (uin: String, keyProvider: String) -> Unit,
    onCancel: () -> Unit,
) {
    var uin by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("") }
    var keyProvider by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("frida") }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("微信账号绑定") },
        text = {
            Column {
                Text(
                    "前置：(1) 设备已 root (Magisk Zygisk on + DenyList com.tencent.mm) " +
                        "(2) WeChat 已登录主账号。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                androidx.compose.material3.OutlinedTextField(
                    value = uin,
                    onValueChange = { uin = it.filter { c -> c.isDigit() } },
                    label = { Text("WeChat UIN（纯数字）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    "keyProvider:",
                    style = MaterialTheme.typography.labelMedium,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    androidx.compose.material3.RadioButton(
                        selected = keyProvider == "frida",
                        onClick = { keyProvider = "frida" },
                    )
                    Text("frida (WeChat 8.0+)")
                    Spacer(Modifier.size(16.dp))
                    androidx.compose.material3.RadioButton(
                        selected = keyProvider == "md5",
                        onClick = { keyProvider = "md5" },
                    )
                    Text("md5 (7.x)")
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(uin, keyProvider) },
                enabled = uin.isNotBlank(),
            ) { Text("绑定") }
        },
        dismissButton = {
            TextButton(onClick = onCancel) { Text("取消") }
        },
    )
}

private val syncFormatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

private fun formatLastSync(epochMs: Long): String = syncFormatter.format(Date(epochMs))
