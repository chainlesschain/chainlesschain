package com.chainlesschain.android.feature.ai.cowork.sandbox

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * File Sandbox
 *
 * Provides secure, sandboxed file access for Cowork agents.
 * Enforces permissions and blocks access to sensitive files.
 */
@Singleton
class FileSandbox @Inject constructor() {

    companion object {
        private const val TAG = "FileSandbox"

        /**
         * Sensitive file patterns that are always blocked
         */
        val SENSITIVE_PATTERNS = listOf(
            // Credentials and keys
            """\.env$""",
            """\.env\..+$""",
            """credentials\.json$""",
            """secrets\.json$""",
            """\.pem$""",
            """\.key$""",
            """\.keystore$""",
            """\.jks$""",
            """id_rsa.*$""",
            """\.ssh/.*$""",

            // Configuration files with secrets
            """application-prod\.ya?ml$""",
            """.*secret.*\.json$""",
            """.*password.*\.(txt|json|ya?ml)$""",
            """.*token.*\.(txt|json|ya?ml)$""",
            """.*api.?key.*\.(txt|json|ya?ml)$""",

            // Database files
            """.*\.sqlite$""",
            """.*\.db$""",

            // System files
            """/etc/passwd$""",
            """/etc/shadow$""",
            """\.bash_history$""",
            """\.zsh_history$""",

            // Android specific
            """shared_prefs/.*\.xml$""",
            """databases/.*$"""
        ).map { Regex(it, RegexOption.IGNORE_CASE) }
    }

    // Agent permissions: agentId -> (basePath -> permission)
    private val permissions = ConcurrentHashMap<String, MutableMap<String, SandboxPermission>>()

    // Audit log
    private val auditLog = mutableListOf<AuditEntry>()
    private val auditMutex = Mutex()

    // Maximum audit log size
    private val maxAuditSize = 10000

    // ===== Permission Management =====

    /**
     * Grant permission to an agent for a path
     */
    fun grantPermission(
        agentId: String,
        basePath: String,
        permission: SandboxPermission
    ) {
        val agentPerms = permissions.getOrPut(agentId) { mutableMapOf() }
        agentPerms[normalizeBasePath(basePath)] = permission
        Log.d(TAG, "Granted $permission to agent $agentId for $basePath")
    }

    /**
     * Revoke all permissions from an agent
     */
    fun revokeAllPermissions(agentId: String) {
        permissions.remove(agentId)
        Log.d(TAG, "Revoked all permissions from agent $agentId")
    }

    /**
     * Revoke permission for a specific path
     */
    fun revokePermission(agentId: String, basePath: String) {
        permissions[agentId]?.remove(normalizeBasePath(basePath))
    }

    /**
     * Check if agent has permission for a path
     */
    fun hasPermission(
        agentId: String,
        filePath: String,
        requiredPermission: SandboxPermission
    ): Boolean {
        // Check sensitive patterns first
        if (isSensitivePath(filePath)) {
            return false
        }

        val agentPerms = permissions[agentId] ?: return false
        val normalizedPath = normalizePath(filePath)

        // Find the most specific matching permission
        val matchingPerm = agentPerms.entries
            .filter { normalizedPath.startsWith(it.key) }
            .maxByOrNull { it.key.length }
            ?.value

        return matchingPerm?.includes(requiredPermission) ?: false
    }

    // ===== File Operations =====

    /**
     * Read a file
     */
    suspend fun readFile(
        agentId: String,
        filePath: String
    ): Result<String> = withContext(Dispatchers.IO) {
        val allowed = hasPermission(agentId, filePath, SandboxPermission.READ)
        logAudit(agentId, AuditOperation.READ, filePath, allowed,
            if (!allowed) "Permission denied" else null)

        if (!allowed) {
            return@withContext Result.failure(SecurityException("Read permission denied for $filePath"))
        }

        try {
            val content = File(filePath).readText()
            Result.success(content)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Write to a file
     */
    suspend fun writeFile(
        agentId: String,
        filePath: String,
        content: String
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val allowed = hasPermission(agentId, filePath, SandboxPermission.WRITE)
        logAudit(agentId, AuditOperation.WRITE, filePath, allowed,
            if (!allowed) "Permission denied" else null)

        if (!allowed) {
            return@withContext Result.failure(SecurityException("Write permission denied for $filePath"))
        }

        try {
            File(filePath).apply {
                parentFile?.mkdirs()
                writeText(content)
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Delete a file
     */
    suspend fun deleteFile(
        agentId: String,
        filePath: String
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val allowed = hasPermission(agentId, filePath, SandboxPermission.WRITE)
        logAudit(agentId, AuditOperation.DELETE, filePath, allowed,
            if (!allowed) "Permission denied" else null)

        if (!allowed) {
            return@withContext Result.failure(SecurityException("Delete permission denied for $filePath"))
        }

        try {
            val file = File(filePath)
            if (file.exists()) {
                file.delete()
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * List directory contents
     */
    suspend fun listDirectory(
        agentId: String,
        dirPath: String
    ): Result<List<String>> = withContext(Dispatchers.IO) {
        val allowed = hasPermission(agentId, dirPath, SandboxPermission.READ)
        logAudit(agentId, AuditOperation.LIST, dirPath, allowed,
            if (!allowed) "Permission denied" else null)

        if (!allowed) {
            return@withContext Result.failure(SecurityException("List permission denied for $dirPath"))
        }

        try {
            val dir = File(dirPath)
            if (!dir.isDirectory) {
                return@withContext Result.failure(IllegalArgumentException("Not a directory: $dirPath"))
            }
            val files = dir.listFiles()?.map { it.name } ?: emptyList()
            Result.success(files)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Check if a file exists
     */
    suspend fun exists(
        agentId: String,
        filePath: String
    ): Result<Boolean> = withContext(Dispatchers.IO) {
        val allowed = hasPermission(agentId, filePath, SandboxPermission.READ)
        if (!allowed) {
            return@withContext Result.failure(SecurityException("Permission denied for $filePath"))
        }

        try {
            Result.success(File(filePath).exists())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ===== Sensitive Path Detection =====

    /**
     * Check if a path matches sensitive patterns
     */
    fun isSensitivePath(filePath: String): Boolean {
        return SENSITIVE_PATTERNS.any { pattern ->
            pattern.containsMatchIn(filePath)
        }
    }

    /**
     * Add a custom sensitive pattern
     */
    fun addSensitivePattern(pattern: String) {
        // This would require making SENSITIVE_PATTERNS mutable
        // For now, log a warning
        Log.w(TAG, "Custom sensitive patterns not yet supported: $pattern")
    }

    // ===== Audit Log =====

    /**
     * Get audit entries for an agent
     */
    suspend fun getAuditLog(agentId: String? = null): List<AuditEntry> = auditMutex.withLock {
        if (agentId != null) {
            auditLog.filter { it.agentId == agentId }
        } else {
            auditLog.toList()
        }
    }

    /**
     * Get recent denials
     */
    suspend fun getRecentDenials(limit: Int = 100): List<AuditEntry> = auditMutex.withLock {
        auditLog.filter { !it.allowed }
            .takeLast(limit)
    }

    /**
     * Clear audit log
     */
    suspend fun clearAuditLog() = auditMutex.withLock {
        auditLog.clear()
    }

    // ===== Private Helpers =====

    private suspend fun logAudit(
        agentId: String,
        operation: AuditOperation,
        filePath: String,
        allowed: Boolean,
        denialReason: String?
    ) = auditMutex.withLock {
        val entry = AuditEntry(
            agentId = agentId,
            operation = operation,
            filePath = filePath,
            allowed = allowed,
            denialReason = denialReason
        )

        auditLog.add(entry)

        // Trim audit log if too large
        while (auditLog.size > maxAuditSize) {
            auditLog.removeAt(0)
        }

        if (!allowed) {
            Log.w(TAG, "Denied $operation on $filePath for agent $agentId: $denialReason")
        }
    }

    private fun normalizePath(path: String): String {
        return path.replace("\\", "/").trimEnd('/')
    }

    private fun normalizeBasePath(path: String): String {
        return normalizePath(path) + "/"
    }
}
