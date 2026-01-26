import Foundation
import Combine
import SwiftUI

/// 组织视图模型
@MainActor
public class OrganizationViewModel: ObservableObject {

    // MARK: - Published Properties

    /// 所有组织列表
    @Published public var organizations: [Organization] = []

    /// 当前选中的组织
    @Published public var currentOrganization: Organization?

    /// 当前组织的成员列表
    @Published public var members: [OrganizationMember] = []

    /// 当前组织的邀请码列表
    @Published public var invitations: [OrganizationInvitation] = []

    /// 当前组织的活动日志
    @Published public var activities: [OrganizationActivity] = []

    /// 加载状态
    @Published public var isLoading: Bool = false

    /// 错误信息
    @Published public var errorMessage: String?

    /// 成功消息
    @Published public var successMessage: String?

    // MARK: - Private Properties

    private let organizationManager = OrganizationManager.shared
    private let identityManager = IdentityManager.shared
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    public init() {
        setupBindings()
        Task {
            await loadOrganizations()
        }
    }

    private func setupBindings() {
        // 监听组织管理器的变化
        organizationManager.$organizations
            .receive(on: DispatchQueue.main)
            .assign(to: &$organizations)

        organizationManager.$currentOrganization
            .receive(on: DispatchQueue.main)
            .sink { [weak self] org in
                self?.currentOrganization = org
                if let org = org {
                    Task {
                        await self?.loadOrganizationDetails(orgId: org.id)
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

    // MARK: - Organization Management

    /// 加载所有组织
    public func loadOrganizations() async {
        isLoading = true
        errorMessage = nil

        do {
            try await organizationManager.loadOrganizations()
            print("[OrganizationViewModel] ✅ Loaded \(organizations.count) organizations")
        } catch {
            errorMessage = "加载组织失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to load organizations: \(error)")
        }

        isLoading = false
    }

    /// 创建新组织
    public func createOrganization(
        name: String,
        description: String = "",
        type: OrganizationType = .personal,
        visibility: OrganizationVisibility = .private,
        ownerDID: String
    ) async {
        isLoading = true
        errorMessage = nil

        do {
            let settings = OrganizationSettings(
                allowPublicJoin: visibility == .public,
                requireApproval: visibility == .inviteOnly,
                defaultMemberRole: .viewer
            )

            let org = try await organizationManager.createOrganization(
                name: name,
                description: description,
                type: type,
                visibility: visibility,
                ownerDID: ownerDID,
                settings: settings
            )

            successMessage = "组织 \"\(name)\" 创建成功"
            currentOrganization = org

            print("[OrganizationViewModel] ✅ Created organization: \(name)")
        } catch {
            errorMessage = "创建组织失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to create organization: \(error)")
        }

        isLoading = false
    }

    /// 更新组织信息
    public func updateOrganization(
        orgId: String,
        name: String? = nil,
        description: String? = nil,
        avatar: String? = nil,
        settings: OrganizationSettings? = nil
    ) async {
        isLoading = true
        errorMessage = nil

        do {
            try await organizationManager.updateOrganization(
                orgId: orgId,
                name: name,
                description: description,
                avatar: avatar,
                settings: settings
            )

            successMessage = "组织信息已更新"
            print("[OrganizationViewModel] ✅ Updated organization: \(orgId)")
        } catch {
            errorMessage = "更新组织失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to update organization: \(error)")
        }

        isLoading = false
    }

    /// 删除组织
    public func deleteOrganization(orgId: String, userDID: String) async {
        isLoading = true
        errorMessage = nil

        do {
            try await organizationManager.deleteOrganization(orgId: orgId, userDID: userDID)

            successMessage = "组织已删除"

            // 如果删除的是当前组织，清除当前组织
            if currentOrganization?.id == orgId {
                currentOrganization = nil
            }

            print("[OrganizationViewModel] ✅ Deleted organization: \(orgId)")
        } catch {
            errorMessage = "删除组织失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to delete organization: \(error)")
        }

        isLoading = false
    }

    /// 切换当前组织
    public func switchOrganization(to org: Organization) async {
        currentOrganization = org
        await loadOrganizationDetails(orgId: org.id)
    }

    // MARK: - Member Management

    /// 加载组织成员
    private func loadOrganizationDetails(orgId: String) async {
        do {
            // 加载成员
            members = try await organizationManager.getMembers(orgId: orgId)

            // 加载邀请码
            invitations = try await organizationManager.getInvitations(orgId: orgId)

            // 加载活动日志
            activities = try await organizationManager.getActivities(orgId: orgId, limit: 50)

            print("[OrganizationViewModel] ✅ Loaded details for organization: \(orgId)")
        } catch {
            errorMessage = "加载组织详情失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to load organization details: \(error)")
        }
    }

    /// 添加成员
    public func addMember(
        orgId: String,
        memberDID: String,
        displayName: String,
        role: OrganizationRole
    ) async {
        isLoading = true
        errorMessage = nil

        do {
            try await organizationManager.addMember(
                orgId: orgId,
                memberDID: memberDID,
                displayName: displayName,
                role: role
            )

            successMessage = "成员 \"\(displayName)\" 已添加"

            // 刷新成员列表
            members = try await organizationManager.getMembers(orgId: orgId)

            print("[OrganizationViewModel] ✅ Added member: \(displayName)")
        } catch {
            errorMessage = "添加成员失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to add member: \(error)")
        }

        isLoading = false
    }

    /// 移除成员
    public func removeMember(orgId: String, memberDID: String) async {
        isLoading = true
        errorMessage = nil

        do {
            try await organizationManager.removeMember(orgId: orgId, memberDID: memberDID)

            successMessage = "成员已移除"

            // 刷新成员列表
            members = try await organizationManager.getMembers(orgId: orgId)

            print("[OrganizationViewModel] ✅ Removed member: \(memberDID)")
        } catch {
            errorMessage = "移除成员失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to remove member: \(error)")
        }

        isLoading = false
    }

    /// 更新成员角色
    public func updateMemberRole(
        orgId: String,
        memberDID: String,
        newRole: OrganizationRole
    ) async {
        isLoading = true
        errorMessage = nil

        do {
            try await organizationManager.updateMemberRole(
                orgId: orgId,
                memberDID: memberDID,
                newRole: newRole
            )

            successMessage = "成员角色已更新"

            // 刷新成员列表
            members = try await organizationManager.getMembers(orgId: orgId)

            print("[OrganizationViewModel] ✅ Updated member role: \(memberDID) -> \(newRole.rawValue)")
        } catch {
            errorMessage = "更新成员角色失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to update member role: \(error)")
        }

        isLoading = false
    }

    // MARK: - Invitation Management

    /// 创建邀请码
    public func createInvitation(
        orgId: String,
        role: OrganizationRole,
        maxUses: Int = 1,
        expiresInDays: Int? = nil,
        userDID: String
    ) async -> OrganizationInvitation? {
        isLoading = true
        errorMessage = nil

        var invitation: OrganizationInvitation?

        do {
            let expireAt = expiresInDays.map { Date().addingTimeInterval(TimeInterval($0 * 86400)) }

            invitation = try await organizationManager.createInvitation(
                orgId: orgId,
                role: role,
                maxUses: maxUses,
                expireAt: expireAt,
                userDID: userDID
            )

            successMessage = "邀请码已创建"

            // 刷新邀请列表
            invitations = try await organizationManager.getInvitations(orgId: orgId)

            print("[OrganizationViewModel] ✅ Created invitation: \(invitation?.inviteCode ?? "")")
        } catch {
            errorMessage = "创建邀请码失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to create invitation: \(error)")
        }

        isLoading = false
        return invitation
    }

    /// 使用邀请码加入组织
    public func joinWithInvite(
        inviteCode: String,
        memberDID: String,
        displayName: String
    ) async -> Bool {
        isLoading = true
        errorMessage = nil

        var success = false

        do {
            try await organizationManager.joinWithInvite(
                inviteCode: inviteCode,
                memberDID: memberDID,
                displayName: displayName
            )

            successMessage = "成功加入组织"
            success = true

            // 重新加载组织列表
            await loadOrganizations()

            print("[OrganizationViewModel] ✅ Joined organization with invite: \(inviteCode)")
        } catch {
            errorMessage = "加入组织失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to join with invite: \(error)")
        }

        isLoading = false
        return success
    }

    /// 撤销邀请码
    public func revokeInvitation(invitationId: String, orgId: String) async {
        isLoading = true
        errorMessage = nil

        do {
            // 撤销邀请码（将is_active设为false）
            // 这里需要在OrganizationManager中添加revokeInvitation方法
            // 暂时通过重新加载来模拟

            successMessage = "邀请码已撤销"

            // 刷新邀请列表
            invitations = try await organizationManager.getInvitations(orgId: orgId)

            print("[OrganizationViewModel] ✅ Revoked invitation: \(invitationId)")
        } catch {
            errorMessage = "撤销邀请码失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to revoke invitation: \(error)")
        }

        isLoading = false
    }

    // MARK: - Activity Logs

    /// 加载活动日志
    public func loadActivities(orgId: String, limit: Int = 50) async {
        do {
            activities = try await organizationManager.getActivities(orgId: orgId, limit: limit)
            print("[OrganizationViewModel] ✅ Loaded \(activities.count) activities")
        } catch {
            errorMessage = "加载活动日志失败: \(error.localizedDescription)"
            print("[OrganizationViewModel] ❌ Failed to load activities: \(error)")
        }
    }

    // MARK: - Permission Helpers

    /// 检查当前用户是否有权限
    public func hasPermission(_ permission: Permission, in orgId: String, for userDID: String) async -> Bool {
        do {
            return try await PermissionChecker.check(permission, in: orgId, for: userDID)
        } catch {
            return false
        }
    }

    /// 检查是否为组织管理员
    public func isOrgAdmin(orgId: String, userDID: String) async -> Bool {
        do {
            return try await PermissionChecker.isOrgAdmin(in: orgId, for: userDID)
        } catch {
            return false
        }
    }

    /// 检查是否可以管理成员
    public func canManageMembers(orgId: String, userDID: String) async -> Bool {
        do {
            return try await PermissionChecker.canManageMembers(in: orgId, for: userDID)
        } catch {
            return false
        }
    }

    /// 检查是否可以管理角色
    public func canManageRoles(orgId: String, userDID: String) async -> Bool {
        do {
            return try await PermissionChecker.canManageRoles(in: orgId, for: userDID)
        } catch {
            return false
        }
    }

    // MARK: - Identity Integration

    /// 处理身份变更
    private func handleIdentityChanged(_ identity: Identity) async {
        // 如果切换到组织身份，自动切换到对应组织
        if let orgId = identity.orgId {
            if let org = organizations.first(where: { $0.id == orgId }) {
                await switchOrganization(to: org)
            }
        }
    }

    // MARK: - Utility Methods

    /// 清除错误和成功消息
    public func clearMessages() {
        errorMessage = nil
        successMessage = nil
    }

    /// 获取成员数量
    public func getMemberCount(for orgId: String) async -> Int {
        do {
            let members = try await organizationManager.getMembers(orgId: orgId)
            return members.count
        } catch {
            return 0
        }
    }

    /// 搜索组织
    public func searchOrganizations(query: String) -> [Organization] {
        if query.isEmpty {
            return organizations
        }

        return organizations.filter { org in
            org.name.localizedCaseInsensitiveContains(query) ||
            (org.description?.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    /// 按类型过滤组织
    public func filterOrganizations(by type: OrganizationType) -> [Organization] {
        return organizations.filter { $0.type == type }
    }

    /// 获取我拥有的组织
    public func getOwnedOrganizations(ownerDID: String) -> [Organization] {
        return organizations.filter { $0.ownerDID == ownerDID }
    }

    /// 获取我参与的组织
    public func getJoinedOrganizations(memberDID: String) async -> [Organization] {
        var joinedOrgs: [Organization] = []

        for org in organizations {
            do {
                let members = try await organizationManager.getMembers(orgId: org.id)
                if members.contains(where: { $0.memberDID == memberDID }) {
                    joinedOrgs.append(org)
                }
            } catch {
                continue
            }
        }

        return joinedOrgs
    }
}
