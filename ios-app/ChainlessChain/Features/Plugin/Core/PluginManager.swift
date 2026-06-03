//
//  PluginManager.swift
//  ChainlessChain
//
//  插件管理器
//  核心插件生命周期管理
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import Combine
import CoreCommon

// MARK: - Plugin Manager

/// 插件管理器
@MainActor
public class PluginManager: ObservableObject {
    public static let shared = PluginManager()

    // MARK: - Published Properties

    @Published public var installedPlugins: [Plugin] = []
    @Published public var activePlugins: [String: PluginInstance] = [:]
    @Published public var isLoading: Bool = false
    @Published public var error: PluginError?

    // MARK: - Private Properties

    private let registry: PluginRegistry
    private let loader: PluginLoader
    private let validator: PluginValidator
    private let securityPolicy: PluginSecurityPolicy

    private var cancellables = Set<AnyCancellable>()
    private var eventSubject = PassthroughSubject<PluginEvent, Never>()

    // 配置
    private let pluginsDirectory: URL
    private let configDirectory: URL

    // MARK: - Initialization

    private init() {
        // 初始化目录
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        self.pluginsDirectory = documentsPath.appendingPathComponent("Plugins")
        self.configDirectory = documentsPath.appendingPathComponent(".chainlesschain")

        // 初始化组件
        self.registry = PluginRegistry.shared
        self.loader = PluginLoader.shared
        self.validator = PluginValidator.shared
        self.securityPolicy = PluginSecurityPolicy.shared

        // 确保目录存在
        createDirectoriesIfNeeded()

        // 加载已安装插件
        Task {
            await loadInstalledPlugins()
        }

        Logger.shared.info("[PluginManager] 初始化完成")
    }

    // MARK: - Public Methods

    /// 安装插件
    public func installPlugin(from url: URL) async throws -> Plugin {
        Logger.shared.info("[PluginManager] 开始安装插件: \(url.lastPathComponent)")

        isLoading = true
        defer { isLoading = false }

        // 验证插件
        let validationResult = try await validator.validatePlugin(at: url)
        guard validationResult.isValid else {
            throw PluginError.validationFailed(validationResult.errors.joined(separator: ", "))
        }

        // 加载插件
        let plugin = try await loader.loadPlugin(from: url)

        // 检查依赖
        try await checkDependencies(plugin)

        // 复制到插件目录
        let pluginPath = pluginsDirectory.appendingPathComponent(plugin.id)
        try FileManager.default.copyItem(at: url, to: pluginPath)

        // 更新插件状态
        var installedPlugin = plugin
        installedPlugin.isInstalled = true
        installedPlugin.installedAt = Date()

        // 注册插件
        registry.registerPlugin(installedPlugin)

        // 保存配置
        try savePluginConfig(installedPlugin)

        // 更新列表
        installedPlugins.append(installedPlugin)

        // 发送事件
        emitEvent(PluginEvent(
            pluginId: plugin.id,
            type: .installed
        ))

        Logger.shared.info("[PluginManager] 插件安装成功: \(plugin.name)")

        return installedPlugin
    }

    /// 卸载插件
    public func uninstallPlugin(_ pluginId: String) async throws {
        Logger.shared.info("[PluginManager] 卸载插件: \(pluginId)")

        // 先停用
        await deactivatePlugin(pluginId)

        // 从注册表移除
        registry.unregisterPlugin(pluginId)

        // 删除文件
        let pluginPath = pluginsDirectory.appendingPathComponent(pluginId)
        if FileManager.default.fileExists(atPath: pluginPath.path) {
            try FileManager.default.removeItem(at: pluginPath)
        }

        // 删除配置
        let configPath = configDirectory.appendingPathComponent("plugins/\(pluginId).json")
        if FileManager.default.fileExists(atPath: configPath.path) {
            try FileManager.default.removeItem(at: configPath)
        }

        // 更新列表
        installedPlugins.removeAll { $0.id == pluginId }

        // 发送事件
        emitEvent(PluginEvent(
            pluginId: pluginId,
            type: .uninstalled
        ))

        Logger.shared.info("[PluginManager] 插件卸载成功: \(pluginId)")
    }

    /// 激活插件
    public func activatePlugin(_ pluginId: String) async throws {
        Logger.shared.info("[PluginManager] 激活插件: \(pluginId)")

        guard let plugin = installedPlugins.first(where: { $0.id == pluginId }) else {
            throw PluginError.notFound(pluginId)
        }

        guard plugin.isEnabled else {
            throw PluginError.permissionDenied("插件已禁用")
        }

        // 检查是否已激活
        if activePlugins[pluginId] != nil {
            Logger.shared.warning("[PluginManager] 插件已激活: \(pluginId)")
            return
        }

        // 创建实例
        let instance = PluginInstance(plugin: plugin)
        instance.state = .loading

        // 创建沙箱
        let sandbox = await createSandbox(for: plugin)
        instance.sandbox = sandbox

        // 加载动作
        do {
            instance.loadedActions = try await loader.loadActions(for: plugin)
            instance.state = .active
            instance.lastActivity = Date()

            activePlugins[pluginId] = instance

            // 发送事件
            emitEvent(PluginEvent(
                pluginId: pluginId,
                type: .loaded
            ))

            Logger.shared.info("[PluginManager] 插件激活成功: \(plugin.name)")

        } catch {
            instance.state = .error
            instance.error = error as? PluginError ?? PluginError.loadFailed(error.localizedDescription)
            throw instance.error!
        }
    }

    /// 停用插件
    public func deactivatePlugin(_ pluginId: String) async {
        Logger.shared.info("[PluginManager] 停用插件: \(pluginId)")

        guard let instance = activePlugins[pluginId] else {
            return
        }

        // 清理沙箱
        instance.sandbox = nil
        instance.loadedActions.removeAll()
        instance.state = .installed

        activePlugins.removeValue(forKey: pluginId)

        // 发送事件
        emitEvent(PluginEvent(
            pluginId: pluginId,
            type: .unloaded
        ))

        Logger.shared.info("[PluginManager] 插件停用成功: \(pluginId)")
    }

    /// 启用插件
    public func enablePlugin(_ pluginId: String) async throws {
        guard let index = installedPlugins.firstIndex(where: { $0.id == pluginId }) else {
            throw PluginError.notFound(pluginId)
        }

        installedPlugins[index].isEnabled = true
        try savePluginConfig(installedPlugins[index])

        emitEvent(PluginEvent(
            pluginId: pluginId,
            type: .enabled
        ))

        Logger.shared.info("[PluginManager] 插件已启用: \(pluginId)")
    }

    /// 禁用插件
    public func disablePlugin(_ pluginId: String) async throws {
        // 先停用
        await deactivatePlugin(pluginId)

        guard let index = installedPlugins.firstIndex(where: { $0.id == pluginId }) else {
            throw PluginError.notFound(pluginId)
        }

        installedPlugins[index].isEnabled = false
        try savePluginConfig(installedPlugins[index])

        emitEvent(PluginEvent(
            pluginId: pluginId,
            type: .disabled
        ))

        Logger.shared.info("[PluginManager] 插件已禁用: \(pluginId)")
    }

    /// 执行插件动作
    public func executeAction(
        _ pluginId: String,
        action actionId: String,
        params: [String: Any] = [:]
    ) async throws -> PluginActionResult {
        let startTime = Date()

        Logger.shared.info("[PluginManager] 执行动作: \(pluginId).\(actionId)")

        guard let instance = activePlugins[pluginId] else {
            throw PluginError.notFound("插件未激活: \(pluginId)")
        }

        guard let action = instance.loadedActions[actionId] else {
            throw PluginError.notFound("动作未找到: \(actionId)")
        }

        // 权限检查
        let permissionResult = await securityPolicy.checkActionPermission(
            plugin: instance.plugin,
            action: action,
            params: params
        )

        guard permissionResult.allowed else {
            throw PluginError.permissionDenied(permissionResult.reason ?? "权限不足")
        }

        // 执行动作
        do {
            let output = try await executeInSandbox(
                instance: instance,
                action: action,
                params: params
            )

            let executionTime = Date().timeIntervalSince(startTime)

            // 更新统计
            instance.lastActivity = Date()
            updatePluginUsage(pluginId)

            // 发送事件
            emitEvent(PluginEvent(
                pluginId: pluginId,
                type: .actionExecuted,
                data: [
                    "actionId": actionId,
                    "success": true,
                    "executionTime": executionTime
                ]
            ))

            Logger.shared.info("[PluginManager] 动作执行成功: \(actionId) (\(Int(executionTime * 1000))ms)")

            return PluginActionResult.success(output, time: executionTime)

        } catch {
            let executionTime = Date().timeIntervalSince(startTime)

            let pluginError = error as? PluginError ?? PluginError.executionFailed(error.localizedDescription)

            // 发送错误事件
            emitEvent(PluginEvent(
                pluginId: pluginId,
                type: .error,
                data: [
                    "actionId": actionId,
                    "error": pluginError.localizedDescription
                ]
            ))

            Logger.shared.error("[PluginManager] 动作执行失败: \(error)")

            return PluginActionResult.failure(pluginError, time: executionTime)
        }
    }

    /// 获取插件
    public func getPlugin(_ pluginId: String) -> Plugin? {
        return installedPlugins.first { $0.id == pluginId }
    }

    /// 获取插件实例
    public func getInstance(_ pluginId: String) -> PluginInstance? {
        return activePlugins[pluginId]
    }

    /// 获取插件事件流
    public func eventStream() -> AnyPublisher<PluginEvent, Never> {
        return eventSubject.eraseToAnyPublisher()
    }

    // MARK: - Private Methods

    private func createDirectoriesIfNeeded() {
        let directories = [
            pluginsDirectory,
            configDirectory.appendingPathComponent("plugins")
        ]

        for dir in directories {
            if !FileManager.default.fileExists(atPath: dir.path) {
                try? FileManager.default.createDirectory(
                    at: dir,
                    withIntermediateDirectories: true
                )
            }
        }
    }

    private func loadInstalledPlugins() async {
        Logger.shared.info("[PluginManager] 加载已安装插件")

        isLoading = true
        defer { isLoading = false }

        // 从注册表加载
        let plugins = registry.getAllPlugins()
        installedPlugins = plugins

        // 自动激活启用的插件
        for plugin in plugins where plugin.isEnabled && plugin.manifest.manifest.autoConnect ?? false {
            do {
                try await activatePlugin(plugin.id)
            } catch {
                Logger.shared.error("[PluginManager] 自动激活失败: \(plugin.name) - \(error)")
            }
        }

        Logger.shared.info("[PluginManager] 加载了 \(plugins.count) 个插件")
    }

    private func checkDependencies(_ plugin: Plugin) async throws {
        for dependency in plugin.manifest.dependencies {
            let hasPlugin = installedPlugins.contains { $0.id == dependency.pluginId }

            if !hasPlugin && !dependency.optional {
                throw PluginError.dependencyMissing("\(dependency.pluginId)@\(dependency.version)")
            }
        }
    }

    private func createSandbox(for plugin: Plugin) async -> PluginSandboxContext {
        let sandbox = PluginSandboxContext(pluginId: plugin.id)

        // 配置文件系统权限
        sandbox.allowedPaths = plugin.permissions.filesystem.allowedPaths
        sandbox.deniedPaths = plugin.permissions.filesystem.deniedPaths

        // 配置网络权限
        sandbox.networkAllowed = plugin.permissions.network.http || plugin.permissions.network.websocket
        sandbox.allowedDomains = plugin.permissions.network.allowedDomains

        return sandbox
    }

    private func executeInSandbox(
        instance: PluginInstance,
        action: PluginAction,
        params: [String: Any]
    ) async throws -> Any? {
        // 这里是简化的执行逻辑
        // 实际应该在沙箱环境中执行插件代码

        // 超时控制
        return try await withTimeout(seconds: action.timeout) {
            // 模拟执行
            // 实际实现需要调用插件的具体处理器
            return ["status": "executed", "action": action.name, "params": params]
        }
    }

    private func withTimeout<T>(seconds: TimeInterval, operation: @escaping () async throws -> T) async throws -> T {
        return try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }

            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                throw PluginError.timeout("操作超时")
            }

            guard let result = try await group.next() else {
                throw PluginError.executionFailed("无结果")
            }

            group.cancelAll()
            return result
        }
    }

    private func savePluginConfig(_ plugin: Plugin) throws {
        let configPath = configDirectory.appendingPathComponent("plugins/\(plugin.id).json")
        let data = try JSONEncoder().encode(plugin)
        try data.write(to: configPath)
    }

    private func updatePluginUsage(_ pluginId: String) {
        if let index = installedPlugins.firstIndex(where: { $0.id == pluginId }) {
            installedPlugins[index].usageCount += 1
            installedPlugins[index].lastUsedAt = Date()
        }
    }

    private func emitEvent(_ event: PluginEvent) {
        eventSubject.send(event)
    }
}

// MARK: - Extensions

private extension PluginManifest {
    var autoConnect: Bool? {
        return nil // 可以添加自动连接配置
    }
}

extension Plugin {
    var manifest: PluginManifestWrapper {
        return PluginManifestWrapper(manifest: self.manifest)
    }
}

struct PluginManifestWrapper {
    let manifest: PluginManifest
}
