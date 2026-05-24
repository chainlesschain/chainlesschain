package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.llm.LlmInferenceEngine
import com.chainlesschain.android.pdh.llm.LlmPreferences
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
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
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
    // 4 档 LLM 路由 (2026-05-24)：
    //  - LOCAL_DEVICE = 端侧 MediaPipe (Qwen2.5-1.5B) — 无 RAG，直答（速度优先）
    //  - CLOUD_ANDROID = 手机端云 LLM 走 Path Y（桌面 retrieveContext + Android adapter.chat）
    //  - PC_LOCAL = 桌面 hub.ask()（桌面 Ollama 本机模型）
    //  - LAN_OLLAMA = 用户自填的 LAN Ollama URL（cc 子进程 ollamaUrl override；走桌面 hub）
    val androidLlm: AndroidLocalLlmExecutor.ConfiguredProvider? = null,
    val lanLlmBaseUrl: String? = null,
    val localDeviceReady: Boolean = false,
    val selectedRoute: LlmRoute = LlmRoute.CLOUD_ANDROID
) {
    /** Android 侧云 LLM 可用：用户在 LLMSettings 配过任一云厂商 API key。 */
    val cloudAvailable: Boolean get() = androidLlm != null

    /** 配对的桌面端在跑本机 LLM (Ollama 等)。`health` 为 null（PC 未配对/health 调用挂掉）时 false。 */
    val pcLocalAvailable: Boolean
        get() = health?.llm?.ok == true && health.llm.isLocal

    /** 端侧 MediaPipe 已就绪（模型下载完 + 引擎可推理）。 */
    val localDeviceAvailable: Boolean get() = localDeviceReady

    /** 用户在 Settings 配过 LAN Ollama URL。 */
    val lanAvailable: Boolean get() = !lanLlmBaseUrl.isNullOrBlank()

    /** 任一路由是否可用 — 都不可用时 UI 显引导 banner，submit 兜底 errorMessage。 */
    val anyRouteAvailable: Boolean
        get() = cloudAvailable || pcLocalAvailable || localDeviceAvailable || lanAvailable

    /**
     * 用户的当前选择投影到真正可执行的路由。fallback 顺序按 "用户最可能配 / 速度感知"：
     *  CLOUD_ANDROID → PC_LOCAL → LAN_OLLAMA → LOCAL_DEVICE → selectedRoute（都没就报错）
     */
    val effectiveRoute: LlmRoute
        get() = when {
            selectedRoute == LlmRoute.LOCAL_DEVICE && localDeviceAvailable -> LlmRoute.LOCAL_DEVICE
            selectedRoute == LlmRoute.LAN_OLLAMA && lanAvailable -> LlmRoute.LAN_OLLAMA
            selectedRoute == LlmRoute.PC_LOCAL && pcLocalAvailable -> LlmRoute.PC_LOCAL
            selectedRoute == LlmRoute.CLOUD_ANDROID && cloudAvailable -> LlmRoute.CLOUD_ANDROID
            cloudAvailable -> LlmRoute.CLOUD_ANDROID
            pcLocalAvailable -> LlmRoute.PC_LOCAL
            lanAvailable -> LlmRoute.LAN_OLLAMA
            localDeviceAvailable -> LlmRoute.LOCAL_DEVICE
            else -> selectedRoute
        }
}

/** 用户可选的 LLM 推理路由。 */
enum class LlmRoute {
    /** 端侧 MediaPipe (Qwen2.5-1.5B) 直接推理，无 RAG —— 飞机模式可用 */
    LOCAL_DEVICE,
    /** 手机端调云 LLM（豆包/DeepSeek/...）走 Path Y：桌面 retrieveContext + Android adapter.chat */
    CLOUD_ANDROID,
    /** 桌面端跑本机 LLM (Ollama)：手机调 hub.ask() 全交桌面处理 */
    PC_LOCAL,
    /** 用户自填 LAN Ollama URL：桌面 cc 子进程注入 CC_HUB_OLLAMA_URL（走桌面 hub.ask --base-url）*/
    LAN_OLLAMA,
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
    private val androidLlmExecutor: AndroidLocalLlmExecutor,
    private val ccRunner: LocalCcRunner,
    private val llmPreferences: LlmPreferences,
    private val llmEngine: LlmInferenceEngine,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        HubAskUiState(
            localDeviceReady = llmEngine.nativeReady,
            lanLlmBaseUrl = llmPreferences.getLanLlmBaseUrl(),
        )
    )
    val uiState: StateFlow<HubAskUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<HubAskEvent>()
    val events: SharedFlow<HubAskEvent> = _events.asSharedFlow()

    init {
        refreshHealth()
        refreshAndroidLlm()
        // Settings 改 LAN URL 时实时同步到本 VM 的 state（route selector subtitle / availability）
        llmPreferences.lanLlmBaseUrl
            .onEach { url -> _uiState.update { it.copy(lanLlmBaseUrl = url) } }
            .launchIn(viewModelScope)
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
                        // 4 路都不可用兜底 — UI banner 应该已经提示，但万一用户绕过：
                        val msg = "请先在「设置」中配置云 LLM API Key、配对桌面、或填写局域网 Ollama URL"
                        _uiState.update { it.copy(errorMessage = msg) }
                        _events.emit(HubAskEvent.ShowToast(msg))
                    }
                }
                LlmRoute.PC_LOCAL -> submitViaDesktopAsk(q)
                LlmRoute.LOCAL_DEVICE -> submitViaLocalDevice(q)
                LlmRoute.LAN_OLLAMA -> submitViaLanOllama(q, snapshot.lanLlmBaseUrl)
            }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    /**
     * LOCAL_DEVICE — 端侧 MediaPipe (Qwen2.5-1.5B) 直接 chat，无 RAG，无桌面参与。
     * 飞机模式可用。citations 必空（没查 vault）。
     */
    private suspend fun submitViaLocalDevice(q: String) {
        try {
            val response = llmEngine.chat(
                messages = listOf(LlmInferenceEngine.ChatMessage(role = "user", content = q))
            )
            _uiState.update {
                it.copy(
                    answer = response.text,
                    citations = emptyList(),
                    llmName = "${llmEngine.name} (端侧)",
                    isLocal = true,
                    errorMessage = null,
                )
            }
        } catch (e: Throwable) {
            Timber.w(e, "HubAskViewModel: llmEngine.chat() failed")
            val msg = e.message ?: "端侧推理失败"
            _uiState.update { it.copy(errorMessage = msg) }
            _events.emit(HubAskEvent.ShowToast(msg))
        }
    }

    /**
     * LAN_OLLAMA — 走 in-APK cc 子进程（写 LAN URL 到 CC_HUB_OLLAMA_URL），让 cc 跑
     * 本机 vault RAG + 远端 Ollama 推理。等价于"本机数据走 LAN LLM"。
     * 数据源是 phone-side vault（与 tab 3 一致），不是桌面 PC。
     */
    private suspend fun submitViaLanOllama(q: String, baseUrl: String?) {
        if (baseUrl.isNullOrBlank()) {
            val msg = "局域网 LLM URL 未配置 — 请到「设置 → AI 后端」填写"
            _uiState.update { it.copy(errorMessage = msg) }
            _events.emit(HubAskEvent.ShowToast(msg))
            return
        }
        val result = ccRunner.askQuestion(
            question = q,
            ollamaUrl = baseUrl,
            acceptNonLocal = true,  // LAN endpoint = non-local LLM by definition
        )
        when (result) {
            is LocalCcRunner.AskResult.Ok -> _uiState.update {
                it.copy(
                    answer = result.report.answer,
                    citations = result.report.citations.map { c -> Citation(eventId = c.eventId) },
                    llmName = "${result.report.llmName ?: "Ollama"} @ LAN",
                    isLocal = false,
                    errorMessage = null,
                )
            }
            is LocalCcRunner.AskResult.Failed -> {
                Timber.w("HubAskViewModel: LAN ask failed reason=%s", result.reason)
                val msg = "局域网 LLM 调用失败：${result.reason}"
                _uiState.update { it.copy(errorMessage = msg) }
                _events.emit(HubAskEvent.ShowToast(msg))
            }
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
