import Foundation
import Combine
import CoreCommon

/// Git操作视图模型
/// 管理Git状态显示和操作
@MainActor
class GitViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var isInitialized: Bool = false
    @Published var status: GitStatus?
    @Published var branches: [GitBranch] = []
    @Published var currentBranch: String = "main"
    @Published var commits: [GitCommit] = []
    @Published var selectedCommit: GitCommit?
    @Published var diff: GitDiff?

    @Published var isLoading: Bool = false
    @Published var error: String?
    @Published var successMessage: String?

    // MARK: - Commit Form

    @Published var commitMessage: String = ""
    @Published var stagedFiles: Set<String> = []

    // MARK: - Dependencies

    private let gitManager = GitManager.shared
    private let logger = Logger.shared

    // MARK: - Project Context

    let projectId: String

    // MARK: - Initialization

    init(projectId: String) {
        self.projectId = projectId
        loadGitInfo()
    }

    // MARK: - Public Methods

    /// 加载Git信息
    func loadGitInfo() {
        isLoading = true
        error = nil

        // Check if initialized
        isInitialized = gitManager.isInitialized(projectId: projectId)

        if isInitialized {
            loadStatus()
            loadBranches()
            loadCommits()
        }

        isLoading = false
    }

    /// 初始化Git仓库
    func initRepository(remoteUrl: String? = nil) async {
        isLoading = true
        error = nil

        do {
            try gitManager.initRepository(projectId: projectId, remoteUrl: remoteUrl)
            isInitialized = true
            loadGitInfo()
            successMessage = "Git仓库初始化成功"
            logger.info("Git repository initialized", category: "Git")
        } catch {
            self.error = "初始化失败: \(error.localizedDescription)"
            logger.error("Failed to initialize git", error: error, category: "Git")
        }

        isLoading = false
    }

    /// 加载状态
    func loadStatus() {
        do {
            status = try gitManager.getStatus(projectId: projectId)
            currentBranch = status?.currentBranch ?? "main"
        } catch {
            logger.error("Failed to load git status", error: error, category: "Git")
        }
    }

    /// 加载分支
    func loadBranches() {
        do {
            branches = try gitManager.getBranches(projectId: projectId)
        } catch {
            logger.error("Failed to load branches", error: error, category: "Git")
        }
    }

    /// 加载提交历史
    func loadCommits(page: Int = 1) {
        do {
            commits = try gitManager.getLog(projectId: projectId, page: page)
        } catch {
            logger.error("Failed to load commits", error: error, category: "Git")
        }
    }

    /// 暂存文件
    func stageFile(path: String) {
        stagedFiles.insert(path)
    }

    /// 取消暂存文件
    func unstageFile(path: String) {
        stagedFiles.remove(path)
    }

    /// 暂存所有文件
    func stageAll() {
        guard let status = status else { return }
        for file in status.unstaged {
            stagedFiles.insert(file.path)
        }
        for path in status.untracked {
            stagedFiles.insert(path)
        }
    }

    /// 取消暂存所有
    func unstageAll() {
        stagedFiles.removeAll()
    }

    /// 提交
    func commit() async {
        guard !commitMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "请输入提交信息"
            return
        }

        isLoading = true
        error = nil

        do {
            let commit = try gitManager.commit(
                projectId: projectId,
                message: commitMessage.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            commitMessage = ""
            stagedFiles.removeAll()
            loadStatus()
            loadCommits()
            successMessage = "提交成功: \(commit.hash.prefix(7))"
            logger.info("Committed: \(commit.hash)", category: "Git")
        } catch {
            self.error = "提交失败: \(error.localizedDescription)"
            logger.error("Failed to commit", error: error, category: "Git")
        }

        isLoading = false
    }

    /// AI生成提交信息
    func generateCommitMessage() async {
        isLoading = true
        error = nil

        do {
            let message = try await gitManager.generateCommitMessage(projectId: projectId)
            commitMessage = message
            logger.info("Generated commit message", category: "Git")
        } catch {
            self.error = "生成提交信息失败: \(error.localizedDescription)"
            logger.error("Failed to generate commit message", error: error, category: "Git")
        }

        isLoading = false
    }

    /// 推送
    func push(remote: String = "origin", branch: String? = nil) async {
        isLoading = true
        error = nil

        do {
            try await gitManager.push(projectId: projectId, remote: remote, branch: branch)
            successMessage = "推送成功"
            logger.info("Pushed to remote", category: "Git")
        } catch {
            self.error = "推送失败: \(error.localizedDescription)"
            logger.error("Failed to push", error: error, category: "Git")
        }

        isLoading = false
    }

    /// 拉取
    func pull(remote: String = "origin", branch: String? = nil) async {
        isLoading = true
        error = nil

        do {
            try await gitManager.pull(projectId: projectId, remote: remote, branch: branch)
            loadStatus()
            loadCommits()
            successMessage = "拉取成功"
            logger.info("Pulled from remote", category: "Git")
        } catch {
            self.error = "拉取失败: \(error.localizedDescription)"
            logger.error("Failed to pull", error: error, category: "Git")
        }

        isLoading = false
    }

    /// 创建分支
    func createBranch(name: String, fromBranch: String? = nil) async {
        isLoading = true
        error = nil

        do {
            try gitManager.createBranch(projectId: projectId, name: name, fromBranch: fromBranch)
            loadBranches()
            successMessage = "分支 '\(name)' 创建成功"
            logger.info("Created branch: \(name)", category: "Git")
        } catch {
            self.error = "创建分支失败: \(error.localizedDescription)"
            logger.error("Failed to create branch", error: error, category: "Git")
        }

        isLoading = false
    }

    /// 切换分支
    func checkout(branchName: String) async {
        isLoading = true
        error = nil

        do {
            try gitManager.checkout(projectId: projectId, branchName: branchName)
            currentBranch = branchName
            loadStatus()
            loadCommits()
            successMessage = "已切换到分支 '\(branchName)'"
            logger.info("Checked out branch: \(branchName)", category: "Git")
        } catch {
            self.error = "切换分支失败: \(error.localizedDescription)"
            logger.error("Failed to checkout branch", error: error, category: "Git")
        }

        isLoading = false
    }

    /// 合并分支
    func merge(sourceBranch: String) async {
        isLoading = true
        error = nil

        do {
            try gitManager.merge(projectId: projectId, sourceBranch: sourceBranch)
            loadStatus()
            loadCommits()
            successMessage = "合并 '\(sourceBranch)' 成功"
            logger.info("Merged branch: \(sourceBranch)", category: "Git")
        } catch {
            self.error = "合并失败: \(error.localizedDescription)"
            logger.error("Failed to merge branch", error: error, category: "Git")
        }

        isLoading = false
    }

    /// 删除分支
    func deleteBranch(name: String) async {
        isLoading = true
        error = nil

        do {
            try gitManager.deleteBranch(projectId: projectId, name: name)
            loadBranches()
            successMessage = "分支 '\(name)' 已删除"
            logger.info("Deleted branch: \(name)", category: "Git")
        } catch {
            self.error = "删除分支失败: \(error.localizedDescription)"
            logger.error("Failed to delete branch", error: error, category: "Git")
        }

        isLoading = false
    }

    /// 查看提交详情
    func showCommitDetails(commitHash: String) {
        do {
            selectedCommit = try gitManager.showCommit(projectId: projectId, commitHash: commitHash)
        } catch {
            self.error = "获取提交详情失败: \(error.localizedDescription)"
            logger.error("Failed to show commit", error: error, category: "Git")
        }
    }

    /// 获取差异
    func getDiff(commitHash: String? = nil) {
        do {
            diff = try gitManager.getDiff(projectId: projectId, commitHash: commitHash)
        } catch {
            logger.error("Failed to get diff", error: error, category: "Git")
        }
    }

    /// 清除消息
    func clearMessages() {
        error = nil
        successMessage = nil
    }
}
