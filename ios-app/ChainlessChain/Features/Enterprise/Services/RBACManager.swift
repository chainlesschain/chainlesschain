import Foundation
import CoreCommon
import Combine

/// RBAC权限管理器
/// 负责角色和权限的CRUD操作、权限检查
@MainActor
public class RBACManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = RBACManager()

    // MARK: - Properties

    private let database: Database

    @Published public var roles: [String: [RoleRecord]] = [:]  // orgId -> roles
    @Published public var permissions: [String: [String: PermissionSet]] = [:]  // orgId -> (memberDID -> permissions)

    /// 权限缓存
    private var permissionCache: [String: CachedPermission] = [:]
    private let cacheExpiration: TimeInterval = 300  // 5分钟

    /// 事件发布器
    public let roleCreated = PassthroughSubject<RoleRecord, Never>()
    public let roleUpdated = PassthroughSubject<RoleRecord, Never>()
    public let roleDeleted = PassthroughSubject<String, Never>()
    public let permissionGranted = PassthroughSubject<(String, String, Permission), Never>()
    public let permissionRevoked = PassthroughSubject<(String, String, Permission), Never>()

    // MARK: - Initialization

    private init() {
        self.database = Database.shared
        Logger.shared.info("[RBACManager] RBAC管理器已初始化")
    }

    // MARK: - Initialization

    /// 初始化RBAC管理器
    public func initialize() async throws {
        Logger.shared.info("[RBACManager] 初始化RBAC管理器...")

        // 初始化数据库表
        try await initializeTables()

        Logger.shared.info("[RBACManager] RBAC管理器初始化成功")
    }

    /// 初始化数据库表
    private func initializeTables() async throws {
        // 角色定义表
        let createRolesTableSQL = """
        CREATE TABLE IF NOT EXISTS organization_roles (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            permissions_json TEXT NOT NULL,
            is_builtin INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(org_id, name)
        )
        """

        try await database.execute(createRolesTableSQL)

        // 创建索引
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_org_roles ON organization_roles(org_id)")

        Logger.shared.info("[RBACManager] 数据库表初始化成功")
    }

    // MARK: - Permission Checking

    /// 检查权限
    public func checkPermission(
        orgId: String,
        userDID: String,
        permission: Permission
    ) async throws -> Bool {
        // 检查缓存
        let cacheKey = "\(orgId):\(userDID):\(permission.rawValue)"
        if let cached = permissionCache[cacheKey],
           !cached.isExpired {
            return cached.hasPermission
        }

        // 获取成员权限
        let permissionSet = try await getMemberPermissions(orgId: orgId, memberDID: userDID)

        let hasPermission = permissionSet.has(permission)

        // 更新缓存
        permissionCache[cacheKey] = CachedPermission(
            hasPermission: hasPermission,
            cachedAt: Date()
        )

        return hasPermission
    }

    /// 批量检查权限（需要任一权限）
    public func checkAnyPermission(
        orgId: String,
        userDID: String,
        permissions: [Permission]
    ) async throws -> Bool {
        for permission in permissions {
            if try await checkPermission(orgId: orgId, userDID: userDID, permission: permission) {
                return true
            }
        }
        return false
    }

    /// 批量检查权限（需要所有权限）
    public func checkAllPermissions(
        orgId: String,
        userDID: String,
        permissions: [Permission]
    ) async throws -> Bool {
        for permission in permissions {
            if !(try await checkPermission(orgId: orgId, userDID: userDID, permission: permission)) {
                return false
            }
        }
        return true
    }

    /// 要求权限（不满足则抛出异常）
    public func requirePermission(
        orgId: String,
        userDID: String,
        permission: Permission
    ) async throws {
        let hasPermission = try await checkPermission(
            orgId: orgId,
            userDID: userDID,
            permission: permission
        )

        guard hasPermission else {
            throw PermissionError.accessDenied(permission)
        }
    }

    /// 获取成员的所有权限
    public func getMemberPermissions(
        orgId: String,
        memberDID: String
    ) async throws -> PermissionSet {
        // 从数据库获取成员信息
        let query = """
        SELECT role, permissions_json FROM organization_members
        WHERE org_id = ? AND member_did = ? AND status = 'active'
        """

        let rows = try await database.query(query, [orgId, memberDID])

        guard let row = rows.first,
              let roleString = row["role"] as? String,
              let role = OrganizationRole(rawValue: roleString) else {
            return PermissionSet()  // 不是成员，无权限
        }

        // 获取角色默认权限
        var allPermissions = Set(role.defaultPermissions)

        // 添加额外权限
        if let permissionsJson = row["permissions_json"] as? String,
           let permissionsData = permissionsJson.data(using: .utf8),
           let extraPermissions = try? JSONDecoder().decode([Permission].self, from: permissionsData) {
            allPermissions.formUnion(extraPermissions)
        }

        return PermissionSet(permissions: allPermissions)
    }

    // MARK: - Role Management

    /// 创建角色
    public func createRole(
        orgId: String,
        name: String,
        description: String,
        permissions: [Permission],
        isBuiltin: Bool = false
    ) async throws -> RoleRecord {
        // 检查角色是否已存在
        let existing = try await getRole(orgId: orgId, name: name)
        guard existing == nil else {
            throw RoleError.roleAlreadyExists
        }

        let role = RoleRecord(
            orgId: orgId,
            name: name,
            description: description,
            permissions: permissions,
            isBuiltin: isBuiltin
        )

        try await saveRole(role)

        // 更新内存
        if roles[orgId] == nil {
            roles[orgId] = []
        }
        roles[orgId]?.append(role)

        // 发布事件
        roleCreated.send(role)

        Logger.shared.info("[RBACManager] 角色已创建: \(name)")

        return role
    }

    /// 更新角色
    public func updateRole(
        roleId: String,
        description: String? = nil,
        permissions: [Permission]? = nil
    ) async throws -> RoleRecord {
        // 获取现有角色
        guard var role = try await getRoleById(roleId: roleId) else {
            throw RoleError.roleNotFound
        }

        // 检查是否是内置角色
        guard !role.isBuiltin else {
            throw RoleError.cannotModifyBuiltinRole
        }

        // 更新字段
        if let description = description {
            role.description = description
        }

        if let permissions = permissions {
            role.permissions = permissions
        }

        role.updatedAt = Date()

        // 保存
        try await updateRoleInDB(role)

        // 更新内存
        if let index = roles[role.orgId]?.firstIndex(where: { $0.id == roleId }) {
            roles[role.orgId]?[index] = role
        }

        // 清除相关权限缓存
        clearPermissionCache(orgId: role.orgId)

        // 发布事件
        roleUpdated.send(role)

        Logger.shared.info("[RBACManager] 角色已更新: \(role.name)")

        return role
    }

    /// 删除角色
    public func deleteRole(roleId: String) async throws {
        // 获取角色
        guard let role = try await getRoleById(roleId: roleId) else {
            throw RoleError.roleNotFound
        }

        // 检查是否是内置角色
        guard !role.isBuiltin else {
            throw RoleError.cannotDeleteBuiltinRole
        }

        // 检查是否有成员使用该角色
        let memberCount = try await getRoleMemberCount(orgId: role.orgId, roleName: role.name)
        guard memberCount == 0 else {
            throw RoleError.roleInUse
        }

        // 从数据库删除
        try await deleteRoleFromDB(roleId: roleId)

        // 从内存删除
        if let index = roles[role.orgId]?.firstIndex(where: { $0.id == roleId }) {
            roles[role.orgId]?.remove(at: index)
        }

        // 发布事件
        roleDeleted.send(roleId)

        Logger.shared.info("[RBACManager] 角色已删除: \(role.name)")
    }

    /// 获取组织的所有角色
    public func getRoles(orgId: String) async throws -> [RoleRecord] {
        let query = "SELECT * FROM organization_roles WHERE org_id = ? ORDER BY is_builtin DESC, name ASC"
        let rows = try await database.query(query, [orgId])

        return rows.compactMap { parseRoleRecord(from: $0) }
    }

    /// 根据名称获取角色
    public func getRole(orgId: String, name: String) async throws -> RoleRecord? {
        let query = "SELECT * FROM organization_roles WHERE org_id = ? AND name = ?"
        let rows = try await database.query(query, [orgId, name])

        return rows.first.flatMap { parseRoleRecord(from: $0) }
    }

    /// 根据ID获取角色
    public func getRoleById(roleId: String) async throws -> RoleRecord? {
        let query = "SELECT * FROM organization_roles WHERE id = ?"
        let rows = try await database.query(query, [roleId])

        return rows.first.flatMap { parseRoleRecord(from: $0) }
    }

    // MARK: - Member Role Assignment

    /// 分配角色
    public func assignRole(
        orgId: String,
        memberDID: String,
        role: OrganizationRole
    ) async throws {
        let query = """
        UPDATE organization_members
        SET role = ?, updated_at = ?
        WHERE org_id = ? AND member_did = ?
        """

        try await database.execute(query, [
            role.rawValue,
            Int(Date().timeIntervalSince1970),
            orgId,
            memberDID
        ])

        // 清除缓存
        clearPermissionCache(orgId: orgId, memberDID: memberDID)

        Logger.shared.info("[RBACManager] 角色已分配: \(memberDID) -> \(role.rawValue)")
    }

    /// 授予额外权限
    public func grantPermission(
        orgId: String,
        memberDID: String,
        permission: Permission
    ) async throws {
        // 获取当前权限
        let currentPermissions = try await getExtraPermissions(orgId: orgId, memberDID: memberDID)
        var updatedPermissions = currentPermissions
        updatedPermissions.insert(permission)

        // 保存
        try await updateExtraPermissions(
            orgId: orgId,
            memberDID: memberDID,
            permissions: Array(updatedPermissions)
        )

        // 清除缓存
        clearPermissionCache(orgId: orgId, memberDID: memberDID)

        // 发布事件
        permissionGranted.send((orgId, memberDID, permission))

        Logger.shared.info("[RBACManager] 权限已授予: \(memberDID) -> \(permission.rawValue)")
    }

    /// 撤销额外权限
    public func revokePermission(
        orgId: String,
        memberDID: String,
        permission: Permission
    ) async throws {
        // 获取当前权限
        var currentPermissions = try await getExtraPermissions(orgId: orgId, memberDID: memberDID)
        currentPermissions.remove(permission)

        // 保存
        try await updateExtraPermissions(
            orgId: orgId,
            memberDID: memberDID,
            permissions: Array(currentPermissions)
        )

        // 清除缓存
        clearPermissionCache(orgId: orgId, memberDID: memberDID)

        // 发布事件
        permissionRevoked.send((orgId, memberDID, permission))

        Logger.shared.info("[RBACManager] 权限已撤销: \(memberDID) -> \(permission.rawValue)")
    }

    // MARK: - Built-in Roles Initialization

    /// 初始化内置角色
    public func initializeBuiltinRoles(orgId: String) async throws {
        Logger.shared.info("[RBACManager] 初始化内置角色: \(orgId)")

        for role in OrganizationRole.allCases {
            // 检查是否已存在
            let existing = try await getRole(orgId: orgId, name: role.rawValue)
            if existing == nil {
                _ = try await createRole(
                    orgId: orgId,
                    name: role.rawValue,
                    description: role.description,
                    permissions: role.defaultPermissions,
                    isBuiltin: true
                )
            }
        }

        Logger.shared.info("[RBACManager] 内置角色初始化完成")
    }

    // MARK: - Helper Methods

    /// 获取角色的成员数量
    private func getRoleMemberCount(orgId: String, roleName: String) async throws -> Int {
        let query = "SELECT COUNT(*) as count FROM organization_members WHERE org_id = ? AND role = ?"
        let rows = try await database.query(query, [orgId, roleName])
        return rows.first?["count"] as? Int ?? 0
    }

    /// 获取成员的额外权限
    private func getExtraPermissions(orgId: String, memberDID: String) async throws -> Set<Permission> {
        let query = "SELECT permissions_json FROM organization_members WHERE org_id = ? AND member_did = ?"
        let rows = try await database.query(query, [orgId, memberDID])

        guard let row = rows.first,
              let permissionsJson = row["permissions_json"] as? String,
              let permissionsData = permissionsJson.data(using: .utf8),
              let permissions = try? JSONDecoder().decode([Permission].self, from: permissionsData) else {
            return Set()
        }

        return Set(permissions)
    }

    /// 更新成员的额外权限
    private func updateExtraPermissions(
        orgId: String,
        memberDID: String,
        permissions: [Permission]
    ) async throws {
        let permissionsData = try JSONEncoder().encode(permissions)
        let permissionsJson = String(data: permissionsData, encoding: .utf8) ?? "[]"

        let query = """
        UPDATE organization_members
        SET permissions_json = ?, updated_at = ?
        WHERE org_id = ? AND member_did = ?
        """

        try await database.execute(query, [
            permissionsJson,
            Int(Date().timeIntervalSince1970),
            orgId,
            memberDID
        ])
    }

    /// 清除权限缓存
    private func clearPermissionCache(orgId: String, memberDID: String? = nil) {
        if let memberDID = memberDID {
            // 清除特定成员的缓存
            permissionCache = permissionCache.filter { !$0.key.hasPrefix("\(orgId):\(memberDID):") }
        } else {
            // 清除整个组织的缓存
            permissionCache = permissionCache.filter { !$0.key.hasPrefix("\(orgId):") }
        }
    }

    // MARK: - Database Operations

    /// 保存角色
    private func saveRole(_ role: RoleRecord) async throws {
        let permissionsData = try JSONEncoder().encode(role.permissions)
        let permissionsJson = String(data: permissionsData, encoding: .utf8) ?? "[]"

        let sql = """
        INSERT INTO organization_roles (
            id, org_id, name, description, permissions_json, is_builtin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """

        try await database.execute(sql, [
            role.id,
            role.orgId,
            role.name,
            role.description,
            permissionsJson,
            role.isBuiltin ? 1 : 0,
            Int(role.createdAt.timeIntervalSince1970),
            Int(role.updatedAt.timeIntervalSince1970)
        ])
    }

    /// 更新角色
    private func updateRoleInDB(_ role: RoleRecord) async throws {
        let permissionsData = try JSONEncoder().encode(role.permissions)
        let permissionsJson = String(data: permissionsData, encoding: .utf8) ?? "[]"

        let sql = """
        UPDATE organization_roles
        SET description = ?, permissions_json = ?, updated_at = ?
        WHERE id = ?
        """

        try await database.execute(sql, [
            role.description,
            permissionsJson,
            Int(role.updatedAt.timeIntervalSince1970),
            role.id
        ])
    }

    /// 删除角色
    private func deleteRoleFromDB(roleId: String) async throws {
        try await database.execute("DELETE FROM organization_roles WHERE id = ?", [roleId])
    }

    /// 解析角色记录
    private func parseRoleRecord(from row: [String: Any]) -> RoleRecord? {
        guard
            let id = row["id"] as? String,
            let orgId = row["org_id"] as? String,
            let name = row["name"] as? String,
            let description = row["description"] as? String,
            let permissionsJson = row["permissions_json"] as? String,
            let isBuiltin = row["is_builtin"] as? Int,
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int,
            let permissionsData = permissionsJson.data(using: .utf8),
            let permissions = try? JSONDecoder().decode([Permission].self, from: permissionsData)
        else {
            return nil
        }

        let createdAt = Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp))
        let updatedAt = Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))

        return RoleRecord(
            id: id,
            orgId: orgId,
            name: name,
            description: description,
            permissions: permissions,
            isBuiltin: isBuiltin == 1,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

// MARK: - Supporting Types

/// 缓存的权限
private struct CachedPermission {
    let hasPermission: Bool
    let cachedAt: Date

    var isExpired: Bool {
        return Date().timeIntervalSince(cachedAt) > 300  // 5分钟
    }
}

// MARK: - Extended Role Errors

extension RoleError {
    static let roleInUse = RoleError.cannotDeleteBuiltinRole  // Reuse error for now
}
