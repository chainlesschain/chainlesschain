import Foundation
import CoreCommon
import Combine

/// 团队管理器
/// 管理组织的子团队和团队成员
@MainActor
public class TeamManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = TeamManager()

    // MARK: - Properties

    private let database: Database

    @Published public var teams: [String: [Team]] = [:]  // orgId -> teams

    /// 事件发布器
    public let teamCreated = PassthroughSubject<Team, Never>()
    public let teamUpdated = PassthroughSubject<Team, Never>()
    public let teamDeleted = PassthroughSubject<String, Never>()
    public let memberAdded = PassthroughSubject<(String, TeamMember), Never>()  // (teamId, member)
    public let memberRemoved = PassthroughSubject<(String, String), Never>()     // (teamId, memberDid)

    // MARK: - Initialization

    private init() {
        self.database = Database.shared
        Logger.shared.info("[TeamManager] 团队管理器已初始化")
    }

    /// 初始化数据库表
    public func initialize() async throws {
        Logger.shared.info("[TeamManager] 初始化数据库表...")

        // 团队表
        let createTeamsTableSQL = """
        CREATE TABLE IF NOT EXISTS org_teams (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            parent_team_id TEXT,
            lead_did TEXT,
            lead_name TEXT,
            avatar TEXT,
            settings_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(org_id, name)
        )
        """

        // 团队成员表
        let createMembersTableSQL = """
        CREATE TABLE IF NOT EXISTS org_team_members (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            member_did TEXT NOT NULL,
            member_name TEXT NOT NULL,
            team_role TEXT NOT NULL DEFAULT 'member',
            joined_at INTEGER NOT NULL,
            invited_by TEXT,
            UNIQUE(team_id, member_did),
            FOREIGN KEY (team_id) REFERENCES org_teams(id) ON DELETE CASCADE
        )
        """

        try await database.execute(createTeamsTableSQL)
        try await database.execute(createMembersTableSQL)

        // 创建索引
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_org_teams_org ON org_teams(org_id)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_org_teams_parent ON org_teams(parent_team_id)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_org_team_members_team ON org_team_members(team_id)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_org_team_members_did ON org_team_members(member_did)")

        Logger.shared.info("[TeamManager] 数据库表初始化成功")
    }

    // MARK: - Team CRUD Operations

    /// 创建团队
    public func createTeam(_ request: CreateTeamRequest) async throws -> Team {
        let team = Team(
            orgId: request.orgId,
            name: request.name,
            description: request.description,
            parentTeamId: request.parentTeamId,
            leadDid: request.leadDid,
            leadName: request.leadName,
            avatar: request.avatar,
            settings: request.settings
        )

        let settingsJson = request.settings != nil
            ? try? JSONEncoder().encode(request.settings).utf8String
            : nil

        let sql = """
        INSERT INTO org_teams (
            id, org_id, name, description, parent_team_id, lead_did, lead_name,
            avatar, settings_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        do {
            try await database.execute(sql, [
                team.id,
                team.orgId,
                team.name,
                team.description as Any,
                team.parentTeamId as Any,
                team.leadDid as Any,
                team.leadName as Any,
                team.avatar as Any,
                settingsJson as Any,
                Int(team.createdAt.timeIntervalSince1970),
                Int(team.updatedAt.timeIntervalSince1970)
            ])
        } catch {
            if error.localizedDescription.contains("UNIQUE constraint") {
                throw TeamError.teamNameExists
            }
            throw error
        }

        // 如果有负责人，添加为团队成员
        if let leadDid = request.leadDid, let leadName = request.leadName {
            _ = try? await addMember(
                teamId: team.id,
                memberDid: leadDid,
                memberName: leadName,
                role: .lead,
                invitedBy: request.createdBy
            )
        }

        // 更新内存缓存
        if teams[team.orgId] == nil {
            teams[team.orgId] = []
        }
        teams[team.orgId]?.append(team)

        Logger.shared.info("[TeamManager] 团队已创建: \(team.name) (\(team.id))")

        teamCreated.send(team)

        return team
    }

    /// 更新团队
    public func updateTeam(teamId: String, updates: UpdateTeamRequest) async throws -> Team {
        // 获取现有团队
        guard var team = try await getTeamById(teamId: teamId) else {
            throw TeamError.teamNotFound
        }

        var updateParts: [String] = []
        var values: [Any] = []

        if let name = updates.name {
            updateParts.append("name = ?")
            values.append(name)
            team.name = name
        }

        if let description = updates.description {
            updateParts.append("description = ?")
            values.append(description)
            team.description = description
        }

        if let parentTeamId = updates.parentTeamId {
            updateParts.append("parent_team_id = ?")
            values.append(parentTeamId)
            team.parentTeamId = parentTeamId
        }

        if let leadDid = updates.leadDid {
            updateParts.append("lead_did = ?")
            values.append(leadDid)
            team.leadDid = leadDid
        }

        if let leadName = updates.leadName {
            updateParts.append("lead_name = ?")
            values.append(leadName)
            team.leadName = leadName
        }

        if let avatar = updates.avatar {
            updateParts.append("avatar = ?")
            values.append(avatar)
            team.avatar = avatar
        }

        if let settings = updates.settings {
            let settingsJson = try? JSONEncoder().encode(settings).utf8String
            updateParts.append("settings_json = ?")
            values.append(settingsJson as Any)
            team.settings = settings
        }

        guard !updateParts.isEmpty else {
            return team
        }

        updateParts.append("updated_at = ?")
        values.append(Int(Date().timeIntervalSince1970))
        values.append(teamId)

        team.updatedAt = Date()

        let sql = "UPDATE org_teams SET \(updateParts.joined(separator: ", ")) WHERE id = ?"
        try await database.execute(sql, values)

        // 更新内存缓存
        if let index = teams[team.orgId]?.firstIndex(where: { $0.id == teamId }) {
            teams[team.orgId]?[index] = team
        }

        Logger.shared.info("[TeamManager] 团队已更新: \(team.name)")

        teamUpdated.send(team)

        return team
    }

    /// 删除团队
    public func deleteTeam(teamId: String) async throws {
        // 获取团队信息
        guard let team = try await getTeamById(teamId: teamId) else {
            throw TeamError.teamNotFound
        }

        // 检查是否有子团队
        let subTeamsQuery = "SELECT COUNT(*) as count FROM org_teams WHERE parent_team_id = ?"
        let subTeamsRows = try await database.query(subTeamsQuery, [teamId])
        let subTeamCount = subTeamsRows.first?["count"] as? Int ?? 0

        if subTeamCount > 0 {
            throw TeamError.hasSubTeams
        }

        // 删除团队成员
        try await database.execute("DELETE FROM org_team_members WHERE team_id = ?", [teamId])

        // 删除团队
        try await database.execute("DELETE FROM org_teams WHERE id = ?", [teamId])

        // 更新内存缓存
        if let index = teams[team.orgId]?.firstIndex(where: { $0.id == teamId }) {
            teams[team.orgId]?.remove(at: index)
        }

        Logger.shared.info("[TeamManager] 团队已删除: \(teamId)")

        teamDeleted.send(teamId)
    }

    /// 获取团队（按组织）
    public func getTeams(
        orgId: String,
        parentTeamId: String? = nil,
        includeAll: Bool = true
    ) async throws -> [Team] {
        var query = "SELECT * FROM org_teams WHERE org_id = ?"
        var params: [Any] = [orgId]

        if !includeAll {
            if let parentId = parentTeamId {
                query += " AND parent_team_id = ?"
                params.append(parentId)
            } else {
                query += " AND parent_team_id IS NULL"
            }
        }

        query += " ORDER BY name ASC"

        let rows = try await database.query(query, params)
        var teamList = rows.compactMap { parseTeam(from: $0) }

        // 获取成员数量
        for i in 0..<teamList.count {
            let countQuery = "SELECT COUNT(*) as count FROM org_team_members WHERE team_id = ?"
            let countRows = try await database.query(countQuery, [teamList[i].id])
            teamList[i].memberCount = countRows.first?["count"] as? Int ?? 0
        }

        return teamList
    }

    /// 根据ID获取团队
    public func getTeamById(teamId: String) async throws -> Team? {
        let query = "SELECT * FROM org_teams WHERE id = ?"
        let rows = try await database.query(query, [teamId])

        guard var team = rows.first.flatMap({ parseTeam(from: $0) }) else {
            return nil
        }

        // 获取成员数量
        let countQuery = "SELECT COUNT(*) as count FROM org_team_members WHERE team_id = ?"
        let countRows = try await database.query(countQuery, [teamId])
        team.memberCount = countRows.first?["count"] as? Int ?? 0

        return team
    }

    /// 获取团队树结构
    public func getTeamTree(orgId: String) async throws -> [TeamTreeNode] {
        let allTeams = try await getTeams(orgId: orgId, includeAll: true)
        return buildTeamTree(teams: allTeams, parentId: nil)
    }

    private func buildTeamTree(teams: [Team], parentId: String?) -> [TeamTreeNode] {
        let filteredTeams = teams.filter { $0.parentTeamId == parentId }

        return filteredTeams.map { team in
            let children = buildTeamTree(teams: teams, parentId: team.id)
            return TeamTreeNode(team: team, children: children)
        }
    }

    // MARK: - Member Management

    /// 添加团队成员
    public func addMember(
        teamId: String,
        memberDid: String,
        memberName: String,
        role: TeamRole = .member,
        invitedBy: String? = nil
    ) async throws -> TeamMember {
        let member = TeamMember(
            teamId: teamId,
            memberDid: memberDid,
            memberName: memberName,
            teamRole: role,
            invitedBy: invitedBy
        )

        let sql = """
        INSERT INTO org_team_members (id, team_id, member_did, member_name, team_role, joined_at, invited_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """

        do {
            try await database.execute(sql, [
                member.id,
                member.teamId,
                member.memberDid,
                member.memberName,
                member.teamRole.rawValue,
                Int(member.joinedAt.timeIntervalSince1970),
                member.invitedBy as Any
            ])
        } catch {
            if error.localizedDescription.contains("UNIQUE constraint") {
                throw TeamError.alreadyMember
            }
            throw error
        }

        Logger.shared.info("[TeamManager] 成员已加入团队: \(memberDid) -> \(teamId)")

        memberAdded.send((teamId, member))

        return member
    }

    /// 移除团队成员
    public func removeMember(teamId: String, memberDid: String) async throws {
        // 检查是否是负责人
        let team = try await getTeamById(teamId: teamId)
        if team?.leadDid == memberDid {
            throw TeamError.cannotRemoveLead
        }

        let sql = "DELETE FROM org_team_members WHERE team_id = ? AND member_did = ?"
        try await database.execute(sql, [teamId, memberDid])

        Logger.shared.info("[TeamManager] 成员已离开团队: \(memberDid) <- \(teamId)")

        memberRemoved.send((teamId, memberDid))
    }

    /// 设置团队负责人
    public func setLead(teamId: String, leadDid: String, leadName: String) async throws {
        // 更新团队信息
        try await database.execute(
            "UPDATE org_teams SET lead_did = ?, lead_name = ?, updated_at = ? WHERE id = ?",
            [leadDid, leadName, Int(Date().timeIntervalSince1970), teamId]
        )

        // 将原负责人改为普通成员
        try await database.execute(
            "UPDATE org_team_members SET team_role = 'member' WHERE team_id = ? AND team_role = 'lead'",
            [teamId]
        )

        // 设置新负责人
        try await database.execute(
            "UPDATE org_team_members SET team_role = 'lead' WHERE team_id = ? AND member_did = ?",
            [teamId, leadDid]
        )

        Logger.shared.info("[TeamManager] 团队负责人已更新: \(teamId) -> \(leadDid)")

        if var team = try await getTeamById(teamId: teamId) {
            team.leadDid = leadDid
            team.leadName = leadName
            teamUpdated.send(team)
        }
    }

    /// 获取团队成员
    public func getTeamMembers(teamId: String) async throws -> [TeamMember] {
        let query = """
        SELECT * FROM org_team_members
        WHERE team_id = ?
        ORDER BY team_role DESC, joined_at ASC
        """

        let rows = try await database.query(query, [teamId])
        return rows.compactMap { parseTeamMember(from: $0) }
    }

    /// 获取用户所在的所有团队
    public func getUserTeams(memberDid: String, orgId: String) async throws -> [Team] {
        let query = """
        SELECT t.* FROM org_teams t
        INNER JOIN org_team_members tm ON t.id = tm.team_id
        WHERE t.org_id = ? AND tm.member_did = ?
        ORDER BY t.name ASC
        """

        let rows = try await database.query(query, [orgId, memberDid])
        return rows.compactMap { parseTeam(from: $0) }
    }

    /// 更新成员角色
    public func updateMemberRole(teamId: String, memberDid: String, newRole: TeamRole) async throws {
        let sql = "UPDATE org_team_members SET team_role = ? WHERE team_id = ? AND member_did = ?"
        try await database.execute(sql, [newRole.rawValue, teamId, memberDid])

        Logger.shared.info("[TeamManager] 成员角色已更新: \(memberDid) -> \(newRole.rawValue)")
    }

    /// 检查是否是团队成员
    public func isMember(teamId: String, memberDid: String) async throws -> Bool {
        let query = "SELECT 1 FROM org_team_members WHERE team_id = ? AND member_did = ? LIMIT 1"
        let rows = try await database.query(query, [teamId, memberDid])
        return !rows.isEmpty
    }

    /// 获取成员在团队中的角色
    public func getMemberRole(teamId: String, memberDid: String) async throws -> TeamRole? {
        let query = "SELECT team_role FROM org_team_members WHERE team_id = ? AND member_did = ?"
        let rows = try await database.query(query, [teamId, memberDid])

        guard let roleRaw = rows.first?["team_role"] as? String else {
            return nil
        }

        return TeamRole(rawValue: roleRaw)
    }

    // MARK: - Parsing Methods

    private func parseTeam(from row: [String: Any]) -> Team? {
        guard
            let id = row["id"] as? String,
            let orgId = row["org_id"] as? String,
            let name = row["name"] as? String,
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int
        else {
            return nil
        }

        var settings: TeamSettings?
        if let settingsJson = row["settings_json"] as? String,
           let data = settingsJson.data(using: .utf8) {
            settings = try? JSONDecoder().decode(TeamSettings.self, from: data)
        }

        return Team(
            id: id,
            orgId: orgId,
            name: name,
            description: row["description"] as? String,
            parentTeamId: row["parent_team_id"] as? String,
            leadDid: row["lead_did"] as? String,
            leadName: row["lead_name"] as? String,
            avatar: row["avatar"] as? String,
            settings: settings,
            memberCount: 0,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
        )
    }

    private func parseTeamMember(from row: [String: Any]) -> TeamMember? {
        guard
            let id = row["id"] as? String,
            let teamId = row["team_id"] as? String,
            let memberDid = row["member_did"] as? String,
            let memberName = row["member_name"] as? String,
            let teamRoleRaw = row["team_role"] as? String,
            let teamRole = TeamRole(rawValue: teamRoleRaw),
            let joinedAtTimestamp = row["joined_at"] as? Int
        else {
            return nil
        }

        return TeamMember(
            id: id,
            teamId: teamId,
            memberDid: memberDid,
            memberName: memberName,
            teamRole: teamRole,
            joinedAt: Date(timeIntervalSince1970: TimeInterval(joinedAtTimestamp)),
            invitedBy: row["invited_by"] as? String
        )
    }
}

// MARK: - Data Extension

private extension Data {
    var utf8String: String? {
        return String(data: self, encoding: .utf8)
    }
}
