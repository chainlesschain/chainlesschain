package com.chainlesschain.android.feature.ai.cowork.skills.loader

import com.chainlesschain.android.feature.ai.cowork.skills.model.*
import org.yaml.snakeyaml.Yaml
import timber.log.Timber

/**
 * Parser for SKILL.md files with YAML frontmatter + Markdown body.
 *
 * Format:
 * ```
 * ---
 * name: code-review
 * description: Review code quality
 * category: development
 * ...
 * ---
 *
 * # Code Review Skill
 *
 * Markdown instructions body...
 * ```
 */
class SkillMdParser {

    private val yaml = Yaml()

    /**
     * Parse a SKILL.md file content into a Skill object.
     *
     * @param content Raw file content
     * @param source  Which layer this skill comes from
     * @param sourcePath Original file path (for debugging)
     * @return Parsed Skill, or null if parsing fails
     */
    fun parse(content: String, source: SkillSource, sourcePath: String = ""): Skill? {
        return try {
            val (frontmatter, body) = splitFrontmatter(content)
            if (frontmatter.isBlank()) {
                Timber.w("SkillMdParser: No YAML frontmatter found in $sourcePath")
                return null
            }

            val yamlData = parseYaml(frontmatter)
            val metadata = buildMetadata(yamlData)
            val examples = extractExamples(body)

            Skill(
                metadata = metadata,
                instructions = body.trim(),
                examples = examples,
                source = source,
                sourcePath = sourcePath,
                enabled = yamlData["enabled"] as? Boolean ?: true
            )
        } catch (e: Exception) {
            Timber.e(e, "SkillMdParser: Failed to parse $sourcePath")
            null
        }
    }

    /**
     * Split content into YAML frontmatter and Markdown body.
     */
    internal fun splitFrontmatter(content: String): Pair<String, String> {
        val lines = content.lines()
        if (lines.isEmpty() || lines[0].trim() != "---") {
            return "" to content
        }

        var endIndex = -1
        for (i in 1 until lines.size) {
            if (lines[i].trim() == "---") {
                endIndex = i
                break
            }
        }

        if (endIndex == -1) {
            return "" to content
        }

        val frontmatter = lines.subList(1, endIndex).joinToString("\n")
        val body = lines.subList(endIndex + 1, lines.size).joinToString("\n")
        return frontmatter to body
    }

    /**
     * Parse YAML string into a Map using SnakeYAML.
     */
    @Suppress("UNCHECKED_CAST")
    internal fun parseYaml(yamlContent: String): Map<String, Any> {
        return try {
            val result = yaml.load<Any>(yamlContent)
            (result as? Map<String, Any>) ?: emptyMap()
        } catch (e: Exception) {
            Timber.w(e, "SkillMdParser: YAML parse error, falling back to simple parser")
            simpleYamlParse(yamlContent)
        }
    }

    /**
     * Simple fallback YAML parser for basic key-value pairs.
     */
    private fun simpleYamlParse(content: String): Map<String, Any> {
        val result = mutableMapOf<String, Any>()
        for (line in content.lines()) {
            val trimmed = line.trim()
            if (trimmed.isBlank() || trimmed.startsWith("#")) continue

            val colonIndex = trimmed.indexOf(':')
            if (colonIndex > 0) {
                val key = trimmed.substring(0, colonIndex).trim()
                val value = trimmed.substring(colonIndex + 1).trim()

                if (value.startsWith("[") && value.endsWith("]")) {
                    // Inline array
                    result[key] = value.substring(1, value.length - 1)
                        .split(",")
                        .map { it.trim().removeSurrounding("\"").removeSurrounding("'") }
                        .filter { it.isNotBlank() }
                } else if (value == "true") {
                    result[key] = true
                } else if (value == "false") {
                    result[key] = false
                } else if (value.toIntOrNull() != null) {
                    result[key] = value.toInt()
                } else if (value.toDoubleOrNull() != null) {
                    result[key] = value.toDouble()
                } else {
                    result[key] = value.removeSurrounding("\"").removeSurrounding("'")
                }
            }
        }
        return result
    }

    /**
     * Build SkillMetadata from parsed YAML data.
     * Supports both kebab-case and camelCase field names (matching desktop).
     */
    @Suppress("UNCHECKED_CAST")
    internal fun buildMetadata(data: Map<String, Any>): SkillMetadata {
        val name = data["name"]?.toString() ?: "unknown"
        val displayName = (data["display-name"] ?: data["displayName"])?.toString() ?: name
        val description = data["description"]?.toString() ?: ""
        val version = data["version"]?.toString() ?: "1.0.0"
        val category = SkillCategory.fromString(
            data["category"]?.toString() ?: "general"
        )
        val author = data["author"]?.toString() ?: ""
        val tags = toStringList(data["tags"])
        val fileTypes = toStringList(
            data["supported-file-types"] ?: data["supportedFileTypes"] ?: data["file-types"] ?: data["fileTypes"]
        )
        val capabilities = toStringList(data["capabilities"])
        val userInvocable = (data["user-invocable"] ?: data["userInvocable"]) as? Boolean ?: true
        val hidden = data["hidden"] as? Boolean ?: false
        val handler = data["handler"]?.toString()
        val os = toStringList(data["os"]).ifEmpty { listOf("android", "win32", "darwin", "linux") }
        val executionMode = SkillExecutionMode.fromString(
            (data["execution-mode"] ?: data["executionMode"])?.toString() ?: "local"
        )
        val remoteSkillName = (data["remote-skill-name"] ?: data["remoteSkillName"])?.toString()

        // Agent Skills Open Standard fields
        val dependencies = toStringList(data["dependencies"])
        val cost = data["cost"]?.toString()
        val license = data["license"]?.toString() ?: ""
        val homepage = data["homepage"]?.toString() ?: ""
        val repository = data["repository"]?.toString() ?: ""

        // Input/output schema
        val inputSchema = parseParameters(data["input-schema"] ?: data["inputSchema"])
        val outputSchema = parseParameters(data["output-schema"] ?: data["outputSchema"])

        // Model hints
        val modelHints = (data["model-hints"] ?: data["modelHints"]) as? Map<String, Any> ?: emptyMap()

        // Gate conditions
        val gate = parseGate(data["gate"] ?: data["requires"])

        return SkillMetadata(
            name = name,
            displayName = displayName,
            version = version,
            description = description,
            category = category,
            author = author,
            tags = tags,
            fileTypes = fileTypes,
            capabilities = capabilities,
            userInvocable = userInvocable,
            hidden = hidden,
            inputSchema = inputSchema,
            outputSchema = outputSchema,
            modelHints = modelHints,
            dependencies = dependencies,
            cost = cost,
            license = license,
            homepage = homepage,
            repository = repository,
            gate = gate,
            handler = handler,
            os = os,
            executionMode = executionMode,
            remoteSkillName = remoteSkillName
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun toStringList(value: Any?): List<String> {
        return when (value) {
            is List<*> -> value.filterNotNull().map { it.toString() }
            is String -> if (value.isBlank()) emptyList()
            else value.split(",").map { it.trim() }.filter { it.isNotBlank() }
            else -> emptyList()
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseParameters(value: Any?): List<SkillParameter> {
        if (value == null) return emptyList()
        val list = value as? List<*> ?: return emptyList()

        return list.filterNotNull().mapNotNull { item ->
            val map = item as? Map<String, Any> ?: return@mapNotNull null
            SkillParameter(
                name = map["name"]?.toString() ?: return@mapNotNull null,
                type = map["type"]?.toString() ?: "string",
                description = map["description"]?.toString() ?: "",
                required = map["required"] as? Boolean ?: false,
                default = map["default"]
            )
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseGate(value: Any?): SkillGate? {
        val map = value as? Map<String, Any> ?: return null
        return SkillGate(
            platform = toStringList(map["platform"]).ifEmpty { null },
            minSdk = (map["minSdk"] ?: map["min-sdk"]) as? Int,
            requiredPermissions = toStringList(map["permissions"] ?: map["requiredPermissions"]).ifEmpty { null },
            requiredBinaries = toStringList(map["bins"] ?: map["requiredBinaries"]).ifEmpty { null },
            requiredEnv = toStringList(map["env"] ?: map["requiredEnv"]).ifEmpty { null }
        )
    }

    /**
     * Extract code examples from Markdown body (fenced code blocks after "## Examples").
     */
    private fun extractExamples(body: String): List<String> {
        val examples = mutableListOf<String>()
        val lines = body.lines()
        var inExamplesSection = false
        var inCodeBlock = false
        val currentBlock = StringBuilder()

        for (line in lines) {
            val trimmed = line.trim()

            if (trimmed.startsWith("## Example")) {
                inExamplesSection = true
                continue
            }

            // Exit examples section on next h2
            if (inExamplesSection && trimmed.startsWith("## ") && !trimmed.startsWith("## Example")) {
                inExamplesSection = false
            }

            if (inExamplesSection) {
                if (trimmed.startsWith("```")) {
                    if (inCodeBlock) {
                        // End of code block
                        examples.add(currentBlock.toString().trim())
                        currentBlock.clear()
                        inCodeBlock = false
                    } else {
                        inCodeBlock = true
                    }
                } else if (inCodeBlock) {
                    currentBlock.appendLine(line)
                }
            }
        }

        return examples
    }
}
