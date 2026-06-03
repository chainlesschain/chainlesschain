package com.chainlesschain.android.feature.ai.cowork.skills.executor

import com.chainlesschain.android.feature.ai.cowork.skills.registry.SkillRegistry

/**
 * Parses /skill-name commands from chat input.
 *
 * Supports:
 * - `/code-review some code here` (positional args)
 * - `/translate --from=en --to=zh Hello world` (named args)
 * - `/summarize` (no args, reads from context)
 */
class SkillCommandParser(private val registry: SkillRegistry) {

    /**
     * Try to parse a chat message as a skill command.
     *
     * @return ParsedCommand if the message starts with a known /skill, null otherwise
     */
    fun parse(input: String): ParsedCommand? {
        val trimmed = input.trim()
        if (!trimmed.startsWith("/")) return null

        // Extract command name (first word after /)
        val parts = trimmed.substring(1).split(Regex("\\s+"), limit = 2)
        val commandName = parts[0]
        val argsString = parts.getOrNull(1)?.trim() ?: ""

        // Look up skill
        val skill = registry.findByName(commandName) ?: return null

        // Parse arguments
        val namedArgs = mutableMapOf<String, String>()
        val positionalArgs = mutableListOf<String>()

        if (argsString.isNotBlank()) {
            val tokens = tokenize(argsString)
            for (token in tokens) {
                if (token.startsWith("--")) {
                    // Named argument: --key=value or --key value
                    val eqIndex = token.indexOf('=')
                    if (eqIndex > 0) {
                        val key = token.substring(2, eqIndex)
                        val value = token.substring(eqIndex + 1)
                        namedArgs[key] = value
                    } else {
                        // Flag without value — set to "true"
                        namedArgs[token.substring(2)] = "true"
                    }
                } else {
                    positionalArgs.add(token)
                }
            }
        }

        // Map positional args to input schema parameter names (lower priority)
        val inputMap = mutableMapOf<String, Any>()

        val schema = skill.metadata.inputSchema
        for ((index, arg) in positionalArgs.withIndex()) {
            if (index < schema.size) {
                inputMap[schema[index].name] = arg
            }
        }

        // Named args override positional args (higher priority)
        inputMap.putAll(namedArgs)

        // If there's remaining text and no schema mapping, put it as "input"
        if (inputMap.isEmpty() && argsString.isNotBlank()) {
            inputMap["input"] = argsString
        }

        return ParsedCommand(
            skillName = commandName,
            rawArgs = argsString,
            input = inputMap
        )
    }

    /**
     * Check if a message looks like a skill command.
     */
    fun isSkillCommand(input: String): Boolean {
        val trimmed = input.trim()
        if (!trimmed.startsWith("/")) return false
        val commandName = trimmed.substring(1).split(Regex("\\s+"), limit = 2)[0]
        return registry.findByName(commandName) != null
    }

    /**
     * Get autocomplete suggestions for partial input.
     */
    fun getSuggestions(partial: String): List<String> {
        if (!partial.startsWith("/")) return emptyList()
        val prefix = partial.substring(1).lowercase()
        return registry.listInvocable()
            .filter { it.name.lowercase().startsWith(prefix) }
            .map { "/${it.name}" }
    }

    /**
     * Simple tokenizer that respects quoted strings.
     */
    private fun tokenize(input: String): List<String> {
        val tokens = mutableListOf<String>()
        val current = StringBuilder()
        var inQuote = false
        var quoteChar = ' '

        for (ch in input) {
            when {
                !inQuote && (ch == '"' || ch == '\'') -> {
                    inQuote = true
                    quoteChar = ch
                }
                inQuote && ch == quoteChar -> {
                    inQuote = false
                }
                !inQuote && ch.isWhitespace() -> {
                    if (current.isNotEmpty()) {
                        tokens.add(current.toString())
                        current.clear()
                    }
                }
                else -> current.append(ch)
            }
        }

        if (current.isNotEmpty()) {
            tokens.add(current.toString())
        }

        return tokens
    }
}

/**
 * Result of parsing a /skill command.
 */
data class ParsedCommand(
    val skillName: String,
    val rawArgs: String,
    val input: Map<String, Any>
)
