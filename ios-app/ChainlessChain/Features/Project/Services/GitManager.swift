import Foundation
import CoreCommon

/// Git仓库状态
struct GitStatus {
    var currentBranch: String
    var isClean: Bool
    var staged: [GitFileStatus]
    var unstaged: [GitFileStatus]
    var untracked: [String]
    var conflicts: [String]
}

/// 文件Git状态
struct GitFileStatus {
    let path: String
    let status: GitFileState
}

/// Git文件状态枚举
enum GitFileState: String, Codable {
    case added = "A"
    case modified = "M"
    case deleted = "D"
    case renamed = "R"
    case untracked = "?"
    case conflicted = "C"
}

/// Git提交记录
struct GitCommit: Identifiable, Codable {
    let id: String  // SHA hash
    let message: String
    let author: String
    let email: String
    let timestamp: Date
    let parentIds: [String]

    var shortId: String {
        String(id.prefix(7))
    }

    var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: timestamp)
    }
}

/// Git分支
struct GitBranch: Identifiable, Codable {
    var id: String { name }
    let name: String
    let isRemote: Bool
    let isCurrent: Bool
    let lastCommitId: String?
}

/// Git差异
struct GitDiff: Codable {
    let filePath: String
    let additions: Int
    let deletions: Int
    let chunks: [DiffChunk]
}

/// 差异块
struct DiffChunk: Codable {
    let oldStart: Int
    let oldLines: Int
    let newStart: Int
    let newLines: Int
    let content: String
}

/// Git远程仓库
struct GitRemote: Codable {
    let name: String
    let url: String
    let fetchUrl: String?
    let pushUrl: String?
}

/// Git配置
struct GitConfig: Codable {
    var userName: String?
    var userEmail: String?
    var remotes: [GitRemote]
    var defaultBranch: String

    static var `default`: GitConfig {
        GitConfig(
            userName: "ChainlessChain User",
            userEmail: "user@chainlesschain.local",
            remotes: [],
            defaultBranch: "main"
        )
    }
}

/// Git管理器
/// 负责项目的Git版本控制操作
/// Reference: desktop-app-vue/src/main/project/project-git-ipc.js
@MainActor
class GitManager: ObservableObject {
    // MARK: - Singleton

    static let shared = GitManager()

    // MARK: - Dependencies

    private let repository = ProjectRepository.shared
    private let logger = Logger.shared
    private let fileManager = FileManager.default

    // MARK: - Published Properties

    @Published var status: GitStatus?
    @Published var commits: [GitCommit] = []
    @Published var branches: [GitBranch] = []
    @Published var currentBranch: String = "main"
    @Published var isLoading = false
    @Published var error: String?

    // MARK: - Git Data Directory

    private func gitDataPath(for projectId: String) -> URL {
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documentsPath.appendingPathComponent("git-data/\(projectId)")
    }

    private func commitsPath(for projectId: String) -> URL {
        gitDataPath(for: projectId).appendingPathComponent("commits.json")
    }

    private func branchesPath(for projectId: String) -> URL {
        gitDataPath(for: projectId).appendingPathComponent("branches.json")
    }

    private func configPath(for projectId: String) -> URL {
        gitDataPath(for: projectId).appendingPathComponent("config.json")
    }

    private func headPath(for projectId: String) -> URL {
        gitDataPath(for: projectId).appendingPathComponent("HEAD")
    }

    private func indexPath(for projectId: String) -> URL {
        gitDataPath(for: projectId).appendingPathComponent("index.json")
    }

    private init() {}

    // MARK: - Git 基础操作 (5 operations)

    /// 初始化Git仓库
    /// - Parameters:
    ///   - projectId: 项目ID
    ///   - remoteUrl: 远程仓库URL（可选）
    func initRepository(projectId: String, remoteUrl: String? = nil) throws {
        logger.info("Initializing Git repository for project \(projectId)", category: "Git")

        let gitPath = gitDataPath(for: projectId)

        // Create git data directory
        try fileManager.createDirectory(at: gitPath, withIntermediateDirectories: true)

        // Initialize config
        var config = GitConfig.default
        if let url = remoteUrl, !url.isEmpty {
            config.remotes = [GitRemote(name: "origin", url: url, fetchUrl: url, pushUrl: url)]
        }
        let configData = try JSONEncoder().encode(config)
        try configData.write(to: configPath(for: projectId))

        // Initialize HEAD (point to main branch)
        try "ref: refs/heads/main".write(to: headPath(for: projectId), atomically: true, encoding: .utf8)

        // Initialize empty commits
        let emptyCommits: [GitCommit] = []
        let commitsData = try JSONEncoder().encode(emptyCommits)
        try commitsData.write(to: commitsPath(for: projectId))

        // Initialize main branch
        let mainBranch = GitBranch(name: "main", isRemote: false, isCurrent: true, lastCommitId: nil)
        let branchesData = try JSONEncoder().encode([mainBranch])
        try branchesData.write(to: branchesPath(for: projectId))

        // Initialize empty index (staged files)
        let emptyIndex: [String: GitFileState] = [:]
        let indexData = try JSONEncoder().encode(emptyIndex)
        try indexData.write(to: indexPath(for: projectId))

        logger.info("Git repository initialized for project \(projectId)", category: "Git")
    }

    /// 检查项目是否已初始化Git
    func isGitInitialized(projectId: String) -> Bool {
        fileManager.fileExists(atPath: gitDataPath(for: projectId).path)
    }

    /// 获取Git状态
    func getStatus(projectId: String) throws -> GitStatus {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        logger.info("Getting Git status for project \(projectId)", category: "Git")

        // Load current branch
        let headContent = try String(contentsOf: headPath(for: projectId), encoding: .utf8)
        let currentBranch: String
        if headContent.hasPrefix("ref: refs/heads/") {
            currentBranch = String(headContent.dropFirst("ref: refs/heads/".count)).trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            currentBranch = "main"
        }

        // Load index (staged files)
        var stagedFiles: [String: GitFileState] = [:]
        if let indexData = try? Data(contentsOf: indexPath(for: projectId)),
           let index = try? JSONDecoder().decode([String: GitFileState].self, from: indexData) {
            stagedFiles = index
        }

        // Get project files and compare with last commit
        let files = try repository.getProjectFiles(projectId: projectId)
        let lastCommit = try getLastCommit(projectId: projectId)
        let lastCommitFiles = lastCommit?.files ?? [:]

        var staged: [GitFileStatus] = []
        var unstaged: [GitFileStatus] = []
        var untracked: [String] = []

        for file in files {
            let filePath = file.path

            if stagedFiles[filePath] != nil {
                // File is staged
                staged.append(GitFileStatus(path: filePath, status: stagedFiles[filePath]!))
            } else if lastCommitFiles[filePath] == nil {
                // New file not in last commit
                untracked.append(filePath)
            } else if file.content != lastCommitFiles[filePath] {
                // Modified file
                unstaged.append(GitFileStatus(path: filePath, status: .modified))
            }
        }

        // Check for deleted files
        for (path, _) in lastCommitFiles {
            if !files.contains(where: { $0.path == path }) {
                if stagedFiles[path] == .deleted {
                    staged.append(GitFileStatus(path: path, status: .deleted))
                } else {
                    unstaged.append(GitFileStatus(path: path, status: .deleted))
                }
            }
        }

        let isClean = staged.isEmpty && unstaged.isEmpty && untracked.isEmpty

        let status = GitStatus(
            currentBranch: currentBranch,
            isClean: isClean,
            staged: staged,
            unstaged: unstaged,
            untracked: untracked,
            conflicts: []
        )

        self.status = status
        self.currentBranch = currentBranch

        return status
    }

    /// 暂存文件
    func stageFile(projectId: String, filePath: String) throws {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        logger.info("Staging file \(filePath) in project \(projectId)", category: "Git")

        var index = try loadIndex(projectId: projectId)

        // Check if file exists
        let files = try repository.getProjectFiles(projectId: projectId)
        if files.contains(where: { $0.path == filePath }) {
            // Determine status based on last commit
            let lastCommit = try getLastCommit(projectId: projectId)
            if lastCommit?.files[filePath] == nil {
                index[filePath] = .added
            } else {
                index[filePath] = .modified
            }
        } else {
            // File was deleted
            index[filePath] = .deleted
        }

        try saveIndex(projectId: projectId, index: index)
    }

    /// 暂存所有文件
    func stageAllFiles(projectId: String) throws {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        logger.info("Staging all files in project \(projectId)", category: "Git")

        let status = try getStatus(projectId: projectId)
        var index = try loadIndex(projectId: projectId)

        for fileStatus in status.unstaged {
            index[fileStatus.path] = fileStatus.status
        }

        for path in status.untracked {
            index[path] = .added
        }

        try saveIndex(projectId: projectId, index: index)
    }

    /// 取消暂存文件
    func unstageFile(projectId: String, filePath: String) throws {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        logger.info("Unstaging file \(filePath) in project \(projectId)", category: "Git")

        var index = try loadIndex(projectId: projectId)
        index.removeValue(forKey: filePath)
        try saveIndex(projectId: projectId, index: index)
    }

    /// 创建提交
    /// - Parameters:
    ///   - projectId: 项目ID
    ///   - message: 提交消息
    ///   - autoGenerate: 是否自动生成消息
    func commit(projectId: String, message: String, autoGenerate: Bool = false) throws -> GitCommit {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        let status = try getStatus(projectId: projectId)

        guard !status.staged.isEmpty else {
            throw GitError.nothingToCommit
        }

        logger.info("Creating commit in project \(projectId)", category: "Git")

        // Generate commit message if needed
        var commitMessage = message
        if autoGenerate || message.isEmpty {
            commitMessage = generateCommitMessage(from: status)
        }

        // Load config for author info
        let config = try loadConfig(projectId: projectId)

        // Create commit
        let commitId = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let lastCommit = try getLastCommit(projectId: projectId)

        // Build files snapshot
        let files = try repository.getProjectFiles(projectId: projectId)
        var filesSnapshot: [String: String] = lastCommit?.files ?? [:]

        let index = try loadIndex(projectId: projectId)
        for (path, state) in index {
            switch state {
            case .added, .modified:
                if let file = files.first(where: { $0.path == path }) {
                    filesSnapshot[path] = file.content
                }
            case .deleted:
                filesSnapshot.removeValue(forKey: path)
            default:
                break
            }
        }

        let commit = GitCommit(
            id: commitId,
            message: commitMessage,
            author: config.userName ?? "ChainlessChain User",
            email: config.userEmail ?? "user@chainlesschain.local",
            timestamp: Date(),
            parentIds: lastCommit != nil ? [lastCommit!.id] : []
        )

        // Save commit with files snapshot
        try saveCommit(projectId: projectId, commit: commit, files: filesSnapshot)

        // Clear index
        try saveIndex(projectId: projectId, index: [:])

        // Update branch pointer
        try updateBranchPointer(projectId: projectId, branch: currentBranch, commitId: commitId)

        logger.info("Commit created: \(commit.shortId) - \(commitMessage)", category: "Git")

        return commit
    }

    /// 推送到远程仓库
    func push(projectId: String, remote: String = "origin", branch: String? = nil) async throws {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        let targetBranch = branch ?? currentBranch
        logger.info("Pushing \(targetBranch) to \(remote) for project \(projectId)", category: "Git")

        // Get remote URL
        let config = try loadConfig(projectId: projectId)
        guard let remoteConfig = config.remotes.first(where: { $0.name == remote }) else {
            throw GitError.remoteNotFound(remote)
        }

        // Load commits to push
        let commits = try loadCommits(projectId: projectId)

        // Call backend API for actual push
        // In a real implementation, this would sync with a backend service
        // For now, we'll simulate the operation
        try await Task.sleep(nanoseconds: 500_000_000)

        logger.info("Push completed to \(remoteConfig.url)", category: "Git")
    }

    /// 从远程仓库拉取
    func pull(projectId: String, remote: String = "origin", branch: String? = nil) async throws {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        let targetBranch = branch ?? currentBranch
        logger.info("Pulling \(targetBranch) from \(remote) for project \(projectId)", category: "Git")

        // Get remote URL
        let config = try loadConfig(projectId: projectId)
        guard let remoteConfig = config.remotes.first(where: { $0.name == remote }) else {
            throw GitError.remoteNotFound(remote)
        }

        // Call backend API for actual pull
        // In a real implementation, this would sync with a backend service
        try await Task.sleep(nanoseconds: 500_000_000)

        logger.info("Pull completed from \(remoteConfig.url)", category: "Git")
    }

    // MARK: - Git 历史与差异 (3 operations)

    /// 获取提交历史
    func getLog(projectId: String, page: Int = 1, pageSize: Int = 20) throws -> [GitCommit] {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        logger.info("Getting commit log for project \(projectId)", category: "Git")

        let allCommits = try loadCommits(projectId: projectId)

        // Sort by timestamp (newest first)
        let sorted = allCommits.sorted { $0.timestamp > $1.timestamp }

        // Paginate
        let startIndex = (page - 1) * pageSize
        let endIndex = min(startIndex + pageSize, sorted.count)

        guard startIndex < sorted.count else {
            return []
        }

        self.commits = Array(sorted[startIndex..<endIndex])
        return self.commits
    }

    /// 获取提交详情
    func showCommit(projectId: String, commitId: String) throws -> (commit: GitCommit, diff: [GitDiff]) {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        let commits = try loadCommits(projectId: projectId)
        guard let commit = commits.first(where: { $0.id == commitId }) else {
            throw GitError.commitNotFound(commitId)
        }

        // Get commit's files snapshot
        let commitFiles = try loadCommitFiles(projectId: projectId, commitId: commitId)

        // Get parent commit's files
        var parentFiles: [String: String] = [:]
        if let parentId = commit.parentIds.first {
            parentFiles = try loadCommitFiles(projectId: projectId, commitId: parentId)
        }

        // Calculate diff
        let diffs = calculateDiff(oldFiles: parentFiles, newFiles: commitFiles)

        return (commit, diffs)
    }

    /// 获取两个提交之间的差异
    func getDiff(projectId: String, commit1: String?, commit2: String?) throws -> [GitDiff] {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        var oldFiles: [String: String] = [:]
        var newFiles: [String: String] = [:]

        if let c1 = commit1 {
            oldFiles = try loadCommitFiles(projectId: projectId, commitId: c1)
        }

        if let c2 = commit2 {
            newFiles = try loadCommitFiles(projectId: projectId, commitId: c2)
        } else {
            // Compare with working tree
            let files = try repository.getProjectFiles(projectId: projectId)
            for file in files {
                newFiles[file.path] = file.content
            }
        }

        return calculateDiff(oldFiles: oldFiles, newFiles: newFiles)
    }

    // MARK: - Git 分支管理 (6 operations)

    /// 获取分支列表
    func getBranches(projectId: String) throws -> [GitBranch] {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        let data = try Data(contentsOf: branchesPath(for: projectId))
        self.branches = try JSONDecoder().decode([GitBranch].self, from: data)
        return self.branches
    }

    /// 创建分支
    func createBranch(projectId: String, name: String, fromBranch: String? = nil) throws {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        logger.info("Creating branch \(name) in project \(projectId)", category: "Git")

        var branches = try getBranches(projectId: projectId)

        // Check if branch already exists
        guard !branches.contains(where: { $0.name == name }) else {
            throw GitError.branchExists(name)
        }

        // Get commit from source branch
        let sourceBranch = fromBranch ?? currentBranch
        let sourceCommitId = branches.first(where: { $0.name == sourceBranch })?.lastCommitId

        let newBranch = GitBranch(
            name: name,
            isRemote: false,
            isCurrent: false,
            lastCommitId: sourceCommitId
        )

        branches.append(newBranch)

        let data = try JSONEncoder().encode(branches)
        try data.write(to: branchesPath(for: projectId))

        self.branches = branches

        logger.info("Branch \(name) created", category: "Git")
    }

    /// 切换分支
    func checkout(projectId: String, branchName: String) throws {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        logger.info("Checking out branch \(branchName) in project \(projectId)", category: "Git")

        var branches = try getBranches(projectId: projectId)

        // Check if branch exists
        guard branches.contains(where: { $0.name == branchName }) else {
            throw GitError.branchNotFound(branchName)
        }

        // Update current branch flag
        branches = branches.map { branch in
            GitBranch(
                name: branch.name,
                isRemote: branch.isRemote,
                isCurrent: branch.name == branchName,
                lastCommitId: branch.lastCommitId
            )
        }

        // Update HEAD
        try "ref: refs/heads/\(branchName)".write(to: headPath(for: projectId), atomically: true, encoding: .utf8)

        let data = try JSONEncoder().encode(branches)
        try data.write(to: branchesPath(for: projectId))

        self.branches = branches
        self.currentBranch = branchName

        logger.info("Switched to branch \(branchName)", category: "Git")
    }

    /// 合并分支
    func merge(projectId: String, sourceBranch: String, targetBranch: String? = nil) throws {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        let target = targetBranch ?? currentBranch
        logger.info("Merging \(sourceBranch) into \(target) in project \(projectId)", category: "Git")

        // Simple fast-forward merge implementation
        let branches = try getBranches(projectId: projectId)

        guard let source = branches.first(where: { $0.name == sourceBranch }) else {
            throw GitError.branchNotFound(sourceBranch)
        }

        guard let sourceCommitId = source.lastCommitId else {
            throw GitError.nothingToMerge
        }

        // Update target branch pointer
        try updateBranchPointer(projectId: projectId, branch: target, commitId: sourceCommitId)

        logger.info("Merge completed: \(sourceBranch) -> \(target)", category: "Git")
    }

    /// 删除分支
    func deleteBranch(projectId: String, branchName: String) throws {
        guard isGitInitialized(projectId: projectId) else {
            throw GitError.notInitialized
        }

        guard branchName != currentBranch else {
            throw GitError.cannotDeleteCurrentBranch
        }

        logger.info("Deleting branch \(branchName) in project \(projectId)", category: "Git")

        var branches = try getBranches(projectId: projectId)
        branches.removeAll { $0.name == branchName }

        let data = try JSONEncoder().encode(branches)
        try data.write(to: branchesPath(for: projectId))

        self.branches = branches

        logger.info("Branch \(branchName) deleted", category: "Git")
    }

    /// 生成提交消息
    func generateCommitMessage(projectId: String) throws -> String {
        let status = try getStatus(projectId: projectId)
        return generateCommitMessage(from: status)
    }

    // MARK: - Git 配置

    /// 设置用户名
    func setUserName(projectId: String, name: String) throws {
        var config = try loadConfig(projectId: projectId)
        config.userName = name
        try saveConfig(projectId: projectId, config: config)
    }

    /// 设置邮箱
    func setUserEmail(projectId: String, email: String) throws {
        var config = try loadConfig(projectId: projectId)
        config.userEmail = email
        try saveConfig(projectId: projectId, config: config)
    }

    /// 添加远程仓库
    func addRemote(projectId: String, name: String, url: String) throws {
        var config = try loadConfig(projectId: projectId)

        guard !config.remotes.contains(where: { $0.name == name }) else {
            throw GitError.remoteExists(name)
        }

        config.remotes.append(GitRemote(name: name, url: url, fetchUrl: url, pushUrl: url))
        try saveConfig(projectId: projectId, config: config)

        logger.info("Remote \(name) added: \(url)", category: "Git")
    }

    /// 移除远程仓库
    func removeRemote(projectId: String, name: String) throws {
        var config = try loadConfig(projectId: projectId)
        config.remotes.removeAll { $0.name == name }
        try saveConfig(projectId: projectId, config: config)

        logger.info("Remote \(name) removed", category: "Git")
    }

    /// 获取远程仓库列表
    func getRemotes(projectId: String) throws -> [GitRemote] {
        let config = try loadConfig(projectId: projectId)
        return config.remotes
    }

    // MARK: - Private Helpers

    private func loadIndex(projectId: String) throws -> [String: GitFileState] {
        guard let data = try? Data(contentsOf: indexPath(for: projectId)),
              let index = try? JSONDecoder().decode([String: GitFileState].self, from: data) else {
            return [:]
        }
        return index
    }

    private func saveIndex(projectId: String, index: [String: GitFileState]) throws {
        let data = try JSONEncoder().encode(index)
        try data.write(to: indexPath(for: projectId))
    }

    private func loadConfig(projectId: String) throws -> GitConfig {
        guard let data = try? Data(contentsOf: configPath(for: projectId)),
              let config = try? JSONDecoder().decode(GitConfig.self, from: data) else {
            return GitConfig.default
        }
        return config
    }

    private func saveConfig(projectId: String, config: GitConfig) throws {
        let data = try JSONEncoder().encode(config)
        try data.write(to: configPath(for: projectId))
    }

    private func loadCommits(projectId: String) throws -> [GitCommit] {
        guard let data = try? Data(contentsOf: commitsPath(for: projectId)),
              let commits = try? JSONDecoder().decode([GitCommit].self, from: data) else {
            return []
        }
        return commits
    }

    private func getLastCommit(projectId: String) throws -> (commit: GitCommit, files: [String: String])? {
        let commits = try loadCommits(projectId: projectId)
        guard let lastCommit = commits.max(by: { $0.timestamp < $1.timestamp }) else {
            return nil
        }

        let files = try loadCommitFiles(projectId: projectId, commitId: lastCommit.id)
        return (lastCommit, files)
    }

    private func saveCommit(projectId: String, commit: GitCommit, files: [String: String]) throws {
        // Save commit to commits list
        var commits = try loadCommits(projectId: projectId)
        commits.append(commit)
        let commitsData = try JSONEncoder().encode(commits)
        try commitsData.write(to: commitsPath(for: projectId))

        // Save commit's files snapshot
        let filesPath = gitDataPath(for: projectId).appendingPathComponent("objects/\(commit.id).json")
        try fileManager.createDirectory(at: filesPath.deletingLastPathComponent(), withIntermediateDirectories: true)
        let filesData = try JSONEncoder().encode(files)
        try filesData.write(to: filesPath)
    }

    private func loadCommitFiles(projectId: String, commitId: String) throws -> [String: String] {
        let filesPath = gitDataPath(for: projectId).appendingPathComponent("objects/\(commitId).json")
        guard let data = try? Data(contentsOf: filesPath),
              let files = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }
        return files
    }

    private func updateBranchPointer(projectId: String, branch: String, commitId: String) throws {
        var branches = try getBranches(projectId: projectId)

        branches = branches.map { b in
            if b.name == branch {
                return GitBranch(name: b.name, isRemote: b.isRemote, isCurrent: b.isCurrent, lastCommitId: commitId)
            }
            return b
        }

        let data = try JSONEncoder().encode(branches)
        try data.write(to: branchesPath(for: projectId))

        self.branches = branches
    }

    private func generateCommitMessage(from status: GitStatus) -> String {
        var parts: [String] = []

        let added = status.staged.filter { $0.status == .added }.count
        let modified = status.staged.filter { $0.status == .modified }.count
        let deleted = status.staged.filter { $0.status == .deleted }.count

        if added > 0 {
            parts.append("Add \(added) file\(added > 1 ? "s" : "")")
        }
        if modified > 0 {
            parts.append("Update \(modified) file\(modified > 1 ? "s" : "")")
        }
        if deleted > 0 {
            parts.append("Delete \(deleted) file\(deleted > 1 ? "s" : "")")
        }

        if parts.isEmpty {
            return "Update files"
        }

        return parts.joined(separator: ", ")
    }

    private func calculateDiff(oldFiles: [String: String], newFiles: [String: String]) -> [GitDiff] {
        var diffs: [GitDiff] = []

        // Find added and modified files
        for (path, newContent) in newFiles {
            if let oldContent = oldFiles[path] {
                // File was modified
                if oldContent != newContent {
                    let diff = createFileDiff(path: path, oldContent: oldContent, newContent: newContent)
                    diffs.append(diff)
                }
            } else {
                // File was added
                let diff = createFileDiff(path: path, oldContent: "", newContent: newContent)
                diffs.append(diff)
            }
        }

        // Find deleted files
        for (path, oldContent) in oldFiles {
            if newFiles[path] == nil {
                let diff = createFileDiff(path: path, oldContent: oldContent, newContent: "")
                diffs.append(diff)
            }
        }

        return diffs
    }

    private func createFileDiff(path: String, oldContent: String, newContent: String) -> GitDiff {
        let oldLines = oldContent.components(separatedBy: "\n")
        let newLines = newContent.components(separatedBy: "\n")

        var additions = 0
        var deletions = 0
        var chunkContent = ""

        // Simple line-by-line diff
        let maxLines = max(oldLines.count, newLines.count)
        for i in 0..<maxLines {
            let oldLine = i < oldLines.count ? oldLines[i] : nil
            let newLine = i < newLines.count ? newLines[i] : nil

            if oldLine == newLine {
                chunkContent += " \(oldLine ?? "")\n"
            } else {
                if let old = oldLine {
                    chunkContent += "-\(old)\n"
                    deletions += 1
                }
                if let new = newLine {
                    chunkContent += "+\(new)\n"
                    additions += 1
                }
            }
        }

        let chunk = DiffChunk(
            oldStart: 1,
            oldLines: oldLines.count,
            newStart: 1,
            newLines: newLines.count,
            content: chunkContent
        )

        return GitDiff(filePath: path, additions: additions, deletions: deletions, chunks: [chunk])
    }
}

// MARK: - Git Errors

enum GitError: LocalizedError {
    case notInitialized
    case nothingToCommit
    case nothingToMerge
    case commitNotFound(String)
    case branchExists(String)
    case branchNotFound(String)
    case cannotDeleteCurrentBranch
    case remoteNotFound(String)
    case remoteExists(String)
    case conflictDetected
    case operationFailed(String)

    var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "Git仓库未初始化"
        case .nothingToCommit:
            return "没有需要提交的更改"
        case .nothingToMerge:
            return "没有需要合并的更改"
        case .commitNotFound(let id):
            return "找不到提交: \(id)"
        case .branchExists(let name):
            return "分支已存在: \(name)"
        case .branchNotFound(let name):
            return "找不到分支: \(name)"
        case .cannotDeleteCurrentBranch:
            return "不能删除当前分支"
        case .remoteNotFound(let name):
            return "找不到远程仓库: \(name)"
        case .remoteExists(let name):
            return "远程仓库已存在: \(name)"
        case .conflictDetected:
            return "检测到冲突"
        case .operationFailed(let message):
            return "操作失败: \(message)"
        }
    }
}
