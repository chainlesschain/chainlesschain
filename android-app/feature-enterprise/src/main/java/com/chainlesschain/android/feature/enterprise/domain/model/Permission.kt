package com.chainlesschain.android.feature.enterprise.domain.model

import kotlinx.serialization.Serializable

/**
 * Enterprise permissions (40+ permissions)
 * Based on iOS RBAC system
 */
@Serializable
enum class Permission(
    val category: PermissionCategory,
    val description: String,
    val isAdmin: Boolean = false
) {
    // ==================== Knowledge Base ====================
    KNOWLEDGE_VIEW(PermissionCategory.KNOWLEDGE, "View knowledge items"),
    KNOWLEDGE_CREATE(PermissionCategory.KNOWLEDGE, "Create knowledge items"),
    KNOWLEDGE_EDIT(PermissionCategory.KNOWLEDGE, "Edit knowledge items"),
    KNOWLEDGE_DELETE(PermissionCategory.KNOWLEDGE, "Delete knowledge items"),
    KNOWLEDGE_SHARE(PermissionCategory.KNOWLEDGE, "Share knowledge items"),
    KNOWLEDGE_EXPORT(PermissionCategory.KNOWLEDGE, "Export knowledge items"),
    KNOWLEDGE_IMPORT(PermissionCategory.KNOWLEDGE, "Import knowledge items"),

    // ==================== Projects ====================
    PROJECT_VIEW(PermissionCategory.PROJECT, "View projects"),
    PROJECT_CREATE(PermissionCategory.PROJECT, "Create projects"),
    PROJECT_EDIT(PermissionCategory.PROJECT, "Edit projects"),
    PROJECT_DELETE(PermissionCategory.PROJECT, "Delete projects"),
    PROJECT_ARCHIVE(PermissionCategory.PROJECT, "Archive projects"),
    PROJECT_MEMBER_MANAGE(PermissionCategory.PROJECT, "Manage project members"),

    // ==================== Tasks ====================
    TASK_VIEW(PermissionCategory.TASK, "View tasks"),
    TASK_CREATE(PermissionCategory.TASK, "Create tasks"),
    TASK_EDIT(PermissionCategory.TASK, "Edit tasks"),
    TASK_DELETE(PermissionCategory.TASK, "Delete tasks"),
    TASK_ASSIGN(PermissionCategory.TASK, "Assign tasks to users"),
    TASK_STATUS_CHANGE(PermissionCategory.TASK, "Change task status"),

    // ==================== AI Features ====================
    AI_CHAT(PermissionCategory.AI, "Use AI chat"),
    AI_GENERATE(PermissionCategory.AI, "Generate AI content"),
    AI_ANALYZE(PermissionCategory.AI, "Use AI analysis"),
    AI_CONFIG(PermissionCategory.AI, "Configure AI settings", isAdmin = true),

    // ==================== Blockchain ====================
    BLOCKCHAIN_VIEW(PermissionCategory.BLOCKCHAIN, "View blockchain data"),
    BLOCKCHAIN_TRANSACT(PermissionCategory.BLOCKCHAIN, "Execute blockchain transactions"),
    BLOCKCHAIN_WALLET_MANAGE(PermissionCategory.BLOCKCHAIN, "Manage wallets"),
    BLOCKCHAIN_CONTRACT_DEPLOY(PermissionCategory.BLOCKCHAIN, "Deploy smart contracts"),
    BLOCKCHAIN_NFT_MANAGE(PermissionCategory.BLOCKCHAIN, "Manage NFTs"),

    // ==================== Social ====================
    SOCIAL_POST(PermissionCategory.SOCIAL, "Create posts"),
    SOCIAL_COMMENT(PermissionCategory.SOCIAL, "Comment on posts"),
    SOCIAL_MODERATE(PermissionCategory.SOCIAL, "Moderate content", isAdmin = true),

    // ==================== Team Management ====================
    TEAM_VIEW(PermissionCategory.TEAM, "View teams"),
    TEAM_CREATE(PermissionCategory.TEAM, "Create teams"),
    TEAM_EDIT(PermissionCategory.TEAM, "Edit teams"),
    TEAM_DELETE(PermissionCategory.TEAM, "Delete teams"),
    TEAM_MEMBER_MANAGE(PermissionCategory.TEAM, "Manage team members"),

    // ==================== User Management ====================
    USER_VIEW(PermissionCategory.USER, "View user profiles"),
    USER_INVITE(PermissionCategory.USER, "Invite new users", isAdmin = true),
    USER_EDIT(PermissionCategory.USER, "Edit user profiles", isAdmin = true),
    USER_DEACTIVATE(PermissionCategory.USER, "Deactivate users", isAdmin = true),

    // ==================== Role Management ====================
    ROLE_VIEW(PermissionCategory.ROLE, "View roles"),
    ROLE_CREATE(PermissionCategory.ROLE, "Create roles", isAdmin = true),
    ROLE_EDIT(PermissionCategory.ROLE, "Edit roles", isAdmin = true),
    ROLE_DELETE(PermissionCategory.ROLE, "Delete roles", isAdmin = true),
    ROLE_ASSIGN(PermissionCategory.ROLE, "Assign roles to users", isAdmin = true),

    // ==================== Organization ====================
    ORG_SETTINGS_VIEW(PermissionCategory.ORGANIZATION, "View organization settings"),
    ORG_SETTINGS_EDIT(PermissionCategory.ORGANIZATION, "Edit organization settings", isAdmin = true),
    ORG_BILLING_VIEW(PermissionCategory.ORGANIZATION, "View billing information", isAdmin = true),
    ORG_BILLING_MANAGE(PermissionCategory.ORGANIZATION, "Manage billing", isAdmin = true),

    // ==================== Audit & Security ====================
    AUDIT_VIEW(PermissionCategory.AUDIT, "View audit logs", isAdmin = true),
    AUDIT_EXPORT(PermissionCategory.AUDIT, "Export audit logs", isAdmin = true),
    SECURITY_SETTINGS(PermissionCategory.AUDIT, "Manage security settings", isAdmin = true),

    // ==================== System ====================
    SYSTEM_ADMIN(PermissionCategory.SYSTEM, "Full system access", isAdmin = true);

    companion object {
        /**
         * Get permissions by category
         */
        fun byCategory(category: PermissionCategory): List<Permission> {
            return entries.filter { it.category == category }
        }

        /**
         * Get all admin permissions
         */
        fun adminPermissions(): List<Permission> {
            return entries.filter { it.isAdmin }
        }

        /**
         * Get all non-admin permissions
         */
        fun regularPermissions(): List<Permission> {
            return entries.filter { !it.isAdmin }
        }
    }
}

/**
 * Permission categories
 */
@Serializable
enum class PermissionCategory(val displayName: String) {
    KNOWLEDGE("Knowledge Base"),
    PROJECT("Projects"),
    TASK("Tasks"),
    AI("AI Features"),
    BLOCKCHAIN("Blockchain"),
    SOCIAL("Social"),
    TEAM("Team Management"),
    USER("User Management"),
    ROLE("Role Management"),
    ORGANIZATION("Organization"),
    AUDIT("Audit & Security"),
    SYSTEM("System")
}

/**
 * Permission grant to a user/role
 */
@Serializable
data class PermissionGrant(
    val id: String,
    val permission: Permission,
    val granteeType: GranteeType,
    val granteeId: String, // User ID or Role ID
    val resourceType: String? = null, // e.g., "project", "knowledge"
    val resourceId: String? = null, // Specific resource ID
    val grantedBy: String,
    val grantedAt: Long = System.currentTimeMillis(),
    val expiresAt: Long? = null,
    val isActive: Boolean = true
) {
    /**
     * Check if grant is expired
     */
    val isExpired: Boolean
        get() = expiresAt?.let { System.currentTimeMillis() > it } ?: false

    /**
     * Check if grant is valid (active and not expired)
     */
    val isValid: Boolean
        get() = isActive && !isExpired
}

/**
 * Grantee type
 */
@Serializable
enum class GranteeType {
    USER,
    ROLE,
    TEAM
}

/**
 * Permission delegation (temporary permission grant)
 */
@Serializable
data class PermissionDelegation(
    val id: String,
    val permission: Permission,
    val delegatorId: String,
    val delegateeId: String,
    val resourceType: String? = null,
    val resourceId: String? = null,
    val reason: String? = null,
    val startAt: Long = System.currentTimeMillis(),
    val expiresAt: Long,
    val isRevoked: Boolean = false,
    val revokedAt: Long? = null,
    val createdAt: Long = System.currentTimeMillis()
) {
    /**
     * Check if delegation is active
     */
    val isActive: Boolean
        get() = !isRevoked &&
                System.currentTimeMillis() >= startAt &&
                System.currentTimeMillis() < expiresAt
}

/**
 * Permission check result
 */
@Serializable
data class PermissionCheckResult(
    val hasPermission: Boolean,
    val grantSource: GrantSource? = null,
    val grantId: String? = null,
    val expiresAt: Long? = null
)

/**
 * Source of permission grant
 */
@Serializable
enum class GrantSource {
    DIRECT,      // Direct user permission
    ROLE,        // Through role membership
    TEAM,        // Through team membership
    INHERITANCE, // Through resource inheritance
    DELEGATION   // Through temporary delegation
}
