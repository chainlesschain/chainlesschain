package com.chainlesschain.android.feature.enterprise.domain.model

import kotlinx.serialization.Serializable

/**
 * Organization team
 */
@Serializable
data class Team(
    val id: String,
    val name: String,
    val description: String? = null,
    val parentTeamId: String? = null, // For team hierarchy
    val leaderId: String? = null,
    val iconUrl: String? = null,
    val color: String? = null,
    val isArchived: Boolean = false,
    val metadata: TeamMetadata? = null,
    val createdBy: String,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
) {
    /**
     * Check if team is a root team (no parent)
     */
    val isRoot: Boolean
        get() = parentTeamId == null
}

/**
 * Team metadata
 */
@Serializable
data class TeamMetadata(
    val slackChannel: String? = null,
    val notionPage: String? = null,
    val meetingSchedule: String? = null,
    val timezone: String? = null,
    val tags: List<String> = emptyList()
)

/**
 * Team member
 */
@Serializable
data class TeamMember(
    val id: String,
    val teamId: String,
    val userId: String,
    val role: TeamRole,
    val displayName: String? = null,
    val email: String? = null,
    val avatarUrl: String? = null,
    val joinedAt: Long = System.currentTimeMillis(),
    val invitedBy: String? = null,
    val isActive: Boolean = true
) {
    /**
     * Check if member is team lead
     */
    val isLead: Boolean
        get() = role == TeamRole.LEAD
}

/**
 * Team with members
 */
@Serializable
data class TeamWithMembers(
    val team: Team,
    val members: List<TeamMember>,
    val childTeams: List<Team> = emptyList()
) {
    /**
     * Get team lead
     */
    val lead: TeamMember?
        get() = members.find { it.isLead }

    /**
     * Get member count
     */
    val memberCount: Int
        get() = members.size

    /**
     * Get active members
     */
    val activeMembers: List<TeamMember>
        get() = members.filter { it.isActive }
}

/**
 * Team hierarchy node
 */
@Serializable
data class TeamHierarchyNode(
    val team: Team,
    val children: List<TeamHierarchyNode> = emptyList(),
    val depth: Int = 0
) {
    /**
     * Check if this is a leaf node (no children)
     */
    val isLeaf: Boolean
        get() = children.isEmpty()

    /**
     * Get total team count in this subtree
     */
    fun totalTeamCount(): Int {
        return 1 + children.sumOf { it.totalTeamCount() }
    }

    /**
     * Flatten to list
     */
    fun flatten(): List<Team> {
        return listOf(team) + children.flatMap { it.flatten() }
    }
}

/**
 * Team invitation
 */
@Serializable
data class TeamInvitation(
    val id: String,
    val teamId: String,
    val teamName: String,
    val inviteeEmail: String,
    val inviteeUserId: String? = null,
    val role: TeamRole,
    val invitedBy: String,
    val message: String? = null,
    val status: InvitationStatus,
    val createdAt: Long = System.currentTimeMillis(),
    val expiresAt: Long,
    val respondedAt: Long? = null
) {
    /**
     * Check if invitation is expired
     */
    val isExpired: Boolean
        get() = System.currentTimeMillis() > expiresAt

    /**
     * Check if invitation is pending
     */
    val isPending: Boolean
        get() = status == InvitationStatus.PENDING && !isExpired
}

/**
 * Invitation status
 */
@Serializable
enum class InvitationStatus {
    PENDING,
    ACCEPTED,
    DECLINED,
    EXPIRED,
    CANCELLED
}

/**
 * Team activity
 */
@Serializable
data class TeamActivity(
    val id: String,
    val teamId: String,
    val actorId: String,
    val actorName: String,
    val action: TeamAction,
    val targetType: String? = null,
    val targetId: String? = null,
    val targetName: String? = null,
    val details: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)

/**
 * Team action types
 */
@Serializable
enum class TeamAction {
    MEMBER_ADDED,
    MEMBER_REMOVED,
    MEMBER_ROLE_CHANGED,
    TEAM_CREATED,
    TEAM_UPDATED,
    TEAM_ARCHIVED,
    TEAM_UNARCHIVED,
    INVITATION_SENT,
    INVITATION_ACCEPTED,
    INVITATION_DECLINED
}

/**
 * Team report
 */
@Serializable
data class TeamReport(
    val id: String,
    val teamId: String,
    val reportType: ReportType,
    val title: String,
    val content: String,
    val authorId: String,
    val authorName: String,
    val periodStart: Long,
    val periodEnd: Long,
    val aiSummary: String? = null,
    val highlights: List<String> = emptyList(),
    val blockers: List<String> = emptyList(),
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * Report type
 */
@Serializable
enum class ReportType {
    DAILY_STANDUP,
    WEEKLY,
    MONTHLY,
    QUARTERLY,
    CUSTOM
}
