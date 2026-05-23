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
    // 3 档 LLM 路由 (2026-05-24)：
    //  - androidLlm: null = 用户没在 LLMSettings 配过 cloud key
    //  - selectedRoute = 当前路由；默认 CLOUD_ANDROID（手机端云 LLM 走 Path Y）
    //  - PC_LOCAL 仅当 health.llm.ok && health.llm.isLocal == true 时可选
    //  - 真机验 MediaPipe 端侧效果不佳，端侧路径不连主路由（保留作未来 Settings 离线 fallback）
    val androidLlm: AndroidLocalLlmExecutor.ConfiguredProvider? = null,
    val selectedRoute: LlmRoute = LlmRoute.CLOUD_ANDROID
) {
    /** Android 侧云 LLM 可用：用户在 LLMSettings 配过任一云厂商 API key。 */
    val cloudAvailable: Boolean get() = androidLlm != null

    /** 配对的桌面端在跑本机 LLM (Ollama 等)。`health` 为 null（PC 未配对/health 调用挂掉）时 false。 */
    val pcLocalAvailable: Boolean
        get() = health?.llm?.ok == true && health.llm.isLocal

    /** 用户的当前选择投影到真正可执行的路由；都不可用时返回 selectedRoute（submit 会兜底报错）。 */
    val effectiveRoute: LlmRoute
        get() = when {
            selectedRoute == LlmRoute.PC_LOCAL && pcLocalAvailable -> LlmRoute.PC_LOCAL
            selectedRoute == LlmRoute.CLOUD_ANDROID && cloudAvailable -> LlmRoute.CLOUD_ANDROID
            cloudAvailable -> LlmRoute.CLOUD_ANDROID  // 选了不可用的 PC_LOCAL → 自动回退
            pcLocalAvailable -> LlmRoute.PC_LOCAL    // 选了不可用的 CLOUD_ANDROID → 自动回退
            else -> selectedRoute  // 两条都不可用：UI 应该已显 banner，submit 兜底 errorMessage
        }
}

/** 用户可选的 LLM 推理路由。MediaPipe 端侧（A3）暂不在此 enum，因当前不连主路由。 */
enum class LlmRoute {
    /** 手机端调云 LLM（豆包/DeepSeek/...）走 Path Y：桌面 retrieveContext + Android adapter.chat */
    CLOUD_ANDROID,
    /** 桌面端跑本机 LLM (Ollama)：手机调 hub.ask() 全交桌面处理 */
    PC_LOCAL,
}

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
        _uiState.update { it.copy(androidLlm = configured) }
    }

    /**
     * 用户在 UI 上点切换 LLM 路由。若所选路由当前不可用（如选 PC_LOCAL 但桌面没本机模型），
     * 不会立即报错——`effectiveRoute` 会自动 fallback，submit 时按 effective 路由执行。
     */
    fun setRoute(route: LlmRoute) {
        _uiState.update { it.copy(selectedRoute = route) }
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
        val route = snapshot.effectiveRoute

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

            when (route) {
                LlmRoute.CLOUD_ANDROID -> {
                    val provider = snapshot.androidLlm
                    if (provider != null) {
                        submitViaAndroidLlm(q, provider)
                    } else {
                        // 两路都不可用兜底 — UI banner 应该已经提示，但万一用户绕过：
                        val msg = "请先在「设置」中配置云 LLM API Key，或确保桌面端已配对并启用本机模型"
                        _uiState.update { it.copy(errorMessage = msg) }
                        _events.emit(HubAskEvent.ShowToast(msg))
                    }
                }
                LlmRoute.PC_LOCAL -> submitViaDesktopAsk(q)
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
