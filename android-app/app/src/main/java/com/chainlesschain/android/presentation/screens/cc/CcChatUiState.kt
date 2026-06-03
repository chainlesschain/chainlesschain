package com.chainlesschain.android.presentation.screens.cc

import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.tools.ChatStatus

/**
 * UI state for CcChatScreen. Design §4.4 + §5.5.
 */
data class CcChatUiState(
    val provider: LLMProvider = LLMProvider.OPENAI,
    val modelName: String = "",
    val messages: List<CcChatMessage> = emptyList(),
    val status: ChatStatus = ChatStatus.COMPLETE,
    val inputEnabled: Boolean = true,
    val toolAvailable: Boolean = false,
    val error: String? = null,
)

sealed class CcChatMessage {
    abstract val id: String
    abstract val timestamp: Long

    data class User(
        override val id: String,
        val text: String,
        override val timestamp: Long,
    ) : CcChatMessage()

    data class Assistant(
        override val id: String,
        val text: String,
        val isStreaming: Boolean = false,
        override val timestamp: Long,
    ) : CcChatMessage()

    data class System(
        override val id: String,
        val text: String,
        override val timestamp: Long,
    ) : CcChatMessage()

    data class ToolCall(
        override val id: String,
        val toolCallId: String,
        val command: String,
        val subargs: List<String>,
        val state: State = State.PENDING,
        val exitCode: Int? = null,
        val durationMs: Long? = null,
        val resultContent: String? = null,
        val expanded: Boolean = false,
        override val timestamp: Long,
    ) : CcChatMessage() {
        enum class State { PENDING, DONE }

        val invocationLine: String
            get() = if (subargs.isEmpty()) "cc $command"
            else "cc $command ${subargs.joinToString(" ")}"
    }
}
