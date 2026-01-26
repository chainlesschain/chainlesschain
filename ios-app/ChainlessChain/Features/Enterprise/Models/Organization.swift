import Foundation

/// 组织类型
public enum OrganizationType: String, Codable, CaseIterable {
    case startup = "startup"           // 创业公司
    case company = "company"           // 企业
    case community = "community"       // 社区
    case opensource = "opensource"     // 开源项目
    case education = "education"       // 教育机构
    case personal = "personal"         // 个人

    public var displayName: String {
        switch self {
        case .startup: return "创业公司"
        case .company: return "企业"
        case .community: return "社区"
        case .opensource: return "开源项目"
        case .education: return "教育机构"
        case .personal: return "个人"
        }
    }

    public var icon: String {
        switch self {
        case .startup: return "🚀"
        case .company: return "🏢"
        case .community: return "👥"
        case .opensource: return "💻"
        case .education: return "🎓"
        case .personal: return "👤"
        }
    }
}

/// 组织可见性
public enum OrganizationVisibility: String, Codable {
    case `public` = "public"           // 公开
    case `private` = "private"         // 私有
    case inviteOnly = "invite_only"    // 仅邀请

    public var displayName: String {
        switch self {
        case .public: return "公开"
        case .private: return "私有"
        case .inviteOnly: return "仅邀请"
        }
    }
}

/// 组织设置
public struct OrganizationSettings: Codable {
    public var visibility: OrganizationVisibility
    public var maxMembers: Int
    public var allowMemberInvite: Bool
    public var defaultMemberRole: OrganizationRole
    public var enableP2P: Bool
    public var syncMode: String
    public var customDomain: String?

    public init(
        visibility: OrganizationVisibility = .private,
        maxMembers: Int = 100,
        allowMemberInvite: Bool = true,
        defaultMemberRole: OrganizationRole = .viewer,
        enableP2P: Bool = true,
        syncMode: String = "auto",
        customDomain: String? = nil
    ) {
        self.visibility = visibility
        self.maxMembers = maxMembers
        self.allowMemberInvite = allowMemberInvite
        self.defaultMemberRole = defaultMemberRole
        self.enableP2P = enableP2P
        self.syncMode = syncMode
        self.customDomain = customDomain
    }
}

/// 组织
public struct Organization: Identifiable, Codable {
    public let id: String  // org_id
    public let did: String  // org_did
    public var name: String
    public var description: String
    public var type: OrganizationType
    public var avatar: String?
    public let ownerDID: String
    public var settings: OrganizationSettings
    public let createdAt: Date
    public var updatedAt: Date

    // 统计信息（运行时计算）
    public var memberCount: Int?
    public var projectCount: Int?
    public var knowledgeCount: Int?

    public init(
        id: String = "org_" + UUID().uuidString.replacingOccurrences(of: "-", with: ""),
        did: String,
        name: String,
        description: String = "",
        type: OrganizationType = .startup,
        avatar: String? = nil,
        ownerDID: String,
        settings: OrganizationSettings = OrganizationSettings(),
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        memberCount: Int? = nil,
        projectCount: Int? = nil,
        knowledgeCount: Int? = nil
    ) {
        self.id = id
        self.did = did
        self.name = name
        self.description = description
        self.type = type
        self.avatar = avatar
        self.ownerDID = ownerDID
        self.settings = settings
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.memberCount = memberCount
        self.projectCount = projectCount
        self.knowledgeCount = knowledgeCount
    }
}

/// 组织成员
public struct OrganizationMember: Identifiable, Codable {
    public let id: String
    public let orgId: String
    public let memberDID: String
    public var displayName: String
    public var avatar: String?
    public var role: OrganizationRole
    public var customRoleId: String?  // 自定义角色ID（可选）
    public var status: MemberStatus
    public var permissions: [Permission]  // 额外权限
    public let joinedAt: Date
    public var lastActiveAt: Date?

    public init(
        id: String = UUID().uuidString,
        orgId: String,
        memberDID: String,
        displayName: String,
        avatar: String? = nil,
        role: OrganizationRole = .viewer,
        customRoleId: String? = nil,
        status: MemberStatus = .active,
        permissions: [Permission] = [],
        joinedAt: Date = Date(),
        lastActiveAt: Date? = nil
    ) {
        self.id = id
        self.orgId = orgId
        self.memberDID = memberDID
        self.displayName = displayName
        self.avatar = avatar
        self.role = role
        self.customRoleId = customRoleId
        self.status = status
        self.permissions = permissions
        self.joinedAt = joinedAt
        self.lastActiveAt = lastActiveAt
    }

    /// 获取完整权限（角色权限 + 额外权限）
    public var allPermissions: Set<Permission> {
        var perms = Set(role.defaultPermissions)
        perms.formUnion(permissions)
        return perms
    }
}

/// 成员状态
public enum MemberStatus: String, Codable {
    case active = "active"         // 活跃
    case inactive = "inactive"     // 不活跃
    case suspended = "suspended"   // 暂停
    case removed = "removed"       // 已移除

    public var displayName: String {
        switch self {
        case .active: return "活跃"
        case .inactive: return "不活跃"
        case .suspended: return "已暂停"
        case .removed: return "已移除"
        }
    }
}

/// 组织邀请
public struct OrganizationInvitation: Identifiable, Codable {
    public let id: String
    public let orgId: String
    public let inviteCode: String
    public let invitedBy: String  // DID
    public let role: OrganizationRole
    public var maxUses: Int
    public var usedCount: Int
    public let createdAt: Date
    public var expireAt: Date?
    public var isActive: Bool

    public init(
        id: String = UUID().uuidString,
        orgId: String,
        inviteCode: String,
        invitedBy: String,
        role: OrganizationRole = .viewer,
        maxUses: Int = 10,
        usedCount: Int = 0,
        createdAt: Date = Date(),
        expireAt: Date? = nil,
        isActive: Bool = true
    ) {
        self.id = id
        self.orgId = orgId
        self.inviteCode = inviteCode
        self.invitedBy = invitedBy
        self.role = role
        self.maxUses = maxUses
        self.usedCount = usedCount
        self.createdAt = createdAt
        self.expireAt = expireAt
        self.isActive = isActive
    }

    /// 是否有效
    public var isValid: Bool {
        guard isActive else { return false }
        guard usedCount < maxUses else { return false }

        if let expireAt = expireAt {
            return Date() < expireAt
        }

        return true
    }

    /// 剩余使用次数
    public var remainingUses: Int {
        return max(0, maxUses - usedCount)
    }
}

/// 组织活动日志
public struct OrganizationActivity: Identifiable, Codable {
    public let id: String
    public let orgId: String
    public let actorDID: String
    public let action: ActivityAction
    public let resourceType: String
    public let resourceId: String
    public let metadata: [String: String]
    public let timestamp: Date

    public init(
        id: String = UUID().uuidString,
        orgId: String,
        actorDID: String,
        action: ActivityAction,
        resourceType: String,
        resourceId: String,
        metadata: [String: String] = [:],
        timestamp: Date = Date()
    ) {
        self.id = id
        self.orgId = orgId
        self.actorDID = actorDID
        self.action = action
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.metadata = metadata
        self.timestamp = timestamp
    }
}

/// 活动类型
public enum ActivityAction: String, Codable {
    case createOrganization = "create_organization"
    case updateOrganization = "update_organization"
    case deleteOrganization = "delete_organization"

    case joinOrganization = "join_organization"
    case leaveOrganization = "leave_organization"

    case addMember = "add_member"
    case removeMember = "remove_member"
    case updateMemberRole = "update_member_role"

    case createRole = "create_role"
    case updateRole = "update_role"
    case deleteRole = "delete_role"

    case createKnowledge = "create_knowledge"
    case updateKnowledge = "update_knowledge"
    case deleteKnowledge = "delete_knowledge"

    case createProject = "create_project"
    case updateProject = "update_project"
    case deleteProject = "delete_project"

    public var displayName: String {
        switch self {
        case .createOrganization: return "创建组织"
        case .updateOrganization: return "更新组织"
        case .deleteOrganization: return "删除组织"
        case .joinOrganization: return "加入组织"
        case .leaveOrganization: return "离开组织"
        case .addMember: return "添加成员"
        case .removeMember: return "移除成员"
        case .updateMemberRole: return "更新成员角色"
        case .createRole: return "创建角色"
        case .updateRole: return "更新角色"
        case .deleteRole: return "删除角色"
        case .createKnowledge: return "创建知识"
        case .updateKnowledge: return "更新知识"
        case .deleteKnowledge: return "删除知识"
        case .createProject: return "创建项目"
        case .updateProject: return "更新项目"
        case .deleteProject: return "删除项目"
        }
    }
}

// MARK: - Organization Error Types

public enum OrganizationError: Error, LocalizedError {
    case organizationNotFound
    case memberNotFound
    case invitationNotFound
    case invitationExpired
    case invitationExhausted
    case alreadyMember
    case notMember
    case cannotRemoveOwner
    case insufficientPermissions

    public var errorDescription: String? {
        switch self {
        case .organizationNotFound:
            return "组织未找到"
        case .memberNotFound:
            return "成员未找到"
        case .invitationNotFound:
            return "邀请未找到"
        case .invitationExpired:
            return "邀请已过期"
        case .invitationExhausted:
            return "邀请已用完"
        case .alreadyMember:
            return "已经是成员"
        case .notMember:
            return "不是组织成员"
        case .cannotRemoveOwner:
            return "不能移除组织所有者"
        case .insufficientPermissions:
            return "权限不足"
        }
    }
}
