package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AskResult
import com.chainlesschain.android.remote.commands.Citation
import com.chainlesschain.android.remote.commands.EventDetailResponse
import com.chainlesschain.android.remote.commands.HubHealth
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
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
    val activeCitationLoading: Boolean = false
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
    private val hub: PersonalDataHubCommands
) : ViewModel() {

    private val _uiState = MutableStateFlow(HubAskUiState())
    val uiState: StateFlow<HubAskUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<HubAskEvent>()
    val events: SharedFlow<HubAskEvent> = _events.asSharedFlow()

    init {
        refreshHealth()
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

        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoading = true,
                    errorMessage = null,
                    answer = null,
                    citations = emptyList()
                )
            }

            val acceptNonLocal = _uiState.value.acceptNonLocalConfirmed
            hub.ask(question = q, acceptNonLocal = if (acceptNonLocal) true else null)
                .onSuccess { result -> applyAskResult(result) }
                .onFailure { err -> handleAskFailure(q, err) }

            _uiState.update { it.copy(isLoading = false) }
        }
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
                errorMessage = null
            )
        }
    }
}
