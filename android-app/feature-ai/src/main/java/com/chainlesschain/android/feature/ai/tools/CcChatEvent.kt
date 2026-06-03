package com.chainlesschain.android.feature.ai.tools

/**
 * Five-stage UI state machine for an AI Chat turn that may include cc-exec tool calls.
 * Design: §4.4
 */
enum class ChatStatus {
    THINKING,
    TOOL_CALLED,
    TOOL_RUNNING,
    TOOL_DONE,
    FINALIZING,
    COMPLETE,
    FAILED,
    CANCELLED,
}

/** Events emitted by [CcChatOrchestrator] over a single chat turn. */
sealed class CcChatEvent {
    data class StatusChanged(val status: ChatStatus) : CcChatEvent()
    data class AssistantTextDelta(val text: String) : CcChatEvent()
    data class ToolCallStarted(
        val toolCallId: String,
        val command: String,
        val subargs: List<String>,
    ) : CcChatEvent()
    data class ToolCallCompleted(
        val toolCallId: String,
        val command: String,
        val subargs: List<String>,
        val resultContent: String,
    ) : CcChatEvent()
    data class Completed(val finalText: String) : CcChatEvent()
    data class Failed(val reason: String) : CcChatEvent()
}
