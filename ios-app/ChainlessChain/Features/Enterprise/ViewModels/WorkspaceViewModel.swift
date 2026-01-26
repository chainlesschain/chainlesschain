import Foundation
import Combine
import SwiftUI

/// 工作空间视图模型
@MainActor
public class WorkspaceViewModel: ObservableObject {

    // MARK: - Published Properties

    /// 当前组织的工作空间列表
    @Published public var workspaces: [Workspace] = []

    /// 当前选中的工作空间
    @Published public var currentWorkspace: Workspace?

    /// 当前工作空间的成员列表
    @Published public var members: [WorkspaceMember] = []

    /// 当前工作空间的资源列表
    @Published public var resources: [WorkspaceResource] = []

    /// 当前工作空间的活动日志
    @Published public var activities: [WorkspaceActivity] = []

    /// 加载状态
    @Published public var isLoading: Bool = false

    /// 错误信息
    @Published public var errorMessage: String?

    /// 成功消息
    @Published public var successMessage: String?

    // MARK: - Private Properties

    private let workspaceManager = WorkspaceManager.shared
    private let identityManager = IdentityManager.shared
    private var cancellables = Set<AnyCancellable>()
    private var currentOrgId: String?

    // MARK: - Initialization

    public init() {
        setupBindings()
    }

    private func setupBindings() {
        // 监听工作空间管理器的变化
        workspaceManager.$currentWorkspace
            .receive(on: DispatchQueue.main)
            .sink { [weak self] workspace in
                self?.currentWorkspace = workspace
                if let workspace = workspace {
                    Task {
                        await self?.loadWorkspaceDetails(workspaceId: workspace.id)
                    }
                }
            }
            .store(in: &cancellables)

        // 监听身份变更
        identityManager.identityChanged
            .receive(on: DispatchQueue.main)
            .sink { [weak self] identity in
                Task {
                    await self?.handleIdentityChanged(identity)
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - Workspace Management

    /// 加载组织的工作空间列表
    public func loadWorkspaces(orgId: String) async {
        isLoading = true
        errorMessage = nil
        currentOrgId = orgId

        do {
            workspaces = try await workspaceManager.getWorkspaces(orgId: orgId)
            print("[WorkspaceViewModel] ✅ Loaded \(workspaces.count) workspaces for org: \(orgId)")
        } catch {
            errorMessage = "加载工作空间失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to load workspaces: \(error)")
        }

        isLoading = false
    }

    /// 创建新工作空间
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
    ) async {
        isLoading = true
        errorMessage = nil

        do {
            let workspace = try await workspaceManager.createWorkspace(
                orgId: orgId,
                name: name,
                description: description,
                type: type,
                color: color,
                icon: icon,
                visibility: visibility,
                allowedRoles: allowedRoles,
                creatorDID: creatorDID
            )

            successMessage = "工作空间 \"\(name)\" 创建成功"
            currentWorkspace = workspace

            // 刷新工作空间列表
            await loadWorkspaces(orgId: orgId)

            print("[WorkspaceViewModel] ✅ Created workspace: \(name)")
        } catch {
            errorMessage = "创建工作空间失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to create workspace: \(error)")
        }

        isLoading = false
    }

    /// 更新工作空间信息
    public func updateWorkspace(
        workspaceId: String,
        name: String? = nil,
        description: String? = nil,
        color: String? = nil,
        icon: String? = nil,
        visibility: WorkspaceVisibility? = nil,
        allowedRoles: [String]? = nil
    ) async {
        isLoading = true
        errorMessage = nil

        do {
            try await workspaceManager.updateWorkspace(
                workspaceId: workspaceId,
                name: name,
                description: description,
                color: color,
                icon: icon,
                visibility: visibility,
                allowedRoles: allowedRoles
            )

            successMessage = "工作空间信息已更新"

            // 刷新工作空间列表
            if let orgId = currentOrgId {
                await loadWorkspaces(orgId: orgId)
            }

            print("[WorkspaceViewModel] ✅ Updated workspace: \(workspaceId)")
        } catch {
            errorMessage = "更新工作空间失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to update workspace: \(error)")
        }

        isLoading = false
    }

    /// 删除工作空间
    public func deleteWorkspace(workspaceId: String, userDID: String) async {
        isLoading = true
        errorMessage = nil

        do {
            try await workspaceManager.deleteWorkspace(workspaceId: workspaceId, userDID: userDID)

            successMessage = "工作空间已删除"

            // 如果删除的是当前工作空间，清除当前工作空间
            if currentWorkspace?.id == workspaceId {
                currentWorkspace = nil
            }

            // 刷新工作空间列表
            if let orgId = currentOrgId {
                await loadWorkspaces(orgId: orgId)
            }

            print("[WorkspaceViewModel] ✅ Deleted workspace: \(workspaceId)")
        } catch {
            errorMessage = "删除工作空间失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to delete workspace: \(error)")
        }

        isLoading = false
    }

    /// 归档工作空间
    public func archiveWorkspace(workspaceId: String, userDID: String) async {
        isLoading = true
        errorMessage = nil

        do {
            try await workspaceManager.archiveWorkspace(workspaceId: workspaceId, userDID: userDID)

            successMessage = "工作空间已归档"

            // 刷新工作空间列表
            if let orgId = currentOrgId {
                await loadWorkspaces(orgId: orgId)
            }

            print("[WorkspaceViewModel] ✅ Archived workspace: \(workspaceId)")
        } catch {
            errorMessage = "归档工作空间失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to archive workspace: \(error)")
        }

        isLoading = false
    }

    /// 取消归档工作空间
    public func unarchiveWorkspace(workspaceId: String, userDID: String) async {
        isLoading = true
        errorMessage = nil

        do {
            try await workspaceManager.unarchiveWorkspace(workspaceId: workspaceId, userDID: userDID)

            successMessage = "工作空间已取消归档"

            // 刷新工作空间列表
            if let orgId = currentOrgId {
                await loadWorkspaces(orgId: orgId)
            }

            print("[WorkspaceViewModel] ✅ Unarchived workspace: \(workspaceId)")
        } catch {
            errorMessage = "取消归档工作空间失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to unarchive workspace: \(error)")
        }

        isLoading = false
    }

    /// 切换当前工作空间
    public func switchWorkspace(to workspace: Workspace) async {
        currentWorkspace = workspace
        await loadWorkspaceDetails(workspaceId: workspace.id)
    }

    // MARK: - Member Management

    /// 加载工作空间详情
    private func loadWorkspaceDetails(workspaceId: String) async {
        do {
            // 加载成员
            members = try await workspaceManager.getWorkspaceMembers(workspaceId: workspaceId)

            // 加载资源
            resources = try await workspaceManager.getWorkspaceResources(workspaceId: workspaceId)

            // 加载活动日志
            activities = try await workspaceManager.getWorkspaceActivities(workspaceId: workspaceId, limit: 50)

            print("[WorkspaceViewModel] ✅ Loaded details for workspace: \(workspaceId)")
        } catch {
            errorMessage = "加载工作空间详情失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to load workspace details: \(error)")
        }
    }

    /// 添加工作空间成员
    public func addMember(
        workspaceId: String,
        memberDID: String,
        displayName: String,
        role: WorkspaceMemberRole
    ) async {
        isLoading = true
        errorMessage = nil

        do {
            try await workspaceManager.addWorkspaceMember(
                workspaceId: workspaceId,
                memberDID: memberDID,
                displayName: displayName,
                role: role
            )

            successMessage = "成员 \"\(displayName)\" 已添加到工作空间"

            // 刷新成员列表
            members = try await workspaceManager.getWorkspaceMembers(workspaceId: workspaceId)

            print("[WorkspaceViewModel] ✅ Added member to workspace: \(displayName)")
        } catch {
            errorMessage = "添加成员失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to add member: \(error)")
        }

        isLoading = false
    }

    /// 移除工作空间成员
    public func removeMember(workspaceId: String, memberDID: String) async {
        isLoading = true
        errorMessage = nil

        do {
            try await workspaceManager.removeWorkspaceMember(
                workspaceId: workspaceId,
                memberDID: memberDID
            )

            successMessage = "成员已从工作空间移除"

            // 刷新成员列表
            members = try await workspaceManager.getWorkspaceMembers(workspaceId: workspaceId)

            print("[WorkspaceViewModel] ✅ Removed member from workspace: \(memberDID)")
        } catch {
            errorMessage = "移除成员失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to remove member: \(error)")
        }

        isLoading = false
    }

    /// 更新成员角色
    public func updateMemberRole(
        workspaceId: String,
        memberDID: String,
        newRole: WorkspaceMemberRole
    ) async {
        isLoading = true
        errorMessage = nil

        do {
            try await workspaceManager.updateWorkspaceMemberRole(
                workspaceId: workspaceId,
                memberDID: memberDID,
                newRole: newRole
            )

            successMessage = "成员角色已更新"

            // 刷新成员列表
            members = try await workspaceManager.getWorkspaceMembers(workspaceId: workspaceId)

            print("[WorkspaceViewModel] ✅ Updated member role in workspace: \(memberDID) -> \(newRole.rawValue)")
        } catch {
            errorMessage = "更新成员角色失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to update member role: \(error)")
        }

        isLoading = false
    }

    // MARK: - Resource Management

    /// 添加资源到工作空间
    public func addResource(
        workspaceId: String,
        resourceType: ResourceType,
        resourceId: String,
        resourceName: String,
        userDID: String
    ) async {
        isLoading = true
        errorMessage = nil

        do {
            try await workspaceManager.addResource(
                workspaceId: workspaceId,
                resourceType: resourceType,
                resourceId: resourceId,
                resourceName: resourceName,
                userDID: userDID
            )

            successMessage = "\(resourceType.displayName) \"\(resourceName)\" 已添加到工作空间"

            // 刷新资源列表
            resources = try await workspaceManager.getWorkspaceResources(workspaceId: workspaceId)

            print("[WorkspaceViewModel] ✅ Added resource to workspace: \(resourceName)")
        } catch {
            errorMessage = "添加资源失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to add resource: \(error)")
        }

        isLoading = false
    }

    /// 从工作空间移除资源
    public func removeResource(workspaceId: String, resourceId: String, userDID: String) async {
        isLoading = true
        errorMessage = nil

        do {
            try await workspaceManager.removeResource(
                workspaceId: workspaceId,
                resourceId: resourceId,
                userDID: userDID
            )

            successMessage = "资源已从工作空间移除"

            // 刷新资源列表
            resources = try await workspaceManager.getWorkspaceResources(workspaceId: workspaceId)

            print("[WorkspaceViewModel] ✅ Removed resource from workspace: \(resourceId)")
        } catch {
            errorMessage = "移除资源失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to remove resource: \(error)")
        }

        isLoading = false
    }

    /// 按类型过滤资源
    public func filterResources(by type: ResourceType) -> [WorkspaceResource] {
        return resources.filter { $0.resourceType == type }
    }

    // MARK: - Activity Logs

    /// 加载活动日志
    public func loadActivities(workspaceId: String, limit: Int = 50) async {
        do {
            activities = try await workspaceManager.getWorkspaceActivities(
                workspaceId: workspaceId,
                limit: limit
            )
            print("[WorkspaceViewModel] ✅ Loaded \(activities.count) activities")
        } catch {
            errorMessage = "加载活动日志失败: \(error.localizedDescription)"
            print("[WorkspaceViewModel] ❌ Failed to load activities: \(error)")
        }
    }

    // MARK: - Permission Helpers

    /// 检查用户是否有访问权限
    public func canAccess(workspaceId: String, userDID: String) async -> Bool {
        do {
            return try await workspaceManager.canAccessWorkspace(
                workspaceId: workspaceId,
                userDID: userDID
            )
        } catch {
            return false
        }
    }

    /// 检查用户是否可以管理工作空间
    public func canManage(workspaceId: String, userDID: String) async -> Bool {
        // 检查是否为owner或admin
        guard let member = members.first(where: { $0.memberDID == userDID }) else {
            return false
        }

        return member.role == .owner || member.role == .admin
    }

    // MARK: - Identity Integration

    /// 处理身份变更
    private func handleIdentityChanged(_ identity: Identity) async {
        // 如果切换到组织身份，加载该组织的工作空间
        if let orgId = identity.orgId {
            await loadWorkspaces(orgId: orgId)

            // 如果有默认工作空间，自动切换到默认工作空间
            if let defaultWorkspace = workspaces.first(where: { $0.isDefault }) {
                await switchWorkspace(to: defaultWorkspace)
            }
        } else {
            // 切换到个人身份，清空工作空间
            workspaces = []
            currentWorkspace = nil
        }
    }

    // MARK: - Utility Methods

    /// 清除错误和成功消息
    public func clearMessages() {
        errorMessage = nil
        successMessage = nil
    }

    /// 搜索工作空间
    public func searchWorkspaces(query: String) -> [Workspace] {
        if query.isEmpty {
            return workspaces
        }

        return workspaces.filter { workspace in
            workspace.name.localizedCaseInsensitiveContains(query) ||
            workspace.description.localizedCaseInsensitiveContains(query)
        }
    }

    /// 按类型过滤工作空间
    public func filterWorkspaces(by type: WorkspaceType) -> [Workspace] {
        return workspaces.filter { $0.type == type }
    }

    /// 获取活跃的工作空间（未归档）
    public func getActiveWorkspaces() -> [Workspace] {
        return workspaces.filter { !$0.archived }
    }

    /// 获取归档的工作空间
    public func getArchivedWorkspaces() -> [Workspace] {
        return workspaces.filter { $0.archived }
    }

    /// 获取默认工作空间
    public func getDefaultWorkspace() -> Workspace? {
        return workspaces.first(where: { $0.isDefault })
    }

    /// 获取成员数量
    public func getMemberCount(for workspaceId: String) async -> Int {
        do {
            let members = try await workspaceManager.getWorkspaceMembers(workspaceId: workspaceId)
            return members.count
        } catch {
            return 0
        }
    }

    /// 获取资源数量
    public func getResourceCount(for workspaceId: String) async -> Int {
        do {
            let resources = try await workspaceManager.getWorkspaceResources(workspaceId: workspaceId)
            return resources.count
        } catch {
            return 0
        }
    }

    /// 按类型获取资源数量
    public func getResourceCount(for workspaceId: String, type: ResourceType) async -> Int {
        do {
            let resources = try await workspaceManager.getWorkspaceResources(workspaceId: workspaceId)
            return resources.filter { $0.resourceType == type }.count
        } catch {
            return 0
        }
    }
}
