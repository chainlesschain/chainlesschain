import Foundation
import Combine
import CoreCommon

/// 文件树视图模型
/// 管理文件树的展开、选择、操作等状态
@MainActor
class FileTreeViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var fileTree: [FileTreeNode] = []
    @Published var expandedNodes: Set<String> = []
    @Published var selectedFile: ProjectFileEntity?
    @Published var isLoading: Bool = false
    @Published var error: String?
    @Published var gitStatus: GitStatus?

    // MARK: - Edit Mode

    @Published var isEditing: Bool = false
    @Published var editingFileId: String?
    @Published var editingFileName: String = ""

    // MARK: - Dependencies

    private let projectManager = ProjectManager.shared
    private let gitManager = GitManager.shared
    private let logger = Logger.shared
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Project Context

    let projectId: String

    // MARK: - Initialization

    init(projectId: String) {
        self.projectId = projectId
        loadFileTree()
        loadGitStatus()
        setupBindings()
    }

    // MARK: - Public Methods

    /// 加载文件树
    func loadFileTree() {
        isLoading = true
        error = nil

        do {
            fileTree = try projectManager.getFileTree(projectId: projectId)
            logger.info("Loaded file tree with \(fileTree.count) root items", category: "FileTree")
        } catch {
            self.error = error.localizedDescription
            logger.error("Failed to load file tree", error: error, category: "FileTree")
        }

        isLoading = false
    }

    /// 加载Git状态
    func loadGitStatus() {
        do {
            gitStatus = try gitManager.getStatus(projectId: projectId)
        } catch {
            // Git may not be initialized, which is fine
            logger.debug("Git status not available: \(error.localizedDescription)", category: "FileTree")
        }
    }

    /// 切换节点展开状态
    func toggleExpanded(_ nodeId: String) {
        if expandedNodes.contains(nodeId) {
            expandedNodes.remove(nodeId)
        } else {
            expandedNodes.insert(nodeId)
        }
    }

    /// 展开节点
    func expand(_ nodeId: String) {
        expandedNodes.insert(nodeId)
    }

    /// 折叠节点
    func collapse(_ nodeId: String) {
        expandedNodes.remove(nodeId)
    }

    /// 展开所有节点
    func expandAll() {
        func collectIds(_ nodes: [FileTreeNode]) {
            for node in nodes where node.isDirectory {
                expandedNodes.insert(node.id)
                collectIds(node.children)
            }
        }
        collectIds(fileTree)
    }

    /// 折叠所有节点
    func collapseAll() {
        expandedNodes.removeAll()
    }

    /// 选择文件
    func selectFile(_ file: ProjectFileEntity) {
        selectedFile = file
        logger.debug("Selected file: \(file.name)", category: "FileTree")
    }

    /// 创建新文件
    func createFile(name: String, parentId: String? = nil) async throws {
        _ = try projectManager.createFile(
            projectId: projectId,
            name: name,
            type: getFileType(from: name),
            content: "",
            parentId: parentId
        )
        loadFileTree()
        loadGitStatus()
    }

    /// 创建新文件夹
    func createFolder(name: String, parentId: String? = nil) async throws {
        _ = try projectManager.createFolder(
            projectId: projectId,
            name: name,
            parentId: parentId
        )
        loadFileTree()
    }

    /// 重命名文件/文件夹
    func renameFile(fileId: String, newName: String) async throws {
        try projectManager.renameFile(fileId: fileId, newName: newName)
        loadFileTree()
        loadGitStatus()

        // Update selection if renamed file was selected
        if selectedFile?.id == fileId {
            selectedFile?.name = newName
        }
    }

    /// 删除文件/文件夹
    func deleteFile(fileId: String) async throws {
        try projectManager.deleteFile(fileId: fileId)

        // Clear selection if deleted file was selected
        if selectedFile?.id == fileId {
            selectedFile = nil
        }

        loadFileTree()
        loadGitStatus()
    }

    /// 移动文件/文件夹
    func moveFile(fileId: String, toParentId: String?) async throws {
        try projectManager.moveFile(fileId: fileId, targetParentId: toParentId)
        loadFileTree()
    }

    /// 复制文件
    func copyFile(fileId: String, toParentId: String?) async throws {
        try projectManager.copyFile(fileId: fileId, targetParentId: toParentId)
        loadFileTree()
    }

    /// 开始编辑文件名
    func startRenaming(file: ProjectFileEntity) {
        editingFileId = file.id
        editingFileName = file.name
        isEditing = true
    }

    /// 取消编辑
    func cancelRenaming() {
        editingFileId = nil
        editingFileName = ""
        isEditing = false
    }

    /// 确认重命名
    func confirmRenaming() async {
        guard let fileId = editingFileId,
              !editingFileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            cancelRenaming()
            return
        }

        do {
            try await renameFile(fileId: fileId, newName: editingFileName.trimmingCharacters(in: .whitespacesAndNewlines))
        } catch {
            self.error = error.localizedDescription
        }

        cancelRenaming()
    }

    // MARK: - Git Status Helpers

    /// 获取文件的Git状态
    func getGitState(for path: String) -> GitFileState? {
        guard let status = gitStatus else { return nil }

        // Check staged
        if let staged = status.staged.first(where: { $0.path == path }) {
            return staged.status
        }

        // Check unstaged
        if let unstaged = status.unstaged.first(where: { $0.path == path }) {
            return unstaged.status
        }

        // Check untracked
        if status.untracked.contains(path) {
            return .added
        }

        // Check conflicts
        if status.conflicts.contains(path) {
            return nil // Special case for conflicts
        }

        return nil
    }

    /// 检查文件是否有冲突
    func hasConflict(path: String) -> Bool {
        gitStatus?.conflicts.contains(path) ?? false
    }

    // MARK: - Private Methods

    private func setupBindings() {
        // Listen to project manager's currentFiles updates
        projectManager.$currentFiles
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.loadFileTree()
            }
            .store(in: &cancellables)
    }

    private func getFileType(from fileName: String) -> String {
        let ext = (fileName as NSString).pathExtension.lowercased()
        return ext.isEmpty ? "txt" : ext
    }

    // MARK: - File Type Helpers

    /// 获取文件图标
    func getFileIcon(for file: ProjectFileEntity) -> String {
        if file.isDirectory {
            return "folder.fill"
        }

        let ext = (file.name as NSString).pathExtension.lowercased()

        switch ext {
        // Markdown
        case "md", "markdown":
            return "doc.text"
        // Code files
        case "swift":
            return "swift"
        case "kt", "java":
            return "chevron.left.forwardslash.chevron.right"
        case "js", "ts", "jsx", "tsx":
            return "curlybraces"
        case "py":
            return "terminal"
        case "html", "htm":
            return "globe"
        case "css", "scss", "sass":
            return "paintbrush"
        case "json":
            return "curlybraces.square"
        case "xml", "yaml", "yml":
            return "doc.badge.gearshape"
        // Documents
        case "pdf":
            return "doc.richtext"
        case "doc", "docx":
            return "doc.fill"
        case "xls", "xlsx":
            return "tablecells"
        case "ppt", "pptx":
            return "rectangle.stack"
        case "txt":
            return "doc.plaintext"
        // Images
        case "png", "jpg", "jpeg", "gif", "webp", "svg":
            return "photo"
        // Media
        case "mp3", "wav", "m4a":
            return "music.note"
        case "mp4", "mov", "avi":
            return "film"
        // Archives
        case "zip", "rar", "7z", "tar", "gz":
            return "doc.zipper"
        default:
            return "doc"
        }
    }

    /// 获取文件图标颜色
    func getFileIconColor(for file: ProjectFileEntity) -> String {
        if file.isDirectory {
            return "folder"
        }

        let ext = (file.name as NSString).pathExtension.lowercased()

        switch ext {
        case "md", "markdown":
            return "markdown"
        case "swift":
            return "swift"
        case "js", "ts", "jsx", "tsx":
            return "javascript"
        case "py":
            return "python"
        case "html", "htm":
            return "html"
        case "css", "scss", "sass":
            return "css"
        case "json":
            return "json"
        case "pdf":
            return "pdf"
        case "png", "jpg", "jpeg", "gif", "webp", "svg":
            return "image"
        default:
            return "default"
        }
    }
}

// MARK: - Color Extension

import SwiftUI

extension Color {
    static func fileIconColor(_ type: String) -> Color {
        switch type {
        case "folder":
            return .yellow
        case "markdown":
            return .blue
        case "swift":
            return .orange
        case "javascript":
            return .yellow
        case "python":
            return .green
        case "html":
            return .red
        case "css":
            return .blue
        case "json":
            return .purple
        case "pdf":
            return .red
        case "image":
            return .green
        default:
            return .gray
        }
    }
}
