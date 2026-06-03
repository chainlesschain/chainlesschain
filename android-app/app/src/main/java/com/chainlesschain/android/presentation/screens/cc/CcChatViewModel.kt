@file:Suppress(
    "TooGenericExceptionCaught",
    "SwallowedException",
    "LongMethod",
)

package com.chainlesschain.android.presentation.screens.cc

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.security.SecurePreferences
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.di.LLMAdapterFactory
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.tools.CcChatEvent
import com.chainlesschain.android.feature.ai.tools.CcChatOrchestrator
import com.chainlesschain.android.feature.ai.tools.ChatStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class CcChatViewModel @Inject constructor(
    private val orchestrator: CcChatOrchestrator,
    private val adapterFactory: LLMAdapterFactory,
    private val securePreferences: SecurePreferences,
) : ViewModel() {

    private val conversationId: String = UUID.randomUUID().toString()

    private val _uiState = MutableStateFlow(CcChatUiState())
    val uiState: StateFlow<CcChatUiState> = _uiState.asStateFlow()

    private var currentAdapter: LLMAdapter? = null
    private var currentJob: Job? = null

    fun setProvider(provider: LLMProvider) {
        viewModelScope.launch {
            try {
                val adapter = createAdapter(provider)
                currentAdapter = adapter
                _uiState.update {
                    it.copy(
                        provider = provider,
                        modelName = defaultModelFor(provider),
                        toolAvailable = adapter.supportsToolUse,
                        error = null,
                    )
                }
            } catch (e: Exception) {
                currentAdapter = null
                _uiState.update {
                    it.copy(
                        provider = provider,
                        toolAvailable = false,
                        error = "Adapter init failed: ${e.message}",
                    )
                }
            }
        }
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return
        val adapter = currentAdapter ?: run {
            _uiState.update { it.copy(error = "Provider not initialized — call setProvider() first") }
            return
        }
        if (currentJob?.isActive == true) {
            _uiState.update { it.copy(error = "A turn is already in flight — wait or cancel first") }
            return
        }

        val historySnapshot: List<Message> = uiStateToHistory(_uiState.value.messages)
        val userMessageId = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()

        _uiState.update {
            it.copy(
                messages = it.messages + CcChatMessage.User(id = userMessageId, text = text, timestamp = now),
                status = ChatStatus.THINKING,
                inputEnabled = false,
                error = null,
            )
        }

        currentJob = viewModelScope.launch {
            try {
                orchestrator.run(
                    userText = text,
                    history = historySnapshot,
                    adapter = adapter,
                    model = _uiState.value.modelName,
                    conversationId = conversationId,
                ).collect { event -> applyEvent(event) }
            } catch (ce: CancellationException) {
                Timber.tag(TAG).i("Turn cancelled by user")
                _uiState.update { it.copy(status = ChatStatus.CANCELLED, inputEnabled = true) }
            } catch (e: Exception) {
                Timber.tag(TAG).e(e, "Turn failed")
                _uiState.update {
                    it.copy(
                        status = ChatStatus.FAILED,
                        inputEnabled = true,
                        error = e.message ?: "Turn failed: ${e::class.simpleName}",
                    )
                }
            }
        }
    }

    fun cancel() { currentJob?.cancel() }

    fun clear() {
        _uiState.update {
            it.copy(messages = emptyList(), status = ChatStatus.COMPLETE, error = null)
        }
    }

    fun clearError() { _uiState.update { it.copy(error = null) } }

    fun toggleToolResultExpansion(toolCallId: String) {
        _uiState.update { state ->
            state.copy(messages = state.messages.map { msg ->
                if (msg is CcChatMessage.ToolCall && msg.toolCallId == toolCallId)
                    msg.copy(expanded = !msg.expanded)
                else msg
            })
        }
    }

    private fun applyEvent(event: CcChatEvent) {
        when (event) {
            is CcChatEvent.StatusChanged -> _uiState.update { it.copy(status = event.status) }

            is CcChatEvent.AssistantTextDelta -> appendAssistantDelta(event.text)

            is CcChatEvent.ToolCallStarted -> _uiState.update { state ->
                state.copy(messages = state.messages + CcChatMessage.ToolCall(
                    id = UUID.randomUUID().toString(),
                    toolCallId = event.toolCallId,
                    command = event.command,
                    subargs = event.subargs,
                    state = CcChatMessage.ToolCall.State.PENDING,
                    timestamp = System.currentTimeMillis(),
                ))
            }

            is CcChatEvent.ToolCallCompleted -> _uiState.update { state ->
                val (exit, dur) = extractExitAndDurationFromResult(event.resultContent)
                state.copy(messages = state.messages.map { msg ->
                    if (msg is CcChatMessage.ToolCall && msg.toolCallId == event.toolCallId) {
                        msg.copy(
                            state = CcChatMessage.ToolCall.State.DONE,
                            exitCode = exit,
                            durationMs = dur,
                            resultContent = event.resultContent,
                        )
                    } else msg
                })
            }

            is CcChatEvent.Completed -> _uiState.update { state ->
                val msgs = state.messages.toMutableList()
                val lastIdx = msgs.indexOfLast { it is CcChatMessage.Assistant }
                if (lastIdx >= 0) {
                    val last = msgs[lastIdx] as CcChatMessage.Assistant
                    if (last.isStreaming) {
                        msgs[lastIdx] = last.copy(
                            text = event.finalText.ifEmpty { last.text },
                            isStreaming = false,
                        )
                    } else if (last.text != event.finalText && event.finalText.isNotEmpty()) {
                        msgs += CcChatMessage.Assistant(
                            id = UUID.randomUUID().toString(),
                            text = event.finalText, isStreaming = false,
                            timestamp = System.currentTimeMillis(),
                        )
                    }
                } else if (event.finalText.isNotEmpty()) {
                    msgs += CcChatMessage.Assistant(
                        id = UUID.randomUUID().toString(),
                        text = event.finalText, isStreaming = false,
                        timestamp = System.currentTimeMillis(),
                    )
                }
                state.copy(messages = msgs, status = ChatStatus.COMPLETE, inputEnabled = true)
            }

            is CcChatEvent.Failed -> _uiState.update {
                it.copy(status = ChatStatus.FAILED, inputEnabled = true, error = event.reason)
            }
        }
    }

    private fun appendAssistantDelta(delta: String) {
        if (delta.isEmpty()) return
        _uiState.update { state ->
            val msgs = state.messages.toMutableList()
            val lastIdx = msgs.lastIndex
            if (lastIdx >= 0 && msgs[lastIdx] is CcChatMessage.Assistant) {
                val last = msgs[lastIdx] as CcChatMessage.Assistant
                if (last.isStreaming) {
                    msgs[lastIdx] = last.copy(text = last.text + delta)
                } else {
                    msgs += CcChatMessage.Assistant(
                        id = UUID.randomUUID().toString(),
                        text = delta, isStreaming = true,
                        timestamp = System.currentTimeMillis(),
                    )
                }
            } else {
                msgs += CcChatMessage.Assistant(
                    id = UUID.randomUUID().toString(),
                    text = delta, isStreaming = true,
                    timestamp = System.currentTimeMillis(),
                )
            }
            state.copy(messages = msgs)
        }
    }

    internal fun uiStateToHistory(messages: List<CcChatMessage>): List<Message> =
        messages.mapNotNull { msg ->
            when (msg) {
                is CcChatMessage.User -> Message(
                    id = msg.id, conversationId = conversationId,
                    role = com.chainlesschain.android.feature.ai.domain.model.MessageRole.USER,
                    content = msg.text, createdAt = msg.timestamp,
                )
                is CcChatMessage.Assistant -> Message(
                    id = msg.id, conversationId = conversationId,
                    role = com.chainlesschain.android.feature.ai.domain.model.MessageRole.ASSISTANT,
                    content = msg.text, createdAt = msg.timestamp,
                )
                is CcChatMessage.ToolCall, is CcChatMessage.System -> null
            }
        }

    internal fun extractExitAndDurationFromResult(content: String): Pair<Int?, Long?> {
        val exit = EXIT_REGEX.find(content)?.groupValues?.get(1)?.toIntOrNull()
        val dur = DURATION_REGEX.find(content)?.groupValues?.get(1)?.toLongOrNull()
        return exit to dur
    }

    private fun createAdapter(provider: LLMProvider): LLMAdapter {
        if (provider == LLMProvider.OLLAMA) {
            return adapterFactory.createAdapter(provider, null)
        }
        val key = when (provider) {
            LLMProvider.OPENAI -> securePreferences.getOpenAIApiKey()
            LLMProvider.DEEPSEEK -> securePreferences.getDeepSeekApiKey()
            else -> securePreferences.getApiKeyForProvider(provider.name)
        }
        require(!key.isNullOrBlank()) { "API key for ${provider.displayName} not configured" }
        return adapterFactory.createAdapter(provider, key)
    }

    private fun defaultModelFor(provider: LLMProvider): String = when (provider) {
        LLMProvider.OPENAI -> "gpt-4o-mini"
        LLMProvider.DEEPSEEK -> "deepseek-chat"
        LLMProvider.CLAUDE -> "claude-3-5-sonnet-20241022"
        LLMProvider.GEMINI -> "gemini-pro"
        LLMProvider.QWEN -> "qwen-max"
        LLMProvider.ERNIE -> "ernie-bot-turbo"
        LLMProvider.CHATGLM -> "glm-4"
        LLMProvider.MOONSHOT -> "moonshot-v1-8k"
        LLMProvider.SPARK -> "spark-v3.5"
        LLMProvider.DOUBAO -> "doubao-seed-1-6-251015"
        LLMProvider.OLLAMA -> "qwen2:7b"
        LLMProvider.CUSTOM -> "custom-model"
    }

    companion object {
        private const val TAG = "CcChatViewModel"
        private val EXIT_REGEX = Regex("""exitCode=(-?\d+)""")
        private val DURATION_REGEX = Regex("""duration=(\d+)ms""")
    }
}
