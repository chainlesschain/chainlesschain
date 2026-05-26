package com.chainlesschain.android.remote.ui.personalDataHub

import android.app.ActivityManager
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import android.content.Context
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalSystemDataSnapshotter
import com.chainlesschain.android.pdh.email.EmailCredentialsStore
import com.chainlesschain.android.pdh.email.EmailLocalCollector
import com.chainlesschain.android.pdh.email.EmailVendor
import com.chainlesschain.android.pdh.llm.LlmInferenceEngine
import com.chainlesschain.android.pdh.llm.LlmPreferences
import com.chainlesschain.android.pdh.llm.LocalLlmServer
import com.chainlesschain.android.pdh.llm.ModelManager
import com.chainlesschain.android.remote.commands.HubHealth
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import com.chainlesschain.android.pdh.messaging.qq.QQCredentialsStore
import com.chainlesschain.android.pdh.messaging.qq.QQLocalCollector
import com.chainlesschain.android.pdh.social.DESKTOP_CHROME_USER_AGENT
import com.chainlesschain.android.pdh.social.aichat.AiChatCredentialsStore
import com.chainlesschain.android.pdh.social.aichat.AiChatVendor
import com.chainlesschain.android.pdh.social.bilibili.BilibiliCredentialsStore
import com.chainlesschain.android.pdh.social.bilibili.BilibiliLocalCollector
import com.chainlesschain.android.pdh.social.wechat.WeChatCredentialsStore
import com.chainlesschain.android.pdh.social.wechat.WeChatLocalCollector
import com.chainlesschain.android.pdh.social.douyin.DouyinCredentialsStore
import com.chainlesschain.android.pdh.social.douyin.DouyinLocalCollector
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouCredentialsStore
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouLocalCollector
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoCredentialsStore
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoLocalCollector
import com.chainlesschain.android.pdh.social.weibo.WeiboCredentialsStore
import com.chainlesschain.android.pdh.social.weibo.WeiboLocalCollector
import com.chainlesschain.android.pdh.social.xiaohongshu.XhsCredentialsStore
import com.chainlesschain.android.pdh.social.xiaohongshu.XhsLocalCollector
import com.chainlesschain.android.pdh.travel.Kyfw12306LocalCollector
import com.chainlesschain.android.pdh.travel.TravelCredentialsStore
import com.chainlesschain.android.pdh.travel.TravelVendor
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * Plan A v0.1 + A8 — driver for the "本机数据" tab inside PersonalDataHubScreen.
 *
 * Originally a single-CTA driver around [LocalSystemDataSnapshotter] +
 * [LocalCcRunner]. A8 v0.1 (2026-05-22) extends it to a multi-adapter card
 * list so users see Bilibili / 微博 / 抖音 / 小红书 cards alongside the
 * existing 本机数据 (contacts+apps) card. Each social card:
 *
 *  - "登录" — opens an in-app WebView (SocialCookieWebViewScreen) for the
 *            user to authenticate with the platform directly
 *  - "同步" — runs the collector → snapshot.json → in-APK cc → local SQLCipher
 *            vault. No desktop connection required.
 *  - "退出" — clears stored credentials so the user can re-login (or stop
 *            syncing entirely)
 *
 * Why not separate VMs per card? Adapter cards share the LocalCcRunner +
 * are gated against running in parallel (LocalCcRunner spawns a Termux-style
 * subprocess and serializes vault access). A single VM also lets the UI
 * surface a global "syncingCard" lock without per-VM coordination.
 */
@HiltViewModel
class HubLocalViewModel @Inject constructor(
    private val snapshotter: LocalSystemDataSnapshotter,
    private val ccRunner: LocalCcRunner,
    private val bilibiliCollector: BilibiliLocalCollector,
    private val bilibiliCredentials: BilibiliCredentialsStore,
    // Phase 7.2.2 — Bilibili Mode B (in-APK root + local SQLite). Co-exists
    // with path A; UI banner discriminates via "本机 root:" prefix. Plan
    // §6.4 推 SKIP — Mode B 仅作 path A 不可用时的 fallback.
    private val bilibiliRootCollector: com.chainlesschain.android.pdh.social.bilibili.BilibiliRootDbCollector,
    private val bilibiliRootCredentials: com.chainlesschain.android.pdh.social.bilibili.BilibiliRootCredentialsStore,
    private val wechatCollector: WeChatLocalCollector,
    private val wechatCredentials: WeChatCredentialsStore,
    private val llmServer: LocalLlmServer,
    private val aiChatCredentials: AiChatCredentialsStore,
    private val emailCredentials: EmailCredentialsStore,
    private val emailCollector: EmailLocalCollector,
    private val travelCredentials: TravelCredentialsStore,
    private val kyfw12306Collector: Kyfw12306LocalCollector,
    private val weiboCollector: WeiboLocalCollector,
    private val weiboCredentials: WeiboCredentialsStore,
    // Phase 7.4.2 — Weibo Mode B (in-APK root + local SQLite). Co-exists
    // with path A; UI banner discriminates via "本机 root:" prefix. Plan
    // §6.2: Weibo schema 零公开资料 — defensive PRAGMA picker absorbs drift.
    private val weiboRootCollector: com.chainlesschain.android.pdh.social.weibo.WeiboRootDbCollector,
    private val weiboRootCredentials: com.chainlesschain.android.pdh.social.weibo.WeiboRootCredentialsStore,
    private val douyinCollector: DouyinLocalCollector,
    private val douyinCredentials: DouyinCredentialsStore,
    private val douyinSignBridge: com.chainlesschain.android.pdh.social.douyin.DouyinSignBridge,
    // Phase 7.1.2b — Douyin Mode B (in-APK root + local SQLite). Co-exists
    // with path A; UI banner discriminates via "本机 root:" prefix.
    private val douyinRootCollector: com.chainlesschain.android.pdh.social.douyin.DouyinRootDbCollector,
    private val douyinRootCredentials: com.chainlesschain.android.pdh.social.douyin.DouyinRootCredentialsStore,
    private val xhsCollector: XhsLocalCollector,
    private val xhsCredentials: XhsCredentialsStore,
    private val xhsSignBridge: com.chainlesschain.android.pdh.social.xiaohongshu.XhsSignBridge,
    // Phase 7.5.2 — Xhs Mode B (in-APK root + local SQLite). Co-exists
    // with path A; UI banner discriminates via "本机 root:" prefix. Plan
    // §6.5: 极低公开 schema + 高 libshield.so 反爬 → v0.1 期望大概率命中
    // likely-sqlcipher banner 跳 v2.0 frida + libshield neuter 路径。
    private val xhsRootCollector: com.chainlesschain.android.pdh.social.xiaohongshu.XhsRootDbCollector,
    private val xhsRootCredentials: com.chainlesschain.android.pdh.social.xiaohongshu.XhsRootCredentialsStore,
    private val toutiaoCollector: ToutiaoLocalCollector,
    private val toutiaoCredentials: ToutiaoCredentialsStore,
    private val toutiaoSignBridge: com.chainlesschain.android.pdh.social.toutiao.ToutiaoSignBridge,
    // Phase 7.1.2 — Toutiao Mode B (in-APK root + local SQLite). Co-exists
    // with path A; UI banner discriminates via "本机 root:" prefix.
    private val toutiaoRootCollector: com.chainlesschain.android.pdh.social.toutiao.ToutiaoRootDbCollector,
    private val toutiaoRootCredentials: com.chainlesschain.android.pdh.social.toutiao.ToutiaoRootCredentialsStore,
    private val kuaishouCollector: KuaishouLocalCollector,
    private val kuaishouCredentials: KuaishouCredentialsStore,
    private val kuaishouSignBridge: com.chainlesschain.android.pdh.social.kuaishou.KuaishouSignBridge,
    // Phase 7.6.2 — Kuaishou Mode B (in-APK root + local SQLite). Co-exists
    // with path A; UI banner discriminates via "本机 root:" prefix. Plan
    // §6.6: 极低公开 schema + 极高 libmsaoaidsec.so 反爬 → v0.1 likely
    // 命中 likely-sqlcipher banner 跳 v2.0 frida + libmsaoaidsec neuter 路径。
    private val kuaishouRootCollector: com.chainlesschain.android.pdh.social.kuaishou.KuaishouRootDbCollector,
    private val kuaishouRootCredentials: com.chainlesschain.android.pdh.social.kuaishou.KuaishouRootCredentialsStore,
    private val qqCollector: QQLocalCollector,
    private val qqCredentials: QQCredentialsStore,
    private val systemDataState: SystemDataSyncStateStore,
    private val modelManager: ModelManager,
    private val llmEngine: LlmInferenceEngine,
    private val llmPreferences: LlmPreferences,
    private val androidLlmExecutor: AndroidLocalLlmExecutor,
    private val remoteHub: PersonalDataHubCommands,
    @ApplicationContext private val appContext: Context,
) : ViewModel() {

    @Immutable
    data class SystemDataCardState(
        val isLoading: Boolean = false,
        val phase: String? = null,
        val lastSnapshotAt: Long? = null,
        val contactsCount: Int = 0,
        val appsCount: Int = 0,
        val ingested: Int = 0,
        val contactsPermissionGranted: Boolean = false,
        val errorMessage: String? = null,
    )

    @Immutable
    data class SocialCardState(
        /** matches the JS adapter name (e.g. "social-bilibili"). */
        val adapterName: String,
        val displayName: String,
        val implemented: Boolean,
        val isLoggedIn: Boolean = false,
        val uid: Long? = null,
        val isSyncing: Boolean = false,
        val lastSyncAt: Long? = null,
        val lastSyncCount: Int = 0,
        val errorMessage: String? = null,
        /**
         * Stage-grained progress shown while [isSyncing]. Real-device
         * 2026-05-23 (Xiaomi 24115RA8EC, social-weibo): cc subprocess timed
         * out after 240s with the user staring at a spinner the whole time,
         * no clue whether work was happening. Surface "采集帖子... / 采集
         * 收藏... / 写入金库（N s）..." so a stuck sync at least *says where*.
         */
        val syncStatusText: String? = null,
        /**
         * Phase 8.1 — String-form uid for platforms whose identifier can't fit
         * in `Long` (WeChat/QQ UIN is 12+ digits with leading-zero matter for
         * md5 derivation; Xhs userIdStr is 24-char hex ObjectId). When non-null,
         * SocialAdapterCard prefers this over `uid.toString()` in status line.
         * Existing 6 social platforms (Bilibili/Weibo/Douyin/Xhs/Toutiao/Kuaishou)
         * leave null; new IM platforms (WeChat=P8.2, QQ=P8.3) populate this.
         */
        val uidStr: String? = null,
        /**
         * Phase 8.1 — When `true`, the host should render a UIN-entry dialog
         * (WeChat: numeric UIN + keyProvider + IMEI; QQ: UIN + IMEI). Distinct
         * from the WebView-cookie login flow used by the 6 social platforms.
         * VM sets this via [requestWechatLogin] / [requestQQLogin]; cleared on
         * confirm/cancel.
         */
        val pendingUinEntry: Boolean = false,
        /**
         * Phase 8.1 — WeChat-specific: "md5" (7.x) or "frida" (8.0+). Other
         * platforms leave null. SocialAdapterCard surfaces in status line when
         * non-null so the user knows which DB-key derivation path is active.
         */
        val keyProvider: String? = null,
        /**
         * Phase 8.1 — When `true`, login flow uses UIN-entry dialog instead of
         * WebView cookie scrape. WeChat + QQ set this `true`; the 6 social
         * platforms leave `false` (their `onLogin` callbacks push pendingLogin
         * with a WebView loginUrl + cookieDomain).
         */
        val requiresUinEntry: Boolean = false,
    )

    /**
     * Phase 8.2 — WeChat state migrated to [SocialCardState] (uidStr +
     * keyProvider + pendingUinEntry + requiresUinEntry fields added in P8.1).
     * Old WechatCardState data class deleted. Initial value in [UiState]
     * carries `adapterName="wechat"`, `displayName="微信"`, `implemented=true`,
     * `requiresUinEntry=true` (signals WeChat uses UIN-entry dialog instead
     * of WebView cookie scrape for login).
     */

    /**
     * Phase 13.5 v0.2 — QQ uses string-uin like WeChat but has NO keyProvider
     * gate (IMEI is the only decrypt key — see [QQCredentialsStore] kdoc).
     */
    @Immutable
    data class QQCardState(
        val isLoggedIn: Boolean = false,
        val uin: String? = null,
        val isSyncing: Boolean = false,
        val lastSyncAt: Long? = null,
        val lastSyncCount: Int = 0,
        val errorMessage: String? = null,
        /** When true, show the uin+imei entry dialog (Phase 13.5 onboarding). */
        val pendingUinEntry: Boolean = false,
    )

    @Immutable
    data class LoginRequest(
        val adapterName: String,
        val displayName: String,
        val loginUrl: String,
        val cookieDomain: String,
        /** URL-pattern detector run by the WebView screen — true ⇒ extract cookie + return. */
        val isLoginSuccess: (String) -> Boolean,
        /**
         * 可选 WebView UA 整串覆盖。5 家 (Bilibili / 抖音 / 小红书 / 头条 / 快手)
         * 设 [DESKTOP_CHROME_USER_AGENT]，让平台返带**账密表单**的桌面登录页。
         * 微博 m.weibo.cn 不严，留 null 走 sanitize 默认。
         *
         * 2026-05-25 多轮真机迭代教训：
         *   - 初版（Mobile UA + sanitize 剥 wv）→ 平台 funnel 到 mobile 页只剩
         *     deep-link 按钮，账密表单都看不到。抖音直接「下载 App」拦截页。
         *   - 一键登录 deep-link 拉 App，App 内完成授权但 cookie 写在 App 自己
         *     进程沙箱（Android per-process 隔离）→ 我们 WebView CookieManager
         *     拿不到。memory `pdh_social_webview_deeplink_cookie_capture.md`
         *     里的"跨进程 cookie 闭环"假设**对这 5 个平台是错的**。
         *   - **正向**：Desktop UA 让平台返桌面登录页含账密表单 + 扫码（QR）。
         *     账密 cookie 直接写到我们 WebView，跨进程问题不存在。
         */
        val userAgent: String? = null,
        /**
         * 可选 cookie-presence based 登录成功检测，每 1.5s 轮询 CookieManager。
         * 5 家全部走此路径作 belt-and-suspenders 兜底 — onPageFinished URL
         * 检测对 modal/SPA 登录失效（典型：抖音 modal 关后 URL 不变；其它平台
         * 桌面登录也可能 SPA history.replaceState 不触发 onPageFinished）。
         * null = 不轮询，纯走 [isLoginSuccess] URL 路径。
         */
        val isLoginSuccessByCookie: ((cookie: String) -> Boolean)? = null,
    )

    /**
     * 三道锁 state — 推文 §"三道锁，缺一不可" 的三把硬约束在 UI 上的呈现。
     *  - vaultEncrypted: 加密金库（永远 true — SQLCipher AES-256，不可关）
     *  - allowCloudFallback: 拒云开关（默认 false = 默认拒云端 AI 兜底）
     *  - destroying: 一键销毁 in-flight
     *  - destroyError: 销毁报错（极少出现，文件系统错）
     *  - lastDestroyedAt: 上次销毁成功时间（用户重新采集后重置）
     *  - exporting: 一键导出 in-flight
     *  - exportError: 导出报错
     *  - lastExportPath: 上次成功导出的文件绝对路径（user-accessible external-files-dir）
     *  - lastExportBytes: 上次导出文件大小（含 WAL/SHM sidecars）
     */
    @Immutable
    data class ThreeLocksState(
        val vaultEncrypted: Boolean = true,
        val allowCloudFallback: Boolean = false,
        val destroying: Boolean = false,
        val destroyError: String? = null,
        val lastDestroyedAt: Long? = null,
        val exporting: Boolean = false,
        val exportError: String? = null,
        val lastExportPath: String? = null,
        val lastExportBytes: Long = 0L,
    )

    /**
     * A3 — "提问" card state. Drives the local LLM ask flow via
     * [LocalCcRunner.askQuestion] which spawns `cc hub ask --json` against
     * the Kotlin-hosted Ollama-compat LLM server (A3.2 — pending wire).
     *
     * 2026-05-24 — added 4-way LLM route selector (LOCAL_DEVICE / CLOUD_ANDROID
     * / PC_LOCAL / LAN_OLLAMA). 默认 LOCAL_DEVICE 兼容旧行为（on-device LocalLlmServer
     * + 本机 vault RAG）。selectedRoute 由 [LlmRoute] enum 表示，可用性由 4 个 *Available
     * 字段驱动 UI gating。
     */
    @Immutable
    data class AskCardState(
        val question: String = "",
        val isAsking: Boolean = false,
        val answer: String? = null,
        val citations: List<LocalCcRunner.AskReport.Citation> = emptyList(),
        val llmName: String? = null,
        val isLocal: Boolean = true,
        val durationMs: Long = 0L,
        val errorMessage: String? = null,
        // 4-way LLM 路由（默认 LOCAL_DEVICE = on-device LocalLlmServer + 本机 RAG）
        val selectedRoute: LlmRoute = LlmRoute.LOCAL_DEVICE,
        val lanLlmBaseUrl: String? = null,
        val androidLlm: AndroidLocalLlmExecutor.ConfiguredProvider? = null,
        val remoteHealth: HubHealth? = null,
        val localDeviceReady: Boolean = false,
    ) {
        /** 端侧 LocalLlmServer + 本机 vault RAG（即默认 ccRunner.askQuestion 路径） */
        val localDeviceAvailable: Boolean get() = localDeviceReady
        val cloudAvailable: Boolean get() = androidLlm != null
        val pcLocalAvailable: Boolean
            get() = remoteHealth?.llm?.ok == true && remoteHealth.llm.isLocal
        val lanAvailable: Boolean get() = !lanLlmBaseUrl.isNullOrBlank()
        val anyRouteAvailable: Boolean
            get() = localDeviceAvailable || cloudAvailable || pcLocalAvailable || lanAvailable

        val effectiveRoute: LlmRoute
            get() = when {
                selectedRoute == LlmRoute.LOCAL_DEVICE && localDeviceAvailable -> LlmRoute.LOCAL_DEVICE
                selectedRoute == LlmRoute.LAN_OLLAMA && lanAvailable -> LlmRoute.LAN_OLLAMA
                selectedRoute == LlmRoute.PC_LOCAL && pcLocalAvailable -> LlmRoute.PC_LOCAL
                selectedRoute == LlmRoute.CLOUD_ANDROID && cloudAvailable -> LlmRoute.CLOUD_ANDROID
                localDeviceAvailable -> LlmRoute.LOCAL_DEVICE
                cloudAvailable -> LlmRoute.CLOUD_ANDROID
                pcLocalAvailable -> LlmRoute.PC_LOCAL
                lanAvailable -> LlmRoute.LAN_OLLAMA
                else -> selectedRoute
            }
    }

    /**
     * §2.1 A3.4 — UI mirror of [ModelManager.State]. The Compose layer renders
     * a status banner inside [HubAskCard] derived from this single field, so it
     * survives ModelManager refactors (e.g., when v0.2 lock SHA256). Mapping:
     *
     * - [ModelManager.State.NotDownloaded] → kind=NOT_DOWNLOADED (button: 下载模型)
     * - [ModelManager.State.Downloading]  → kind=DOWNLOADING (progress bar, fraction)
     * - [ModelManager.State.Verifying]    → kind=VERIFYING (spinner)
     * - [ModelManager.State.Ready]        → kind=READY (badge: 已就绪 modelName)
     * - [ModelManager.State.Failed]       → kind=FAILED (error + retry button)
     *
     * 推文 §"无网也能用" 的可见性入口：用户不下载模型就无法离线提问，UI 必须把
     * 状态摆出来，否则推文承诺与首问 fail-fast 之间出现认知鸿沟。
     */
    @Immutable
    data class ModelStatusState(
        val kind: Kind = Kind.UNKNOWN,
        val modelName: String? = null,
        val receivedBytes: Long = 0L,
        val totalBytes: Long = 0L,
        val errorMessage: String? = null,
        /**
         * §2.1 A3.4 — whether the underlying native engine (.so) is loaded.
         * Snapshot from [LlmInferenceEngine.nativeReady] at VM init. Drives
         * the disclaimer copy in ModelStatusBanner: even if model is READY,
         * inference can't actually run until v0.2 native lib lands.
         */
        val nativeEngineReady: Boolean = true,
        /**
         * 2026-05-26 — 双档模型选择器。UI 渲染 RadioButton 用 [availableModels]
         * 列出 0.5B / 1.5B；[selectedModelKey] 反映用户当前选中的 [ModelManager.ModelSpec.key]。
         * [deviceTotalRamMb] 从 [ActivityManager] 一次性读取，UI 拿来比 1.5B 推荐 RAM
         * (6144 MB) 给 RAM 警告。空 list 时 UI 退化到旧单档渲染（兼容尚未 collect 完成的初始态）。
         */
        val availableModels: List<ModelOption> = emptyList(),
        val selectedModelKey: String = "",
        val deviceTotalRamMb: Long = 0L,
    ) {
        enum class Kind { UNKNOWN, NOT_DOWNLOADED, DOWNLOADING, VERIFYING, READY, FAILED }

        val progressFraction: Float
            get() = if (totalBytes > 0L) receivedBytes.toFloat() / totalBytes.toFloat() else 0f

        val selectedModel: ModelOption?
            get() = availableModels.firstOrNull { it.key == selectedModelKey }
    }

    /**
     * 2026-05-26 — UI-facing snapshot of [ModelManager.ModelSpec]，给 RadioButton
     * 列表用。不直接暴露 [ModelManager.ModelSpec] 是为了让 Compose preview / unit
     * test 不依赖 ModelManager 实例化。
     */
    @Immutable
    data class ModelOption(
        val key: String,
        val displayName: String,
        val sizeMb: Long,
        val shaLocked: Boolean,
        val recommendedRamMb: Long,
    )

    /**
     * 推文 §"AI 给出处 · 点一下看原文" 的 bottom sheet state。
     * Citation chip click → requestCitationDetail(eventId) → cc hub event-detail
     * → 填充本 state → UI 显 sheet。
     */
    @Immutable
    data class CitationDetailState(
        val visible: Boolean = false,
        val eventId: String? = null,
        val loading: Boolean = false,
        val event: LocalCcRunner.VaultEvent? = null,
        val notFound: Boolean = false,
        val errorMessage: String? = null,
    )

    /**
     * §2.9 — 本机 audit card 状态。推文 §"每次操作都有账本"：每次同步 /
     * 提问 / 注册 / 销毁都写一条 row 到本机 vault 的 audit 表，本地 LLM
     * 不联网，UI 直接 spawn 本机 cc hub recent-audit --json 读回。
     *
     * 跟 [HubAuditViewModel] 的远程版本区别：本卡走 LocalCcRunner（本机
     * vault.db），远程版走 PersonalDataHubCommands（桌面 RPC）。两者
     * action 名相同（ingest / ask / register / ...），但数据源完全不同。
     */
    @Immutable
    data class LocalAuditState(
        val isLoading: Boolean = false,
        val rows: List<LocalCcRunner.AuditRow> = emptyList(),
        val errorMessage: String? = null,
        val lastRefreshAt: Long? = null,
    )

    /**
     * §2.4 D7.2 — 支付与购物 SAF 导入状态。每次 import 一个 CSV (alipay-bill)
     * 或 HTML (shopping-taobao)：用户点 button → Screen launch
     * ACTION_OPEN_DOCUMENT picker → VM 读 Uri → 拷到 filesDir/staging/
     * <providerKey>-<ts>.<ext> → LocalCcRunner.syncAdapter。
     *
     * 推文 §"诚实说" 已坦白此路径 = "只能采集对方主动开放的导出渠道"。
     */
    @Immutable
    data class PaymentImportCardState(
        val isImporting: Boolean = false,
        val lastImportAt: Long? = null,
        val lastImportBytes: Long = 0L,
        val errorMessage: String? = null,
    )

    @Immutable
    data class PaymentShoppingState(
        val alipayBill: PaymentImportCardState = PaymentImportCardState(),
        val taobaoOrder: PaymentImportCardState = PaymentImportCardState(),
        // §2.4b 购物双联 v0.2 — JD + Meituan SAF import (HTML/JSON)
        val jdOrder: PaymentImportCardState = PaymentImportCardState(),
        val meituanOrder: PaymentImportCardState = PaymentImportCardState(),
        // §2.4c 购物三联 v0.2 — Pinduoduo SAF import (JSON only; no cookie
        // mode because pinduoduo web requires anti_token JS-VM signing).
        val pinduoduoOrder: PaymentImportCardState = PaymentImportCardState(),
    )

    /**
     * §2.6 D10.2 — per-vendor AI chat card state (推文 §"AI 助手 9 家"). UI 9
     * 卡 (AiChatVendor.ORDERED) 全显，每卡独立 isLoggedIn / isSyncing /
     * lastSyncAt / lastSyncCount / errorMessage。
     *
     * 同步路径：cookie scrape via SocialCookieWebViewScreen → saveCookie →
     * cc hub sync ai-chat-history --vendor <key>. v0.1 桌面 adapter 已对接
     * 8/9 (DeepSeek/Kimi/通义/智谱/混元/千帆/扣子/Dreamina)，豆包/文心 桌面
     * adapter 仍 v0.2 — cookie 已能存 (用户 onboarding 不丢)，sync 报"待
     * 桌面 adapter wire"，不阻塞 UX。
     */
    @Immutable
    data class AiChatCardState(
        val vendorKey: String,
        val displayName: String,
        val isLoggedIn: Boolean = false,
        val isSyncing: Boolean = false,
        val lastSyncAt: Long? = null,
        val lastSyncCount: Int = 0,
        val errorMessage: String? = null,
    )

    /**
     * §2.3 D6.2 — per-vendor 邮箱 IMAP card state (推文 §"邮箱 4 家")。UI 4
     * 卡 (EmailVendor.ORDERED) 全显，每卡独立 hasCredentials / isSyncing /
     * lastSyncAt / lastSyncCount / errorMessage / pendingDialog (boolean —
     * 控制 EmailCredentialsDialog 是否对本卡 vendor 显示)。
     */
    @Immutable
    data class EmailCardState(
        val vendorKey: String,
        val displayName: String,
        val hasCredentials: Boolean = false,
        val isSyncing: Boolean = false,
        val lastSyncAt: Long? = null,
        val lastSyncCount: Int = 0,
        val errorMessage: String? = null,
        val pendingDialog: Boolean = false,
    )

    /**
     * §2.5 D8.2 — per-vendor 出行 cookie scrape card state (推文 §"出行: 高德
     * / 携程"). UI 2 卡，每卡独立 hasCredentials / isSyncing / lastSync* /
     * errorMessage。
     */
    @Immutable
    data class TravelCardState(
        val vendorKey: String,
        val displayName: String,
        val isLoggedIn: Boolean = false,
        val isSyncing: Boolean = false,
        val lastSyncAt: Long? = null,
        val lastSyncCount: Int = 0,
        val errorMessage: String? = null,
    )

    /**
     * "看本机数据" bottom-sheet state. 让用户能直接看 vault 里到底有没有真东西，
     * 不用进终端跑 `cc hub query-events`。
     *
     * Why this exists: 2026-05-24 user feedback — "微博虽然提示同步成功但是问 ai
     * 说是没内容 同步的数据在哪 可以可视化看见么"。SocialCard 只显计数，
     * 没法看具体内容；AskCard RAG 召回不一定命中。预览 sheet 直接 dump 最近 N
     * 条 raw 事件 + summary，让用户自己判定。
     */
    @Immutable
    data class VaultPreviewState(
        val open: Boolean = false,
        val isLoading: Boolean = false,
        /** null = 不过滤 (取所有 adapter) */
        val adapterFilter: String? = null,
        /** 用户友好的来源标签 — e.g. "微博 (social-weibo)"。null 时取 [adapterFilter] */
        val displayName: String? = null,
        val rows: List<VaultPreviewRow> = emptyList(),
        val errorMessage: String? = null,
    )

    /**
     * UI-facing row distinct from [LocalCcRunner.EventRow] — UI doesn't need
     * raw JSON, only the fields actually rendered. Decoupling lets the VM
     * shape preview rows (e.g. truncate summary, format time) without leaking
     * cc-runner types into Composables.
     */
    @Immutable
    data class VaultPreviewRow(
        val id: String,
        val subtype: String,
        val occurredAt: Long,
        val sourceAdapter: String?,
        val summary: String?,
    )

    @Immutable
    data class UiState(
        val systemData: SystemDataCardState = SystemDataCardState(),
        val bilibili: SocialCardState = SocialCardState(
            adapterName = "social-bilibili",
            displayName = "Bilibili",
            implemented = true,
        ),
        val weibo: SocialCardState = SocialCardState(
            adapterName = "social-weibo",
            displayName = "微博",
            implemented = true,
        ),
        val douyin: SocialCardState = SocialCardState(
            adapterName = "social-douyin",
            displayName = "抖音",
            // §A8 v0.2: profile-only surface (account info via passport
            // endpoint that works without X-Bogus). History/like/favourite
            // 待 v0.3 X-Bogus 签名接通。UI 用 statusLine 透出限制。
            implemented = true,
        ),
        val xiaohongshu: SocialCardState = SocialCardState(
            adapterName = "social-xiaohongshu",
            displayName = "小红书",
            implemented = true,
        ),
        // 2026-05-23 v0.1 — 头条 placeholder card. cookie scrape 拿 uid，
        // events 写空数组 (read/collection/search 需 _signature 签名 v0.2 接通)
        val toutiao: SocialCardState = SocialCardState(
            adapterName = "social-toutiao",
            displayName = "今日头条",
            implemented = true,
        ),
        // 2026-05-23 v0.1 — 快手 placeholder card. cookie scrape 拿 userId，
        // events 写空数组 (watch/collect/search 需 NS_sig3 签名 v0.2 接通)
        val kuaishou: SocialCardState = SocialCardState(
            adapterName = "social-kuaishou",
            displayName = "快手",
            implemented = true,
        ),
        // Phase 8.2 — WeChat migrated to SocialCardState (was WechatCardState).
        // `requiresUinEntry=true` signals WeChat uses UIN-entry dialog flow
        // (vs WebView cookie scrape used by the 6 internet-content cards).
        val wechat: SocialCardState = SocialCardState(
            adapterName = "wechat",
            displayName = "微信",
            implemented = true,
            requiresUinEntry = true,
        ),
        val qq: QQCardState = QQCardState(),
        val pendingLogin: LoginRequest? = null,
        val globalSyncingAdapter: String? = null,
        val ask: AskCardState = AskCardState(),
        val modelStatus: ModelStatusState = ModelStatusState(),
        val threeLocks: ThreeLocksState = ThreeLocksState(),
        val citationDetail: CitationDetailState = CitationDetailState(),
        val localAudit: LocalAuditState = LocalAuditState(),
        val paymentShopping: PaymentShoppingState = PaymentShoppingState(),
        // §2.6 — vendorKey → card state. Default init at construction reads
        // persisted hasCredentials/lastSyncAt from EncryptedSharedPreferences.
        val aiChat: Map<String, AiChatCardState> = emptyMap(),
        // §2.3 — vendorKey → email card state (QQ/Gmail/163/Outlook).
        val email: Map<String, EmailCardState> = emptyMap(),
        // §2.5 — vendorKey → travel card state (travel-amap / travel-ctrip).
        val travel: Map<String, TravelCardState> = emptyMap(),
        val vaultPreview: VaultPreviewState = VaultPreviewState(),
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        refreshPermissionState()
        refreshSystemDataFromStore()
        refreshBilibiliFromStore()
        refreshWeiboFromStore()
        refreshDouyinFromStore()
        refreshXhsFromStore()
        refreshToutiaoFromStore()
        refreshKuaishouFromStore()
        refreshWechatFromStore()
        refreshQQFromStore()
        refreshAiChatFromStore()
        refreshEmailFromStore()
        refreshTravelFromStore()
        observeModelManager()
        initAskRouteState()
    }

    /**
     * 2026-05-24 — populate AskCardState route gating fields:
     *  - lanLlmBaseUrl: hot Flow from LlmPreferences (Settings 改变实时同步)
     *  - androidLlm: one-shot detectProvider() — refresh when user 回到 tab 3/4 可以手动重测
     *  - remoteHealth: one-shot hub.health() — paired desktop's LLM info
     *  - localDeviceReady: snapshot llmEngine.nativeReady at init (engine ready 之后 app restart 才翻)
     */
    private fun initAskRouteState() {
        _state.update {
            it.copy(
                ask = it.ask.copy(
                    localDeviceReady = llmEngine.nativeReady,
                    lanLlmBaseUrl = llmPreferences.getLanLlmBaseUrl(),
                    androidLlm = try { androidLlmExecutor.detectProvider() }
                                  catch (e: Throwable) { Timber.w(e, "detectProvider failed"); null },
                ),
            )
        }
        llmPreferences.lanLlmBaseUrl
            .onEach { url -> _state.update { it.copy(ask = it.ask.copy(lanLlmBaseUrl = url)) } }
            .launchIn(viewModelScope)
        viewModelScope.launch {
            remoteHub.health()
                .onSuccess { h -> _state.update { it.copy(ask = it.ask.copy(remoteHealth = h)) } }
                .onFailure { e -> Timber.w(e, "remoteHub.health() failed (desktop unpaired?)") }
        }
    }

    /** User flipped the route radio. effectiveRoute auto-falls back if not available. */
    fun setAskRoute(route: LlmRoute) {
        _state.update { it.copy(ask = it.ask.copy(selectedRoute = route)) }
    }

    /** 用户在 LLMSettings 里加了新 API key 后,手动再探一次. */
    fun refreshAndroidLlmRoute() {
        val provider = try {
            androidLlmExecutor.detectProvider()
        } catch (e: Throwable) {
            Timber.w(e, "refreshAndroidLlmRoute: detectProvider failed")
            null
        }
        _state.update { it.copy(ask = it.ask.copy(androidLlm = provider)) }
    }

    /**
     * §2.1 A3.4 — collect [ModelManager.state] into [UiState.modelStatus]. One
     * one-shot refresh() kicks off so a previously-downloaded GGUF surfaces as
     * READY on app start without forcing the user to tap "下载". Subsequent
     * state changes flow through the StateFlow collector.
     */
    private fun observeModelManager() {
        // 2026-05-26 — seed availableModels + deviceTotalRamMb once at init. RAM
        // can't change at runtime; spec list is static so a one-shot mapping is
        // enough. selectedModelKey is then driven by the selectedSpec collector.
        val options = modelManager.availableSpecs.map { it.toUi() }
        val ramMb = readDeviceTotalRamMb()
        _state.update {
            it.copy(
                modelStatus = it.modelStatus.copy(
                    availableModels = options,
                    selectedModelKey = modelManager.selectedSpec.value.key,
                    deviceTotalRamMb = ramMb,
                ),
            )
        }
        viewModelScope.launch {
            // Kick a refresh so an already-on-disk model promotes from
            // NotDownloaded → Ready on first compose. Idempotent.
            modelManager.refresh()
        }
        viewModelScope.launch {
            modelManager.state.collect { s ->
                // 2026-05-26 — copy() not replace, so picker fields (availableModels /
                // selectedModelKey / deviceTotalRamMb) seeded at init survive the stream.
                _state.update { ui ->
                    val incoming = s.toUi()
                    ui.copy(
                        modelStatus = ui.modelStatus.copy(
                            kind = incoming.kind,
                            modelName = incoming.modelName,
                            receivedBytes = incoming.receivedBytes,
                            totalBytes = incoming.totalBytes,
                            errorMessage = incoming.errorMessage,
                            nativeEngineReady = incoming.nativeEngineReady,
                        ),
                    )
                }
            }
        }
        viewModelScope.launch {
            // Picker selection — when user flips radio, selectedSpec emits new
            // value and we mirror it into UiState so Compose recomposes the radio.
            modelManager.selectedSpec.collect { spec ->
                _state.update {
                    it.copy(modelStatus = it.modelStatus.copy(selectedModelKey = spec.key))
                }
            }
        }
    }

    /**
     * 2026-05-26 — RAM 总量从 [ActivityManager.MemoryInfo] 读，单位 MB。失败回 0
     * （UI 端 0 视作"未知"，跳过 RAM 警告以免误报）。
     */
    private fun readDeviceTotalRamMb(): Long = try {
        val am = appContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        am?.let {
            val info = ActivityManager.MemoryInfo()
            it.getMemoryInfo(info)
            info.totalMem / 1_048_576L
        } ?: 0L
    } catch (t: Throwable) {
        Timber.w(t, "readDeviceTotalRamMb failed")
        0L
    }

    private fun ModelManager.ModelSpec.toUi(): ModelOption = ModelOption(
        key = key,
        displayName = displayName,
        sizeMb = sizeBytesApprox / 1_048_576L,
        shaLocked = shaLocked,
        recommendedRamMb = recommendedRamMb,
    )

    /**
     * §2.1 A3.4 — user-triggered model download from HubAskCard banner. Hard
     * one-shot: while a download is in flight the UI button is disabled, so
     * concurrent download attempts can't be launched. ModelManager.download()
     * itself is also single-flight via the .part file lock.
     */
    fun downloadModel() {
        if (_state.value.modelStatus.kind == ModelStatusState.Kind.DOWNLOADING) return
        viewModelScope.launch { modelManager.download() }
    }

    /**
     * §2.1 A3.4 — delete the GGUF file (e.g., after FAILED state user wants
     * to retry from scratch instead of resume; or to reclaim ~1GB disk). State
     * flips to NOT_DOWNLOADED via the [observeModelManager] collector.
     */
    fun deleteModel() {
        viewModelScope.launch { modelManager.delete() }
    }

    /**
     * 2026-05-26 — 用户切换选中的模型档（0.5B / 1.5B）。
     *
     * 切换不自动下载/删除 — VM 只通知 ModelManager 改 selectedSpec，然后调
     * refresh() 让 state stream emit 新档的 NotDownloaded/Ready/Failed，UI 重绘。
     * 用户拿到新档真实状态再决定要不要点"下载"。
     *
     * Idempotent。下载/校验进行中 ([Kind.DOWNLOADING] / [Kind.VERIFYING]) 时拒切，
     * 避免 .part 文件污染 — 那两个状态期间 [ModelManager.download] 持有当前 spec
     * 在跑，切档会让进度条对应错档导致 UI 混乱。
     */
    fun selectModel(key: String) {
        val spec = modelManager.availableSpecs.firstOrNull { it.key == key } ?: return
        val kind = _state.value.modelStatus.kind
        if (kind == ModelStatusState.Kind.DOWNLOADING || kind == ModelStatusState.Kind.VERIFYING) {
            return
        }
        if (modelManager.selectedSpec.value.key == spec.key) return
        viewModelScope.launch {
            modelManager.selectSpec(spec)
            modelManager.refresh()
        }
    }

    private fun ModelManager.State.toUi(): ModelStatusState {
        // nativeReady is snapshotted at VM init (engine.nativeReady is val);
        // future runs after v0.2 .so lands flip it transparently via app restart.
        val nativeReady = llmEngine.nativeReady
        return when (this) {
            is ModelManager.State.NotDownloaded -> ModelStatusState(
                kind = ModelStatusState.Kind.NOT_DOWNLOADED,
                nativeEngineReady = nativeReady,
            )
            is ModelManager.State.Downloading -> ModelStatusState(
                kind = ModelStatusState.Kind.DOWNLOADING,
                receivedBytes = receivedBytes,
                totalBytes = totalBytes,
                nativeEngineReady = nativeReady,
            )
            is ModelManager.State.Verifying -> ModelStatusState(
                kind = ModelStatusState.Kind.VERIFYING,
                nativeEngineReady = nativeReady,
            )
            is ModelManager.State.Ready -> ModelStatusState(
                kind = ModelStatusState.Kind.READY,
                modelName = file.name,
                nativeEngineReady = nativeReady,
            )
            is ModelManager.State.Failed -> ModelStatusState(
                kind = ModelStatusState.Kind.FAILED,
                errorMessage = reason,
                nativeEngineReady = nativeReady,
            )
        }
    }

    // ─── System data (contacts + apps) ──────────────────────────────────────

    fun refreshPermissionState() {
        _state.update {
            it.copy(
                systemData = it.systemData.copy(
                    contactsPermissionGranted = snapshotter.hasContactsPermission(),
                ),
            )
        }
    }

    /**
     * Hydrate [SystemDataCardState] from [systemDataState] so the UI recalls
     * "上次同步 X 联系人 / Y 应用" across process death — the same disk-backed
     * recall the social cards do via their *CredentialsStore.
     */
    private fun refreshSystemDataFromStore() {
        val lastAt = systemDataState.getLastSnapshotAt() ?: return
        _state.update {
            it.copy(
                systemData = it.systemData.copy(
                    lastSnapshotAt = lastAt,
                    contactsCount = systemDataState.getContactsCount(),
                    appsCount = systemDataState.getAppsCount(),
                    ingested = systemDataState.getIngested(),
                ),
            )
        }
    }

    fun refreshSystemData() {
        if (_state.value.globalSyncingAdapter != null) return
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "system-data-android",
                    systemData = it.systemData.copy(
                        isLoading = true,
                        phase = "正在读取通讯录与已装应用…",
                        errorMessage = null,
                    ),
                )
            }
            val snapshot = try {
                snapshotter.snapshotAll()
            } catch (e: Exception) {
                Timber.w(e, "HubLocalViewModel: snapshot failed")
                _state.update {
                    it.copy(
                        globalSyncingAdapter = null,
                        systemData = it.systemData.copy(
                            isLoading = false,
                            phase = null,
                            errorMessage = "快照失败: ${e.message ?: e.javaClass.simpleName}",
                        ),
                    )
                }
                return@launch
            }
            _state.update {
                it.copy(
                    systemData = it.systemData.copy(
                        phase = "正在写入本地数据库…",
                        contactsCount = snapshot.contactsCount,
                        appsCount = snapshot.appsCount,
                        lastSnapshotAt = snapshot.snapshottedAt,
                        contactsPermissionGranted = snapshot.contactsPermissionGranted,
                    ),
                )
            }
            when (val r = ccRunner.syncAdapter(
                adapterName = "system-data-android",
                inputPath = snapshot.snapshotPath,
            )) {
                is LocalCcRunner.CcResult.Ok -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            systemData = it.systemData.copy(
                                isLoading = false,
                                phase = null,
                                ingested = r.report.ingested,
                                errorMessage = if (r.report.status != "ok" && r.report.error != null) {
                                    "同步状态: ${r.report.status} (${r.report.error})"
                                } else null,
                            ),
                        )
                    }
                    // Persist so reopening the app recalls last-synced metadata
                    // instead of resurfacing "未同步". Only on Ok — Failed leaves
                    // both UI and disk untouched.
                    systemDataState.recordSync(
                        at = snapshot.snapshottedAt,
                        contactsCount = snapshot.contactsCount,
                        appsCount = snapshot.appsCount,
                        ingested = r.report.ingested,
                    )
                }
                is LocalCcRunner.CcResult.Failed -> {
                    Timber.w(
                        "HubLocalViewModel: cc syncAdapter failed: %s (exit=%s)",
                        r.reason, r.exitCode,
                    )
                    // 用户层面最常见的"sync 失败"原因是首次 EntityResolver 的
                    // embedding 阶段（OllamaClient.embed）超时 —— in-APK 自动
                    // skip 逻辑只在 PREFIX 以 com.chainlesschain.android 开头
                    // 时生效，debug variant (`com.chainlesschain.android.debug`)
                    // 不命中前缀，所以 embed 仍尝试 connect 桌面端 Ollama
                    // (http://localhost:11434)，桌面端没开就 ETIMEDOUT。用户
                    // 不知道这层依赖，会把超时当成 app bug。把提示直接拼到
                    // errorMessage 上，省得查日志。后续 followup：debug 后缀
                    // 也加进 PREFIX 检测；或者把 LLM 桥接换成本地 in-APK 引擎。
                    val needsDesktopHint = r.reason.contains("timed-out", ignoreCase = true) ||
                        r.reason.contains("timeout", ignoreCase = true) ||
                        r.reason.contains("ECONNREFUSED", ignoreCase = true) ||
                        r.reason.contains("Ollama", ignoreCase = true)
                    val baseMsg = "写入本地数据库失败: ${r.reason}"
                    val finalMsg = if (needsDesktopHint) {
                        "$baseMsg\n\n提示：首次同步需要桌面端在线（EntityResolver 的 embedding 阶段会调用桌面端 Ollama，桌面端没启动会超时）。请确认桌面 app 在运行 + Ollama 服务可用，然后重试。"
                    } else baseMsg
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            systemData = it.systemData.copy(
                                isLoading = false,
                                phase = null,
                                errorMessage = finalMsg,
                            ),
                        )
                    }
                }
            }
        }
    }

    // ─── Ask (A3 — on-device LLM) ───────────────────────────────────────────
    //
    // Wraps LocalCcRunner.askQuestion (cc hub ask --json) which drives the
    // existing AnalysisEngine.ask() — same RAG + citations contract as the
    // desktop. In v0.1 the Kotlin-hosted LLM server (A3.2) is not yet wired,
    // so cc will fail with "OllamaClient.chat: request failed" — surfaced
    // to the UI as "端侧 LLM 未启动 (A3.2)". Wire happens in a follow-up.

    fun onAskQuestionChanged(text: String) {
        _state.update { it.copy(ask = it.ask.copy(question = text, errorMessage = null)) }
    }

    fun askQuestion() {
        val q = _state.value.ask.question.trim()
        if (q.isEmpty() || _state.value.ask.isAsking) return
        // Fast path — "你是谁 / 你好 / 你能干嘛" 这类身份/问候/能力 meta 提问，
        // 与个人数据无关。直接调 llmEngine.chat 跳过 cc 子进程 + AnalysisEngine
        // + RAG + HTTP loopback。这条链在端侧硬件冷启就要几秒，meta 问题再走
        // 完整管道纯属浪费。失败时(llmEngine 未就绪)透出原错，让用户知道是
        // 引擎层而非数据中台问题——比 "spawn-failed: ..." 直观。
        if (isMetaQuestion(q)) {
            askDirectLocal(q)
            return
        }
        // 2026-05-24 — route dispatch. Default LOCAL_DEVICE = 既有 on-device LocalLlmServer
        // + 本机 vault RAG（与旧行为一致）。其他路由按用户在 HubAskCard radio 选项分派。
        val askState = _state.value.ask
        val route = askState.effectiveRoute
        when (route) {
            LlmRoute.CLOUD_ANDROID -> {
                val provider = askState.androidLlm
                if (provider == null) {
                    setAskError("请先在「设置 → 大模型」配置云 LLM API Key")
                    return
                }
                submitAskViaCloudAndroid(q, provider)
            }
            LlmRoute.PC_LOCAL -> submitAskViaRemoteDesktop(q)
            LlmRoute.LAN_OLLAMA -> {
                val baseUrl = askState.lanLlmBaseUrl
                if (baseUrl.isNullOrBlank()) {
                    setAskError("局域网 LLM URL 未配置 — 请到「设置 → AI 后端」填写")
                    return
                }
                submitAskViaCc(q, ollamaUrl = baseUrl, llmTag = "LAN")
            }
            LlmRoute.LOCAL_DEVICE -> {
                // 既有路径：cc + 本机 vault RAG + on-device LocalLlmServer
                submitAskViaCc(q, ollamaUrl = llmServer.baseUrl, llmTag = "端侧")
            }
        }
    }

    private fun setAskError(message: String) {
        _state.update {
            it.copy(ask = it.ask.copy(isAsking = false, errorMessage = message, answer = null))
        }
    }

    /**
     * 既有 cc 子进程路径（A3.2 wire 后真出答案）。LOCAL_DEVICE / LAN_OLLAMA 共用，
     * 只换 ollamaUrl —— 局域网 LLM 把流量导向用户填的 LAN host，端侧导向本机
     * LocalLlmServer (127.0.0.1)。
     */
    private fun submitAskViaCc(q: String, ollamaUrl: String?, llmTag: String) {
        val acceptNonLocal = _state.value.threeLocks.allowCloudFallback || llmTag == "LAN"
        _state.update {
            it.copy(
                ask = it.ask.copy(
                    isAsking = true,
                    answer = null,
                    citations = emptyList(),
                    errorMessage = null,
                ),
            )
        }
        // RAG 上下文预算按目标 LLM 体量分档。本机 Qwen2.5-1.5B / Gemma-2B
        // 指令跟随窗口 ~2-4K token，80 facts (cc 默认) 会撑爆 prompt 留不下答
        // 案空间；云端 GPT/DeepSeek/Doubao 32K+ 上下文，能塞更多召回更全。
        val maxFacts = if (acceptNonLocal) FACTS_BUDGET_CLOUD else FACTS_BUDGET_LOCAL
        val maxQueryLimit = if (acceptNonLocal) QUERY_LIMIT_BUDGET_CLOUD else QUERY_LIMIT_BUDGET_LOCAL
        viewModelScope.launch {
            val result = ccRunner.askQuestion(
                q,
                ollamaUrl = ollamaUrl,
                acceptNonLocal = acceptNonLocal,
                maxFacts = maxFacts,
                maxQueryLimit = maxQueryLimit,
            )
            _state.update { st ->
                when (result) {
                    is LocalCcRunner.AskResult.Ok -> st.copy(
                        ask = st.ask.copy(
                            isAsking = false,
                            answer = result.report.answer,
                            citations = result.report.citations,
                            // llmName 保持 raw 模型名，路由信息走 radio 标签;
                            // 兼容旧测试断言 llmName == "qwen2.5"。
                            llmName = result.report.llmName,
                            isLocal = result.report.isLocal,
                            durationMs = result.report.durationMs,
                        ),
                    )
                    is LocalCcRunner.AskResult.Failed -> {
                        Timber.w(
                            "HubLocalViewModel.submitAskViaCc: cc failed reason=%s exit=%s",
                            result.reason, result.exitCode,
                        )
                        val hint = if (
                            result.reason.contains("OllamaClient", ignoreCase = true) ||
                            result.reason.contains("ECONNREFUSED", ignoreCase = true) ||
                            result.reason.contains("fetch failed", ignoreCase = true)
                        ) {
                            "$llmTag LLM 未启动或不可达 — 原始错误: ${result.reason}"
                        } else {
                            result.reason
                        }
                        st.copy(ask = st.ask.copy(isAsking = false, errorMessage = hint))
                    }
                }
            }
        }
    }

    /**
     * CLOUD_ANDROID — 因 ccRunner 只能讲 Ollama-compat 协议无法直连云 API，
     * 这条走 androidLlmExecutor.chat() 不带 RAG（v0.1 占位，v0.2 再加 local
     * retrieve-context 接 PromptMessage）。citations 必空 + isLocal=false。
     */
    private fun submitAskViaCloudAndroid(
        q: String,
        provider: AndroidLocalLlmExecutor.ConfiguredProvider,
    ) {
        _state.update {
            it.copy(
                ask = it.ask.copy(
                    isAsking = true,
                    answer = null,
                    citations = emptyList(),
                    errorMessage = null,
                ),
            )
        }
        viewModelScope.launch {
            val t0 = System.currentTimeMillis()
            try {
                val messages = listOf(
                    com.chainlesschain.android.remote.commands.PromptMessage(role = "user", content = q),
                )
                val answer = androidLlmExecutor.chat(messages, provider)
                val elapsed = System.currentTimeMillis() - t0
                _state.update { st ->
                    st.copy(
                        ask = st.ask.copy(
                            isAsking = false,
                            answer = answer,
                            citations = emptyList(),
                            llmName = "${provider.provider.displayName} · ${provider.model} (云)",
                            isLocal = false,
                            durationMs = elapsed,
                        ),
                    )
                }
            } catch (e: Throwable) {
                Timber.w(e, "HubLocalViewModel.submitAskViaCloudAndroid failed")
                _state.update { st ->
                    st.copy(
                        ask = st.ask.copy(
                            isAsking = false,
                            errorMessage = "云 LLM 调用失败: ${e.message ?: e.javaClass.simpleName}",
                        ),
                    )
                }
            }
        }
    }

    /**
     * PC_LOCAL — 走 DC RPC 到已配对桌面，让桌面用自己的本机 Ollama 推理并附 citation。
     * 数据源 = 桌面 vault（与"本机数据" tab 的 phone vault 不同），用户需理解。
     */
    private fun submitAskViaRemoteDesktop(q: String) {
        val acceptNonLocal = _state.value.threeLocks.allowCloudFallback
        _state.update {
            it.copy(
                ask = it.ask.copy(
                    isAsking = true,
                    answer = null,
                    citations = emptyList(),
                    errorMessage = null,
                ),
            )
        }
        viewModelScope.launch {
            val t0 = System.currentTimeMillis()
            remoteHub.ask(question = q, acceptNonLocal = if (acceptNonLocal) true else null)
                .onSuccess { res ->
                    val elapsed = System.currentTimeMillis() - t0
                    _state.update { st ->
                        st.copy(
                            ask = st.ask.copy(
                                isAsking = false,
                                answer = res.answer,
                                citations = res.citations.map {
                                    LocalCcRunner.AskReport.Citation(
                                        eventId = it.eventId,
                                        excerpt = it.excerpt,
                                        source = null,
                                    )
                                },
                                llmName = "${res.llmName ?: "PC Ollama"} (PC)",
                                isLocal = res.isLocal,
                                durationMs = elapsed,
                            ),
                        )
                    }
                }
                .onFailure { err ->
                    Timber.w(err, "HubLocalViewModel.submitAskViaRemoteDesktop failed")
                    _state.update { st ->
                        st.copy(
                            ask = st.ask.copy(
                                isAsking = false,
                                errorMessage = "PC 本机模型调用失败: ${err.message ?: err.javaClass.simpleName}",
                            ),
                        )
                    }
                }
        }
    }

    fun clearAskAnswer() {
        _state.update { it.copy(ask = it.ask.copy(answer = null, citations = emptyList(), errorMessage = null)) }
    }

    /**
     * Meta-question 短路分支 — 跳过 cc 子进程 + AnalysisEngine RAG，直接进程内
     * 调 [llmEngine].chat。citations 必空（没查 vault），llmName 加 "·直答" 后
     * 缀让用户看得见走了快路径，方便对照"本机模型测试对话"的耗时。
     */
    private fun askDirectLocal(q: String) {
        _state.update {
            it.copy(
                ask = it.ask.copy(
                    isAsking = true,
                    answer = null,
                    citations = emptyList(),
                    errorMessage = null,
                ),
            )
        }
        viewModelScope.launch {
            val t0 = System.currentTimeMillis()
            try {
                val response = llmEngine.chat(
                    messages = listOf(LlmInferenceEngine.ChatMessage(role = "user", content = q)),
                )
                val elapsed = System.currentTimeMillis() - t0
                _state.update { st ->
                    st.copy(
                        ask = st.ask.copy(
                            isAsking = false,
                            answer = response.text,
                            citations = emptyList(),
                            llmName = "${llmEngine.name} (本机·直答)",
                            isLocal = true,
                            durationMs = elapsed,
                        ),
                    )
                }
            } catch (e: Throwable) {
                Timber.w(e, "HubLocalViewModel.askDirectLocal: llmEngine.chat failed")
                _state.update { st ->
                    st.copy(
                        ask = st.ask.copy(
                            isAsking = false,
                            errorMessage = "本机推理失败: ${e.message ?: e.javaClass.simpleName}",
                        ),
                    )
                }
            }
        }
    }

    fun requestCitationDetail(eventId: String) {
        if (eventId.isBlank()) return
        _state.update {
            it.copy(
                citationDetail = CitationDetailState(
                    visible = true,
                    eventId = eventId,
                    loading = true,
                ),
            )
        }
        viewModelScope.launch {
            val r = ccRunner.queryEvent(eventId)
            _state.update { st ->
                if (st.citationDetail.eventId != eventId) {
                    // User dismissed or clicked another citation while in flight
                    return@update st
                }
                when (r) {
                    is LocalCcRunner.EventDetailResult.Ok -> st.copy(
                        citationDetail = st.citationDetail.copy(
                            loading = false,
                            event = r.event,
                            notFound = false,
                            errorMessage = null,
                        ),
                    )
                    is LocalCcRunner.EventDetailResult.NotFound -> st.copy(
                        citationDetail = st.citationDetail.copy(
                            loading = false,
                            notFound = true,
                            event = null,
                        ),
                    )
                    is LocalCcRunner.EventDetailResult.Failed -> {
                        Timber.w("HubLocalViewModel.queryEvent failed: %s", r.reason)
                        st.copy(
                            citationDetail = st.citationDetail.copy(
                                loading = false,
                                errorMessage = r.reason,
                            ),
                        )
                    }
                }
            }
        }
    }

    fun dismissCitationDetail() {
        _state.update { it.copy(citationDetail = CitationDetailState()) }
    }

    /**
     * 打开"看本机数据"预览 sheet — 走 `cc hub query-events --adapter <name>`
     * 取最近 [limit] 条。adapter null = 全部 (混合 source)。
     *
     * 用户场景：sync 卡显"已采集 N 条" 但 AI 说没数据 — 用户想直接看 vault 里
     * 到底有没有真东西。这个方法让 UI 能 dump raw events 让用户自己判定。
     */
    fun requestVaultPreview(adapter: String?, displayName: String? = null, limit: Int = 10) {
        _state.update {
            it.copy(
                vaultPreview = VaultPreviewState(
                    open = true,
                    isLoading = true,
                    adapterFilter = adapter,
                    displayName = displayName,
                ),
            )
        }
        viewModelScope.launch {
            val r = ccRunner.queryEvents(adapter = adapter, limit = limit)
            _state.update { st ->
                // Stale guard: user re-opened sheet with different filter while
                // in flight — drop this result.
                if (!st.vaultPreview.open ||
                    st.vaultPreview.adapterFilter != adapter
                ) {
                    return@update st
                }
                when (r) {
                    is LocalCcRunner.QueryEventsResult.Ok -> {
                        val rows = r.rows.map { row ->
                            VaultPreviewRow(
                                id = row.id,
                                subtype = row.subtype,
                                occurredAt = row.occurredAt,
                                sourceAdapter = row.sourceAdapter,
                                summary = row.summary?.take(160),
                            )
                        }
                        st.copy(
                            vaultPreview = st.vaultPreview.copy(
                                isLoading = false,
                                rows = rows,
                                errorMessage = null,
                            ),
                        )
                    }
                    is LocalCcRunner.QueryEventsResult.Failed -> {
                        Timber.w("HubLocalViewModel.queryEvents failed: %s", r.reason)
                        st.copy(
                            vaultPreview = st.vaultPreview.copy(
                                isLoading = false,
                                rows = emptyList(),
                                errorMessage = r.reason,
                            ),
                        )
                    }
                }
            }
        }
    }

    fun dismissVaultPreview() {
        _state.update { it.copy(vaultPreview = VaultPreviewState()) }
    }

    // ─── 三道锁 (推文 §三道锁，缺一不可) ──────────────────────────────────
    //
    // 第一把：加密金库 — SQLCipher 永远开，无 toggle
    // 第二把：默认拒云 — toggle，OFF = 完全离线 / ON = 允许云端兜底
    // 第三把：一键销毁 — cc hub destroy --confirm

    fun setAllowCloudFallback(allow: Boolean) {
        // A3.10 现已透传到 cc：toggle ON → askQuestion 携 acceptNonLocal=true →
        // LocalCcRunner 给 cc 加 `--accept-non-local`，让 AnalysisEngine 在
        // LLM 非 local 时也接受。状态本身仍只存内存，重启重置为 OFF（推文
        // §"默认不许问云端"安全侧默认）。v0.2 持久化到 DataStore + 切到 ON
        // 时弹"每次都问还是记住"二选一对话框。
        _state.update { it.copy(threeLocks = it.threeLocks.copy(allowCloudFallback = allow)) }
    }

    fun requestDestroyVault() {
        if (_state.value.threeLocks.destroying) return
        if (_state.value.globalSyncingAdapter != null) return
        _state.update {
            it.copy(
                threeLocks = it.threeLocks.copy(destroying = true, destroyError = null),
                globalSyncingAdapter = "vault-destroy",
            )
        }
        viewModelScope.launch {
            val r = ccRunner.destroyVault()
            _state.update { st ->
                when (r) {
                    is LocalCcRunner.DestroyResult.Ok -> st.copy(
                        threeLocks = st.threeLocks.copy(
                            destroying = false,
                            destroyError = null,
                            lastDestroyedAt = System.currentTimeMillis(),
                        ),
                        // 重置 system-data 卡到 fresh 状态，提示用户重新同步
                        systemData = SystemDataCardState(
                            contactsPermissionGranted = snapshotter.hasContactsPermission(),
                        ),
                        globalSyncingAdapter = null,
                    )
                    is LocalCcRunner.DestroyResult.Failed -> {
                        Timber.w("HubLocalViewModel.destroy failed: %s", r.reason)
                        st.copy(
                            threeLocks = st.threeLocks.copy(
                                destroying = false,
                                destroyError = r.reason,
                            ),
                            globalSyncingAdapter = null,
                        )
                    }
                }
            }
        }
    }

    fun clearDestroyError() {
        _state.update { it.copy(threeLocks = it.threeLocks.copy(destroyError = null)) }
    }

    fun requestExportVault() {
        if (_state.value.threeLocks.exporting) return
        if (_state.value.globalSyncingAdapter != null) return
        _state.update {
            it.copy(
                threeLocks = it.threeLocks.copy(
                    exporting = true,
                    exportError = null,
                ),
                globalSyncingAdapter = "vault-export",
            )
        }
        viewModelScope.launch {
            // Write under app external-files-dir — user-accessible via File
            // Manager at /Android/data/<pkg>/files/exports/ without requiring
            // any runtime storage permission. SAF picker is v0.2 polish.
            val externalRoot = appContext.getExternalFilesDir(null)
            if (externalRoot == null) {
                _state.update { st ->
                    st.copy(
                        threeLocks = st.threeLocks.copy(
                            exporting = false,
                            exportError = "External storage unavailable. Mount SD/emulated storage and retry.",
                        ),
                        globalSyncingAdapter = null,
                    )
                }
                return@launch
            }
            val exportsDir = File(externalRoot, "exports").apply { mkdirs() }
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
            val outFile = File(exportsDir, "chainlesschain-vault-$stamp.db")

            when (val r = ccRunner.exportVault(outFile.absolutePath)) {
                is LocalCcRunner.ExportResult.Ok -> {
                    Timber.i(
                        "HubLocalViewModel.export OK: path=%s bytes=%d",
                        r.outputPath, r.bytes,
                    )
                    _state.update { st ->
                        st.copy(
                            threeLocks = st.threeLocks.copy(
                                exporting = false,
                                exportError = null,
                                lastExportPath = r.outputPath,
                                lastExportBytes = r.bytes,
                            ),
                            globalSyncingAdapter = null,
                        )
                    }
                }
                is LocalCcRunner.ExportResult.Failed -> {
                    Timber.w("HubLocalViewModel.export failed: %s", r.reason)
                    _state.update { st ->
                        st.copy(
                            threeLocks = st.threeLocks.copy(
                                exporting = false,
                                exportError = r.reason,
                            ),
                            globalSyncingAdapter = null,
                        )
                    }
                }
            }
        }
    }

    fun clearExportError() {
        _state.update { it.copy(threeLocks = it.threeLocks.copy(exportError = null)) }
    }

    /**
     * §2.7 D11 polish — SAF-based export: user picks a destination Uri via
     * `ActivityResultContracts.CreateDocument("application/x-sqlite3")`, we
     * write the vault to a temp file via cc, then copy bytes to the Uri,
     * then delete temp. Beats the v0.1 external-files-dir path because
     * scoped storage on Android 10+ doesn't surface external-files-dir to
     * the file manager picker cleanly, and the user can route to Drive /
     * email / etc. through SAF providers.
     *
     * Caller responsibility:
     *  - Launch `CreateDocument` from HubLocalScreen with a suggested name
     *    `chainlesschain-vault-<stamp>.db`
     *  - On non-null Uri result, call this method
     *  - If user cancels (null Uri), do nothing — state stays idle
     *
     * 推文承诺：§"一键带走 — 想换手机想备份，一个文件导出全部带走"。
     */
    fun requestExportVaultToUri(targetUri: android.net.Uri) {
        if (_state.value.threeLocks.exporting) return
        if (_state.value.globalSyncingAdapter != null) return
        _state.update {
            it.copy(
                threeLocks = it.threeLocks.copy(exporting = true, exportError = null),
                globalSyncingAdapter = "vault-export",
            )
        }
        viewModelScope.launch {
            // 1. Export to app-private temp first — cc needs a real File path
            //    (writing directly into a content:// Uri requires Java API gymnastics
            //    cc subprocess can't navigate from a shim).
            val tempDir = File(appContext.cacheDir, "vault-export").apply { mkdirs() }
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
            val tempFile = File(tempDir, "chainlesschain-vault-$stamp.db")

            val cc = ccRunner.exportVault(tempFile.absolutePath)
            if (cc is LocalCcRunner.ExportResult.Failed) {
                Timber.w("HubLocalViewModel.exportToUri: cc failed: %s", cc.reason)
                _state.update { st ->
                    st.copy(
                        threeLocks = st.threeLocks.copy(
                            exporting = false,
                            exportError = cc.reason,
                        ),
                        globalSyncingAdapter = null,
                    )
                }
                tempFile.delete()
                return@launch
            }
            cc as LocalCcRunner.ExportResult.Ok

            // 2. Copy temp → SAF Uri via ContentResolver.
            val copiedBytes = try {
                appContext.contentResolver.openOutputStream(targetUri, "wt").use { out ->
                    if (out == null) {
                        throw java.io.IOException("ContentResolver returned null OutputStream for $targetUri")
                    }
                    tempFile.inputStream().use { it.copyTo(out) }
                }
                tempFile.length()
            } catch (t: Throwable) {
                Timber.w(t, "HubLocalViewModel.exportToUri: copy to SAF Uri failed")
                tempFile.delete()
                _state.update { st ->
                    st.copy(
                        threeLocks = st.threeLocks.copy(
                            exporting = false,
                            exportError = "复制到选定位置失败: ${t.message ?: t.javaClass.simpleName}",
                        ),
                        globalSyncingAdapter = null,
                    )
                }
                return@launch
            }

            // 3. Delete temp (vault export contains everything; no point keeping
            //    a private copy that the user can't access anyway).
            if (!tempFile.delete()) {
                Timber.w(
                    "HubLocalViewModel.exportToUri: temp delete failed — leaving stale %s",
                    tempFile.absolutePath,
                )
            }

            _state.update { st ->
                st.copy(
                    threeLocks = st.threeLocks.copy(
                        exporting = false,
                        exportError = null,
                        lastExportPath = targetUri.toString(),
                        lastExportBytes = copiedBytes,
                    ),
                    globalSyncingAdapter = null,
                )
            }
        }
    }

    // ─── §2.4 D7.2 — 支付与购物 SAF 导入 ─────────────────────────────────

    /**
     * §2.4 推文 §"支付与购物": 支付宝账单 CSV / 淘宝订单 HTML 走 SAF 导入。
     *
     * 流程：HubLocalScreen 端 ActionResultContracts.OpenDocument 选文件 →
     * 本方法读 Uri 字节 → 写 filesDir/staging/<providerKey>-<ts>.<ext> →
     * LocalCcRunner.syncAdapter(providerKey, stagedPath) → 本机 vault.db。
     *
     * providerKey 必须 ∈ {"alipay-bill", "shopping-taobao"}；其它 key 走
     * 兜底 errorMessage（保护后续 cc adapter 路由）。
     *
     * v0.2 候选补充：NotificationListenerService 监听支付宝/淘宝 push 实
     * 现增量采集（不替代 SAF — 二者历史 / 增量分工）。
     */
    fun importPaymentShoppingFile(providerKey: String, sourceUri: android.net.Uri) {
        if (providerKey != "alipay-bill" &&
            providerKey != "shopping-taobao" &&
            providerKey != "shopping-jd" &&
            providerKey != "shopping-meituan" &&
            providerKey != "shopping-pinduoduo"
        ) {
            Timber.w("importPaymentShoppingFile: unknown providerKey=%s", providerKey)
            return
        }
        if (_state.value.globalSyncingAdapter != null) return
        val cardState = currentPaymentCardState(providerKey)
        if (cardState.isImporting) return

        _state.update {
            it.copy(
                globalSyncingAdapter = providerKey,
                paymentShopping = updatePaymentCard(it.paymentShopping, providerKey) {
                    it.copy(isImporting = true, errorMessage = null)
                },
            )
        }
        viewModelScope.launch {
            val ext = when (providerKey) {
                "alipay-bill" -> "csv"
                "shopping-taobao" -> "html"
                // §2.4b 购物双联 v0.2 — JD + Meituan 默认 JSON snapshot (Android
                // collector 写)；HTML 路径预留 v0.3 (adapter HTML parser 未实现)
                "shopping-jd" -> "json"
                "shopping-meituan" -> "json"
                // §2.4c — Pinduoduo v0.2: JSON only (anti_token gated; user
                // hand-rolls or v0.3 browser extension exports JSON).
                "shopping-pinduoduo" -> "json"
                else -> "dat"  // unreachable per gate above
            }
            val staging = File(appContext.filesDir, "staging").apply { mkdirs() }
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
            val stagedFile = File(staging, "$providerKey-$stamp.$ext")
            val copiedBytes = try {
                appContext.contentResolver.openInputStream(sourceUri).use { input ->
                    if (input == null) throw java.io.IOException("ContentResolver 无法打开 $sourceUri")
                    stagedFile.outputStream().use { input.copyTo(it) }
                }
                stagedFile.length()
            } catch (t: Throwable) {
                Timber.w(t, "importPaymentShoppingFile: copy failed key=%s", providerKey)
                _state.update { st ->
                    st.copy(
                        globalSyncingAdapter = null,
                        paymentShopping = updatePaymentCard(st.paymentShopping, providerKey) {
                            it.copy(
                                isImporting = false,
                                errorMessage = "读取所选文件失败: ${t.message ?: t.javaClass.simpleName}",
                            )
                        },
                    )
                }
                return@launch
            }
            if (copiedBytes == 0L) {
                Timber.w("importPaymentShoppingFile: empty file key=%s", providerKey)
                stagedFile.delete()
                _state.update { st ->
                    st.copy(
                        globalSyncingAdapter = null,
                        paymentShopping = updatePaymentCard(st.paymentShopping, providerKey) {
                            it.copy(
                                isImporting = false,
                                errorMessage = "所选文件为空 — 请确认导出步骤是否成功",
                            )
                        },
                    )
                }
                return@launch
            }

            when (val r = ccRunner.syncAdapter(providerKey, stagedFile.absolutePath)) {
                is LocalCcRunner.CcResult.Ok -> {
                    Timber.i(
                        "importPaymentShoppingFile OK: key=%s bytes=%d ingested=%d",
                        providerKey, copiedBytes, r.report.ingested,
                    )
                    // Keep the staging file for one cc cycle — sjqz/cc may read
                    // it again on incremental retry. Cleanup on next import.
                    _state.update { st ->
                        st.copy(
                            globalSyncingAdapter = null,
                            paymentShopping = updatePaymentCard(st.paymentShopping, providerKey) {
                                it.copy(
                                    isImporting = false,
                                    errorMessage = null,
                                    lastImportAt = System.currentTimeMillis(),
                                    lastImportBytes = copiedBytes,
                                )
                            },
                        )
                    }
                }
                is LocalCcRunner.CcResult.Failed -> {
                    Timber.w(
                        "importPaymentShoppingFile cc failed: %s (exit=%s)",
                        r.reason, r.exitCode,
                    )
                    _state.update { st ->
                        st.copy(
                            globalSyncingAdapter = null,
                            paymentShopping = updatePaymentCard(st.paymentShopping, providerKey) {
                                it.copy(
                                    isImporting = false,
                                    errorMessage = r.reason,
                                )
                            },
                        )
                    }
                }
            }
        }
    }

    fun clearPaymentImportError(providerKey: String) {
        if (providerKey != "alipay-bill" && providerKey != "shopping-taobao") return
        _state.update { st ->
            st.copy(
                paymentShopping = updatePaymentCard(st.paymentShopping, providerKey) {
                    it.copy(errorMessage = null)
                },
            )
        }
    }

    private fun currentPaymentCardState(providerKey: String): PaymentImportCardState =
        when (providerKey) {
            "alipay-bill" -> _state.value.paymentShopping.alipayBill
            "shopping-taobao" -> _state.value.paymentShopping.taobaoOrder
            "shopping-jd" -> _state.value.paymentShopping.jdOrder
            "shopping-meituan" -> _state.value.paymentShopping.meituanOrder
            "shopping-pinduoduo" -> _state.value.paymentShopping.pinduoduoOrder
            else -> PaymentImportCardState()
        }

    private inline fun updatePaymentCard(
        ps: PaymentShoppingState,
        providerKey: String,
        crossinline transform: (PaymentImportCardState) -> PaymentImportCardState,
    ): PaymentShoppingState = when (providerKey) {
        "alipay-bill" -> ps.copy(alipayBill = transform(ps.alipayBill))
        "shopping-taobao" -> ps.copy(taobaoOrder = transform(ps.taobaoOrder))
        "shopping-jd" -> ps.copy(jdOrder = transform(ps.jdOrder))
        "shopping-meituan" -> ps.copy(meituanOrder = transform(ps.meituanOrder))
        "shopping-pinduoduo" -> ps.copy(pinduoduoOrder = transform(ps.pinduoduoOrder))
        else -> ps
    }

    // ─── §2.6 D10.2 — AI 助手 9 路 WebView ──────────────────────────────

    /**
     * Init: 把 EncryptedSharedPreferences 里 9 vendor 的 hasCredentials /
     * lastSyncAt / lastSyncCount 读出，填到 aiChat map (vendorKey →
     * AiChatCardState)。每次 destroy vault / clear vendor 后再调一次。
     */
    fun refreshAiChatFromStore() {
        val map = AiChatVendor.ORDERED.associate { v ->
            v.key to AiChatCardState(
                vendorKey = v.key,
                displayName = v.displayName,
                isLoggedIn = aiChatCredentials.hasCredentials(v.key),
                lastSyncAt = aiChatCredentials.getLastSyncAt(v.key),
                lastSyncCount = aiChatCredentials.getLastSyncCount(v.key),
            )
        }
        _state.update { it.copy(aiChat = map) }
    }

    fun requestAiChatLogin(vendorKey: String) {
        val v = AiChatVendor.fromKey(vendorKey) ?: run {
            Timber.w("requestAiChatLogin: unknown vendor=%s", vendorKey)
            return
        }
        _state.update {
            it.copy(
                pendingLogin = LoginRequest(
                    adapterName = "ai-chat:${v.key}",
                    displayName = v.displayName,
                    loginUrl = v.loginUrl,
                    cookieDomain = v.cookieDomain,
                    isLoginSuccess = v.isLoginSuccess,
                ),
            )
        }
    }

    /**
     * Caller: HubLocalScreen.onLoginComplete dispatch on adapterName prefix
     * "ai-chat:". Cookie 写 EncryptedSharedPreferences + refreshAiChatFromStore
     * 更 UI。失败 (cookie 空 / 读 keystore 抛) → 卡 errorMessage。
     */
    fun onAiChatLoginCookie(vendorKey: String, cookie: String) {
        if (AiChatVendor.fromKey(vendorKey) == null) {
            Timber.w("onAiChatLoginCookie: unknown vendor=%s", vendorKey)
            _state.update { it.copy(pendingLogin = null) }
            return
        }
        if (cookie.isBlank()) {
            _state.update { st ->
                val card = st.aiChat[vendorKey]?.copy(
                    errorMessage = "未拿到 cookie — 请重新登录后等页面跳转完成",
                ) ?: return@update st
                st.copy(
                    pendingLogin = null,
                    aiChat = st.aiChat + (vendorKey to card),
                )
            }
            return
        }
        aiChatCredentials.saveCookie(vendorKey, cookie)
        _state.update { it.copy(pendingLogin = null) }
        refreshAiChatFromStore()
    }

    /**
     * v0.1 sync 入口 — 让 cc 走 ai-chat-history adapter (Phase 10.2 8/9
     * 桌面 vendor 已 wire)。v0.2 加增量 since/last_id；豆包/文心 桌面 adapter
     * 待补，本路径报 cc error "no adapter wired"，UI 显引导 "桌面 v0.2"。
     */
    fun syncAiChat(vendorKey: String) {
        val v = AiChatVendor.fromKey(vendorKey) ?: return
        if (_state.value.globalSyncingAdapter != null) return
        val card = _state.value.aiChat[vendorKey] ?: return
        if (!card.isLoggedIn) {
            requestAiChatLogin(vendorKey)
            return
        }
        val cookie = aiChatCredentials.getCookie(vendorKey)
        if (cookie.isNullOrBlank()) {
            _state.update { st ->
                st.copy(
                    aiChat = st.aiChat + (vendorKey to card.copy(
                        errorMessage = "cookie 失效 — 请重新登录",
                    )),
                )
            }
            return
        }

        _state.update {
            it.copy(
                globalSyncingAdapter = "ai-chat:${v.key}",
                aiChat = it.aiChat + (vendorKey to card.copy(
                    isSyncing = true, errorMessage = null,
                )),
            )
        }
        viewModelScope.launch {
            // Stage cookie + vendor metadata as snapshot JSON so cc adapter can
            // pick it up. Phase 10.2 桌面 adapter 模式 — snapshot.json shape
            // {vendor, cookie, fetchedAt}.
            val staging = File(appContext.filesDir, "staging").apply { mkdirs() }
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
            val snapshotFile = File(staging, "ai-chat-${v.key}-$stamp.json")
            try {
                val json = org.json.JSONObject().apply {
                    put("vendor", v.key)
                    put("cookie", cookie)
                    put("fetchedAt", System.currentTimeMillis())
                }
                snapshotFile.writeText(json.toString())
            } catch (t: Throwable) {
                Timber.w(t, "syncAiChat: snapshot write failed vendor=%s", v.key)
                _state.update { st ->
                    st.copy(
                        globalSyncingAdapter = null,
                        aiChat = st.aiChat + (vendorKey to card.copy(
                            isSyncing = false,
                            errorMessage = "本地暂存写入失败: ${t.message ?: t.javaClass.simpleName}",
                        )),
                    )
                }
                return@launch
            }

            // adapterName = "ai-chat-history" (固定，cc 内部按 vendor field 分发)
            val ccResult = ccRunner.syncAdapter("ai-chat-history", snapshotFile.absolutePath)
            _state.update { st ->
                val current = st.aiChat[vendorKey] ?: card
                when (ccResult) {
                    is LocalCcRunner.CcResult.Ok -> {
                        aiChatCredentials.recordSync(
                            v.key,
                            System.currentTimeMillis(),
                            ccResult.report.ingested,
                        )
                        st.copy(
                            globalSyncingAdapter = null,
                            aiChat = st.aiChat + (vendorKey to current.copy(
                                isSyncing = false,
                                lastSyncAt = System.currentTimeMillis(),
                                lastSyncCount = ccResult.report.ingested,
                                errorMessage = null,
                            )),
                        )
                    }
                    is LocalCcRunner.CcResult.Failed -> {
                        // Friendlier message for the common "no adapter wired"
                        // case (豆包/文心 桌面 v0.2 待补): cc 会报 adapter not
                        // found / unknown vendor。
                        val hint = if (
                            ccResult.reason.contains("not found", ignoreCase = true) ||
                            ccResult.reason.contains("unknown", ignoreCase = true)
                        ) "桌面端 ai-chat-history adapter 暂未对接 ${v.displayName}，v0.2 补齐"
                        else ccResult.reason
                        Timber.w(
                            "syncAiChat: cc failed vendor=%s reason=%s",
                            v.key, ccResult.reason,
                        )
                        st.copy(
                            globalSyncingAdapter = null,
                            aiChat = st.aiChat + (vendorKey to current.copy(
                                isSyncing = false,
                                errorMessage = hint,
                            )),
                        )
                    }
                }
            }
        }
    }

    fun logoutAiChat(vendorKey: String) {
        aiChatCredentials.clear(vendorKey)
        refreshAiChatFromStore()
    }

    fun clearAiChatError(vendorKey: String) {
        _state.update { st ->
            val card = st.aiChat[vendorKey] ?: return@update st
            st.copy(aiChat = st.aiChat + (vendorKey to card.copy(errorMessage = null)))
        }
    }

    // ─── §2.3 D6.2 — 邮箱 4 家 IMAP ──────────────────────────────────────

    fun refreshEmailFromStore() {
        val map = EmailVendor.ORDERED.associate { v ->
            v.key to EmailCardState(
                vendorKey = v.key,
                displayName = v.displayName,
                hasCredentials = emailCredentials.hasCredentials(v.key),
                lastSyncAt = emailCredentials.getLastSyncAt(v.key),
                lastSyncCount = emailCredentials.getLastSyncCount(v.key),
            )
        }
        _state.update { it.copy(email = map) }
    }

    /** 用户点 "登录"→ 弹 dialog (per-vendor pending flag). */
    fun requestEmailLogin(vendorKey: String) {
        if (EmailVendor.fromKey(vendorKey) == null) {
            Timber.w("requestEmailLogin: unknown vendor=%s", vendorKey)
            return
        }
        _state.update { st ->
            val card = st.email[vendorKey] ?: return@update st
            st.copy(email = st.email + (vendorKey to card.copy(pendingDialog = true)))
        }
    }

    fun cancelEmailLogin(vendorKey: String) {
        _state.update { st ->
            val card = st.email[vendorKey] ?: return@update st
            st.copy(email = st.email + (vendorKey to card.copy(pendingDialog = false)))
        }
    }

    /**
     * Dialog Confirm 调本方法 — 写凭据 + 自动触发首次 sync。
     */
    fun submitEmailCredentials(
        vendorKey: String,
        user: String,
        password: String,
        imapHost: String,
        imapPort: Int,
    ) {
        if (EmailVendor.fromKey(vendorKey) == null) return
        if (user.isBlank() || password.isBlank() || imapHost.isBlank() || imapPort !in 1..65_535) {
            _state.update { st ->
                val card = st.email[vendorKey] ?: return@update st
                st.copy(
                    email = st.email + (vendorKey to card.copy(
                        pendingDialog = false,
                        errorMessage = "凭据字段不完整 — 请重新输入",
                    )),
                )
            }
            return
        }
        emailCredentials.saveCredentials(vendorKey, user, password, imapHost, imapPort)
        _state.update { st ->
            val card = st.email[vendorKey] ?: return@update st
            st.copy(
                email = st.email + (vendorKey to card.copy(
                    pendingDialog = false,
                    hasCredentials = true,
                    errorMessage = null,
                )),
            )
        }
        // 自动同步 — 让用户填完凭据即看效果，避免再点一次"同步"。
        syncEmail(vendorKey)
    }

    fun syncEmail(vendorKey: String) {
        val v = EmailVendor.fromKey(vendorKey) ?: return
        if (_state.value.globalSyncingAdapter != null) return
        val card = _state.value.email[vendorKey] ?: return
        if (!card.hasCredentials) {
            requestEmailLogin(vendorKey)
            return
        }
        _state.update {
            it.copy(
                globalSyncingAdapter = "email-imap:${v.key}",
                email = it.email + (vendorKey to card.copy(isSyncing = true, errorMessage = null)),
            )
        }
        viewModelScope.launch {
            val snapshot = emailCollector.snapshot(vendor = v.key, limit = 200)
            // Each branch maps to a user-actionable error message.
            when (snapshot) {
                is EmailLocalCollector.SnapshotResult.Ok -> {
                    val ccResult = ccRunner.syncAdapter("email-imap", snapshot.snapshotPath)
                    _state.update { st ->
                        val cur = st.email[vendorKey] ?: card
                        when (ccResult) {
                            is LocalCcRunner.CcResult.Ok -> {
                                emailCredentials.recordSync(
                                    v.key,
                                    System.currentTimeMillis(),
                                    ccResult.report.ingested,
                                )
                                st.copy(
                                    globalSyncingAdapter = null,
                                    email = st.email + (vendorKey to cur.copy(
                                        isSyncing = false,
                                        lastSyncAt = System.currentTimeMillis(),
                                        lastSyncCount = ccResult.report.ingested,
                                        errorMessage = null,
                                    )),
                                )
                            }
                            is LocalCcRunner.CcResult.Failed -> {
                                val hint = if (
                                    ccResult.reason.contains("not found", ignoreCase = true) ||
                                    ccResult.reason.contains("unknown adapter", ignoreCase = true)
                                ) "桌面端 email-imap adapter 暂未对接，v0.2 补齐 (邮件已成功抓 ${snapshot.fetchedCount} 封到本机临时区)"
                                else ccResult.reason
                                st.copy(
                                    globalSyncingAdapter = null,
                                    email = st.email + (vendorKey to cur.copy(
                                        isSyncing = false,
                                        errorMessage = hint,
                                    )),
                                )
                            }
                        }
                    }
                }
                is EmailLocalCollector.SnapshotResult.NoCredentials -> updateEmailError(vendorKey, "凭据丢失 — 请重新输入")
                is EmailLocalCollector.SnapshotResult.OAuthRequired -> updateEmailError(vendorKey, "Gmail OAuth v0.2.1 — 临时用 App Password (myaccount.google.com → 安全 → 应用专用密码)")
                is EmailLocalCollector.SnapshotResult.AuthFailed -> updateEmailError(vendorKey, "认证失败：${snapshot.message}")
                is EmailLocalCollector.SnapshotResult.ConnectFailed -> updateEmailError(vendorKey, "连接 IMAP 失败：${snapshot.message}")
                is EmailLocalCollector.SnapshotResult.ProtocolFailed -> updateEmailError(vendorKey, "IMAP 协议错：${snapshot.message}")
                is EmailLocalCollector.SnapshotResult.Empty -> updateEmailError(vendorKey, "收件箱为空 — 无邮件可同步")
                is EmailLocalCollector.SnapshotResult.Failed -> updateEmailError(vendorKey, snapshot.message)
            }
        }
    }

    private fun updateEmailError(vendorKey: String, message: String) {
        _state.update { st ->
            val cur = st.email[vendorKey] ?: return@update st
            st.copy(
                globalSyncingAdapter = null,
                email = st.email + (vendorKey to cur.copy(
                    isSyncing = false,
                    errorMessage = message,
                )),
            )
        }
    }

    fun logoutEmail(vendorKey: String) {
        emailCredentials.clear(vendorKey)
        refreshEmailFromStore()
    }

    fun clearEmailError(vendorKey: String) {
        _state.update { st ->
            val cur = st.email[vendorKey] ?: return@update st
            st.copy(email = st.email + (vendorKey to cur.copy(errorMessage = null)))
        }
    }

    // ─── §2.5 D8.2 — 出行 (高德 / 携程) cookie scrape ────────────────────

    fun refreshTravelFromStore() {
        val map = TravelVendor.ORDERED.associate { v ->
            v.key to TravelCardState(
                vendorKey = v.key,
                displayName = v.displayName,
                isLoggedIn = travelCredentials.hasCredentials(v.key),
                lastSyncAt = travelCredentials.getLastSyncAt(v.key),
                lastSyncCount = travelCredentials.getLastSyncCount(v.key),
            )
        }
        _state.update { it.copy(travel = map) }
    }

    fun requestTravelLogin(vendorKey: String) {
        val v = TravelVendor.fromKey(vendorKey) ?: run {
            Timber.w("requestTravelLogin: unknown vendor=%s", vendorKey)
            return
        }
        _state.update {
            it.copy(
                pendingLogin = LoginRequest(
                    adapterName = "travel:${v.key}",
                    displayName = v.displayName,
                    loginUrl = v.loginUrl,
                    cookieDomain = v.cookieDomain,
                    isLoginSuccess = v.isLoginSuccess,
                ),
            )
        }
    }

    fun onTravelLoginCookie(vendorKey: String, cookie: String) {
        if (TravelVendor.fromKey(vendorKey) == null) {
            Timber.w("onTravelLoginCookie: unknown vendor=%s", vendorKey)
            _state.update { it.copy(pendingLogin = null) }
            return
        }
        if (cookie.isBlank()) {
            _state.update { st ->
                val card = st.travel[vendorKey]?.copy(
                    errorMessage = "未拿到 cookie — 请重新登录后等页面跳转完成",
                ) ?: return@update st
                st.copy(
                    pendingLogin = null,
                    travel = st.travel + (vendorKey to card),
                )
            }
            return
        }
        travelCredentials.saveCookie(vendorKey, cookie)
        _state.update { it.copy(pendingLogin = null) }
        refreshTravelFromStore()
    }

    fun syncTravel(vendorKey: String) {
        val v = TravelVendor.fromKey(vendorKey) ?: return
        if (_state.value.globalSyncingAdapter != null) return
        val card = _state.value.travel[vendorKey] ?: return
        if (!card.isLoggedIn) {
            requestTravelLogin(vendorKey)
            return
        }
        // §2.5 v0.2 — 12306 走专用 collector，fetch 订单历史写真 events 进
        // snapshot；其它 vendor 仍走 cookie-scrape generic path（地图三家 +
        // 携程 v0.2 暂未接 web API，桌面 adapter 暂未对接）。
        if (v == TravelVendor.KYFW_12306) {
            syncKyfw12306(card)
            return
        }
        val cookie = travelCredentials.getCookie(vendorKey)
        if (cookie.isNullOrBlank()) {
            _state.update { st ->
                st.copy(
                    travel = st.travel + (vendorKey to card.copy(
                        errorMessage = "cookie 失效 — 请重新登录",
                    )),
                )
            }
            return
        }

        _state.update {
            it.copy(
                globalSyncingAdapter = "travel:${v.key}",
                travel = it.travel + (vendorKey to card.copy(
                    isSyncing = true, errorMessage = null,
                )),
            )
        }
        viewModelScope.launch {
            val staging = File(appContext.filesDir, "staging").apply { mkdirs() }
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
            val snapshotFile = File(staging, "travel-${v.key}-$stamp.json")
            try {
                val json = org.json.JSONObject().apply {
                    put("vendor", v.key)
                    put("cookie", cookie)
                    put("fetchedAt", System.currentTimeMillis())
                }
                snapshotFile.writeText(json.toString())
            } catch (t: Throwable) {
                Timber.w(t, "syncTravel: snapshot write failed vendor=%s", v.key)
                _state.update { st ->
                    st.copy(
                        globalSyncingAdapter = null,
                        travel = st.travel + (vendorKey to card.copy(
                            isSyncing = false,
                            errorMessage = "本地暂存写入失败: ${t.message ?: t.javaClass.simpleName}",
                        )),
                    )
                }
                return@launch
            }

            val ccResult = ccRunner.syncAdapter(v.key, snapshotFile.absolutePath)
            _state.update { st ->
                val cur = st.travel[vendorKey] ?: card
                when (ccResult) {
                    is LocalCcRunner.CcResult.Ok -> {
                        travelCredentials.recordSync(
                            v.key,
                            System.currentTimeMillis(),
                            ccResult.report.ingested,
                        )
                        st.copy(
                            globalSyncingAdapter = null,
                            travel = st.travel + (vendorKey to cur.copy(
                                isSyncing = false,
                                lastSyncAt = System.currentTimeMillis(),
                                lastSyncCount = ccResult.report.ingested,
                                errorMessage = null,
                            )),
                        )
                    }
                    is LocalCcRunner.CcResult.Failed -> {
                        val hint = if (
                            ccResult.reason.contains("not found", ignoreCase = true) ||
                            ccResult.reason.contains("unknown adapter", ignoreCase = true)
                        ) "桌面端 ${v.key} adapter 暂未对接，v0.2 补齐 (cookie 已保存到本机)"
                        else ccResult.reason
                        Timber.w("syncTravel: cc failed vendor=%s reason=%s", v.key, ccResult.reason)
                        st.copy(
                            globalSyncingAdapter = null,
                            travel = st.travel + (vendorKey to cur.copy(
                                isSyncing = false,
                                errorMessage = hint,
                            )),
                        )
                    }
                }
            }
        }
    }

    /**
     * §2.5 v0.2 — 12306 专用同步路径。走 [Kyfw12306LocalCollector] fetch 订单
     * 历史 (last 90d) + pending 订单，写 schemaVersion=1 snapshot，cc 入库。
     * NoCredentials → cookie 过期 (kyfw 30min idle session 超时) 提示重 login；
     * Ok with everythingEmpty → 用户账号上真没订单（不算错）。
     */
    private fun syncKyfw12306(card: TravelCardState) {
        val vendorKey = TravelVendor.KYFW_12306.key
        _state.update {
            it.copy(
                globalSyncingAdapter = "travel:$vendorKey",
                travel = it.travel + (vendorKey to card.copy(
                    isSyncing = true, errorMessage = null,
                )),
            )
        }
        viewModelScope.launch {
            val result = kyfw12306Collector.snapshot()
            when (result) {
                is Kyfw12306LocalCollector.SnapshotResult.NoCredentials -> {
                    _state.update { st ->
                        val cur = st.travel[vendorKey] ?: card
                        st.copy(
                            globalSyncingAdapter = null,
                            travel = st.travel + (vendorKey to cur.copy(
                                isSyncing = false,
                                isLoggedIn = false,
                                errorMessage = "12306 session 已过期（约 30 分钟空闲后失效），请重新登录",
                            )),
                        )
                    }
                }
                is Kyfw12306LocalCollector.SnapshotResult.Failed -> {
                    _state.update { st ->
                        val cur = st.travel[vendorKey] ?: card
                        st.copy(
                            globalSyncingAdapter = null,
                            travel = st.travel + (vendorKey to cur.copy(
                                isSyncing = false,
                                errorMessage = "采集失败: ${result.reason}",
                            )),
                        )
                    }
                }
                is Kyfw12306LocalCollector.SnapshotResult.Ok -> {
                    when (val r = ccRunner.syncAdapter(
                        adapterName = vendorKey,
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            _state.update { st ->
                                val cur = st.travel[vendorKey] ?: card
                                val banner = if (r.report.status != "ok" && r.report.error != null) {
                                    "入库状态: ${r.report.status} (${r.report.error})"
                                } else if (result.everythingEmpty) {
                                    "已同步完成 — 近 90 天无车票记录"
                                } else {
                                    "已同步 ${result.completedCount} 张已完成车票 + ${result.pendingCount} 张待出行"
                                }
                                st.copy(
                                    globalSyncingAdapter = null,
                                    travel = st.travel + (vendorKey to cur.copy(
                                        isSyncing = false,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = banner,
                                    )),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "syncKyfw12306: cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update { st ->
                                val cur = st.travel[vendorKey] ?: card
                                st.copy(
                                    globalSyncingAdapter = null,
                                    travel = st.travel + (vendorKey to cur.copy(
                                        isSyncing = false,
                                        errorMessage = "写入本地数据库失败: ${r.reason}",
                                    )),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    fun logoutTravel(vendorKey: String) {
        travelCredentials.clear(vendorKey)
        refreshTravelFromStore()
    }

    fun clearTravelError(vendorKey: String) {
        _state.update { st ->
            val card = st.travel[vendorKey] ?: return@update st
            st.copy(travel = st.travel + (vendorKey to card.copy(errorMessage = null)))
        }
    }

    // ─── §2.9 本机 audit (推文 §"每次操作都有账本") ────────────────────────

    /**
     * 加载本机 vault 的 audit 日志 — `cc hub recent-audit --limit 50 --json`
     * 通过 [LocalCcRunner.queryRecentAudit] 调起 in-APK cc subprocess。
     *
     * 跟 [HubAuditViewModel.reload] 区别：HubAuditViewModel 走远程 RPC
     * (PersonalDataHubCommands) 读桌面 vault，本方法走本机 cc 读本机
     * vault.db。本机 audit row 在以下场景产生：
     *  - SystemDataCard 同步通讯录/已装应用 → ingest action
     *  - BilibiliCard / WechatCard / 其它 social sync → ingest
     *  - HubAskCard 提问 → ask action（含 query / answer / citations）
     *  - 三道锁销毁 → destroy（销毁后 vault 重建，旧 audit 全没）
     *  - 三道锁导出 → export
     *
     * 推文兑现段："谁、什么时候、对哪条数据做了什么动作（采集/查询/提问/
     * 删除），全部有记录可查。你随时知道自己的数据被怎么用过。"
     */
    fun refreshAudit() {
        if (_state.value.localAudit.isLoading) return
        _state.update {
            it.copy(localAudit = it.localAudit.copy(isLoading = true, errorMessage = null))
        }
        viewModelScope.launch {
            // Pass both params explicitly so kotlinc doesn't generate a $default
            // bridge — mockk coVerify on the original method then matches the
            // call. See memory `feedback_mockk_cross_file_jvm_pollution.md` /
            // `android_test_source_set_compile_gate.md` for the same trap.
            when (val r = ccRunner.queryRecentAudit(limit = 50, timeoutMs = 20_000L)) {
                is LocalCcRunner.RecentAuditResult.Ok -> _state.update { st ->
                    st.copy(
                        localAudit = st.localAudit.copy(
                            isLoading = false,
                            rows = r.rows,
                            errorMessage = null,
                            lastRefreshAt = System.currentTimeMillis(),
                        ),
                    )
                }
                is LocalCcRunner.RecentAuditResult.Failed -> {
                    Timber.w("HubLocalViewModel.refreshAudit: %s", r.reason)
                    _state.update { st ->
                        st.copy(
                            localAudit = st.localAudit.copy(
                                isLoading = false,
                                errorMessage = r.reason,
                            ),
                        )
                    }
                }
            }
        }
    }

    fun clearAuditError() {
        _state.update { it.copy(localAudit = it.localAudit.copy(errorMessage = null)) }
    }

    // ─── Bilibili ───────────────────────────────────────────────────────────

    fun refreshBilibiliFromStore() {
        // Self-heal pre-2c8f41f9 cookies sitting in the encrypted store: they
        // pass hasCredentials() (cookie non-blank + uid > 0) but lack
        // buvid3 / bili_jct so every sync silently returns 4 empty APIs.
        // clearIfStoredCookieStale wipes the store as a side effect so the
        // subsequent hasCredentials() correctly reads false.
        val staleMissing = bilibiliCollector.clearIfStoredCookieStale()
        val loggedIn = bilibiliCredentials.hasCredentials()
        val uid = bilibiliCredentials.getUid()
        val lastSync = bilibiliCredentials.getLastSyncAt()
        val lastCount = bilibiliCredentials.getLastSyncCount()
        _state.update {
            it.copy(
                bilibili = it.bilibili.copy(
                    isLoggedIn = loggedIn,
                    uid = uid,
                    lastSyncAt = lastSync,
                    lastSyncCount = lastCount,
                    errorMessage = staleMissing?.let { m ->
                        "登录信息已过期（缺 $m）— 请重新登录"
                    } ?: it.bilibili.errorMessage,
                ),
            )
        }
    }

    fun requestBilibiliLogin() {
        _state.update {
            it.copy(
                pendingLogin = LoginRequest(
                    adapterName = "social-bilibili",
                    displayName = "Bilibili",
                    loginUrl = "https://passport.bilibili.com/login",
                    cookieDomain = "https://www.bilibili.com",
                    // Bilibili lands on https://www.bilibili.com/ (or m.bilibili.com)
                    // after passport redirect. Avoid matching while still on
                    // passport.bilibili.com — that's the login page itself.
                    isLoginSuccess = { url ->
                        (url.startsWith("https://www.bilibili.com/") ||
                            url.startsWith("https://m.bilibili.com/") ||
                            url == "https://www.bilibili.com" ||
                            url == "https://m.bilibili.com") &&
                            !url.contains("passport.bilibili.com")
                    },
                    // Bilibili 账密登录后 cookie 里至少含 SESSDATA= (主 session)。
                    // 同时 bili_jct + DedeUserID + buvid3 通常一起写。任一出现
                    // 视为登录成功。
                    isLoginSuccessByCookie = { cookie ->
                        cookie.contains("SESSDATA=")
                    },
                    userAgent = DESKTOP_CHROME_USER_AGENT,
                ),
            )
        }
    }

    /**
     * 2026-05-25：post-login WebView prefetch 路径 — [SocialCookieWebViewScreen]
     * 在登录 cookie 抓到后 evaluateJavascript 跑聚合 fetch（详 BilibiliJsBridge.
     * PREFETCH_JS）把 4 API + per-folder fav 在 WebView 内拉好直接传上来。绕开
     * b 站 OkHttp 端 TLS 指纹 + JS-set anti-bot cookie 风控。
     *
     * `prefetched` 是 JS 拼好的、跟 [BilibiliLocalCollector.snapshot] 同 shape 的
     * JSON（schemaVersion=1, events:[…]）— 直接写到 staging 路径 + 走 cc adapter
     * 入 vault。null = JS 抛错 / 15s 超时，回退到普通 onBilibiliLoginCookie 路径
     * （会跑 OkHttp snapshot 然后大概率 "4 API empty" — UI 有错误 message 引导）。
     */
    fun onBilibiliLoginWithPrefetch(cookie: String, prefetched: String?) {
        if (prefetched == null) {
            Timber.w("HubLocalViewModel: Bilibili prefetch null (JS 抛错或超时), 回退")
            onBilibiliLoginCookie(cookie)
            return
        }
        when (val r = bilibiliCollector.acceptLoginCookie(cookie)) {
            is BilibiliLocalCollector.AcceptResult.Ok -> {
                _state.update {
                    it.copy(
                        pendingLogin = null,
                        bilibili = it.bilibili.copy(
                            isSyncing = true,
                            errorMessage = null,
                        ),
                        globalSyncingAdapter = "social-bilibili",
                    )
                }
                refreshBilibiliFromStore()
                viewModelScope.launch {
                    val syncResult = bilibiliCollector.ingestPrefetched(prefetched)
                    when (syncResult) {
                        is BilibiliLocalCollector.SnapshotResult.Ok -> {
                            // 走 cc CLI sync 入 vault — 跟普通 snapshot 同路径
                            when (val cc = ccRunner.syncAdapter(
                                adapterName = "social-bilibili",
                                inputPath = syncResult.snapshotPath,
                            )) {
                                is LocalCcRunner.CcResult.Ok -> {
                                    bilibiliCollector.recordSync(syncResult.totalEvents)
                                    _state.update {
                                        it.copy(
                                            globalSyncingAdapter = null,
                                            bilibili = it.bilibili.copy(
                                                isSyncing = false,
                                                lastSyncAt = System.currentTimeMillis(),
                                                lastSyncCount = syncResult.totalEvents,
                                                errorMessage = null,
                                            ),
                                        )
                                    }
                                }
                                is LocalCcRunner.CcResult.Failed -> {
                                    _state.update {
                                        it.copy(
                                            globalSyncingAdapter = null,
                                            bilibili = it.bilibili.copy(
                                                isSyncing = false,
                                                errorMessage = "cc sync 失败：${cc.reason}",
                                            ),
                                        )
                                    }
                                }
                            }
                        }
                        is BilibiliLocalCollector.SnapshotResult.Failed -> {
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    bilibili = it.bilibili.copy(
                                        isSyncing = false,
                                        errorMessage = "prefetch ingest 失败：${syncResult.reason}",
                                    ),
                                )
                            }
                        }
                        else -> {
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    bilibili = it.bilibili.copy(
                                        isSyncing = false,
                                        errorMessage = "prefetch ingest 异常结果: $syncResult",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
            is BilibiliLocalCollector.AcceptResult.MissingField -> {
                _state.update {
                    it.copy(
                        pendingLogin = null,
                        bilibili = it.bilibili.copy(
                            errorMessage = "登录未完成：cookie 缺 ${r.name}。请重新登录并等待首页完全加载（约 3-5s）后再返回。",
                        ),
                    )
                }
            }
        }
    }

    fun onBilibiliLoginCookie(cookie: String) {
        when (val r = bilibiliCollector.acceptLoginCookie(cookie)) {
            is BilibiliLocalCollector.AcceptResult.Ok -> {
                _state.update {
                    it.copy(
                        pendingLogin = null,
                        bilibili = it.bilibili.copy(errorMessage = null),
                    )
                }
                refreshBilibiliFromStore()
            }
            is BilibiliLocalCollector.AcceptResult.MissingField -> {
                // Don't silently accept a partial cookie — without buvid3 /
                // bili_jct the 4 Bilibili APIs return `{code:0,data:{list:[]}}`
                // (no error code), and the user sees "4 API empty" on next
                // sync with no recovery hint. Actionable message instead.
                _state.update {
                    it.copy(
                        pendingLogin = null,
                        bilibili = it.bilibili.copy(
                            errorMessage = "登录未完成：cookie 缺 ${r.name}。请重新登录并等待首页完全加载（约 3-5s）后再返回。",
                        ),
                    )
                }
            }
        }
    }

    fun cancelLogin() {
        _state.update { it.copy(pendingLogin = null) }
    }

    fun syncBilibili() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!_state.value.bilibili.isLoggedIn) {
            requestBilibiliLogin()
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-bilibili",
                    bilibili = it.bilibili.copy(isSyncing = true, errorMessage = null),
                )
            }
            val result = bilibiliCollector.snapshot()
            when (result) {
                is BilibiliLocalCollector.SnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            bilibili = it.bilibili.copy(
                                isSyncing = false,
                                isLoggedIn = false,
                                errorMessage = "未登录 — 请先登录",
                            ),
                        )
                    }
                }
                is BilibiliLocalCollector.SnapshotResult.StaleCookie -> {
                    // Cookie was saved before AcceptResult validation existed
                    // (or partially captured) — store has been wiped by
                    // collector.clearIfStoredCookieStale; surface the real
                    // remediation (re-login) instead of the "4 API empty"
                    // ambiguity.
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            bilibili = it.bilibili.copy(
                                isSyncing = false,
                                isLoggedIn = false,
                                uid = null,
                                errorMessage = "登录信息已过期（缺 ${result.missingFields}）— 请重新登录",
                            ),
                        )
                    }
                }
                is BilibiliLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            bilibili = it.bilibili.copy(
                                isSyncing = false,
                                errorMessage = "采集失败: ${result.reason}",
                            ),
                        )
                    }
                }
                is BilibiliLocalCollector.SnapshotResult.Ok -> {
                    if (result.everythingEmpty) {
                        // Surface the actual Bilibili response code if any was
                        // captured during the 4 API calls (anti-spider -412 /
                        // not-logged-in -101 / IO error are very different
                        // fixes). Real-device 2026-05-22 hit -412 because
                        // BilibiliApiClient was missing User-Agent header.
                        val detail = when (result.lastErrorCode) {
                            0 -> "API 返回空 + 无错误码 — 可能 cookie 缺关键字段（bili_jct / buvid3）"
                            -101 -> "Bilibili 返回 -101（账号未登录）— 请重新登录"
                            -412, 412 -> "Bilibili 返回 -412（反爬触发）— 升级 User-Agent 或稍后重试"
                            -509 -> "Bilibili 返回 -509（限流）— 稍后再试"
                            else -> "Bilibili 返回 code=${result.lastErrorCode}" +
                                (result.lastErrorMessage?.let { " ($it)" } ?: "")
                        }
                        _state.update {
                            it.copy(
                                globalSyncingAdapter = null,
                                bilibili = it.bilibili.copy(
                                    isSyncing = false,
                                    errorMessage = "4 个 API 都返回空 — $detail",
                                ),
                            )
                        }
                        return@launch
                    }
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-bilibili",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    bilibili = it.bilibili.copy(
                                        isSyncing = false,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = if (r.report.status != "ok" && r.report.error != null) {
                                            "入库状态: ${r.report.status} (${r.report.error})"
                                        } else null,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: bilibili cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    bilibili = it.bilibili.copy(
                                        isSyncing = false,
                                        errorMessage = "写入本地数据库失败: ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Phase 7.2.2 — Bilibili Mode B (path B): in-APK root + local SQLite.
     *
     * Coexists with [syncBilibili] (path A, cookies + WBI signing + WebView
     * prefetch). Path B reads `/data/data/tv.danmaku.bili/databases/` `*.db` files
     * directly via root — no internet, no WBI, no anti-bot risk.
     *
     * **Plan §6.4 推 SKIP**: path A 已最优。Mode B 仅作 path A 不可用
     * (api.bilibili.com 被风控/无网) 时的 fallback。
     *
     * UI single-flight via `globalSyncingAdapter` shared with path A.
     * Banner prefix "本机 root:" discriminates in the same SocialCardState.
     */
    fun syncBilibiliRoot() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!bilibiliRootCredentials.hasCredentials()) {
            _state.update {
                it.copy(
                    bilibili = it.bilibili.copy(
                        errorMessage = "本机 root: 请先在路径 A 完成登录 (DedeUserID 会自动用作 root uid)",
                    ),
                )
            }
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-bilibili",
                    bilibili = it.bilibili.copy(
                        isSyncing = true,
                        errorMessage = null,
                        syncStatusText = "本机 root: 拷贝 DB cohort...",
                    ),
                )
            }
            val result = bilibiliRootCollector.snapshot()
            when (result) {
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            bilibili = it.bilibili.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: credentials 缺失 — 请先登录 B 站 App",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoRoot -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            bilibili = it.bilibili.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: 设备未 root — 需 Magisk root 才能读 databases/ 目录",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoDbKey -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            bilibili = it.bilibili.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: db key unavailable (provider=${result.provider})",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.ExtractFailed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            bilibili = it.bilibili.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            bilibili = it.bilibili.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Ok -> {
                    _state.update {
                        it.copy(
                            bilibili = it.bilibili.copy(
                                syncStatusText = "本机 root: 写入金库 (${result.totalEvents} events)...",
                            ),
                        )
                    }
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-bilibili",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            val counts = result.perCategoryCounts
                            val summary = listOfNotNull(
                                counts["history"]?.takeIf { it > 0 }?.let { "$it 历史" },
                                counts["favourite"]?.takeIf { it > 0 }?.let { "$it 收藏" },
                                counts["follow"]?.takeIf { it > 0 }?.let { "$it 关注" },
                            ).joinToString(" / ")
                            val banner = if (result.totalEvents == 0) {
                                val dbName = result.diagnosticFields["dbFilename"] ?: "(unknown)"
                                "本机 root: 同步成功但 0 events — DB '$dbName' 表 schema 可能漂移 (P7.2.0 探测待跟)"
                            } else if (r.report.status != "ok" && r.report.error != null) {
                                "本机 root: 入库状态 ${r.report.status} ($summary; ${r.report.error})"
                            } else {
                                "本机 root: 已同步 $summary (total ${result.totalEvents})"
                            }
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    bilibili = it.bilibili.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = banner,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: bilibili root cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    bilibili = it.bilibili.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        errorMessage = "本机 root: 写入金库失败 ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    fun logoutBilibili() {
        bilibiliCollector.logout()
        _state.update {
            it.copy(
                bilibili = it.bilibili.copy(
                    isLoggedIn = false,
                    uid = null,
                    lastSyncAt = null,
                    lastSyncCount = 0,
                    errorMessage = null,
                ),
            )
        }
    }

    // ─── Weibo (§A8 v0.2 — mirror of Bilibili) ──────────────────────────────
    //
    // 与 Bilibili 唯一架构差异：onWeiboLoginCookie 必须 viewModelScope.launch
    // 因为 acceptLoginCookie 是 suspend (内部调 /api/config 拿 UID — 微博
    // cookie 不带 DedeUserID 这种字段直读)。

    fun refreshWeiboFromStore() {
        val loggedIn = weiboCredentials.hasCredentials()
        val uid = weiboCredentials.getUid()
        val lastSync = weiboCredentials.getLastSyncAt()
        val lastCount = weiboCredentials.getLastSyncCount()
        _state.update {
            it.copy(
                weibo = it.weibo.copy(
                    isLoggedIn = loggedIn,
                    uid = uid,
                    lastSyncAt = lastSync,
                    lastSyncCount = lastCount,
                ),
            )
        }
    }

    fun requestWeiboLogin() {
        _state.update {
            it.copy(
                pendingLogin = LoginRequest(
                    adapterName = "social-weibo",
                    displayName = "微博",
                    // m.weibo.cn 移动端登录页 — 比 weibo.com 桌面端少 captcha
                    loginUrl = "https://passport.weibo.cn/signin/login",
                    cookieDomain = "https://m.weibo.cn",
                    // 登录成功后跳转 m.weibo.cn/* 但不在 passport / login 路径
                    isLoginSuccess = { url ->
                        (url.startsWith("https://m.weibo.cn/") ||
                            url == "https://m.weibo.cn") &&
                            !url.contains("passport") &&
                            !url.contains("login")
                    },
                ),
            )
        }
    }

    fun onWeiboLoginCookie(cookie: String) {
        // acceptLoginCookie 是 suspend (内部调 /api/config 拿 UID)，必须 launch.
        // 显式传 displayName=null 避免 kotlinc 生成 acceptLoginCookie$default
        // 静态桥 — 那条路径上 $default 会读 inline 默认 + 走 GETFIELD 直访问
        // mock 实例 private val 字段，mockk 拦不到。详见 memory
        // `feedback_mockk_cross_file_jvm_pollution.md`。
        viewModelScope.launch {
            val accepted = weiboCollector.acceptLoginCookie(cookie, null)
            _state.update {
                it.copy(
                    pendingLogin = null,
                    weibo = it.weibo.copy(
                        errorMessage = if (!accepted) {
                            "登录未完成 — /api/config 未返 UID，cookie 可能不全请重试"
                        } else null,
                    ),
                )
            }
            if (accepted) refreshWeiboFromStore()
        }
    }

    fun syncWeibo() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!_state.value.weibo.isLoggedIn) {
            requestWeiboLogin()
            return
        }
        // Per-stage progress sink. Updates from non-UI threads are safe —
        // MutableStateFlow is thread-safe and Compose recomposes on state
        // delivery regardless of source thread.
        val onProgress: (String) -> Unit = { stage ->
            _state.update { it.copy(weibo = it.weibo.copy(syncStatusText = stage)) }
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-weibo",
                    weibo = it.weibo.copy(
                        isSyncing = true,
                        syncStatusText = "准备中…",
                        errorMessage = null,
                    ),
                )
            }
            val result = weiboCollector.snapshot(onProgress = onProgress)
            when (result) {
                is WeiboLocalCollector.SnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            weibo = it.weibo.copy(
                                isSyncing = false,
                                isLoggedIn = false,
                                syncStatusText = null,
                                errorMessage = "未登录 — 请先登录",
                            ),
                        )
                    }
                }
                is WeiboLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            weibo = it.weibo.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "采集失败: ${result.reason}",
                            ),
                        )
                    }
                }
                is WeiboLocalCollector.SnapshotResult.Ok -> {
                    if (result.everythingEmpty) {
                        // 微博 ok=N 返回码定义不同：-100 silent ban / -50101 cookie
                        // expired / -4 anti-bot 重定向到登录页。lastError* 传透
                        // 让用户看见原始信号。
                        val detail = when (result.lastErrorCode) {
                            0 -> "API 返回空 + 无错误码 — 可能 cookie 缺关键字段（SUB / SUBP / _T_WM）"
                            -4 -> "非 JSON 响应（重定向到登录页）— 请重新登录"
                            -100 -> "微博 ok=-100（silent ban）— 稍后再试或换网络"
                            -50101 -> "微博 ok=-50101（cookie 过期）— 请重新登录"
                            else -> "微博 ok=${result.lastErrorCode}" +
                                (result.lastErrorMessage?.let { " ($it)" } ?: "")
                        }
                        _state.update {
                            it.copy(
                                globalSyncingAdapter = null,
                                weibo = it.weibo.copy(
                                    isSyncing = false,
                                    syncStatusText = null,
                                    errorMessage = "3 个 API 都返回空 — $detail",
                                ),
                            )
                        }
                        return@launch
                    }
                    // First-pass cap: Weibo timelines easily reach 4-figure
                    // event counts; per-entity SQLCipher + BM25 throughput on
                    // Xiaomi 24115RA8EC profiles ~3-5/s → 1000 events would
                    // dwarf the 240s budget. Limit to 50 so the user gets a
                    // verified end-to-end success surface (UI shows ingested
                    // count instead of "timeout after 240000ms"). Raise once
                    // we have throughput numbers from real device.
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-weibo",
                        inputPath = result.snapshotPath,
                        limit = WEIBO_FIRST_PASS_LIMIT,
                        onProgress = onProgress,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    weibo = it.weibo.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = if (r.report.status != "ok" && r.report.error != null) {
                                            "入库状态: ${r.report.status} (${r.report.error})"
                                        } else null,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: weibo cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    weibo = it.weibo.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        errorMessage = "写入本地数据库失败: ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Phase 7.4.2 — Weibo Mode B (path B): in-APK root + local SQLite.
     *
     * Coexists with [syncWeibo] (path A, cookies + m.weibo.cn HTTP). Path B
     * reads `/data/data/com.sina.weibo/databases/` `*.db` files directly via root
     * — no internet, no signing. Plan §6.2: 零公开 schema 资料 → defensive
     * PRAGMA-based column picker handles unknown drift; user runs P7.3
     * probe + paste-back to confirm DB filename / column candidates.
     *
     * **likely-sqlcipher branch**: if SQLite open hits "file is not a
     * database", extractor surfaces `Failed(reason = "likely-sqlcipher")`
     * with explicit P7.3 §3.4-3.6 frida hook hint. v0.2 follows once user
     * runs the hook to extract the key (mirror of WeChat 12.10 pattern).
     *
     * UI single-flight via `globalSyncingAdapter` shared with path A.
     * Banner prefix "本机 root:" discriminates in the same SocialCardState.
     */
    fun syncWeiboRoot() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!weiboRootCredentials.hasCredentials()) {
            _state.update {
                it.copy(
                    weibo = it.weibo.copy(
                        errorMessage = "本机 root: 请先在路径 A 完成登录 (uid 会自动用作 root uid)",
                    ),
                )
            }
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-weibo",
                    weibo = it.weibo.copy(
                        isSyncing = true,
                        errorMessage = null,
                        syncStatusText = "本机 root: 拷贝 weibo.db cohort...",
                    ),
                )
            }
            when (val result = weiboRootCollector.snapshot()) {
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            weibo = it.weibo.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: credentials 缺失 — 请先登录微博 App",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoRoot -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            weibo = it.weibo.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: 设备未 root — 需 Magisk root 才能读 databases/ 目录",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoDbKey -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            weibo = it.weibo.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: db key unavailable (provider=${result.provider})",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.ExtractFailed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            weibo = it.weibo.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            weibo = it.weibo.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Ok -> {
                    _state.update {
                        it.copy(
                            weibo = it.weibo.copy(
                                syncStatusText = "本机 root: 写入金库 (${result.totalEvents} events)...",
                            ),
                        )
                    }
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-weibo",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            val counts = result.perCategoryCounts
                            val summary = listOfNotNull(
                                counts["post"]?.takeIf { it > 0 }?.let { "$it 微博" },
                                counts["favourite"]?.takeIf { it > 0 }?.let { "$it 收藏" },
                                counts["follow"]?.takeIf { it > 0 }?.let { "$it 关注" },
                            ).joinToString(" / ")
                            val banner = if (result.totalEvents == 0) {
                                "本机 root: 同步成功但 0 events — weibo.db 表 schema 可能漂移 (P7.3 §4 探测待跟)"
                            } else if (r.report.status != "ok" && r.report.error != null) {
                                "本机 root: 入库状态 ${r.report.status} ($summary; ${r.report.error})"
                            } else {
                                "本机 root: 已同步 $summary (total ${result.totalEvents})"
                            }
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    weibo = it.weibo.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = banner,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: weibo root cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    weibo = it.weibo.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        errorMessage = "本机 root: 写入金库失败 ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    fun logoutWeibo() {
        weiboCollector.logout()
        _state.update {
            it.copy(
                weibo = it.weibo.copy(
                    isLoggedIn = false,
                    uid = null,
                    lastSyncAt = null,
                    lastSyncCount = 0,
                    errorMessage = null,
                ),
            )
        }
    }

    // ─── Douyin (§A8 v0.2 — mirror of Weibo, smaller v0.2 surface) ──────────
    //
    // 与 Weibo 唯一架构差异：onDouyinLoginCookie 也是 suspend (内部调
    // /aweme/v1/passport/account/info/v2/ 拿 sec_user_id — 抖音 cookie
    // 不带 DedeUserID 这种字段直读)。
    //
    // **v0.2 surface 比 Weibo/Bilibili 小**：只同步 profile (1 个 event)，
    // 历史/赞/收藏需 v0.3 X-Bogus 签名接通。SocialCardState.uid 字段抖音
    // 是 String secUid 不是 Long — UI 显时若 uid==null 就不显，下面 sync
    // 完毕只更 lastSyncAt + lastSyncCount，不写 uid 到 Long? 字段。
    //
    // (备选：另起 DouyinCardState String-uid 专用 — 暂从简，UI 显
    // "已登录"代替 "已登录 UID:xxx"。)

    fun refreshDouyinFromStore() {
        val loggedIn = douyinCredentials.hasCredentials()
        val lastSync = douyinCredentials.getLastSyncAt()
        val lastCount = douyinCredentials.getLastSyncCount()
        _state.update {
            it.copy(
                douyin = it.douyin.copy(
                    isLoggedIn = loggedIn,
                    uid = null, // 抖音 secUid 是 String 不是 Long，留 null
                    lastSyncAt = lastSync,
                    lastSyncCount = lastCount,
                ),
            )
        }
    }

    fun requestDouyinLogin() {
        _state.update {
            it.copy(
                pendingLogin = LoginRequest(
                    adapterName = "social-douyin",
                    displayName = "抖音",
                    // 2026-05-25：登录 URL 是 modal 形式 — 弹窗关闭后 URL 仍含
                    // ?showLogin=1，[isLoginSuccess] URL predicate 永不命中。
                    // 改靠 [isLoginSuccessByCookie] 轮询 cookie 出现作信号。
                    // www.douyin.com passport 登录页 — 扫码 + 密码两种登录方式都进
                    // 这个 URL（抖音桌面端没单独 mobile passport.douyin.com 入口）
                    loginUrl = "https://www.douyin.com/?showLogin=1",
                    cookieDomain = "https://www.douyin.com",
                    // URL predicate 兜底：少数场景抖音确实会 redirect 到 /user/<id>
                    // 或 m.douyin.com，匹配但排除 modal/passport 中间态。主信号
                    // 是下方的 isLoginSuccessByCookie。
                    isLoginSuccess = { url ->
                        (url.startsWith("https://www.douyin.com/") ||
                            url.startsWith("https://m.douyin.com/") ||
                            url == "https://www.douyin.com" ||
                            url == "https://m.douyin.com") &&
                            !url.contains("showLogin=1") &&
                            !url.contains("passport.")
                    },
                    // 抖音登录后 cookie 写两个 session key 之一即可视为成功 —
                    // sessionid_ucp_v1（新版主 key）或 sessionid（兼容路径）。
                    // 任一出现就 trigger onLoginComplete。
                    isLoginSuccessByCookie = { cookie ->
                        cookie.contains("sessionid_ucp_v1=") ||
                            cookie.contains("sessionid=")
                    },
                    userAgent = DESKTOP_CHROME_USER_AGENT,
                ),
            )
        }
    }

    /**
     * 2026-05-25 — 抖音 in-WebView prefetch 路径（复刻 [onBilibiliLoginWithPrefetch]）。
     * [DouyinJsBridge.PREFETCH_JS] 在登录用 WebView 内 fetch profile + history + fav
     * + like 后传 JSON 上来。绕开 OkHttp 端 TLS 指纹 + `_signature` 客户端签名风控。
     *
     * 流程：解 prefetched JSON 拿 secUid/nickname → saveCredentials → ingestPrefetched
     * 写 staging → ccRunner.syncAdapter 入 vault。prefetched=null fallback 到旧
     * onDouyinLoginCookie 路径（OkHttp acceptLoginCookie，知道大概率 fail）。
     */
    fun onDouyinLoginWithPrefetch(cookie: String, prefetched: String?) {
        if (prefetched == null) {
            Timber.w("HubLocalViewModel: Douyin prefetch null (JS 抛错或超时), 回退")
            onDouyinLoginCookie(cookie)
            return
        }
        val root = try { org.json.JSONObject(prefetched) } catch (e: Exception) {
            Timber.w(e, "HubLocalViewModel: Douyin prefetched JSON parse failed")
            onDouyinLoginCookie(cookie)
            return
        }
        val account = root.optJSONObject("account")
        val secUid = account?.optString("secUid")?.takeIf { it.isNotBlank() }
        if (secUid == null) {
            Timber.w("HubLocalViewModel: Douyin prefetched account.secUid missing — 调 ingestPrefetched 留 _debug log + 文件备查")
            viewModelScope.launch {
                douyinCollector.ingestPrefetched(prefetched)
            }
            _state.update {
                it.copy(
                    pendingLogin = null,
                    douyin = it.douyin.copy(
                        errorMessage = "登录未完成 — prefetch 未拿到 sec_uid (账号未登录或 cookie 缺关键字段)",
                    ),
                )
            }
            return
        }
        val nickname = account.optString("nickname").takeIf { it.isNotBlank() }
        val shortIdFromCookie = com.chainlesschain.android.pdh.social.douyin.DouyinApiClient
            .extractShortIdFromCookie(cookie)
        douyinCredentials.saveCredentials(
            cookie = cookie,
            secUid = secUid,
            shortId = shortIdFromCookie,
            displayName = nickname,
        )
        _state.update {
            it.copy(
                pendingLogin = null,
                douyin = it.douyin.copy(
                    isSyncing = true,
                    errorMessage = null,
                ),
                globalSyncingAdapter = "social-douyin",
            )
        }
        refreshDouyinFromStore()
        viewModelScope.launch {
            val syncResult = douyinCollector.ingestPrefetched(prefetched)
            when (syncResult) {
                is com.chainlesschain.android.pdh.social.douyin.DouyinLocalCollector.SnapshotResult.Ok -> {
                    when (val cc = ccRunner.syncAdapter(
                        adapterName = "social-douyin",
                        inputPath = syncResult.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            douyinCollector.recordSync(syncResult.totalEvents)
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    douyin = it.douyin.copy(
                                        isSyncing = false,
                                        lastSyncAt = System.currentTimeMillis(),
                                        lastSyncCount = syncResult.totalEvents,
                                        errorMessage = null,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    douyin = it.douyin.copy(
                                        isSyncing = false,
                                        errorMessage = "cc sync 失败：${cc.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
                is com.chainlesschain.android.pdh.social.douyin.DouyinLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            douyin = it.douyin.copy(
                                isSyncing = false,
                                errorMessage = "prefetch ingest 失败：${syncResult.reason}",
                            ),
                        )
                    }
                }
                else -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            douyin = it.douyin.copy(
                                isSyncing = false,
                                errorMessage = "prefetch ingest 异常: $syncResult",
                            ),
                        )
                    }
                }
            }
        }
    }

    fun onDouyinLoginCookie(cookie: String) {
        // acceptLoginCookie 是 suspend (内部调 passport/account/info/v2/)，必须 launch
        viewModelScope.launch {
            // 显式传 displayName=null 避免 kotlinc 生成 $default GETFIELD
            // 桥（见 memory feedback_mockk_cross_file_jvm_pollution.md）。
            val accepted = douyinCollector.acceptLoginCookie(cookie, null)
            _state.update {
                it.copy(
                    pendingLogin = null,
                    douyin = it.douyin.copy(
                        errorMessage = if (!accepted) {
                            // Surface the real apiClient error so users can tell
                            // "cookie expired" (status_code=2154) apart from
                            // "endpoint shape changed" (code=-5) apart from
                            // "anonymous response" (code=-7).
                            val code = douyinCollector.lastLoginErrorCode
                            val detail = douyinCollector.lastLoginErrorMessage
                                ?: "passport/info/v2 未返 sec_user_id"
                            "登录未完成 — code=$code $detail（cookie 可能不全请重试）"
                        } else null,
                    ),
                )
            }
            if (accepted) refreshDouyinFromStore()
        }
    }

    fun syncDouyin() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!_state.value.douyin.isLoggedIn) {
            requestDouyinLogin()
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-douyin",
                    douyin = it.douyin.copy(isSyncing = true, errorMessage = null),
                )
            }
            // v0.3 — wire DouyinSignBridge for X-Bogus + _signature. Same
            // finally-shutdown pattern as Toutiao to free the 30-50MB hidden
            // WebView heap; re-warm next sync costs ~3s dominated by user
            // click anyway.
            douyinCollector.signProvider = douyinSignBridge
            val result = try {
                douyinCollector.snapshot()
            } finally {
                try {
                    douyinSignBridge.shutdown()
                } catch (t: Throwable) {
                    Timber.w(t, "HubLocalViewModel: douyinSignBridge.shutdown threw")
                }
            }
            when (result) {
                is DouyinLocalCollector.SnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            douyin = it.douyin.copy(
                                isSyncing = false,
                                isLoggedIn = false,
                                errorMessage = "未登录 — 请先登录",
                            ),
                        )
                    }
                }
                is DouyinLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            douyin = it.douyin.copy(
                                isSyncing = false,
                                errorMessage = "采集失败: ${result.reason}",
                            ),
                        )
                    }
                }
                is DouyinLocalCollector.SnapshotResult.Ok -> {
                    if (result.everythingEmpty) {
                        // 抖音 status_code 定义：0=ok / 2154=token expired /
                        // -1=server error / -2=参数错。lastError* 传透让用户看见
                        // 原始信号。
                        val detail = when (result.lastErrorCode) {
                            0 -> "passport/info/v2 返空 — 可能 cookie 缺关键字段（sessionid / sid_guard / passport_csrf_token）"
                            -4 -> "非 JSON 响应（重定向到登录页 / 反爬触发）— 请重新登录"
                            2154 -> "抖音 status_code=2154（token expired）— 请重新登录"
                            -2 -> "IO error — 网络问题，稍后重试"
                            else -> "抖音 status_code=${result.lastErrorCode}" +
                                (result.lastErrorMessage?.let { " ($it)" } ?: "")
                        }
                        _state.update {
                            it.copy(
                                globalSyncingAdapter = null,
                                douyin = it.douyin.copy(
                                    isSyncing = false,
                                    errorMessage = "未能拉到账号信息 — $detail",
                                ),
                            )
                        }
                        return@launch
                    }
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-douyin",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            _state.update {
                                val banner = if (r.report.status != "ok" && r.report.error != null) {
                                    "入库状态: ${r.report.status} (${r.report.error})"
                                } else if (result.v03Attempted &&
                                    (result.historyCount + result.favouriteCount + result.likeCount) > 0
                                ) {
                                    "已同步 profile + ${result.historyCount} 历史 / ${result.favouriteCount} 收藏 / ${result.likeCount} 点赞"
                                } else if (result.v03Attempted) {
                                    "已同步账号信息。v0.3 签名 bridge 未就绪 — 历史/赞/收藏本次未抓到（代码 ${result.lastErrorCode}），稍后再同步。"
                                } else if (result.totalEvents <= 1) {
                                    "已同步账号信息（v0.2）。历史/赞/收藏需 v0.3 X-Bogus 签名接通。"
                                } else null
                                it.copy(
                                    globalSyncingAdapter = null,
                                    douyin = it.douyin.copy(
                                        isSyncing = false,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = banner,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: douyin cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    douyin = it.douyin.copy(
                                        isSyncing = false,
                                        errorMessage = "写入本地数据库失败: ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Phase 7.1.2b — Douyin Mode B (path B): in-APK root + local SQLite.
     *
     * Coexists with [syncDouyin] (path A, cookies + WebView + passport
     * endpoint + DouyinSignBridge). Path B reads `/data/data/
     * com.ss.android.ugc.aweme/databases/<uid>_im.db` directly via root
     * — no internet, no PC, no signing required. Mirror of P7.1.2
     * `syncToutiaoRoot` pattern.
     *
     * UI single-flight via `globalSyncingAdapter` shared with path A.
     * Banner prefix "本机 root:" discriminates in the same SocialCardState.
     */
    fun syncDouyinRoot() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!douyinRootCredentials.hasCredentials()) {
            _state.update {
                it.copy(
                    douyin = it.douyin.copy(
                        errorMessage = "本机 root: 请先在路径 A 完成登录 (sec_user_id + uid 会自动用作 root uid)",
                    ),
                )
            }
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-douyin",
                    douyin = it.douyin.copy(
                        isSyncing = true,
                        errorMessage = null,
                        syncStatusText = "本机 root: 拷贝 <uid>_im.db cohort...",
                    ),
                )
            }
            val result = douyinRootCollector.snapshot()
            when (result) {
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            douyin = it.douyin.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: credentials 缺失 — 请先登录抖音 App",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoRoot -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            douyin = it.douyin.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: 设备未 root — 需 Magisk root 才能读 databases/ 目录",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoDbKey -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            douyin = it.douyin.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: db key unavailable (provider=${result.provider})",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.ExtractFailed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            douyin = it.douyin.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            douyin = it.douyin.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Ok -> {
                    _state.update {
                        it.copy(
                            douyin = it.douyin.copy(
                                syncStatusText = "本机 root: 写入金库 (${result.totalEvents} events)...",
                            ),
                        )
                    }
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-douyin",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            val counts = result.perCategoryCounts
                            val summary = listOfNotNull(
                                counts["message"]?.takeIf { it > 0 }?.let { "$it 消息" },
                                counts["contact"]?.takeIf { it > 0 }?.let { "$it 联系人" },
                            ).joinToString(" / ")
                            val banner = if (result.totalEvents == 0) {
                                "本机 root: 同步成功但 0 events — <uid>_im.db 表 schema 可能漂移 (P7.1.0 探测待跟)"
                            } else if (r.report.status != "ok" && r.report.error != null) {
                                "本机 root: 入库状态 ${r.report.status} ($summary; ${r.report.error})"
                            } else {
                                "本机 root: 已同步 $summary (total ${result.totalEvents})"
                            }
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    douyin = it.douyin.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = banner,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: douyin root cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    douyin = it.douyin.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        errorMessage = "本机 root: 写入金库失败 ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    fun logoutDouyin() {
        douyinCollector.logout()
        _state.update {
            it.copy(
                douyin = it.douyin.copy(
                    isLoggedIn = false,
                    uid = null,
                    lastSyncAt = null,
                    lastSyncCount = 0,
                    errorMessage = null,
                ),
            )
        }
    }

    // ─── Xiaohongshu (§A8 v0.2 — mirror of Weibo) ───────────────────────────
    //
    // 与 Weibo 唯一差异: acceptLoginCookie 不仅调 /api/sns/web/v1/user/me 拿
    // user_id+nickname (类似 Weibo /api/config 拿 uid)，还要从同一 cookie 解
    // a1 字段独立存 (X-S 签名要用 — Weibo 不需要签名)。

    fun refreshXhsFromStore() {
        val loggedIn = xhsCredentials.hasCredentials()
        val uid = xhsCredentials.getUid()
        val lastSync = xhsCredentials.getLastSyncAt()
        val lastCount = xhsCredentials.getLastSyncCount()
        _state.update {
            it.copy(
                xiaohongshu = it.xiaohongshu.copy(
                    isLoggedIn = loggedIn,
                    uid = uid,
                    lastSyncAt = lastSync,
                    lastSyncCount = lastCount,
                ),
            )
        }
    }

    fun requestXhsLogin() {
        _state.update {
            it.copy(
                pendingLogin = LoginRequest(
                    adapterName = "social-xiaohongshu",
                    displayName = "小红书",
                    // xiaohongshu.com 网页版登录页（Mobile UA 下平台会自动跳
                    // m.xiaohongshu.com，predicate 必须兼容两域）
                    loginUrl = "https://www.xiaohongshu.com/explore",
                    cookieDomain = "https://www.xiaohongshu.com",
                    // 登录成功后跳 www.xiaohongshu.com / m.xiaohongshu.com 子路径，
                    // 但不在 login/passport
                    isLoginSuccess = { url ->
                        url.contains("xiaohongshu.com") &&
                            !url.contains("/login") &&
                            !url.contains("/sign-in") &&
                            !url.contains("passport")
                    },
                    // 2026-05-26 真机回归 v3: 仅 contains("web_session=") 不够，
                    // xhs 即使访客也发 38 字符 `0300...` web_session 作 tracking
                    // ID (cookie poll 触发但 /user/me 返 code=-104)。真登录后
                    // value 约 60-88 字符 base64-like token。改阈值 ≥ 50 拒占位
                    isLoginSuccessByCookie = { cookie ->
                        val m = Regex("(?:^|;\\s*)web_session=([^;\\s]+)").find(cookie)
                        val value = m?.groupValues?.getOrNull(1) ?: ""
                        value.length >= 30
                    },
                    userAgent = DESKTOP_CHROME_USER_AGENT,
                ),
            )
        }
    }

    /**
     * 2026-05-26 — 小红书 in-WebView prefetch (复刻 onDouyinLoginWithPrefetch).
     * 详 memory `bilibili_in_webview_prefetch_architecture.md`。被并行 session
     * rebase race 整丢过一次，commit `<待 land>` 重新加回 + lock 住。
     */
    fun onXhsLoginWithPrefetch(cookie: String, prefetched: String?) {
        if (prefetched == null) {
            Timber.w("HubLocalViewModel: Xhs prefetch null (JS 抛错或超时), 回退")
            onXhsLoginCookie(cookie)
            return
        }
        val root = try { org.json.JSONObject(prefetched) } catch (e: Exception) {
            Timber.w(e, "HubLocalViewModel: Xhs prefetched JSON parse failed")
            onXhsLoginCookie(cookie)
            return
        }
        val account = root.optJSONObject("account")
        val userId = account?.optString("uid")?.takeIf { it.isNotBlank() }
        val a1 = account?.optString("a1")?.takeIf { it.isNotBlank() }
        val nickname = account?.optString("displayName")?.takeIf { it.isNotBlank() }
        if (userId == null || a1 == null) {
            Timber.w(
                "HubLocalViewModel: Xhs prefetched account missing fields userId=%s a1=%s — 调 ingestPrefetched 留 _debug log + 文件备查",
                userId, if (a1 != null) "present" else "null",
            )
            viewModelScope.launch {
                xhsCollector.ingestPrefetched(prefetched)
            }
            _state.update {
                it.copy(
                    pendingLogin = null,
                    xiaohongshu = it.xiaohongshu.copy(
                        errorMessage = "登录未完成 — prefetch 未拿到 ${if (userId == null) "user_id" else "a1"}。" +
                            "原始诊断已落 staging/social-xiaohongshu.json，看 logcat XhsLocalCollector prefetch[N] 行定位",
                    ),
                )
            }
            return
        }
        val numericUid = userId.hashCode().toLong()
        xhsCredentials.saveCredentials(
            cookie = cookie, uid = numericUid, userIdStr = userId, a1 = a1, displayName = nickname,
        )
        _state.update {
            it.copy(
                pendingLogin = null,
                xiaohongshu = it.xiaohongshu.copy(isSyncing = true, errorMessage = null),
                globalSyncingAdapter = "social-xiaohongshu",
            )
        }
        refreshXhsFromStore()
        viewModelScope.launch {
            val syncResult = xhsCollector.ingestPrefetched(prefetched)
            when (syncResult) {
                is XhsLocalCollector.SnapshotResult.Ok -> {
                    when (val cc = ccRunner.syncAdapter(
                        adapterName = "social-xiaohongshu", inputPath = syncResult.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            xhsCollector.recordSync(syncResult.totalEvents)
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    xiaohongshu = it.xiaohongshu.copy(
                                        isSyncing = false,
                                        lastSyncAt = System.currentTimeMillis(),
                                        lastSyncCount = syncResult.totalEvents,
                                        errorMessage = null,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    xiaohongshu = it.xiaohongshu.copy(
                                        isSyncing = false,
                                        errorMessage = "cc sync 失败：${cc.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
                is XhsLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            xiaohongshu = it.xiaohongshu.copy(
                                isSyncing = false,
                                errorMessage = "prefetch ingest 失败：${syncResult.reason}",
                            ),
                        )
                    }
                }
                else -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            xiaohongshu = it.xiaohongshu.copy(
                                isSyncing = false,
                                errorMessage = "prefetch ingest 异常: $syncResult",
                            ),
                        )
                    }
                }
            }
        }
    }

    fun onXhsLoginCookie(cookie: String) {
        // acceptLoginCookie 是 suspend (调 /api/sns/web/v1/user/me 拿 user_id)
        viewModelScope.launch {
            // 显式传 displayName=null 避免 kotlinc 生成 $default GETFIELD
            // 桥（见 memory feedback_mockk_cross_file_jvm_pollution.md，与
            // onDouyinLoginCookie 同模式）。
            val accepted = xhsCollector.acceptLoginCookie(cookie, null)
            _state.update {
                it.copy(
                    pendingLogin = null,
                    xiaohongshu = it.xiaohongshu.copy(
                        errorMessage = if (!accepted) {
                            // Surface the real collector/apiClient error so users
                            // can tell "missing a1 cookie" (-10) apart from
                            // "/user/me HTTP fail" (4xx/5xx) apart from "endpoint
                            // shape drift" (-5/-6/-7).
                            val code = xhsCollector.lastLoginErrorCode
                            val detail = xhsCollector.lastLoginErrorMessage
                                ?: "cookie 缺 a1 字段或 /user/me 调用失败"
                            "登录未完成 — code=$code $detail（请重试）"
                        } else null,
                    ),
                )
            }
            if (accepted) refreshXhsFromStore()
        }
    }

    fun syncXhs() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!_state.value.xiaohongshu.isLoggedIn) {
            requestXhsLogin()
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-xiaohongshu",
                    xiaohongshu = it.xiaohongshu.copy(isSyncing = true, errorMessage = null),
                )
            }
            // v0.3 — wire XhsSignBridge for X-s/X-t/X-s-common. Unlike
            // Toutiao/Douyin/Kuaishou (where the bridge gates v0.3
            // endpoints), Xhs always calls all 3 fetchers — bridge is a
            // reliability upgrade (~60% GET hit rate → ~100% when bridge
            // succeeds). Bridge null/failure falls through to computeXsXt
            // in the ApiClient. finally-shutdown releases the WebView heap.
            xhsCollector.signProvider = xhsSignBridge
            val result = try {
                xhsCollector.snapshot()
            } finally {
                try {
                    xhsSignBridge.shutdown()
                } catch (t: Throwable) {
                    Timber.w(t, "HubLocalViewModel: xhsSignBridge.shutdown threw")
                }
            }
            when (result) {
                is XhsLocalCollector.SnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            xiaohongshu = it.xiaohongshu.copy(
                                isSyncing = false,
                                isLoggedIn = false,
                                errorMessage = "未登录 — 请先登录",
                            ),
                        )
                    }
                }
                is XhsLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            xiaohongshu = it.xiaohongshu.copy(
                                isSyncing = false,
                                errorMessage = "采集失败: ${result.reason}",
                            ),
                        )
                    }
                }
                is XhsLocalCollector.SnapshotResult.Ok -> {
                    if (result.everythingEmpty) {
                        // 小红书 code 含义:
                        //   -461 = X-S 签名校验失败 (v0.2 算法 best-effort, v0.3 完整 b1)
                        //   -100 = silent ban
                        //   -10000 = 接口失败 / 限流
                        //   -4 = 非 JSON (cookie 过期重定向到 login)
                        val detail = when (result.lastErrorCode) {
                            0 -> "API 返回空 + 无错误码 — cookie 可能不完整（缺 web_session / a1）"
                            -4 -> "非 JSON 响应（重定向到登录页）— 请重新登录"
                            -461 -> "小红书 -461（X-S 签名校验失败）— v0.2 签名算法近似实现，v0.3 follow-up 接 b1 cookie 完整签名"
                            -100 -> "小红书 -100（silent ban）— 单 IP 频繁请求触发风控，稍后再试"
                            -10000 -> "小红书 -10000（接口限流 / 失败）— 稍后再试或换网络"
                            else -> "小红书 code=${result.lastErrorCode}" +
                                (result.lastErrorMessage?.let { " ($it)" } ?: "")
                        }
                        _state.update {
                            it.copy(
                                globalSyncingAdapter = null,
                                xiaohongshu = it.xiaohongshu.copy(
                                    isSyncing = false,
                                    errorMessage = "3 个 API 都返回空 — $detail",
                                ),
                            )
                        }
                        return@launch
                    }
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-xiaohongshu",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    xiaohongshu = it.xiaohongshu.copy(
                                        isSyncing = false,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = if (r.report.status != "ok" && r.report.error != null) {
                                            "入库状态: ${r.report.status} (${r.report.error})"
                                        } else null,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: xhs cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    xiaohongshu = it.xiaohongshu.copy(
                                        isSyncing = false,
                                        errorMessage = "写入本地数据库失败: ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Phase 7.5.2 — Xhs Mode B (path B): in-APK root + local SQLite.
     *
     * Coexists with [syncXhs] (path A, cookies + X-S 签名 HTTP + WebView
     * prefetch). Path B reads `/data/data/com.xingin.xhs/databases/` `*.db` files
     * directly via root — no internet, no X-S signing.
     *
     * **v0.1 期望成功率最低 of 4 platforms** per plan §6.5: Xhs DB
     * 几乎确定 SQLCipher 加密 + libshield.so 反 frida. v0.1 ship 是 user-
     * explicit "Mode B 全面 5 平台" override; 真机 大概率命中
     * `likely-sqlcipher` banner 跳 v2.0 frida + libshield neuter 路径。
     *
     * UI single-flight via `globalSyncingAdapter` shared with path A.
     * Banner prefix "本机 root:" discriminates in the same SocialCardState.
     */
    fun syncXhsRoot() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!xhsRootCredentials.hasCredentials()) {
            _state.update {
                it.copy(
                    xiaohongshu = it.xiaohongshu.copy(
                        errorMessage = "本机 root: 请先在路径 A 完成登录 (user_id 24-char hex 会自动用作 root user_id)",
                    ),
                )
            }
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-xiaohongshu",
                    xiaohongshu = it.xiaohongshu.copy(
                        isSyncing = true,
                        errorMessage = null,
                        syncStatusText = "本机 root: 拷贝 xhs.db cohort...",
                    ),
                )
            }
            when (val result = xhsRootCollector.snapshot()) {
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            xiaohongshu = it.xiaohongshu.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: credentials 缺失 — 请先登录小红书 App",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoRoot -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            xiaohongshu = it.xiaohongshu.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: 设备未 root — 需 Magisk root 才能读 databases/ 目录",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoDbKey -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            xiaohongshu = it.xiaohongshu.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: db key unavailable (provider=${result.provider})",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.ExtractFailed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            xiaohongshu = it.xiaohongshu.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            xiaohongshu = it.xiaohongshu.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Ok -> {
                    _state.update {
                        it.copy(
                            xiaohongshu = it.xiaohongshu.copy(
                                syncStatusText = "本机 root: 写入金库 (${result.totalEvents} events)...",
                            ),
                        )
                    }
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-xiaohongshu",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            val counts = result.perCategoryCounts
                            val summary = listOfNotNull(
                                counts["note"]?.takeIf { it > 0 }?.let { "$it 笔记" },
                                counts["liked"]?.takeIf { it > 0 }?.let { "$it 点赞" },
                                counts["follow"]?.takeIf { it > 0 }?.let { "$it 关注" },
                            ).joinToString(" / ")
                            val banner = if (result.totalEvents == 0) {
                                "本机 root: 同步成功但 0 events — xhs.db 表 schema 可能漂移 (P7.5.0 探测待跟)"
                            } else if (r.report.status != "ok" && r.report.error != null) {
                                "本机 root: 入库状态 ${r.report.status} ($summary; ${r.report.error})"
                            } else {
                                "本机 root: 已同步 $summary (total ${result.totalEvents})"
                            }
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    xiaohongshu = it.xiaohongshu.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = banner,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: xhs root cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    xiaohongshu = it.xiaohongshu.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        errorMessage = "本机 root: 写入金库失败 ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    fun logoutXhs() {
        xhsCollector.logout()
        _state.update {
            it.copy(
                xiaohongshu = it.xiaohongshu.copy(
                    isLoggedIn = false,
                    uid = null,
                    lastSyncAt = null,
                    lastSyncCount = 0,
                    errorMessage = null,
                ),
            )
        }
    }

    // ─── Toutiao 今日头条 (v0.1 placeholder — cookie + uid, events 空) ─────────
    //
    // 与 Douyin 同 family（ByteDance _signature 反爬 SDK），但 v0.1 比 Douyin
    // 更小 surface：**完全不发网络请求**。cookie 抓回来后从 cookie 直接抽
    // `passport_uid` / `multi_sids` / __ac_uid 之一，写 store；snapshot 写
    // empty events 数组，cc syncAdapter 返 ingested=0，UI 透出
    // "v0.2 待 _signature 签名接通历史/收藏/搜索"。
    //
    // SocialCardState.uid 字段是 Long? — 头条 uid 是数字字符串，能转 Long 就
    // 转一下，转不了（极端长度）就留 null（仍能 isLoggedIn=true）。

    fun refreshToutiaoFromStore() {
        val loggedIn = toutiaoCredentials.hasCredentials()
        val uidStr = toutiaoCredentials.getUid()
        val uidLong = uidStr?.toLongOrNull()
        val lastSync = toutiaoCredentials.getLastSyncAt()
        val lastCount = toutiaoCredentials.getLastSyncCount()
        _state.update {
            it.copy(
                toutiao = it.toutiao.copy(
                    isLoggedIn = loggedIn,
                    uid = uidLong,
                    lastSyncAt = lastSync,
                    lastSyncCount = lastCount,
                ),
            )
        }
    }

    fun requestToutiaoLogin() {
        _state.update {
            it.copy(
                pendingLogin = LoginRequest(
                    adapterName = "social-toutiao",
                    displayName = "今日头条",
                    // 头条 web 首页右上角登录按钮触发 sso.toutiao.com 弹窗；直接
                    // 入主页让用户点登录按钮（与抖音 ?showLogin=1 不同，头条
                    // 主页没有 query param 直唤登录的等价物）
                    loginUrl = "https://www.toutiao.com/",
                    cookieDomain = "https://www.toutiao.com",
                    // 登录后仍在 www.toutiao.com，但 cookie 已含 passport_uid。
                    // 排除 sso / passport / login 中间页避免 cookie 抢跑（与
                    // memory bilibili_post_onload_cookie_race.md 同 family 的
                    // 风险点，2 秒延迟由 SocialCookieWebViewScreen 通用处理）
                    // 2026-05-26 真机回归 (同 Xhs trap): toutiao.com/ 是登录页本
                    // 身, url 一加载就匹配 contains("toutiao.com") 误触发。禁掉
                    // URL 路径只走 cookie poll
                    isLoginSuccess = { _ -> false },
                    // 头条 web 登录后 cookie 含 passport_uid= (numeric, 真用户态)
                    // 或 sessionid=。passport_uid 长度 ≥ 4 拒空占位
                    isLoginSuccessByCookie = { cookie ->
                        val m = Regex("(?:^|;\\s*)passport_uid=(\\d+)").find(cookie)
                        val value = m?.groupValues?.getOrNull(1) ?: ""
                        value.length >= 4 || cookie.contains("sessionid=")
                    },
                    userAgent = DESKTOP_CHROME_USER_AGENT,
                ),
            )
        }
    }

    /**
     * 2026-05-26 — 头条 in-WebView prefetch (复刻 onXhsLoginWithPrefetch).
     * /passport/account/info/v2/?aid=24 不需签名直接返用户数据。详 memory
     * `bilibili_in_webview_prefetch_architecture.md`。
     */
    fun onToutiaoLoginWithPrefetch(cookie: String, prefetched: String?) {
        if (prefetched == null) {
            Timber.w("HubLocalViewModel: Toutiao prefetch null (JS 抛错或超时), 回退")
            onToutiaoLoginCookie(cookie)
            return
        }
        val root = try { org.json.JSONObject(prefetched) } catch (e: Exception) {
            Timber.w(e, "HubLocalViewModel: Toutiao prefetched JSON parse failed")
            onToutiaoLoginCookie(cookie)
            return
        }
        val account = root.optJSONObject("account")
        val uid = account?.optString("uid")?.takeIf { it.isNotBlank() }
        val nickname = account?.optString("displayName")?.takeIf { it.isNotBlank() }
        if (uid == null) {
            Timber.w("HubLocalViewModel: Toutiao prefetched account.uid missing — 调 ingestPrefetched 留 _debug log + 文件备查")
            viewModelScope.launch {
                toutiaoCollector.ingestPrefetched(prefetched)
            }
            _state.update {
                it.copy(
                    pendingLogin = null,
                    toutiao = it.toutiao.copy(
                        errorMessage = "登录未完成 — prefetch 未拿到 passport_uid。看 logcat ToutiaoLocalCollector prefetch[N] 行定位",
                    ),
                )
            }
            return
        }
        toutiaoCredentials.saveCredentials(cookie = cookie, uid = uid, displayName = nickname)
        _state.update {
            it.copy(
                pendingLogin = null,
                toutiao = it.toutiao.copy(isSyncing = true, errorMessage = null),
                globalSyncingAdapter = "social-toutiao",
            )
        }
        refreshToutiaoFromStore()
        viewModelScope.launch {
            val syncResult = toutiaoCollector.ingestPrefetched(prefetched)
            when (syncResult) {
                is ToutiaoLocalCollector.SnapshotResult.Ok -> {
                    when (val cc = ccRunner.syncAdapter(
                        adapterName = "social-toutiao", inputPath = syncResult.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            toutiaoCollector.recordSync(syncResult.totalEvents)
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    toutiao = it.toutiao.copy(
                                        isSyncing = false,
                                        lastSyncAt = System.currentTimeMillis(),
                                        lastSyncCount = syncResult.totalEvents,
                                        errorMessage = null,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    toutiao = it.toutiao.copy(
                                        isSyncing = false,
                                        errorMessage = "cc sync 失败：${cc.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
                is ToutiaoLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            toutiao = it.toutiao.copy(
                                isSyncing = false,
                                errorMessage = "prefetch ingest 失败：${syncResult.reason}",
                            ),
                        )
                    }
                }
                else -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            toutiao = it.toutiao.copy(
                                isSyncing = false,
                                errorMessage = "prefetch ingest 异常: $syncResult",
                            ),
                        )
                    }
                }
            }
        }
    }

    fun onToutiaoLoginCookie(cookie: String) {
        // acceptLoginCookie 不是 suspend (没有网络调用)，但保持与 Douyin 同
        // launch + state-update 风格，便于将来 v0.2 加 network 时 1:1 升级
        viewModelScope.launch {
            val accepted = toutiaoCollector.acceptLoginCookie(cookie, null)
            _state.update {
                it.copy(
                    pendingLogin = null,
                    toutiao = it.toutiao.copy(
                        errorMessage = if (!accepted) {
                            val code = toutiaoCollector.lastLoginErrorCode
                            val detail = toutiaoCollector.lastLoginErrorMessage
                                ?: "cookie 缺 passport_uid / multi_sids"
                            "登录未完成 — code=$code $detail（请确认已登录后重试）"
                        } else null,
                    ),
                )
            }
            if (accepted) refreshToutiaoFromStore()
        }
    }

    fun syncToutiao() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!_state.value.toutiao.isLoggedIn) {
            requestToutiaoLogin()
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-toutiao",
                    toutiao = it.toutiao.copy(isSyncing = true, errorMessage = null),
                )
            }
            // v0.3 — wire the sign bridge so the collector can attempt
            // feed/comments/search. The bridge gracefully degrades when its
            // WebView fails to load or acrawler.js rotates its function
            // name — collector then falls back to v0.2 profile-only.
            // Bridge holds a ~30-50MB hidden WebView while warm; we shut it
            // down right after snapshot to free the heap (re-warm next sync
            // costs ~3s, dominated by the user's manual click anyway).
            toutiaoCollector.signProvider = toutiaoSignBridge
            val result = try {
                toutiaoCollector.snapshot()
            } finally {
                try {
                    toutiaoSignBridge.shutdown()
                } catch (t: Throwable) {
                    Timber.w(t, "HubLocalViewModel: toutiaoSignBridge.shutdown threw")
                }
            }
            when (result) {
                is ToutiaoLocalCollector.SnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            toutiao = it.toutiao.copy(
                                isSyncing = false,
                                isLoggedIn = false,
                                errorMessage = "未登录 — 请先登录",
                            ),
                        )
                    }
                }
                is ToutiaoLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            toutiao = it.toutiao.copy(
                                isSyncing = false,
                                errorMessage = "采集失败: ${result.reason}",
                            ),
                        )
                    }
                }
                is ToutiaoLocalCollector.SnapshotResult.Ok -> {
                    // v0.1 始终 everythingEmpty=true（无 _signature 签不到读接口）。
                    // 但仍跑 cc syncAdapter 走 vault.applyEvents([])，把 account
                    // 信息持久化进 vault（与 Douyin v0.2 模式同——账号入库即可让
                    // UI 显"已同步账号"，"事件"留 v0.2 _signature 上线后回填）
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-toutiao",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            _state.update {
                                val banner = if (r.report.status != "ok" && r.report.error != null) {
                                    "入库状态: ${r.report.status} (${r.report.error})"
                                } else if (result.v03Attempted &&
                                    (result.readCount + result.collectionCount + result.searchCount) > 0
                                ) {
                                    // v0.3 happy path — bridge worked, counts are real.
                                    "已同步 profile + ${result.readCount} 推荐 / ${result.collectionCount} 收藏 / ${result.searchCount} 搜索"
                                } else if (result.v03Attempted) {
                                    // v0.3 attempted but counts all 0 — bridge warm-up failed
                                    // or acrawler.js rotated (lastErrorCode=-99 from ApiClient).
                                    "已同步账号 profile。v0.3 签名 bridge 未就绪 — 历史/收藏/搜索本次未抓到（代码 ${result.lastErrorCode}），稍后再同步。"
                                } else {
                                    "已同步账号 profile（v0.2 含昵称/头像/粉丝数）。历史/收藏/搜索需 v0.3 _signature 签名接通。"
                                }
                                it.copy(
                                    globalSyncingAdapter = null,
                                    toutiao = it.toutiao.copy(
                                        isSyncing = false,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = banner,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: toutiao cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    toutiao = it.toutiao.copy(
                                        isSyncing = false,
                                        errorMessage = "写入本地数据库失败: ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Phase 7.1.2 — Toutiao Mode B (path B): in-APK root + local SQLite.
     *
     * Coexists with [syncToutiao] (path A, cookies + passport + signed
     * endpoints). Path B reads `/data/data/com.ss.android.article.news/`
     * `databases/` `*.db` files directly via root — no internet, no PC, no
     * signing required.
     *
     * UI single-flight via `globalSyncingAdapter` shared with path A
     * (only one sync per platform at a time). Banner prefix "本机 root:"
     * discriminates from path A banners in the same SocialCardState.
     *
     * Pipeline:
     *   1. globalSyncingAdapter gate
     *   2. credentials store hasCredentials check (uid present)
     *   3. toutiaoRootCollector.snapshot() → LocalSnapshotResult
     *   4. On Ok: ccRunner.syncAdapter("social-toutiao", inputPath=...)
     *   5. Map result variants to errorMessage with "本机 root:" prefix
     */
    fun syncToutiaoRoot() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!toutiaoRootCredentials.hasCredentials()) {
            _state.update {
                it.copy(
                    toutiao = it.toutiao.copy(
                        errorMessage = "本机 root: 请先在路径 A 完成登录 (passport_uid 会自动用作 root uid)",
                    ),
                )
            }
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-toutiao",
                    toutiao = it.toutiao.copy(
                        isSyncing = true,
                        errorMessage = null,
                        syncStatusText = "本机 root: 拷贝 DB cohort...",
                    ),
                )
            }
            val result = toutiaoRootCollector.snapshot()
            when (result) {
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            toutiao = it.toutiao.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: credentials 缺失 — 请先登录头条 App",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoRoot -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            toutiao = it.toutiao.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: 设备未 root — 需 Magisk root 才能读 databases/ 目录",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoDbKey -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            toutiao = it.toutiao.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: db key unavailable (provider=${result.provider})",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.ExtractFailed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            toutiao = it.toutiao.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            toutiao = it.toutiao.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Ok -> {
                    _state.update {
                        it.copy(
                            toutiao = it.toutiao.copy(
                                syncStatusText = "本机 root: 写入金库 (${result.totalEvents} events)...",
                            ),
                        )
                    }
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-toutiao",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            val counts = result.perCategoryCounts
                            val summary = listOfNotNull(
                                counts["read"]?.takeIf { it > 0 }?.let { "$it 历史" },
                                counts["collection"]?.takeIf { it > 0 }?.let { "$it 收藏" },
                                counts["search"]?.takeIf { it > 0 }?.let { "$it 搜索" },
                            ).joinToString(" / ")
                            val banner = if (result.totalEvents == 0) {
                                val dbName = result.diagnosticFields["dbFilename"] ?: "(unknown)"
                                "本机 root: 同步成功但 0 events — DB '$dbName' 表 schema 可能漂移 (P7.1.0 探测待跟)"
                            } else if (r.report.status != "ok" && r.report.error != null) {
                                "本机 root: 入库状态 ${r.report.status} ($summary; ${r.report.error})"
                            } else {
                                "本机 root: 已同步 $summary (total ${result.totalEvents})"
                            }
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    toutiao = it.toutiao.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = banner,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: toutiao root cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    toutiao = it.toutiao.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        errorMessage = "本机 root: 写入金库失败 ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }


    fun logoutToutiao() {
        toutiaoCollector.logout()
        _state.update {
            it.copy(
                toutiao = it.toutiao.copy(
                    isLoggedIn = false,
                    uid = null,
                    lastSyncAt = null,
                    lastSyncCount = 0,
                    errorMessage = null,
                ),
            )
        }
    }

    // ─── Kuaishou 快手 (v0.1 placeholder — 完全对称 Toutiao) ──────────────────
    //
    // 与 Toutiao 唯一差异：cookie uid 字段不同（userId vs passport_uid）。
    // 其他全部 1:1 — 同 placeholder events=[] 策略 + 同 v0.1 honest banner
    // ("watch/collect/search 需 v0.2 NS_sig3 签名接通")。

    fun refreshKuaishouFromStore() {
        val loggedIn = kuaishouCredentials.hasCredentials()
        val uidStr = kuaishouCredentials.getUid()
        val uidLong = uidStr?.toLongOrNull()
        val lastSync = kuaishouCredentials.getLastSyncAt()
        val lastCount = kuaishouCredentials.getLastSyncCount()
        _state.update {
            it.copy(
                kuaishou = it.kuaishou.copy(
                    isLoggedIn = loggedIn,
                    uid = uidLong,
                    lastSyncAt = lastSync,
                    lastSyncCount = lastCount,
                ),
            )
        }
    }

    fun requestKuaishouLogin() {
        _state.update {
            it.copy(
                pendingLogin = LoginRequest(
                    adapterName = "social-kuaishou",
                    displayName = "快手",
                    // 快手 web 主页登录按钮触发 passport.kuaishou.com 弹窗
                    loginUrl = "https://www.kuaishou.com/",
                    cookieDomain = "https://www.kuaishou.com",
                    // 登录后仍在 www.kuaishou.com，cookie 已含 userId。排除
                    // passport / login 中间页避免 cookie 抢跑
                    isLoginSuccess = { url ->
                        url.contains("kuaishou.com") &&
                            !url.contains("passport.") &&
                            !url.contains("/login")
                    },
                    // 快手 web 登录后 cookie 含 userId= 或 passToken=
                    // (userId 是 user id，passToken 是 auth token)
                    isLoginSuccessByCookie = { cookie ->
                        cookie.contains("userId=") ||
                            cookie.contains("passToken=")
                    },
                    userAgent = DESKTOP_CHROME_USER_AGENT,
                ),
            )
        }
    }

    fun onKuaishouLoginCookie(cookie: String) {
        viewModelScope.launch {
            val accepted = kuaishouCollector.acceptLoginCookie(cookie, null)
            _state.update {
                it.copy(
                    pendingLogin = null,
                    kuaishou = it.kuaishou.copy(
                        errorMessage = if (!accepted) {
                            val code = kuaishouCollector.lastLoginErrorCode
                            val detail = kuaishouCollector.lastLoginErrorMessage
                                ?: "cookie 缺 userId"
                            "登录未完成 — code=$code $detail（请确认已登录后重试）"
                        } else null,
                    ),
                )
            }
            if (accepted) refreshKuaishouFromStore()
        }
    }

    fun syncKuaishou() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!_state.value.kuaishou.isLoggedIn) {
            requestKuaishouLogin()
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-kuaishou",
                    kuaishou = it.kuaishou.copy(isSyncing = true, errorMessage = null),
                )
            }
            // v0.3 — wire KuaishouSignBridge for NS_sig3 + kpf/kpn. Same
            // finally-shutdown pattern as Toutiao/Douyin to free the WebView.
            kuaishouCollector.signProvider = kuaishouSignBridge
            val result = try {
                kuaishouCollector.snapshot()
            } finally {
                try {
                    kuaishouSignBridge.shutdown()
                } catch (t: Throwable) {
                    Timber.w(t, "HubLocalViewModel: kuaishouSignBridge.shutdown threw")
                }
            }
            when (result) {
                is KuaishouLocalCollector.SnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            kuaishou = it.kuaishou.copy(
                                isSyncing = false,
                                isLoggedIn = false,
                                errorMessage = "未登录 — 请先登录",
                            ),
                        )
                    }
                }
                is KuaishouLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            kuaishou = it.kuaishou.copy(
                                isSyncing = false,
                                errorMessage = "采集失败: ${result.reason}",
                            ),
                        )
                    }
                }
                is KuaishouLocalCollector.SnapshotResult.Ok -> {
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-kuaishou",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            _state.update {
                                val banner = if (r.report.status != "ok" && r.report.error != null) {
                                    "入库状态: ${r.report.status} (${r.report.error})"
                                } else if (result.v03Attempted &&
                                    (result.watchCount + result.collectCount + result.searchCount) > 0
                                ) {
                                    "已同步 profile + ${result.watchCount} 推荐 / ${result.collectCount} 收藏 / ${result.searchCount} 搜索"
                                } else if (result.v03Attempted) {
                                    "已同步账号 profile。v0.3 签名 bridge 未就绪 — 推荐/收藏/搜索本次未抓到（代码 ${result.lastErrorCode}），稍后再同步。"
                                } else {
                                    "已同步账号 profile（v0.2 含昵称/头像 cookie 解析）。推荐/收藏/搜索需 v0.3 NS_sig3 签名接通。"
                                }
                                it.copy(
                                    globalSyncingAdapter = null,
                                    kuaishou = it.kuaishou.copy(
                                        isSyncing = false,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = banner,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: kuaishou cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    kuaishou = it.kuaishou.copy(
                                        isSyncing = false,
                                        errorMessage = "写入本地数据库失败: ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Phase 7.6.2 — Kuaishou Mode B (path B): in-APK root + local SQLite.
     *
     * Coexists with [syncKuaishou] (path A, cookies + NS_sig3 签名 GraphQL).
     * Path B reads `/data/data/com.smile.gifmaker/databases/` `*.db` files directly
     * via root — no internet, no NS_sig3 signing.
     *
     * **v0.1 期望失败率与 Xhs 并列最高** per plan §6.6: Kuaishou DB 几乎
     * 确定 SQLCipher / 自研加密 + libmsaoaidsec.so 反 frida 极高强度。v0.1
     * ship 是 user-explicit "Mode B 全面 5 平台" override; 真机大概率命中
     * `likely-sqlcipher` banner 跳 v2.0 路径。
     *
     * UI single-flight via `globalSyncingAdapter` shared with path A.
     * Banner prefix "本机 root:" discriminates in the same SocialCardState.
     */
    fun syncKuaishouRoot() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!kuaishouRootCredentials.hasCredentials()) {
            _state.update {
                it.copy(
                    kuaishou = it.kuaishou.copy(
                        errorMessage = "本机 root: 请先在路径 A 完成登录 (uid 会自动用作 root uid)",
                    ),
                )
            }
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-kuaishou",
                    kuaishou = it.kuaishou.copy(
                        isSyncing = true,
                        errorMessage = null,
                        syncStatusText = "本机 root: 拷贝 kwai.db cohort...",
                    ),
                )
            }
            when (val result = kuaishouRootCollector.snapshot()) {
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            kuaishou = it.kuaishou.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: credentials 缺失 — 请先登录快手 App",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoRoot -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            kuaishou = it.kuaishou.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: 设备未 root — 需 Magisk root 才能读 databases/ 目录",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.NoDbKey -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            kuaishou = it.kuaishou.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: db key unavailable (provider=${result.provider})",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.ExtractFailed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            kuaishou = it.kuaishou.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            kuaishou = it.kuaishou.copy(
                                isSyncing = false,
                                syncStatusText = null,
                                errorMessage = "本机 root: ${result.reason}${result.message?.let { " — $it" } ?: ""}",
                            ),
                        )
                    }
                }
                is com.chainlesschain.android.pdh.social.common.LocalSnapshotResult.Ok -> {
                    _state.update {
                        it.copy(
                            kuaishou = it.kuaishou.copy(
                                syncStatusText = "本机 root: 写入金库 (${result.totalEvents} events)...",
                            ),
                        )
                    }
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-kuaishou",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            val counts = result.perCategoryCounts
                            val summary = listOfNotNull(
                                counts["watch"]?.takeIf { it > 0 }?.let { "$it 观看" },
                                counts["collect"]?.takeIf { it > 0 }?.let { "$it 收藏" },
                                counts["search"]?.takeIf { it > 0 }?.let { "$it 搜索" },
                            ).joinToString(" / ")
                            val banner = if (result.totalEvents == 0) {
                                "本机 root: 同步成功但 0 events — kwai.db 表 schema 可能漂移 (P7.6.0 探测待跟)"
                            } else if (r.report.status != "ok" && r.report.error != null) {
                                "本机 root: 入库状态 ${r.report.status} ($summary; ${r.report.error})"
                            } else {
                                "本机 root: 已同步 $summary (total ${result.totalEvents})"
                            }
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    kuaishou = it.kuaishou.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = banner,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: kuaishou root cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    kuaishou = it.kuaishou.copy(
                                        isSyncing = false,
                                        syncStatusText = null,
                                        errorMessage = "本机 root: 写入金库失败 ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    fun logoutKuaishou() {
        kuaishouCollector.logout()
        _state.update {
            it.copy(
                kuaishou = it.kuaishou.copy(
                    isLoggedIn = false,
                    uid = null,
                    lastSyncAt = null,
                    lastSyncCount = 0,
                    errorMessage = null,
                ),
            )
        }
    }

    // ─── WeChat (Phase 12.10) ────────────────────────────────────────────────
    //
    // Onboarding model differs from Bilibili (which is WebView-cookie-based).
    // WeChat needs:
    //   1. User taps "登录" → we show a dialog explaining the root + WeChat-
    //      logged-in prereqs and asks for uin
    //   2. User submits uin → save to store, keyProvider defaults to "frida"
    //      (Phase 12.10.2 will add an env-probe step that picks md5 for 7.x)
    //   3. User taps "同步" → collector orchestrates frida key extract (8.0+)
    //      + db extract + cc syncAdapter
    //
    // For v0.1 the frida + extract steps are stubs; the orchestrator returns
    // FridaInjectFailed("binary-missing") which surfaces as a "改用桌面端"
    // banner. See docs/design/Android_WeChat_InApp_Frida_Collector.md §5.

    fun refreshWechatFromStore() {
        val loggedIn = wechatCredentials.hasCredentials()
        val uin = wechatCredentials.getUin()
        val provider = wechatCredentials.getKeyProvider()
        val lastSync = wechatCredentials.getLastSyncAt()
        val lastCount = wechatCredentials.getLastSyncCount()
        _state.update {
            it.copy(
                wechat = it.wechat.copy(
                    isLoggedIn = loggedIn,
                    uidStr = uin,
                    keyProvider = provider,
                    lastSyncAt = lastSync,
                    lastSyncCount = lastCount,
                ),
            )
        }
    }

    /**
     * User tapped "登录/授权" on the WeChat card → show the uin-entry dialog.
     * The dialog UI (HubLocalScreen) reads `state.wechat.pendingUinEntry`
     * to know whether to render itself.
     */
    fun requestWechatLogin() {
        if (_state.value.globalSyncingAdapter != null) return
        _state.update {
            it.copy(
                wechat = it.wechat.copy(
                    pendingUinEntry = true,
                    errorMessage = null,
                ),
            )
        }
    }

    fun cancelWechatLogin() {
        _state.update {
            it.copy(
                wechat = it.wechat.copy(pendingUinEntry = false),
            )
        }
    }

    /**
     * User submitted uin in the dialog. Persist + close dialog + refresh
     * card state.
     *
     * @param uin User-entered WeChat numeric UIN. Required.
     * @param keyProvider "md5" for 7.x / "frida" for 8.0+. Defaults to
     *                    "frida" since 7.x users are rare in 2026.
     * @param imei Required only when keyProvider="md5" — used by
     *             [com.chainlesschain.android.pdh.social.wechat.WeChatDbExtractor.calculateMd5Key]
     *             (sjqz `wechat_decrypt.py:calculate_wechat_key` parity).
     *             null for "frida" path (key comes from sqlite3_key_v2 hook).
     */
    fun confirmWechatUin(uin: String, keyProvider: String = "frida", imei: String? = null) {
        val trimmed = uin.trim()
        if (trimmed.isBlank()) {
            _state.update {
                it.copy(
                    wechat = it.wechat.copy(
                        errorMessage = "UIN 不能为空",
                    ),
                )
            }
            return
        }
        if (keyProvider == "md5" && (imei.isNullOrBlank() || imei.length != 15)) {
            _state.update {
                it.copy(
                    wechat = it.wechat.copy(
                        errorMessage = "IMEI 必须 15 位（md5 path 需要 MD5(IMEI+UIN)[:7] 派生密钥）",
                    ),
                )
            }
            return
        }
        try {
            wechatCredentials.saveAccount(trimmed, keyProvider, imei?.trim())
        } catch (t: Throwable) {
            Timber.e(t, "HubLocalViewModel: saveWechatAccount failed")
            _state.update {
                it.copy(
                    wechat = it.wechat.copy(
                        errorMessage = "保存账号信息失败: ${t.message}",
                    ),
                )
            }
            return
        }
        _state.update {
            it.copy(
                wechat = it.wechat.copy(pendingUinEntry = false),
            )
        }
        refreshWechatFromStore()
    }

    fun syncWechat() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!_state.value.wechat.isLoggedIn) {
            requestWechatLogin()
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "wechat",
                    wechat = it.wechat.copy(isSyncing = true, errorMessage = null),
                )
            }
            val result = wechatCollector.snapshot()
            when (result) {
                is WeChatLocalCollector.SnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            wechat = it.wechat.copy(
                                isSyncing = false,
                                isLoggedIn = false,
                                errorMessage = "未登录 — 请先登录",
                            ),
                        )
                    }
                }
                is WeChatLocalCollector.SnapshotResult.NoRoot -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            wechat = it.wechat.copy(
                                isSyncing = false,
                                errorMessage = "设备未 root — 改用桌面端 (cc ui + 个人数据中台 + 添加 WeChat)",
                            ),
                        )
                    }
                }
                is WeChatLocalCollector.SnapshotResult.FridaInjectFailed -> {
                    val hint = when (result.reason) {
                        "binary-missing" -> "Frida 二进制未打包（Phase 12.10.4 待落地）— 改用桌面端"
                        "wechat-not-running" -> "WeChat 进程未运行 — 请先打开微信再同步"
                        "hook-timeout" -> "Frida hook 30s 未触发 — 请打开任意聊天后再同步"
                        else -> "Frida 注入失败 (${result.reason}) — 改用桌面端"
                    }
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            wechat = it.wechat.copy(
                                isSyncing = false,
                                errorMessage = hint,
                            ),
                        )
                    }
                }
                is WeChatLocalCollector.SnapshotResult.ExtractFailed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            wechat = it.wechat.copy(
                                isSyncing = false,
                                errorMessage = "数据库提取失败 (${result.reason})" +
                                    (result.message?.let { ": $it" } ?: ""),
                            ),
                        )
                    }
                }
                is WeChatLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            wechat = it.wechat.copy(
                                isSyncing = false,
                                errorMessage = "采集失败: ${result.reason}" +
                                    (result.message?.let { " ($it)" } ?: ""),
                            ),
                        )
                    }
                }
                is WeChatLocalCollector.SnapshotResult.Ok -> {
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "wechat",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    wechat = it.wechat.copy(
                                        isSyncing = false,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = if (r.report.status != "ok" && r.report.error != null) {
                                            "入库状态: ${r.report.status} (${r.report.error})"
                                        } else null,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: wechat cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    wechat = it.wechat.copy(
                                        isSyncing = false,
                                        errorMessage = "写入本地数据库失败: ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    fun logoutWechat() {
        wechatCredentials.clear()
        _state.update {
            it.copy(
                // Reset WeChat-specific fields; keep adapterName/displayName/
                // implemented/requiresUinEntry shape via copy() vs fresh init.
                wechat = it.wechat.copy(
                    isLoggedIn = false,
                    uidStr = null,
                    keyProvider = null,
                    isSyncing = false,
                    lastSyncAt = null,
                    lastSyncCount = 0,
                    errorMessage = null,
                    pendingUinEntry = false,
                ),
            )
        }
    }

    // ─── QQ — Phase 13.5 v0.2 (HubLocal UI wire) ────────────────────────────
    //
    // Mirrors the WeChat actions above (refresh → request → confirm → sync →
    // logout → clearError) but the dialog asks for uin + IMEI (no keyProvider
    // gate — see [QQCredentialsStore] kdoc). [QQLocalCollector.snapshot]
    // returns a sealed result identical in shape to WeChat's minus the
    // FridaInjectFailed branch, so the sync-time `when` is shorter.

    fun refreshQQFromStore() {
        val loggedIn = qqCredentials.hasCredentials()
        val uin = qqCredentials.getUin()
        val lastSync = qqCredentials.getLastSyncAt()
        val lastCount = qqCredentials.getLastSyncCount()
        _state.update {
            it.copy(
                qq = it.qq.copy(
                    isLoggedIn = loggedIn,
                    uin = uin,
                    lastSyncAt = lastSync,
                    lastSyncCount = lastCount,
                ),
            )
        }
    }

    /** User tapped "登录/授权" on the QQ card → show the uin+imei entry dialog. */
    fun requestQQLogin() {
        if (_state.value.globalSyncingAdapter != null) return
        _state.update {
            it.copy(
                qq = it.qq.copy(
                    pendingUinEntry = true,
                    errorMessage = null,
                ),
            )
        }
    }

    fun cancelQQLogin() {
        _state.update {
            it.copy(
                qq = it.qq.copy(pendingUinEntry = false),
            )
        }
    }

    fun clearQQError() {
        _state.update {
            it.copy(
                qq = it.qq.copy(errorMessage = null),
            )
        }
    }

    /**
     * User submitted uin + imei in the QQ login dialog. Persist + close
     * dialog + refresh card state. Validates both fields up-front so a
     * blank IMEI doesn't fall through to a confusing "DB not found" error
     * at sync time.
     *
     * @param uin Numeric QQ uin (digits only).
     * @param imei 15-digit IMEI used as the XOR cycle key for QQ's per-uin
     *             SQLite DB. Required (cannot be omitted like WeChat's md5
     *             path can — IMEI is the *only* key for QQ).
     */
    fun confirmQQUinImei(uin: String, imei: String) {
        val trimmedUin = uin.trim()
        val trimmedImei = imei.trim()
        if (trimmedUin.isBlank() || !trimmedUin.all { it.isDigit() }) {
            _state.update {
                it.copy(
                    qq = it.qq.copy(errorMessage = "UIN 必须是纯数字"),
                )
            }
            return
        }
        if (trimmedImei.length != 15 || !trimmedImei.all { it.isDigit() }) {
            _state.update {
                it.copy(
                    qq = it.qq.copy(
                        errorMessage = "IMEI 必须 15 位数字 (XOR 解密密钥)",
                    ),
                )
            }
            return
        }
        try {
            qqCredentials.saveAccount(trimmedUin, trimmedImei)
        } catch (t: Throwable) {
            Timber.e(t, "HubLocalViewModel: saveQQAccount failed")
            _state.update {
                it.copy(
                    qq = it.qq.copy(errorMessage = "保存账号信息失败: ${t.message}"),
                )
            }
            return
        }
        _state.update {
            it.copy(
                qq = it.qq.copy(pendingUinEntry = false),
            )
        }
        refreshQQFromStore()
    }

    fun syncQQ() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!_state.value.qq.isLoggedIn) {
            requestQQLogin()
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "messaging-qq",
                    qq = it.qq.copy(isSyncing = true, errorMessage = null),
                )
            }
            val result = qqCollector.snapshot()
            when (result) {
                is QQLocalCollector.SnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            qq = it.qq.copy(
                                isSyncing = false,
                                isLoggedIn = false,
                                errorMessage = "未登录 — 请先登录",
                            ),
                        )
                    }
                }
                is QQLocalCollector.SnapshotResult.NoRoot -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            qq = it.qq.copy(
                                isSyncing = false,
                                errorMessage = "设备未 root — 改用桌面端 (cc ui + 个人数据中台 + 添加 QQ)",
                            ),
                        )
                    }
                }
                is QQLocalCollector.SnapshotResult.ExtractFailed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            qq = it.qq.copy(
                                isSyncing = false,
                                errorMessage = "数据库提取失败 (${result.reason})" +
                                    (result.message?.let { ": $it" } ?: ""),
                            ),
                        )
                    }
                }
                is QQLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            qq = it.qq.copy(
                                isSyncing = false,
                                errorMessage = "采集失败: ${result.reason}" +
                                    (result.message?.let { " ($it)" } ?: ""),
                            ),
                        )
                    }
                }
                is QQLocalCollector.SnapshotResult.Ok -> {
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "messaging-qq",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    qq = it.qq.copy(
                                        isSyncing = false,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = if (r.report.status != "ok" && r.report.error != null) {
                                            "入库状态: ${r.report.status} (${r.report.error})"
                                        } else null,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: qq cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    qq = it.qq.copy(
                                        isSyncing = false,
                                        errorMessage = "写入本地数据库失败: ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    fun logoutQQ() {
        qqCredentials.clear()
        _state.update {
            it.copy(
                qq = QQCardState(),
            )
        }
    }

    // ─── Weibo / Douyin / Xiaohongshu — stubs (Task #10) ────────────────────

    fun requestSocialLoginStub(platform: String) {
        val (adapter, name) = when (platform) {
            "weibo" -> "social-weibo" to "微博"
            "douyin" -> "social-douyin" to "抖音"
            "xiaohongshu" -> "social-xiaohongshu" to "小红书"
            else -> return
        }
        // v0.1 stub: surface "尚未实现" on the relevant card without launching
        // WebView; the cookie-auth flow framework is in place (see Bilibili)
        // but per-platform API wiring is a follow-up.
        _state.update {
            when (platform) {
                "weibo" -> it.copy(weibo = it.weibo.copy(errorMessage = "$name 同步 v0.2 开放，敬请期待"))
                "douyin" -> it.copy(douyin = it.douyin.copy(errorMessage = "$name 同步 v0.2 开放，敬请期待"))
                "xiaohongshu" -> it.copy(xiaohongshu = it.xiaohongshu.copy(errorMessage = "$name 同步 v0.2 开放，敬请期待"))
                else -> it
            }
        }
        Timber.i("HubLocalViewModel: %s login stub triggered (adapter=%s)", platform, adapter)
    }

    companion object {
        // First end-to-end win target: cap Weibo cc sync at this many events.
        // Goal is "verify ANY social adapter ingests successfully" — once
        // the user sees ingested=N in the UI we know the entire pipeline
        // (cookie → API → snapshot → cc → vault) works. Profile real-device
        // throughput before raising. See LocalCcRunner.syncAdapter [limit].
        const val WEIBO_FIRST_PASS_LIMIT: Int = 50

        // RAG 上下文预算 — 按 LLM 体量分档。本机小模型 2-4K token 指令跟随窗口
        // 经不起 80 facts 撑 prompt；云大模型 32K+ context，能塞更多召回得更全
        // 答案。LOCAL 与 cc 默认 (80/200) 拉开 4x 差距让小模型留出答案空间。
        const val FACTS_BUDGET_LOCAL: Int = 20
        const val QUERY_LIMIT_BUDGET_LOCAL: Int = 50
        const val FACTS_BUDGET_CLOUD: Int = 80
        const val QUERY_LIMIT_BUDGET_CLOUD: Int = 200

        // Meta-question 短路白名单。归一化形式 = trim + lowercase + 末尾标点剥离
        // (？?。.！!~～)。匹配走 [askDirectLocal]，跳过 cc 子进程 + RAG。新增条目
        // 保持严格匹配整句（不是子串），避免把含数据的问题误判（"你能告诉我上周
        // 妈妈打了几个电话么" 不该命中"你能"）。需要扩展只往这表里加。
        internal val META_QUESTION_WHITELIST: Set<String> = setOf(
            // 身份
            "你是谁", "你是什么", "你叫什么", "你叫啥", "你是啥",
            "你是ai吗", "你是ai", "你是人工智能吗", "你是人工智能",
            "你是机器人吗", "你是机器人", "你是人吗",
            // 问候
            "你好", "你好啊", "您好", "嗨", "嗨你好",
            "在吗", "在不在",
            // 能力
            "你能做什么", "你能干什么", "你能干嘛", "你会什么", "你会干什么",
            "你有什么功能", "你能帮我做什么",
            // 介绍
            "介绍一下你自己", "介绍下你自己", "自我介绍", "介绍你自己",
            // 英文
            "hi", "hello", "hey", "hi there", "hey there", "yo",
            "who are you", "what are you", "what can you do",
            "introduce yourself", "tell me about yourself",
        )

        internal fun isMetaQuestion(raw: String): Boolean {
            val normalized = raw.trim()
                .lowercase(Locale.ROOT)
                .trimEnd('？', '?', '。', '.', '！', '!', '~', '～', ' ')
                .trim()
            return normalized in META_QUESTION_WHITELIST
        }
    }
}
