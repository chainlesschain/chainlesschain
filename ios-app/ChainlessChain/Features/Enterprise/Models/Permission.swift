import Foundation

/// 权限定义
public enum Permission: String, Codable, CaseIterable, Hashable {
    // MARK: - Special Permissions

    /// 所有权限（超级权限）
    case all = "*"

    // MARK: - Organization Management

    /// 组织管理
    case orgManage = "org.manage"
    /// 组织设置
    case orgSettings = "org.settings"
    /// 组织删除
    case orgDelete = "org.delete"

    // MARK: - Member Management

    /// 邀请成员
    case memberInvite = "member.invite"
    /// 移除成员
    case memberRemove = "member.remove"
    /// 管理成员
    case memberManage = "member.manage"
    /// 查看成员
    case memberRead = "member.read"

    // MARK: - Role Management

    /// 创建角色
    case roleCreate = "role.create"
    /// 编辑角色
    case roleEdit = "role.edit"
    /// 删除角色
    case roleDelete = "role.delete"
    /// 分配角色
    case roleAssign = "role.assign"

    // MARK: - Knowledge Base

    /// 创建知识
    case knowledgeCreate = "knowledge.create"
    /// 读取知识
    case knowledgeRead = "knowledge.read"
    /// 编辑知识
    case knowledgeWrite = "knowledge.write"
    /// 删除知识
    case knowledgeDelete = "knowledge.delete"
    /// 分享知识
    case knowledgeShare = "knowledge.share"
    /// 导出知识
    case knowledgeExport = "knowledge.export"
    /// 知识所有权限
    case knowledgeAll = "knowledge.*"

    // MARK: - Project Management

    /// 创建项目
    case projectCreate = "project.create"
    /// 读取项目
    case projectRead = "project.read"
    /// 编辑项目
    case projectWrite = "project.write"
    /// 删除项目
    case projectDelete = "project.delete"
    /// 管理项目成员
    case projectManageMembers = "project.members"
    /// 项目所有权限
    case projectAll = "project.*"

    // MARK: - Workspace Management

    /// 创建工作区
    case workspaceCreate = "workspace.create"
    /// 读取工作区
    case workspaceRead = "workspace.read"
    /// 编辑工作区
    case workspaceWrite = "workspace.write"
    /// 删除工作区
    case workspaceDelete = "workspace.delete"
    /// 管理工作区
    case workspaceManage = "workspace.manage"
    /// 工作区所有权限
    case workspaceAll = "workspace.*"

    // MARK: - Messaging

    /// 发送消息
    case messageSend = "message.send"
    /// 读取消息
    case messageRead = "message.read"
    /// 删除消息
    case messageDelete = "message.delete"
    /// 消息所有权限
    case messageAll = "message.*"

    // MARK: - Settings

    /// 查看设置
    case settingsRead = "settings.read"
    /// 修改设置
    case settingsWrite = "settings.write"

    // MARK: - Audit & Logs

    /// 查看审计日志
    case auditRead = "audit.read"
    /// 导出审计日志
    case auditExport = "audit.export"

    // MARK: - Integration

    /// 管理集成
    case integrationManage = "integration.manage"

    // MARK: - Helper Properties

    /// 显示名称
    public var displayName: String {
        switch self {
        case .all: return "所有权限"

        case .orgManage: return "管理组织"
        case .orgSettings: return "组织设置"
        case .orgDelete: return "删除组织"

        case .memberInvite: return "邀请成员"
        case .memberRemove: return "移除成员"
        case .memberManage: return "管理成员"
        case .memberRead: return "查看成员"

        case .roleCreate: return "创建角色"
        case .roleEdit: return "编辑角色"
        case .roleDelete: return "删除角色"
        case .roleAssign: return "分配角色"

        case .knowledgeCreate: return "创建知识"
        case .knowledgeRead: return "读取知识"
        case .knowledgeWrite: return "编辑知识"
        case .knowledgeDelete: return "删除知识"
        case .knowledgeShare: return "分享知识"
        case .knowledgeExport: return "导出知识"
        case .knowledgeAll: return "知识所有权限"

        case .projectCreate: return "创建项目"
        case .projectRead: return "读取项目"
        case .projectWrite: return "编辑项目"
        case .projectDelete: return "删除项目"
        case .projectManageMembers: return "管理项目成员"
        case .projectAll: return "项目所有权限"

        case .workspaceCreate: return "创建工作区"
        case .workspaceRead: return "读取工作区"
        case .workspaceWrite: return "编辑工作区"
        case .workspaceDelete: return "删除工作区"
        case .workspaceManage: return "管理工作区"
        case .workspaceAll: return "工作区所有权限"

        case .messageSend: return "发送消息"
        case .messageRead: return "读取消息"
        case .messageDelete: return "删除消息"
        case .messageAll: return "消息所有权限"

        case .settingsRead: return "查看设置"
        case .settingsWrite: return "修改设置"

        case .auditRead: return "查看审计"
        case .auditExport: return "导出审计"

        case .integrationManage: return "管理集成"
        }
    }

    /// 权限分类
    public var category: PermissionCategory {
        let components = rawValue.split(separator: ".")
        guard let first = components.first else {
            return .other
        }

        switch String(first) {
        case "org": return .organization
        case "member": return .member
        case "role": return .role
        case "knowledge": return .knowledge
        case "project": return .project
        case "workspace": return .workspace
        case "message": return .message
        case "settings": return .settings
        case "audit": return .audit
        case "integration": return .integration
        case "*": return .special
        default: return .other
        }
    }

    /// 是否是通配符权限
    public var isWildcard: Bool {
        return rawValue.hasSuffix(".*") || rawValue == "*"
    }

    /// 获取通配符权限（例如：knowledge.read → knowledge.*）
    public var wildcardPermission: Permission? {
        let components = rawValue.split(separator: ".")
        guard components.count >= 2 else { return nil }

        let wildcardString = "\(components[0]).*"
        return Permission(rawValue: wildcardString)
    }

    /// 获取资源类型
    public var resource: String? {
        let components = rawValue.split(separator: ".")
        return components.first.map { String($0) }
    }

    /// 获取操作类型
    public var action: String? {
        let components = rawValue.split(separator: ".")
        guard components.count >= 2 else { return nil }
        return String(components[1])
    }
}

/// 权限分类
public enum PermissionCategory: String, Codable {
    case special = "特殊"
    case organization = "组织"
    case member = "成员"
    case role = "角色"
    case knowledge = "知识库"
    case project = "项目"
    case workspace = "工作区"
    case message = "消息"
    case settings = "设置"
    case audit = "审计"
    case integration = "集成"
    case other = "其他"
}

/// 权限集合
public struct PermissionSet: Codable {
    public var permissions: Set<Permission>

    public init(permissions: Set<Permission> = []) {
        self.permissions = permissions
    }

    public init(permissions: [Permission]) {
        self.permissions = Set(permissions)
    }

    /// 添加权限
    public mutating func add(_ permission: Permission) {
        permissions.insert(permission)
    }

    /// 移除权限
    public mutating func remove(_ permission: Permission) {
        permissions.remove(permission)
    }

    /// 检查是否有权限
    public func has(_ permission: Permission) -> Bool {
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

    /// 检查是否有任一权限
    public func hasAny(_ requiredPermissions: [Permission]) -> Bool {
        for permission in requiredPermissions {
            if has(permission) {
                return true
            }
        }
        return false
    }

    /// 检查是否有所有权限
    public func hasAll(_ requiredPermissions: [Permission]) -> Bool {
        for permission in requiredPermissions {
            if !has(permission) {
                return false
            }
        }
        return true
    }

    /// 按分类分组
    public var groupedByCategory: [PermissionCategory: [Permission]] {
        var grouped: [PermissionCategory: [Permission]] = [:]

        for permission in permissions {
            let category = permission.category
            if grouped[category] == nil {
                grouped[category] = []
            }
            grouped[category]?.append(permission)
        }

        return grouped
    }
}

// MARK: - Permission Error Types

public enum PermissionError: Error, LocalizedError {
    case accessDenied(Permission)
    case insufficientPermissions([Permission])
    case invalidPermission(String)

    public var errorDescription: String? {
        switch self {
        case .accessDenied(let permission):
            return "访问被拒绝：缺少权限 \(permission.displayName)"
        case .insufficientPermissions(let permissions):
            let permissionNames = permissions.map { $0.displayName }.joined(separator: ", ")
            return "权限不足：需要以下权限之一 \(permissionNames)"
        case .invalidPermission(let permission):
            return "无效的权限：\(permission)"
        }
    }
}
