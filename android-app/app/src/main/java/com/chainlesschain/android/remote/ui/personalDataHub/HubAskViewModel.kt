package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AskResult
import com.chainlesschain.android.remote.commands.Citation
import com.chainlesschain.android.remote.commands.EventDetailResponse
import com.chainlesschain.android.remote.commands.HubHealth
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import com.chainlesschain.android.remote.commands.RetrieveContextResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@Immutable
data class HubAskUiState(
    val question: String = "",
    val isLoading: Boolean = false,
    val answer: String? = null,
    val citations: List<Citation> = emptyList(),
    val llmName: String? = null,
    val isLocal: Boolean = true,
    val errorMessage: String? = null,
    val acceptNonLocalConfirmed: Boolean = false,
    val health: HubHealth? = null,
    val showAcceptNonLocalDialog: Boolean = false,
    val pendingNonLocalQuestion: String? = null,
    val activeCitationDetail: EventDetailResponse? = null,
    val activeCitationLoading: Boolean = false,
    // Phase 14.1 step 5 (ChatBubble UI) — 提交时刻的问题快照，与 `question` (input field 实时内容)
    // 分离，让答案 bubble 可以独立显示历史问题；input field 清空 / 续打字时 bubble 仍在屏。
    val submittedQuestion: String? = null,
    // Path Y — 本机 LLM 推理（过渡期方案）。
    //  - androidLlm: null = 用户没在 LLMSettings 配过 cloud key，toggle 应灰掉
    //  - useAndroidLlm = true → submit 走 retrieveContext + 本机 adapter.chat()，
    //    跳过桌面隐私 gate（因桌面侧没调用 LLM），返回的 isLocal=false 用作 UI 提示
    val androidLlm: AndroidLocalLlmExecutor.ConfiguredProvider? = null,
    val useAndroidLlm: Boolean = false
)

sealed class HubAskEvent {
    data class ShowToast(val message: String) : HubAskEvent()
}

/**
 * Phase 14.1 — HubAskScreen 主 ViewModel
 *
 * 责任：
 *  - 用户输入问题 → 调 PersonalDataHubCommands.ask → 渲染答案 + citation chip
 *  - 隐私 gate：桌面 LLM 非本地时，第一次提问拒绝 + 触发 AcceptNonLocalDialog；
 *    用户同意后第二次提问携 acceptNonLocal=true 重发
 *  - Citation chip 点击 → 调 eventDetail 拉详情 → bottom sheet 展示
 *  - 首次进入加载 health 卡片状态（vault / llm / kg / rag 四件套）
 */
@HiltViewModel
class HubAskViewModel @Inject constructor(
    private val hub: PersonalDataHubCommands,
    private val androidLlmExecutor: AndroidLocalLlmExecutor
) : ViewModel() {

    private val _uiState = MutableStateFlow(HubAskUiState())
    val uiState: StateFlow<HubAskUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<HubAskEvent>()
    val events: SharedFlow<HubAskEvent> = _events.asSharedFlow()

    init {
        refreshHealth()
        refreshAndroidLlm()
    }

    /**
     * 探一次安卓本机已配的云 LLM。结果存到 [HubAskUiState.androidLlm]，UI 据此
     * 决定是否亮"本机推理" toggle。每次首次进入屏幕跑一次；用户在 LLMSettings
     * 配完 key 回到此屏，可手动触发 [refreshAndroidLlm] 重测。
     */
    fun refreshAndroidLlm() {
        val configured = try {
            androidLlmExecutor.detectProvider()
        } catch (e: Throwable) {
            Timber.w(e, "HubAskViewModel: detectProvider() failed")
            null
        }
        _uiState.update {
            it.copy(
                androidLlm = configured,
                // 用户上次 toggle 过但又把所有 key 删了 → 自动回退到 false
                useAndroidLlm = it.useAndroidLlm && configured != null
            )
        }
    }

    fun setUseAndroidLlm(enabled: Boolean) {
        _uiState.update {
            it.copy(useAndroidLlm = enabled && it.androidLlm != null)
        }
    }

    fun onQuestionChange(value: String) {
        _uiState.update { it.copy(question = value, errorMessage = null) }
    }

    fun refreshHealth() {
        viewModelScope.launch {
            hub.health()
                .onSuccess { result ->
                    _uiState.update { it.copy(health = result) }
                }
                .onFailure { err ->
                    Timber.w(err, "HubAskViewModel: health() failed")
                }
        }
    }

    fun submit() {
        val q = _uiState.value.question.trim()
        if (q.isEmpty()) return
        if (_uiState.value.isLoading) return

        val snapshot = _uiState.value
        val useY = snapshot.useAndroidLlm && snapshot.androidLlm != null

        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoading = true,
                    errorMessage = null,
                    answer = null,
                    citations = emptyList(),
                    submittedQuestion = q
                )
            }

            if (useY) {
                submitViaAndroidLlm(q, snapshot.androidLlm!!)
            } else {
                submitViaDesktopAsk(q)
            }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    private suspend fun submitViaDesktopAsk(q: String) {
        val acceptNonLocal = _uiState.value.acceptNonLocalConfirmed
        hub.ask(question = q, acceptNonLocal = if (acceptNonLocal) true else null)
            .onSuccess { result -> applyAskResult(result) }
            .onFailure { err -> handleAskFailure(q, err) }
    }

    /**
     * Path Y — 桌面只返 prompt context，安卓侧调本机 cloud adapter 跑推理。
     *
     * 失败模式：
     *  - retrieveContext 失败 → handleAskFailure 走原桌面错误路径（含 dialog
     *    fallback，虽然 retrieveContext 不该触发 acceptNonLocal 阻塞——但桌面如果
     *    AnalysisEngine 没初始化也会回 error）
     *  - 安卓 adapter.chat() 失败 → 直接 errorMessage + toast，不走 dialog
     */
    private suspend fun submitViaAndroidLlm(
        q: String,
        configured: AndroidLocalLlmExecutor.ConfiguredProvider
    ) {
        val ctxResult = hub.retrieveContext(q)
        val ctx = ctxResult.getOrElse {
            handleAskFailure(q, it)
            return
        }

        val answerText: String = try {
            androidLlmExecutor.chat(ctx.messages, configured)
        } catch (e: Throwable) {
            Timber.w(e, "HubAskViewModel: androidLlmExecutor.chat() failed")
            val msg = e.message ?: "本机 LLM 推理失败"
            _uiState.update { it.copy(errorMessage = msg) }
            _events.emit(HubAskEvent.ShowToast(msg))
            return
        }

        val citations = extractCitations(answerText, ctx)
        _uiState.update {
            it.copy(
                answer = answerText,
                citations = citations,
                llmName = "${configured.provider.displayName} · ${configured.model}",
                // Y 路径用的是云 LLM，对外仍然不是本地推理；UI 据此显示"非本地"标
                isLocal = false,
                errorMessage = null
            )
        }
    }

    /**
     * 从 LLM 回答中抓 `[evt-xxx]` 形式的 citation token，与 retrieveContext 拿回
     * 的 factIds 交集 — 已知则保留，未知静默丢（v0.1 不显式标记 hallucination
     * 给用户，与 ask() 走桌面侧时的展示一致）。
     */
    private fun extractCitations(answer: String, ctx: RetrieveContextResult): List<Citation> {
        if (ctx.factIds.isEmpty()) return emptyList()
        val known = ctx.factIds.toSet()
        // 形如 [evt-abc123] / [event-id] / [任意 id token]。
        val tokens = CITATION_RE.findAll(answer)
            .map { it.groupValues[1] }
            .toSet()
        return tokens
            .filter { it in known }
            .map { Citation(eventId = it) }
    }

    private fun applyAskResult(result: AskResult) {
        _uiState.update {
            it.copy(
                answer = result.answer,
                citations = result.citations,
                llmName = result.llmName,
                isLocal = result.isLocal,
                errorMessage = null
            )
        }
    }

    private suspend fun handleAskFailure(question: String, err: Throwable) {
        val message = err.message ?: "未知错误"
        // Desktop returns `{ error: "Non-local LLM blocked — pass options.acceptNonLocal=true ..." }`
        // → throws here. Detect substring and surface dialog rather than just printing the error.
        val nonLocalBlocked = message.contains("Non-local LLM", ignoreCase = true) ||
            message.contains("acceptNonLocal", ignoreCase = true)
        if (nonLocalBlocked && !_uiState.value.acceptNonLocalConfirmed) {
            _uiState.update {
                it.copy(
                    showAcceptNonLocalDialog = true,
                    pendingNonLocalQuestion = question,
                    errorMessage = null
                )
            }
        } else {
            _uiState.update { it.copy(errorMessage = message) }
            _events.emit(HubAskEvent.ShowToast(message))
        }
    }

    fun acceptNonLocalAndRetry() {
        val pending = _uiState.value.pendingNonLocalQuestion ?: return
        _uiState.update {
            it.copy(
                acceptNonLocalConfirmed = true,
                showAcceptNonLocalDialog = false,
                pendingNonLocalQuestion = null,
                question = pending
            )
        }
        submit()
    }

    fun dismissAcceptNonLocalDialog() {
        _uiState.update {
            it.copy(
                showAcceptNonLocalDialog = false,
                pendingNonLocalQuestion = null
            )
        }
    }

    fun openCitation(eventId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(activeCitationLoading = true, activeCitationDetail = null) }
            hub.eventDetail(eventId)
                .onSuccess { detail ->
                    _uiState.update {
                        it.copy(activeCitationDetail = detail, activeCitationLoading = false)
                    }
                }
                .onFailure { err ->
                    Timber.w(err, "HubAskViewModel: eventDetail($eventId) failed")
                    _uiState.update { it.copy(activeCitationLoading = false) }
                    _events.emit(HubAskEvent.ShowToast("无法加载事件详情: ${err.message ?: "?"}"))
                }
        }
    }

    fun closeCitation() {
        _uiState.update { it.copy(activeCitationDetail = null, activeCitationLoading = false) }
    }

    fun clear() {
        _uiState.update {
            it.copy(
                question = "",
                answer = null,
                citations = emptyList(),
                errorMessage = null,
                submittedQuestion = null
            )
        }
    }

    companion object {
        // `[token]` 形式 citation；token 允许字母数字 + `-` `_`，至少 2 字符避免误匹配
        // 单字符方括号。AnalysisEngine 桌面侧 prompt-builder.parseCitations 已用同款
        // 模式，这里前后保持一致。
        private val CITATION_RE = Regex("""\[([A-Za-z0-9_-]{2,})]""")
    }
}
