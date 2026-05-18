import Foundation

/// 权限授予记录
/// 用于记录资源级别的权限授予
public struct PermissionGrant: Codable, Identifiable {
    public let id: String
    public let orgId: String
    public let granteeType: GranteeType  // user, role, team
    public let granteeId: String
    public let resourceType: String
    public let resourceId: String?  // nil表示该资源类型的所有资源
    public let permission: String
    public let conditions: [String: String]?
    public let grantedBy: String
    public let expiresAt: Date?
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String = UUID().uuidString,
        orgId: String,
        granteeType: GranteeType,
        granteeId: String,
        resourceType: String,
        resourceId: String? = nil,
        permission: String,
        conditions: [String: String]? = nil,
        grantedBy: String,
        expiresAt: Date? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.orgId = orgId
        self.granteeType = granteeType
        self.granteeId = granteeId
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.permission = permission
        self.conditions = conditions
        self.grantedBy = grantedBy
        self.expiresAt = expiresAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// 检查是否已过期
    public var isExpired: Bool {
        guard let expiresAt = expiresAt else { return false }
        return expiresAt < Date()
    }
}

/// 授予对象类型
public enum GranteeType: String, Codable {
    case user
    case role
    case team
}

/// 权限继承关系
/// 支持父资源权限传递给子资源
public struct PermissionInheritance: Codable, Identifiable {
    public let id: String
    public let orgId: String
    public let parentResourceType: String
    public let parentResourceId: String
    public let childResourceType: String
    public let childResourceId: String
    public let inheritPermissions: [String]?  // nil表示继承所有权限
    public let createdAt: Date

    public init(
        id: String = UUID().uuidString,
        orgId: String,
        parentResourceType: String,
        parentResourceId: String,
        childResourceType: String,
        childResourceId: String,
        inheritPermissions: [String]? = nil,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.orgId = orgId
        self.parentResourceType = parentResourceType
        self.parentResourceId = parentResourceId
        self.childResourceType = childResourceType
        self.childResourceId = childResourceId
        self.inheritPermissions = inheritPermissions
        self.createdAt = createdAt
    }
}

/// 权限委派
/// 支持用户将权限临时委派给其他用户
public struct PermissionDelegation: Codable, Identifiable {
    public let id: String
    public let orgId: String
    public let delegatorDid: String  // 委派人
    public let delegateDid: String   // 被委派人
    public let permissions: [String]  // 委派的权限列表
    public let resourceScope: ResourceScope?  // 资源范围限制
    public let reason: String?
    public let startDate: Date
    public let endDate: Date
    public let status: DelegationStatus
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String = UUID().uuidString,
        orgId: String,
        delegatorDid: String,
        delegateDid: String,
        permissions: [String],
        resourceScope: ResourceScope? = nil,
        reason: String? = nil,
        startDate: Date = Date(),
        endDate: Date,
        status: DelegationStatus = .active,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.orgId = orgId
        self.delegatorDid = delegatorDid
        self.delegateDid = delegateDid
        self.permissions = permissions
        self.resourceScope = resourceScope
        self.reason = reason
        self.startDate = startDate
        self.endDate = endDate
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// 检查委派是否有效
    public var isActive: Bool {
        let now = Date()
        return status == .active && startDate <= now && endDate > now
    }
}

/// 资源范围
public struct ResourceScope: Codable {
    public let resourceType: String
    public let resourceId: String?

    public init(resourceType: String, resourceId: String? = nil) {
        self.resourceType = resourceType
        self.resourceId = resourceId
    }
}

/// 委派状态
public enum DelegationStatus: String, Codable {
    case pending   // 待接受
    case active    // 生效中
    case expired   // 已过期
    case revoked   // 已撤销
    case rejected  // 已拒绝
}

/// 委派类型（用于查询过滤）
public enum DelegationType {
    case delegated  // 用户发出的委派
    case received   // 用户收到的委派
}

/// 权限审计日志
public struct PermissionAuditLog: Codable, Identifiable {
    public let id: String
    public let orgId: String
    public let userDid: String
    public let permission: String
    public let action: AuditAction
    public let result: AuditResult
    public let resourceType: String?
    public let resourceId: String?
    public let context: [String: String]?
    public let createdAt: Date

    public init(
        id: String = UUID().uuidString,
        orgId: String,
        userDid: String,
        permission: String,
        action: AuditAction,
        result: AuditResult,
        resourceType: String? = nil,
        resourceId: String? = nil,
        context: [String: String]? = nil,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.orgId = orgId
        self.userDid = userDid
        self.permission = permission
        self.action = action
        self.result = result
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.context = context
        self.createdAt = createdAt
    }
}

/// 审计操作类型
public enum AuditAction: String, Codable {
    case grant    // 授予权限
    case revoke   // 撤销权限
    case check    // 检查权限
    case delegate // 委派权限
    case inherit  // 继承权限
}

/// 审计结果
public enum AuditResult: String, Codable {
    case success
    case denied
    case error
}

/// 用户权限汇总
public struct UserPermissions {
    public let direct: [PermissionGrant]    // 直接授予的权限
    public let role: [PermissionGrant]      // 通过角色获得的权限
    public let team: [PermissionGrant]      // 通过团队获得的权限
    public let delegated: [PermissionDelegation]  // 被委派的权限

    public init(
        direct: [PermissionGrant] = [],
        role: [PermissionGrant] = [],
        team: [PermissionGrant] = [],
        delegated: [PermissionDelegation] = []
    ) {
        self.direct = direct
        self.role = role
        self.team = team
        self.delegated = delegated
    }

    /// 获取所有有效权限
    public func effectivePermissions(for resourceType: String, resourceId: String?) -> Set<String> {
        var permissions = Set<String>()

        // 添加直接权限
        for grant in direct where !grant.isExpired {
            if grant.resourceType == resourceType &&
               (grant.resourceId == nil || grant.resourceId == resourceId) {
                permissions.insert(grant.permission)
            }
        }

        // 添加角色权限
        for grant in role where !grant.isExpired {
            if grant.resourceType == resourceType &&
               (grant.resourceId == nil || grant.resourceId == resourceId) {
                permissions.insert(grant.permission)
            }
        }

        // 添加团队权限
        for grant in team where !grant.isExpired {
            if grant.resourceType == resourceType &&
               (grant.resourceId == nil || grant.resourceId == resourceId) {
                permissions.insert(grant.permission)
            }
        }

        // 添加委派权限
        for delegation in delegated where delegation.isActive {
            for permission in delegation.permissions {
                if let scope = delegation.resourceScope {
                    if scope.resourceType == resourceType &&
                       (scope.resourceId == nil || scope.resourceId == resourceId) {
                        permissions.insert(permission)
                    }
                } else {
                    permissions.insert(permission)
                }
            }
        }

        return permissions
    }
}
