package com.chainlesschain.android.presentation.screens.pdh

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.di.IoDispatcher
import com.chainlesschain.android.pdh.PdhAgentSession
import com.chainlesschain.android.pdh.PdhAgentSession.FeedbackKind
import com.chainlesschain.android.pdh.PdhAgentSession.PdhAgentEvent
import com.chainlesschain.android.pdh.PdhAssetBackup
import com.chainlesschain.android.pdh.PdhCrossDevice
import com.chainlesschain.android.pdh.PdhDataProvenance
import com.chainlesschain.android.pdh.PdhDeviceState
import com.chainlesschain.android.pdh.PdhLedger
import com.chainlesschain.android.pdh.llm.LlmPreferences
import com.chainlesschain.android.pdh.PdhOnboarding
import com.chainlesschain.android.pdh.PdhPrivacyTier
import com.chainlesschain.android.pdh.PdhResourceBudget
import com.chainlesschain.android.pdh.PdhResultView
import com.chainlesschain.android.pdh.PdhRouteBridge
import com.chainlesschain.android.pdh.PdhTransaction
import com.chainlesschain.android.pdh.PdhTransparency
import com.chainlesschain.android.pdh.TxnRisk
import com.chainlesschain.android.pdh.ViewKind
import com.chainlesschain.android.remote.ui.personalDataHub.LlmRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import javax.inject.Inject

/**
 * Phase 2 (module 101) — drives the single-input-box PDH Chat over a persistent
 * [PdhAgentSession] (`cc agent` stream-json). The agent connects to the App's
 * own PDH bridge so natural-language requests can collect/query the user's
 * personal data via `mcp__pdh__*` tools (after a cc-bundle refresh; chat works
 * regardless).
 */
@HiltViewModel
class PdhChatViewModel @Inject constructor(
    private val session: PdhAgentSession,
    @ApplicationContext private val appContext: Context,
    // @Inject 构造不能写 Kotlin 默认值,故走 @IoDispatcher 限定符(让单测注入测试
    // 调度器,使 init 的文件 IO 在测试 scheduler 上确定性完成)。
    @IoDispatcher private val ioDispatcher: CoroutineDispatcher,
    // §3.5.20: device state (charging/battery/wifi) for the resource-budget gate.
    private val deviceState: PdhDeviceState,
    // §3.5.18: append-only egress/action ledgers (transparency 读写两侧的写持久化)。
    private val ledger: PdhLedger,
    // §3.5.10 接线4: HubAsk route-config source (LAN Ollama URL) for the bridge.
    private val llmPreferences: LlmPreferences,
) : ViewModel() {

    // §3.7: the chat is in-memory; MIUI killing the backgrounded app would lose
    // it. Persist the visible transcript to disk so it survives restart.
    private val historyFile: File
        get() = File(appContext.filesDir, "pdh-chat-history.json")

    // §3.5.19 首跑标志:存在 = onboarding 已完成/跳过 → 以后不再引导(只引导新用户)。
    private val onboardingFlagFile: File
        get() = File(appContext.filesDir, "pdh-onboarding-done")

    // §3.5.10 接线5 上云同意持久标志("本类不再问")。
    private val cloudConsentFlagFile: File
        get() = File(appContext.filesDir, "pdh-cloud-consent")

    enum class Role { USER, ASSISTANT, SYSTEM, TOOL, DATA, VIEW }

    data class ChatMessage(
        val id: String = UUID.randomUUID().toString(),
        val role: Role,
        val text: String,
        // §3.5.11 不可信数据视觉隔离:DATA 行携来源归属 + 折叠态。
        val source: String? = null,
        val untrusted: Boolean = false,
        val collapsed: Boolean = true,
        // §3.5.12 对话内联结果视图:VIEW 行携可信结构化结果的种类。
        val viewKind: ViewKind? = null,
        // §3.5.13 自学习纠正:已对该 ASSISTANT 轮给过的反馈(乐观标记)。
        val feedback: FeedbackKind? = null,
    )

    /**
     * §3.5.9 三类信任卡(+ 计划卡):内联在对话里的信任闸,只在"需人配合/要入库/
     * 有副作用/进入计划"时出现。引导=AssistRequired;预览/审批=ApprovalRequest
     * 按工具名分流;计划=PlanUpdate。回传全走现成 stdin 协议(§3.5.9)。
     */
    sealed class TrustCard {
        abstract val id: String
        /** 引导卡:采集需人在 App 内完成一步(§3.6)。 */
        data class Guide(
            override val id: String,
            val instruction: String,
            val deepLink: String?,
            val resumeToken: String?,
            val reason: String?,
        ) : TrustCard()
        /** 预览卡:数据即将入 vault(collect / index / salvage 类)。 */
        data class Preview(
            override val id: String,
            val tool: String,
            val summary: String,
            val risk: String?,
        ) : TrustCard()
        /** 审批卡:有副作用的写(未归类为事务的其他工具)。 */
        data class Approve(
            override val id: String,
            val tool: String,
            val summary: String,
            val risk: String?,
        ) : TrustCard()
        /**
         * §3.5.17 事务卡:不可逆真实世界副作用(send/call/pay/lifecycle/reminder)。
         * 比普通审批多:风险级(确认强度)/ 可撤销(回执给不给撤销)/ 需确认词(最高
         * 风险)/ 参数来源警示(§7.2 最后一闸:本轮处理过采集数据→提示核对)。
         */
        data class Transaction(
            override val id: String,
            val tool: String,
            val summary: String,
            val risk: TxnRisk,
            val reversible: Boolean,
            val needsConfirmWord: Boolean,
            val sourceWarning: Boolean,
        ) : TrustCard()
        /**
         * §3.5.14 备份卡:把"训练好的个人 AI"(数据+学习层)E2E 加密同步到你的自有
         * 设备。高风险但可逆;显式列出资产范围 + 不上云保证。
         */
        data class Backup(
            override val id: String,
            val summary: String,
            val assets: List<PdhAssetBackup.Asset>,
        ) : TrustCard()
        /**
         * §3.5.14 恢复卡:用备份覆盖/合并本地资产 —— 更高风险,强确认(确认词)+ 凭
         * DID 认领解密 + 冲突不静默覆盖(合并预览是 §8.3/Phase 7 引擎)。
         */
        data class Restore(
            override val id: String,
            val summary: String,
        ) : TrustCard()
        /** 计划卡:Plan Mode 当前计划项。 */
        data class Plan(
            override val id: String,
            val items: List<String>,
            val phase: String,
        ) : TrustCard()
    }

    /**
     * §3.5.19 首跑 onboarding 三步状态(身份 → 选源 → 一键采集)。属空态引导,
     * 不进消息流、不持久化(持久的是"已完成"标志,见 [onboardingFlagFile])。
     */
    data class Onboarding(
        val step: PdhOnboarding.Step,
        val selectedSources: Set<String>,
        val showAdvanced: Boolean = false,
    )

    /**
     * §3.5.20 重活预算提醒(诚实降级,advisory):大批采集前若设备非理想(非充电 /
     * 非 WiFi / 低电)→ 给成本提示 + 推荐时机,由人「现在就跑」或取消。Phase 2 不做
     * 自动排队引擎(§13.2),故**不假称"已排队"**——只提醒 + 即时覆盖。
     */
    data class BudgetNotice(
        val pendingPrompt: String,
        val message: String,
        val costWarning: String?,
    )

    /**
     * §3.5.10 接线5 上云同意:本轮涉及采集数据且 AI 在云端 → 待用户显式同意/取消
     * (默认安全、上限由人掌控,§7.1)。[pendingText] 是被暂缓的那一轮文本。
     */
    data class CloudConsent(val pendingText: String)

    /**
     * §3.5.18 透明度审计视图(读侧):AI 画像(可纠)+ 出境台账 + 操作(行为)台账。
     * 写侧:出境=§3.5.10/16(本类 send 时按档记)、操作=§3.5.17(事务批准时记);
     * 画像源自 instinct/memory(cc/集成层),Phase 2 honest-empty。
     */
    data class Transparency(
        val egress: List<PdhTransparency.EgressEntry>,
        val actions: List<PdhTransparency.ActionEntry>,
        val profile: List<PdhTransparency.ProfileItem>,
    )

    data class UiState(
        val messages: List<ChatMessage> = emptyList(),
        val streamingText: String = "",
        val isSending: Boolean = false,
        val ready: Boolean = false,
        val error: String? = null,
        /** §3.5.9 内联信任卡(引导/预览/审批/计划),按到达顺序渲染。 */
        val pendingCards: List<TrustCard> = emptyList(),
        /** §3.5.10 接线4: 本轮选的隐私档(驱动徽章/出境/同意/per-turn LLM)。 */
        val selectedRoute: LlmRoute = LlmRoute.CLOUD_ANDROID,
        /** §3.5.10 接线4: HubAsk 的 LAN Ollama URL(空=局域网档不可选)。 */
        val lanBaseUrl: String? = null,
        /** §3.5.19 首跑 onboarding(空态三步);非空=正在引导,取代"已就绪"文案。 */
        val onboarding: Onboarding? = null,
        /** §3.5.20 重活预算提醒(非空=展示提醒卡,等用户「现在就跑」或取消)。 */
        val budgetNotice: BudgetNotice? = null,
        /** §3.5.18 透明度审计视图(非空=展示;从本地台账读取)。 */
        val transparency: Transparency? = null,
        /** §3.5.10 接线5 上云同意卡(非空=待用户决定是否把采集数据发往云端)。 */
        val cloudConsent: CloudConsent? = null,
        /** §3.5.16 跨设备:已配对的自有设备(§10 discovery 注入;Phase 2 暂空=仅本机)。 */
        val pairedDevices: List<String> = emptyList(),
        /** §3.5.16 用户选的目标设备(null=本机);经 resolveTarget 落到 [targetDevice]。 */
        val selectedDevice: String? = null,
        /** 记录搜索关键词(非空时只显示命中行)。 */
        val searchQuery: String = "",
        /** 翻页:默认只显示最近 [PAGE_SIZE] 条,点「加载更早」逐页展开。 */
        val displayLimit: Int = PAGE_SIZE,
    ) {
        /**
         * §3.5.16 本轮 effective 目标设备:选本机/未配对 → 本机(诚实不静默驱动陌生
         * 设备);选了已配对设备 → 该设备。真正连远端 bridge 是 §10/Phase 8 传输层。
         */
        val targetDevice: String
            get() = PdhCrossDevice.resolveTarget(selectedDevice, SELF_DEVICE, pairedDevices.toSet())

        /** §3.5.10 接线3: 顶栏数据流向徽章(从当前选档算,随切档实时变)。 */
        val privacyBadge: PdhPrivacyTier.TierBadge
            get() = PdhPrivacyTier.badge(selectedRoute)

        /** §3.5.10 接线4: 对话助手可直驱的档(云常在;局域网需 LAN URL)。 */
        val routeOptions: List<LlmRoute>
            get() = PdhRouteBridge.agentSelectableRoutes(PdhRouteBridge.Config(lanBaseUrl))
        /** 实际渲染的消息:搜索命中(全量过滤) 或 最近 displayLimit 条(翻页窗口)。 */
        val visibleMessages: List<ChatMessage>
            get() = if (searchQuery.isBlank()) {
                if (messages.size <= displayLimit) messages else messages.takeLast(displayLimit)
            } else {
                messages.filter { it.text.contains(searchQuery, ignoreCase = true) }
            }

        /** 还有更早的消息没显示(非搜索态)→ 显示「加载更早」。 */
        val hasOlder: Boolean get() = searchQuery.isBlank() && messages.size > displayLimit
    }

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    /** §3.5.11/§3.5.12: last tool + input → derive its result's provenance / view kind. */
    private var lastToolUse: String? = null
    private var lastToolInput: String? = null

    /** §3.5.20 资源预算(默认保守:省电省流量);预算设置 UI 是后续 seam。 */
    private val budgetSettings = PdhResourceBudget.Settings()

    /** §3.5.10 接线5: cloud-data consent state ("本类不再问" 持久 / 本 session 已问)。 */
    private var cloudConsentGranted = false
    private var cloudConsentAskedThisSession = false

    init {
        viewModelScope.launch {
            // §3.7: restore the persisted transcript first so it survives an app
            // kill/recreate, THEN start the agent. The 已就绪 line is only added for
            // a fresh chat (no restored history) to avoid stacking it each launch.
            // §3.7 restore + §3.5.19 first-run probe + §3.5.10 consent flag in one IO hop.
            val (restored, onboardingDone, consentGranted) = withContext(ioDispatcher) {
                Triple(
                    loadChat(),
                    onboardingFlagFile.exists(),
                    cloudConsentFlagFile.exists(),
                )
            }
            cloudConsentGranted = consentGranted
            // §3.5.19 接线2: only guide NEW users. Fresh chat (no restored history)
            // and onboarding never finished → show the 3-step onboarding instead of
            // the 已就绪 line; returning users go straight to the chat (zero打扰).
            val showOnboarding = restored.isEmpty() && !onboardingDone
            if (restored.isNotEmpty()) _uiState.update { it.copy(messages = restored) }
            val r = session.start(viewModelScope)
            if (r.isFailure) {
                _uiState.update {
                    it.copy(error = "无法启动本机 AI（cc agent）：${r.exceptionOrNull()?.message ?: "未知"}")
                }
            } else {
                // §3.5.10 接线4: initial route = the session's cc-agent LLM (云 by
                // default); LAN URL from HubAsk's config source (best-effort).
                val route = runCatching { session.currentRoute() }.getOrNull()
                    ?: LlmRoute.CLOUD_ANDROID
                val lan = runCatching { llmPreferences.getLanLlmBaseUrl() }.getOrNull()
                _uiState.update {
                    it.copy(
                        ready = true,
                        selectedRoute = route,
                        lanBaseUrl = lan,
                        // §3.5.19: first-run 3-step onboarding (免 root 默认源先出价值).
                        onboarding = if (showOnboarding) {
                            Onboarding(
                                step = PdhOnboarding.Step.IDENTITY,
                                selectedSources = PdhOnboarding.DEFAULT_SOURCES.toSet(),
                            )
                        } else {
                            null
                        },
                        messages = if (it.messages.isEmpty() && !showOnboarding) {
                            it.messages + ChatMessage(role = Role.SYSTEM, text = READY_LINE)
                        } else {
                            it.messages
                        },
                    )
                }
            }
        }
        viewModelScope.launch {
            session.events.collect { ev -> onEvent(ev) }
        }
    }

    /** §3.7: write the visible transcript to disk (best-effort, off the main thread). */
    private fun persistChat() {
        val msgs = _uiState.value.messages
        viewModelScope.launch(ioDispatcher) {
            try {
                val arr = JSONArray()
                for (m in msgs) {
                    if (m.role == Role.SYSTEM) continue // transient 已就绪 line
                    arr.put(
                        JSONObject().apply {
                            put("id", m.id); put("role", m.role.name); put("text", m.text)
                            m.source?.let { put("source", it) }
                            put("untrusted", m.untrusted); put("collapsed", m.collapsed)
                            m.viewKind?.let { put("viewKind", it.name) }
                            m.feedback?.let { put("feedback", it.name) }
                        },
                    )
                }
                historyFile.writeText(arr.toString())
            } catch (_: Throwable) {
                // persistence is best-effort — never crash the chat over it
            }
        }
    }

    /** §3.7: restore the transcript written by [persistChat]; [] on any error. */
    private fun loadChat(): List<ChatMessage> = try {
        if (!historyFile.exists()) {
            emptyList()
        } else {
            val arr = JSONArray(historyFile.readText())
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.getJSONObject(i)
                val role = runCatching { Role.valueOf(o.getString("role")) }.getOrNull()
                    ?: return@mapNotNull null
                ChatMessage(
                    id = o.optString("id").ifEmpty { UUID.randomUUID().toString() },
                    role = role,
                    text = o.optString("text", ""),
                    source = o.optString("source").ifEmpty { null },
                    untrusted = o.optBoolean("untrusted", false),
                    collapsed = o.optBoolean("collapsed", true),
                    viewKind = runCatching {
                        o.optString("viewKind").ifEmpty { null }?.let { ViewKind.valueOf(it) }
                    }.getOrNull(),
                    feedback = runCatching {
                        o.optString("feedback").ifEmpty { null }?.let { FeedbackKind.valueOf(it) }
                    }.getOrNull(),
                )
            }
        }
    } catch (_: Throwable) {
        emptyList()
    }

    fun send(raw: String) {
        val text = raw.trim()
        if (text.isEmpty() || _uiState.value.isSending || !_uiState.value.ready) return
        // §3.5.10 接线5: hold a cloud turn that carries freshly-collected
        // (untrusted) data until the user explicitly consents (默认安全,§7.1).
        if (shouldAskCloudConsent()) {
            _uiState.update { it.copy(cloudConsent = CloudConsent(text)) }
            return
        }
        doSend(text)
    }

    /**
     * §3.5.10 接线5: ask cloud-data consent when this turn would send freshly
     * collected (untrusted) data to a 第三方云 model — unless granted before
     * ("本类不再问") or already asked this session. Detectable signals only
     * (no client-side NL classification, §3.5.4): cloud route × recent DATA.
     */
    private fun shouldAskCloudConsent(): Boolean =
        !cloudConsentGranted &&
            !cloudConsentAskedThisSession &&
            _uiState.value.selectedRoute == LlmRoute.CLOUD_ANDROID &&
            hasUntrustedDataSinceLastUser(_uiState.value.messages)

    /** Actually send a user turn (post-consent). */
    private fun doSend(text: String) {
        _uiState.update {
            it.copy(
                messages = it.messages + ChatMessage(role = Role.USER, text = text),
                isSending = true,
                streamingText = "",
                error = null,
                // A new request supersedes any leftover 引导卡 from a previous turn
                // (e.g. a "登录微博" assist the user didn't complete) — otherwise it
                // lingers under an unrelated new request and looks like THIS request
                // needs that step. No turn is in flight here (isSending was false), so
                // any pending cards are stale.
                pendingCards = emptyList(),
            )
        }
        persistChat()
        recordEgressIfLeaving() // §3.5.18: the turn's text goes to the selected LLM.
        // §3.5.10 接线4/6: route THIS turn to the selected 档's LLM (云=默认不覆盖;
        // 局域网=ollama@LAN). The cc side applies the per-turn override.
        val override = PdhRouteBridge.toLlmOverride(
            _uiState.value.selectedRoute,
            PdhRouteBridge.Config(_uiState.value.lanBaseUrl),
        )
        viewModelScope.launch {
            val ok = session.send(text, override)
            if (!ok) {
                _uiState.update {
                    it.copy(
                        isSending = false,
                        error = "发送失败：会话未运行。",
                    )
                }
            }
        }
    }

    /** §3.5.10 接线5「同意一次」/「本类不再问」→ 放行本轮(remember 记持久偏好)。 */
    fun grantCloudConsent(remember: Boolean) {
        cloudConsentAskedThisSession = true
        if (remember) {
            cloudConsentGranted = true
            viewModelScope.launch(ioDispatcher) {
                runCatching { cloudConsentFlagFile.writeText("1") }
            }
        }
        val pending = _uiState.value.cloudConsent?.pendingText
        _uiState.update { it.copy(cloudConsent = null) }
        if (pending != null) doSend(pending)
    }

    /** §3.5.10 接线5「取消」→ 不出端;诚实告知未完成(端侧模型暂不可用,不假装)。 */
    fun denyCloudConsent() = _uiState.update {
        it.copy(
            cloudConsent = null,
            messages = it.messages + ChatMessage(
                role = Role.SYSTEM,
                text = "已取消:你的数据未发往云端(端侧模型暂不可用,本轮未在不出端前提下完成)。",
            ),
        )
    }

    /**
     * §3.5.18 出境台账:本轮文本去了哪。端侧(LOCAL)不出端→不记;桌面/局域网=自有
     * 设备;云=第三方。诚实:出境就记,绝不隐藏(§13.3)。
     */
    private fun recordEgressIfLeaving() {
        val route = _uiState.value.selectedRoute
        val destination = when (route) {
            LlmRoute.LOCAL_DEVICE -> return // 端侧推理,数据不出手机 → 无出境
            LlmRoute.PC_LOCAL -> "你的桌面(自有设备)"
            LlmRoute.LAN_OLLAMA -> "你的局域网设备(自有)"
            LlmRoute.CLOUD_ANDROID -> "第三方云模型"
        }
        val entry = PdhTransparency.EgressEntry(
            epochMs = System.currentTimeMillis(),
            category = "对话",
            destination = destination,
            tier = PdhPrivacyTier.badge(route).label,
        )
        viewModelScope.launch(ioDispatcher) { ledger.appendEgress(entry) }
    }

    private fun onEvent(ev: PdhAgentEvent) {
        when (ev) {
            is PdhAgentEvent.Text ->
                _uiState.update { it.copy(streamingText = it.streamingText + ev.text) }

            is PdhAgentEvent.ToolUse -> {
                // §3.5.11/§3.5.12: remember tool + input → result provenance / view kind.
                lastToolUse = ev.name
                lastToolInput = ev.input
                _uiState.update {
                    it.copy(
                        messages = it.messages + ChatMessage(
                            role = Role.TOOL,
                            text = "🔧 调用工具：${ev.name}",
                        ),
                    )
                }
            }

            // §3.5.11: a tool's returned content is DATA (被读取的内容,非 AI 判断),
            // not the assistant's words — render it in an isolated 数据引用 row with
            // provenance, instead of dropping it. Empty content stays dropped.
            is PdhAgentEvent.ToolResult -> {
                val content = ev.content.trim()
                if (content.isNotEmpty()) {
                    val kind = PdhResultView.viewKindOf(lastToolUse, lastToolInput)
                    if (kind != null) {
                        // §3.5.12: trusted structured result → 视图卡(not the untrusted DATA quote).
                        _uiState.update {
                            it.copy(
                                messages = it.messages + ChatMessage(
                                    role = Role.VIEW,
                                    text = content,
                                    viewKind = kind,
                                ),
                            )
                        }
                    } else {
                        // §3.5.11: raw tool content → untrusted 数据引用 row.
                        val prov = PdhDataProvenance.sourceOf(lastToolUse)
                        _uiState.update {
                            it.copy(
                                messages = it.messages + ChatMessage(
                                    role = Role.DATA,
                                    text = content,
                                    source = prov.label,
                                    untrusted = prov.untrusted,
                                ),
                            )
                        }
                    }
                }
            }

            // §3.5.9/§3.5.17 trust cards: collect/index/salvage → 预览卡;事务工具
            // (send/call/pay/lifecycle/reminder) → 事务卡(分级 + 来源警示);其余
            // 有副作用工具 → 普通审批卡。
            is PdhAgentEvent.ApprovalRequest -> _uiState.update { st ->
                val card: TrustCard = when {
                    isPreviewTool(ev.tool) -> TrustCard.Preview(ev.id, ev.tool, ev.summary, ev.risk)
                    // §3.5.14 资产备份/恢复 → 专用卡(范围可见 + 不上云 / 强确认)。
                    ev.tool.contains("backup", ignoreCase = true) ->
                        TrustCard.Backup(ev.id, ev.summary, PdhAssetBackup.inventory(emptyMap()))
                    ev.tool.contains("restore", ignoreCase = true) ->
                        TrustCard.Restore(ev.id, ev.summary)
                    PdhTransaction.isTransaction(ev.tool) -> {
                        val risk = PdhTransaction.riskOf(ev.tool, ev.summary)
                        TrustCard.Transaction(
                            id = ev.id,
                            tool = ev.tool,
                            summary = ev.summary,
                            risk = risk,
                            reversible = PdhTransaction.isReversible(ev.tool),
                            needsConfirmWord = PdhTransaction.requiresConfirmWord(risk),
                            // §3.5.17 接线3: 本轮处理过不可信采集数据 → 提示核对(防 injection)。
                            sourceWarning = hasUntrustedDataSinceLastUser(st.messages),
                        )
                    }
                    else -> TrustCard.Approve(ev.id, ev.tool, ev.summary, ev.risk)
                }
                st.copy(pendingCards = st.pendingCards.filterNot { c -> c.id == ev.id } + card)
            }

            is PdhAgentEvent.ApprovalResolved -> _uiState.update {
                it.copy(pendingCards = it.pendingCards.filterNot { c -> c.id == ev.id })
            }

            is PdhAgentEvent.AssistRequired -> _uiState.update {
                val id = ev.resumeToken ?: UUID.randomUUID().toString()
                it.copy(
                    pendingCards = it.pendingCards +
                        TrustCard.Guide(id, ev.instruction, ev.deepLink, ev.resumeToken, ev.reason),
                )
            }

            is PdhAgentEvent.PlanUpdate -> _uiState.update {
                val others = it.pendingCards.filterNot { c -> c is TrustCard.Plan }
                val cards = if (ev.items.isEmpty()) {
                    others
                } else {
                    others + TrustCard.Plan(PLAN_CARD_ID, ev.items, ev.phase)
                }
                it.copy(pendingCards = cards)
            }

            // §3.5.15: cc confirmed the resume → authoritatively dismiss the
            // matching 引导卡 (idempotent; the optimistic remove usually beat it).
            is PdhAgentEvent.ResumeAck -> _uiState.update { st ->
                val token = ev.token
                st.copy(
                    pendingCards = st.pendingCards.filterNot { c ->
                        c is TrustCard.Guide && (token == null || c.resumeToken == token)
                    },
                )
            }

            // §3.5.13: cc confirmed receipt → ensure the 该轮 mark reflects it
            // (idempotent; the optimistic mark usually already set it).
            is PdhAgentEvent.FeedbackAck -> {
                val k = runCatching { FeedbackKind.valueOf(ev.kind.uppercase()) }.getOrNull()
                if (k != null && ev.turnId != null) {
                    _uiState.update { st ->
                        st.copy(
                            messages = st.messages.map { m ->
                                if (m.id == ev.turnId) m.copy(feedback = k) else m
                            },
                        )
                    }
                }
            }

            is PdhAgentEvent.Result -> {
                _uiState.update {
                    val finalText = it.streamingText.ifEmpty { ev.text }
                    val msgs = if (finalText.isNotEmpty()) {
                        it.messages + ChatMessage(role = Role.ASSISTANT, text = finalText)
                    } else {
                        it.messages
                    }
                    it.copy(
                        messages = msgs,
                        streamingText = "",
                        isSending = false,
                        error = if (ev.isError) "本轮以错误结束。" else it.error,
                    )
                }
                persistChat() // §3.7: save the transcript at each turn's end
            }

            is PdhAgentEvent.Error -> _uiState.update {
                it.copy(isSending = false, error = ev.message)
            }

            is PdhAgentEvent.Exit -> _uiState.update {
                it.copy(
                    isSending = false,
                    ready = false,
                    // §3.5.9: no live agent to resolve cards → clear pending.
                    pendingCards = emptyList(),
                    error = if (ev.code != 0) "本机 AI 进程已退出（code ${ev.code}）。" else it.error,
                )
            }
        }
    }

    // ── §3.5.9 card actions (回传走现成 stdin 协议) ──────────────────────────

    /** 预览卡 / 审批卡 / 事务卡 的 [确认]/[拒绝] → `{type:approval,id,approve}`。 */
    fun resolveCard(id: String, approve: Boolean) {
        val card = _uiState.value.pendingCards.firstOrNull { it.id == id }
        _uiState.update { it.copy(pendingCards = it.pendingCards.filterNot { c -> c.id == id }) }
        // §3.5.18 接线: an approved transaction is a real behavior → 操作台账。
        if (approve && card is TrustCard.Transaction) recordAction(card)
        viewModelScope.launch { session.sendApproval(id, approve) }
    }

    /** §3.5.18 操作台账:记录"AI 替你办过的事务"(批准=已发起;执行结果在对话里)。 */
    private fun recordAction(card: TrustCard.Transaction) {
        val entry = PdhTransparency.ActionEntry(
            epochMs = System.currentTimeMillis(),
            action = card.tool,
            target = card.summary,
            result = "已批准发起", // 真实执行结果是 cc/FAMILY 侧(§4),此处记审批已发起
            approvedBy = "你",
        )
        viewModelScope.launch(ioDispatcher) { ledger.appendAction(entry) }
    }

    /**
     * 引导卡「我已完成」→ 让 agent 继续(§3.5.9 占位:发续跑 user turn;§3.5.15
     * 将升级为带 resumeToken 的结构化 resume)。
     */
    fun completeGuide(id: String) = resumeGuide(id, "completed")

    /** 引导卡「跳过」→ 让 agent 跳过该源、继续其余。 */
    fun skipGuide(id: String) = resumeGuide(id, "skip")

    /**
     * §3.5.15 结构化续跑:有 resumeToken → 发 `{type:resume,token,action}`(cc 凭 token
     * 重调 assist_required 工具,确定性);无 token → 退回 §3.5.9 的 user-turn 提示。
     */
    private fun resumeGuide(id: String, action: String) {
        val card = _uiState.value.pendingCards.firstOrNull { it.id == id } as? TrustCard.Guide ?: return
        // Optimistic dismissal for a snappy UI; cc's resume_ack confirms it
        // (idempotent). If the send fails the card is restored so the step is
        // never silently dropped (§3.5.15 honest-degradation).
        _uiState.update { it.copy(pendingCards = it.pendingCards.filterNot { c -> c.id == id }) }
        val token = card.resumeToken
        viewModelScope.launch {
            val ok = if (token != null) {
                session.sendResume(token, action)
            } else {
                session.send(
                    if (action == "completed") "我已完成上一步,请继续。" else "跳过这一步,继续其余部分。",
                )
            }
            if (!ok) {
                _uiState.update {
                    if (it.pendingCards.any { c -> c.id == id }) {
                        it.copy(error = "续跑发送失败：会话未运行。")
                    } else {
                        it.copy(
                            pendingCards = it.pendingCards + card,
                            error = "续跑发送失败：会话未运行。",
                        )
                    }
                }
            }
        }
    }

    /** 计划卡 → `{type:plan,action}`(`approve`|`reject`|`enter`)。 */
    fun resolvePlan(action: String) {
        _uiState.update { it.copy(pendingCards = it.pendingCards.filterNot { c -> c is TrustCard.Plan }) }
        viewModelScope.launch { session.sendPlan(action) }
    }

    // ── §3.5.13 自学习纠正回路:UI 捕获 → 喂端侧学习层(cc 侧消费) ──────────

    /** 对某 ASSISTANT 轮点赞(正反馈)。 */
    fun thumbUp(messageId: String) = submitFeedback(messageId, FeedbackKind.POSITIVE, null)

    /** 对某 ASSISTANT 轮点踩(负反馈)。 */
    fun thumbDown(messageId: String) = submitFeedback(messageId, FeedbackKind.NEGATIVE, null)

    /** 对某 ASSISTANT 轮提交文字纠正(ground truth)。 */
    fun submitCorrection(messageId: String, text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        submitFeedback(messageId, FeedbackKind.CORRECTION, t)
    }

    private fun submitFeedback(messageId: String, kind: FeedbackKind, comment: String?) {
        // 乐观标记该轮已反馈;cc 侧消费 {type:feedback} 并经 feedback_ack 确认 +
        // 持久化到跨 session 学习台账。发送失败则回退标记(诚实降级)。
        _uiState.update {
            it.copy(
                messages = it.messages.map { m ->
                    if (m.id == messageId) m.copy(feedback = kind) else m
                },
            )
        }
        viewModelScope.launch {
            val ok = session.sendFeedback(messageId, kind, comment)
            if (!ok) {
                _uiState.update {
                    it.copy(
                        messages = it.messages.map { m ->
                            if (m.id == messageId) m.copy(feedback = null) else m
                        },
                        error = "反馈发送失败：会话未运行。",
                    )
                }
            }
        }
    }

    /** §3.5.11 数据引用行的展开/折叠。 */
    fun toggleCollapse(id: String) {
        _uiState.update {
            it.copy(
                messages = it.messages.map { m ->
                    if (m.id == id && (m.role == Role.DATA || m.role == Role.VIEW)) {
                        m.copy(collapsed = !m.collapsed)
                    } else {
                        m
                    }
                },
            )
        }
    }

    /** 记录搜索:设关键词(非空只显示命中行;空=恢复正常翻页视图)。 */
    fun setSearch(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    /** 翻页:多显示一页更早的消息。 */
    fun loadMore() {
        _uiState.update { it.copy(displayLimit = it.displayLimit + PAGE_SIZE) }
    }

    // ── §3.5.19 首跑 onboarding 三步动作 ────────────────────────────────────

    /** ①身份/②选源 的「继续」→ 下一步(COLLECT 由 [onboardingStartCollect] 收尾)。 */
    fun onboardingNext() = _uiState.update { st ->
        val ob = st.onboarding ?: return@update st
        val next = PdhOnboarding.nextStep(ob.step) ?: return@update st
        st.copy(onboarding = ob.copy(step = next))
    }

    /** ②选源:勾选/取消一个数据来源(每源显式同意,§3.5.19 不偷采)。 */
    fun onboardingToggleSource(source: String) = _uiState.update { st ->
        val ob = st.onboarding ?: return@update st
        val sel = if (source in ob.selectedSources) {
            ob.selectedSources - source
        } else {
            ob.selectedSources + source
        }
        st.copy(onboarding = ob.copy(selectedSources = sel))
    }

    /** ②选源:展开/收起「高级来源」(root/登录,默认折叠不吓退普通用户)。 */
    fun onboardingToggleAdvanced() = _uiState.update { st ->
        val ob = st.onboarding ?: return@update st
        st.copy(onboarding = ob.copy(showAdvanced = !ob.showAdvanced))
    }

    /** 任意步「跳过」→ 结束引导、进正常对话(补一条已就绪文案)。 */
    fun onboardingSkip() = finishOnboarding(addReadyLine = true)

    /**
     * §3.5.19 接线4: ③一键采集 → 把选中源拼成一句话发给常驻 agent(复用现成
     * [send] 管线;采集结果/全貌经现成 §3.5.12 视图卡回显)。无选中源 → no-op。
     */
    fun onboardingStartCollect() {
        val ob = _uiState.value.onboarding ?: return
        val prompt = PdhOnboarding.collectPrompt(ob.selectedSources)
        if (prompt.isBlank()) return
        finishOnboarding(addReadyLine = false)
        startHeavyCollect(prompt)
    }

    /**
     * §3.5.20 接线1: route a bulk first-collect through the resource budget. On an
     * ideal device (充电+WiFi) run immediately; otherwise surface an advisory
     * [BudgetNotice] (cost + recommended timing) with a「现在就跑」override — never
     * silently burn battery/data, never fake an auto-queue (no engine yet, §13.2).
     */
    private fun startHeavyCollect(prompt: String) {
        val device = deviceState.read()
        val decision = PdhResourceBudget.decide(
            PdhResourceBudget.weightOf("bulk_collect"), device, budgetSettings,
        )
        if (!decision.deferred) {
            send(prompt)
            return
        }
        _uiState.update {
            it.copy(
                budgetNotice = BudgetNotice(
                    pendingPrompt = prompt,
                    message = decision.reason,
                    costWarning = PdhResourceBudget.forceRunWarning(device, budgetSettings),
                ),
            )
        }
    }

    /** §3.5.20「现在就跑」:覆盖预算建议,立即采集(成本已在卡上明示)。 */
    fun runCollectNow() {
        val notice = _uiState.value.budgetNotice ?: return
        _uiState.update { it.copy(budgetNotice = null) }
        send(notice.pendingPrompt)
    }

    /** §3.5.20「取消」:撤下预算提醒,不采集(诚实:无引擎,不排队、不假装完成)。 */
    fun dismissBudgetNotice() = _uiState.update { it.copy(budgetNotice = null) }

    // ── §3.5.18 透明度审计视图(读侧)──────────────────────────────────────

    /**
     * 打开透明度视图:从本地台账读出境/操作记录(端侧、不出端)。AI 画像源自
     * instinct/memory(cc/集成层),Phase 2 honest-empty——如实显示"还没学到",
     * 不美化、不隐藏(§13.3)。
     */
    fun openTransparency() {
        viewModelScope.launch {
            val (egress, actions) = withContext(ioDispatcher) {
                ledger.readEgress() to ledger.readActions()
            }
            _uiState.update {
                it.copy(
                    transparency = Transparency(
                        egress = PdhTransparency.filterEgress(egress),
                        actions = PdhTransparency.filterActions(actions),
                        profile = emptyList(),
                    ),
                )
            }
        }
    }

    /** 关闭透明度视图。 */
    fun closeTransparency() = _uiState.update { it.copy(transparency = null) }

    /**
     * §3.5.18 接线4 / §3.5.13: 画像条「这条不对/改」→ 经 FeedbackSignal 喂端侧学习层
     * (人=最权威标注者)。画像条目源(instinct/memory)落地前是 seam;复用纠正通道。
     */
    fun correctProfileItem(itemId: String, correction: String) =
        submitFeedback(itemId, FeedbackKind.CORRECTION, correction)

    // ── §3.5.16 跨设备:目标设备选择(指挥另一台你自有设备)──────────────────

    /**
     * 选目标设备(null/本机=本机)。Phase 2 真正连远端 bridge 的传输是 §10/Phase 8;
     * 本动作只落选择 + 经 resolveTarget 校验(未配对→回退本机,诚实不驱动陌生设备)。
     */
    fun setTargetDevice(deviceId: String?) = _uiState.update {
        it.copy(selectedDevice = if (deviceId == SELF_DEVICE) null else deviceId)
    }

    /** §10 device discovery 注入已配对的自有设备列表(seam;Phase 2 暂无来源=仅本机)。 */
    fun setPairedDevices(devices: List<String>) = _uiState.update {
        it.copy(pairedDevices = devices)
    }

    // ── §3.5.10 接线4: 隐私档位选择(驱动徽章/出境/同意/per-turn LLM)──────────

    /**
     * 选隐私档(仅对话助手可直驱的档:云/局域网);未配 LAN 时选局域网会被忽略
     * (诚实:无 LAN URL 不假装可路由)。切档实时反映在徽章,并作用到后续每轮。
     */
    fun setRoute(route: LlmRoute) = _uiState.update {
        if (PdhRouteBridge.isAgentSelectable(route, PdhRouteBridge.Config(it.lanBaseUrl))) {
            it.copy(selectedRoute = route)
        } else {
            it
        }
    }

    /** 结束 onboarding:落"已完成"标志(不再引导)+ 清面板;可选补已就绪文案。 */
    private fun finishOnboarding(addReadyLine: Boolean) {
        viewModelScope.launch(ioDispatcher) {
            runCatching { onboardingFlagFile.writeText("1") }
        }
        _uiState.update {
            it.copy(
                onboarding = null,
                messages = if (addReadyLine && it.messages.isEmpty()) {
                    it.messages + ChatMessage(role = Role.SYSTEM, text = READY_LINE)
                } else {
                    it.messages
                },
            )
        }
    }

    /** 工具名分流:采集/索引/打捞(写 vault)→ 预览卡;其余有副作用 → 审批卡。 */
    private fun isPreviewTool(tool: String): Boolean =
        tool.contains("collect", ignoreCase = true) ||
            tool.contains("index", ignoreCase = true) ||
            tool.contains("salvage", ignoreCase = true)

    override fun onCleared() {
        super.onCleared()
        // Fire-and-forget shutdown; the process is destroyed when the VM dies.
        viewModelScope.launch { session.close() }
    }

    companion object {
        /** 单张计划卡的固定 id(plan_update 到来时更新同一张)。 */
        private const val PLAN_CARD_ID = "__plan__"

        /** 翻页每页消息数。 */
        const val PAGE_SIZE = 50

        /** 空态/结束 onboarding 后的已就绪提示文案。 */
        private const val READY_LINE =
            "本机个人数据助手已就绪。用一句话指挥采集 / 查询 / 分析你的个人数据。"

        /** §3.5.16 本机设备标识(目标设备默认值)。 */
        const val SELF_DEVICE = "本机"

        /**
         * §3.5.17 接线3 (pure): 本轮(上一个 USER turn 之后)是否出现过不可信采集
         * 数据(§3.5.11 的 DATA)。事务卡据此提示核对收件人/内容是你的本意——把人
         * 钉成 prompt injection 触发副作用的最后一闸(§7.2)。
         */
        fun hasUntrustedDataSinceLastUser(messages: List<ChatMessage>): Boolean {
            val lastUser = messages.indexOfLast { it.role == Role.USER }
            val after = if (lastUser >= 0) messages.subList(lastUser + 1, messages.size) else messages
            return after.any { it.role == Role.DATA && it.untrusted }
        }
    }
}
