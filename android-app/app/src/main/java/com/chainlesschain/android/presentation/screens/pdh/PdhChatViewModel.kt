package com.chainlesschain.android.presentation.screens.pdh

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.di.IoDispatcher
import com.chainlesschain.android.pdh.PdhAgentSession
import com.chainlesschain.android.pdh.PdhAgentSession.FeedbackKind
import com.chainlesschain.android.pdh.PdhAgentSession.PdhAgentEvent
import com.chainlesschain.android.pdh.PdhDataProvenance
import com.chainlesschain.android.pdh.PdhDeviceState
import com.chainlesschain.android.pdh.PdhOnboarding
import com.chainlesschain.android.pdh.PdhPrivacyTier
import com.chainlesschain.android.pdh.PdhResourceBudget
import com.chainlesschain.android.pdh.PdhResultView
import com.chainlesschain.android.pdh.PdhTransaction
import com.chainlesschain.android.pdh.TxnRisk
import com.chainlesschain.android.pdh.ViewKind
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
) : ViewModel() {

    // §3.7: the chat is in-memory; MIUI killing the backgrounded app would lose
    // it. Persist the visible transcript to disk so it survives restart.
    private val historyFile: File
        get() = File(appContext.filesDir, "pdh-chat-history.json")

    // §3.5.19 首跑标志:存在 = onboarding 已完成/跳过 → 以后不再引导(只引导新用户)。
    private val onboardingFlagFile: File
        get() = File(appContext.filesDir, "pdh-onboarding-done")

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

    data class UiState(
        val messages: List<ChatMessage> = emptyList(),
        val streamingText: String = "",
        val isSending: Boolean = false,
        val ready: Boolean = false,
        val error: String? = null,
        /** §3.5.9 内联信任卡(引导/预览/审批/计划),按到达顺序渲染。 */
        val pendingCards: List<TrustCard> = emptyList(),
        /** §3.5.10 顶栏数据流向徽章:这次 AI 在哪跑、数据是否离开手机(透明度优先)。 */
        val privacyBadge: PdhPrivacyTier.TierBadge? = null,
        /** §3.5.19 首跑 onboarding(空态三步);非空=正在引导,取代"已就绪"文案。 */
        val onboarding: Onboarding? = null,
        /** §3.5.20 重活预算提醒(非空=展示提醒卡,等用户「现在就跑」或取消)。 */
        val budgetNotice: BudgetNotice? = null,
        /** 记录搜索关键词(非空时只显示命中行)。 */
        val searchQuery: String = "",
        /** 翻页:默认只显示最近 [PAGE_SIZE] 条,点「加载更早」逐页展开。 */
        val displayLimit: Int = PAGE_SIZE,
    ) {
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

    init {
        viewModelScope.launch {
            // §3.7: restore the persisted transcript first so it survives an app
            // kill/recreate, THEN start the agent. The 已就绪 line is only added for
            // a fresh chat (no restored history) to avoid stacking it each launch.
            // §3.7 restore + §3.5.19 first-run probe in a single IO hop.
            val (restored, onboardingDone) = withContext(ioDispatcher) {
                loadChat() to onboardingFlagFile.exists()
            }
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
                _uiState.update {
                    it.copy(
                        ready = true,
                        // §3.5.10 接线3: surface where this session's LLM runs +
                        // whether data leaves the phone (best-effort; never crash).
                        privacyBadge = runCatching {
                            PdhPrivacyTier.badge(session.currentRoute())
                        }.getOrNull(),
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
        viewModelScope.launch {
            val ok = session.send(text)
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

    /** 预览卡 / 审批卡 的 [确认]/[拒绝] → `{type:approval,id,approve}`。 */
    fun resolveCard(id: String, approve: Boolean) {
        _uiState.update { it.copy(pendingCards = it.pendingCards.filterNot { c -> c.id == id }) }
        viewModelScope.launch { session.sendApproval(id, approve) }
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
