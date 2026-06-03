import Foundation

/// 工作空间类型
public enum WorkspaceType: String, Codable, CaseIterable {
    case `default` = "default"         // 默认工作空间
    case development = "development"   // 开发环境
    case testing = "testing"           // 测试环境
    case production = "production"     // 生产环境
    case personal = "personal"         // 个人工作空间
    case temporary = "temporary"       // 临时工作空间

    public var displayName: String {
        switch self {
        case .default: return "默认"
        case .development: return "开发"
        case .testing: return "测试"
        case .production: return "生产"
        case .personal: return "个人"
        case .temporary: return "临时"
        }
    }

    public var icon: String {
        switch self {
        case .default: return "folder"
        case .development: return "hammer"
        case .testing: return "testtube.2"
        case .production: return "server.rack"
        case .personal: return "person.crop.circle"
        case .temporary: return "clock"
        }
    }
}

/// 工作空间可见性
public enum WorkspaceVisibility: String, Codable {
    case members = "members"               // 所有成员可见
    case admins = "admins"                 // 仅管理员可见
    case specificRoles = "specific_roles"  // 特定角色可见

    public var displayName: String {
        switch self {
        case .members: return "所有成员"
        case .admins: return "仅管理员"
        case .specificRoles: return "特定角色"
        }
    }
}

/// 工作空间
public struct Workspace: Identifiable, Codable {
    public let id: String
    public let orgId: String
    public var name: String
    public var description: String
    public var type: WorkspaceType
    public var color: String
    public var icon: String
    public var isDefault: Bool
    public var visibility: WorkspaceVisibility
    public var allowedRoles: [String]  // 允许访问的角色ID列表
    public let createdBy: String
    public let createdAt: Date
    public var updatedAt: Date
    public var archived: Bool

    // 统计信息（运行时计算）
    public var memberCount: Int?
    public var projectCount: Int?
    public var noteCount: Int?

    public init(
        id: String = "ws_" + UUID().uuidString.replacingOccurrences(of: "-", with: ""),
        orgId: String,
        name: String,
        description: String = "",
        type: WorkspaceType = .default,
        color: String = "#1890ff",
        icon: String = "folder",
        isDefault: Bool = false,
        visibility: WorkspaceVisibility = .members,
        allowedRoles: [String] = [],
        createdBy: String,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        archived: Bool = false,
        memberCount: Int? = nil,
        projectCount: Int? = nil,
        noteCount: Int? = nil
    ) {
        self.id = id
        self.orgId = orgId
        self.name = name
        self.description = description
        self.type = type
        self.color = color
        self.icon = icon
        self.isDefault = isDefault
        self.visibility = visibility
        self.allowedRoles = allowedRoles
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.archived = archived
        self.memberCount = memberCount
        self.projectCount = projectCount
        self.noteCount = noteCount
    }
}

/// 工作空间成员
public struct WorkspaceMember: Identifiable, Codable {
    public let id: String
    public let workspaceId: String
    public let memberDID: String
    public var displayName: String
    public var avatar: String?
    public var role: WorkspaceMemberRole
    public let joinedAt: Date
    public var lastActiveAt: Date?

    public init(
        id: String = UUID().uuidString,
        workspaceId: String,
        memberDID: String,
        displayName: String,
        avatar: String? = nil,
        role: WorkspaceMemberRole = .member,
        joinedAt: Date = Date(),
        lastActiveAt: Date? = nil
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.memberDID = memberDID
        self.displayName = displayName
        self.avatar = avatar
        self.role = role
        self.joinedAt = joinedAt
        self.lastActiveAt = lastActiveAt
    }
}

/// 工作空间成员角色
public enum WorkspaceMemberRole: String, Codable {
    case owner = "owner"       // 所有者
    case admin = "admin"       // 管理员
    case member = "member"     // 成员
    case guest = "guest"       // 访客

    public var displayName: String {
        switch self {
        case .owner: return "所有者"
        case .admin: return "管理员"
        case .member: return "成员"
        case .guest: return "访客"
        }
    }
}

/// 工作空间资源
public struct WorkspaceResource: Identifiable, Codable {
    public let id: String
    public let workspaceId: String
    public let resourceType: ResourceType
    public let resourceId: String
    public let resourceName: String
    public let addedBy: String
    public let addedAt: Date

    public init(
        id: String = UUID().uuidString,
        workspaceId: String,
        resourceType: ResourceType,
        resourceId: String,
        resourceName: String,
        addedBy: String,
        addedAt: Date = Date()
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.resourceName = resourceName
        self.addedBy = addedBy
        self.addedAt = addedAt
    }
}

/// 资源类型
public enum ResourceType: String, Codable {
    case note = "note"           // 笔记
    case project = "project"     // 项目
    case knowledge = "knowledge" // 知识库
    case file = "file"           // 文件
    case task = "task"           // 任务

    public var displayName: String {
        switch self {
        case .note: return "笔记"
        case .project: return "项目"
        case .knowledge: return "知识库"
        case .file: return "文件"
        case .task: return "任务"
        }
    }
}

/// 工作空间活动
public struct WorkspaceActivity: Identifiable, Codable {
    public let id: String
    public let workspaceId: String
    public let actorDID: String
    public let action: WorkspaceAction
    public let resourceType: String
    public let resourceId: String
    public let metadata: [String: String]
    public let timestamp: Date

    public init(
        id: String = UUID().uuidString,
        workspaceId: String,
        actorDID: String,
        action: WorkspaceAction,
        resourceType: String,
        resourceId: String,
        metadata: [String: String] = [:],
        timestamp: Date = Date()
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.actorDID = actorDID
        self.action = action
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.metadata = metadata
        self.timestamp = timestamp
    }
}

/// 工作空间操作类型
public enum WorkspaceAction: String, Codable {
    case createWorkspace = "create_workspace"
    case updateWorkspace = "update_workspace"
    case deleteWorkspace = "delete_workspace"
    case archiveWorkspace = "archive_workspace"

    case addMember = "add_member"
    case removeMember = "remove_member"
    case updateMemberRole = "update_member_role"

    case addResource = "add_resource"
    case removeResource = "remove_resource"

    case updateSettings = "update_settings"

    public var displayName: String {
        switch self {
        case .createWorkspace: return "创建工作空间"
        case .updateWorkspace: return "更新工作空间"
        case .deleteWorkspace: return "删除工作空间"
        case .archiveWorkspace: return "归档工作空间"
        case .addMember: return "添加成员"
        case .removeMember: return "移除成员"
        case .updateMemberRole: return "更新成员角色"
        case .addResource: return "添加资源"
        case .removeResource: return "移除资源"
        case .updateSettings: return "更新设置"
        }
    }
}

// MARK: - Workspace Error Types

public enum WorkspaceError: Error, LocalizedError {
    case workspaceNotFound
    case workspaceNameExists
    case memberNotFound
    case resourceNotFound
    case insufficientPermissions
    case cannotDeleteDefaultWorkspace
    case cannotRemoveOwner

    public var errorDescription: String? {
        switch self {
        case .workspaceNotFound:
            return "工作空间未找到"
        case .workspaceNameExists:
            return "工作空间名称已存在"
        case .memberNotFound:
            return "成员未找到"
        case .resourceNotFound:
            return "资源未找到"
        case .insufficientPermissions:
            return "权限不足"
        case .cannotDeleteDefaultWorkspace:
            return "不能删除默认工作空间"
        case .cannotRemoveOwner:
            return "不能移除工作空间所有者"
        }
    }
}
