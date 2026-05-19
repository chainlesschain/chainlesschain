package com.chainlesschain.android.feature.ai.tools

/**
 * Whitelist gate for the `cc_exec` LLM tool — v1 read-only L1 commands.
 *
 * Design: docs/design/Android_AI_Chat_CC_Exec_Tool.md §4.2
 */
internal object CcAllowlist {

    const val MIN_CC_VERSION: String = "0.162.0"

    private val FORBIDDEN_CHARS: Set<Char> = setOf(
        ';', '&', '|', '$', '`', '\n', '\r', '>', '<', ' ',
    )

    private fun isAsciiKebabLower(s: String): Boolean =
        s.isNotEmpty() && s.all { it in 'a'..'z' || it == '-' }

    enum class FlagType { BOOL, INT, STRING_LIMITED }

    data class FlagSpec(
        val name: String,
        val type: FlagType,
        val intRange: IntRange? = null,
        val stringMaxLen: Int = 64,
    )

    data class CmdSpec(
        val command: String,
        val allowedSubcommands: Set<String>?,
        val flags: List<FlagSpec>,
        val maxArgs: Int = 8,
        val defaultLimit: Int? = null,
    )

    private val LIMIT_1_200 = FlagSpec("--limit", FlagType.INT, intRange = 1..200)
    private val JSON_BOOL = FlagSpec("--json", FlagType.BOOL)

    val V1: Map<String, CmdSpec> = listOf(
        CmdSpec("note", setOf("list", "show", "view"),
            listOf(LIMIT_1_200, JSON_BOOL, FlagSpec("--id", FlagType.STRING_LIMITED, stringMaxLen = 128)),
            defaultLimit = 20),
        CmdSpec("search", null, listOf(LIMIT_1_200, JSON_BOOL), defaultLimit = 20),
        CmdSpec("memory", setOf("list", "show"), listOf(LIMIT_1_200, JSON_BOOL), defaultLimit = 20),
        CmdSpec("skill", setOf("list"), listOf(JSON_BOOL)),
        CmdSpec("status", null, listOf(JSON_BOOL)),
        CmdSpec("session", setOf("list"), listOf(LIMIT_1_200, JSON_BOOL), defaultLimit = 20),
        CmdSpec("mcp", setOf("list"), listOf(JSON_BOOL)),
        CmdSpec("did", setOf("show"), listOf(JSON_BOOL)),
    ).associateBy { it.command }

    fun check(command: String, subargs: List<String>): GateResult {
        if (!isAsciiKebabLower(command)) return GateResult.deny("non-ASCII command name")
        val spec = V1[command] ?: return GateResult.deny("command '$command' not in v1 allowlist")
        if (subargs.size > spec.maxArgs)
            return GateResult.deny("too many args (${subargs.size} > ${spec.maxArgs})")

        // Lowest-layer: pre-scan every arg for empty / too-long / forbidden chars
        for (a in subargs) {
            if (a.isEmpty()) return GateResult.deny("empty arg")
            if (a.length > 256) return GateResult.deny("arg too long")
            for (ch in a) {
                if (ch in FORBIDDEN_CHARS) return GateResult.deny("forbidden char in arg: ${a.take(40)}")
            }
        }

        // Subcommand check.
        // B17 fix: when a command has [allowedSubcommands], a subcommand is REQUIRED.
        // Previously `firstNonFlag == null` silently passed → cc CLI then printed a
        // usage error, surfacing as a non-zero exit instead of a clean allowlist
        // deny. We catch it here so the error message is actionable for the LLM.
        val firstNonFlag = subargs.firstOrNull { !it.startsWith("--") }
        if (spec.allowedSubcommands != null) {
            if (firstNonFlag == null)
                return GateResult.deny(
                    "command '$command' requires a subcommand (one of: " +
                        "${spec.allowedSubcommands.joinToString(", ")})"
                )
            if (!isAsciiKebabLower(firstNonFlag) || firstNonFlag !in spec.allowedSubcommands)
                return GateResult.deny("subcommand '$firstNonFlag' not in allowlist for '$command'")
        }

        // Per-flag value validation
        var i = 0
        while (i < subargs.size) {
            val a = subargs[i]
            if (a.startsWith("--")) {
                val name = a.substringBefore('=')
                val flagSpec = spec.flags.firstOrNull { it.name == name }
                    ?: return GateResult.deny("flag '$name' not in allowlist for '$command'")

                val valueRaw: String? = when {
                    a.contains('=') -> a.substringAfter('=')
                    flagSpec.type == FlagType.BOOL -> null
                    else -> {
                        val next = subargs.getOrNull(i + 1)
                            ?: return GateResult.deny("flag '$name' missing value")
                        if (next.startsWith("--"))
                            return GateResult.deny("flag '$name' missing value (next arg is another flag)")
                        i++
                        next
                    }
                }

                when (flagSpec.type) {
                    FlagType.BOOL -> if (valueRaw != null && valueRaw !in setOf("true", "false"))
                        return GateResult.deny("bool flag '$name' got non-bool '$valueRaw'")
                    FlagType.INT -> {
                        val v = valueRaw ?: return GateResult.deny("int flag '$name' missing value")
                        val n = v.toIntOrNull() ?: return GateResult.deny("flag '$name' value '$v' not int")
                        val range = flagSpec.intRange
                            ?: return GateResult.deny("flag '$name' spec missing intRange")
                        if (n !in range) return GateResult.deny("flag '$name' value $n out of range $range")
                    }
                    FlagType.STRING_LIMITED -> {
                        val v = valueRaw ?: return GateResult.deny("string flag '$name' missing value")
                        if (v.length > flagSpec.stringMaxLen)
                            return GateResult.deny("flag '$name' value too long (${v.length} > ${flagSpec.stringMaxLen})")
                    }
                }
            }
            i++
        }
        return GateResult.Allow
    }

    fun applyDefaults(command: String, subargs: List<String>): List<String> {
        val spec = V1[command] ?: return subargs
        val lim = spec.defaultLimit ?: return subargs
        val hasLimit = subargs.any { it == "--limit" || it.startsWith("--limit=") }
        return if (hasLimit) subargs else subargs + listOf("--limit", lim.toString())
    }

    fun versionAtLeast(actual: String, minimum: String = MIN_CC_VERSION): Boolean {
        val a = parseVersion(actual) ?: return false
        val m = parseVersion(minimum) ?: return false
        for (i in 0 until maxOf(a.size, m.size)) {
            val av = a.getOrElse(i) { 0 }
            val mv = m.getOrElse(i) { 0 }
            if (av != mv) return av > mv
        }
        return true
    }

    private fun parseVersion(v: String): List<Int>? {
        val cleaned = v.trim().removePrefix("v").removePrefix("V")
            .substringBefore('-').substringBefore('+').substringBefore(' ')
        if (cleaned.isEmpty()) return null
        return cleaned.split('.').map { it.toIntOrNull() ?: return null }.takeIf { it.isNotEmpty() }
    }
}

internal sealed class GateResult {
    object Allow : GateResult()
    data class Deny(val reason: String) : GateResult()
    companion object {
        fun deny(reason: String): Deny = Deny(reason)
    }
}
