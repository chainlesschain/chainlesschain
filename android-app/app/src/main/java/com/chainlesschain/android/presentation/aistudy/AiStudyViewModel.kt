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
 * 已接：错题本 RAG (学习 tab)、第 2 层端侧护栏 (post-hoc 记事件类型+时间)、学情报告生成。
 * 延后 (设备相关)：TEE 加密 vault 持久化、M5 任务联动、真机 E2E。
 */
@HiltViewModel
class AiStudyViewModel @Inject constructor(
    private val llm: AiStudyLlm,
    private val profileStore: StudyProfileStore,
    private val mistakeBook: MistakeBook,
    private val guardrail: GuardrailClassifier,
    private val guardrailSink: GuardrailEventSink,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AiStudyUiState(profile = profileStore.profile.value))
    val uiState: StateFlow<AiStudyUiState> = _uiState.asStateFlow()

    // 学情报告用的会话内计数 (退出即清；持久化属 follow-up)。
    private var learningTurns = 0
    private var companionTurns = 0
    private var guidedModeTurns = 0
    private var mistakesAddedThisSession = 0
    private var mistakesReviewedThisSession = 0

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

        // 护栏第 2 层：post-hoc 端侧分类。命中只记"类别 + 时间"，不阻断对话、不存原文。
        guardrail.classify(content).forEach { category ->
            guardrailSink.record(GuardrailFinding(category, tab, System.currentTimeMillis()))
        }

        // 会话内计数 (供学情报告)。
        when (tab) {
            AiStudyTab.LEARNING -> {
                learningTurns++
                if (AiStudyPrompts.looksLikeHomework(content)) guidedModeTurns++
            }
            AiStudyTab.COMPANION -> companionTurns++
        }

        val systemContent = when (tab) {
            AiStudyTab.LEARNING -> {
                // 学习 tab RAG：从错题本检索相关薄弱点注入上下文。
                val related = MistakeRetriever.retrieve(content, profile, mistakeBook.snapshot())
                AiStudyPrompts.learningSystemPrompt(profile, MistakeRetriever.renderContext(related))
            }
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

    /** 把一道错题加入错题本 (学习资产，落主域)。返回新条目 id。 */
    fun addMistake(entry: MistakeEntry): String {
        mistakesAddedThisSession++
        return mistakeBook.add(entry)
    }

    /** 标记一道错题已复习。 */
    fun reviewMistake(id: String) {
        mistakesReviewedThisSession++
        mistakeBook.markReviewed(id, System.currentTimeMillis())
    }

    /** 生成家长端学情报告 (§3.6)。护栏块只含类别+次数，不含聊天原文。 */
    fun generateReport(): StudyReport {
        val snapshot = StudyActivitySnapshot(
            learningTurns = learningTurns,
            companionTurns = companionTurns,
            guidedModeTurns = guidedModeTurns,
            mistakesAdded = mistakesAddedThisSession,
            mistakesReviewed = mistakesReviewedThisSession,
            mistakeBookTotal = mistakeBook.snapshot().size,
            guardrailCategories = guardrailSink.findings.value.map { it.category },
        )
        return StudyReportGenerator.generate(_uiState.value.profile.nickname, snapshot)
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
