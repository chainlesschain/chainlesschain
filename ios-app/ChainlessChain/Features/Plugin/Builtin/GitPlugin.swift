//
//  GitPlugin.swift
//  ChainlessChain
//
//  Git插件
//  提供Git版本控制功能
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import CoreCommon

// MARK: - Git Plugin

/// Git插件处理器
public class GitPlugin {
    public static let shared = GitPlugin()

    private init() {
        Logger.shared.info("[GitPlugin] 初始化完成")
    }

    // MARK: - Public Methods

    /// 获取仓库状态
    public func status(in directory: String) async throws -> GitStatus {
        Logger.shared.info("[GitPlugin] 获取状态: \(directory)")

        // 检查是否是Git仓库
        let gitDir = (directory as NSString).appendingPathComponent(".git")
        guard FileManager.default.fileExists(atPath: gitDir) else {
            throw PluginError.executionFailed("不是Git仓库: \(directory)")
        }

        // 执行git status
        let output = try await runGitCommand(["status", "--porcelain"], in: directory)

        // 解析输出
        var status = GitStatus()

        for line in output.components(separatedBy: "\n") where !line.isEmpty {
            let statusCode = String(line.prefix(2))
            let fileName = String(line.dropFirst(3))

            switch statusCode.trimmingCharacters(in: .whitespaces) {
            case "M":
                status.modified.append(fileName)
            case "A":
                status.staged.append(fileName)
            case "D":
                status.deleted.append(fileName)
            case "??":
                status.untracked.append(fileName)
            case "R":
                status.renamed.append(fileName)
            default:
                if statusCode.contains("M") {
                    status.modified.append(fileName)
                }
            }
        }

        // 获取当前分支
        status.currentBranch = try await getCurrentBranch(in: directory)

        // 获取远程状态
        let remoteStatus = try? await getRemoteStatus(in: directory)
        status.ahead = remoteStatus?.ahead ?? 0
        status.behind = remoteStatus?.behind ?? 0

        return status
    }

    /// 提交更改
    public func commit(in directory: String, message: String, files: [String]? = nil) async throws -> GitCommitResult {
        Logger.shared.info("[GitPlugin] 提交: \(directory)")

        // 暂存文件
        if let files = files {
            for file in files {
                _ = try await runGitCommand(["add", file], in: directory)
            }
        } else {
            _ = try await runGitCommand(["add", "-A"], in: directory)
        }

        // 提交
        let output = try await runGitCommand(["commit", "-m", message], in: directory)

        // 获取提交哈希
        let hash = try await runGitCommand(["rev-parse", "HEAD"], in: directory)

        return GitCommitResult(
            success: true,
            hash: hash.trimmingCharacters(in: .whitespacesAndNewlines),
            message: message,
            output: output
        )
    }

    /// 查看差异
    public func diff(in directory: String, file: String? = nil, staged: Bool = false) async throws -> String {
        Logger.shared.info("[GitPlugin] 查看差异: \(directory)")

        var args = ["diff"]

        if staged {
            args.append("--staged")
        }

        if let file = file {
            args.append(file)
        }

        return try await runGitCommand(args, in: directory)
    }

    /// 查看日志
    public func log(in directory: String, count: Int = 10, format: GitLogFormat = .oneline) async throws -> [GitLogEntry] {
        Logger.shared.info("[GitPlugin] 查看日志: \(directory)")

        let formatString: String
        switch format {
        case .oneline:
            formatString = "%H|%s|%an|%ai"
        case .full:
            formatString = "%H|%s|%an|%ai|%b"
        }

        let output = try await runGitCommand([
            "log",
            "-\(count)",
            "--format=\(formatString)"
        ], in: directory)

        var entries: [GitLogEntry] = []

        for line in output.components(separatedBy: "\n") where !line.isEmpty {
            let parts = line.components(separatedBy: "|")
            guard parts.count >= 4 else { continue }

            let entry = GitLogEntry(
                hash: parts[0],
                shortHash: String(parts[0].prefix(7)),
                message: parts[1],
                author: parts[2],
                date: parseGitDate(parts[3]),
                body: parts.count > 4 ? parts[4] : nil
            )

            entries.append(entry)
        }

        return entries
    }

    /// 切换分支
    public func checkout(in directory: String, branch: String, create: Bool = false) async throws {
        Logger.shared.info("[GitPlugin] 切换分支: \(branch)")

        var args = ["checkout"]

        if create {
            args.append("-b")
        }

        args.append(branch)

        _ = try await runGitCommand(args, in: directory)
    }

    /// 拉取更新
    public func pull(in directory: String, remote: String = "origin", branch: String? = nil) async throws -> GitPullResult {
        Logger.shared.info("[GitPlugin] 拉取更新: \(directory)")

        var args = ["pull", remote]

        if let branch = branch {
            args.append(branch)
        }

        let output = try await runGitCommand(args, in: directory)

        let hasConflicts = output.contains("CONFLICT")
        let isUpToDate = output.contains("Already up to date")

        return GitPullResult(
            success: !hasConflicts,
            hasConflicts: hasConflicts,
            isUpToDate: isUpToDate,
            output: output
        )
    }

    /// 推送更新
    public func push(in directory: String, remote: String = "origin", branch: String? = nil) async throws {
        Logger.shared.info("[GitPlugin] 推送更新: \(directory)")

        var args = ["push", remote]

        if let branch = branch {
            args.append(branch)
        }

        _ = try await runGitCommand(args, in: directory)
    }

    /// 获取分支列表
    public func branches(in directory: String, remote: Bool = false) async throws -> [GitBranch] {
        Logger.shared.info("[GitPlugin] 获取分支列表: \(directory)")

        var args = ["branch"]

        if remote {
            args.append("-r")
        }

        let output = try await runGitCommand(args, in: directory)

        var branches: [GitBranch] = []

        for line in output.components(separatedBy: "\n") where !line.isEmpty {
            let isCurrent = line.hasPrefix("*")
            let name = line.replacingOccurrences(of: "*", with: "")
                .trimmingCharacters(in: .whitespaces)

            branches.append(GitBranch(
                name: name,
                isCurrent: isCurrent,
                isRemote: remote
            ))
        }

        return branches
    }

    /// 暂存更改
    public func stash(in directory: String, message: String? = nil) async throws {
        Logger.shared.info("[GitPlugin] 暂存更改: \(directory)")

        var args = ["stash"]

        if let message = message {
            args.append(contentsOf: ["save", message])
        }

        _ = try await runGitCommand(args, in: directory)
    }

    /// 弹出暂存
    public func stashPop(in directory: String) async throws {
        Logger.shared.info("[GitPlugin] 弹出暂存: \(directory)")

        _ = try await runGitCommand(["stash", "pop"], in: directory)
    }

    /// 重置更改
    public func reset(in directory: String, mode: GitResetMode = .mixed, target: String = "HEAD") async throws {
        Logger.shared.info("[GitPlugin] 重置: \(directory) \(mode)")

        _ = try await runGitCommand(["reset", "--\(mode.rawValue)", target], in: directory)
    }

    // MARK: - Private Methods

    private func runGitCommand(_ args: [String], in directory: String) async throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = args
        process.currentDirectoryURL = URL(fileURLWithPath: directory)

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
            process.waitUntilExit()

            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8) ?? ""

        } catch {
            throw PluginError.executionFailed("Git命令执行失败: \(error.localizedDescription)")
        }
    }

    private func getCurrentBranch(in directory: String) async throws -> String {
        let output = try await runGitCommand(["branch", "--show-current"], in: directory)
        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func getRemoteStatus(in directory: String) async throws -> (ahead: Int, behind: Int) {
        let output = try await runGitCommand(["status", "-sb"], in: directory)

        var ahead = 0
        var behind = 0

        if let range = output.range(of: #"\[ahead (\d+)\]"#, options: .regularExpression) {
            let match = output[range]
            if let num = Int(match.dropFirst(7).dropLast()) {
                ahead = num
            }
        }

        if let range = output.range(of: #"\[behind (\d+)\]"#, options: .regularExpression) {
            let match = output[range]
            if let num = Int(match.dropFirst(8).dropLast()) {
                behind = num
            }
        }

        return (ahead, behind)
    }

    private func parseGitDate(_ dateString: String) -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
        return formatter.date(from: dateString) ?? Date()
    }
}

// MARK: - Supporting Types

/// Git状态
public struct GitStatus {
    public var currentBranch: String = ""
    public var modified: [String] = []
    public var staged: [String] = []
    public var untracked: [String] = []
    public var deleted: [String] = []
    public var renamed: [String] = []
    public var ahead: Int = 0
    public var behind: Int = 0

    public var isClean: Bool {
        modified.isEmpty && staged.isEmpty && untracked.isEmpty && deleted.isEmpty && renamed.isEmpty
    }

    public var changedFileCount: Int {
        modified.count + staged.count + untracked.count + deleted.count + renamed.count
    }
}

/// Git提交结果
public struct GitCommitResult {
    public let success: Bool
    public let hash: String
    public let message: String
    public let output: String
}

/// Git日志条目
public struct GitLogEntry: Identifiable {
    public var id: String { hash }

    public let hash: String
    public let shortHash: String
    public let message: String
    public let author: String
    public let date: Date
    public let body: String?
}

/// Git日志格式
public enum GitLogFormat {
    case oneline
    case full
}

/// Git拉取结果
public struct GitPullResult {
    public let success: Bool
    public let hasConflicts: Bool
    public let isUpToDate: Bool
    public let output: String
}

/// Git分支
public struct GitBranch: Identifiable {
    public var id: String { name }

    public let name: String
    public let isCurrent: Bool
    public let isRemote: Bool
}

/// Git重置模式
public enum GitResetMode: String {
    case soft
    case mixed
    case hard
}
