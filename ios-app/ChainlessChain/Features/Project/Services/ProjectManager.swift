import Foundation
import CoreCommon

/// 项目管理器
/// 负责项目的业务逻辑处理
/// Reference: desktop-app-vue/src/main/project/project-manager.js
@MainActor
class ProjectManager: ObservableObject {
    // MARK: - Singleton

    static let shared = ProjectManager()

    // MARK: - Dependencies

    private let repository = ProjectRepository.shared
    private let logger = Logger.shared

    // MARK: - Published Properties

    @Published var projects: [ProjectEntity] = []
    @Published var currentProject: ProjectEntity?
    @Published var currentFiles: [ProjectFileEntity] = []
    @Published var statistics: ProjectStatistics?
    @Published var isLoading = false
    @Published var error: String?

    // MARK: - Configuration

    private let maxProjectNameLength = 100
    private let maxDescriptionLength = 1000

    private init() {
        loadProjects()
        loadStatistics()
    }

    // MARK: - Project Operations

    /// 加载所有项目
    func loadProjects(status: ProjectStatus? = nil, type: ProjectType? = nil) {
        isLoading = true
        error = nil

        do {
            projects = try repository.getAllProjects(status: status, type: type)
            logger.info("Loaded \(projects.count) projects", category: "Project")
        } catch {
            self.error = error.localizedDescription
            logger.error("Failed to load projects", error: error, category: "Project")
        }

        isLoading = false
    }

    /// 搜索项目
    func searchProjects(query: String) {
        guard !query.isEmpty else {
            loadProjects()
            return
        }

        isLoading = true
        error = nil

        do {
            projects = try repository.searchProjects(query: query)
            logger.info("Found \(projects.count) projects matching '\(query)'", category: "Project")
        } catch {
            self.error = error.localizedDescription
            logger.error("Failed to search projects", error: error, category: "Project")
        }

        isLoading = false
    }

    /// 创建新项目
    func createProject(
        name: String,
        description: String? = nil,
        type: ProjectType = .document,
        tags: [String] = []
    ) throws -> ProjectEntity {
        // Validate input
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            throw ProjectError.invalidInput("项目名称不能为空")
        }
        guard trimmedName.count <= maxProjectNameLength else {
            throw ProjectError.invalidInput("项目名称不能超过\(maxProjectNameLength)个字符")
        }

        if let desc = description, desc.count > maxDescriptionLength {
            throw ProjectError.invalidInput("项目描述不能超过\(maxDescriptionLength)个字符")
        }

        // Create project entity
        let tagsJson = tags.isEmpty ? nil : try? String(data: JSONEncoder().encode(tags), encoding: .utf8)

        let project = ProjectEntity(
            name: trimmedName,
            description: description,
            type: type,
            tagsJson: tagsJson
        )

        try repository.createProject(project)

        // Refresh list
        loadProjects()
        loadStatistics()

        logger.info("Created project: \(project.name)", category: "Project")
        return project
    }

    /// 更新项目
    func updateProject(_ project: ProjectEntity) throws {
        try repository.updateProject(project)

        // Update local cache
        if let index = projects.firstIndex(where: { $0.id == project.id }) {
            projects[index] = project
        }

        if currentProject?.id == project.id {
            currentProject = project
        }

        logger.info("Updated project: \(project.name)", category: "Project")
    }

    /// 更新项目状态
    func updateProjectStatus(projectId: String, status: ProjectStatus) throws {
        try repository.updateProjectStatus(id: projectId, status: status)

        // Update local cache
        if let index = projects.firstIndex(where: { $0.id == projectId }) {
            projects[index].status = status
        }

        if currentProject?.id == projectId {
            currentProject?.status = status
        }

        loadStatistics()
        logger.info("Updated project status to: \(status.displayName)", category: "Project")
    }

    /// 删除项目
    func deleteProject(projectId: String) throws {
        try repository.deleteProject(id: projectId)

        // Update local cache
        projects.removeAll { $0.id == projectId }

        if currentProject?.id == projectId {
            currentProject = nil
            currentFiles = []
        }

        loadStatistics()
        logger.info("Deleted project: \(projectId)", category: "Project")
    }

    /// 选择项目
    func selectProject(_ project: ProjectEntity) {
        currentProject = project
        loadProjectFiles(projectId: project.id)
    }

    /// 清除当前选择
    func clearSelection() {
        currentProject = nil
        currentFiles = []
    }

    // MARK: - File Operations

    /// 加载项目文件
    func loadProjectFiles(projectId: String, parentId: String? = nil) {
        do {
            currentFiles = try repository.getProjectFiles(projectId: projectId, parentId: parentId)
            logger.debug("Loaded \(currentFiles.count) files for project: \(projectId)")
        } catch {
            self.error = error.localizedDescription
            logger.error("Failed to load project files", error: error, category: "Project")
        }
    }

    /// 创建文件
    func createFile(
        projectId: String,
        name: String,
        type: String,
        content: String? = nil,
        parentId: String? = nil,
        isDirectory: Bool = false
    ) throws -> ProjectFileEntity {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            throw ProjectError.invalidInput("文件名不能为空")
        }

        // Validate file name for path traversal attacks
        let sanitizedName = try sanitizeFileName(trimmedName)

        let path: String
        if let parentId = parentId {
            // Validate parentId as well
            guard !parentId.contains("..") && !parentId.contains("/..") else {
                throw ProjectError.invalidInput("无效的父目录")
            }
            path = "\(parentId)/\(sanitizedName)"
        } else {
            path = sanitizedName
        }

        let file = ProjectFileEntity(
            projectId: projectId,
            name: sanitizedName,
            path: path,
            type: type,
            size: Int64(content?.utf8.count ?? 0),
            content: content,
            isDirectory: isDirectory,
            parentId: parentId
        )

        try repository.createProjectFile(file)

        // Refresh file list
        loadProjectFiles(projectId: projectId, parentId: parentId)

        // Log activity
        try repository.logActivity(
            projectId: projectId,
            action: "file_add",
            description: "添加文件: \(sanitizedName)"
        )

        logger.info("Created file: \(sanitizedName) in project: \(projectId)", category: "Project")
        return file
    }

    /// Sanitize file name to prevent path traversal attacks
    private func sanitizeFileName(_ name: String) throws -> String {
        // Check for path traversal patterns
        guard !name.contains("..") else {
            throw ProjectError.invalidInput("文件名不能包含 '..'")
        }

        // Check for absolute paths or directory separators
        guard !name.contains("/") && !name.contains("\\") else {
            throw ProjectError.invalidInput("文件名不能包含路径分隔符")
        }

        // Check for null bytes
        guard !name.contains("\0") else {
            throw ProjectError.invalidInput("文件名包含无效字符")
        }

        // Remove leading/trailing dots to prevent hidden files or special paths
        let sanitized = name.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !sanitized.isEmpty else {
            throw ProjectError.invalidInput("文件名无效")
        }

        return name
    }

    /// 更新文件内容
    func updateFileContent(file: ProjectFileEntity, content: String) throws {
        var updatedFile = file
        updatedFile.content = content
        updatedFile.size = Int64(content.utf8.count)

        try repository.updateProjectFile(updatedFile)

        // Refresh file list
        loadProjectFiles(projectId: file.projectId, parentId: file.parentId)

        logger.info("Updated file content: \(file.name)", category: "Project")
    }

    /// 删除文件
    func deleteFile(_ file: ProjectFileEntity) throws {
        try repository.deleteProjectFile(id: file.id, projectId: file.projectId)

        // Log activity
        try repository.logActivity(
            projectId: file.projectId,
            action: "file_delete",
            description: "删除文件: \(file.name)"
        )

        // Refresh file list
        loadProjectFiles(projectId: file.projectId, parentId: file.parentId)

        logger.info("Deleted file: \(file.name)", category: "Project")
    }

    // MARK: - Statistics

    /// 加载统计数据
    func loadStatistics() {
        do {
            statistics = try repository.getStatistics()
        } catch {
            logger.error("Failed to load project statistics", error: error, category: "Project")
        }
    }

    // MARK: - Activity

    /// 获取项目活动历史
    func getProjectActivities(projectId: String) -> [ProjectActivityEntity] {
        do {
            return try repository.getProjectActivities(projectId: projectId)
        } catch {
            logger.error("Failed to load project activities", error: error, category: "Project")
            return []
        }
    }

    // MARK: - Sharing

    /// 生成分享链接
    func generateShareToken(projectId: String) throws -> String {
        guard var project = try repository.getProject(id: projectId) else {
            throw ProjectError.projectNotFound
        }

        let token = UUID().uuidString
        project.isShared = true
        project.shareToken = token

        try repository.updateProject(project)

        // Update local cache
        if let index = projects.firstIndex(where: { $0.id == projectId }) {
            projects[index] = project
        }

        if currentProject?.id == projectId {
            currentProject = project
        }

        try repository.logActivity(
            projectId: projectId,
            action: "share",
            description: "生成分享链接"
        )

        logger.info("Generated share token for project: \(projectId)", category: "Project")
        return token
    }

    /// 取消分享
    func cancelShare(projectId: String) throws {
        guard var project = try repository.getProject(id: projectId) else {
            throw ProjectError.projectNotFound
        }

        project.isShared = false
        project.shareToken = nil

        try repository.updateProject(project)

        // Update local cache
        if let index = projects.firstIndex(where: { $0.id == projectId }) {
            projects[index] = project
        }

        if currentProject?.id == projectId {
            currentProject = project
        }

        logger.info("Cancelled share for project: \(projectId)", category: "Project")
    }

    // MARK: - Templates

    /// 从模板创建项目
    func createFromTemplate(templateId: String, name: String) throws -> ProjectEntity {
        // TODO: Implement template system
        // For now, just create a basic project
        return try createProject(name: name, type: .document)
    }

    // MARK: - Export

    /// 导出项目数据
    func exportProject(projectId: String) throws -> Data {
        guard let project = try repository.getProject(id: projectId) else {
            throw ProjectError.projectNotFound
        }

        let files = try repository.getProjectFiles(projectId: projectId)
        let activities = try repository.getProjectActivities(projectId: projectId)

        let exportData = ProjectExportData(
            project: project,
            files: files,
            activities: activities,
            exportedAt: Date()
        )

        return try JSONEncoder().encode(exportData)
    }
}

// MARK: - Export Data Structure

struct ProjectExportData: Codable {
    let project: ProjectEntity
    let files: [ProjectFileEntity]
    let activities: [ProjectActivityEntity]
    let exportedAt: Date
}

// Make entities Codable for export
extension ProjectEntity: Codable {}
extension ProjectFileEntity: Codable {}
extension ProjectActivityEntity: Codable {}
extension ProjectType: Codable {}
extension ProjectStatus: Codable {}
extension SyncStatus: Codable {}
