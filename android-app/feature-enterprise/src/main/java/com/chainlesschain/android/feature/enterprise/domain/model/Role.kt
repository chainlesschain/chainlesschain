package com.chainlesschain.android.feature.enterprise.domain.model

import kotlinx.serialization.Serializable

/**
 * Organization role
 */
@Serializable
data class Role(
    val id: String,
    val name: String,
    val description: String? = null,
    val permissions: Set<Permission>,
    val isBuiltIn: Boolean = false,
    val isDefault: Boolean = false, // Auto-assigned to new users
    val priority: Int = 0, // Higher = more authority
    val color: String? = null, // For UI display
    val iconName: String? = null,
    val createdBy: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
) {
    /**
     * Check if role has specific permission
     */
    fun hasPermission(permission: Permission): Boolean {
        return permission in permissions || Permission.SYSTEM_ADMIN in permissions
    }

    /**
     * Check if role has any of the given permissions
     */
    fun hasAnyPermission(permissions: Set<Permission>): Boolean {
        return this.permissions.any { it in permissions } ||
                Permission.SYSTEM_ADMIN in this.permissions
    }

    /**
     * Check if role has all of the given permissions
     */
    fun hasAllPermissions(permissions: Set<Permission>): Boolean {
        return Permission.SYSTEM_ADMIN in this.permissions ||
                this.permissions.containsAll(permissions)
    }

    /**
     * Get permissions by category
     */
    fun permissionsByCategory(): Map<PermissionCategory, List<Permission>> {
        return permissions.groupBy { it.category }
    }

    companion object {
        /**
         * Built-in organization roles
         */
        val OWNER = Role(
            id = "role_owner",
            name = "Owner",
            description = "Full organization access with billing and ownership rights",
            permissions = Permission.entries.toSet(),
            isBuiltIn = true,
            priority = 1000,
            color = "#8B0000"
        )

        val ADMIN = Role(
            id = "role_admin",
            name = "Admin",
            description = "Administrative access to manage users, roles, and settings",
            permissions = Permission.entries.filter { it != Permission.SYSTEM_ADMIN }.toSet(),
            isBuiltIn = true,
            priority = 900,
            color = "#FF4500"
        )

        val MANAGER = Role(
            id = "role_manager",
            name = "Manager",
            description = "Can manage teams, projects, and assign tasks",
            permissions = setOf(
                // Knowledge
                Permission.KNOWLEDGE_VIEW,
                Permission.KNOWLEDGE_CREATE,
                Permission.KNOWLEDGE_EDIT,
                Permission.KNOWLEDGE_SHARE,
                // Projects
                Permission.PROJECT_VIEW,
                Permission.PROJECT_CREATE,
                Permission.PROJECT_EDIT,
                Permission.PROJECT_MEMBER_MANAGE,
                // Tasks
                Permission.TASK_VIEW,
                Permission.TASK_CREATE,
                Permission.TASK_EDIT,
                Permission.TASK_ASSIGN,
                Permission.TASK_STATUS_CHANGE,
                // Teams
                Permission.TEAM_VIEW,
                Permission.TEAM_CREATE,
                Permission.TEAM_EDIT,
                Permission.TEAM_MEMBER_MANAGE,
                // AI
                Permission.AI_CHAT,
                Permission.AI_GENERATE,
                Permission.AI_ANALYZE,
                // Social
                Permission.SOCIAL_POST,
                Permission.SOCIAL_COMMENT,
                // User
                Permission.USER_VIEW
            ),
            isBuiltIn = true,
            priority = 700,
            color = "#228B22"
        )

        val MEMBER = Role(
            id = "role_member",
            name = "Member",
            description = "Standard member with basic access",
            permissions = setOf(
                Permission.KNOWLEDGE_VIEW,
                Permission.KNOWLEDGE_CREATE,
                Permission.KNOWLEDGE_EDIT,
                Permission.PROJECT_VIEW,
                Permission.TASK_VIEW,
                Permission.TASK_CREATE,
                Permission.TASK_STATUS_CHANGE,
                Permission.TEAM_VIEW,
                Permission.AI_CHAT,
                Permission.AI_GENERATE,
                Permission.SOCIAL_POST,
                Permission.SOCIAL_COMMENT,
                Permission.USER_VIEW
            ),
            isBuiltIn = true,
            isDefault = true,
            priority = 500,
            color = "#4169E1"
        )

        val GUEST = Role(
            id = "role_guest",
            name = "Guest",
            description = "Read-only access for external collaborators",
            permissions = setOf(
                Permission.KNOWLEDGE_VIEW,
                Permission.PROJECT_VIEW,
                Permission.TASK_VIEW,
                Permission.TEAM_VIEW,
                Permission.USER_VIEW
            ),
            isBuiltIn = true,
            priority = 100,
            color = "#808080"
        )

        /**
         * All built-in roles
         */
        val builtInRoles = listOf(OWNER, ADMIN, MANAGER, MEMBER, GUEST)

        /**
         * Get built-in role by ID
         */
        fun getBuiltIn(id: String): Role? {
            return builtInRoles.find { it.id == id }
        }
    }
}

/**
 * Role assignment to user
 */
@Serializable
data class RoleAssignment(
    val id: String,
    val userId: String,
    val roleId: String,
    val assignedBy: String,
    val assignedAt: Long = System.currentTimeMillis(),
    val expiresAt: Long? = null,
    val isActive: Boolean = true
) {
    /**
     * Check if assignment is valid
     */
    val isValid: Boolean
        get() = isActive && (expiresAt == null || System.currentTimeMillis() < expiresAt)
}

/**
 * User with roles
 */
@Serializable
data class UserWithRoles(
    val userId: String,
    val username: String,
    val email: String? = null,
    val displayName: String? = null,
    val roles: List<Role>,
    val teamMemberships: List<TeamMembership> = emptyList()
) {
    /**
     * Get highest priority role
     */
    val primaryRole: Role?
        get() = roles.maxByOrNull { it.priority }

    /**
     * Get all permissions from all roles
     */
    val allPermissions: Set<Permission>
        get() = roles.flatMap { it.permissions }.toSet()

    /**
     * Check if user has permission
     */
    fun hasPermission(permission: Permission): Boolean {
        return roles.any { it.hasPermission(permission) }
    }

    /**
     * Check if user is admin
     */
    val isAdmin: Boolean
        get() = roles.any { it.id == Role.ADMIN.id || it.id == Role.OWNER.id }

    /**
     * Check if user is owner
     */
    val isOwner: Boolean
        get() = roles.any { it.id == Role.OWNER.id }
}

/**
 * Team membership info
 */
@Serializable
data class TeamMembership(
    val teamId: String,
    val teamName: String,
    val role: TeamRole,
    val joinedAt: Long
)

/**
 * Role within a team
 */
@Serializable
enum class TeamRole {
    LEAD,
    MEMBER
}
