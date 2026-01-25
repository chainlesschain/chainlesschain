import Foundation
import Combine
import SQLite

/// 工作空间管理服务
@MainActor
public class WorkspaceManager: ObservableObject {
    public static let shared = WorkspaceManager()

    // MARK: - Published Properties

    @Published public var workspaces: [String: [Workspace]] = [:]  // orgId -> workspaces
    @Published public var currentWorkspace: Workspace?

    // MARK: - Private Properties

    private var db: Connection?
    private let rbacManager = RBACManager.shared
    private let organizationManager = OrganizationManager.shared
    private let workspaceChanged = PassthroughSubject<Workspace, Never>()

    // MARK: - Initialization

    private init() {}

    public func initialize(db: Connection) throws {
        self.db = db
        try createWorkspaceTables()
    }

    // MARK: - Workspace CRUD

    /// 创建工作空间
    public func createWorkspace(
        orgId: String,
        name: String,
        description: String = "",
        type: WorkspaceType = .default,
        color: String = "#1890ff",
        icon: String = "folder",
        visibility: WorkspaceVisibility = .members,
        allowedRoles: [String] = [],
        creatorDID: String
    ) async throws -> Workspace {
        guard let db = db else {
            throw WorkspaceError.workspaceNotFound
        }

        // 检查组织是否存在
        guard try await organizationManager.getOrganization(orgId: orgId) != nil else {
            throw WorkspaceError.workspaceNotFound
        }

        // 检查权限
        let hasPermission = try await rbacManager.checkPermission(
            orgId: orgId,
            userDID: creatorDID,
            permission: .workspaceCreate
        )
        guard hasPermission else {
            throw WorkspaceError.insufficientPermissions
        }

        // 检查名称是否重复
        if let existingWorkspaces = workspaces[orgId],
           existingWorkspaces.contains(where: { $0.name == name }) {
            throw WorkspaceError.workspaceNameExists
        }

        // 创建工作空间
        let workspace = Workspace(
            orgId: orgId,
            name: name,
            description: description,
            type: type,
            color: color,
            icon: icon,
            visibility: visibility,
            allowedRoles: allowedRoles,
            createdBy: creatorDID
        )

        // 保存到数据库
        try await saveWorkspace(workspace)

        // 添加创建者为工作空间成员
        try await addWorkspaceMember(
            workspaceId: workspace.id,
            memberDID: creatorDID,
            displayName: "Creator",
            role: .owner
        )

        // 更新内存
        if workspaces[orgId] == nil {
            workspaces[orgId] = []
        }
        workspaces[orgId]?.append(workspace)

        // 记录活动
        try await logActivity(
            workspaceId: workspace.id,
            actorDID: creatorDID,
            action: .createWorkspace,
            resourceType: "workspace",
            resourceId: workspace.id
        )

        workspaceChanged.send(workspace)
        return workspace
    }

    /// 获取工作空间
    public func getWorkspace(workspaceId: String) async throws -> Workspace? {
        guard let db = db else {
            return nil
        }

        let query = """
            SELECT * FROM organization_workspaces WHERE id = ?
        """

        guard let row = try db.prepare(query).bind(workspaceId).makeIterator().next() else {
            return nil
        }

        return try parseWorkspace(from: row)
    }

    /// 获取组织的所有工作空间
    public func getWorkspaces(orgId: String) async throws -> [Workspace] {
        guard let db = db else {
            return []
        }

        let query = """
            SELECT * FROM organization_workspaces
            WHERE org_id = ? AND archived = 0
            ORDER BY is_default DESC, created_at DESC
        """

        var result: [Workspace] = []
        for row in try db.prepare(query).bind(orgId) {
            if let workspace = try? parseWorkspace(from: row) {
                result.append(workspace)
            }
        }

        return result
    }

    /// 更新工作空间
    public func updateWorkspace(
        workspaceId: String,
        name: String? = nil,
        description: String? = nil,
        color: String? = nil,
        icon: String? = nil,
        visibility: WorkspaceVisibility? = nil,
        allowedRoles: [String]? = nil,
        userDID: String
    ) async throws {
        guard let db = db else {
            throw WorkspaceError.workspaceNotFound
        }

        // 获取现有工作空间
        guard var workspace = try await getWorkspace(workspaceId: workspaceId) else {
            throw WorkspaceError.workspaceNotFound
        }

        // 检查权限
        let hasPermission = try await rbacManager.checkPermission(
            orgId: workspace.orgId,
            userDID: userDID,
            permission: .workspaceManage
        )
        guard hasPermission else {
            throw WorkspaceError.insufficientPermissions
        }

        // 更新字段
        if let name = name {
            workspace.name = name
        }
        if let description = description {
            workspace.description = description
        }
        if let color = color {
            workspace.color = color
        }
        if let icon = icon {
            workspace.icon = icon
        }
        if let visibility = visibility {
            workspace.visibility = visibility
        }
        if let allowedRoles = allowedRoles {
            workspace.allowedRoles = allowedRoles
        }
        workspace.updatedAt = Date()

        // 保存到数据库
        try await saveWorkspace(workspace)

        // 更新内存
        if var orgWorkspaces = workspaces[workspace.orgId],
           let index = orgWorkspaces.firstIndex(where: { $0.id == workspaceId }) {
            orgWorkspaces[index] = workspace
            workspaces[workspace.orgId] = orgWorkspaces
        }

        // 记录活动
        try await logActivity(
            workspaceId: workspaceId,
            actorDID: userDID,
            action: .updateWorkspace,
            resourceType: "workspace",
            resourceId: workspaceId
        )

        workspaceChanged.send(workspace)
    }

    /// 归档工作空间
    public func archiveWorkspace(
        workspaceId: String,
        userDID: String
    ) async throws {
        guard let db = db else {
            throw WorkspaceError.workspaceNotFound
        }

        // 获取工作空间
        guard let workspace = try await getWorkspace(workspaceId: workspaceId) else {
            throw WorkspaceError.workspaceNotFound
        }

        // 不能归档默认工作空间
        guard !workspace.isDefault else {
            throw WorkspaceError.cannotDeleteDefaultWorkspace
        }

        // 检查权限
        let hasPermission = try await rbacManager.checkPermission(
            orgId: workspace.orgId,
            userDID: userDID,
            permission: .workspaceManage
        )
        guard hasPermission else {
            throw WorkspaceError.insufficientPermissions
        }

        // 归档工作空间
        let query = """
            UPDATE organization_workspaces
            SET archived = 1, updated_at = ?
            WHERE id = ?
        """
        try db.run(query, Int64(Date().timeIntervalSince1970 * 1000), workspaceId)

        // 从内存移除
        if var orgWorkspaces = workspaces[workspace.orgId] {
            orgWorkspaces.removeAll { $0.id == workspaceId }
            workspaces[workspace.orgId] = orgWorkspaces
        }

        // 记录活动
        try await logActivity(
            workspaceId: workspaceId,
            actorDID: userDID,
            action: .archiveWorkspace,
            resourceType: "workspace",
            resourceId: workspaceId
        )
    }

    /// 删除工作空间
    public func deleteWorkspace(
        workspaceId: String,
        userDID: String
    ) async throws {
        guard let db = db else {
            throw WorkspaceError.workspaceNotFound
        }

        // 获取工作空间
        guard let workspace = try await getWorkspace(workspaceId: workspaceId) else {
            throw WorkspaceError.workspaceNotFound
        }

        // 不能删除默认工作空间
        guard !workspace.isDefault else {
            throw WorkspaceError.cannotDeleteDefaultWorkspace
        }

        // 检查权限（必须是Owner）
        let hasPermission = try await rbacManager.checkPermission(
            orgId: workspace.orgId,
            userDID: userDID,
            permission: .workspaceDelete
        )
        guard hasPermission else {
            throw WorkspaceError.insufficientPermissions
        }

        // 删除工作空间
        let query = "DELETE FROM organization_workspaces WHERE id = ?"
        try db.run(query, workspaceId)

        // 删除成员
        let memberQuery = "DELETE FROM workspace_members WHERE workspace_id = ?"
        try db.run(memberQuery, workspaceId)

        // 删除资源
        let resourceQuery = "DELETE FROM workspace_resources WHERE workspace_id = ?"
        try db.run(resourceQuery, workspaceId)

        // 从内存移除
        if var orgWorkspaces = workspaces[workspace.orgId] {
            orgWorkspaces.removeAll { $0.id == workspaceId }
            workspaces[workspace.orgId] = orgWorkspaces
        }
    }

    // MARK: - Member Management

    /// 添加工作空间成员
    public func addWorkspaceMember(
        workspaceId: String,
        memberDID: String,
        displayName: String,
        avatar: String? = nil,
        role: WorkspaceMemberRole = .member
    ) async throws {
        guard let db = db else {
            throw WorkspaceError.memberNotFound
        }

        // 检查是否已经是成员
        let checkQuery = """
            SELECT id FROM workspace_members
            WHERE workspace_id = ? AND member_did = ?
        """
        if try db.prepare(checkQuery).bind(workspaceId, memberDID).makeIterator().next() != nil {
            return  // 已经是成员，忽略
        }

        // 创建成员
        let member = WorkspaceMember(
            workspaceId: workspaceId,
            memberDID: memberDID,
            displayName: displayName,
            avatar: avatar,
            role: role
        )

        // 保存到数据库
        let query = """
            INSERT INTO workspace_members
            (id, workspace_id, member_did, display_name, avatar, role, joined_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        try db.run(
            query,
            member.id,
            member.workspaceId,
            member.memberDID,
            member.displayName,
            member.avatar,
            member.role.rawValue,
            Int64(member.joinedAt.timeIntervalSince1970 * 1000)
        )
    }

    /// 移除工作空间成员
    public func removeWorkspaceMember(
        workspaceId: String,
        memberDID: String,
        userDID: String
    ) async throws {
        guard let db = db else {
            throw WorkspaceError.memberNotFound
        }

        // 获取工作空间
        guard let workspace = try await getWorkspace(workspaceId: workspaceId) else {
            throw WorkspaceError.workspaceNotFound
        }

        // 检查权限
        let hasPermission = try await rbacManager.checkPermission(
            orgId: workspace.orgId,
            userDID: userDID,
            permission: .workspaceManage
        )
        guard hasPermission else {
            throw WorkspaceError.insufficientPermissions
        }

        // 删除成员
        let query = """
            DELETE FROM workspace_members
            WHERE workspace_id = ? AND member_did = ?
        """
        try db.run(query, workspaceId, memberDID)

        // 记录活动
        try await logActivity(
            workspaceId: workspaceId,
            actorDID: userDID,
            action: .removeMember,
            resourceType: "member",
            resourceId: memberDID
        )
    }

    // MARK: - Resource Management

    /// 添加资源到工作空间
    public func addResource(
        workspaceId: String,
        resourceType: ResourceType,
        resourceId: String,
        resourceName: String,
        userDID: String
    ) async throws {
        guard let db = db else {
            throw WorkspaceError.resourceNotFound
        }

        // 创建资源
        let resource = WorkspaceResource(
            workspaceId: workspaceId,
            resourceType: resourceType,
            resourceId: resourceId,
            resourceName: resourceName,
            addedBy: userDID
        )

        // 保存到数据库
        let query = """
            INSERT INTO workspace_resources
            (id, workspace_id, resource_type, resource_id, resource_name, added_by, added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        try db.run(
            query,
            resource.id,
            resource.workspaceId,
            resource.resourceType.rawValue,
            resource.resourceId,
            resource.resourceName,
            resource.addedBy,
            Int64(resource.addedAt.timeIntervalSince1970 * 1000)
        )

        // 记录活动
        try await logActivity(
            workspaceId: workspaceId,
            actorDID: userDID,
            action: .addResource,
            resourceType: resourceType.rawValue,
            resourceId: resourceId
        )
    }

    /// 从工作空间移除资源
    public func removeResource(
        workspaceId: String,
        resourceId: String,
        userDID: String
    ) async throws {
        guard let db = db else {
            throw WorkspaceError.resourceNotFound
        }

        // 删除资源
        let query = """
            DELETE FROM workspace_resources
            WHERE workspace_id = ? AND resource_id = ?
        """
        try db.run(query, workspaceId, resourceId)

        // 记录活动
        try await logActivity(
            workspaceId: workspaceId,
            actorDID: userDID,
            action: .removeResource,
            resourceType: "resource",
            resourceId: resourceId
        )
    }

    // MARK: - Private Helper Methods

    private func createWorkspaceTables() throws {
        guard let db = db else { return }

        // 创建工作空间表
        let createWorkspaceTable = """
            CREATE TABLE IF NOT EXISTS organization_workspaces (
                id TEXT PRIMARY KEY,
                org_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                type TEXT NOT NULL,
                color TEXT NOT NULL,
                icon TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                visibility TEXT NOT NULL,
                allowed_roles TEXT,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0,
                UNIQUE(org_id, name)
            )
        """
        try db.execute(createWorkspaceTable)

        // 创建工作空间成员表
        let createMemberTable = """
            CREATE TABLE IF NOT EXISTS workspace_members (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                member_did TEXT NOT NULL,
                display_name TEXT,
                avatar TEXT,
                role TEXT NOT NULL,
                joined_at INTEGER NOT NULL,
                last_active_at INTEGER,
                UNIQUE(workspace_id, member_did)
            )
        """
        try db.execute(createMemberTable)

        // 创建工作空间资源表
        let createResourceTable = """
            CREATE TABLE IF NOT EXISTS workspace_resources (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                resource_name TEXT NOT NULL,
                added_by TEXT NOT NULL,
                added_at INTEGER NOT NULL,
                UNIQUE(workspace_id, resource_id)
            )
        """
        try db.execute(createResourceTable)

        // 创建工作空间活动表
        let createActivityTable = """
            CREATE TABLE IF NOT EXISTS workspace_activities (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                actor_did TEXT NOT NULL,
                action TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                metadata TEXT,
                timestamp INTEGER NOT NULL
            )
        """
        try db.execute(createActivityTable)

        // 创建索引
        try db.execute("CREATE INDEX IF NOT EXISTS idx_workspace_org ON organization_workspaces(org_id)")
        try db.execute("CREATE INDEX IF NOT EXISTS idx_workspace_member ON workspace_members(workspace_id)")
        try db.execute("CREATE INDEX IF NOT EXISTS idx_workspace_resource ON workspace_resources(workspace_id)")
        try db.execute("CREATE INDEX IF NOT EXISTS idx_workspace_activity ON workspace_activities(workspace_id)")
    }

    private func saveWorkspace(_ workspace: Workspace) async throws {
        guard let db = db else { return }

        let allowedRolesJson = try? JSONEncoder().encode(workspace.allowedRoles)
        let allowedRolesString = allowedRolesJson.flatMap { String(data: $0, encoding: .utf8) }

        let query = """
            INSERT OR REPLACE INTO organization_workspaces
            (id, org_id, name, description, type, color, icon, is_default, visibility,
             allowed_roles, created_by, created_at, updated_at, archived)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        try db.run(
            query,
            workspace.id,
            workspace.orgId,
            workspace.name,
            workspace.description,
            workspace.type.rawValue,
            workspace.color,
            workspace.icon,
            workspace.isDefault ? 1 : 0,
            workspace.visibility.rawValue,
            allowedRolesString,
            workspace.createdBy,
            Int64(workspace.createdAt.timeIntervalSince1970 * 1000),
            Int64(workspace.updatedAt.timeIntervalSince1970 * 1000),
            workspace.archived ? 1 : 0
        )
    }

    private func logActivity(
        workspaceId: String,
        actorDID: String,
        action: WorkspaceAction,
        resourceType: String,
        resourceId: String,
        metadata: [String: String] = [:]
    ) async throws {
        guard let db = db else { return }

        let metadataJson = try? JSONEncoder().encode(metadata)
        let metadataString = metadataJson.flatMap { String(data: $0, encoding: .utf8) }

        let activity = WorkspaceActivity(
            workspaceId: workspaceId,
            actorDID: actorDID,
            action: action,
            resourceType: resourceType,
            resourceId: resourceId,
            metadata: metadata
        )

        let query = """
            INSERT INTO workspace_activities
            (id, workspace_id, actor_did, action, resource_type, resource_id, metadata, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """

        try db.run(
            query,
            activity.id,
            activity.workspaceId,
            activity.actorDID,
            activity.action.rawValue,
            activity.resourceType,
            activity.resourceId,
            metadataString,
            Int64(activity.timestamp.timeIntervalSince1970 * 1000)
        )
    }

    private func parseWorkspace(from row: Row) throws -> Workspace {
        let allowedRolesString = try? row.get(Expression<String?>("allowed_roles"))
        let allowedRoles = allowedRolesString
            .flatMap { $0?.data(using: .utf8) }
            .flatMap { try? JSONDecoder().decode([String].self, from: $0) }
            ?? []

        return Workspace(
            id: row[Expression<String>("id")],
            orgId: row[Expression<String>("org_id")],
            name: row[Expression<String>("name")],
            description: try row.get(Expression<String?>("description")) ?? "",
            type: WorkspaceType(rawValue: row[Expression<String>("type")]) ?? .default,
            color: row[Expression<String>("color")],
            icon: row[Expression<String>("icon")],
            isDefault: row[Expression<Int>("is_default")] == 1,
            visibility: WorkspaceVisibility(rawValue: row[Expression<String>("visibility")]) ?? .members,
            allowedRoles: allowedRoles,
            createdBy: row[Expression<String>("created_by")],
            createdAt: Date(timeIntervalSince1970: TimeInterval(row[Expression<Int64>("created_at")]) / 1000),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(row[Expression<Int64>("updated_at")]) / 1000),
            archived: row[Expression<Int>("archived")] == 1
        )
    }
}
