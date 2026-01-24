package com.chainlesschain.android.feature.project.util

import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.feature.project.model.CreateProjectRequest
import com.chainlesschain.android.feature.project.model.ProjectTemplate
import java.util.UUID

/**
 * Project template manager
 *
 * Handles applying templates to create project structures
 */
class ProjectTemplateManager {

    /**
     * Apply template to create project request
     */
    fun applyTemplate(
        template: ProjectTemplate,
        projectName: String,
        userId: String,
        rootPath: String? = null
    ): CreateProjectResult {
        val projectId = UUID.randomUUID().toString()

        // Create project request with template metadata
        val projectRequest = CreateProjectRequest(
            name = projectName,
            description = template.description,
            type = template.type,
            userId = userId,
            rootPath = rootPath,
            icon = template.icon,
            tags = template.tags
        )

        // Generate files from template
        val files = generateFilesFromTemplate(template, projectId)

        return CreateProjectResult(
            projectId = projectId,
            projectRequest = projectRequest,
            files = files,
            folders = template.structure.folders
        )
    }

    /**
     * Generate file entities from template
     */
    private fun generateFilesFromTemplate(
        template: ProjectTemplate,
        projectId: String
    ): List<ProjectFileEntity> {
        val files = mutableListOf<ProjectFileEntity>()
        val now = System.currentTimeMillis()

        // Create folders as file entities
        template.structure.folders.forEach { folderPath ->
            files.add(
                ProjectFileEntity(
                    id = UUID.randomUUID().toString(),
                    projectId = projectId,
                    name = folderPath.substringAfterLast('/'),
                    path = folderPath,
                    type = "folder",
                    extension = null,
                    size = 0,
                    content = null,
                    hash = null,
                    mimeType = null,
                    parentId = getParentId(folderPath, files),
                    isOpen = false,
                    isDirty = false,
                    lastAccessedAt = null,
                    createdAt = now,
                    updatedAt = now
                )
            )
        }

        // Create files from template
        template.structure.files.forEach { templateFile ->
            val content = templateFile.content
            val extension = templateFile.path.substringAfterLast('.', "")
            val size = content.toByteArray().size.toLong()

            files.add(
                ProjectFileEntity(
                    id = UUID.randomUUID().toString(),
                    projectId = projectId,
                    name = templateFile.path.substringAfterLast('/'),
                    path = templateFile.path,
                    type = "file",
                    extension = extension.ifEmpty { null },
                    size = size,
                    content = content,
                    hash = calculateHash(content),
                    mimeType = getMimeType(extension),
                    parentId = getParentId(templateFile.path, files),
                    isOpen = false,
                    isDirty = false,
                    lastAccessedAt = null,
                    createdAt = now,
                    updatedAt = now
                )
            )
        }

        return files
    }

    /**
     * Find parent folder ID for a path
     */
    private fun getParentId(path: String, existingFiles: List<ProjectFileEntity>): String? {
        if (!path.contains('/')) return null

        val parentPath = path.substringBeforeLast('/')
        return existingFiles.find { it.path == parentPath && it.type == "folder" }?.id
    }

    /**
     * Calculate file hash (simple MD5-like)
     */
    private fun calculateHash(content: String): String {
        return content.hashCode().toString(16)
    }

    /**
     * Get MIME type based on extension
     */
    private fun getMimeType(extension: String?): String? {
        return when (extension?.lowercase()) {
            "kt", "java", "py", "js", "ts", "tsx", "jsx" -> "text/plain"
            "json" -> "application/json"
            "xml" -> "application/xml"
            "md" -> "text/markdown"
            "txt" -> "text/plain"
            "html" -> "text/html"
            "css" -> "text/css"
            "yaml", "yml" -> "text/yaml"
            "gradle" -> "text/plain"
            "kts" -> "text/plain"
            else -> null
        }
    }

    /**
     * Validate template structure
     */
    fun validateTemplate(template: ProjectTemplate): ValidationResult {
        val errors = mutableListOf<String>()

        // Check for empty name
        if (template.name.isBlank()) {
            errors.add("Template name cannot be empty")
        }

        // Check for duplicate file paths
        val filePaths = template.structure.files.map { it.path }
        val duplicates = filePaths.groupingBy { it }.eachCount().filter { it.value > 1 }
        if (duplicates.isNotEmpty()) {
            errors.add("Duplicate file paths: ${duplicates.keys.joinToString()}")
        }

        // Check file paths are valid (no absolute paths, no ..)
        template.structure.files.forEach { file ->
            if (file.path.startsWith("/") || file.path.contains("..")) {
                errors.add("Invalid file path: ${file.path}")
            }
        }

        // Check folder paths are valid
        template.structure.folders.forEach { folder ->
            if (folder.startsWith("/") || folder.contains("..")) {
                errors.add("Invalid folder path: $folder")
            }
        }

        return ValidationResult(
            isValid = errors.isEmpty(),
            errors = errors
        )
    }

    /**
     * Estimate template size
     */
    fun estimateTemplateSize(template: ProjectTemplate): TemplateSizeEstimate {
        val totalFiles = template.structure.files.size
        val totalFolders = template.structure.folders.size
        val totalBytes = template.structure.files.sumOf { it.content.toByteArray().size.toLong() }

        return TemplateSizeEstimate(
            fileCount = totalFiles,
            folderCount = totalFolders,
            totalBytes = totalBytes,
            readableSize = formatBytes(totalBytes)
        )
    }

    /**
     * Format bytes to human readable format
     */
    private fun formatBytes(bytes: Long): String {
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> "${bytes / 1024} KB"
            bytes < 1024 * 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
            else -> "${bytes / (1024 * 1024 * 1024)} GB"
        }
    }
}

/**
 * Result of applying a template
 */
data class CreateProjectResult(
    val projectId: String,
    val projectRequest: CreateProjectRequest,
    val files: List<ProjectFileEntity>,
    val folders: List<String>
)

/**
 * Template validation result
 */
data class ValidationResult(
    val isValid: Boolean,
    val errors: List<String> = emptyList()
)

/**
 * Template size estimate
 */
data class TemplateSizeEstimate(
    val fileCount: Int,
    val folderCount: Int,
    val totalBytes: Long,
    val readableSize: String
)
