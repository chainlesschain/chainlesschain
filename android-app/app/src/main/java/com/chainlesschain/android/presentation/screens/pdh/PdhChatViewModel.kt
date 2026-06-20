package com.chainlesschain.android.presentation.screens.pdh

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.pdh.PdhAgentSession
import com.chainlesschain.android.pdh.PdhAgentSession.PdhAgentEvent
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
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
) : ViewModel() {

    enum class Role { USER, ASSISTANT, SYSTEM, TOOL }

    data class ChatMessage(
        val id: String = UUID.randomUUID().toString(),
        val role: Role,
        val text: String,
    )

    data class UiState(
        val messages: List<ChatMessage> = emptyList(),
        val streamingText: String = "",
        val isSending: Boolean = false,
        val ready: Boolean = false,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val r = session.start(viewModelScope)
            if (r.isFailure) {
                _uiState.update {
                    it.copy(error = "无法启动本机 AI（cc agent）：${r.exceptionOrNull()?.message ?: "未知"}")
                }
            } else {
                _uiState.update {
                    it.copy(
                        ready = true,
                        messages = it.messages + ChatMessage(
                            role = Role.SYSTEM,
                            text = "本机个人数据助手已就绪。用一句话指挥采集 / 查询 / 分析你的个人数据。",
                        ),
                    )
                }
            }
        }
        viewModelScope.launch {
            session.events.collect { ev -> onEvent(ev) }
        }
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
            )
        }
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

            is PdhAgentEvent.ToolUse ->
                _uiState.update {
                    it.copy(
                        messages = it.messages + ChatMessage(
                            role = Role.TOOL,
                            text = "🔧 调用工具：${ev.name}",
                        ),
                    )
                }

            is PdhAgentEvent.ToolResult -> Unit // result folds into the agent's next text

            is PdhAgentEvent.Result -> _uiState.update {
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

            is PdhAgentEvent.Error -> _uiState.update {
                it.copy(isSending = false, error = ev.message)
            }

            is PdhAgentEvent.Exit -> _uiState.update {
                it.copy(
                    isSending = false,
                    ready = false,
                    error = if (ev.code != 0) "本机 AI 进程已退出（code ${ev.code}）。" else it.error,
                )
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        // Fire-and-forget shutdown; the process is destroyed when the VM dies.
        viewModelScope.launch { session.close() }
    }
}
