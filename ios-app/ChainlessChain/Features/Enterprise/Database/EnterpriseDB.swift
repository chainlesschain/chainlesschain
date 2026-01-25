import Foundation
import SQLite

/// Enterprise Database Schema and Migrations
public class EnterpriseDB {

    // MARK: - Table Definitions

    /// 组织信息表
    public static let organizationInfo = Table("organization_info")
    public static let orgId = Expression<String>("org_id")
    public static let orgDid = Expression<String>("org_did")
    public static let orgName = Expression<String>("name")
    public static let orgDescription = Expression<String?>("description")
    public static let orgType = Expression<String>("type")
    public static let orgAvatar = Expression<String?>("avatar")
    public static let orgOwnerDid = Expression<String>("owner_did")
    public static let orgSettingsJson = Expression<String?>("settings_json")
    public static let orgCreatedAt = Expression<Int64>("created_at")
    public static let orgUpdatedAt = Expression<Int64>("updated_at")

    /// 组织成员表
    public static let organizationMembers = Table("organization_members")
    public static let memberId = Expression<String>("id")
    public static let memberOrgId = Expression<String>("org_id")
    public static let memberDid = Expression<String>("member_did")
    public static let memberDisplayName = Expression<String?>("display_name")
    public static let memberAvatar = Expression<String?>("avatar")
    public static let memberRole = Expression<String>("role")
    public static let memberCustomRoleId = Expression<String?>("custom_role_id")
    public static let memberStatus = Expression<String>("status")
    public static let memberPermissionsJson = Expression<String?>("permissions_json")
    public static let memberJoinedAt = Expression<Int64>("joined_at")
    public static let memberLastActiveAt = Expression<Int64?>("last_active_at")

    /// 角色定义表
    public static let organizationRoles = Table("organization_roles")
    public static let roleId = Expression<String>("id")
    public static let roleOrgId = Expression<String>("org_id")
    public static let roleName = Expression<String>("name")
    public static let roleDescription = Expression<String?>("description")
    public static let rolePermissionsJson = Expression<String>("permissions_json")
    public static let roleIsBuiltin = Expression<Bool>("is_builtin")
    public static let roleCreatedAt = Expression<Int64>("created_at")
    public static let roleUpdatedAt = Expression<Int64>("updated_at")

    /// 邀请码表
    public static let organizationInvitations = Table("organization_invitations")
    public static let inviteId = Expression<String>("id")
    public static let inviteOrgId = Expression<String>("org_id")
    public static let inviteCode = Expression<String>("invite_code")
    public static let inviteInvitedBy = Expression<String>("invited_by")
    public static let inviteRole = Expression<String>("role")
    public static let inviteMaxUses = Expression<Int>("max_uses")
    public static let inviteUsedCount = Expression<Int>("used_count")
    public static let inviteCreatedAt = Expression<Int64>("created_at")
    public static let inviteExpireAt = Expression<Int64?>("expire_at")
    public static let inviteIsActive = Expression<Bool>("is_active")

    /// 活动日志表
    public static let organizationActivities = Table("organization_activities")
    public static let activityId = Expression<String>("id")
    public static let activityOrgId = Expression<String>("org_id")
    public static let activityActorDid = Expression<String>("actor_did")
    public static let activityAction = Expression<String>("action")
    public static let activityResourceType = Expression<String>("resource_type")
    public static let activityResourceId = Expression<String>("resource_id")
    public static let activityMetadataJson = Expression<String?>("metadata_json")
    public static let activityTimestamp = Expression<Int64>("timestamp")

    // MARK: - Database Migration

    /// 创建RBAC相关表
    public static func createTables(db: Connection) throws {
        // 1. 创建组织信息表
        try db.run(organizationInfo.create(ifNotExists: true) { t in
            t.column(orgId, primaryKey: true)
            t.column(orgDid, unique: true)
            t.column(orgName)
            t.column(orgDescription)
            t.column(orgType)
            t.column(orgAvatar)
            t.column(orgOwnerDid)
            t.column(orgSettingsJson)
            t.column(orgCreatedAt)
            t.column(orgUpdatedAt)
        })

        // 2. 创建组织成员表
        try db.run(organizationMembers.create(ifNotExists: true) { t in
            t.column(memberId, primaryKey: true)
            t.column(memberOrgId)
            t.column(memberDid)
            t.column(memberDisplayName)
            t.column(memberAvatar)
            t.column(memberRole)
            t.column(memberCustomRoleId)
            t.column(memberStatus)
            t.column(memberPermissionsJson)
            t.column(memberJoinedAt)
            t.column(memberLastActiveAt)
            t.unique(memberOrgId, memberDid)  // 组织内唯一
        })

        // 3. 创建角色定义表
        try db.run(organizationRoles.create(ifNotExists: true) { t in
            t.column(roleId, primaryKey: true)
            t.column(roleOrgId)
            t.column(roleName)
            t.column(roleDescription)
            t.column(rolePermissionsJson)
            t.column(roleIsBuiltin, defaultValue: false)
            t.column(roleCreatedAt)
            t.column(roleUpdatedAt)
            t.unique(roleOrgId, roleName)  // 组织内角色名唯一
        })

        // 4. 创建邀请码表
        try db.run(organizationInvitations.create(ifNotExists: true) { t in
            t.column(inviteId, primaryKey: true)
            t.column(inviteOrgId)
            t.column(inviteCode, unique: true)
            t.column(inviteInvitedBy)
            t.column(inviteRole)
            t.column(inviteMaxUses)
            t.column(inviteUsedCount, defaultValue: 0)
            t.column(inviteCreatedAt)
            t.column(inviteExpireAt)
            t.column(inviteIsActive, defaultValue: true)
        })

        // 5. 创建活动日志表
        try db.run(organizationActivities.create(ifNotExists: true) { t in
            t.column(activityId, primaryKey: true)
            t.column(activityOrgId)
            t.column(activityActorDid)
            t.column(activityAction)
            t.column(activityResourceType)
            t.column(activityResourceId)
            t.column(activityMetadataJson)
            t.column(activityTimestamp)
        })

        print("[EnterpriseDB] ✅ All RBAC tables created successfully")
    }

    /// 创建索引以优化查询性能
    public static func createIndexes(db: Connection) throws {
        // 组织成员表索引
        try db.run(organizationMembers.createIndex(memberOrgId, ifNotExists: true))
        try db.run(organizationMembers.createIndex(memberDid, ifNotExists: true))
        try db.run(organizationMembers.createIndex(memberStatus, ifNotExists: true))

        // 角色表索引
        try db.run(organizationRoles.createIndex(roleOrgId, ifNotExists: true))

        // 邀请码表索引
        try db.run(organizationInvitations.createIndex(inviteOrgId, ifNotExists: true))
        try db.run(organizationInvitations.createIndex(inviteCode, unique: true, ifNotExists: true))
        try db.run(organizationInvitations.createIndex(inviteIsActive, ifNotExists: true))

        // 活动日志表索引
        try db.run(organizationActivities.createIndex(activityOrgId, ifNotExists: true))
        try db.run(organizationActivities.createIndex(activityActorDid, ifNotExists: true))
        try db.run(organizationActivities.createIndex(activityTimestamp, ifNotExists: true))

        print("[EnterpriseDB] ✅ All indexes created successfully")
    }

    /// 执行数据库迁移
    public static func migrate(db: Connection) throws {
        try createTables(db: db)
        try createIndexes(db: db)
        print("[EnterpriseDB] ✅ Migration completed successfully")
    }

    /// 删除所有表（用于测试）
    public static func dropAllTables(db: Connection) throws {
        try db.run(organizationActivities.drop(ifExists: true))
        try db.run(organizationInvitations.drop(ifExists: true))
        try db.run(organizationRoles.drop(ifExists: true))
        try db.run(organizationMembers.drop(ifExists: true))
        try db.run(organizationInfo.drop(ifExists: true))
        print("[EnterpriseDB] ⚠️  All tables dropped")
    }
}

// MARK: - Migration Helper

/// 数据库迁移管理器
public class EnterpriseMigrationManager {
    private let db: Connection
    private let migrationsTable = Table("enterprise_migrations")
    private let migrationVersion = Expression<Int>("version")
    private let migrationName = Expression<String>("name")
    private let migrationAppliedAt = Expression<Int64>("applied_at")

    public init(db: Connection) {
        self.db = db
    }

    /// 初始化迁移表
    public func setupMigrationsTable() throws {
        try db.run(migrationsTable.create(ifNotExists: true) { t in
            t.column(migrationVersion, primaryKey: true)
            t.column(migrationName)
            t.column(migrationAppliedAt)
        })
    }

    /// 检查迁移是否已应用
    public func isMigrationApplied(version: Int) throws -> Bool {
        let query = migrationsTable.filter(migrationVersion == version)
        return try db.pluck(query) != nil
    }

    /// 记录迁移
    public func recordMigration(version: Int, name: String) throws {
        let timestamp = Int64(Date().timeIntervalSince1970)
        try db.run(migrationsTable.insert(
            migrationVersion <- version,
            migrationName <- name,
            migrationAppliedAt <- timestamp
        ))
    }

    /// 运行所有待执行的迁移
    public func runMigrations() throws {
        try setupMigrationsTable()

        // Migration v1: 创建RBAC基础表
        if try !isMigrationApplied(version: 1) {
            print("[Migration] Running migration v1: Create RBAC tables")
            try EnterpriseDB.migrate(db: db)
            try recordMigration(version: 1, name: "Create RBAC tables")
            print("[Migration] ✅ Migration v1 completed")
        }

        print("[Migration] ✅ All migrations up to date")
    }
}
