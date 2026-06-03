//
//  HookRepository.swift
//  ChainlessChain
//
//  钩子持久化仓库
//  管理钩子配置的存储和加载
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import CoreCommon

// MARK: - Hook Repository

/// 钩子仓库
public class HookRepository {
    public static let shared = HookRepository()

    // MARK: - Properties

    private let configDirectory: URL
    private let projectConfigFile: URL
    private let userConfigFile: URL
    private let scriptsDirectory: URL

    private var projectHooks: [HookConfig] = []
    private var userHooks: [HookConfig] = []

    private let lock = NSLock()

    // MARK: - Initialization

    private init() {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        configDirectory = documentsPath.appendingPathComponent(".chainlesschain")
        projectConfigFile = configDirectory.appendingPathComponent("hooks.json")
        userConfigFile = configDirectory.appendingPathComponent("user-hooks.json")
        scriptsDirectory = configDirectory.appendingPathComponent("hooks")

        createDirectoriesIfNeeded()
        loadAllHooks()

        Logger.shared.info("[HookRepository] 初始化完成")
    }

    // MARK: - Public Methods

    /// 获取所有钩子
    public func getAllHooks() -> [HookConfig] {
        lock.lock()
        defer { lock.unlock() }

        return projectHooks + userHooks
    }

    /// 获取项目级钩子
    public func getProjectHooks() -> [HookConfig] {
        lock.lock()
        defer { lock.unlock() }

        return projectHooks
    }

    /// 获取用户级钩子
    public func getUserHooks() -> [HookConfig] {
        lock.lock()
        defer { lock.unlock() }

        return userHooks
    }

    /// 获取指定事件的钩子
    public func getHooks(for event: HookEvent) -> [HookConfig] {
        return getAllHooks().filter { $0.event == event && $0.enabled }
            .sorted { $0.priority < $1.priority }
    }

    /// 获取钩子
    public func getHook(_ id: String) -> HookConfig? {
        return getAllHooks().first { $0.id == id }
    }

    /// 添加钩子
    public func addHook(_ hook: HookConfig, isUserLevel: Bool = false) throws {
        lock.lock()
        defer { lock.unlock() }

        if isUserLevel {
            userHooks.append(hook)
            try saveUserHooks()
        } else {
            projectHooks.append(hook)
            try saveProjectHooks()
        }

        Logger.shared.info("[HookRepository] 添加钩子: \(hook.name)")
    }

    /// 更新钩子
    public func updateHook(_ hook: HookConfig) throws {
        lock.lock()
        defer { lock.unlock() }

        // 查找并更新
        if let index = projectHooks.firstIndex(where: { $0.id == hook.id }) {
            projectHooks[index] = hook
            try saveProjectHooks()
        } else if let index = userHooks.firstIndex(where: { $0.id == hook.id }) {
            userHooks[index] = hook
            try saveUserHooks()
        }

        Logger.shared.info("[HookRepository] 更新钩子: \(hook.name)")
    }

    /// 删除钩子
    public func deleteHook(_ id: String) throws {
        lock.lock()
        defer { lock.unlock() }

        if let index = projectHooks.firstIndex(where: { $0.id == id }) {
            let hook = projectHooks.remove(at: index)
            try saveProjectHooks()
            Logger.shared.info("[HookRepository] 删除钩子: \(hook.name)")
        } else if let index = userHooks.firstIndex(where: { $0.id == id }) {
            let hook = userHooks.remove(at: index)
            try saveUserHooks()
            Logger.shared.info("[HookRepository] 删除钩子: \(hook.name)")
        }
    }

    /// 启用/禁用钩子
    public func setHookEnabled(_ id: String, enabled: Bool) throws {
        guard var hook = getHook(id) else { return }

        hook.enabled = enabled
        try updateHook(hook)

        Logger.shared.info("[HookRepository] 钩子 \(hook.name) \(enabled ? "已启用" : "已禁用")")
    }

    /// 更新钩子统计
    public func updateHookStats(_ id: String, executionTime: TimeInterval, success: Bool) {
        lock.lock()
        defer { lock.unlock() }

        if let index = projectHooks.firstIndex(where: { $0.id == id }) {
            projectHooks[index].executionCount += 1
            if !success {
                projectHooks[index].errorCount += 1
            }
            projectHooks[index].lastExecutedAt = Date()

            // 更新平均执行时间
            let oldAvg = projectHooks[index].avgExecutionTime
            let count = Double(projectHooks[index].executionCount)
            projectHooks[index].avgExecutionTime = oldAvg + (executionTime - oldAvg) / count

        } else if let index = userHooks.firstIndex(where: { $0.id == id }) {
            userHooks[index].executionCount += 1
            if !success {
                userHooks[index].errorCount += 1
            }
            userHooks[index].lastExecutedAt = Date()

            let oldAvg = userHooks[index].avgExecutionTime
            let count = Double(userHooks[index].executionCount)
            userHooks[index].avgExecutionTime = oldAvg + (executionTime - oldAvg) / count
        }
    }

    /// 保存脚本文件
    public func saveScript(name: String, content: String, language: ScriptLanguage) throws -> URL {
        let fileName = "\(name).\(language.fileExtension)"
        let scriptPath = scriptsDirectory.appendingPathComponent(fileName)

        try content.write(to: scriptPath, atomically: true, encoding: .utf8)

        Logger.shared.info("[HookRepository] 保存脚本: \(fileName)")

        return scriptPath
    }

    /// 加载脚本内容
    public func loadScript(name: String) throws -> String? {
        // 尝试不同扩展名
        for ext in ScriptLanguage.allCases.map({ $0.fileExtension }) {
            let scriptPath = scriptsDirectory.appendingPathComponent("\(name).\(ext)")
            if FileManager.default.fileExists(atPath: scriptPath.path) {
                return try String(contentsOf: scriptPath, encoding: .utf8)
            }
        }
        return nil
    }

    /// 获取所有脚本文件
    public func listScripts() -> [ScriptInfo] {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: scriptsDirectory,
            includingPropertiesForKeys: [.creationDateKey, .contentModificationDateKey]
        ) else {
            return []
        }

        return files.compactMap { url -> ScriptInfo? in
            let ext = url.pathExtension
            guard let language = ScriptLanguage.allCases.first(where: { $0.fileExtension == ext }) else {
                return nil
            }

            let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)

            return ScriptInfo(
                name: url.deletingPathExtension().lastPathComponent,
                language: language,
                path: url.path,
                createdAt: attrs?[.creationDate] as? Date,
                modifiedAt: attrs?[.modificationDate] as? Date,
                size: attrs?[.size] as? Int ?? 0
            )
        }
    }

    /// 删除脚本
    public func deleteScript(name: String) throws {
        for ext in ScriptLanguage.allCases.map({ $0.fileExtension }) {
            let scriptPath = scriptsDirectory.appendingPathComponent("\(name).\(ext)")
            if FileManager.default.fileExists(atPath: scriptPath.path) {
                try FileManager.default.removeItem(at: scriptPath)
                Logger.shared.info("[HookRepository] 删除脚本: \(name).\(ext)")
                return
            }
        }
    }

    /// 导出配置
    public func exportConfig() throws -> Data {
        let export = HookExport(
            version: "1.0",
            exportedAt: Date(),
            projectHooks: projectHooks,
            userHooks: userHooks
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        return try encoder.encode(export)
    }

    /// 导入配置
    public func importConfig(from data: Data, merge: Bool = true) throws {
        let decoder = JSONDecoder()
        let imported = try decoder.decode(HookExport.self, from: data)

        lock.lock()
        defer { lock.unlock() }

        if merge {
            // 合并，跳过已存在的
            let existingIds = Set(getAllHooks().map { $0.id })

            for hook in imported.projectHooks where !existingIds.contains(hook.id) {
                projectHooks.append(hook)
            }

            for hook in imported.userHooks where !existingIds.contains(hook.id) {
                userHooks.append(hook)
            }
        } else {
            // 替换
            projectHooks = imported.projectHooks
            userHooks = imported.userHooks
        }

        try saveProjectHooks()
        try saveUserHooks()

        Logger.shared.info("[HookRepository] 导入配置: \(imported.projectHooks.count + imported.userHooks.count) 个钩子")
    }

    /// 重新加载配置
    public func reload() {
        loadAllHooks()
        Logger.shared.info("[HookRepository] 配置已重新加载")
    }

    // MARK: - Private Methods

    private func createDirectoriesIfNeeded() {
        let directories = [configDirectory, scriptsDirectory]

        for dir in directories {
            if !FileManager.default.fileExists(atPath: dir.path) {
                try? FileManager.default.createDirectory(
                    at: dir,
                    withIntermediateDirectories: true
                )
            }
        }
    }

    private func loadAllHooks() {
        loadProjectHooks()
        loadUserHooks()
        loadScriptHooks()
    }

    private func loadProjectHooks() {
        guard FileManager.default.fileExists(atPath: projectConfigFile.path) else {
            projectHooks = []
            return
        }

        do {
            let data = try Data(contentsOf: projectConfigFile)
            let config = try JSONDecoder().decode(HookConfigFile.self, from: data)
            projectHooks = config.hooks
            Logger.shared.info("[HookRepository] 加载了 \(projectHooks.count) 个项目钩子")
        } catch {
            Logger.shared.error("[HookRepository] 加载项目钩子失败: \(error)")
            projectHooks = []
        }
    }

    private func loadUserHooks() {
        guard FileManager.default.fileExists(atPath: userConfigFile.path) else {
            userHooks = []
            return
        }

        do {
            let data = try Data(contentsOf: userConfigFile)
            let config = try JSONDecoder().decode(HookConfigFile.self, from: data)
            userHooks = config.hooks
            Logger.shared.info("[HookRepository] 加载了 \(userHooks.count) 个用户钩子")
        } catch {
            Logger.shared.error("[HookRepository] 加载用户钩子失败: \(error)")
            userHooks = []
        }
    }

    private func loadScriptHooks() {
        // 自动加载scripts目录中的脚本作为钩子
        let scripts = listScripts()

        for script in scripts {
            // 检查是否已注册
            let exists = getAllHooks().contains { $0.script == script.path }
            if !exists {
                // 从脚本文件名解析事件类型
                if let event = parseEventFromScriptName(script.name) {
                    let hook = HookConfig(
                        event: event,
                        name: script.name,
                        type: .script,
                        script: script.path
                    )
                    projectHooks.append(hook)
                    Logger.shared.debug("[HookRepository] 自动加载脚本钩子: \(script.name)")
                }
            }
        }
    }

    private func parseEventFromScriptName(_ name: String) -> HookEvent? {
        // 格式: pre-tool-use.js -> PreToolUse
        let normalized = name.replacingOccurrences(of: "-", with: "")
            .lowercased()

        for event in HookEvent.allCases {
            if event.rawValue.lowercased() == normalized {
                return event
            }
        }
        return nil
    }

    private func saveProjectHooks() throws {
        let config = HookConfigFile(hooks: projectHooks)
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        let data = try encoder.encode(config)
        try data.write(to: projectConfigFile)
    }

    private func saveUserHooks() throws {
        let config = HookConfigFile(hooks: userHooks)
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        let data = try encoder.encode(config)
        try data.write(to: userConfigFile)
    }
}

// MARK: - Supporting Types

/// 脚本语言
public enum ScriptLanguage: String, CaseIterable, Codable {
    case javascript = "javascript"
    case python = "python"
    case bash = "bash"

    public var fileExtension: String {
        switch self {
        case .javascript: return "js"
        case .python: return "py"
        case .bash: return "sh"
        }
    }

    public var displayName: String {
        switch self {
        case .javascript: return "JavaScript"
        case .python: return "Python"
        case .bash: return "Bash"
        }
    }
}

/// 脚本信息
public struct ScriptInfo {
    public let name: String
    public let language: ScriptLanguage
    public let path: String
    public let createdAt: Date?
    public let modifiedAt: Date?
    public let size: Int

    public var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(size))
    }
}

/// 钩子配置文件
private struct HookConfigFile: Codable {
    let hooks: [HookConfig]
}

/// 钩子导出
private struct HookExport: Codable {
    let version: String
    let exportedAt: Date
    let projectHooks: [HookConfig]
    let userHooks: [HookConfig]
}
