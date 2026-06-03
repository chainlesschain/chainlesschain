import Foundation

/// Git引擎
///
/// 负责Git操作、仓库分析、版本控制等任务
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/engines/git-engine.js
public class GitEngine: BaseAIEngine {

    public static let shared = GitEngine()

    private init() {
        super.init(
            type: .git,
            name: "Git引擎",
            description: "处理Git操作、仓库分析、版本控制等任务"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(
                id: "repo_status",
                name: "仓库状态",
                description: "获取Git仓库当前状态"
            ),
            AIEngineCapability(
                id: "commit_history",
                name: "提交历史",
                description: "查看提交历史记录"
            ),
            AIEngineCapability(
                id: "branch_management",
                name: "分支管理",
                description: "创建、切换、删除分支"
            ),
            AIEngineCapability(
                id: "diff_analysis",
                name: "差异分析",
                description: "分析代码变更差异"
            ),
            AIEngineCapability(
                id: "commit_create",
                name: "创建提交",
                description: "暂存并提交变更"
            ),
            AIEngineCapability(
                id: "repo_clone",
                name: "克隆仓库",
                description: "克隆远程Git仓库"
            ),
            AIEngineCapability(
                id: "remote_sync",
                name: "远程同步",
                description: "推送和拉取远程变更"
            ),
            AIEngineCapability(
                id: "contributor_analysis",
                name: "贡献者分析",
                description: "分析代码贡献统计"
            ),
            AIEngineCapability(
                id: "commit_suggest",
                name: "提交建议",
                description: "AI生成提交消息建议"
            )
        ]
    }

    // MARK: - 初始化

    public override func initialize() async throws {
        try await super.initialize()

        Logger.shared.info("Git引擎初始化完成")
    }

    // MARK: - 任务执行

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        Logger.shared.info("Git引擎执行任务: \(task)")

        switch task {
        case "status":
            return try await getRepoStatus(parameters: parameters)

        case "log":
            return try await getCommitHistory(parameters: parameters)

        case "branch":
            return try await manageBranch(parameters: parameters)

        case "diff":
            return try await analyzeDiff(parameters: parameters)

        case "commit":
            return try await createCommit(parameters: parameters)

        case "clone":
            return try await cloneRepository(parameters: parameters)

        case "pull":
            return try await pullChanges(parameters: parameters)

        case "push":
            return try await pushChanges(parameters: parameters)

        case "contributors":
            return try await analyzeContributors(parameters: parameters)

        case "suggest_commit":
            return try await suggestCommitMessage(parameters: parameters)

        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    // MARK: - Git状态

    /// 获取仓库状态
    private func getRepoStatus(parameters: [String: Any]) async throws -> [String: Any] {
        guard let repoPath = parameters["repoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少repoPath参数")
        }

        let result = try await executeGitCommand("status --porcelain", in: repoPath)

        // 解析状态
        let lines = result.components(separatedBy: .newlines).filter { !$0.isEmpty }
        var modified: [String] = []
        var added: [String] = []
        var deleted: [String] = []
        var untracked: [String] = []

        for line in lines {
            let status = String(line.prefix(2))
            let file = String(line.dropFirst(3))

            switch status.trimmingCharacters(in: .whitespaces) {
            case "M", "MM":
                modified.append(file)
            case "A":
                added.append(file)
            case "D":
                deleted.append(file)
            case "??":
                untracked.append(file)
            default:
                break
            }
        }

        // 获取当前分支
        let branch = try await executeGitCommand("rev-parse --abbrev-ref HEAD", in: repoPath)

        return [
            "branch": branch.trimmingCharacters(in: .whitespacesAndNewlines),
            "modified": modified,
            "added": added,
            "deleted": deleted,
            "untracked": untracked,
            "clean": lines.isEmpty
        ]
    }

    /// 获取提交历史
    private func getCommitHistory(parameters: [String: Any]) async throws -> [String: Any] {
        guard let repoPath = parameters["repoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少repoPath参数")
        }

        let limit = parameters["limit"] as? Int ?? 20
        let branch = parameters["branch"] as? String

        var command = "log --pretty=format:'%H|%an|%ae|%ad|%s' --date=iso -n \(limit)"
        if let branchName = branch {
            command += " \(branchName)"
        }

        let result = try await executeGitCommand(command, in: repoPath)

        let lines = result.components(separatedBy: .newlines).filter { !$0.isEmpty }
        let commits = lines.map { line -> [String: Any] in
            let parts = line.components(separatedBy: "|")
            guard parts.count >= 5 else { return [:] }

            return [
                "hash": parts[0],
                "author": parts[1],
                "email": parts[2],
                "date": parts[3],
                "message": parts[4]
            ]
        }

        return [
            "commits": commits,
            "count": commits.count
        ]
    }

    // MARK: - 分支管理

    /// 管理分支
    private func manageBranch(parameters: [String: Any]) async throws -> [String: Any] {
        guard let repoPath = parameters["repoPath"] as? String,
              let action = parameters["action"] as? String else {
            throw AIEngineError.invalidParameters("缺少repoPath或action参数")
        }

        switch action {
        case "list":
            let result = try await executeGitCommand("branch -a", in: repoPath)
            let branches = result.components(separatedBy: .newlines)
                .map { $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "* ", with: "") }
                .filter { !$0.isEmpty }

            return [
                "branches": branches,
                "count": branches.count
            ]

        case "create":
            guard let branchName = parameters["branchName"] as? String else {
                throw AIEngineError.invalidParameters("缺少branchName参数")
            }
            _ = try await executeGitCommand("branch \(branchName)", in: repoPath)

            return [
                "branch": branchName,
                "created": true
            ]

        case "checkout":
            guard let branchName = parameters["branchName"] as? String else {
                throw AIEngineError.invalidParameters("缺少branchName参数")
            }
            _ = try await executeGitCommand("checkout \(branchName)", in: repoPath)

            return [
                "branch": branchName,
                "checkedOut": true
            ]

        case "delete":
            guard let branchName = parameters["branchName"] as? String else {
                throw AIEngineError.invalidParameters("缺少branchName参数")
            }
            _ = try await executeGitCommand("branch -D \(branchName)", in: repoPath)

            return [
                "branch": branchName,
                "deleted": true
            ]

        default:
            throw AIEngineError.invalidParameters("不支持的操作: \(action)")
        }
    }

    // MARK: - 差异分析

    /// 分析差异
    private func analyzeDiff(parameters: [String: Any]) async throws -> [String: Any] {
        guard let repoPath = parameters["repoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少repoPath参数")
        }

        let target = parameters["target"] as? String // 可以是commit hash, branch, HEAD
        let file = parameters["file"] as? String

        var command = "diff --numstat"
        if let t = target {
            command += " \(t)"
        }
        if let f = file {
            command += " -- \(f)"
        }

        let result = try await executeGitCommand(command, in: repoPath)

        let lines = result.components(separatedBy: .newlines).filter { !$0.isEmpty }
        var files: [[String: Any]] = []
        var totalAdded = 0
        var totalDeleted = 0

        for line in lines {
            let parts = line.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
            guard parts.count >= 3 else { continue }

            let added = Int(parts[0]) ?? 0
            let deleted = Int(parts[1]) ?? 0
            let fileName = parts[2]

            files.append([
                "file": fileName,
                "added": added,
                "deleted": deleted
            ])

            totalAdded += added
            totalDeleted += deleted
        }

        return [
            "files": files,
            "totalAdded": totalAdded,
            "totalDeleted": totalDeleted,
            "fileCount": files.count
        ]
    }

    // MARK: - 提交操作

    /// 创建提交
    private func createCommit(parameters: [String: Any]) async throws -> [String: Any] {
        guard let repoPath = parameters["repoPath"] as? String,
              let message = parameters["message"] as? String else {
            throw AIEngineError.invalidParameters("缺少repoPath或message参数")
        }

        let files = parameters["files"] as? [String]

        // 添加文件到暂存区
        if let fileList = files {
            for file in fileList {
                _ = try await executeGitCommand("add \(file)", in: repoPath)
            }
        } else {
            _ = try await executeGitCommand("add -A", in: repoPath)
        }

        // 创建提交
        _ = try await executeGitCommand("commit -m \"\(message)\"", in: repoPath)

        // 获取提交hash
        let hash = try await executeGitCommand("rev-parse HEAD", in: repoPath)

        return [
            "hash": hash.trimmingCharacters(in: .whitespacesAndNewlines),
            "message": message,
            "success": true
        ]
    }

    // MARK: - 远程操作

    /// 克隆仓库
    private func cloneRepository(parameters: [String: Any]) async throws -> [String: Any] {
        guard let repoURL = parameters["repoURL"] as? String,
              let targetPath = parameters["targetPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少repoURL或targetPath参数")
        }

        let parentPath = (targetPath as NSString).deletingLastPathComponent
        _ = try await executeGitCommand("clone \(repoURL) \(targetPath)", in: parentPath)

        return [
            "repoURL": repoURL,
            "targetPath": targetPath,
            "success": true
        ]
    }

    /// 拉取变更
    private func pullChanges(parameters: [String: Any]) async throws -> [String: Any] {
        guard let repoPath = parameters["repoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少repoPath参数")
        }

        let remote = parameters["remote"] as? String ?? "origin"
        let branch = parameters["branch"] as? String

        var command = "pull \(remote)"
        if let branchName = branch {
            command += " \(branchName)"
        }

        let result = try await executeGitCommand(command, in: repoPath)

        return [
            "result": result,
            "success": true
        ]
    }

    /// 推送变更
    private func pushChanges(parameters: [String: Any]) async throws -> [String: Any] {
        guard let repoPath = parameters["repoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少repoPath参数")
        }

        let remote = parameters["remote"] as? String ?? "origin"
        let branch = parameters["branch"] as? String

        var command = "push \(remote)"
        if let branchName = branch {
            command += " \(branchName)"
        }

        let result = try await executeGitCommand(command, in: repoPath)

        return [
            "result": result,
            "success": true
        ]
    }

    // MARK: - 分析功能

    /// 分析贡献者
    private func analyzeContributors(parameters: [String: Any]) async throws -> [String: Any] {
        guard let repoPath = parameters["repoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少repoPath参数")
        }

        let result = try await executeGitCommand("shortlog -sn --all", in: repoPath)

        let lines = result.components(separatedBy: .newlines).filter { !$0.isEmpty }
        let contributors = lines.map { line -> [String: Any] in
            let parts = line.trimmingCharacters(in: .whitespaces).components(separatedBy: .whitespaces)
            let commits = Int(parts[0]) ?? 0
            let name = parts.dropFirst().joined(separator: " ")

            return [
                "name": name,
                "commits": commits
            ]
        }

        let totalCommits = contributors.reduce(0) { $0 + ($1["commits"] as? Int ?? 0) }

        return [
            "contributors": contributors,
            "totalContributors": contributors.count,
            "totalCommits": totalCommits
        ]
    }

    // MARK: - AI增强

    /// 建议提交消息
    private func suggestCommitMessage(parameters: [String: Any]) async throws -> [String: Any] {
        guard let repoPath = parameters["repoPath"] as? String else {
            throw AIEngineError.invalidParameters("缺少repoPath参数")
        }

        // 获取当前变更
        let diff = try await analyzeDiff(parameters: ["repoPath": repoPath])

        let files = diff["files"] as? [[String: Any]] ?? []
        let fileNames = files.compactMap { $0["file"] as? String }
        let totalAdded = diff["totalAdded"] as? Int ?? 0
        let totalDeleted = diff["totalDeleted"] as? Int ?? 0

        // 获取最近的提交消息作为参考
        let history = try await getCommitHistory(parameters: ["repoPath": repoPath, "limit": 5])
        let recentMessages = (history["commits"] as? [[String: Any]] ?? [])
            .compactMap { $0["message"] as? String }

        let prompt = """
        请根据以下代码变更生成合适的提交消息：

        变更文件：
        \(fileNames.prefix(10).joined(separator: "\n"))

        统计：
        - 新增行数：\(totalAdded)
        - 删除行数：\(totalDeleted)
        - 变更文件数：\(files.count)

        最近的提交消息（作为风格参考）：
        \(recentMessages.prefix(3).joined(separator: "\n"))

        请提供：
        1. 简洁的提交消息（50字符内）
        2. 详细描述（可选，如果变更复杂）
        3. 提交类型（feat/fix/docs/style/refactor/test/chore）

        格式：
        <type>: <subject>

        <body>
        """

        let suggestion = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个Git提交消息专家，擅长根据代码变更生成清晰、规范的提交消息。"
        )

        return [
            "suggestion": suggestion,
            "filesChanged": files.count,
            "linesAdded": totalAdded,
            "linesDeleted": totalDeleted
        ]
    }

    // MARK: - 辅助方法

    /// 执行Git命令
    private func executeGitCommand(_ command: String, in directory: String) async throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = command.components(separatedBy: " ")
        process.currentDirectoryURL = URL(fileURLWithPath: directory)

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
            process.waitUntilExit()

            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8) ?? ""

            guard process.terminationStatus == 0 else {
                throw AIEngineError.executionFailed("Git命令执行失败: \(output)")
            }

            return output
        } catch {
            throw AIEngineError.executionFailed("Git命令执行错误: \(error.localizedDescription)")
        }
    }
}
