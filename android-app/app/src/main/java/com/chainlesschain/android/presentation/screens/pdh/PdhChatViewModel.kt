package com.chainlesschain.android.presentation.screens.pdh

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.pdh.PdhAgentSession
import com.chainlesschain.android.pdh.PdhAgentSession.FeedbackKind
import com.chainlesschain.android.pdh.PdhAgentSession.PdhAgentEvent
import com.chainlesschain.android.pdh.PdhDataProvenance
import com.chainlesschain.android.pdh.PdhResultView
import com.chainlesschain.android.pdh.ViewKind
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
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
) : ViewModel() {

    // §3.7: the chat is in-memory; MIUI killing the backgrounded app would lose
    // it. Persist the visible transcript to disk so it survives restart.
    private val historyFile: File
        get() = File(appContext.filesDir, "pdh-chat-history.json")

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
        /** 审批卡:有副作用的写/事务(send_message/make_call/…)。 */
        data class Approve(
            override val id: String,
            val tool: String,
            val summary: String,
            val risk: String?,
        ) : TrustCard()
        /** 计划卡:Plan Mode 当前计划项。 */
        data class Plan(
            override val id: String,
            val items: List<String>,
            val phase: String,
        ) : TrustCard()
    }

    data class UiState(
        val messages: List<ChatMessage> = emptyList(),
        val streamingText: String = "",
        val isSending: Boolean = false,
        val ready: Boolean = false,
        val error: String? = null,
        /** §3.5.9 内联信任卡(引导/预览/审批/计划),按到达顺序渲染。 */
        val pendingCards: List<TrustCard> = emptyList(),
    )

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    /** §3.5.11/§3.5.12: last tool + input → derive its result's provenance / view kind. */
    private var lastToolUse: String? = null
    private var lastToolInput: String? = null

    init {
        viewModelScope.launch {
            // §3.7: restore the persisted transcript first so it survives an app
            // kill/recreate, THEN start the agent. The 已就绪 line is only added for
            // a fresh chat (no restored history) to avoid stacking it each launch.
            val restored = withContext(Dispatchers.IO) { loadChat() }
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
                        messages = if (it.messages.isEmpty()) {
                            it.messages + ChatMessage(
                                role = Role.SYSTEM,
                                text = "本机个人数据助手已就绪。用一句话指挥采集 / 查询 / 分析你的个人数据。",
                            )
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
        viewModelScope.launch(Dispatchers.IO) {
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

            // §3.5.9 trust cards.
            is PdhAgentEvent.ApprovalRequest -> _uiState.update {
                val card = if (isPreviewTool(ev.tool)) {
                    TrustCard.Preview(ev.id, ev.tool, ev.summary, ev.risk)
                } else {
                    TrustCard.Approve(ev.id, ev.tool, ev.summary, ev.risk)
                }
                it.copy(pendingCards = it.pendingCards.filterNot { c -> c.id == ev.id } + card)
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
    }
}
