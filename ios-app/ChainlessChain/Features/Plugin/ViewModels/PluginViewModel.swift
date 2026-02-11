//
//  PluginViewModel.swift
//  ChainlessChain
//
//  插件视图模型
//  管理插件UI状态
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import Combine
import CoreCommon

// MARK: - Plugin ViewModel

/// 插件视图模型
@MainActor
public class PluginViewModel: ObservableObject {
    public static let shared = PluginViewModel()

    // MARK: - Published Properties

    @Published public var installedPlugins: [Plugin] = []
    @Published public var activePlugins: [PluginInstance] = []
    @Published public var marketplacePlugins: [MarketplacePlugin] = []

    @Published public var selectedPlugin: Plugin?
    @Published public var selectedCategory: PluginCategory?

    @Published public var searchText: String = ""
    @Published public var isLoading: Bool = false
    @Published public var error: PluginError?

    // 过滤后的插件
    public var filteredPlugins: [Plugin] {
        var result = installedPlugins

        if let category = selectedCategory {
            result = result.filter { $0.category == category }
        }

        if !searchText.isEmpty {
            let query = searchText.lowercased()
            result = result.filter {
                $0.name.lowercased().contains(query) ||
                $0.description.lowercased().contains(query) ||
                $0.tags.contains { $0.lowercased().contains(query) }
            }
        }

        return result
    }

    // 分类统计
    public var categoryStats: [PluginCategory: Int] {
        var stats: [PluginCategory: Int] = [:]
        for plugin in installedPlugins {
            stats[plugin.category, default: 0] += 1
        }
        return stats
    }

    // MARK: - Private Properties

    private let manager: PluginManager
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        self.manager = PluginManager.shared

        setupBindings()
        loadPlugins()
    }

    // MARK: - Public Methods

    /// 加载插件
    public func loadPlugins() {
        isLoading = true

        installedPlugins = manager.installedPlugins
        activePlugins = Array(manager.activePlugins.values)

        isLoading = false
    }

    /// 安装插件
    public func installPlugin(from url: URL) async throws {
        isLoading = true
        error = nil

        do {
            _ = try await manager.installPlugin(from: url)
            loadPlugins()
        } catch let err as PluginError {
            error = err
            throw err
        } catch {
            let pluginError = PluginError.loadFailed(error.localizedDescription)
            self.error = pluginError
            throw pluginError
        }

        isLoading = false
    }

    /// 卸载插件
    public func uninstallPlugin(_ pluginId: String) async throws {
        isLoading = true

        do {
            try await manager.uninstallPlugin(pluginId)
            loadPlugins()

            if selectedPlugin?.id == pluginId {
                selectedPlugin = nil
            }
        } catch let err as PluginError {
            error = err
            throw err
        }

        isLoading = false
    }

    /// 激活插件
    public func activatePlugin(_ pluginId: String) async throws {
        do {
            try await manager.activatePlugin(pluginId)
            loadPlugins()
        } catch let err as PluginError {
            error = err
            throw err
        }
    }

    /// 停用插件
    public func deactivatePlugin(_ pluginId: String) async {
        await manager.deactivatePlugin(pluginId)
        loadPlugins()
    }

    /// 启用插件
    public func enablePlugin(_ pluginId: String) async throws {
        try await manager.enablePlugin(pluginId)
        loadPlugins()
    }

    /// 禁用插件
    public func disablePlugin(_ pluginId: String) async throws {
        try await manager.disablePlugin(pluginId)
        loadPlugins()
    }

    /// 执行插件动作
    public func executeAction(
        _ pluginId: String,
        action: String,
        params: [String: Any] = [:]
    ) async throws -> PluginActionResult {
        return try await manager.executeAction(pluginId, action: action, params: params)
    }

    /// 获取插件
    public func getPlugin(_ pluginId: String) -> Plugin? {
        return installedPlugins.first { $0.id == pluginId }
    }

    /// 获取插件实例
    public func getInstance(_ pluginId: String) -> PluginInstance? {
        return activePlugins.first { $0.id == pluginId }
    }

    /// 检查插件是否激活
    public func isPluginActive(_ pluginId: String) -> Bool {
        return activePlugins.contains { $0.id == pluginId }
    }

    /// 加载市场插件
    public func loadMarketplacePlugins() async {
        isLoading = true

        // 模拟从服务器加载
        await Task.sleep(500_000_000) // 0.5秒

        // 模拟数据
        marketplacePlugins = [
            MarketplacePlugin(
                id: "market.translator",
                name: "AI Translator",
                version: "2.0.0",
                description: "智能翻译插件，支持100+语言",
                author: "TranslateTeam",
                icon: "globe",
                category: .productivity,
                tags: ["translate", "language", "ai"],
                downloadUrl: "https://example.com/plugins/translator.zip",
                size: 2_500_000,
                downloads: 50000,
                rating: 4.8,
                reviewCount: 1200,
                createdAt: Date().addingTimeInterval(-86400 * 60),
                updatedAt: Date().addingTimeInterval(-86400 * 3),
                screenshots: ["screenshot1.png", "screenshot2.png"],
                changelog: "- 新增10种语言支持\n- 优化翻译速度",
                permissions: PluginPermissions(
                    network: NetworkPermission(http: true),
                    ai: AIPermission(chat: true)
                )
            ),
            MarketplacePlugin(
                id: "market.code_formatter",
                name: "Code Formatter",
                version: "1.5.0",
                description: "代码格式化工具，支持多种编程语言",
                author: "DevTools",
                icon: "doc.text.magnifyingglass",
                category: .developer,
                tags: ["code", "format", "developer"],
                downloadUrl: "https://example.com/plugins/formatter.zip",
                size: 1_200_000,
                downloads: 35000,
                rating: 4.6,
                reviewCount: 800,
                createdAt: Date().addingTimeInterval(-86400 * 90),
                updatedAt: Date().addingTimeInterval(-86400 * 7),
                screenshots: ["format1.png"],
                changelog: "- 支持Swift 5.9\n- 修复缩进问题",
                permissions: PluginPermissions(
                    filesystem: FileSystemPermission(read: true, write: true)
                )
            )
        ]

        isLoading = false
    }

    /// 搜索市场插件
    public func searchMarketplace(_ query: String) async {
        guard !query.isEmpty else {
            await loadMarketplacePlugins()
            return
        }

        isLoading = true

        // 模拟搜索
        await Task.sleep(300_000_000)

        marketplacePlugins = marketplacePlugins.filter {
            $0.name.lowercased().contains(query.lowercased()) ||
            $0.description.lowercased().contains(query.lowercased())
        }

        isLoading = false
    }

    /// 下载并安装市场插件
    public func installFromMarketplace(_ plugin: MarketplacePlugin) async throws {
        isLoading = true

        do {
            // 下载插件
            guard let url = URL(string: plugin.downloadUrl) else {
                throw PluginError.loadFailed("无效的下载地址")
            }

            // 模拟下载
            await Task.sleep(1_000_000_000)

            // 安装插件
            // 实际应该先下载到临时目录，然后安装
            // 这里简化处理
            _ = try await manager.installPlugin(from: url)

            loadPlugins()

        } catch {
            self.error = error as? PluginError ?? PluginError.loadFailed(error.localizedDescription)
            throw self.error!
        }

        isLoading = false
    }

    // MARK: - Private Methods

    private func setupBindings() {
        // 监听管理器变化
        manager.$installedPlugins
            .receive(on: DispatchQueue.main)
            .sink { [weak self] plugins in
                self?.installedPlugins = plugins
            }
            .store(in: &cancellables)

        manager.$activePlugins
            .receive(on: DispatchQueue.main)
            .sink { [weak self] plugins in
                self?.activePlugins = Array(plugins.values)
            }
            .store(in: &cancellables)

        // 监听事件
        manager.eventStream()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.handleEvent(event)
            }
            .store(in: &cancellables)
    }

    private func handleEvent(_ event: PluginEvent) {
        switch event.type {
        case .installed, .uninstalled, .enabled, .disabled:
            loadPlugins()

        case .error:
            if let errorMsg = event.data?["error"] as? String {
                error = PluginError.executionFailed(errorMsg)
            }

        default:
            break
        }
    }
}

// MARK: - Task Extension

private extension Task where Success == Never, Failure == Never {
    static func sleep(_ nanoseconds: UInt64) async {
        try? await Task.sleep(nanoseconds: nanoseconds)
    }
}
