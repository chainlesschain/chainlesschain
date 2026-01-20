import Foundation
import CoreCommon

/// 同步状态
enum SyncStatus: String, Codable {
    case idle = "idle"
    case syncing = "syncing"
    case synced = "synced"
    case pending = "pending"
    case failed = "failed"
    case conflict = "conflict"
}

/// 同步结果
struct SyncResult {
    let projectId: String
    let success: Bool
    let error: String?
    let timestamp: Date
}

/// 批量同步结果
struct BatchSyncResult {
    let succeeded: [String]
    let failed: [(projectId: String, error: String)]
    let skipped: [String]
    let timestamp: Date
}

/// 恢复项目信息
struct RecoverableProject: Identifiable, Codable {
    let id: String
    let name: String
    let lastModified: Date
    let fileCount: Int
    let totalSize: Int64
    let reason: RecoveryReason
}

/// 恢复原因
enum RecoveryReason: String, Codable {
    case deleted = "deleted"
    case corrupted = "corrupted"
    case orphaned = "orphaned"
    case incomplete = "incomplete"
}

/// 恢复统计
struct RecoveryStats: Codable {
    let totalRecoverable: Int
    let byReason: [String: Int]
    let totalSize: Int64
    let lastScanTime: Date?
}

/// 同步配置
struct SyncConfig: Codable {
    var autoSyncEnabled: Bool
    var autoSyncInterval: TimeInterval  // seconds
    var wifiOnlySync: Bool
    var syncOnLaunch: Bool
    var conflictResolution: ConflictResolution
    var backendUrl: String?

    static var `default`: SyncConfig {
        SyncConfig(
            autoSyncEnabled: false,
            autoSyncInterval: 300,  // 5 minutes
            wifiOnlySync: true,
            syncOnLaunch: true,
            conflictResolution: .serverWins,
            backendUrl: nil
        )
    }
}

/// 冲突解决策略
enum ConflictResolution: String, Codable {
    case serverWins = "server_wins"
    case localWins = "local_wins"
    case manual = "manual"
    case newest = "newest"
}

/// 同步冲突
struct SyncConflict: Identifiable {
    let id: String
    let projectId: String
    let localVersion: ProjectEntity
    let serverVersion: ProjectEntity
    let timestamp: Date
}

/// 同步管理器
/// 负责项目的云端同步和本地恢复
/// Reference: desktop-app-vue/src/main/project/project-core-ipc.js (sync operations)
@MainActor
class SyncManager: ObservableObject {
    // MARK: - Singleton

    static let shared = SyncManager()

    // MARK: - Dependencies

    private let repository = ProjectRepository.shared
    private let logger = Logger.shared
    private let fileManager = FileManager.default

    // MARK: - Published Properties

    @Published var syncStatus: SyncStatus = .idle
    @Published var lastSyncTime: Date?
    @Published var syncProgress: Double = 0.0
    @Published var pendingChanges: Int = 0
    @Published var conflicts: [SyncConflict] = []
    @Published var recoverableProjects: [RecoverableProject] = []
    @Published var error: String?

    // MARK: - Configuration

    private var config: SyncConfig = .default
    private var autoSyncTimer: Timer?
    private let configPath: URL

    // MARK: - Backup Storage

    private var backupPath: URL {
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documentsPath.appendingPathComponent("project-backups")
    }

    private var deletedProjectsPath: URL {
        backupPath.appendingPathComponent("deleted")
    }

    private init() {
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        configPath = documentsPath.appendingPathComponent("sync-config.json")

        loadConfig()
        setupBackupDirectory()

        if config.syncOnLaunch {
            Task {
                await refreshPendingChanges()
            }
        }
    }

    // MARK: - Sync Operations (2 operations)

    /// 同步所有项目
    /// Reference: project:sync handler
    func syncAll(userId: String? = nil) async throws -> BatchSyncResult {
        guard syncStatus != .syncing else {
            throw SyncError.alreadySyncing
        }

        syncStatus = .syncing
        syncProgress = 0.0
        error = nil

        logger.info("Starting full project sync", category: "Sync")

        var succeeded: [String] = []
        var failed: [(String, String)] = []
        var skipped: [String] = []

        do {
            // 1. Get local projects
            let localProjects = try repository.getAllProjects()
            let totalProjects = localProjects.count

            // 2. Sync each project
            for (index, project) in localProjects.enumerated() {
                syncProgress = Double(index + 1) / Double(max(totalProjects, 1))

                // Check if project needs syncing
                if project.syncStatus == "synced" && !hasLocalChanges(project: project) {
                    skipped.append(project.id)
                    continue
                }

                do {
                    try await syncProject(projectId: project.id)
                    succeeded.append(project.id)
                } catch {
                    failed.append((project.id, error.localizedDescription))
                }
            }

            // 3. Update sync status
            syncStatus = .synced
            lastSyncTime = Date()
            syncProgress = 1.0

            logger.info("Sync completed: \(succeeded.count) succeeded, \(failed.count) failed, \(skipped.count) skipped", category: "Sync")

        } catch {
            syncStatus = .failed
            self.error = error.localizedDescription
            throw error
        }

        await refreshPendingChanges()

        return BatchSyncResult(
            succeeded: succeeded,
            failed: failed,
            skipped: skipped,
            timestamp: Date()
        )
    }

    /// 同步单个项目
    /// Reference: project:sync-one handler
    func syncProject(projectId: String) async throws {
        logger.info("Syncing project: \(projectId)", category: "Sync")

        guard let project = try repository.getProjectById(projectId) else {
            throw SyncError.projectNotFound
        }

        // Check for backend connectivity
        guard let backendUrl = config.backendUrl, !backendUrl.isEmpty else {
            // No backend configured, mark as pending
            try repository.updateProject(projectId, updates: ["sync_status": "pending"])
            throw SyncError.noBackendConfigured
        }

        // In a real implementation, this would call the backend API
        // For now, simulate the sync process
        try await Task.sleep(nanoseconds: 200_000_000)

        // Update sync status
        try repository.updateProject(projectId, updates: [
            "sync_status": "synced",
            "synced_at": Date().timeIntervalSince1970 * 1000
        ])

        logger.info("Project \(projectId) synced successfully", category: "Sync")
    }

    /// 标记项目为待同步
    func markForSync(projectId: String) throws {
        try repository.updateProject(projectId, updates: [
            "sync_status": "pending"
        ])
        pendingChanges += 1
    }

    // MARK: - Recovery Operations (5 operations)

    /// 扫描可恢复的项目
    /// Reference: project:scan-recoverable handler
    func scanRecoverableProjects() throws -> [RecoverableProject] {
        logger.info("Scanning for recoverable projects", category: "Sync")

        var recoverable: [RecoverableProject] = []

        // Scan deleted projects backup
        if fileManager.fileExists(atPath: deletedProjectsPath.path) {
            let contents = try fileManager.contentsOfDirectory(
                at: deletedProjectsPath,
                includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]
            )

            for folder in contents {
                let metadataPath = folder.appendingPathComponent("metadata.json")
                if let data = try? Data(contentsOf: metadataPath),
                   let metadata = try? JSONDecoder().decode(DeletedProjectMetadata.self, from: data) {

                    let totalSize = try calculateDirectorySize(folder)

                    recoverable.append(RecoverableProject(
                        id: metadata.id,
                        name: metadata.name,
                        lastModified: metadata.deletedAt,
                        fileCount: metadata.fileCount,
                        totalSize: totalSize,
                        reason: .deleted
                    ))
                }
            }
        }

        // Scan for orphaned files (files without parent project)
        let orphanedProjects = try scanOrphanedFiles()
        recoverable.append(contentsOf: orphanedProjects)

        // Scan for incomplete projects (projects with missing data)
        let incompleteProjects = try scanIncompleteProjects()
        recoverable.append(contentsOf: incompleteProjects)

        self.recoverableProjects = recoverable

        logger.info("Found \(recoverable.count) recoverable projects", category: "Sync")

        return recoverable
    }

    /// 恢复单个项目
    /// Reference: project:recover handler
    func recoverProject(projectId: String) throws {
        logger.info("Recovering project: \(projectId)", category: "Sync")

        guard let recoverable = recoverableProjects.first(where: { $0.id == projectId }) else {
            throw SyncError.projectNotRecoverable
        }

        switch recoverable.reason {
        case .deleted:
            try recoverDeletedProject(projectId: projectId)
        case .corrupted:
            try repairCorruptedProject(projectId: projectId)
        case .orphaned:
            try reattachOrphanedFiles(projectId: projectId)
        case .incomplete:
            try completeIncompleteProject(projectId: projectId)
        }

        // Remove from recoverable list
        recoverableProjects.removeAll { $0.id == projectId }

        logger.info("Project \(projectId) recovered successfully", category: "Sync")
    }

    /// 批量恢复项目
    /// Reference: project:recover-batch handler
    func recoverProjects(projectIds: [String]) throws -> BatchSyncResult {
        logger.info("Batch recovering \(projectIds.count) projects", category: "Sync")

        var succeeded: [String] = []
        var failed: [(String, String)] = []

        for projectId in projectIds {
            do {
                try recoverProject(projectId: projectId)
                succeeded.append(projectId)
            } catch {
                failed.append((projectId, error.localizedDescription))
            }
        }

        return BatchSyncResult(
            succeeded: succeeded,
            failed: failed,
            skipped: [],
            timestamp: Date()
        )
    }

    /// 自动恢复所有可恢复的项目
    /// Reference: project:auto-recover handler
    func autoRecoverAll() throws -> BatchSyncResult {
        logger.info("Auto-recovering all projects", category: "Sync")

        _ = try scanRecoverableProjects()

        let projectIds = recoverableProjects.map { $0.id }
        return try recoverProjects(projectIds: projectIds)
    }

    /// 获取恢复统计信息
    /// Reference: project:recovery-stats handler
    func getRecoveryStats() throws -> RecoveryStats {
        _ = try scanRecoverableProjects()

        var byReason: [String: Int] = [:]
        var totalSize: Int64 = 0

        for project in recoverableProjects {
            byReason[project.reason.rawValue, default: 0] += 1
            totalSize += project.totalSize
        }

        return RecoveryStats(
            totalRecoverable: recoverableProjects.count,
            byReason: byReason,
            totalSize: totalSize,
            lastScanTime: Date()
        )
    }

    // MARK: - Backup Operations

    /// 备份项目（删除前调用）
    func backupProject(_ project: ProjectEntity) throws {
        logger.info("Backing up project: \(project.id)", category: "Sync")

        let projectBackupPath = deletedProjectsPath.appendingPathComponent(project.id)
        try fileManager.createDirectory(at: projectBackupPath, withIntermediateDirectories: true)

        // Save project metadata
        let metadata = DeletedProjectMetadata(
            id: project.id,
            name: project.name,
            deletedAt: Date(),
            fileCount: project.fileCount ?? 0,
            originalData: try JSONEncoder().encode(project)
        )

        let metadataData = try JSONEncoder().encode(metadata)
        try metadataData.write(to: projectBackupPath.appendingPathComponent("metadata.json"))

        // Backup project files
        let files = try repository.getProjectFiles(projectId: project.id)
        let filesData = try JSONEncoder().encode(files)
        try filesData.write(to: projectBackupPath.appendingPathComponent("files.json"))

        logger.info("Project \(project.id) backed up successfully", category: "Sync")
    }

    /// 清理过期备份
    func cleanupOldBackups(olderThan days: Int = 30) throws {
        logger.info("Cleaning up backups older than \(days) days", category: "Sync")

        let cutoffDate = Calendar.current.date(byAdding: .day, value: -days, to: Date())!

        if fileManager.fileExists(atPath: deletedProjectsPath.path) {
            let contents = try fileManager.contentsOfDirectory(at: deletedProjectsPath, includingPropertiesForKeys: nil)

            for folder in contents {
                let metadataPath = folder.appendingPathComponent("metadata.json")
                if let data = try? Data(contentsOf: metadataPath),
                   let metadata = try? JSONDecoder().decode(DeletedProjectMetadata.self, from: data),
                   metadata.deletedAt < cutoffDate {
                    try fileManager.removeItem(at: folder)
                    logger.info("Removed old backup: \(metadata.name)", category: "Sync")
                }
            }
        }
    }

    // MARK: - Conflict Resolution

    /// 解决同步冲突
    func resolveConflict(conflictId: String, resolution: ConflictResolution) throws {
        guard let conflict = conflicts.first(where: { $0.id == conflictId }) else {
            throw SyncError.conflictNotFound
        }

        switch resolution {
        case .serverWins:
            // Overwrite local with server version
            try repository.updateProject(conflict.projectId, from: conflict.serverVersion)
        case .localWins:
            // Keep local, mark for sync to push to server
            try markForSync(projectId: conflict.projectId)
        case .newest:
            // Use the most recently modified version
            let localTime = conflict.localVersion.updatedAt ?? 0
            let serverTime = conflict.serverVersion.updatedAt ?? 0
            if serverTime > localTime {
                try repository.updateProject(conflict.projectId, from: conflict.serverVersion)
            } else {
                try markForSync(projectId: conflict.projectId)
            }
        case .manual:
            // Leave for user to handle
            break
        }

        conflicts.removeAll { $0.id == conflictId }
    }

    // MARK: - Auto Sync

    /// 启动自动同步
    func startAutoSync() {
        guard config.autoSyncEnabled else { return }

        stopAutoSync()

        autoSyncTimer = Timer.scheduledTimer(withTimeInterval: config.autoSyncInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                try? await self?.syncAll()
            }
        }

        logger.info("Auto sync started with interval: \(config.autoSyncInterval)s", category: "Sync")
    }

    /// 停止自动同步
    func stopAutoSync() {
        autoSyncTimer?.invalidate()
        autoSyncTimer = nil
    }

    // MARK: - Configuration

    /// 更新同步配置
    func updateConfig(_ newConfig: SyncConfig) throws {
        config = newConfig
        try saveConfig()

        if config.autoSyncEnabled {
            startAutoSync()
        } else {
            stopAutoSync()
        }
    }

    /// 获取当前配置
    func getConfig() -> SyncConfig {
        config
    }

    // MARK: - Private Helpers

    private func setupBackupDirectory() {
        try? fileManager.createDirectory(at: backupPath, withIntermediateDirectories: true)
        try? fileManager.createDirectory(at: deletedProjectsPath, withIntermediateDirectories: true)
    }

    private func loadConfig() {
        guard let data = try? Data(contentsOf: configPath),
              let savedConfig = try? JSONDecoder().decode(SyncConfig.self, from: data) else {
            return
        }
        config = savedConfig
    }

    private func saveConfig() throws {
        let data = try JSONEncoder().encode(config)
        try data.write(to: configPath)
    }

    private func hasLocalChanges(project: ProjectEntity) -> Bool {
        // Check if project has been modified since last sync
        guard let syncedAt = project.syncedAt,
              let updatedAt = project.updatedAt else {
            return true
        }
        return updatedAt > syncedAt
    }

    private func refreshPendingChanges() async {
        do {
            let projects = try repository.getAllProjects()
            pendingChanges = projects.filter { $0.syncStatus == "pending" }.count
        } catch {
            logger.error("Failed to refresh pending changes", error: error, category: "Sync")
        }
    }

    private func calculateDirectorySize(_ url: URL) throws -> Int64 {
        var totalSize: Int64 = 0

        let resourceKeys: Set<URLResourceKey> = [.fileSizeKey, .isDirectoryKey]
        let enumerator = fileManager.enumerator(at: url, includingPropertiesForKeys: Array(resourceKeys))

        while let fileURL = enumerator?.nextObject() as? URL {
            let resourceValues = try fileURL.resourceValues(forKeys: resourceKeys)
            if resourceValues.isDirectory == false {
                totalSize += Int64(resourceValues.fileSize ?? 0)
            }
        }

        return totalSize
    }

    private func scanOrphanedFiles() throws -> [RecoverableProject] {
        // Scan for files that reference non-existent projects
        // This is a simplified implementation
        return []
    }

    private func scanIncompleteProjects() throws -> [RecoverableProject] {
        // Scan for projects with missing essential data
        // This is a simplified implementation
        return []
    }

    private func recoverDeletedProject(projectId: String) throws {
        let projectBackupPath = deletedProjectsPath.appendingPathComponent(projectId)
        let metadataPath = projectBackupPath.appendingPathComponent("metadata.json")
        let filesPath = projectBackupPath.appendingPathComponent("files.json")

        guard let metadataData = try? Data(contentsOf: metadataPath),
              let metadata = try? JSONDecoder().decode(DeletedProjectMetadata.self, from: metadataData) else {
            throw SyncError.backupCorrupted
        }

        // Restore project
        let project = try JSONDecoder().decode(ProjectEntity.self, from: metadata.originalData)
        _ = try repository.createProject(
            name: project.name,
            description: project.description,
            type: ProjectType(rawValue: project.projectType ?? "document") ?? .document,
            tags: project.tagsList
        )

        // Restore files
        if let filesData = try? Data(contentsOf: filesPath),
           let files = try? JSONDecoder().decode([ProjectFileEntity].self, from: filesData) {
            for file in files {
                _ = try? repository.createProjectFile(
                    projectId: projectId,
                    name: file.name,
                    type: file.type,
                    content: file.content,
                    parentId: file.parentId
                )
            }
        }

        // Remove backup
        try fileManager.removeItem(at: projectBackupPath)
    }

    private func repairCorruptedProject(projectId: String) throws {
        // Attempt to repair corrupted project data
        // This is a simplified implementation
        throw SyncError.notImplemented
    }

    private func reattachOrphanedFiles(projectId: String) throws {
        // Reattach orphaned files to their parent project
        // This is a simplified implementation
        throw SyncError.notImplemented
    }

    private func completeIncompleteProject(projectId: String) throws {
        // Complete projects with missing essential data
        // This is a simplified implementation
        throw SyncError.notImplemented
    }
}

// MARK: - Supporting Types

private struct DeletedProjectMetadata: Codable {
    let id: String
    let name: String
    let deletedAt: Date
    let fileCount: Int
    let originalData: Data
}

// MARK: - Sync Errors

enum SyncError: LocalizedError {
    case alreadySyncing
    case projectNotFound
    case noBackendConfigured
    case networkError(String)
    case conflictDetected
    case conflictNotFound
    case projectNotRecoverable
    case backupCorrupted
    case notImplemented

    var errorDescription: String? {
        switch self {
        case .alreadySyncing:
            return "同步正在进行中"
        case .projectNotFound:
            return "项目不存在"
        case .noBackendConfigured:
            return "未配置后端服务器"
        case .networkError(let message):
            return "网络错误: \(message)"
        case .conflictDetected:
            return "检测到同步冲突"
        case .conflictNotFound:
            return "找不到冲突记录"
        case .projectNotRecoverable:
            return "项目不可恢复"
        case .backupCorrupted:
            return "备份文件已损坏"
        case .notImplemented:
            return "功能尚未实现"
        }
    }
}

// MARK: - ProjectEntity Extension

extension ProjectEntity {
    var syncStatus: String? {
        metadata?["sync_status"]
    }

    var syncedAt: TimeInterval? {
        guard let value = metadata?["synced_at"] else { return nil }
        return TimeInterval(value)
    }
}

// MARK: - ProjectRepository Extension

extension ProjectRepository {
    func updateProject(_ projectId: String, from entity: ProjectEntity) throws {
        try updateProject(projectId, updates: [
            "name": entity.name,
            "description": entity.description ?? "",
            "project_type": entity.projectType ?? "document",
            "status": entity.status ?? "active",
            "tags": entity.tags ?? "[]"
        ])
    }
}
