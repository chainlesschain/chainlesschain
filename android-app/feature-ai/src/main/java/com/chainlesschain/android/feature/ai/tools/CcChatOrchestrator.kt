package com.chainlesschain.android.feature.ai.tools

import com.chainlesschain.android.feature.ai.data.llm.ChatWithToolsResponse
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.data.llm.ToolCall
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * End-to-end coordinator for a chat turn that may use the `cc_exec` tool.
 * Design: §4.4 + §4.5 + §5.4
 */
@Singleton
class CcChatOrchestrator @Inject constructor(
    private val dispatcher: CcToolCallDispatcher,
) {

    private val mutex = Mutex()

    fun run(
        userText: String,
        history: List<Message>,
        adapter: LLMAdapter,
        model: String,
        conversationId: String = "default",
    ): Flow<CcChatEvent> = flow {
        mutex.withLock {
            try {
                val initial = history + userMessage(userText, conversationId)
                emit(CcChatEvent.StatusChanged(ChatStatus.THINKING))

                if (!adapter.supportsToolUse) {
                    runFallback(adapter, initial, model, conversationId)
                } else {
                    runToolLoop(adapter, initial, model, conversationId)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.tag(TAG).e(e, "Orchestrator turn failed")
                emit(CcChatEvent.StatusChanged(ChatStatus.FAILED))
                emit(CcChatEvent.Failed(e.message ?: e::class.simpleName ?: "unknown error"))
            }
        }
    }

    private suspend fun FlowCollector<CcChatEvent>.runFallback(
        adapter: LLMAdapter, messages: List<Message>, model: String, conversationId: String,
    ) {
        val guard = systemMessage(NO_TOOL_HALLUCINATION_GUARD, conversationId)
        val augmented = listOf(guard) + messages
        val fullText = StringBuilder()

        // B26 fix: a StreamChunk with `error != null` is an in-stream failure
        // signal (e.g. HTTP non-2xx in OpenAIAdapter); surface as Failed event
        // instead of silently completing with whatever fragments accumulated.
        var streamError: String? = null
        try {
            adapter.streamChat(augmented, model).collect { chunk ->
                if (chunk.error != null) {
                    streamError = chunk.error
                    return@collect
                }
                if (chunk.content.isNotEmpty()) {
                    fullText.append(chunk.content)
                    emit(CcChatEvent.AssistantTextDelta(chunk.content))
                }
            }
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) {
            emit(CcChatEvent.StatusChanged(ChatStatus.FAILED))
            emit(CcChatEvent.Failed("LLM stream failed: ${e.message}"))
            return
        }

        if (streamError != null) {
            emit(CcChatEvent.StatusChanged(ChatStatus.FAILED))
            emit(CcChatEvent.Failed("LLM stream failed: $streamError"))
            return
        }

        emit(CcChatEvent.StatusChanged(ChatStatus.COMPLETE))
        emit(CcChatEvent.Completed(fullText.toString()))
    }

    private suspend fun FlowCollector<CcChatEvent>.runToolLoop(
        adapter: LLMAdapter, initial: List<Message>, model: String, conversationId: String,
    ) {
        val ccTool = ccExecToolDescriptor()
        val seen = mutableSetOf<String>()
        var messages: List<Message> = initial
        var finalText = ""

        for (iter in 1..MAX_TOOL_ITERATIONS) {
            emit(CcChatEvent.StatusChanged(ChatStatus.THINKING))

            val resp: ChatWithToolsResponse = try {
                adapter.chatWithTools(messages = messages, model = model, tools = listOf(ccTool))
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                emit(CcChatEvent.StatusChanged(ChatStatus.FAILED))
                emit(CcChatEvent.Failed("chatWithTools failed at iter=$iter: ${e.message}"))
                return
            }

            resp.content?.takeIf { it.isNotEmpty() }?.let { text ->
                emit(CcChatEvent.AssistantTextDelta(text))
                finalText = text
            }

            if (!resp.hasToolCalls) {
                emit(CcChatEvent.StatusChanged(ChatStatus.COMPLETE))
                emit(CcChatEvent.Completed(finalText))
                return
            }

            val toolCall = resp.toolCalls!!.first()
            val parsedArgs = dispatcher.parseArguments(toolCall.arguments)
            val displayCmd = parsedArgs?.first ?: UNPARSEABLE_PLACEHOLDER
            val displayArgs = parsedArgs?.second ?: emptyList()

            emit(CcChatEvent.ToolCallStarted(toolCall.id, displayCmd, displayArgs))
            emit(CcChatEvent.StatusChanged(ChatStatus.TOOL_CALLED))

            val key = dedupKey(toolCall.name, displayCmd, displayArgs)
            val resultContent: String = if (key in seen) {
                emit(CcChatEvent.StatusChanged(ChatStatus.TOOL_DONE))
                duplicateCallResult(displayCmd, displayArgs)
            } else {
                seen += key
                emit(CcChatEvent.StatusChanged(ChatStatus.TOOL_RUNNING))
                val toolResult = dispatcher.dispatch(toolCall)
                emit(CcChatEvent.StatusChanged(ChatStatus.TOOL_DONE))
                toolResult.content
            }

            emit(CcChatEvent.ToolCallCompleted(toolCall.id, displayCmd, displayArgs, resultContent))

            messages = messages +
                placeholderAssistantToolCallMessage(toolCall, displayCmd, displayArgs, conversationId) +
                toolResultMessage(toolCall.id, resultContent, conversationId)

            emit(CcChatEvent.StatusChanged(ChatStatus.FINALIZING))
        }

        // Loop limit hit — forced final
        val limitNote = systemMessage(loopLimitGuard(MAX_TOOL_ITERATIONS), conversationId)
        val forcedFinal: String = try {
            adapter.chat(messages + limitNote, model)
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) {
            emit(CcChatEvent.StatusChanged(ChatStatus.FAILED))
            emit(CcChatEvent.Failed("forced-final chat failed: ${e.message}"))
            return
        }
        if (forcedFinal.isNotEmpty()) emit(CcChatEvent.AssistantTextDelta(forcedFinal))
        emit(CcChatEvent.StatusChanged(ChatStatus.COMPLETE))
        emit(CcChatEvent.Completed(forcedFinal))
    }

    internal fun dedupKey(toolName: String, command: String, subargs: List<String>): String =
        "$toolName::$command::${subargs.joinToString("|")}"

    internal fun ccExecToolDescriptor(): Map<String, Any> = mapOf(
        "name" to CcToolCallDispatcher.TOOL_NAME,
        "description" to TOOL_DESCRIPTION,
        "parameters" to mapOf(
            "type" to "object",
            "properties" to mapOf(
                "command" to mapOf(
                    "type" to "string",
                    "enum" to CcAllowlist.V1.keys.toList(),
                    "description" to "The cc subcommand to invoke.",
                ),
                "subargs" to mapOf(
                    "type" to "array",
                    "items" to mapOf("type" to "string"),
                    "description" to "Args following the subcommand, e.g. ['list', '--limit', '10'].",
                ),
            ),
            "required" to listOf("command", "subargs"),
        ),
    )

    private fun duplicateCallResult(displayCmd: String, displayArgs: List<String>): String =
        buildString {
            append("$ cc $displayCmd")
            if (displayArgs.isNotEmpty()) { append(' '); append(displayArgs.joinToString(" ")) }
            append('\n')
            append("exitCode=$EXIT_DUPLICATE_CALL\n")
            append("stderr:\nduplicate tool call (same command+args already invoked this turn — reuse the previous result)\n")
        }

    private fun userMessage(content: String, conversationId: String): Message =
        Message(id = UUID.randomUUID().toString(), conversationId = conversationId,
            role = MessageRole.USER, content = content, createdAt = System.currentTimeMillis())

    private fun systemMessage(content: String, conversationId: String): Message =
        Message(id = UUID.randomUUID().toString(), conversationId = conversationId,
            role = MessageRole.SYSTEM, content = content, createdAt = System.currentTimeMillis())

    private fun placeholderAssistantToolCallMessage(
        toolCall: ToolCall, displayCmd: String, displayArgs: List<String>, conversationId: String,
    ): Message = Message(
        id = UUID.randomUUID().toString(),
        conversationId = conversationId,
        role = MessageRole.ASSISTANT,
        content = buildString {
            append("[tool_call "); append(toolCall.name); append('(')
            append(displayCmd)
            if (displayArgs.isNotEmpty()) { append(' '); append(displayArgs.joinToString(" ")) }
            append(") id="); append(toolCall.id); append(']')
        },
        createdAt = System.currentTimeMillis(),
        toolCalls = listOf(toolCall),
    )

    private fun toolResultMessage(toolCallId: String, content: String, conversationId: String): Message =
        Message(id = UUID.randomUUID().toString(), conversationId = conversationId,
            role = MessageRole.TOOL, content = content, createdAt = System.currentTimeMillis(),
            toolCallId = toolCallId)

    companion object {
        private const val TAG = "CcChatOrchestrator"
        const val MAX_TOOL_ITERATIONS: Int = 3
        const val EXIT_DUPLICATE_CALL: Int = 129
        const val UNPARSEABLE_PLACEHOLDER: String = "?"

        const val NO_TOOL_HALLUCINATION_GUARD: String =
            "本对话工具调用 (cc_exec) 不可用 — 当前模型不支持。" +
                "若用户请求查询本地数据 (笔记/skill/memory/状态/DID 等)，" +
                "明确告知用户切换到 OpenAI / Doubao / Anthropic 模型，**不要凭空捏造答案**。"

        fun loopLimitGuard(max: Int): String =
            "[已达工具调用上限 $max 次。请基于上面的 tool_result 内容直接回答，不要再发出工具调用。]"

        const val TOOL_DESCRIPTION: String =
            "Execute a read-only ChainlessChain CLI query command on the user's local device. " +
                "Returns the command's stdout/stderr/exitCode. " +
                "ONLY use for queries (listing notes, searching memory, checking status, etc.); " +
                "for write/delete/install operations, advise the user to run them in the terminal manually."
    }
}
