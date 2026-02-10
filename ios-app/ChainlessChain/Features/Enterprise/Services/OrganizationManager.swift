import Foundation
import Combine
import SQLite

/// 组织管理服务
@MainActor
public class OrganizationManager: ObservableObject {
    public static let shared = OrganizationManager()

    // MARK: - Published Properties

    @Published public var organizations: [Organization] = []
    @Published public var currentOrganization: Organization?
    @Published public var members: [String: [OrganizationMember]] = [:]  // orgId -> members

    // MARK: - Private Properties

    private var db: Connection?
    private let rbacManager = RBACManager.shared
    private let organizationChanged = PassthroughSubject<Organization, Never>()
    private let memberChanged = PassthroughSubject<(String, OrganizationMember), Never>()

    // MARK: - Initialization

    private init() {}

    public func initialize(db: Connection) throws {
        self.db = db
        try loadOrganizations()
    }

    // MARK: - Organization CRUD

    /// 创建组织
    public func createOrganization(
        name: String,
        description: String = "",
        type: OrganizationType = .startup,
        ownerDID: String,
        settings: OrganizationSettings = OrganizationSettings()
    ) async throws -> Organization {
        guard let db = db else {
            throw OrganizationError.organizationNotFound
        }

        // 检查名称是否存在
        let query = EnterpriseDB.organizationInfo.filter(EnterpriseDB.orgName == name)
        if try db.pluck(query) != nil {
            throw OrganizationError.duplicateName
        }

        // 生成DID
        let did = "did:org:\(UUID().uuidString)"

        // 创建组织
        let org = Organization(
            did: did,
            name: name,
            description: description,
            type: type,
            ownerDID: ownerDID,
            settings: settings
        )

        // 保存到数据库
        try await saveOrganization(org)

        // 初始化内置角色
        try await rbacManager.initializeBuiltinRoles(orgId: org.id)

        // 添加创建者为Owner
        try await addMember(
            orgId: org.id,
            memberDID: ownerDID,
            displayName: "Owner",
            role: .owner
        )

        // 记录活动
        try await logActivity(
            orgId: org.id,
            actorDID: ownerDID,
            action: .createOrganization,
            resourceType: "organization",
            resourceId: org.id
        )

        organizations.append(org)
        organizationChanged.send(org)

        return org
    }

    /// 获取组织
    public func getOrganization(orgId: String) async throws -> Organization? {
        guard let db = db else {
            return nil
        }

        let query = EnterpriseDB.organizationInfo.filter(EnterpriseDB.orgId == orgId)
        guard let row = try db.pluck(query) else {
            return nil
        }

        return try parseOrganization(from: row)
    }

    /// 更新组织
    public func updateOrganization(
        orgId: String,
        name: String? = nil,
        description: String? = nil,
        type: OrganizationType? = nil,
        settings: OrganizationSettings? = nil,
        userDID: String
    ) async throws {
        guard let db = db else {
            throw OrganizationError.organizationNotFound
        }

        // 检查权限
        let hasPermission = try await rbacManager.checkPermission(
            orgId: orgId,
            userDID: userDID,
            permission: .orgManage
        )
        guard hasPermission else {
            throw OrganizationError.insufficientPermissions
        }

        // 获取现有组织
        guard var org = try await getOrganization(orgId: orgId) else {
            throw OrganizationError.organizationNotFound
        }

        // 更新字段
        if let name = name {
            org.name = name
        }
        if let description = description {
            org.description = description
        }
        if let type = type {
            org.type = type
        }
        if let settings = settings {
            org.settings = settings
        }
        org.updatedAt = Date()

        // 保存到数据库
        try await saveOrganization(org)

        // 更新内存中的组织
        if let index = organizations.firstIndex(where: { $0.id == orgId }) {
            organizations[index] = org
        }

        // 记录活动
        try await logActivity(
            orgId: orgId,
            actorDID: userDID,
            action: .updateOrganization,
            resourceType: "organization",
            resourceId: orgId
        )

        organizationChanged.send(org)
    }

    /// 删除组织
    public func deleteOrganization(
        orgId: String,
        userDID: String
    ) async throws {
        guard let db = db else {
            throw OrganizationError.organizationNotFound
        }

        // 检查权限（必须是Owner）
        guard let member = try await getMember(orgId: orgId, memberDID: userDID),
              member.role == .owner else {
            throw OrganizationError.insufficientPermissions
        }

        // 删除组织相关数据
        let orgTable = EnterpriseDB.organizationInfo.filter(EnterpriseDB.orgId == orgId)
        try db.run(orgTable.delete())

        // 删除成员
        let membersTable = EnterpriseDB.organizationMembers.filter(EnterpriseDB.memberOrgId == orgId)
        try db.run(membersTable.delete())

        // 删除角色
        let rolesTable = EnterpriseDB.organizationRoles.filter(EnterpriseDB.roleOrgId == orgId)
        try db.run(rolesTable.delete())

        // 从内存中移除
        organizations.removeAll { $0.id == orgId }
        members.removeValue(forKey: orgId)
    }

    // MARK: - Member Management

    /// 添加成员
    public func addMember(
        orgId: String,
        memberDID: String,
        displayName: String,
        avatar: String? = nil,
        role: OrganizationRole = .viewer
    ) async throws {
        guard let db = db else {
            throw OrganizationError.memberNotFound
        }

        // 检查是否已经是成员
        let existingQuery = EnterpriseDB.organizationMembers.filter(
            EnterpriseDB.memberOrgId == orgId &&
            EnterpriseDB.memberDid == memberDID
        )
        if try db.pluck(existingQuery) != nil {
            throw OrganizationError.alreadyMember
        }

        // 创建成员
        let member = OrganizationMember(
            orgId: orgId,
            memberDID: memberDID,
            displayName: displayName,
            avatar: avatar,
            role: role
        )

        // 保存到数据库
        try await saveMember(member)

        // 更新内存
        if members[orgId] == nil {
            members[orgId] = []
        }
        members[orgId]?.append(member)

        memberChanged.send((orgId, member))
    }

    /// 获取成员
    public func getMember(
        orgId: String,
        memberDID: String
    ) async throws -> OrganizationMember? {
        guard let db = db else {
            return nil
        }

        let query = EnterpriseDB.organizationMembers.filter(
            EnterpriseDB.memberOrgId == orgId &&
            EnterpriseDB.memberDid == memberDID
        )

        guard let row = try db.pluck(query) else {
            return nil
        }

        return try parseMember(from: row)
    }

    /// 更新成员角色
    public func updateMemberRole(
        orgId: String,
        memberDID: String,
        newRole: OrganizationRole,
        userDID: String
    ) async throws {
        guard let db = db else {
            throw OrganizationError.memberNotFound
        }

        // 检查权限
        let hasPermission = try await rbacManager.checkPermission(
            orgId: orgId,
            userDID: userDID,
            permission: .roleAssign
        )
        guard hasPermission else {
            throw OrganizationError.insufficientPermissions
        }

        // 不能修改Owner的角色
        guard let member = try await getMember(orgId: orgId, memberDID: memberDID),
              member.role != .owner else {
            throw OrganizationError.cannotRemoveOwner
        }

        // 更新数据库
        let memberTable = EnterpriseDB.organizationMembers.filter(
            EnterpriseDB.memberOrgId == orgId &&
            EnterpriseDB.memberDid == memberDID
        )
        try db.run(memberTable.update(EnterpriseDB.memberRole <- newRole.rawValue))

        // 更新内存
        if let orgMembers = members[orgId],
           let index = orgMembers.firstIndex(where: { $0.memberDID == memberDID }) {
            members[orgId]?[index].role = newRole
        }

        // 记录活动
        try await logActivity(
            orgId: orgId,
            actorDID: userDID,
            action: .updateMemberRole,
            resourceType: "member",
            resourceId: memberDID,
            metadata: ["new_role": newRole.rawValue]
        )
    }

    /// 移除成员
    public func removeMember(
        orgId: String,
        memberDID: String,
        userDID: String
    ) async throws {
        guard let db = db else {
            throw OrganizationError.memberNotFound
        }

        // 检查权限
        let hasPermission = try await rbacManager.checkPermission(
            orgId: orgId,
            userDID: userDID,
            permission: .memberRemove
        )
        guard hasPermission else {
            throw OrganizationError.insufficientPermissions
        }

        // 不能移除Owner
        guard let member = try await getMember(orgId: orgId, memberDID: memberDID),
              member.role != .owner else {
            throw OrganizationError.cannotRemoveOwner
        }

        // 从数据库删除
        let memberTable = EnterpriseDB.organizationMembers.filter(
            EnterpriseDB.memberOrgId == orgId &&
            EnterpriseDB.memberDid == memberDID
        )
        try db.run(memberTable.delete())

        // 从内存移除
        if let orgMembers = members[orgId] {
            members[orgId] = orgMembers.filter { $0.memberDID != memberDID }
        }

        // 记录活动
        try await logActivity(
            orgId: orgId,
            actorDID: userDID,
            action: .removeMember,
            resourceType: "member",
            resourceId: memberDID
        )
    }

    /// 获取组织成员列表
    public func getMembers(orgId: String) async throws -> [OrganizationMember] {
        guard let db = db else {
            return []
        }

        let query = EnterpriseDB.organizationMembers.filter(EnterpriseDB.memberOrgId == orgId)
        var result: [OrganizationMember] = []

        for row in try db.prepare(query) {
            if let member = try? parseMember(from: row) {
                result.append(member)
            }
        }

        return result
    }

    // MARK: - Invitation Management

    /// 创建邀请码
    public func createInvitation(
        orgId: String,
        role: OrganizationRole = .viewer,
        maxUses: Int = 10,
        expireAt: Date? = nil,
        userDID: String
    ) async throws -> OrganizationInvitation {
        guard let db = db else {
            throw OrganizationError.invitationNotFound
        }

        // 检查权限
        let hasPermission = try await rbacManager.checkPermission(
            orgId: orgId,
            userDID: userDID,
            permission: .memberInvite
        )
        guard hasPermission else {
            throw OrganizationError.insufficientPermissions
        }

        // 生成邀请码
        let inviteCode = generateInviteCode()

        let invitation = OrganizationInvitation(
            orgId: orgId,
            inviteCode: inviteCode,
            invitedBy: userDID,
            role: role,
            maxUses: maxUses,
            expireAt: expireAt
        )

        // 保存到数据库
        try await saveInvitation(invitation)

        return invitation
    }

    /// 使用邀请码加入组织
    public func joinWithInvite(
        inviteCode: String,
        memberDID: String,
        displayName: String
    ) async throws {
        guard let db = db else {
            throw OrganizationError.invitationNotFound
        }

        // 查找邀请
        let query = EnterpriseDB.organizationInvitations.filter(
            EnterpriseDB.inviteCode == inviteCode
        )
        guard let row = try db.pluck(query) else {
            throw OrganizationError.invitationNotFound
        }

        let orgId = row[EnterpriseDB.inviteOrgId]
        let role = OrganizationRole(rawValue: row[EnterpriseDB.inviteRole]) ?? .viewer
        let maxUses = row[EnterpriseDB.inviteMaxUses]
        let usedCount = row[EnterpriseDB.inviteUsedCount]
        let isActive = row[EnterpriseDB.inviteIsActive]

        // 检查邀请是否有效
        guard isActive && usedCount < maxUses else {
            throw OrganizationError.invitationExhausted
        }

        // 检查是否过期
        if let expireTimestamp = try? row.get(EnterpriseDB.inviteExpireAt) {
            let expireDate = Date(timeIntervalSince1970: TimeInterval(expireTimestamp) / 1000)
            if Date() > expireDate {
                throw OrganizationError.invitationExpired
            }
        }

        // 添加成员
        try await addMember(
            orgId: orgId,
            memberDID: memberDID,
            displayName: displayName,
            role: role
        )

        // 更新邀请使用次数
        let updateQuery = EnterpriseDB.organizationInvitations.filter(
            EnterpriseDB.inviteCode == inviteCode
        )
        try db.run(updateQuery.update(EnterpriseDB.inviteUsedCount <- usedCount + 1))
    }

    // MARK: - Private Helper Methods

    private func loadOrganizations() throws {
        guard let db = db else { return }

        let query = EnterpriseDB.organizationInfo
        var result: [Organization] = []

        for row in try db.prepare(query) {
            if let org = try? parseOrganization(from: row) {
                result.append(org)
            }
        }

        organizations = result
    }

    private func saveOrganization(_ org: Organization) async throws {
        guard let db = db else { return }

        let settingsJson = try? JSONEncoder().encode(org.settings)
        let settingsString = settingsJson.flatMap { String(data: $0, encoding: .utf8) }

        let insert = EnterpriseDB.organizationInfo.insert(
            EnterpriseDB.orgId <- org.id,
            EnterpriseDB.orgDid <- org.did,
            EnterpriseDB.orgName <- org.name,
            EnterpriseDB.orgDescription <- org.description,
            EnterpriseDB.orgType <- org.type.rawValue,
            EnterpriseDB.orgAvatar <- org.avatar,
            EnterpriseDB.orgOwnerDid <- org.ownerDID,
            EnterpriseDB.orgSettingsJson <- settingsString,
            EnterpriseDB.orgCreatedAt <- Int64(org.createdAt.timeIntervalSince1970 * 1000),
            EnterpriseDB.orgUpdatedAt <- Int64(org.updatedAt.timeIntervalSince1970 * 1000)
        )

        try db.run(insert.onConflict(.replace))
    }

    private func saveMember(_ member: OrganizationMember) async throws {
        guard let db = db else { return }

        let permissionsJson = try? JSONEncoder().encode(member.permissions)
        let permissionsString = permissionsJson.flatMap { String(data: $0, encoding: .utf8) }

        let insert = EnterpriseDB.organizationMembers.insert(
            EnterpriseDB.memberId <- member.id,
            EnterpriseDB.memberOrgId <- member.orgId,
            EnterpriseDB.memberDid <- member.memberDID,
            EnterpriseDB.memberDisplayName <- member.displayName,
            EnterpriseDB.memberAvatar <- member.avatar,
            EnterpriseDB.memberRole <- member.role.rawValue,
            EnterpriseDB.memberCustomRoleId <- member.customRoleId,
            EnterpriseDB.memberStatus <- member.status.rawValue,
            EnterpriseDB.memberPermissionsJson <- permissionsString,
            EnterpriseDB.memberJoinedAt <- Int64(member.joinedAt.timeIntervalSince1970 * 1000),
            EnterpriseDB.memberLastActiveAt <- member.lastActiveAt.map { Int64($0.timeIntervalSince1970 * 1000) }
        )

        try db.run(insert.onConflict(.replace))
    }

    private func saveInvitation(_ invitation: OrganizationInvitation) async throws {
        guard let db = db else { return }

        let insert = EnterpriseDB.organizationInvitations.insert(
            EnterpriseDB.inviteId <- invitation.id,
            EnterpriseDB.inviteOrgId <- invitation.orgId,
            EnterpriseDB.inviteCode <- invitation.inviteCode,
            EnterpriseDB.inviteInvitedBy <- invitation.invitedBy,
            EnterpriseDB.inviteRole <- invitation.role.rawValue,
            EnterpriseDB.inviteMaxUses <- invitation.maxUses,
            EnterpriseDB.inviteUsedCount <- invitation.usedCount,
            EnterpriseDB.inviteCreatedAt <- Int64(invitation.createdAt.timeIntervalSince1970 * 1000),
            EnterpriseDB.inviteExpireAt <- invitation.expireAt.map { Int64($0.timeIntervalSince1970 * 1000) },
            EnterpriseDB.inviteIsActive <- invitation.isActive
        )

        try db.run(insert)
    }

    private func logActivity(
        orgId: String,
        actorDID: String,
        action: ActivityAction,
        resourceType: String,
        resourceId: String,
        metadata: [String: String] = [:]
    ) async throws {
        guard let db = db else { return }

        let metadataJson = try? JSONEncoder().encode(metadata)
        let metadataString = metadataJson.flatMap { String(data: $0, encoding: .utf8) }

        let activity = OrganizationActivity(
            orgId: orgId,
            actorDID: actorDID,
            action: action,
            resourceType: resourceType,
            resourceId: resourceId,
            metadata: metadata
        )

        let insert = EnterpriseDB.organizationActivities.insert(
            EnterpriseDB.activityId <- activity.id,
            EnterpriseDB.activityOrgId <- activity.orgId,
            EnterpriseDB.activityActorDid <- activity.actorDID,
            EnterpriseDB.activityAction <- activity.action.rawValue,
            EnterpriseDB.activityResourceType <- activity.resourceType,
            EnterpriseDB.activityResourceId <- activity.resourceId,
            EnterpriseDB.activityMetadataJson <- metadataString,
            EnterpriseDB.activityTimestamp <- Int64(activity.timestamp.timeIntervalSince1970 * 1000)
        )

        try db.run(insert)
    }

    private func parseOrganization(from row: Row) throws -> Organization {
        let settingsString = try? row.get(EnterpriseDB.orgSettingsJson)
        let settings = settingsString
            .flatMap { $0.data(using: .utf8) }
            .flatMap { try? JSONDecoder().decode(OrganizationSettings.self, from: $0) }
            ?? OrganizationSettings()

        return Organization(
            id: row[EnterpriseDB.orgId],
            did: row[EnterpriseDB.orgDid],
            name: row[EnterpriseDB.orgName],
            description: try row.get(EnterpriseDB.orgDescription) ?? "",
            type: OrganizationType(rawValue: row[EnterpriseDB.orgType]) ?? .startup,
            avatar: try? row.get(EnterpriseDB.orgAvatar),
            ownerDID: row[EnterpriseDB.orgOwnerDid],
            settings: settings,
            createdAt: Date(timeIntervalSince1970: TimeInterval(row[EnterpriseDB.orgCreatedAt]) / 1000),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(row[EnterpriseDB.orgUpdatedAt]) / 1000)
        )
    }

    private func parseMember(from row: Row) throws -> OrganizationMember {
        let permissionsString = try? row.get(EnterpriseDB.memberPermissionsJson)
        let permissions = permissionsString
            .flatMap { $0.data(using: .utf8) }
            .flatMap { try? JSONDecoder().decode([Permission].self, from: $0) }
            ?? []

        return OrganizationMember(
            id: row[EnterpriseDB.memberId],
            orgId: row[EnterpriseDB.memberOrgId],
            memberDID: row[EnterpriseDB.memberDid],
            displayName: try row.get(EnterpriseDB.memberDisplayName) ?? "",
            avatar: try? row.get(EnterpriseDB.memberAvatar),
            role: OrganizationRole(rawValue: row[EnterpriseDB.memberRole]) ?? .viewer,
            customRoleId: try? row.get(EnterpriseDB.memberCustomRoleId),
            status: MemberStatus(rawValue: row[EnterpriseDB.memberStatus]) ?? .active,
            permissions: permissions,
            joinedAt: Date(timeIntervalSince1970: TimeInterval(row[EnterpriseDB.memberJoinedAt]) / 1000),
            lastActiveAt: try? row.get(EnterpriseDB.memberLastActiveAt).map {
                Date(timeIntervalSince1970: TimeInterval($0) / 1000)
            }
        )
    }

    private func generateInviteCode() -> String {
        let characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  // 移除易混淆字符
        return String((0..<8).map { _ in characters.randomElement()! })
    }
}
