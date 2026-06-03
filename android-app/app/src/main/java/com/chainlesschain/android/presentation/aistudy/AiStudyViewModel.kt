package com.chainlesschain.android.presentation.aistudy

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

/** AI 陪学 双轨 tab。 */
enum class AiStudyTab { LEARNING, COMPANION }

data class AiStudyUiState(
    val selectedTab: AiStudyTab = AiStudyTab.LEARNING,
    val profile: StudyProfile = StudyProfile(),
    val learningMessages: List<Message> = emptyList(),
    val companionMessages: List<Message> = emptyList(),
    /** 当前正在流式输出的 assistant 文本 (仅 [selectedTab] 且 [isSending] 时展示)。 */
    val streamingText: String = "",
    val isSending: Boolean = false,
    val error: String? = null,
) {
    fun messagesFor(tab: AiStudyTab): List<Message> =
        if (tab == AiStudyTab.LEARNING) learningMessages else companionMessages
}

/**
 * AI 陪学 MVP ViewModel (M6)。
 *
 * - 双轨各自独立的内存态历史；陪伴 tab **不落盘** (退出即清，隐私安全)。
 * - 每次请求 = [system prompt] + 该 tab 历史 + 用户消息，走 [AiStudyLlm] 流式。
 * - 学段/学科/昵称 经 [StudyProfileStore] 持久 (设置性质)。
 *
 * 延后 (非本 MVP)：TEE 加密 vault、RAG 错题本、学情报告、第 2 层护栏分类器、任务联动。
 */
@HiltViewModel
class AiStudyViewModel @Inject constructor(
    private val llm: AiStudyLlm,
    private val profileStore: StudyProfileStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AiStudyUiState(profile = profileStore.profile.value))
    val uiState: StateFlow<AiStudyUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            profileStore.profile.collect { p -> _uiState.update { it.copy(profile = p) } }
        }
    }

    fun selectTab(tab: AiStudyTab) {
        _uiState.update { it.copy(selectedTab = tab, error = null) }
    }

    fun updateProfile(profile: StudyProfile) {
        profileStore.update(profile) // store 的 flow 回灌 uiState.profile
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun send(rawText: String) {
        val content = rawText.trim()
        if (content.isBlank() || _uiState.value.isSending) return

        val tab = _uiState.value.selectedTab
        val profile = _uiState.value.profile
        val conversationId = if (tab == AiStudyTab.LEARNING) CONV_LEARNING else CONV_COMPANION

        val userMessage = Message(
            id = UUID.randomUUID().toString(),
            conversationId = conversationId,
            role = MessageRole.USER,
            content = content,
            createdAt = System.currentTimeMillis(),
        )
        appendMessage(tab, userMessage)

        val systemContent = when (tab) {
            AiStudyTab.LEARNING -> AiStudyPrompts.learningSystemPrompt(profile)
            AiStudyTab.COMPANION -> AiStudyPrompts.companionSystemPrompt(profile.nickname)
        }
        val systemMessage = Message(
            id = UUID.randomUUID().toString(),
            conversationId = conversationId,
            role = MessageRole.SYSTEM,
            content = systemContent,
            createdAt = System.currentTimeMillis(),
        )
        val request = listOf(systemMessage) + _uiState.value.messagesFor(tab)

        _uiState.update { it.copy(isSending = true, streamingText = "", error = null) }

        viewModelScope.launch {
            var full = ""
            llm.stream(request).collect { chunk ->
                if (chunk.error != null) {
                    _uiState.update { it.copy(isSending = false, streamingText = "", error = chunk.error) }
                    return@collect
                }
                full += chunk.content
                _uiState.update { it.copy(streamingText = full) }
                if (chunk.isDone) {
                    val assistant = Message(
                        id = UUID.randomUUID().toString(),
                        conversationId = conversationId,
                        role = MessageRole.ASSISTANT,
                        content = full,
                        createdAt = System.currentTimeMillis(),
                    )
                    appendMessage(tab, assistant)
                    _uiState.update { it.copy(isSending = false, streamingText = "") }
                }
            }
        }
    }

    private fun appendMessage(tab: AiStudyTab, message: Message) {
        _uiState.update {
            if (tab == AiStudyTab.LEARNING) {
                it.copy(learningMessages = it.learningMessages + message)
            } else {
                it.copy(companionMessages = it.companionMessages + message)
            }
        }
    }

    private companion object {
        const val CONV_LEARNING = "ai-study-learning"
        const val CONV_COMPANION = "ai-study-companion"
    }
}
