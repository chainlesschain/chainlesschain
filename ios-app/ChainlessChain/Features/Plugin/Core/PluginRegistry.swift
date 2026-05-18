//
//  PluginRegistry.swift
//  ChainlessChain
//
//  插件注册表
//  管理插件的注册和查询
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import Combine
import CoreCommon

// MARK: - Plugin Registry

/// 插件注册表
public class PluginRegistry {
    public static let shared = PluginRegistry()

    // MARK: - Private Properties

    private var plugins: [String: Plugin] = [:]
    private var pluginsByCategory: [PluginCategory: [String]] = [:]
    private var pluginsByTag: [String: Set<String>] = [:]

    private let lock = NSLock()
    private let configPath: URL

    // MARK: - Initialization

    private init() {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        self.configPath = documentsPath.appendingPathComponent(".chainlesschain/plugin-registry.json")

        loadRegistry()
    }

    // MARK: - Public Methods

    /// 注册插件
    public func registerPlugin(_ plugin: Plugin) {
        lock.lock()
        defer { lock.unlock() }

        plugins[plugin.id] = plugin

        // 索引分类
        if pluginsByCategory[plugin.category] == nil {
            pluginsByCategory[plugin.category] = []
        }
        if !pluginsByCategory[plugin.category]!.contains(plugin.id) {
            pluginsByCategory[plugin.category]!.append(plugin.id)
        }

        // 索引标签
        for tag in plugin.tags {
            if pluginsByTag[tag] == nil {
                pluginsByTag[tag] = Set()
            }
            pluginsByTag[tag]!.insert(plugin.id)
        }

        saveRegistry()

        Logger.shared.info("[PluginRegistry] 注册插件: \(plugin.name)")
    }

    /// 注销插件
    public func unregisterPlugin(_ pluginId: String) {
        lock.lock()
        defer { lock.unlock() }

        guard let plugin = plugins[pluginId] else { return }

        // 移除分类索引
        pluginsByCategory[plugin.category]?.removeAll { $0 == pluginId }

        // 移除标签索引
        for tag in plugin.tags {
            pluginsByTag[tag]?.remove(pluginId)
        }

        plugins.removeValue(forKey: pluginId)

        saveRegistry()

        Logger.shared.info("[PluginRegistry] 注销插件: \(pluginId)")
    }

    /// 更新插件
    public func updatePlugin(_ plugin: Plugin) {
        lock.lock()
        defer { lock.unlock() }

        let oldPlugin = plugins[plugin.id]

        // 更新索引
        if let old = oldPlugin {
            // 移除旧分类
            if old.category != plugin.category {
                pluginsByCategory[old.category]?.removeAll { $0 == plugin.id }
            }

            // 移除旧标签
            for tag in old.tags where !plugin.tags.contains(tag) {
                pluginsByTag[tag]?.remove(plugin.id)
            }
        }

        plugins[plugin.id] = plugin

        // 添加新分类
        if pluginsByCategory[plugin.category] == nil {
            pluginsByCategory[plugin.category] = []
        }
        if !pluginsByCategory[plugin.category]!.contains(plugin.id) {
            pluginsByCategory[plugin.category]!.append(plugin.id)
        }

        // 添加新标签
        for tag in plugin.tags {
            if pluginsByTag[tag] == nil {
                pluginsByTag[tag] = Set()
            }
            pluginsByTag[tag]!.insert(plugin.id)
        }

        saveRegistry()

        Logger.shared.info("[PluginRegistry] 更新插件: \(plugin.name)")
    }

    /// 获取插件
    public func getPlugin(_ pluginId: String) -> Plugin? {
        lock.lock()
        defer { lock.unlock() }

        return plugins[pluginId]
    }

    /// 获取所有插件
    public func getAllPlugins() -> [Plugin] {
        lock.lock()
        defer { lock.unlock() }

        return Array(plugins.values)
    }

    /// 按分类获取插件
    public func getPlugins(category: PluginCategory) -> [Plugin] {
        lock.lock()
        defer { lock.unlock() }

        guard let ids = pluginsByCategory[category] else { return [] }
        return ids.compactMap { plugins[$0] }
    }

    /// 按标签获取插件
    public func getPlugins(tag: String) -> [Plugin] {
        lock.lock()
        defer { lock.unlock() }

        guard let ids = pluginsByTag[tag] else { return [] }
        return ids.compactMap { plugins[$0] }
    }

    /// 搜索插件
    public func searchPlugins(query: String) -> [Plugin] {
        lock.lock()
        defer { lock.unlock() }

        let lowercasedQuery = query.lowercased()

        return plugins.values.filter { plugin in
            plugin.name.lowercased().contains(lowercasedQuery) ||
            plugin.description.lowercased().contains(lowercasedQuery) ||
            plugin.tags.contains { $0.lowercased().contains(lowercasedQuery) }
        }
    }

    /// 获取已启用的插件
    public func getEnabledPlugins() -> [Plugin] {
        lock.lock()
        defer { lock.unlock() }

        return plugins.values.filter { $0.isEnabled }
    }

    /// 获取已安装的插件
    public func getInstalledPlugins() -> [Plugin] {
        lock.lock()
        defer { lock.unlock() }

        return plugins.values.filter { $0.isInstalled }
    }

    /// 检查插件是否存在
    public func hasPlugin(_ pluginId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }

        return plugins[pluginId] != nil
    }

    /// 获取插件数量
    public var pluginCount: Int {
        lock.lock()
        defer { lock.unlock() }

        return plugins.count
    }

    /// 获取分类统计
    public func getCategoryStats() -> [PluginCategory: Int] {
        lock.lock()
        defer { lock.unlock() }

        var stats: [PluginCategory: Int] = [:]
        for (category, ids) in pluginsByCategory {
            stats[category] = ids.count
        }
        return stats
    }

    /// 获取所有标签
    public func getAllTags() -> [String] {
        lock.lock()
        defer { lock.unlock() }

        return Array(pluginsByTag.keys).sorted()
    }

    /// 清空注册表
    public func clear() {
        lock.lock()
        defer { lock.unlock() }

        plugins.removeAll()
        pluginsByCategory.removeAll()
        pluginsByTag.removeAll()

        saveRegistry()

        Logger.shared.info("[PluginRegistry] 注册表已清空")
    }

    // MARK: - Private Methods

    private func loadRegistry() {
        guard FileManager.default.fileExists(atPath: configPath.path) else {
            Logger.shared.info("[PluginRegistry] 注册表文件不存在，使用空注册表")
            loadBuiltinPlugins()
            return
        }

        do {
            let data = try Data(contentsOf: configPath)
            let registry = try JSONDecoder().decode(RegistryData.self, from: data)

            for plugin in registry.plugins {
                registerPlugin(plugin)
            }

            Logger.shared.info("[PluginRegistry] 加载了 \(registry.plugins.count) 个插件")

        } catch {
            Logger.shared.error("[PluginRegistry] 加载注册表失败: \(error)")
            loadBuiltinPlugins()
        }
    }

    private func saveRegistry() {
        do {
            let registry = RegistryData(plugins: Array(plugins.values))
            let data = try JSONEncoder().encode(registry)

            // 确保目录存在
            let directory = configPath.deletingLastPathComponent()
            if !FileManager.default.fileExists(atPath: directory.path) {
                try FileManager.default.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true
                )
            }

            try data.write(to: configPath)

        } catch {
            Logger.shared.error("[PluginRegistry] 保存注册表失败: \(error)")
        }
    }

    private func loadBuiltinPlugins() {
        // 注册内置插件
        let builtinPlugins: [Plugin] = [
            createOfficePlugin(),
            createDataAnalysisPlugin(),
            createGitPlugin()
        ]

        for plugin in builtinPlugins {
            var installedPlugin = plugin
            installedPlugin.isInstalled = true
            installedPlugin.installedAt = Date()
            registerPlugin(installedPlugin)
        }

        Logger.shared.info("[PluginRegistry] 加载了 \(builtinPlugins.count) 个内置插件")
    }

    private func createOfficePlugin() -> Plugin {
        return Plugin(
            id: "builtin.office",
            name: "Office Suite",
            version: "1.0.0",
            description: "办公文档处理插件，支持Word、Excel、PDF等格式",
            author: "ChainlessChain",
            icon: "doc.text.fill",
            category: .office,
            tags: ["office", "word", "excel", "pdf"],
            permissions: PluginPermissions(
                filesystem: FileSystemPermission(read: true, write: true)
            ),
            manifest: PluginManifest(
                actions: [
                    PluginActionDefinition(
                        id: "read_document",
                        name: "读取文档",
                        description: "读取Office文档内容",
                        icon: "doc.text",
                        handler: "readDocument"
                    ),
                    PluginActionDefinition(
                        id: "convert_pdf",
                        name: "转换PDF",
                        description: "将文档转换为PDF",
                        icon: "doc.richtext",
                        handler: "convertToPdf"
                    ),
                    PluginActionDefinition(
                        id: "extract_data",
                        name: "提取数据",
                        description: "从Excel提取数据",
                        icon: "tablecells",
                        handler: "extractData"
                    )
                ]
            ),
            isEnabled: true
        )
    }

    private func createDataAnalysisPlugin() -> Plugin {
        return Plugin(
            id: "builtin.data_analysis",
            name: "Data Analysis",
            version: "1.0.0",
            description: "数据分析插件，提供统计分析和可视化功能",
            author: "ChainlessChain",
            icon: "chart.bar.fill",
            category: .dataAnalysis,
            tags: ["data", "analysis", "statistics", "visualization"],
            permissions: PluginPermissions(
                filesystem: FileSystemPermission(read: true),
                ai: AIPermission(chat: true, embedding: true)
            ),
            manifest: PluginManifest(
                actions: [
                    PluginActionDefinition(
                        id: "analyze_csv",
                        name: "分析CSV",
                        description: "分析CSV文件数据",
                        icon: "chart.bar.xaxis",
                        handler: "analyzeCsv"
                    ),
                    PluginActionDefinition(
                        id: "generate_report",
                        name: "生成报告",
                        description: "生成数据分析报告",
                        icon: "doc.text.magnifyingglass",
                        handler: "generateReport"
                    ),
                    PluginActionDefinition(
                        id: "visualize_data",
                        name: "可视化数据",
                        description: "创建数据可视化图表",
                        icon: "chart.pie.fill",
                        handler: "visualizeData"
                    )
                ]
            ),
            isEnabled: true
        )
    }

    private func createGitPlugin() -> Plugin {
        return Plugin(
            id: "builtin.git",
            name: "Git Integration",
            version: "1.0.0",
            description: "Git版本控制集成插件",
            author: "ChainlessChain",
            icon: "arrow.triangle.branch",
            category: .developer,
            tags: ["git", "version control", "developer"],
            permissions: PluginPermissions(
                filesystem: FileSystemPermission(read: true, write: true, execute: true),
                system: SystemPermission(shell: true)
            ),
            manifest: PluginManifest(
                actions: [
                    PluginActionDefinition(
                        id: "git_status",
                        name: "Git Status",
                        description: "查看仓库状态",
                        icon: "info.circle",
                        handler: "gitStatus"
                    ),
                    PluginActionDefinition(
                        id: "git_commit",
                        name: "Git Commit",
                        description: "提交更改",
                        icon: "checkmark.circle",
                        handler: "gitCommit"
                    ),
                    PluginActionDefinition(
                        id: "git_diff",
                        name: "Git Diff",
                        description: "查看差异",
                        icon: "arrow.left.arrow.right",
                        handler: "gitDiff"
                    )
                ]
            ),
            isEnabled: true
        )
    }
}

// MARK: - Registry Data

private struct RegistryData: Codable {
    let plugins: [Plugin]
}
