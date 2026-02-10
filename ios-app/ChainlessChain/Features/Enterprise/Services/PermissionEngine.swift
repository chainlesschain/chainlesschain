import Foundation
import CoreCommon
import Combine

/// 权限引擎
/// 核心权限评估引擎，支持企业级RBAC
/// - 资源级别权限
/// - 权限继承
/// - 条件访问
/// - 权限委派
/// - 团队权限
@MainActor
public class PermissionEngine: ObservableObject {

    // MARK: - Singleton

    public static let shared = PermissionEngine()

    // MARK: - Properties

    private let database: Database

    /// 权限缓存
    private var permissionCache: [String: CachedPermissionResult] = [:]
    private let cacheTimeout: TimeInterval = 60  // 1分钟

    /// 事件发布器
    public let permissionGranted = PassthroughSubject<PermissionGrant, Never>()
    public let permissionRevoked = PassthroughSubject<String, Never>()
    public let delegationCreated = PassthroughSubject<PermissionDelegation, Never>()
    public let delegationRevoked = PassthroughSubject<String, Never>()

    // MARK: - Initialization

    private init() {
        self.database = Database.shared
        Logger.shared.info("[PermissionEngine] 权限引擎已初始化")
    }

    /// 初始化数据库表
    public func initialize() async throws {
        Logger.shared.info("[PermissionEngine] 初始化数据库表...")

        // 权限授予表
        let createGrantsTableSQL = """
        CREATE TABLE IF NOT EXISTS permission_grants (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            grantee_type TEXT NOT NULL,
            grantee_id TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT,
            permission TEXT NOT NULL,
            conditions_json TEXT,
            granted_by TEXT NOT NULL,
            expires_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(org_id, grantee_type, grantee_id, resource_type, resource_id, permission)
        )
        """

        // 权限继承表
        let createInheritanceTableSQL = """
        CREATE TABLE IF NOT EXISTS permission_inheritance (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            parent_resource_type TEXT NOT NULL,
            parent_resource_id TEXT NOT NULL,
            child_resource_type TEXT NOT NULL,
            child_resource_id TEXT NOT NULL,
            inherit_permissions_json TEXT,
            created_at INTEGER NOT NULL,
            UNIQUE(org_id, parent_resource_type, parent_resource_id, child_resource_type, child_resource_id)
        )
        """

        // 权限委派表
        let createDelegationsTableSQL = """
        CREATE TABLE IF NOT EXISTS permission_delegations (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            delegator_did TEXT NOT NULL,
            delegate_did TEXT NOT NULL,
            permissions_json TEXT NOT NULL,
            resource_scope_json TEXT,
            reason TEXT,
            start_date INTEGER NOT NULL,
            end_date INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """

        // 权限审计日志表
        let createAuditLogTableSQL = """
        CREATE TABLE IF NOT EXISTS permission_audit_log (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            user_did TEXT NOT NULL,
            permission TEXT NOT NULL,
            action TEXT NOT NULL,
            result TEXT NOT NULL,
            resource_type TEXT,
            resource_id TEXT,
            context_json TEXT,
            created_at INTEGER NOT NULL
        )
        """

        try await database.execute(createGrantsTableSQL)
        try await database.execute(createInheritanceTableSQL)
        try await database.execute(createDelegationsTableSQL)
        try await database.execute(createAuditLogTableSQL)

        // 创建索引
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_permission_grants_org ON permission_grants(org_id)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_permission_grants_grantee ON permission_grants(grantee_type, grantee_id)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_permission_delegations_delegate ON permission_delegations(delegate_did)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_permission_audit_log_org ON permission_audit_log(org_id)")

        Logger.shared.info("[PermissionEngine] 数据库表初始化成功")
    }

    // MARK: - Permission Grant Operations

    /// 授予权限
    public func grantPermission(
        orgId: String,
        granteeType: GranteeType,
        granteeId: String,
        resourceType: String,
        resourceId: String? = nil,
        permission: String,
        conditions: [String: String]? = nil,
        grantedBy: String,
        expiresAt: Date? = nil
    ) async throws -> PermissionGrant {
        let grant = PermissionGrant(
            orgId: orgId,
            granteeType: granteeType,
            granteeId: granteeId,
            resourceType: resourceType,
            resourceId: resourceId,
            permission: permission,
            conditions: conditions,
            grantedBy: grantedBy,
            expiresAt: expiresAt
        )

        let conditionsJson = conditions != nil ? try? JSONEncoder().encode(conditions).utf8String : nil

        let sql = """
        INSERT INTO permission_grants (
            id, org_id, grantee_type, grantee_id, resource_type, resource_id,
            permission, conditions_json, granted_by, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        try await database.execute(sql, [
            grant.id,
            grant.orgId,
            grant.granteeType.rawValue,
            grant.granteeId,
            grant.resourceType,
            grant.resourceId as Any,
            grant.permission,
            conditionsJson as Any,
            grant.grantedBy,
            expiresAt.map { Int($0.timeIntervalSince1970) } as Any,
            Int(grant.createdAt.timeIntervalSince1970),
            Int(grant.updatedAt.timeIntervalSince1970)
        ])

        // 清除缓存
        invalidateCache(granteeId: granteeId)

        // 记录审计日志
        await logAudit(
            orgId: orgId,
            userDid: grantedBy,
            permission: permission,
            action: .grant,
            result: .success,
            resourceType: resourceType,
            resourceId: resourceId
        )

        Logger.shared.info("[PermissionEngine] 权限已授予: \(permission) -> \(granteeId) on \(resourceType)/\(resourceId ?? "*")")

        permissionGranted.send(grant)

        return grant
    }

    /// 撤销权限
    public func revokePermission(grantId: String, revokedBy: String) async throws {
        // 获取授权记录
        let query = "SELECT * FROM permission_grants WHERE id = ?"
        let rows = try await database.query(query, [grantId])

        guard let row = rows.first else {
            throw PermissionEngineError.grantNotFound
        }

        let granteeId = row["grantee_id"] as? String ?? ""
        let orgId = row["org_id"] as? String ?? ""
        let permission = row["permission"] as? String ?? ""
        let resourceType = row["resource_type"] as? String
        let resourceId = row["resource_id"] as? String

        // 删除记录
        try await database.execute("DELETE FROM permission_grants WHERE id = ?", [grantId])

        // 清除缓存
        invalidateCache(granteeId: granteeId)

        // 记录审计日志
        await logAudit(
            orgId: orgId,
            userDid: revokedBy,
            permission: permission,
            action: .revoke,
            result: .success,
            resourceType: resourceType,
            resourceId: resourceId
        )

        Logger.shared.info("[PermissionEngine] 权限已撤销: \(grantId)")

        permissionRevoked.send(grantId)
    }

    /// 检查权限
    public func checkPermission(
        userDid: String,
        orgId: String,
        resourceType: String,
        resourceId: String?,
        permission: String
    ) async throws -> Bool {
        let cacheKey = "\(userDid):\(orgId):\(resourceType):\(resourceId ?? "*"):\(permission)"

        // 检查缓存
        if let cached = permissionCache[cacheKey], !cached.isExpired {
            return cached.hasPermission
        }

        let now = Date()

        // 1. 检查直接用户权限
        var hasPermission = try await checkDirectPermission(
            granteeType: .user,
            granteeId: userDid,
            orgId: orgId,
            resourceType: resourceType,
            resourceId: resourceId,
            permission: permission,
            now: now
        )

        if !hasPermission {
            // 2. 检查角色权限
            let userRoles = try await getUserRoles(userDid: userDid, orgId: orgId)
            for roleId in userRoles {
                hasPermission = try await checkDirectPermission(
                    granteeType: .role,
                    granteeId: roleId,
                    orgId: orgId,
                    resourceType: resourceType,
                    resourceId: resourceId,
                    permission: permission,
                    now: now
                )
                if hasPermission { break }
            }
        }

        if !hasPermission {
            // 3. 检查团队权限
            let userTeams = try await getUserTeams(userDid: userDid, orgId: orgId)
            for teamId in userTeams {
                hasPermission = try await checkDirectPermission(
                    granteeType: .team,
                    granteeId: teamId,
                    orgId: orgId,
                    resourceType: resourceType,
                    resourceId: resourceId,
                    permission: permission,
                    now: now
                )
                if hasPermission { break }
            }
        }

        if !hasPermission {
            // 4. 检查继承权限
            hasPermission = try await checkInheritedPermission(
                userDid: userDid,
                orgId: orgId,
                resourceType: resourceType,
                resourceId: resourceId,
                permission: permission,
                now: now
            )
        }

        if !hasPermission {
            // 5. 检查委派权限
            hasPermission = try await checkDelegatedPermission(
                userDid: userDid,
                orgId: orgId,
                resourceType: resourceType,
                resourceId: resourceId,
                permission: permission,
                now: now
            )
        }

        // 更新缓存
        permissionCache[cacheKey] = CachedPermissionResult(
            hasPermission: hasPermission,
            cachedAt: Date()
        )

        return hasPermission
    }

    /// 获取用户的所有权限
    public func getUserPermissions(userDid: String, orgId: String) async throws -> UserPermissions {
        let now = Int(Date().timeIntervalSince1970)

        // 获取直接权限
        let directQuery = """
        SELECT * FROM permission_grants
        WHERE org_id = ? AND grantee_type = 'user' AND grantee_id = ?
            AND (expires_at IS NULL OR expires_at > ?)
        """
        let directRows = try await database.query(directQuery, [orgId, userDid, now])
        let directGrants = directRows.compactMap { parsePermissionGrant(from: $0) }

        // 获取角色权限
        let userRoles = try await getUserRoles(userDid: userDid, orgId: orgId)
        var roleGrants: [PermissionGrant] = []
        for roleId in userRoles {
            let roleQuery = """
            SELECT * FROM permission_grants
            WHERE org_id = ? AND grantee_type = 'role' AND grantee_id = ?
                AND (expires_at IS NULL OR expires_at > ?)
            """
            let roleRows = try await database.query(roleQuery, [orgId, roleId, now])
            roleGrants.append(contentsOf: roleRows.compactMap { parsePermissionGrant(from: $0) })
        }

        // 获取团队权限
        let userTeams = try await getUserTeams(userDid: userDid, orgId: orgId)
        var teamGrants: [PermissionGrant] = []
        for teamId in userTeams {
            let teamQuery = """
            SELECT * FROM permission_grants
            WHERE org_id = ? AND grantee_type = 'team' AND grantee_id = ?
                AND (expires_at IS NULL OR expires_at > ?)
            """
            let teamRows = try await database.query(teamQuery, [orgId, teamId, now])
            teamGrants.append(contentsOf: teamRows.compactMap { parsePermissionGrant(from: $0) })
        }

        // 获取委派权限
        let delegationQuery = """
        SELECT * FROM permission_delegations
        WHERE org_id = ? AND delegate_did = ? AND status = 'active'
            AND start_date <= ? AND end_date > ?
        """
        let delegationRows = try await database.query(delegationQuery, [orgId, userDid, now, now])
        let delegations = delegationRows.compactMap { parseDelegation(from: $0) }

        return UserPermissions(
            direct: directGrants,
            role: roleGrants,
            team: teamGrants,
            delegated: delegations
        )
    }

    /// 获取资源的权限列表
    public func getResourcePermissions(
        orgId: String,
        resourceType: String,
        resourceId: String?
    ) async throws -> [PermissionGrant] {
        let now = Int(Date().timeIntervalSince1970)

        let query = """
        SELECT * FROM permission_grants
        WHERE org_id = ? AND resource_type = ?
            AND (resource_id = ? OR resource_id IS NULL)
            AND (expires_at IS NULL OR expires_at > ?)
        """

        let rows = try await database.query(query, [orgId, resourceType, resourceId as Any, now])
        return rows.compactMap { parsePermissionGrant(from: $0) }
    }

    /// 批量授予权限
    public func bulkGrant(
        grants: [PermissionGrantRequest],
        grantedBy: String
    ) async throws -> [PermissionGrant] {
        var results: [PermissionGrant] = []

        for request in grants {
            let grant = try await grantPermission(
                orgId: request.orgId,
                granteeType: request.granteeType,
                granteeId: request.granteeId,
                resourceType: request.resourceType,
                resourceId: request.resourceId,
                permission: request.permission,
                conditions: request.conditions,
                grantedBy: grantedBy,
                expiresAt: request.expiresAt
            )
            results.append(grant)
        }

        return results
    }

    /// 获取有效权限（合并所有来源）
    public func getEffectivePermissions(
        userDid: String,
        orgId: String,
        resourceType: String,
        resourceId: String?
    ) async throws -> Set<String> {
        let allPermissions = try await getUserPermissions(userDid: userDid, orgId: orgId)
        return allPermissions.effectivePermissions(for: resourceType, resourceId: resourceId)
    }

    // MARK: - Permission Inheritance

    /// 设置权限继承
    public func inheritPermissions(
        orgId: String,
        parentResourceType: String,
        parentResourceId: String,
        childResourceType: String,
        childResourceId: String,
        inheritPermissions: [String]? = nil
    ) async throws -> PermissionInheritance {
        let inheritance = PermissionInheritance(
            orgId: orgId,
            parentResourceType: parentResourceType,
            parentResourceId: parentResourceId,
            childResourceType: childResourceType,
            childResourceId: childResourceId,
            inheritPermissions: inheritPermissions
        )

        let inheritPermissionsJson = inheritPermissions != nil
            ? try? JSONEncoder().encode(inheritPermissions).utf8String
            : nil

        let sql = """
        INSERT INTO permission_inheritance (
            id, org_id, parent_resource_type, parent_resource_id,
            child_resource_type, child_resource_id, inherit_permissions_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """

        try await database.execute(sql, [
            inheritance.id,
            inheritance.orgId,
            inheritance.parentResourceType,
            inheritance.parentResourceId,
            inheritance.childResourceType,
            inheritance.childResourceId,
            inheritPermissionsJson as Any,
            Int(inheritance.createdAt.timeIntervalSince1970)
        ])

        Logger.shared.info("[PermissionEngine] 权限继承已设置: \(parentResourceType)/\(parentResourceId) -> \(childResourceType)/\(childResourceId)")

        return inheritance
    }

    /// 移除权限继承
    public func removeInheritance(inheritanceId: String) async throws {
        try await database.execute("DELETE FROM permission_inheritance WHERE id = ?", [inheritanceId])
        Logger.shared.info("[PermissionEngine] 权限继承已移除: \(inheritanceId)")
    }

    // MARK: - Permission Delegation

    /// 委派权限
    public func delegatePermissions(
        orgId: String,
        delegatorDid: String,
        delegateDid: String,
        permissions: [String],
        resourceScope: ResourceScope? = nil,
        reason: String? = nil,
        startDate: Date = Date(),
        endDate: Date
    ) async throws -> PermissionDelegation {
        let delegation = PermissionDelegation(
            orgId: orgId,
            delegatorDid: delegatorDid,
            delegateDid: delegateDid,
            permissions: permissions,
            resourceScope: resourceScope,
            reason: reason,
            startDate: startDate,
            endDate: endDate
        )

        let permissionsJson = try JSONEncoder().encode(permissions).utf8String ?? "[]"
        let resourceScopeJson = resourceScope != nil
            ? try? JSONEncoder().encode(resourceScope).utf8String
            : nil

        let sql = """
        INSERT INTO permission_delegations (
            id, org_id, delegator_did, delegate_did, permissions_json,
            resource_scope_json, reason, start_date, end_date, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        try await database.execute(sql, [
            delegation.id,
            delegation.orgId,
            delegation.delegatorDid,
            delegation.delegateDid,
            permissionsJson,
            resourceScopeJson as Any,
            delegation.reason as Any,
            Int(delegation.startDate.timeIntervalSince1970),
            Int(delegation.endDate.timeIntervalSince1970),
            delegation.status.rawValue,
            Int(delegation.createdAt.timeIntervalSince1970),
            Int(delegation.updatedAt.timeIntervalSince1970)
        ])

        // 清除缓存
        invalidateCache(granteeId: delegateDid)

        // 记录审计日志
        await logAudit(
            orgId: orgId,
            userDid: delegatorDid,
            permission: permissions.joined(separator: ","),
            action: .delegate,
            result: .success,
            resourceType: resourceScope?.resourceType,
            resourceId: resourceScope?.resourceId
        )

        Logger.shared.info("[PermissionEngine] 权限已委派: \(delegatorDid) -> \(delegateDid)")

        delegationCreated.send(delegation)

        return delegation
    }

    /// 撤销委派
    public func revokeDelegation(delegationId: String, revokedBy: String) async throws {
        // 获取委派记录
        let query = "SELECT * FROM permission_delegations WHERE id = ?"
        let rows = try await database.query(query, [delegationId])

        guard let row = rows.first else {
            throw PermissionEngineError.delegationNotFound
        }

        let delegateDid = row["delegate_did"] as? String ?? ""
        let orgId = row["org_id"] as? String ?? ""

        // 更新状态
        let sql = """
        UPDATE permission_delegations
        SET status = 'revoked', updated_at = ?
        WHERE id = ?
        """

        try await database.execute(sql, [Int(Date().timeIntervalSince1970), delegationId])

        // 清除缓存
        invalidateCache(granteeId: delegateDid)

        Logger.shared.info("[PermissionEngine] 委派已撤销: \(delegationId)")

        delegationRevoked.send(delegationId)
    }

    /// 获取用户收到的委派
    public func getReceivedDelegations(userDid: String, orgId: String) async throws -> [PermissionDelegation] {
        let now = Int(Date().timeIntervalSince1970)

        let query = """
        SELECT * FROM permission_delegations
        WHERE org_id = ? AND delegate_did = ? AND status = 'active'
            AND start_date <= ? AND end_date > ?
        ORDER BY created_at DESC
        """

        let rows = try await database.query(query, [orgId, userDid, now, now])
        return rows.compactMap { parseDelegation(from: $0) }
    }

    /// 获取用户发出的委派
    public func getSentDelegations(userDid: String, orgId: String) async throws -> [PermissionDelegation] {
        let query = """
        SELECT * FROM permission_delegations
        WHERE org_id = ? AND delegator_did = ?
        ORDER BY created_at DESC
        """

        let rows = try await database.query(query, [orgId, userDid])
        return rows.compactMap { parseDelegation(from: $0) }
    }

    // MARK: - Audit Log

    /// 获取审计日志
    public func getAuditLogs(
        orgId: String,
        limit: Int = 100,
        offset: Int = 0
    ) async throws -> [PermissionAuditLog] {
        let query = """
        SELECT * FROM permission_audit_log
        WHERE org_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        """

        let rows = try await database.query(query, [orgId, limit, offset])
        return rows.compactMap { parseAuditLog(from: $0) }
    }

    // MARK: - Helper Methods

    private func checkDirectPermission(
        granteeType: GranteeType,
        granteeId: String,
        orgId: String,
        resourceType: String,
        resourceId: String?,
        permission: String,
        now: Date
    ) async throws -> Bool {
        let nowTimestamp = Int(now.timeIntervalSince1970)

        let query = """
        SELECT 1 FROM permission_grants
        WHERE org_id = ? AND grantee_type = ? AND grantee_id = ?
            AND resource_type = ? AND (resource_id = ? OR resource_id IS NULL)
            AND permission = ?
            AND (expires_at IS NULL OR expires_at > ?)
        LIMIT 1
        """

        let rows = try await database.query(query, [
            orgId,
            granteeType.rawValue,
            granteeId,
            resourceType,
            resourceId as Any,
            permission,
            nowTimestamp
        ])

        return !rows.isEmpty
    }

    private func checkInheritedPermission(
        userDid: String,
        orgId: String,
        resourceType: String,
        resourceId: String?,
        permission: String,
        now: Date
    ) async throws -> Bool {
        guard let resourceId = resourceId else { return false }

        // 查找父资源
        let query = """
        SELECT parent_resource_type, parent_resource_id, inherit_permissions_json
        FROM permission_inheritance
        WHERE org_id = ? AND child_resource_type = ? AND child_resource_id = ?
        """

        let rows = try await database.query(query, [orgId, resourceType, resourceId])

        for row in rows {
            guard let parentType = row["parent_resource_type"] as? String,
                  let parentId = row["parent_resource_id"] as? String else {
                continue
            }

            // 检查继承权限列表
            if let inheritJson = row["inherit_permissions_json"] as? String,
               let inheritData = inheritJson.data(using: .utf8),
               let inheritPerms = try? JSONDecoder().decode([String].self, from: inheritData) {
                if !inheritPerms.contains(permission) {
                    continue
                }
            }

            // 递归检查父资源权限
            let hasPermission = try await checkPermission(
                userDid: userDid,
                orgId: orgId,
                resourceType: parentType,
                resourceId: parentId,
                permission: permission
            )

            if hasPermission {
                return true
            }
        }

        return false
    }

    private func checkDelegatedPermission(
        userDid: String,
        orgId: String,
        resourceType: String,
        resourceId: String?,
        permission: String,
        now: Date
    ) async throws -> Bool {
        let nowTimestamp = Int(now.timeIntervalSince1970)

        let query = """
        SELECT permissions_json, resource_scope_json FROM permission_delegations
        WHERE org_id = ? AND delegate_did = ? AND status = 'active'
            AND start_date <= ? AND end_date > ?
        """

        let rows = try await database.query(query, [orgId, userDid, nowTimestamp, nowTimestamp])

        for row in rows {
            guard let permissionsJson = row["permissions_json"] as? String,
                  let permissionsData = permissionsJson.data(using: .utf8),
                  let permissions = try? JSONDecoder().decode([String].self, from: permissionsData) else {
                continue
            }

            guard permissions.contains(permission) else { continue }

            // 检查资源范围
            if let scopeJson = row["resource_scope_json"] as? String,
               let scopeData = scopeJson.data(using: .utf8),
               let scope = try? JSONDecoder().decode(ResourceScope.self, from: scopeData) {
                if scope.resourceType != resourceType {
                    continue
                }
                if let scopeResourceId = scope.resourceId, scopeResourceId != resourceId {
                    continue
                }
            }

            return true
        }

        return false
    }

    private func getUserRoles(userDid: String, orgId: String) async throws -> [String] {
        let query = """
        SELECT role FROM organization_members WHERE org_id = ? AND member_did = ?
        """

        let rows = try await database.query(query, [orgId, userDid])
        return rows.compactMap { $0["role"] as? String }
    }

    private func getUserTeams(userDid: String, orgId: String) async throws -> [String] {
        let query = """
        SELECT tm.team_id FROM org_team_members tm
        INNER JOIN org_teams t ON t.id = tm.team_id
        WHERE t.org_id = ? AND tm.member_did = ?
        """

        let rows = try await database.query(query, [orgId, userDid])
        return rows.compactMap { $0["team_id"] as? String }
    }

    private func logAudit(
        orgId: String,
        userDid: String,
        permission: String,
        action: AuditAction,
        result: AuditResult,
        resourceType: String? = nil,
        resourceId: String? = nil,
        context: [String: String]? = nil
    ) async {
        do {
            let log = PermissionAuditLog(
                orgId: orgId,
                userDid: userDid,
                permission: permission,
                action: action,
                result: result,
                resourceType: resourceType,
                resourceId: resourceId,
                context: context
            )

            let contextJson = context != nil
                ? try? JSONEncoder().encode(context).utf8String
                : nil

            let sql = """
            INSERT INTO permission_audit_log (
                id, org_id, user_did, permission, action, result,
                resource_type, resource_id, context_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """

            try await database.execute(sql, [
                log.id,
                log.orgId,
                log.userDid,
                log.permission,
                log.action.rawValue,
                log.result.rawValue,
                log.resourceType as Any,
                log.resourceId as Any,
                contextJson as Any,
                Int(log.createdAt.timeIntervalSince1970)
            ])
        } catch {
            Logger.shared.warning("[PermissionEngine] 记录审计日志失败: \(error)")
        }
    }

    private func invalidateCache(granteeId: String) {
        permissionCache = permissionCache.filter { !$0.key.contains(granteeId) }
    }

    // MARK: - Parsing Methods

    private func parsePermissionGrant(from row: [String: Any]) -> PermissionGrant? {
        guard
            let id = row["id"] as? String,
            let orgId = row["org_id"] as? String,
            let granteeTypeRaw = row["grantee_type"] as? String,
            let granteeType = GranteeType(rawValue: granteeTypeRaw),
            let granteeId = row["grantee_id"] as? String,
            let resourceType = row["resource_type"] as? String,
            let permission = row["permission"] as? String,
            let grantedBy = row["granted_by"] as? String,
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int
        else {
            return nil
        }

        let resourceId = row["resource_id"] as? String
        let expiresAt = (row["expires_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }

        var conditions: [String: String]?
        if let conditionsJson = row["conditions_json"] as? String,
           let data = conditionsJson.data(using: .utf8) {
            conditions = try? JSONDecoder().decode([String: String].self, from: data)
        }

        return PermissionGrant(
            id: id,
            orgId: orgId,
            granteeType: granteeType,
            granteeId: granteeId,
            resourceType: resourceType,
            resourceId: resourceId,
            permission: permission,
            conditions: conditions,
            grantedBy: grantedBy,
            expiresAt: expiresAt,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
        )
    }

    private func parseDelegation(from row: [String: Any]) -> PermissionDelegation? {
        guard
            let id = row["id"] as? String,
            let orgId = row["org_id"] as? String,
            let delegatorDid = row["delegator_did"] as? String,
            let delegateDid = row["delegate_did"] as? String,
            let permissionsJson = row["permissions_json"] as? String,
            let startDateTimestamp = row["start_date"] as? Int,
            let endDateTimestamp = row["end_date"] as? Int,
            let statusRaw = row["status"] as? String,
            let status = DelegationStatus(rawValue: statusRaw),
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int,
            let permissionsData = permissionsJson.data(using: .utf8),
            let permissions = try? JSONDecoder().decode([String].self, from: permissionsData)
        else {
            return nil
        }

        var resourceScope: ResourceScope?
        if let scopeJson = row["resource_scope_json"] as? String,
           let data = scopeJson.data(using: .utf8) {
            resourceScope = try? JSONDecoder().decode(ResourceScope.self, from: data)
        }

        return PermissionDelegation(
            id: id,
            orgId: orgId,
            delegatorDid: delegatorDid,
            delegateDid: delegateDid,
            permissions: permissions,
            resourceScope: resourceScope,
            reason: row["reason"] as? String,
            startDate: Date(timeIntervalSince1970: TimeInterval(startDateTimestamp)),
            endDate: Date(timeIntervalSince1970: TimeInterval(endDateTimestamp)),
            status: status,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
        )
    }

    private func parseAuditLog(from row: [String: Any]) -> PermissionAuditLog? {
        guard
            let id = row["id"] as? String,
            let orgId = row["org_id"] as? String,
            let userDid = row["user_did"] as? String,
            let permission = row["permission"] as? String,
            let actionRaw = row["action"] as? String,
            let action = AuditAction(rawValue: actionRaw),
            let resultRaw = row["result"] as? String,
            let result = AuditResult(rawValue: resultRaw),
            let createdAtTimestamp = row["created_at"] as? Int
        else {
            return nil
        }

        var context: [String: String]?
        if let contextJson = row["context_json"] as? String,
           let data = contextJson.data(using: .utf8) {
            context = try? JSONDecoder().decode([String: String].self, from: data)
        }

        return PermissionAuditLog(
            id: id,
            orgId: orgId,
            userDid: userDid,
            permission: permission,
            action: action,
            result: result,
            resourceType: row["resource_type"] as? String,
            resourceId: row["resource_id"] as? String,
            context: context,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp))
        )
    }
}

// MARK: - Supporting Types

/// 缓存的权限结果
private struct CachedPermissionResult {
    let hasPermission: Bool
    let cachedAt: Date

    var isExpired: Bool {
        return Date().timeIntervalSince(cachedAt) > 60  // 1分钟
    }
}

/// 权限授予请求
public struct PermissionGrantRequest {
    public let orgId: String
    public let granteeType: GranteeType
    public let granteeId: String
    public let resourceType: String
    public let resourceId: String?
    public let permission: String
    public let conditions: [String: String]?
    public let expiresAt: Date?

    public init(
        orgId: String,
        granteeType: GranteeType,
        granteeId: String,
        resourceType: String,
        resourceId: String? = nil,
        permission: String,
        conditions: [String: String]? = nil,
        expiresAt: Date? = nil
    ) {
        self.orgId = orgId
        self.granteeType = granteeType
        self.granteeId = granteeId
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.permission = permission
        self.conditions = conditions
        self.expiresAt = expiresAt
    }
}

/// 权限引擎错误
public enum PermissionEngineError: Error, LocalizedError {
    case grantNotFound
    case delegationNotFound
    case permissionExists
    case invalidParameters

    public var errorDescription: String? {
        switch self {
        case .grantNotFound:
            return "权限授予记录不存在"
        case .delegationNotFound:
            return "权限委派记录不存在"
        case .permissionExists:
            return "权限已存在"
        case .invalidParameters:
            return "无效的参数"
        }
    }
}

// MARK: - Data Extension

private extension Data {
    var utf8String: String? {
        return String(data: self, encoding: .utf8)
    }
}
