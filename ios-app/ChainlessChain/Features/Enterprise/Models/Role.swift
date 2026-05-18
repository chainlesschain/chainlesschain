import Foundation

/// 组织角色
public enum OrganizationRole: String, Codable, CaseIterable {
    case owner = "owner"           // 所有者 - 最高权限
    case admin = "admin"           // 管理员 - 管理权限
    case editor = "editor"         // 编辑者 - 编辑权限
    case viewer = "viewer"         // 查看者 - 只读权限
    case guest = "guest"           // 访客 - 受限查看

    /// 显示名称
    public var displayName: String {
        switch self {
        case .owner: return "所有者"
        case .admin: return "管理员"
        case .editor: return "编辑者"
        case .viewer: return "查看者"
        case .guest: return "访客"
        }
    }

    /// 描述
    public var description: String {
        switch self {
        case .owner: return "组织创建者，拥有最高权限"
        case .admin: return "管理员，可以管理成员和内容"
        case .editor: return "编辑者，可以创建和编辑内容"
        case .viewer: return "查看者，只能查看内容"
        case .guest: return "访客，受限查看"
        }
    }

    /// 默认权限
    public var defaultPermissions: [Permission] {
        switch self {
        case .owner:
            return [.all]  // 所有权限
        case .admin:
            return [
                // 组织管理
                .orgManage, .orgSettings,
                // 成员管理
                .memberInvite, .memberRemove, .memberManage,
                // 知识库
                .knowledgeCreate, .knowledgeRead, .knowledgeWrite, .knowledgeDelete,
                // 项目
                .projectCreate, .projectRead, .projectWrite, .projectDelete,
                // 角色
                .roleCreate, .roleAssign,
                // 工作区
                .workspaceCreate, .workspaceManage
            ]
        case .editor:
            return [
                // 知识库
                .knowledgeCreate, .knowledgeRead, .knowledgeWrite,
                // 项目
                .projectCreate, .projectRead, .projectWrite,
                // 消息
                .messageSend, .messageRead,
                // 工作区
                .workspaceRead
            ]
        case .viewer:
            return [
                .knowledgeRead,
                .projectRead,
                .messageRead,
                .workspaceRead
            ]
        case .guest:
            return [
                .knowledgeRead
            ]
        }
    }

    /// 角色优先级（数字越大权限越高）
    public var priority: Int {
        switch self {
        case .owner: return 100
        case .admin: return 80
        case .editor: return 60
        case .viewer: return 40
        case .guest: return 20
        }
    }

    /// 是否可以管理其他角色
    public func canManage(role: OrganizationRole) -> Bool {
        return self.priority > role.priority
    }
}

/// 角色记录（数据库实体）
public struct RoleRecord: Identifiable, Codable {
    public let id: String
    public let orgId: String
    public let name: String
    public let description: String
    public let permissions: [Permission]
    public let isBuiltin: Bool
    public let createdAt: Date
    public var updatedAt: Date

    public init(
        id: String = UUID().uuidString,
        orgId: String,
        name: String,
        description: String,
        permissions: [Permission],
        isBuiltin: Bool = false,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.orgId = orgId
        self.name = name
        self.description = description
        self.permissions = permissions
        self.isBuiltin = isBuiltin
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// 从组织角色创建角色记录
    public static func fromOrganizationRole(
        _ role: OrganizationRole,
        orgId: String
    ) -> RoleRecord {
        return RoleRecord(
            orgId: orgId,
            name: role.rawValue,
            description: role.description,
            permissions: role.defaultPermissions,
            isBuiltin: true
        )
    }
}

/// 自定义角色
public struct CustomRole: Identifiable, Codable {
    public let id: String
    public let orgId: String
    public var name: String
    public var description: String
    public var permissions: Set<Permission>
    public var color: String?
    public var icon: String?
    public let createdBy: String
    public let createdAt: Date
    public var updatedAt: Date

    public init(
        id: String = UUID().uuidString,
        orgId: String,
        name: String,
        description: String,
        permissions: Set<Permission> = [],
        color: String? = nil,
        icon: String? = nil,
        createdBy: String,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.orgId = orgId
        self.name = name
        self.description = description
        self.permissions = permissions
        self.color = color
        self.icon = icon
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// 添加权限
    public mutating func addPermission(_ permission: Permission) {
        permissions.insert(permission)
        updatedAt = Date()
    }

    /// 移除权限
    public mutating func removePermission(_ permission: Permission) {
        permissions.remove(permission)
        updatedAt = Date()
    }

    /// 检查是否有权限
    public func hasPermission(_ permission: Permission) -> Bool {
        // 如果有所有权限
        if permissions.contains(.all) {
            return true
        }

        // 检查具体权限
        if permissions.contains(permission) {
            return true
        }

        // 检查通配符权限
        if let wildcardPermission = permission.wildcardPermission {
            if permissions.contains(wildcardPermission) {
                return true
            }
        }

        return false
    }
}

// MARK: - Role Error Types

public enum RoleError: Error, LocalizedError {
    case roleNotFound
    case roleAlreadyExists
    case cannotModifyBuiltinRole
    case cannotDeleteBuiltinRole
    case insufficientPermissions
    case invalidRoleName

    public var errorDescription: String? {
        switch self {
        case .roleNotFound:
            return "角色未找到"
        case .roleAlreadyExists:
            return "角色已存在"
        case .cannotModifyBuiltinRole:
            return "不能修改内置角色"
        case .cannotDeleteBuiltinRole:
            return "不能删除内置角色"
        case .insufficientPermissions:
            return "权限不足"
        case .invalidRoleName:
            return "无效的角色名称"
        }
    }
}
