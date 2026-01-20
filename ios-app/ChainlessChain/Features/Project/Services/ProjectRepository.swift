import Foundation
import SQLite3
import CoreDatabase
import CoreCommon

/// 项目数据仓储
/// 负责项目的数据库持久化操作
/// Reference: desktop-app-vue/src/main/project/project-repository.js
class ProjectRepository {
    // MARK: - Singleton

    static let shared = ProjectRepository()

    // MARK: - Private Properties

    private let database = DatabaseManager.shared
    private let logger = Logger.shared

    private init() {
        createTablesIfNeeded()
    }

    // MARK: - Table Creation

    private func createTablesIfNeeded() {
        // Projects table
        let projectsSql = """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                type TEXT NOT NULL DEFAULT 'document',
                status TEXT NOT NULL DEFAULT 'draft',
                tags TEXT,
                file_count INTEGER DEFAULT 0,
                total_size INTEGER DEFAULT 0,
                is_shared INTEGER DEFAULT 0,
                share_token TEXT,
                sync_status TEXT DEFAULT 'local',
                last_synced_at INTEGER,
                metadata TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """

        // Project files table
        let filesSql = """
            CREATE TABLE IF NOT EXISTS project_files (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                type TEXT NOT NULL,
                size INTEGER DEFAULT 0,
                content TEXT,
                mime_type TEXT,
                is_directory INTEGER DEFAULT 0,
                parent_id TEXT,
                metadata TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """

        // Project activity log table
        let activitySql = """
            CREATE TABLE IF NOT EXISTS project_activities (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                action TEXT NOT NULL,
                description TEXT,
                user_id TEXT,
                metadata TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """

        do {
            try database.execute(projectsSql)
            try database.execute(filesSql)
            try database.execute(activitySql)
            logger.database("Project tables ready")
        } catch {
            logger.error("Failed to create project tables", error: error, category: "Project")
        }
    }

    // MARK: - Project CRUD

    /// 获取所有项目
    func getAllProjects(
        status: ProjectStatus? = nil,
        type: ProjectType? = nil,
        limit: Int = 100,
        offset: Int = 0
    ) throws -> [ProjectEntity] {
        var sql = """
            SELECT id, name, description, type, status, tags, file_count, total_size,
                   is_shared, share_token, sync_status, last_synced_at, metadata, created_at, updated_at
            FROM projects
            WHERE 1=1
        """
        var parameters: [Any?] = []

        if let status = status {
            sql += " AND status = ?"
            parameters.append(status.rawValue)
        }

        if let type = type {
            sql += " AND type = ?"
            parameters.append(type.rawValue)
        }

        sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
        parameters.append(limit)
        parameters.append(offset)

        return try database.query(sql, parameters: parameters) { stmt in
            parseProjectEntity(stmt)
        }
    }

    /// 根据 ID 获取项目
    func getProject(id: String) throws -> ProjectEntity? {
        let sql = """
            SELECT id, name, description, type, status, tags, file_count, total_size,
                   is_shared, share_token, sync_status, last_synced_at, metadata, created_at, updated_at
            FROM projects
            WHERE id = ?
        """

        return try database.queryOne(sql, parameters: [id]) { stmt in
            parseProjectEntity(stmt)
        }
    }

    /// 搜索项目
    func searchProjects(query: String, limit: Int = 50) throws -> [ProjectEntity] {
        guard !query.isEmpty else { return [] }

        // Sanitize query
        let sanitizedQuery = query
            .replacingOccurrences(of: "%", with: "\\%")
            .replacingOccurrences(of: "_", with: "\\_")
        let truncatedQuery = String(sanitizedQuery.prefix(200))

        let sql = """
            SELECT id, name, description, type, status, tags, file_count, total_size,
                   is_shared, share_token, sync_status, last_synced_at, metadata, created_at, updated_at
            FROM projects
            WHERE (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')
            ORDER BY updated_at DESC
            LIMIT ?
        """

        let searchPattern = "%\(truncatedQuery)%"
        return try database.query(sql, parameters: [searchPattern, searchPattern, searchPattern, limit]) { stmt in
            parseProjectEntity(stmt)
        }
    }

    /// 创建项目
    func createProject(_ project: ProjectEntity) throws {
        // Input validation
        guard !project.id.isEmpty else {
            throw ProjectError.invalidInput("Project ID cannot be empty")
        }
        guard !project.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ProjectError.invalidInput("Project name cannot be empty")
        }

        let sql = """
            INSERT INTO projects (id, name, description, type, status, tags, file_count, total_size,
                                  is_shared, share_token, sync_status, last_synced_at, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        _ = try database.query(sql, parameters: [
            project.id,
            project.name,
            project.description as Any?,
            project.type.rawValue,
            project.status.rawValue,
            project.tagsJson,
            project.fileCount,
            project.totalSize,
            project.isShared ? 1 : 0,
            project.shareToken as Any?,
            project.syncStatus.rawValue,
            project.lastSyncedAt?.timestampMs as Any?,
            project.metadata as Any?,
            project.createdAt.timestampMs,
            project.updatedAt.timestampMs
        ]) { _ in () }

        // Log activity
        try logActivity(projectId: project.id, action: "create", description: "项目创建")

        logger.database("Created project: \(project.id)")
    }

    /// 更新项目
    func updateProject(_ project: ProjectEntity) throws {
        guard !project.id.isEmpty else {
            throw ProjectError.invalidInput("Project ID cannot be empty")
        }

        let sql = """
            UPDATE projects
            SET name = ?, description = ?, type = ?, status = ?, tags = ?,
                file_count = ?, total_size = ?, is_shared = ?, share_token = ?,
                sync_status = ?, last_synced_at = ?, metadata = ?, updated_at = ?
            WHERE id = ?
        """

        _ = try database.query(sql, parameters: [
            project.name,
            project.description as Any?,
            project.type.rawValue,
            project.status.rawValue,
            project.tagsJson,
            project.fileCount,
            project.totalSize,
            project.isShared ? 1 : 0,
            project.shareToken as Any?,
            project.syncStatus.rawValue,
            project.lastSyncedAt?.timestampMs as Any?,
            project.metadata as Any?,
            Date().timestampMs,
            project.id
        ]) { _ in () }

        logger.database("Updated project: \(project.id)")
    }

    /// 更新项目状态
    func updateProjectStatus(id: String, status: ProjectStatus) throws {
        guard !id.isEmpty else {
            throw ProjectError.invalidInput("Project ID cannot be empty")
        }

        let sql = "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?"
        _ = try database.query(sql, parameters: [status.rawValue, Date().timestampMs, id]) { _ in () }

        try logActivity(projectId: id, action: "status_change", description: "状态变更为: \(status.displayName)")
        logger.database("Updated project status: \(id) -> \(status.rawValue)")
    }

    /// 删除项目
    func deleteProject(id: String) throws {
        guard !id.isEmpty else {
            throw ProjectError.invalidInput("Project ID cannot be empty")
        }

        // Use parameterized query to prevent SQL injection
        let sql = "DELETE FROM projects WHERE id = ?"
        _ = try database.query(sql, parameters: [id]) { _ in () }

        logger.database("Deleted project: \(id)")
    }

    // MARK: - Project Files

    /// 获取单个项目文件
    func getProjectFile(id: String) throws -> ProjectFileEntity? {
        guard !id.isEmpty else {
            throw ProjectError.invalidInput("File ID cannot be empty")
        }

        let sql = """
            SELECT id, project_id, name, path, type, size, content, mime_type,
                   is_directory, parent_id, metadata, created_at, updated_at
            FROM project_files
            WHERE id = ?
        """

        return try database.queryOne(sql, parameters: [id]) { stmt in
            parseProjectFileEntity(stmt)
        }
    }

    /// 获取项目文件列表
    func getProjectFiles(projectId: String, parentId: String? = nil) throws -> [ProjectFileEntity] {
        var sql = """
            SELECT id, project_id, name, path, type, size, content, mime_type,
                   is_directory, parent_id, metadata, created_at, updated_at
            FROM project_files
            WHERE project_id = ?
        """
        var parameters: [Any?] = [projectId]

        if let parentId = parentId {
            sql += " AND parent_id = ?"
            parameters.append(parentId)
        } else {
            sql += " AND parent_id IS NULL"
        }

        sql += " ORDER BY is_directory DESC, name ASC"

        return try database.query(sql, parameters: parameters) { stmt in
            parseProjectFileEntity(stmt)
        }
    }

    /// 创建项目文件
    func createProjectFile(_ file: ProjectFileEntity) throws {
        guard !file.id.isEmpty else {
            throw ProjectError.invalidInput("File ID cannot be empty")
        }
        guard !file.projectId.isEmpty else {
            throw ProjectError.invalidInput("Project ID cannot be empty")
        }

        let sql = """
            INSERT INTO project_files (id, project_id, name, path, type, size, content, mime_type,
                                        is_directory, parent_id, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        _ = try database.query(sql, parameters: [
            file.id,
            file.projectId,
            file.name,
            file.path,
            file.type,
            file.size,
            file.content as Any?,
            file.mimeType as Any?,
            file.isDirectory ? 1 : 0,
            file.parentId as Any?,
            file.metadata as Any?,
            file.createdAt.timestampMs,
            file.updatedAt.timestampMs
        ]) { _ in () }

        // Update project file count
        try updateProjectFileStats(projectId: file.projectId)

        logger.database("Created project file: \(file.id)")
    }

    /// 更新项目文件
    func updateProjectFile(_ file: ProjectFileEntity) throws {
        let sql = """
            UPDATE project_files
            SET name = ?, path = ?, type = ?, size = ?, content = ?, mime_type = ?,
                is_directory = ?, parent_id = ?, metadata = ?, updated_at = ?
            WHERE id = ?
        """

        _ = try database.query(sql, parameters: [
            file.name,
            file.path,
            file.type,
            file.size,
            file.content as Any?,
            file.mimeType as Any?,
            file.isDirectory ? 1 : 0,
            file.parentId as Any?,
            file.metadata as Any?,
            Date().timestampMs,
            file.id
        ]) { _ in () }

        // Update project file stats
        try updateProjectFileStats(projectId: file.projectId)

        logger.database("Updated project file: \(file.id)")
    }

    /// 删除项目文件
    func deleteProjectFile(id: String, projectId: String) throws {
        guard !id.isEmpty else {
            throw ProjectError.invalidInput("File ID cannot be empty")
        }

        let sql = "DELETE FROM project_files WHERE id = ?"
        _ = try database.query(sql, parameters: [id]) { _ in () }

        // Update project file stats
        try updateProjectFileStats(projectId: projectId)

        logger.database("Deleted project file: \(id)")
    }

    /// 更新项目文件统计
    private func updateProjectFileStats(projectId: String) throws {
        let countSql = "SELECT COUNT(*), COALESCE(SUM(size), 0) FROM project_files WHERE project_id = ? AND is_directory = 0"

        let stats: (Int, Int64)? = try database.queryOne(countSql, parameters: [projectId]) { stmt in
            (Int(sqlite3_column_int(stmt, 0)), sqlite3_column_int64(stmt, 1))
        }

        if let (count, size) = stats {
            let updateSql = "UPDATE projects SET file_count = ?, total_size = ?, updated_at = ? WHERE id = ?"
            _ = try database.query(updateSql, parameters: [count, size, Date().timestampMs, projectId]) { _ in () }
        }
    }

    // MARK: - Activity Log

    /// 记录项目活动
    func logActivity(projectId: String, action: String, description: String?, userId: String? = nil) throws {
        let sql = """
            INSERT INTO project_activities (id, project_id, action, description, user_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """

        _ = try database.query(sql, parameters: [
            UUID().uuidString,
            projectId,
            action,
            description as Any?,
            userId as Any?,
            Date().timestampMs
        ]) { _ in () }
    }

    /// 获取项目活动历史
    func getProjectActivities(projectId: String, limit: Int = 50) throws -> [ProjectActivityEntity] {
        let sql = """
            SELECT id, project_id, action, description, user_id, metadata, created_at
            FROM project_activities
            WHERE project_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        """

        return try database.query(sql, parameters: [projectId, limit]) { stmt in
            ProjectActivityEntity(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                projectId: String(cString: sqlite3_column_text(stmt, 1)),
                action: String(cString: sqlite3_column_text(stmt, 2)),
                description: sqlite3_column_type(stmt, 3) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 3)) : nil,
                userId: sqlite3_column_type(stmt, 4) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 4)) : nil,
                metadata: sqlite3_column_type(stmt, 5) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 5)) : nil,
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 6)) / 1000)
            )
        }
    }

    // MARK: - Statistics

    /// 获取项目统计
    func getStatistics() throws -> ProjectStatistics {
        let totalCount: Int = try database.queryOne("SELECT COUNT(*) FROM projects") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let draftCount: Int = try database.queryOne("SELECT COUNT(*) FROM projects WHERE status = 'draft'") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let activeCount: Int = try database.queryOne("SELECT COUNT(*) FROM projects WHERE status = 'active'") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let completedCount: Int = try database.queryOne("SELECT COUNT(*) FROM projects WHERE status = 'completed'") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let totalFiles: Int = try database.queryOne("SELECT COUNT(*) FROM project_files WHERE is_directory = 0") { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0

        let totalSize: Int64 = try database.queryOne("SELECT COALESCE(SUM(total_size), 0) FROM projects") { stmt in
            sqlite3_column_int64(stmt, 0)
        } ?? 0

        return ProjectStatistics(
            totalProjects: totalCount,
            draftProjects: draftCount,
            activeProjects: activeCount,
            completedProjects: completedCount,
            totalFiles: totalFiles,
            totalSize: totalSize
        )
    }

    // MARK: - Helper Methods

    private func parseProjectEntity(_ stmt: OpaquePointer?) -> ProjectEntity {
        ProjectEntity(
            id: String(cString: sqlite3_column_text(stmt, 0)),
            name: String(cString: sqlite3_column_text(stmt, 1)),
            description: sqlite3_column_type(stmt, 2) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 2)) : nil,
            type: ProjectType(rawValue: String(cString: sqlite3_column_text(stmt, 3))) ?? .document,
            status: ProjectStatus(rawValue: String(cString: sqlite3_column_text(stmt, 4))) ?? .draft,
            tagsJson: sqlite3_column_type(stmt, 5) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 5)) : nil,
            fileCount: Int(sqlite3_column_int(stmt, 6)),
            totalSize: sqlite3_column_int64(stmt, 7),
            isShared: sqlite3_column_int(stmt, 8) == 1,
            shareToken: sqlite3_column_type(stmt, 9) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 9)) : nil,
            syncStatus: SyncStatus(rawValue: String(cString: sqlite3_column_text(stmt, 10))) ?? .local,
            lastSyncedAt: sqlite3_column_type(stmt, 11) != SQLITE_NULL ? Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 11)) / 1000) : nil,
            metadata: sqlite3_column_type(stmt, 12) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 12)) : nil,
            createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 13)) / 1000),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 14)) / 1000)
        )
    }

    private func parseProjectFileEntity(_ stmt: OpaquePointer?) -> ProjectFileEntity {
        ProjectFileEntity(
            id: String(cString: sqlite3_column_text(stmt, 0)),
            projectId: String(cString: sqlite3_column_text(stmt, 1)),
            name: String(cString: sqlite3_column_text(stmt, 2)),
            path: String(cString: sqlite3_column_text(stmt, 3)),
            type: String(cString: sqlite3_column_text(stmt, 4)),
            size: sqlite3_column_int64(stmt, 5),
            content: sqlite3_column_type(stmt, 6) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 6)) : nil,
            mimeType: sqlite3_column_type(stmt, 7) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 7)) : nil,
            isDirectory: sqlite3_column_int(stmt, 8) == 1,
            parentId: sqlite3_column_type(stmt, 9) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 9)) : nil,
            metadata: sqlite3_column_type(stmt, 10) != SQLITE_NULL ? String(cString: sqlite3_column_text(stmt, 10)) : nil,
            createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 11)) / 1000),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 12)) / 1000)
        )
    }
}

// MARK: - Entity Models

/// 项目实体
struct ProjectEntity: Identifiable {
    let id: String
    var name: String
    var description: String?
    var type: ProjectType
    var status: ProjectStatus
    var tagsJson: String?
    var fileCount: Int
    var totalSize: Int64
    var isShared: Bool
    var shareToken: String?
    var syncStatus: SyncStatus
    var lastSyncedAt: Date?
    var metadata: String?
    let createdAt: Date
    var updatedAt: Date

    init(
        id: String = UUID().uuidString,
        name: String,
        description: String? = nil,
        type: ProjectType = .document,
        status: ProjectStatus = .draft,
        tagsJson: String? = nil,
        fileCount: Int = 0,
        totalSize: Int64 = 0,
        isShared: Bool = false,
        shareToken: String? = nil,
        syncStatus: SyncStatus = .local,
        lastSyncedAt: Date? = nil,
        metadata: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.type = type
        self.status = status
        self.tagsJson = tagsJson
        self.fileCount = fileCount
        self.totalSize = totalSize
        self.isShared = isShared
        self.shareToken = shareToken
        self.syncStatus = syncStatus
        self.lastSyncedAt = lastSyncedAt
        self.metadata = metadata
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Parse tags from JSON
    var tags: [String] {
        guard let json = tagsJson,
              let data = json.data(using: .utf8),
              let array = try? JSONDecoder().decode([String].self, from: data) else {
            return []
        }
        return array
    }

    /// Format file size for display
    var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: totalSize)
    }

    /// Get type icon name
    var typeIcon: String {
        type.icon
    }

    /// Get status color
    var statusColor: String {
        status.color
    }
}

/// 项目文件实体
struct ProjectFileEntity: Identifiable {
    let id: String
    let projectId: String
    var name: String
    var path: String
    var type: String
    var size: Int64
    var content: String?
    var mimeType: String?
    var isDirectory: Bool
    var parentId: String?
    var metadata: String?
    let createdAt: Date
    var updatedAt: Date

    init(
        id: String = UUID().uuidString,
        projectId: String,
        name: String,
        path: String,
        type: String,
        size: Int64 = 0,
        content: String? = nil,
        mimeType: String? = nil,
        isDirectory: Bool = false,
        parentId: String? = nil,
        metadata: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.projectId = projectId
        self.name = name
        self.path = path
        self.type = type
        self.size = size
        self.content = content
        self.mimeType = mimeType
        self.isDirectory = isDirectory
        self.parentId = parentId
        self.metadata = metadata
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Format file size
    var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: size)
    }

    /// Get file icon
    var icon: String {
        if isDirectory {
            return "folder.fill"
        }
        switch type.lowercased() {
        case "swift", "js", "ts", "py", "java", "cpp", "c", "go", "rs":
            return "doc.text.fill"
        case "md", "markdown":
            return "doc.richtext.fill"
        case "json", "xml", "yaml", "yml":
            return "doc.badge.gearshape.fill"
        case "png", "jpg", "jpeg", "gif", "svg":
            return "photo.fill"
        case "pdf":
            return "doc.fill"
        case "html", "css":
            return "globe"
        default:
            return "doc.fill"
        }
    }
}

/// 项目活动实体
struct ProjectActivityEntity: Identifiable {
    let id: String
    let projectId: String
    let action: String
    let description: String?
    let userId: String?
    let metadata: String?
    let createdAt: Date

    var actionIcon: String {
        switch action {
        case "create": return "plus.circle.fill"
        case "update": return "pencil.circle.fill"
        case "delete": return "trash.circle.fill"
        case "status_change": return "flag.circle.fill"
        case "file_add": return "doc.badge.plus"
        case "file_delete": return "doc.badge.minus"
        case "share": return "square.and.arrow.up.circle.fill"
        default: return "circle.fill"
        }
    }
}

// MARK: - Enums

/// 项目类型
enum ProjectType: String, CaseIterable {
    case web = "web"
    case document = "document"
    case data = "data"
    case application = "application"
    case presentation = "presentation"
    case spreadsheet = "spreadsheet"

    var displayName: String {
        switch self {
        case .web: return "网页项目"
        case .document: return "文档项目"
        case .data: return "数据项目"
        case .application: return "应用项目"
        case .presentation: return "演示项目"
        case .spreadsheet: return "表格项目"
        }
    }

    var icon: String {
        switch self {
        case .web: return "globe"
        case .document: return "doc.text.fill"
        case .data: return "chart.bar.fill"
        case .application: return "app.fill"
        case .presentation: return "play.rectangle.fill"
        case .spreadsheet: return "tablecells.fill"
        }
    }
}

/// 项目状态
enum ProjectStatus: String, CaseIterable {
    case draft = "draft"
    case active = "active"
    case completed = "completed"
    case archived = "archived"

    var displayName: String {
        switch self {
        case .draft: return "草稿"
        case .active: return "进行中"
        case .completed: return "已完成"
        case .archived: return "已归档"
        }
    }

    var color: String {
        switch self {
        case .draft: return "gray"
        case .active: return "blue"
        case .completed: return "green"
        case .archived: return "orange"
        }
    }
}

/// 同步状态
enum SyncStatus: String {
    case local = "local"
    case synced = "synced"
    case pending = "pending"
    case conflict = "conflict"
    case error = "error"

    var displayName: String {
        switch self {
        case .local: return "本地"
        case .synced: return "已同步"
        case .pending: return "同步中"
        case .conflict: return "冲突"
        case .error: return "错误"
        }
    }

    var icon: String {
        switch self {
        case .local: return "iphone"
        case .synced: return "checkmark.icloud.fill"
        case .pending: return "arrow.triangle.2.circlepath.icloud"
        case .conflict: return "exclamationmark.icloud.fill"
        case .error: return "xmark.icloud.fill"
        }
    }
}

/// 项目统计
struct ProjectStatistics {
    let totalProjects: Int
    let draftProjects: Int
    let activeProjects: Int
    let completedProjects: Int
    let totalFiles: Int
    let totalSize: Int64

    var formattedTotalSize: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: totalSize)
    }
}

/// 项目错误
enum ProjectError: LocalizedError {
    case invalidInput(String)
    case projectNotFound
    case fileNotFound
    case syncFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidInput(let message):
            return "输入无效: \(message)"
        case .projectNotFound:
            return "项目不存在"
        case .fileNotFound:
            return "文件不存在"
        case .syncFailed(let message):
            return "同步失败: \(message)"
        }
    }
}
