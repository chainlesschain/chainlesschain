import Foundation
import SQLite
import Combine

/// 身份管理器 - 管理多身份切换
@MainActor
public class IdentityManager: ObservableObject {

    public static let shared = IdentityManager()

    // MARK: - Published Properties

    /// 当前激活的身份
    @Published public var currentIdentity: Identity?

    /// 所有可用的身份列表
    @Published public var identities: [Identity] = []

    /// 身份变更事件
    public let identityChanged = PassthroughSubject<Identity, Never>()

    // MARK: - Private Properties

    private var db: Connection?
    private let dbQueue = DispatchQueue(label: "com.chainlesschain.identity", qos: .userInitiated)

    // Table definitions
    private let identitiesTable = Table("user_identities")
    private let idCol = Expression<String>("id")
    private let didCol = Expression<String>("did")
    private let displayNameCol = Expression<String>("display_name")
    private let avatarCol = Expression<String?>("avatar")
    private let orgIdCol = Expression<String?>("org_id")
    private let orgNameCol = Expression<String?>("org_name")
    private let roleCol = Expression<String?>("role")
    private let isActiveCol = Expression<Bool>("is_active")
    private let createdAtCol = Expression<Int64>("created_at")
    private let lastUsedAtCol = Expression<Int64?>("last_used_at")

    // MARK: - Initialization

    private init() {
        Task {
            try? await initialize()
        }
    }

    /// 初始化身份管理器
    public func initialize() async throws {
        try await createIdentitiesTable()
        try await loadIdentities()
        try await loadCurrentIdentity()
    }

    /// 设置数据库连接
    public func setDatabase(_ database: Connection) {
        self.db = database
    }

    // MARK: - Database Schema

    private func createIdentitiesTable() async throws {
        guard let db = db else {
            throw IdentityError.databaseNotInitialized
        }

        try db.run(identitiesTable.create(ifNotExists: true) { t in
            t.column(idCol, primaryKey: true)
            t.column(didCol, unique: true)
            t.column(displayNameCol)
            t.column(avatarCol)
            t.column(orgIdCol)
            t.column(orgNameCol)
            t.column(roleCol)
            t.column(isActiveCol, defaultValue: false)
            t.column(createdAtCol)
            t.column(lastUsedAtCol)
        })

        // 创建索引
        try db.run(identitiesTable.createIndex(didCol, ifNotExists: true))
        try db.run(identitiesTable.createIndex(orgIdCol, ifNotExists: true))
        try db.run(identitiesTable.createIndex(isActiveCol, ifNotExists: true))

        print("[IdentityManager] ✅ Identities table created")
    }

    // MARK: - Identity Management

    /// 创建新身份
    public func createIdentity(
        did: String,
        displayName: String,
        avatar: String? = nil,
        orgId: String? = nil,
        orgName: String? = nil,
        role: String? = nil
    ) async throws -> Identity {
        guard let db = db else {
            throw IdentityError.databaseNotInitialized
        }

        // 检查DID是否已存在
        let existing = try db.pluck(identitiesTable.filter(didCol == did))
        if existing != nil {
            throw IdentityError.identityAlreadyExists
        }

        let identity = Identity(
            id: "id_" + UUID().uuidString.replacingOccurrences(of: "-", with: ""),
            did: did,
            displayName: displayName,
            avatar: avatar,
            orgId: orgId,
            orgName: orgName,
            role: role,
            isActive: identities.isEmpty, // 第一个身份自动激活
            createdAt: Date(),
            lastUsedAt: nil
        )

        // 保存到数据库
        try db.run(identitiesTable.insert(
            idCol <- identity.id,
            didCol <- identity.did,
            displayNameCol <- identity.displayName,
            avatarCol <- identity.avatar,
            orgIdCol <- identity.orgId,
            orgNameCol <- identity.orgName,
            roleCol <- identity.role,
            isActiveCol <- identity.isActive,
            createdAtCol <- Int64(identity.createdAt.timeIntervalSince1970),
            lastUsedAtCol <- identity.lastUsedAt.map { Int64($0.timeIntervalSince1970) }
        ))

        // 更新内存
        identities.append(identity)

        // 如果是第一个身份，自动设为当前身份
        if identities.count == 1 {
            currentIdentity = identity
            identityChanged.send(identity)
        }

        print("[IdentityManager] ✅ Created identity: \(identity.displayName) (\(identity.did))")

        return identity
    }

    /// 更新身份信息
    public func updateIdentity(
        id: String,
        displayName: String? = nil,
        avatar: String? = nil,
        orgName: String? = nil,
        role: String? = nil
    ) async throws {
        guard let db = db else {
            throw IdentityError.databaseNotInitialized
        }

        guard let index = identities.firstIndex(where: { $0.id == id }) else {
            throw IdentityError.identityNotFound
        }

        var identity = identities[index]

        if let displayName = displayName {
            identity.displayName = displayName
        }
        if let avatar = avatar {
            identity.avatar = avatar
        }
        if let orgName = orgName {
            identity.orgName = orgName
        }
        if let role = role {
            identity.role = role
        }

        // 更新数据库
        let targetIdentity = identitiesTable.filter(idCol == id)
        var setters: [Setter] = []

        if let displayName = displayName {
            setters.append(displayNameCol <- displayName)
        }
        if let avatar = avatar {
            setters.append(avatarCol <- avatar)
        }
        if let orgName = orgName {
            setters.append(orgNameCol <- orgName)
        }
        if let role = role {
            setters.append(roleCol <- role)
        }

        if !setters.isEmpty {
            try db.run(targetIdentity.update(setters))
        }

        // 更新内存
        identities[index] = identity

        // 如果是当前身份，更新当前身份
        if currentIdentity?.id == id {
            currentIdentity = identity
        }

        print("[IdentityManager] ✅ Updated identity: \(identity.displayName)")
    }

    /// 删除身份
    public func deleteIdentity(id: String) async throws {
        guard let db = db else {
            throw IdentityError.databaseNotInitialized
        }

        guard let index = identities.firstIndex(where: { $0.id == id }) else {
            throw IdentityError.identityNotFound
        }

        let identity = identities[index]

        // 不能删除当前激活的身份
        if identity.isActive {
            throw IdentityError.cannotDeleteActiveIdentity
        }

        // 从数据库删除
        let targetIdentity = identitiesTable.filter(idCol == id)
        try db.run(targetIdentity.delete())

        // 从内存删除
        identities.remove(at: index)

        print("[IdentityManager] ✅ Deleted identity: \(identity.displayName)")
    }

    // MARK: - Identity Switching

    /// 切换到指定身份
    public func switchIdentity(to identity: Identity) async throws {
        guard let db = db else {
            throw IdentityError.databaseNotInitialized
        }

        guard identities.contains(where: { $0.id == identity.id }) else {
            throw IdentityError.identityNotFound
        }

        // 停用当前身份
        if let currentId = currentIdentity?.id {
            try db.run(identitiesTable.filter(idCol == currentId).update(isActiveCol <- false))

            if let index = identities.firstIndex(where: { $0.id == currentId }) {
                identities[index].isActive = false
            }
        }

        // 激活新身份
        let timestamp = Int64(Date().timeIntervalSince1970)
        try db.run(identitiesTable.filter(idCol == identity.id).update(
            isActiveCol <- true,
            lastUsedAtCol <- timestamp
        ))

        if let index = identities.firstIndex(where: { $0.id == identity.id }) {
            identities[index].isActive = true
            identities[index].lastUsedAt = Date()
            currentIdentity = identities[index]
        }

        // 发送身份变更事件
        identityChanged.send(identity)

        print("[IdentityManager] ✅ Switched to identity: \(identity.displayName)")
    }

    /// 通过DID切换身份
    public func switchIdentityByDID(_ did: String) async throws {
        guard let identity = identities.first(where: { $0.did == did }) else {
            throw IdentityError.identityNotFound
        }

        try await switchIdentity(to: identity)
    }

    /// 通过ID切换身份
    public func switchIdentityByID(_ id: String) async throws {
        guard let identity = identities.first(where: { $0.id == id }) else {
            throw IdentityError.identityNotFound
        }

        try await switchIdentity(to: identity)
    }

    // MARK: - Query Methods

    /// 获取当前身份
    public func getCurrentIdentity() -> Identity? {
        return currentIdentity
    }

    /// 获取所有身份
    public func listIdentities() -> [Identity] {
        return identities
    }

    /// 获取组织相关的身份
    public func getIdentitiesByOrg(orgId: String) -> [Identity] {
        return identities.filter { $0.orgId == orgId }
    }

    /// 通过DID获取身份
    public func getIdentityByDID(_ did: String) -> Identity? {
        return identities.first(where: { $0.did == did })
    }

    /// 通过ID获取身份
    public func getIdentityByID(_ id: String) -> Identity? {
        return identities.first(where: { $0.id == id })
    }

    /// 检查DID是否已存在
    public func hasIdentity(did: String) -> Bool {
        return identities.contains(where: { $0.did == did })
    }

    /// 获取个人身份（不属于任何组织）
    public func getPersonalIdentities() -> [Identity] {
        return identities.filter { $0.orgId == nil }
    }

    /// 获取组织身份（属于某个组织）
    public func getOrganizationIdentities() -> [Identity] {
        return identities.filter { $0.orgId != nil }
    }

    // MARK: - Private Methods

    /// 从数据库加载所有身份
    private func loadIdentities() async throws {
        guard let db = db else {
            throw IdentityError.databaseNotInitialized
        }

        var loadedIdentities: [Identity] = []

        for row in try db.prepare(identitiesTable) {
            let identity = Identity(
                id: row[idCol],
                did: row[didCol],
                displayName: row[displayNameCol],
                avatar: row[avatarCol],
                orgId: row[orgIdCol],
                orgName: row[orgNameCol],
                role: row[roleCol],
                isActive: row[isActiveCol],
                createdAt: Date(timeIntervalSince1970: TimeInterval(row[createdAtCol])),
                lastUsedAt: row[lastUsedAtCol].map { Date(timeIntervalSince1970: TimeInterval($0)) }
            )
            loadedIdentities.append(identity)
        }

        // 按最后使用时间排序（未使用的排在最后）
        identities = loadedIdentities.sorted { lhs, rhs in
            if let lhsTime = lhs.lastUsedAt, let rhsTime = rhs.lastUsedAt {
                return lhsTime > rhsTime
            } else if lhs.lastUsedAt != nil {
                return true
            } else if rhs.lastUsedAt != nil {
                return false
            } else {
                return lhs.createdAt > rhs.createdAt
            }
        }

        print("[IdentityManager] ✅ Loaded \(identities.count) identities")
    }

    /// 加载当前激活的身份
    private func loadCurrentIdentity() async throws {
        currentIdentity = identities.first(where: { $0.isActive })

        if let current = currentIdentity {
            print("[IdentityManager] ✅ Current identity: \(current.displayName)")
        } else {
            print("[IdentityManager] ⚠️  No active identity")
        }
    }

    // MARK: - Organization Integration

    /// 从组织成员信息同步身份
    public func syncIdentityFromOrganization(
        member: OrganizationMember,
        org: Organization
    ) async throws {
        // 检查是否已存在该组织的身份
        if let existingIdentity = identities.first(where: { $0.orgId == org.id && $0.did == member.memberDID }) {
            // 更新已有身份
            try await updateIdentity(
                id: existingIdentity.id,
                displayName: member.displayName,
                avatar: member.avatar,
                orgName: org.name,
                role: member.role.rawValue
            )
        } else {
            // 创建新身份
            _ = try await createIdentity(
                did: member.memberDID,
                displayName: member.displayName,
                avatar: member.avatar,
                orgId: org.id,
                orgName: org.name,
                role: member.role.rawValue
            )
        }
    }

    /// 当成员离开组织时移除身份
    public func removeIdentityForOrganization(
        orgId: String,
        memberDID: String
    ) async throws {
        guard let identity = identities.first(where: { $0.orgId == orgId && $0.did == memberDID }) else {
            return
        }

        // 如果是当前激活身份，先切换到其他身份
        if identity.isActive {
            if let fallbackIdentity = identities.first(where: { $0.id != identity.id }) {
                try await switchIdentity(to: fallbackIdentity)
            }
        }

        try await deleteIdentity(id: identity.id)
    }

    /// 批量同步组织成员身份
    public func syncOrganizationIdentities(
        org: Organization,
        members: [OrganizationMember]
    ) async throws {
        for member in members {
            try await syncIdentityFromOrganization(member: member, org: org)
        }

        print("[IdentityManager] ✅ Synced \(members.count) identities for org: \(org.name)")
    }
}

// MARK: - Identity Model

/// 用户身份
public struct Identity: Identifiable, Codable, Hashable {
    public let id: String
    public let did: String
    public var displayName: String
    public var avatar: String?
    public var orgId: String?         // 所属组织ID（nil表示个人身份）
    public var orgName: String?       // 所属组织名称
    public var role: String?          // 在组织中的角色
    public var isActive: Bool         // 是否为当前激活的身份
    public let createdAt: Date
    public var lastUsedAt: Date?

    public init(
        id: String = "id_" + UUID().uuidString.replacingOccurrences(of: "-", with: ""),
        did: String,
        displayName: String,
        avatar: String? = nil,
        orgId: String? = nil,
        orgName: String? = nil,
        role: String? = nil,
        isActive: Bool = false,
        createdAt: Date = Date(),
        lastUsedAt: Date? = nil
    ) {
        self.id = id
        self.did = did
        self.displayName = displayName
        self.avatar = avatar
        self.orgId = orgId
        self.orgName = orgName
        self.role = role
        self.isActive = isActive
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
    }

    /// 是否为个人身份
    public var isPersonal: Bool {
        return orgId == nil
    }

    /// 是否为组织身份
    public var isOrganization: Bool {
        return orgId != nil
    }

    /// 显示标签（用于UI）
    public var displayLabel: String {
        if let orgName = orgName {
            return "\(displayName) @ \(orgName)"
        } else {
            return displayName
        }
    }

    /// 角色显示名称
    public var roleDisplayName: String? {
        guard let role = role else { return nil }

        if let orgRole = OrganizationRole(rawValue: role) {
            return orgRole.displayName
        }
        return role
    }
}

// MARK: - Error Types

public enum IdentityError: Error, LocalizedError {
    case databaseNotInitialized
    case identityNotFound
    case identityAlreadyExists
    case cannotDeleteActiveIdentity
    case noActiveIdentity

    public var errorDescription: String? {
        switch self {
        case .databaseNotInitialized:
            return "数据库未初始化"
        case .identityNotFound:
            return "身份未找到"
        case .identityAlreadyExists:
            return "该DID的身份已存在"
        case .cannotDeleteActiveIdentity:
            return "不能删除当前激活的身份"
        case .noActiveIdentity:
            return "没有激活的身份"
        }
    }
}
