package com.chainlesschain.android.feature.ai.tools

import com.chainlesschain.android.feature.ai.data.llm.ToolCall
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Routes an LLM-issued [ToolCall] to the cc-exec pipeline.
 * Design: §4.1 + §4.2 + §4.3
 */
@Singleton
class CcToolCallDispatcher @Inject constructor(
    private val ccExecService: CcExecService,
) {

    suspend fun dispatch(toolCall: ToolCall): ToolResult {
        if (toolCall.name != TOOL_NAME) {
            return synthError(toolCall.id, EXIT_UNKNOWN_TOOL,
                "unknown tool '${toolCall.name}'; only '$TOOL_NAME' is supported in v1")
        }

        val parsed = parseArguments(toolCall.arguments)
            ?: return synthError(toolCall.id, EXIT_MALFORMED_ARGS,
                "malformed arguments — expected {command:String, subargs:Array<String>}; got keys=${toolCall.arguments.keys}")
        val (command, parsedSubargs) = parsed

        val gate = CcAllowlist.check(command, parsedSubargs)
        if (gate is GateResult.Deny) {
            return synthError(toolCall.id, EXIT_ALLOWLIST_DENY,
                "command denied by v1 allowlist: ${gate.reason}. " +
                    "v1 only supports read-only L1 commands (note/search/memory/skill/" +
                    "status/session/mcp/did); write operations come in v1.1.")
        }

        val effectiveSubargs = CcAllowlist.applyDefaults(command, parsedSubargs)
        Timber.tag(TAG).d("dispatching: cc $command ${effectiveSubargs.joinToString(" ")}")

        val result = ccExecService.run(command, effectiveSubargs)
        return ToolResult(
            toolCallId = toolCall.id,
            content = formatResultContent(command, effectiveSubargs, result),
        )
    }

    internal fun parseArguments(args: Map<String, Any>): Pair<String, List<String>>? {
        val command = args["command"]?.let { it as? String } ?: return null
        val subargsRaw = args["subargs"] ?: return null

        val subargs: List<String> = when (subargsRaw) {
            is List<*> -> subargsRaw.mapNotNull { it?.toString() }
            is Array<*> -> subargsRaw.mapNotNull { it?.toString() }
            is String -> {
                try {
                    Json.parseToJsonElement(subargsRaw).jsonArray.map { element ->
                        if (element is JsonPrimitive) element.contentOrToString()
                        else element.toString()
                    }
                } catch (e: Exception) {
                    Timber.tag(TAG).w(e, "subargs string is not a JSON array: $subargsRaw")
                    return null
                }
            }
            else -> return null
        }

        return command to subargs.filter { it.isNotEmpty() }
    }

    internal fun formatResultContent(
        command: String, subargs: List<String>, result: CcResult,
    ): String = buildString {
        append("$ cc $command")
        if (subargs.isNotEmpty()) { append(" "); append(subargs.joinToString(" ")) }
        append('\n')
        when (result) {
            is CcResult.Ok -> {
                append("exitCode=${result.exitCode}\n")
                append("duration=${result.durationMs}ms\n")
                if (result.stdout.isNotEmpty()) {
                    append("stdout:\n"); append(result.stdout)
                    if (!result.stdout.endsWith('\n')) append('\n')
                }
                if (result.stderr.isNotEmpty()) {
                    append("stderr:\n"); append(result.stderr)
                    if (!result.stderr.endsWith('\n')) append('\n')
                }
            }
            is CcResult.Error -> {
                append("exitCode=$EXIT_EXEC_ERROR\n")
                append("stderr:\n"); append(result.reason); append('\n')
                result.expectedPath?.let { append("expectedPath=$it\n") }
            }
        }
    }

    private fun synthError(toolCallId: String, exitCode: Int, msg: String): ToolResult =
        ToolResult(toolCallId = toolCallId, content = buildString {
            append("$ cc <error>\nexitCode=$exitCode\nstderr:\n"); append(msg); append('\n')
        })

    private fun JsonPrimitive.contentOrToString(): String =
        if (isString) jsonPrimitive.content else toString()

    companion object {
        private const val TAG = "CcToolDispatcher"
        const val TOOL_NAME: String = "cc_exec"
        const val EXIT_UNKNOWN_TOOL: Int = 127
        const val EXIT_MALFORMED_ARGS: Int = 64
        const val EXIT_ALLOWLIST_DENY: Int = 126
        const val EXIT_EXEC_ERROR: Int = -1
    }
}

data class ToolResult(
    val toolCallId: String,
    val content: String,
)
