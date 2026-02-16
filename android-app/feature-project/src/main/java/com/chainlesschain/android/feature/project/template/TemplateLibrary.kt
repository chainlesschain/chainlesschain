package com.chainlesschain.android.feature.project.template

import android.content.Context
import timber.log.Timber
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.project.model.ProjectStructure
import com.chainlesschain.android.feature.project.model.ProjectTemplate
import com.chainlesschain.android.feature.project.model.ProjectTemplates
import com.chainlesschain.android.feature.project.model.TemplateCategory
import com.chainlesschain.android.feature.project.model.TemplateFile
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Template Library Manager
 *
 * Provides comprehensive template management capabilities:
 * - Predefined templates library
 * - AI-assisted template generation
 * - Custom template management (create, save, import/export)
 * - Template recommendations based on project description
 * - Template preview and customization
 */
@Singleton
class TemplateLibrary @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        private const val CUSTOM_TEMPLATES_FILE = "custom_templates.json"
        private const val MAX_CUSTOM_TEMPLATES = 50
        private const val TEMPLATE_GENERATION_SYSTEM_PROMPT = """You are a project template generator.
Generate project templates based on user descriptions.
Return JSON format with: name, description, category, folders (list of folder paths), files (list of {path, content}).
Focus on creating practical, well-structured project scaffolds.
Use common conventions and best practices for the chosen technology stack."""
    }

    private val gson = Gson()
    private var llmAdapter: LLMAdapter? = null

    // Cache for custom templates
    private var customTemplatesCache: MutableList<ProjectTemplate>? = null

    /**
     * Initialize with LLM adapter for AI features
     */
    fun initWithLLM(adapter: LLMAdapter) {
        this.llmAdapter = adapter
    }

    /**
     * Get all available templates (predefined + custom)
     */
    suspend fun getAllTemplates(): List<ProjectTemplate> = withContext(Dispatchers.IO) {
        val predefined = ProjectTemplates.getAllTemplates()
        val custom = getCustomTemplates()
        predefined + custom
    }

    /**
     * Get templates by category
     */
    suspend fun getTemplatesByCategory(category: TemplateCategory): List<ProjectTemplate> {
        return getAllTemplates().filter { it.category == category }
    }

    /**
     * Get template by ID
     */
    suspend fun getTemplateById(id: String): ProjectTemplate? {
        return getAllTemplates().find { it.id == id }
    }

    /**
     * Search templates by keyword
     */
    suspend fun searchTemplates(query: String): List<ProjectTemplate> {
        if (query.isBlank()) return getAllTemplates()

        val lowerQuery = query.lowercase()
        return getAllTemplates().filter { template ->
            template.name.lowercase().contains(lowerQuery) ||
                template.description.lowercase().contains(lowerQuery) ||
                template.tags.any { it.lowercase().contains(lowerQuery) }
        }
    }

    /**
     * AI-powered template recommendation based on project description
     */
    suspend fun recommendTemplates(
        projectDescription: String,
        maxRecommendations: Int = 3
    ): List<TemplateRecommendation> = withContext(Dispatchers.Default) {
        val allTemplates = getAllTemplates()

        // Simple keyword-based scoring
        val recommendations = allTemplates.map { template ->
            val score = calculateRecommendationScore(projectDescription, template)
            TemplateRecommendation(
                template = template,
                score = score,
                reason = generateRecommendationReason(projectDescription, template, score)
            )
        }
            .filter { it.score > 0 }
            .sortedByDescending { it.score }
            .take(maxRecommendations)

        // If LLM is available, enhance recommendations
        val adapter = llmAdapter
        if (adapter != null && recommendations.isNotEmpty()) {
            try {
                enhanceRecommendationsWithLLM(adapter, projectDescription, recommendations)
            } catch (e: Exception) {
                Timber.e(e, "Failed to enhance recommendations with LLM")
                recommendations
            }
        } else {
            recommendations
        }
    }

    /**
     * AI-powered template generation from natural language description
     */
    suspend fun generateTemplateFromDescription(
        description: String,
        projectType: String? = null
    ): GeneratedTemplateResult = withContext(Dispatchers.Default) {
        val adapter = llmAdapter

        if (adapter == null) {
            // Fallback: use keyword matching to select closest template
            val recommendations = recommendTemplates(description, 1)
            if (recommendations.isNotEmpty()) {
                return@withContext GeneratedTemplateResult(
                    success = true,
                    template = recommendations.first().template,
                    isAIGenerated = false,
                    message = "使用最匹配的预置模板"
                )
            } else {
                return@withContext GeneratedTemplateResult(
                    success = false,
                    template = null,
                    isAIGenerated = false,
                    message = "无法生成模板，请提供更多详情"
                )
            }
        }

        try {
            val prompt = buildTemplateGenerationPrompt(description, projectType)
            val messages = listOf(
                Message(
                    id = UUID.randomUUID().toString(),
                    conversationId = "template-gen",
                    role = MessageRole.SYSTEM,
                    content = TEMPLATE_GENERATION_SYSTEM_PROMPT,
                    createdAt = System.currentTimeMillis()
                ),
                Message(
                    id = UUID.randomUUID().toString(),
                    conversationId = "template-gen",
                    role = MessageRole.USER,
                    content = prompt,
                    createdAt = System.currentTimeMillis()
                )
            )

            val response = adapter.chat(messages, "deepseek-chat", temperature = 0.3f)
            val template = parseTemplateFromLLMResponse(response, description)

            if (template != null) {
                GeneratedTemplateResult(
                    success = true,
                    template = template,
                    isAIGenerated = true,
                    message = "成功生成项目模板"
                )
            } else {
                GeneratedTemplateResult(
                    success = false,
                    template = null,
                    isAIGenerated = true,
                    message = "模板解析失败，请重试"
                )
            }
        } catch (e: Exception) {
            Timber.e(e, "Template generation failed")
            GeneratedTemplateResult(
                success = false,
                template = null,
                isAIGenerated = false,
                message = "生成失败: ${e.message}"
            )
        }
    }

    // --- Custom Template Management ---

    /**
     * Get all custom templates
     */
    suspend fun getCustomTemplates(): List<ProjectTemplate> = withContext(Dispatchers.IO) {
        customTemplatesCache?.let { return@withContext it }

        try {
            val file = File(context.filesDir, CUSTOM_TEMPLATES_FILE)
            if (file.exists()) {
                val json = file.readText()
                val type = object : TypeToken<List<CustomTemplateData>>() {}.type
                val data: List<CustomTemplateData> = gson.fromJson(json, type)
                val templates = data.map { it.toProjectTemplate() }.toMutableList()
                customTemplatesCache = templates
                templates
            } else {
                mutableListOf<ProjectTemplate>().also { customTemplatesCache = it }
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to load custom templates")
            mutableListOf<ProjectTemplate>().also { customTemplatesCache = it }
        }
    }

    /**
     * Save a custom template
     */
    suspend fun saveCustomTemplate(template: ProjectTemplate): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val templates = getCustomTemplates().toMutableList()

            // Check limit
            if (templates.size >= MAX_CUSTOM_TEMPLATES) {
                return@withContext Result.failure(Exception("最多只能保存 $MAX_CUSTOM_TEMPLATES 个自定义模板"))
            }

            // Check for duplicate ID
            val existingIndex = templates.indexOfFirst { it.id == template.id }
            if (existingIndex >= 0) {
                templates[existingIndex] = template
            } else {
                templates.add(template)
            }

            saveTemplatesToFile(templates)
            customTemplatesCache = templates

            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Failed to save custom template")
            Result.failure(e)
        }
    }

    /**
     * Delete a custom template
     */
    suspend fun deleteCustomTemplate(templateId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val templates = getCustomTemplates().toMutableList()
            val removed = templates.removeAll { it.id == templateId }

            if (removed) {
                saveTemplatesToFile(templates)
                customTemplatesCache = templates
                Result.success(Unit)
            } else {
                Result.failure(Exception("模板不存在"))
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to delete custom template")
            Result.failure(e)
        }
    }

    /**
     * Create a template from an existing project
     */
    suspend fun createTemplateFromProject(
        projectName: String,
        files: List<TemplateFile>,
        folders: List<String>,
        templateName: String,
        description: String,
        category: TemplateCategory,
        tags: List<String> = emptyList()
    ): ProjectTemplate {
        return ProjectTemplate(
            id = "custom-${UUID.randomUUID().toString().take(8)}",
            name = templateName,
            description = description,
            icon = getCategoryIcon(category),
            category = category,
            type = getCategoryType(category),
            tags = tags + listOf("custom"),
            structure = ProjectStructure(
                folders = folders,
                files = files
            ),
            metadata = mapOf(
                "createdFrom" to projectName,
                "createdAt" to System.currentTimeMillis().toString()
            )
        )
    }

    // --- Import/Export ---

    /**
     * Export template to JSON string
     */
    fun exportTemplate(template: ProjectTemplate): String {
        val data = CustomTemplateData.fromProjectTemplate(template)
        return gson.toJson(data)
    }

    /**
     * Export all custom templates
     */
    suspend fun exportAllCustomTemplates(): String = withContext(Dispatchers.IO) {
        val templates = getCustomTemplates()
        val data = templates.map { CustomTemplateData.fromProjectTemplate(it) }
        gson.toJson(data)
    }

    /**
     * Import template from JSON string
     */
    suspend fun importTemplate(json: String): Result<ProjectTemplate> = withContext(Dispatchers.IO) {
        try {
            val data: CustomTemplateData = gson.fromJson(json, CustomTemplateData::class.java)
            val template = data.toProjectTemplate()

            // Generate new ID to avoid conflicts
            val importedTemplate = template.copy(
                id = "imported-${UUID.randomUUID().toString().take(8)}",
                tags = template.tags + "imported"
            )

            saveCustomTemplate(importedTemplate)
            Result.success(importedTemplate)
        } catch (e: Exception) {
            Timber.e(e, "Failed to import template")
            Result.failure(e)
        }
    }

    /**
     * Import multiple templates
     */
    suspend fun importTemplates(json: String): Result<Int> = withContext(Dispatchers.IO) {
        try {
            val type = object : TypeToken<List<CustomTemplateData>>() {}.type
            val dataList: List<CustomTemplateData> = gson.fromJson(json, type)

            var importedCount = 0
            for (data in dataList) {
                val template = data.toProjectTemplate()
                val importedTemplate = template.copy(
                    id = "imported-${UUID.randomUUID().toString().take(8)}"
                )
                saveCustomTemplate(importedTemplate).onSuccess { importedCount++ }
            }

            Result.success(importedCount)
        } catch (e: Exception) {
            Timber.e(e, "Failed to import templates")
            Result.failure(e)
        }
    }

    // --- Template Preview ---

    /**
     * Generate preview of template structure
     */
    fun generateTemplatePreview(template: ProjectTemplate): TemplatePreview {
        val structure = template.structure
        val tree = buildString {
            appendLine(template.name)
            appendLine("├── Structure:")

            // Folders
            structure.folders.sorted().forEachIndexed { index, folder ->
                val prefix = if (index == structure.folders.lastIndex && structure.files.isEmpty()) "└──" else "├──"
                appendLine("│   $prefix 📁 $folder/")
            }

            // Files
            structure.files.sortedBy { it.path }.forEachIndexed { index, file ->
                val prefix = if (index == structure.files.lastIndex) "└──" else "├──"
                val icon = getFileIcon(file.path)
                appendLine("│   $prefix $icon ${file.path}")
            }
        }

        return TemplatePreview(
            template = template,
            structureTree = tree,
            fileCount = structure.files.size,
            folderCount = structure.folders.size,
            estimatedSize = structure.files.sumOf { it.content.length },
            languages = detectLanguages(structure.files)
        )
    }

    // --- Private helpers ---

    private fun saveTemplatesToFile(templates: List<ProjectTemplate>) {
        val data = templates.map { CustomTemplateData.fromProjectTemplate(it) }
        val json = gson.toJson(data)
        File(context.filesDir, CUSTOM_TEMPLATES_FILE).writeText(json)
    }

    private fun calculateRecommendationScore(description: String, template: ProjectTemplate): Int {
        val lowerDesc = description.lowercase()
        var score = 0

        // Check template name
        if (template.name.lowercase() in lowerDesc) score += 30

        // Check tags
        template.tags.forEach { tag ->
            if (tag.lowercase() in lowerDesc) score += 20
        }

        // Check keywords
        val keywords = mapOf(
            "android" to listOf("android", "mobile", "app", "kotlin", "安卓", "移动应用"),
            "web" to listOf("web", "react", "vue", "frontend", "前端", "网页"),
            "backend" to listOf("api", "server", "backend", "后端", "服务"),
            "python" to listOf("python", "data", "ml", "数据", "机器学习"),
            "flutter" to listOf("flutter", "dart", "cross-platform", "跨平台")
        )

        keywords.forEach { (templateType, kws) ->
            if (template.category.name.lowercase().contains(templateType) ||
                template.type.lowercase().contains(templateType)) {
                kws.forEach { kw ->
                    if (kw in lowerDesc) score += 15
                }
            }
        }

        return score
    }

    private fun generateRecommendationReason(
        description: String,
        template: ProjectTemplate,
        score: Int
    ): String {
        return when {
            score >= 50 -> "非常匹配您的需求"
            score >= 30 -> "与您的描述相关"
            else -> "可能适合您的项目"
        }
    }

    private suspend fun enhanceRecommendationsWithLLM(
        adapter: LLMAdapter,
        description: String,
        recommendations: List<TemplateRecommendation>
    ): List<TemplateRecommendation> {
        // Simple enhancement - could add LLM-based reasoning in future
        return recommendations
    }

    private fun buildTemplateGenerationPrompt(description: String, projectType: String?): String {
        return buildString {
            appendLine("请根据以下项目描述生成一个项目模板结构：")
            appendLine()
            appendLine("项目描述：$description")
            if (projectType != null) {
                appendLine("项目类型：$projectType")
            }
            appendLine()
            appendLine("请返回JSON格式的模板结构，包含以下字段：")
            appendLine("- name: 模板名称")
            appendLine("- description: 模板描述")
            appendLine("- category: 类别 (ANDROID/WEB/BACKEND/DATA_SCIENCE/MOBILE/OTHER)")
            appendLine("- folders: 文件夹列表")
            appendLine("- files: 文件列表，每个包含 path 和 content")
        }
    }

    private fun parseTemplateFromLLMResponse(response: String, description: String): ProjectTemplate? {
        try {
            // Try to extract JSON from response
            val jsonStart = response.indexOf("{")
            val jsonEnd = response.lastIndexOf("}") + 1

            if (jsonStart >= 0 && jsonEnd > jsonStart) {
                val json = response.substring(jsonStart, jsonEnd)
                val data: LLMTemplateResponse = gson.fromJson(json, LLMTemplateResponse::class.java)

                return ProjectTemplate(
                    id = "ai-${UUID.randomUUID().toString().take(8)}",
                    name = data.name ?: "AI Generated Template",
                    description = data.description ?: description,
                    icon = "🤖",
                    category = parseCategory(data.category),
                    type = getCategoryType(parseCategory(data.category)),
                    tags = listOf("ai-generated"),
                    structure = ProjectStructure(
                        folders = data.folders ?: emptyList(),
                        files = data.files?.map { TemplateFile(it.path, it.content ?: "") } ?: emptyList()
                    )
                )
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to parse LLM response")
        }
        return null
    }

    private fun parseCategory(category: String?): TemplateCategory {
        return try {
            category?.let { TemplateCategory.valueOf(it.uppercase()) } ?: TemplateCategory.OTHER
        } catch (e: Exception) {
            TemplateCategory.OTHER
        }
    }

    private fun getCategoryIcon(category: TemplateCategory): String {
        return when (category) {
            TemplateCategory.ANDROID -> "🤖"
            TemplateCategory.WEB -> "🌐"
            TemplateCategory.BACKEND -> "⚙️"
            TemplateCategory.DATA_SCIENCE -> "📊"
            TemplateCategory.MOBILE -> "📱"
            TemplateCategory.DESKTOP -> "💻"
            TemplateCategory.LIBRARY -> "📚"
            TemplateCategory.MULTIPLATFORM -> "🔄"
            TemplateCategory.FLUTTER -> "🐦"
            TemplateCategory.OTHER -> "📄"
        }
    }

    private fun getCategoryType(category: TemplateCategory): String {
        return when (category) {
            TemplateCategory.ANDROID -> "android"
            TemplateCategory.WEB -> "web"
            TemplateCategory.BACKEND -> "backend"
            TemplateCategory.DATA_SCIENCE -> "data_science"
            TemplateCategory.MOBILE -> "mobile"
            TemplateCategory.DESKTOP -> "desktop"
            TemplateCategory.LIBRARY -> "library"
            TemplateCategory.MULTIPLATFORM -> "multiplatform"
            TemplateCategory.FLUTTER -> "flutter"
            TemplateCategory.OTHER -> "other"
        }
    }

    private fun getFileIcon(path: String): String {
        val ext = path.substringAfterLast('.', "").lowercase()
        return when (ext) {
            "kt", "kts" -> "🟣"
            "java" -> "☕"
            "js", "jsx" -> "🟨"
            "ts", "tsx" -> "🔷"
            "py" -> "🐍"
            "json" -> "📋"
            "xml" -> "📰"
            "md" -> "📝"
            "yaml", "yml" -> "⚙️"
            "html" -> "🌐"
            "css", "scss" -> "🎨"
            "gradle" -> "🐘"
            else -> "📄"
        }
    }

    private fun detectLanguages(files: List<TemplateFile>): List<String> {
        val languages = mutableSetOf<String>()
        files.forEach { file ->
            val ext = file.path.substringAfterLast('.', "").lowercase()
            when (ext) {
                "kt", "kts" -> languages.add("Kotlin")
                "java" -> languages.add("Java")
                "js", "jsx" -> languages.add("JavaScript")
                "ts", "tsx" -> languages.add("TypeScript")
                "py" -> languages.add("Python")
                "swift" -> languages.add("Swift")
                "dart" -> languages.add("Dart")
                "go" -> languages.add("Go")
                "rs" -> languages.add("Rust")
            }
        }
        return languages.toList()
    }
}

// --- Data classes ---

data class TemplateRecommendation(
    val template: ProjectTemplate,
    val score: Int,
    val reason: String
)

data class GeneratedTemplateResult(
    val success: Boolean,
    val template: ProjectTemplate?,
    val isAIGenerated: Boolean,
    val message: String
)

data class TemplatePreview(
    val template: ProjectTemplate,
    val structureTree: String,
    val fileCount: Int,
    val folderCount: Int,
    val estimatedSize: Int,
    val languages: List<String>
)

/**
 * Serializable template data for storage
 */
data class CustomTemplateData(
    val id: String,
    val name: String,
    val description: String,
    val icon: String,
    val category: String,
    val type: String,
    val tags: List<String>,
    val folders: List<String>,
    val files: List<CustomTemplateFileData>,
    val metadata: Map<String, String>
) {
    fun toProjectTemplate(): ProjectTemplate {
        return ProjectTemplate(
            id = id,
            name = name,
            description = description,
            icon = icon,
            category = try { TemplateCategory.valueOf(category) } catch (e: Exception) { TemplateCategory.OTHER },
            type = type,
            tags = tags,
            structure = ProjectStructure(
                folders = folders,
                files = files.map { TemplateFile(it.path, it.content, it.isExecutable) }
            ),
            metadata = metadata
        )
    }

    companion object {
        fun fromProjectTemplate(template: ProjectTemplate): CustomTemplateData {
            return CustomTemplateData(
                id = template.id,
                name = template.name,
                description = template.description,
                icon = template.icon,
                category = template.category.name,
                type = template.type,
                tags = template.tags,
                folders = template.structure.folders,
                files = template.structure.files.map {
                    CustomTemplateFileData(it.path, it.content, it.isExecutable)
                },
                metadata = template.metadata
            )
        }
    }
}

data class CustomTemplateFileData(
    val path: String,
    val content: String,
    val isExecutable: Boolean = false
)

/**
 * LLM response structure for template generation
 */
data class LLMTemplateResponse(
    val name: String?,
    val description: String?,
    val category: String?,
    val folders: List<String>?,
    val files: List<LLMTemplateFile>?
)

data class LLMTemplateFile(
    val path: String,
    val content: String?
)
