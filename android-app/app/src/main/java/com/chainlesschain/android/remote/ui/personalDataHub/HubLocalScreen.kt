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
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
 *   4. 社交聊天 — 微信 + QQ (Phase 8 unified via SocialAdapterCard;
 *      WechatCard/QQCard retired P8.2/P8.3). UIN-entry dialog flow via
 *      `state.{wechat,qq}.requiresUinEntry`. Frida injector still scaffold
 *      v0.1 until Phase 12.10.4 lands real injection.
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
        // key(adapterName) forces SocialCookieWebViewScreen + its inner
        // AndroidView{WebView} to remount when the user switches from one
        // pending vendor to another without cancelling first. Without this
        // the AndroidView.factory only fires on first composition and the
        // WebView stays stuck on the prior vendor's loginUrl while the
        // dialog title updates to the new vendor — observed on real device:
        // tap Wenxin → tap Kimi → dialog says "Kimi" but WebView loads
        // yiyan.baidu.com + triggers Wenxin's isLoginSuccess immediately.
        key(pending.adapterName) {
            SocialCookieWebViewScreen(
                loginUrl = pending.loginUrl,
                cookieDomain = pending.cookieDomain,
                displayName = pending.displayName,
                isLoginSuccess = pending.isLoginSuccess,
                userAgent = pending.userAgent,
                isLoginSuccessByCookie = pending.isLoginSuccessByCookie,
                // 2026-05-25 真机 fix：b 站桌面 web API 风控严，OkHttp 一切都被拒
                // (cookie / WBI 签名 / dm_img 指纹全齐仍 -400 + silent empty)。唯
                // 一稳路在 WebView 内 evaluateJavascript 跑 fetch（真 Chrome TLS
                // 指纹 + 自动带全 JS-set cookie）。详 BilibiliJsBridge KDoc。
                prefetchJs = when (pending.adapterName) {
                    "social-bilibili" -> com.chainlesschain.android.pdh.social.bilibili.BilibiliJsBridge.PREFETCH_JS
                    "social-douyin" -> com.chainlesschain.android.pdh.social.douyin.DouyinJsBridge.PREFETCH_JS
                    "social-xiaohongshu" -> com.chainlesschain.android.pdh.social.xiaohongshu.XhsJsBridge.PREFETCH_JS
                    "social-toutiao" -> com.chainlesschain.android.pdh.social.toutiao.ToutiaoJsBridge.PREFETCH_JS
                    else -> null
                },
                onPrefetchComplete = when (pending.adapterName) {
                    "social-bilibili" -> { cookie, data -> viewModel.onBilibiliLoginWithPrefetch(cookie, data) }
                    "social-douyin" -> { cookie, data -> viewModel.onDouyinLoginWithPrefetch(cookie, data) }
                    "social-xiaohongshu" -> { cookie, data -> viewModel.onXhsLoginWithPrefetch(cookie, data) }
                    "social-toutiao" -> { cookie, data -> viewModel.onToutiaoLoginWithPrefetch(cookie, data) }
                    else -> null
                },
                onLoginComplete = { cookie ->
                    when {
                        pending.adapterName == "social-bilibili" ->
                            viewModel.onBilibiliLoginCookie(cookie)
                        pending.adapterName == "social-weibo" ->
                            viewModel.onWeiboLoginCookie(cookie)
                        pending.adapterName == "social-douyin" ->
                            viewModel.onDouyinLoginCookie(cookie)
                        pending.adapterName == "social-xiaohongshu" ->
                            viewModel.onXhsLoginCookie(cookie)
                        pending.adapterName == "social-toutiao" ->
                            viewModel.onToutiaoLoginCookie(cookie)
                        pending.adapterName == "social-kuaishou" ->
                            viewModel.onKuaishouLoginCookie(cookie)
                        pending.adapterName.startsWith("ai-chat:") -> {
                            // §2.6 D10.2 — 9 AI vendor 共用 WebView cookie scrape
                            // 入口；adapterName 携 "ai-chat:<vendorKey>" 形态。
                            val vendorKey = pending.adapterName.removePrefix("ai-chat:")
                            viewModel.onAiChatLoginCookie(vendorKey, cookie)
                        }
                        pending.adapterName.startsWith("travel:") -> {
                            // §2.5 D8.2 — 出行 vendor 共用 WebView cookie scrape；
                            // adapterName 携 "travel:<vendorKey>" 形态。
                            val vendorKey = pending.adapterName.removePrefix("travel:")
                            viewModel.onTravelLoginCookie(vendorKey, cookie)
                        }
                        else -> viewModel.cancelLogin()
                    }
                },
                onCancel = { viewModel.cancelLogin() },
            )
        }
        return
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { _ ->
        viewModel.refreshPermissionState()
        viewModel.refreshSystemData()
    }

    // §2.7 D11 polish — SAF picker for "一键带走" (推文 §"想换手机想备份")。
    // CreateDocument suggests a default filename; user can rename or route to
    // Drive / email / etc. Null Uri = user cancelled, no-op.
    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/x-sqlite3"),
    ) { uri ->
        if (uri != null) viewModel.requestExportVaultToUri(uri)
    }

    // §2.4 D7.2 — SAF picker for 支付/购物 CSV+HTML 导入。OpenDocument 支持
    // MIME 过滤 — alipay 账单 = text/csv*；淘宝订单 = text/html / mhtml /
    // application/x-mimearchive (保存网页含 MIME 多部分)。null Uri = 用户取消。
    val alipayBillLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) viewModel.importPaymentShoppingFile("alipay-bill", uri)
    }
    val taobaoOrderLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) viewModel.importPaymentShoppingFile("shopping-taobao", uri)
    }
    // §2.4b 购物双联 v0.2 — 京东 / 美团 订单 SAF 选 JSON snapshot (Android
    // collector 写) 或 *.json/*.html 用户手动导出。v0.3 加 HTML parser。
    val jdOrderLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) viewModel.importPaymentShoppingFile("shopping-jd", uri)
    }
    val meituanOrderLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) viewModel.importPaymentShoppingFile("shopping-meituan", uri)
    }
    // §2.4c 购物三联 v0.2 — 拼多多 订单 SAF 选 JSON snapshot。Pinduoduo 没
    // 自带订单导出，v0.2 用户需手抄 JSON 或等 v0.3 浏览器扩展。MIME 弹默认
    // any 让用户能选自己 export 的任何文件名。
    val pinduoduoOrderLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) viewModel.importPaymentShoppingFile("shopping-pinduoduo", uri)
    }

    LaunchedEffect(Unit) {
        viewModel.refreshPermissionState()
        viewModel.refreshBilibiliFromStore()
        viewModel.refreshWeiboFromStore()
        viewModel.refreshDouyinFromStore()
        viewModel.refreshToutiaoFromStore()
        viewModel.refreshKuaishouFromStore()
        viewModel.refreshWechatFromStore()
        viewModel.refreshQQFromStore()
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
                        // 推文 §"点一下看原文" 真接通: 走 cc hub event-detail
                        // → vault.getEvent(id) → bottom sheet 显原文
                        viewModel.requestCitationDetail(eventId)
                    },
                    onDismissAnswer = { viewModel.clearAskAnswer() },
                    // §2.1 A3.4 — 端侧 LLM 模型状态条 (推文 §"无网也能用" 入口)
                    modelStatus = state.modelStatus,
                    onDownloadModel = { viewModel.downloadModel() },
                    onDeleteModel = { viewModel.deleteModel() },
                    onRouteSelected = { route -> viewModel.setAskRoute(route) },
                    onSelectModel = { key -> viewModel.selectModel(key) },
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
                    onExportRequested = {
                        // §2.7 D11 — launch SAF picker; user picks where to
                        // save. CreateDocument suggested filename includes a
                        // timestamp for uniqueness across multiple backups.
                        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
                        exportLauncher.launch("chainlesschain-vault-$stamp.db")
                    },
                    onClearExportError = { viewModel.clearExportError() },
                )
            }

            // ─── 内容平台（推文 §"内容平台": 抖音/B站/微博/小红书）─────
            item("section-content") { SectionHeader("内容平台") }
            val contentCards = listOf(
                state.bilibili,
                state.weibo,
                state.douyin,
                state.xiaohongshu,
                state.toutiao,
                state.kuaishou,
            )
            items(contentCards, key = { "content-${it.adapterName}" }) { card ->
                SocialAdapterCard(
                    state = card,
                    globalBusy = globalBusy,
                    onLogin = {
                        when (card.adapterName) {
                            "social-bilibili" -> viewModel.requestBilibiliLogin()
                            "social-weibo" -> viewModel.requestWeiboLogin()
                            "social-douyin" -> viewModel.requestDouyinLogin()
                            "social-xiaohongshu" -> viewModel.requestXhsLogin()
                            "social-toutiao" -> viewModel.requestToutiaoLogin()
                            "social-kuaishou" -> viewModel.requestKuaishouLogin()
                            else -> viewModel.requestSocialLoginStub(
                                card.adapterName.removePrefix("social-")
                            )
                        }
                    },
                    onSync = {
                        when (card.adapterName) {
                            "social-bilibili" -> viewModel.syncBilibili()
                            "social-weibo" -> viewModel.syncWeibo()
                            "social-douyin" -> viewModel.syncDouyin()
                            "social-xiaohongshu" -> viewModel.syncXhs()
                            "social-toutiao" -> viewModel.syncToutiao()
                            "social-kuaishou" -> viewModel.syncKuaishou()
                            else -> viewModel.requestSocialLoginStub(
                                card.adapterName.removePrefix("social-")
                            )
                        }
                    },
                    onLogout = {
                        when (card.adapterName) {
                            "social-bilibili" -> viewModel.logoutBilibili()
                            "social-weibo" -> viewModel.logoutWeibo()
                            "social-douyin" -> viewModel.logoutDouyin()
                            "social-xiaohongshu" -> viewModel.logoutXhs()
                            "social-toutiao" -> viewModel.logoutToutiao()
                            "social-kuaishou" -> viewModel.logoutKuaishou()
                        }
                    },
                    onPreviewVault = {
                        viewModel.requestVaultPreview(
                            adapter = card.adapterName,
                            displayName = card.displayName,
                        )
                    },
                    // Phase 7.1.2 — wire Mode B (in-APK root + DB) sync.
                    // Toutiao first as v0.1; Douyin / Bilibili etc. follow
                    // in P7.1.2b once their RootDbCollectors are also
                    // wired (Douyin has classes but no VM method yet).
                    onSyncRoot = when (card.adapterName) {
                        "social-toutiao" -> { -> viewModel.syncToutiaoRoot() }
                        // Phase 7.1.2b — Douyin Mode B wired. Same pattern
                        // as Toutiao (su + cohort + plaintext SQLite).
                        "social-douyin" -> { -> viewModel.syncDouyinRoot() }
                        // Phase 7.2.2 — Bilibili Mode B wired. Plan §6.4 推
                        // SKIP, ship 作 path A fallback only.
                        "social-bilibili" -> { -> viewModel.syncBilibiliRoot() }
                        // Phase 7.4.2 — Weibo Mode B wired. Plan §6.2 零公开
                        // schema 资料; defensive PRAGMA picker + likely-sqlcipher
                        // hint route v0.1 → v0.2 via P7.3 §3.5-3.6 frida hook.
                        "social-weibo" -> { -> viewModel.syncWeiboRoot() }
                        // Phase 7.5.2 — Xhs Mode B wired. Plan §6.5: 极低公开
                        // + libshield.so 反 frida → v0.1 likely 命中 likely-sqlcipher
                        // banner 跳 v2.0 frida + libshield neuter 路径。
                        "social-xiaohongshu" -> { -> viewModel.syncXhsRoot() }
                        // Phase 7.6.2 — Kuaishou Mode B wired (final 6/6 platform).
                        // Plan §6.6: 极低公开 + libmsaoaidsec.so 反 frida 极高
                        // → v0.1 likely 命中 likely-sqlcipher banner 跳 v2.0
                        // frida + libmsaoaidsec neuter 路径。
                        "social-kuaishou" -> { -> viewModel.syncKuaishouRoot() }
                        else -> null
                    },
                )
                Spacer(Modifier.height(8.dp))
            }

            // ─── 社交聊天（推文 §"社交聊天": 微信 + Phase 13.5 QQ）────────
            item("section-im") { SectionHeader("社交聊天") }
            item("im-wechat") {
                // Phase 8.2 — WechatCard composable retired; use SocialAdapterCard
                // for 8/8 platform UI parity. requiresUinEntry=true on
                // state.wechat signals the UIN-entry dialog flow (vs WebView
                // cookie scrape used by the 6 internet-content cards).
                SocialAdapterCard(
                    state = state.wechat,
                    globalBusy = globalBusy,
                    onLogin = { viewModel.requestWechatLogin() },
                    onSync = { viewModel.syncWechat() },
                    onLogout = { viewModel.logoutWechat() },
                    onPreviewVault = {
                        viewModel.requestVaultPreview(
                            adapter = state.wechat.adapterName,
                            displayName = state.wechat.displayName,
                        )
                    },
                )
                if (state.wechat.pendingUinEntry) {
                    WechatUinEntryDialog(
                        onConfirm = { uin, provider, imei ->
                            viewModel.confirmWechatUin(uin, provider, imei)
                        },
                        onCancel = { viewModel.cancelWechatLogin() },
                    )
                }
            }
            item("im-qq") {
                Spacer(Modifier.height(8.dp))
                // Phase 8.3 — QQCard composable retired; use SocialAdapterCard
                // for 8/8 platform UI parity. requiresUinEntry=true on
                // state.qq signals the UIN+IMEI-entry dialog flow.
                SocialAdapterCard(
                    state = state.qq,
                    globalBusy = globalBusy,
                    onLogin = { viewModel.requestQQLogin() },
                    onSync = { viewModel.syncQQ() },
                    onLogout = { viewModel.logoutQQ() },
                    onPreviewVault = {
                        viewModel.requestVaultPreview(
                            adapter = state.qq.adapterName,
                            displayName = state.qq.displayName,
                        )
                    },
                )
                if (state.qq.pendingUinEntry) {
                    QQUinImeiEntryDialog(
                        onConfirm = { uin, imei ->
                            viewModel.confirmQQUinImei(uin, imei)
                        },
                        onCancel = { viewModel.cancelQQLogin() },
                    )
                }
            }

            // ─── 邮箱（推文 §"邮箱": QQ/Gmail/163/Outlook）──────────────
            // D6.1: 4 provider sub-cards
            // §2.3 D6.2: button 接通 → 弹 EmailCredentialsDialog → 写凭据 +
            // 自动 sync → EmailLocalCollector 拉 IMAP INBOX → snapshot.json →
            // cc hub sync email-imap。已配置卡显"同步/退出"。
            item("section-mail") { SectionHeader("邮箱") }
            item("mail-providers") {
                EmailProvidersGroup(
                    states = state.email,
                    globalBusy = globalBusy,
                    onProviderLogin = { viewModel.requestEmailLogin(it) },
                    onProviderSync = { viewModel.syncEmail(it) },
                    onProviderLogout = { viewModel.logoutEmail(it) },
                    onClearError = { viewModel.clearEmailError(it) },
                )
            }

            // ─── 支付与购物（推文 §"支付与购物": 支付宝 / 淘宝）────────
            // D7.1: 2 provider sub-cards (alipay-bill CSV / shopping-taobao HTML)
            // §2.4 D7.2: button 接通 SAF picker — alipay-bill → CSV / shopping-
            // taobao → HTML（MHTML 也认）。CSV+HTML 走 OpenDocument，无 MIME
            // 严过滤（系统 picker 默认允许任意 MIME，避免用户找不到导出文件）。
            item("section-pay") { SectionHeader("支付与购物") }
            item("pay-providers") {
                PaymentShoppingGroup(
                    onProviderImport = { key ->
                        when (key) {
                            "alipay-bill" ->
                                alipayBillLauncher.launch(arrayOf("text/csv", "text/comma-separated-values", "application/csv", "text/plain", "*/*"))
                            "shopping-taobao" ->
                                taobaoOrderLauncher.launch(arrayOf("text/html", "application/x-mimearchive", "multipart/related", "*/*"))
                            // §2.4b 购物双联 v0.2 — JD / Meituan 默认 JSON snapshot；
                            // 同时允许 text/html (v0.3 HTML parse 路径预留) + */*
                            // 兜底 (用户从 Android collector staging 选 .json 文件)
                            "shopping-jd" ->
                                jdOrderLauncher.launch(arrayOf("application/json", "text/json", "text/html", "*/*"))
                            "shopping-meituan" ->
                                meituanOrderLauncher.launch(arrayOf("application/json", "text/json", "text/html", "*/*"))
                            // §2.4c 购物三联 v0.2 — 拼多多 JSON only (v0.3 HTML 路径
                            // 预留)。Pinduoduo 无自带订单导出，用户需手抄或等浏览器扩展
                            "shopping-pinduoduo" ->
                                pinduoduoOrderLauncher.launch(arrayOf("application/json", "text/json", "*/*"))
                            else -> Timber.w("HubLocalScreen: unknown payment provider key=%s", key)
                        }
                    },
                )
            }

            // ─── 出行（推文 §"出行": 高德 / 携程）───────────────────────
            // D8.1: 2 provider sub-cards (travel-amap / travel-ctrip)
            // §2.5 D8.2: button 接通 → requestTravelLogin(vendorKey) → 推
            // pendingLogin → SocialCookieWebViewScreen WebView → cookie 写
            // EncryptedSharedPreferences。Sync 走 cc hub sync travel-{vendor}.
            item("section-travel") { SectionHeader("出行") }
            item("travel-providers") {
                TravelGroup(
                    onProviderLogin = { key -> viewModel.requestTravelLogin(key) },
                )
            }

            // ─── AI 助手（推文 §"AI 助手": 9 家）──────────────────────
            // D10.1: 9 provider sub-cards 全显
            // §2.6 D10.2: button 接通 → requestAiChatLogin(vendorKey) → 推
            // pendingLogin → SocialCookieWebViewScreen 接管 WebView → cookie
            // 写 EncryptedSharedPreferences。Sync 走 cc hub sync ai-chat-history.
            item("section-aichat") { SectionHeader("AI 助手") }
            item("aichat-providers") {
                AiAssistantsGroup(
                    onProviderLogin = { key -> viewModel.requestAiChatLogin(key) },
                )
            }

            // ─── 操作账本（推文 §"每次操作都有账本"）── §2.9 ──────────────
            // 本机 vault 的 audit log（不同于 HubAuditScreen 的远程 RPC 版）。
            // cc hub recent-audit --limit 50 --json → LazyColumn 渲染。
            item("section-audit") { SectionHeader("操作账本") }
            item("local-audit") {
                HubAuditCard(
                    state = state.localAudit,
                    globalBusy = globalBusy,
                    onRefresh = { viewModel.refreshAudit() },
                    onClearError = { viewModel.clearAuditError() },
                )
            }

            item("bottom-spacer") { Spacer(Modifier.height(24.dp)) }
        }
    }

    // 推文 §"AI 给出处 · 点一下看原文" — citation chip 击发后 bottom sheet
    CitationDetailSheet(
        state = state.citationDetail,
        onDismiss = { viewModel.dismissCitationDetail() },
    )

    // 2026-05-24 "看本机数据"入口 — SocialAdapterCard 上"看采集到的"按钮触发。
    // 让用户能直接看 vault 里到底有没有真东西，回答"同步成功但 AI 说没内容"。
    VaultPreviewSheet(
        state = state.vaultPreview,
        onDismiss = { viewModel.dismissVaultPreview() },
    )

    // §2.3 D6.2 — Email IMAP credentials dialog. 至多 1 个 vendor 同时 pending
    // (UI 只让用户点一张卡的 "登录" 按钮)。找到 pendingDialog=true 的那个就渲。
    val pendingEmail = state.email.values.firstOrNull { it.pendingDialog }
    if (pendingEmail != null) {
        val vendor = com.chainlesschain.android.pdh.email.EmailVendor.fromKey(pendingEmail.vendorKey)
        if (vendor != null) {
            EmailCredentialsDialog(
                vendor = vendor,
                onConfirm = { user, password, host, port ->
                    viewModel.submitEmailCredentials(
                        vendorKey = vendor.key,
                        user = user,
                        password = password,
                        imapHost = host,
                        imapPort = port,
                    )
                },
                onCancel = { viewModel.cancelEmailLogin(vendor.key) },
            )
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
    onPreviewVault: () -> Unit,
    // Phase 7.1.2 — Optional Mode B (path B) sync. Non-null for platforms
    // that have an in-APK root collector wired (Toutiao first as v0.1).
    // Renders a secondary "本机 root" button next to the main sync.
    onSyncRoot: (() -> Unit)? = null,
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
                        // Phase 8.1 — prefer uidStr (WeChat/QQ String UIN
                        // with leading-zero matter; Xhs 24-char hex) over
                        // uid.toString(). uidStr takes precedence when
                        // non-null. keyProvider (WeChat md5/frida) appended
                        // when present.
                        state.isLoggedIn && (state.uidStr ?: state.uid?.toString()) != null &&
                            state.keyProvider != null ->
                            "已登录 UID:${state.uidStr ?: state.uid} · keyProvider=${state.keyProvider}"
                        state.isLoggedIn && state.uidStr != null -> "已登录 UID:${state.uidStr}"
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

            // Real-device 2026-05-23 (Xiaomi 24115RA8EC): a 4-minute spinner
            // with no progress hint is unfriendly. When the VM emits stage
            // text via [SocialCardState.syncStatusText], surface it under
            // the title so the user knows which phase is in flight + how
            // long the cc subprocess has been writing the vault.
            val stage = state.syncStatusText
            if (state.isSyncing && !stage.isNullOrBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    stage,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
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
                // "看本机数据" — only shown when this adapter has actually
                // written something to vault. Lets the user verify the sync
                // wasn't a silent empty (3-API-empty branch shows error, but
                // partial-empty / RAG-miss-but-data-present is invisible w/o
                // this button). 2026-05-24 user feedback.
                if (state.isLoggedIn && state.lastSyncCount > 0 && state.implemented) {
                    TextButton(
                        onClick = onPreviewVault,
                        enabled = !state.isSyncing && !globalBusy,
                    ) { Text("看采集到的") }
                    Spacer(Modifier.size(8.dp))
                }
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
                // Phase 7.1.2 — Mode B (in-APK root) sync, when wired for this
                // platform. Renders only when caller supplied onSyncRoot (i.e.
                // a RootDbCollector exists for this adapter — currently only
                // Toutiao). Path B reads /data/data/<pkg>/databases/ directly
                // via root + cohort copy + local SQLite — no network, no PC.
                onSyncRoot?.let { handler ->
                    Spacer(Modifier.size(8.dp))
                    OutlinedButton(
                        onClick = handler,
                        enabled = !state.isSyncing && !globalBusy && state.implemented,
                    ) {
                        Text("本机 root")
                    }
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

// Phase 8.2 — WechatCard composable deleted; SocialAdapterCard used instead.
// See item("im-wechat") block (line ~363) for the call site. WechatUinEntryDialog
// (below) stays — still rendered when `state.wechat.pendingUinEntry == true`.

/**
 * Phase 12.10.1 — uin entry dialog shown when the user taps "登录 / 授权"
 * on the WeChat card. WeChat doesn't use WebView-cookie auth like Bilibili,
 * so we just ask the user to type their numeric UIN.
 */
@Composable
private fun WechatUinEntryDialog(
    onConfirm: (uin: String, keyProvider: String, imei: String?) -> Unit,
    onCancel: () -> Unit,
) {
    var uin by remember { mutableStateOf("") }
    var imei by remember { mutableStateOf("") }
    var keyProvider by remember { mutableStateOf("frida") }

    val isMd5 = keyProvider == "md5"
    val canConfirm = uin.isNotBlank() && (!isMd5 || imei.length == 15)

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
                    Text("frida (WeChat 8.0+，推荐)")
                    Spacer(Modifier.size(16.dp))
                    androidx.compose.material3.RadioButton(
                        selected = keyProvider == "md5",
                        onClick = { keyProvider = "md5" },
                    )
                    Text("md5 (7.x)")
                }
                if (isMd5) {
                    Spacer(Modifier.height(12.dp))
                    androidx.compose.material3.OutlinedTextField(
                        value = imei,
                        onValueChange = { imei = it.filter { c -> c.isDigit() }.take(15) },
                        label = { Text("设备 IMEI（15 位纯数字）") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        supportingText = {
                            Text(
                                "拨号 *#06# 可查；Android 10+ 自动读取受限，手动填。" +
                                    "MD5(IMEI+UIN)[:7] 即 SQLCipher 密钥（sjqz wechat_decrypt 算法）。",
                                style = MaterialTheme.typography.labelSmall,
                            )
                        },
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(uin, keyProvider, imei.takeIf { isMd5 && it.isNotBlank() }) },
                enabled = canConfirm,
            ) { Text("绑定") }
        },
        dismissButton = {
            TextButton(onClick = onCancel) { Text("取消") }
        },
    )
}

// Phase 8.3 — QQCard composable deleted; SocialAdapterCard used instead.
// See item("im-qq") block (line ~389) for the call site. QQUinImeiEntryDialog
// (below) stays — still rendered when `state.qq.pendingUinEntry == true`.


/**
 * Phase 13.5 v0.2 — QQ uin + imei entry dialog. Both fields required —
 * IMEI is the XOR cycle key (no fallback keyProvider like WeChat's frida path).
 */
@Composable
private fun QQUinImeiEntryDialog(
    onConfirm: (uin: String, imei: String) -> Unit,
    onCancel: () -> Unit,
) {
    var uin by remember { mutableStateOf("") }
    var imei by remember { mutableStateOf("") }

    val canConfirm = uin.isNotBlank() && imei.length == 15

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("QQ 账号绑定") },
        text = {
            Column {
                Text(
                    "前置：(1) 设备已 root (Magisk Zygisk on + DenyList com.tencent.mobileqq) " +
                        "(2) QQ 已登录主账号。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                androidx.compose.material3.OutlinedTextField(
                    value = uin,
                    onValueChange = { uin = it.filter { c -> c.isDigit() } },
                    label = { Text("QQ UIN（纯数字）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                androidx.compose.material3.OutlinedTextField(
                    value = imei,
                    onValueChange = { imei = it.filter { c -> c.isDigit() }.take(15) },
                    label = { Text("设备 IMEI（15 位纯数字）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    supportingText = {
                        Text(
                            "拨号 *#06# 可查；Android 10+ 自动读取受限，手动填。" +
                                "IMEI 即 QQ msgData XOR 循环密钥（sjqz qq.py 算法）。",
                            style = MaterialTheme.typography.labelSmall,
                        )
                    },
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(uin, imei) },
                enabled = canConfirm,
            ) { Text("绑定") }
        },
        dismissButton = {
            TextButton(onClick = onCancel) { Text("取消") }
        },
    )
}

private val syncFormatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

private fun formatLastSync(epochMs: Long): String = syncFormatter.format(Date(epochMs))
