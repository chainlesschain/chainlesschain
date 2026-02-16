package com.chainlesschain.android.feature.project.git

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Git Manager
 *
 * Provides Git operations for project version control:
 * - Repository initialization and status
 * - Staging and unstaging files
 * - Commit with message
 * - History viewing
 * - Diff viewing
 * - Branch management (basic)
 *
 * Note: Uses command-line git for now, can be replaced with JGit for pure Java implementation
 */
@Singleton
class GitManager @Inject constructor() {

    companion object {
        private const val TAG = "GitManager"
    }

    // Git status state
    private val _gitStatus = MutableStateFlow<GitStatus?>(null)
    val gitStatus: StateFlow<GitStatus?> = _gitStatus.asStateFlow()

    // Current operation state
    private val _operationState = MutableStateFlow<GitOperationState>(GitOperationState.Idle)
    val operationState: StateFlow<GitOperationState> = _operationState.asStateFlow()

    // Commit history
    private val _commitHistory = MutableStateFlow<List<GitCommit>>(emptyList())
    val commitHistory: StateFlow<List<GitCommit>> = _commitHistory.asStateFlow()

    /**
     * Check if directory is a Git repository
     */
    suspend fun isGitRepository(projectPath: String): Boolean = withContext(Dispatchers.IO) {
        val gitDir = File(projectPath, ".git")
        gitDir.exists() && gitDir.isDirectory
    }

    /**
     * Initialize a new Git repository
     */
    suspend fun initRepository(projectPath: String): GitResult = withContext(Dispatchers.IO) {
        _operationState.value = GitOperationState.Running("Initializing repository...")

        try {
            val result = executeGitCommand(projectPath, "init")
            if (result.success) {
                // Create initial .gitignore
                createDefaultGitignore(projectPath)
                refreshStatus(projectPath)
                GitResult.Success("Repository initialized successfully")
            } else {
                GitResult.Error("Failed to initialize: ${result.error}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Init failed", e)
            GitResult.Error(e.message ?: "Unknown error")
        } finally {
            _operationState.value = GitOperationState.Idle
        }
    }

    /**
     * Get repository status
     */
    suspend fun refreshStatus(projectPath: String): GitStatus = withContext(Dispatchers.IO) {
        try {
            val statusResult = executeGitCommand(projectPath, "status", "--porcelain=v1")
            val branchResult = executeGitCommand(projectPath, "branch", "--show-current")

            val files = parseStatusOutput(statusResult.output)
            val branch = branchResult.output.trim().ifEmpty { "main" }

            val status = GitStatus(
                isRepository = true,
                branch = branch,
                files = files,
                hasUncommittedChanges = files.isNotEmpty(),
                ahead = 0,
                behind = 0
            )

            _gitStatus.value = status
            status
        } catch (e: Exception) {
            Log.e(TAG, "Status refresh failed", e)
            GitStatus(isRepository = false)
        }
    }

    /**
     * Stage file for commit
     */
    suspend fun stageFile(projectPath: String, filePath: String): GitResult = withContext(Dispatchers.IO) {
        _operationState.value = GitOperationState.Running("Staging file...")

        try {
            val result = executeGitCommand(projectPath, "add", filePath)
            refreshStatus(projectPath)

            if (result.success) {
                GitResult.Success("File staged: $filePath")
            } else {
                GitResult.Error("Failed to stage: ${result.error}")
            }
        } finally {
            _operationState.value = GitOperationState.Idle
        }
    }

    /**
     * Stage all files
     */
    suspend fun stageAll(projectPath: String): GitResult = withContext(Dispatchers.IO) {
        _operationState.value = GitOperationState.Running("Staging all files...")

        try {
            val result = executeGitCommand(projectPath, "add", "-A")
            refreshStatus(projectPath)

            if (result.success) {
                GitResult.Success("All files staged")
            } else {
                GitResult.Error("Failed to stage files: ${result.error}")
            }
        } finally {
            _operationState.value = GitOperationState.Idle
        }
    }

    /**
     * Unstage file
     */
    suspend fun unstageFile(projectPath: String, filePath: String): GitResult = withContext(Dispatchers.IO) {
        _operationState.value = GitOperationState.Running("Unstaging file...")

        try {
            val result = executeGitCommand(projectPath, "reset", "HEAD", filePath)
            refreshStatus(projectPath)

            if (result.success) {
                GitResult.Success("File unstaged: $filePath")
            } else {
                GitResult.Error("Failed to unstage: ${result.error}")
            }
        } finally {
            _operationState.value = GitOperationState.Idle
        }
    }

    /**
     * Unstage all files
     */
    suspend fun unstageAll(projectPath: String): GitResult = withContext(Dispatchers.IO) {
        _operationState.value = GitOperationState.Running("Unstaging all files...")

        try {
            val result = executeGitCommand(projectPath, "reset", "HEAD")
            refreshStatus(projectPath)

            if (result.success) {
                GitResult.Success("All files unstaged")
            } else {
                GitResult.Error("Failed to unstage files: ${result.error}")
            }
        } finally {
            _operationState.value = GitOperationState.Idle
        }
    }

    /**
     * Create commit
     */
    suspend fun commit(projectPath: String, message: String): GitResult = withContext(Dispatchers.IO) {
        if (message.isBlank()) {
            return@withContext GitResult.Error("Commit message cannot be empty")
        }

        _operationState.value = GitOperationState.Running("Creating commit...")

        try {
            val result = executeGitCommand(projectPath, "commit", "-m", message)
            refreshStatus(projectPath)
            loadCommitHistory(projectPath)

            if (result.success) {
                GitResult.Success("Commit created successfully")
            } else {
                GitResult.Error("Failed to commit: ${result.error}")
            }
        } finally {
            _operationState.value = GitOperationState.Idle
        }
    }

    /**
     * Get file diff
     */
    suspend fun getFileDiff(projectPath: String, filePath: String, staged: Boolean = false): String = withContext(Dispatchers.IO) {
        try {
            val args = if (staged) {
                listOf("diff", "--cached", "--", filePath)
            } else {
                listOf("diff", "--", filePath)
            }

            val result = executeGitCommand(projectPath, *args.toTypedArray())
            result.output.ifEmpty { "No changes" }
        } catch (e: Exception) {
            Log.e(TAG, "Diff failed", e)
            "Error getting diff: ${e.message}"
        }
    }

    /**
     * Load commit history
     */
    suspend fun loadCommitHistory(
        projectPath: String,
        limit: Int = 50
    ): List<GitCommit> = withContext(Dispatchers.IO) {
        try {
            val format = "--pretty=format:%H|%h|%an|%ae|%at|%s"
            val result = executeGitCommand(projectPath, "log", format, "-n", limit.toString())

            if (!result.success) {
                return@withContext emptyList()
            }

            val commits = result.output.lines()
                .filter { it.isNotBlank() }
                .mapNotNull { line ->
                    try {
                        val parts = line.split("|")
                        if (parts.size >= 6) {
                            GitCommit(
                                hash = parts[0],
                                shortHash = parts[1],
                                authorName = parts[2],
                                authorEmail = parts[3],
                                timestamp = parts[4].toLongOrNull()?.times(1000) ?: 0,
                                message = parts.drop(5).joinToString("|")
                            )
                        } else null
                    } catch (e: Exception) {
                        null
                    }
                }

            _commitHistory.value = commits
            commits
        } catch (e: Exception) {
            Log.e(TAG, "Load history failed", e)
            emptyList()
        }
    }

    /**
     * Get commit details
     */
    suspend fun getCommitDetails(projectPath: String, commitHash: String): GitCommitDetails? = withContext(Dispatchers.IO) {
        try {
            // Get commit info
            val infoResult = executeGitCommand(
                projectPath, "show",
                "--pretty=format:%H|%an|%ae|%at|%cn|%ce|%ct|%B",
                "--no-patch",
                commitHash
            )

            if (!infoResult.success) return@withContext null

            val parts = infoResult.output.split("|")
            if (parts.size < 7) return@withContext null

            // Get changed files
            val filesResult = executeGitCommand(
                projectPath, "show",
                "--name-status",
                "--pretty=format:",
                commitHash
            )

            val changedFiles = filesResult.output.lines()
                .filter { it.isNotBlank() }
                .mapNotNull { line ->
                    val fileParts = line.split("\t")
                    if (fileParts.size >= 2) {
                        GitChangedFile(
                            path = fileParts[1],
                            status = parseFileStatus(fileParts[0])
                        )
                    } else null
                }

            GitCommitDetails(
                hash = parts[0],
                authorName = parts[1],
                authorEmail = parts[2],
                authorDate = parts[3].toLongOrNull()?.times(1000) ?: 0,
                committerName = parts[4],
                committerEmail = parts[5],
                committerDate = parts[6].toLongOrNull()?.times(1000) ?: 0,
                message = parts.drop(7).joinToString("|"),
                changedFiles = changedFiles
            )
        } catch (e: Exception) {
            Log.e(TAG, "Get commit details failed", e)
            null
        }
    }

    /**
     * Get branches
     */
    suspend fun getBranches(projectPath: String): List<GitBranch> = withContext(Dispatchers.IO) {
        try {
            val result = executeGitCommand(projectPath, "branch", "-a", "--format=%(refname:short)|%(objectname:short)|%(upstream:short)")

            result.output.lines()
                .filter { it.isNotBlank() }
                .map { line ->
                    val parts = line.split("|")
                    GitBranch(
                        name = parts.getOrElse(0) { "" },
                        shortHash = parts.getOrElse(1) { "" },
                        upstream = parts.getOrElse(2) { "" }.takeIf { it.isNotBlank() },
                        isCurrent = false,  // Will be determined separately
                        isRemote = parts.getOrElse(0) { "" }.startsWith("origin/")
                    )
                }
        } catch (e: Exception) {
            Log.e(TAG, "Get branches failed", e)
            emptyList()
        }
    }

    /**
     * Discard changes in file
     */
    suspend fun discardChanges(projectPath: String, filePath: String): GitResult = withContext(Dispatchers.IO) {
        _operationState.value = GitOperationState.Running("Discarding changes...")

        try {
            val result = executeGitCommand(projectPath, "checkout", "--", filePath)
            refreshStatus(projectPath)

            if (result.success) {
                GitResult.Success("Changes discarded: $filePath")
            } else {
                GitResult.Error("Failed to discard changes: ${result.error}")
            }
        } finally {
            _operationState.value = GitOperationState.Idle
        }
    }

    /**
     * Stash changes
     */
    suspend fun stash(projectPath: String, message: String? = null): GitResult = withContext(Dispatchers.IO) {
        _operationState.value = GitOperationState.Running("Stashing changes...")

        try {
            val args = if (message != null) {
                arrayOf("stash", "push", "-m", message)
            } else {
                arrayOf("stash")
            }

            val result = executeGitCommand(projectPath, *args)
            refreshStatus(projectPath)

            if (result.success) {
                GitResult.Success("Changes stashed")
            } else {
                GitResult.Error("Failed to stash: ${result.error}")
            }
        } finally {
            _operationState.value = GitOperationState.Idle
        }
    }

    /**
     * Apply stash
     */
    suspend fun stashPop(projectPath: String): GitResult = withContext(Dispatchers.IO) {
        _operationState.value = GitOperationState.Running("Applying stash...")

        try {
            val result = executeGitCommand(projectPath, "stash", "pop")
            refreshStatus(projectPath)

            if (result.success) {
                GitResult.Success("Stash applied")
            } else {
                GitResult.Error("Failed to apply stash: ${result.error}")
            }
        } finally {
            _operationState.value = GitOperationState.Idle
        }
    }

    // --- Private helpers ---

    private fun executeGitCommand(projectPath: String, vararg args: String): CommandResult {
        return try {
            val command = listOf("git") + args.toList()
            val processBuilder = ProcessBuilder(command)
                .directory(File(projectPath))
                .redirectErrorStream(false)

            val process = processBuilder.start()
            val output = process.inputStream.bufferedReader().use { it.readText() }
            val error = process.errorStream.bufferedReader().use { it.readText() }
            val exitCode = process.waitFor()

            CommandResult(
                success = exitCode == 0,
                output = output.trim(),
                error = error.trim(),
                exitCode = exitCode
            )
        } catch (e: Exception) {
            Log.e(TAG, "Command failed: ${args.joinToString(" ")}", e)
            CommandResult(
                success = false,
                output = "",
                error = e.message ?: "Command execution failed",
                exitCode = -1
            )
        }
    }

    private fun parseStatusOutput(output: String): List<GitFileStatus> {
        return output.lines()
            .filter { it.length >= 3 }
            .map { line ->
                val indexStatus = line[0]
                val workTreeStatus = line[1]
                val path = line.substring(3)

                GitFileStatus(
                    path = path,
                    indexStatus = parseStatusChar(indexStatus),
                    workTreeStatus = parseStatusChar(workTreeStatus),
                    isStaged = indexStatus != ' ' && indexStatus != '?',
                    isModified = workTreeStatus == 'M' || indexStatus == 'M',
                    isNew = indexStatus == 'A' || workTreeStatus == '?',
                    isDeleted = indexStatus == 'D' || workTreeStatus == 'D'
                )
            }
    }

    private fun parseStatusChar(char: Char): FileChangeType {
        return when (char) {
            'M' -> FileChangeType.MODIFIED
            'A' -> FileChangeType.ADDED
            'D' -> FileChangeType.DELETED
            'R' -> FileChangeType.RENAMED
            'C' -> FileChangeType.COPIED
            'U' -> FileChangeType.UNMERGED
            '?' -> FileChangeType.UNTRACKED
            '!' -> FileChangeType.IGNORED
            else -> FileChangeType.UNCHANGED
        }
    }

    private fun parseFileStatus(statusChar: String): FileChangeType {
        return when (statusChar.firstOrNull()) {
            'M' -> FileChangeType.MODIFIED
            'A' -> FileChangeType.ADDED
            'D' -> FileChangeType.DELETED
            'R' -> FileChangeType.RENAMED
            'C' -> FileChangeType.COPIED
            else -> FileChangeType.UNCHANGED
        }
    }

    private fun createDefaultGitignore(projectPath: String) {
        val gitignore = File(projectPath, ".gitignore")
        if (!gitignore.exists()) {
            gitignore.writeText("""
                # IDE
                .idea/
                *.iml
                .vscode/

                # Build
                build/
                out/
                target/

                # Dependencies
                node_modules/
                __pycache__/
                *.pyc
                .gradle/

                # Environment
                .env
                .env.local

                # OS
                .DS_Store
                Thumbs.db

                # Logs
                *.log
                logs/
            """.trimIndent())
        }
    }
}

// --- Data classes ---

data class GitStatus(
    val isRepository: Boolean,
    val branch: String = "",
    val files: List<GitFileStatus> = emptyList(),
    val hasUncommittedChanges: Boolean = false,
    val ahead: Int = 0,
    val behind: Int = 0
) {
    val stagedFiles: List<GitFileStatus>
        get() = files.filter { it.isStaged }

    val unstagedFiles: List<GitFileStatus>
        get() = files.filter { !it.isStaged && it.indexStatus != FileChangeType.UNTRACKED }

    val untrackedFiles: List<GitFileStatus>
        get() = files.filter { it.indexStatus == FileChangeType.UNTRACKED }
}

data class GitFileStatus(
    val path: String,
    val indexStatus: FileChangeType,
    val workTreeStatus: FileChangeType,
    val isStaged: Boolean,
    val isModified: Boolean,
    val isNew: Boolean,
    val isDeleted: Boolean
) {
    val displayStatus: String
        get() = when {
            isNew -> "New"
            isDeleted -> "Deleted"
            isModified -> "Modified"
            else -> "Changed"
        }

    val statusIcon: String
        get() = when {
            isNew -> "+"
            isDeleted -> "-"
            isModified -> "~"
            else -> "?"
        }
}

enum class FileChangeType {
    UNCHANGED, MODIFIED, ADDED, DELETED, RENAMED, COPIED, UNMERGED, UNTRACKED, IGNORED
}

data class GitCommit(
    val hash: String,
    val shortHash: String,
    val authorName: String,
    val authorEmail: String,
    val timestamp: Long,
    val message: String
) {
    val formattedDate: String
        get() {
            val format = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
            return format.format(Date(timestamp))
        }
}

data class GitCommitDetails(
    val hash: String,
    val authorName: String,
    val authorEmail: String,
    val authorDate: Long,
    val committerName: String,
    val committerEmail: String,
    val committerDate: Long,
    val message: String,
    val changedFiles: List<GitChangedFile>
)

data class GitChangedFile(
    val path: String,
    val status: FileChangeType
)

data class GitBranch(
    val name: String,
    val shortHash: String,
    val upstream: String?,
    val isCurrent: Boolean,
    val isRemote: Boolean
)

sealed class GitResult {
    data class Success(val message: String) : GitResult()
    data class Error(val message: String) : GitResult()
}

sealed class GitOperationState {
    object Idle : GitOperationState()
    data class Running(val message: String) : GitOperationState()
}

private data class CommandResult(
    val success: Boolean,
    val output: String,
    val error: String,
    val exitCode: Int
)
