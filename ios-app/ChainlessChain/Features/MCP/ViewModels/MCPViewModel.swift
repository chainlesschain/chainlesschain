//
//  MCPViewModel.swift
//  ChainlessChain
//
//  MCP功能的UI状态管理
//  管理服务器连接、工具调用、资源浏览等
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import Combine
import SwiftUI

/// MCP主视图模型
@MainActor
public class MCPViewModel: ObservableObject {

    // MARK: - Singleton

    public static let shared = MCPViewModel()

    // MARK: - Published Properties

    /// 服务器配置列表
    @Published public var servers: [MCPServerConfig] = []

    /// 当前选中的服务器
    @Published public var selectedServer: MCPConnectedServer?

    /// 选中服务器的工具列表
    @Published public var serverTools: [MCPTool] = []

    /// 选中服务器的资源列表
    @Published public var serverResources: [MCPResource] = []

    /// 选中服务器的Prompts列表
    @Published public var serverPrompts: [MCPPrompt] = []

    /// 最近工具调用记录
    @Published public var recentToolCalls: [MCPToolCallEvent] = []

    /// 服务器健康状态
    @Published public var serverHealthStatus: [String: MCPServerHealth] = [:]

    /// 加载状态
    @Published public var isLoading = false
    @Published public var isConnecting = false
    @Published public var isCallingTool = false

    /// 错误状态
    @Published public var showError = false
    @Published public var errorMessage = ""

    /// 搜索文本
    @Published public var searchText = ""

    // MARK: - Private Properties

    private let clientManager = MCPClientManager.shared
    private let configLoader = MCPConfigLoader.shared
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Computed Properties

    /// 已连接的服务器列表
    public var connectedServers: [MCPServerConfig] {
        let connectedNames = clientManager.getConnectedServers()
        return servers.filter { connectedNames.contains($0.name) }
    }

    /// 搜索过滤后的工具
    public var filteredTools: [MCPTool] {
        if searchText.isEmpty {
            return serverTools
        }
        return serverTools.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            ($0.description?.localizedCaseInsensitiveContains(searchText) ?? false)
        }
    }

    /// 搜索过滤后的资源
    public var filteredResources: [MCPResource] {
        if searchText.isEmpty {
            return serverResources
        }
        return serverResources.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.uri.localizedCaseInsensitiveContains(searchText)
        }
    }

    /// 搜索过滤后的Prompts
    public var filteredPrompts: [MCPPrompt] {
        if searchText.isEmpty {
            return serverPrompts
        }
        return serverPrompts.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            ($0.description?.localizedCaseInsensitiveContains(searchText) ?? false)
        }
    }

    // MARK: - Initialization

    private init() {
        setupSubscriptions()
        loadServers()
    }

    // MARK: - Public Methods

    /// 加载服务器配置
    public func loadServers() {
        Task {
            isLoading = true
            defer { isLoading = false }

            do {
                servers = try await configLoader.loadConfigs()
                Logger.shared.info("[MCPViewModel] 加载了 \(servers.count) 个服务器配置")

                // 自动连接启用的服务器
                for server in servers where server.enabled && server.autoConnect {
                    try? await connectServer(server.id)
                }

            } catch {
                showError(message: "加载服务器配置失败: \(error.localizedDescription)")
            }
        }
    }

    /// 连接服务器
    public func connectServer(_ serverId: String) async throws {
        guard let config = servers.first(where: { $0.id == serverId }) else {
            throw MCPError(code: -1, message: "服务器配置未找到")
        }

        isConnecting = true
        defer { isConnecting = false }

        do {
            let capabilities = try await clientManager.connectServer(config.name, config: config)

            // 更新选中的服务器
            selectedServer = MCPConnectedServer(
                config: config,
                state: .connected,
                capabilities: capabilities
            )

            // 加载工具和资源
            serverTools = capabilities.tools
            serverResources = capabilities.resources
            serverPrompts = capabilities.prompts

            Logger.shared.info("[MCPViewModel] 服务器 \(config.name) 连接成功")

        } catch {
            showError(message: "连接失败: \(error.localizedDescription)")
            throw error
        }
    }

    /// 断开服务器连接
    public func disconnectServer(_ serverId: String) async {
        guard let config = servers.first(where: { $0.id == serverId }) else { return }

        await clientManager.disconnectServer(config.name)

        if selectedServer?.config.id == serverId {
            selectedServer = nil
            serverTools = []
            serverResources = []
            serverPrompts = []
        }

        Logger.shared.info("[MCPViewModel] 服务器 \(config.name) 已断开")
    }

    /// 选择服务器
    public func selectServer(_ serverId: String) async {
        guard let config = servers.first(where: { $0.id == serverId }) else { return }

        // 检查是否已连接
        if clientManager.getConnectedServers().contains(config.name) {
            // 获取服务器信息
            if let status = clientManager.getServerInfo(config.name) {
                serverTools = clientManager.getServerTools(config.name)
                serverResources = clientManager.getServerResources(config.name)

                selectedServer = MCPConnectedServer(
                    config: config,
                    state: status.state,
                    capabilities: MCPServerCapabilities(
                        tools: serverTools,
                        resources: serverResources,
                        prompts: serverPrompts
                    )
                )
            }
        } else {
            // 尝试连接
            try? await connectServer(serverId)
        }
    }

    /// 刷新服务器工具列表
    public func refreshTools() async {
        guard let server = selectedServer else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            serverTools = try await clientManager.listTools(server.config.name)
            Logger.shared.info("[MCPViewModel] 刷新工具列表: \(serverTools.count) 个工具")
        } catch {
            showError(message: "刷新工具失败: \(error.localizedDescription)")
        }
    }

    /// 刷新服务器资源列表
    public func refreshResources() async {
        guard let server = selectedServer else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            serverResources = try await clientManager.listResources(server.config.name)
            Logger.shared.info("[MCPViewModel] 刷新资源列表: \(serverResources.count) 个资源")
        } catch {
            showError(message: "刷新资源失败: \(error.localizedDescription)")
        }
    }

    /// 刷新Prompts列表
    public func refreshPrompts() async {
        guard let server = selectedServer else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            serverPrompts = try await clientManager.listPrompts(server.config.name)
            Logger.shared.info("[MCPViewModel] 刷新Prompts列表: \(serverPrompts.count) 个Prompts")
        } catch {
            showError(message: "刷新Prompts失败: \(error.localizedDescription)")
        }
    }

    /// 调用工具
    public func callTool(
        toolName: String,
        params: [String: Any] = [:]
    ) async throws -> MCPToolCallResult {
        guard let server = selectedServer else {
            throw MCPError(code: -1, message: "未选择服务器")
        }

        isCallingTool = true
        defer { isCallingTool = false }

        // 验证权限
        let permission = try await clientManager.validateToolPermission(
            serverName: server.config.name,
            toolName: toolName,
            params: params
        )

        guard permission.allowed else {
            throw MCPError(
                code: MCPErrorCode.securityViolation.rawValue,
                message: permission.reason ?? "权限被拒绝"
            )
        }

        // 调用工具
        let result = try await clientManager.callTool(
            serverName: server.config.name,
            toolName: toolName,
            params: params
        )

        return result
    }

    /// 读取资源
    public func readResource(uri: String) async throws -> MCPResourceContent {
        guard let server = selectedServer else {
            throw MCPError(code: -1, message: "未选择服务器")
        }

        isLoading = true
        defer { isLoading = false }

        return try await clientManager.readResource(
            serverName: server.config.name,
            resourceUri: uri
        )
    }

    /// 执行Prompt
    public func executePrompt(
        promptName: String,
        arguments: [String: Any] = [:]
    ) async throws -> MCPPromptResult {
        guard let server = selectedServer else {
            throw MCPError(code: -1, message: "未选择服务器")
        }

        isLoading = true
        defer { isLoading = false }

        return try await clientManager.executePrompt(
            serverName: server.config.name,
            promptName: promptName,
            arguments: arguments
        )
    }

    /// 健康检查
    public func checkHealth(_ serverId: String) async {
        guard let config = servers.first(where: { $0.id == serverId }) else { return }

        do {
            let health = try await clientManager.healthCheck(serverId: config.name)
            serverHealthStatus[serverId] = health
        } catch {
            serverHealthStatus[serverId] = MCPServerHealth(
                serverId: config.name,
                status: .unknown,
                latency: nil,
                message: error.localizedDescription,
                checkedAt: Date()
            )
        }
    }

    /// 批量健康检查
    public func checkAllHealth() async {
        let results = await clientManager.healthCheckAll()

        for result in results {
            if let config = servers.first(where: { $0.name == result.serverId }) {
                serverHealthStatus[config.id] = result
            }
        }
    }

    /// 添加服务器
    public func addServer(_ config: MCPServerConfig) async throws {
        var newConfig = config
        newConfig.updatedAt = Date()

        servers.append(newConfig)
        try await configLoader.saveConfigs(servers)

        Logger.shared.info("[MCPViewModel] 添加服务器: \(config.name)")

        // 如果启用了自动连接，则连接
        if config.enabled && config.autoConnect {
            try await connectServer(config.id)
        }
    }

    /// 更新服务器配置
    public func updateServer(_ config: MCPServerConfig) async throws {
        guard let index = servers.firstIndex(where: { $0.id == config.id }) else {
            throw MCPError(code: -1, message: "服务器未找到")
        }

        var updatedConfig = config
        updatedConfig.updatedAt = Date()

        servers[index] = updatedConfig
        try await configLoader.saveConfigs(servers)

        Logger.shared.info("[MCPViewModel] 更新服务器: \(config.name)")
    }

    /// 删除服务器
    public func deleteServer(_ serverId: String) async throws {
        guard let index = servers.firstIndex(where: { $0.id == serverId }) else { return }

        let config = servers[index]

        // 如果已连接，先断开
        if clientManager.getConnectedServers().contains(config.name) {
            await disconnectServer(serverId)
        }

        servers.remove(at: index)
        try await configLoader.saveConfigs(servers)

        Logger.shared.info("[MCPViewModel] 删除服务器: \(config.name)")
    }

    /// 获取指标
    public func getMetrics() -> MCPManagerMetrics {
        return clientManager.getMetrics()
    }

    // MARK: - Private Methods

    private func setupSubscriptions() {
        // 监听工具调用事件
        clientManager.toolCalled
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.recentToolCalls.insert(event, at: 0)
                // 只保留最近100条
                if self?.recentToolCalls.count ?? 0 > 100 {
                    self?.recentToolCalls = Array((self?.recentToolCalls ?? []).prefix(100))
                }
            }
            .store(in: &cancellables)

        // 监听服务器连接事件
        clientManager.serverConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] (serverName, capabilities) in
                Logger.shared.info("[MCPViewModel] 服务器已连接: \(serverName)")
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)

        // 监听服务器断开事件
        clientManager.serverDisconnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] serverName in
                Logger.shared.info("[MCPViewModel] 服务器已断开: \(serverName)")
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)

        // 监听服务器错误事件
        clientManager.serverError
            .receive(on: DispatchQueue.main)
            .sink { [weak self] (serverName, error) in
                self?.showError(message: "服务器错误 (\(serverName)): \(error.localizedDescription)")
            }
            .store(in: &cancellables)
    }

    private func showError(message: String) {
        errorMessage = message
        showError = true
        Logger.shared.error("[MCPViewModel] \(message)")
    }
}

// MARK: - Tool Execution State

/// 工具执行状态
public struct ToolExecutionState: Identifiable {
    public let id = UUID()
    public let tool: MCPTool
    public var params: [String: Any] = [:]
    public var isExecuting = false
    public var result: MCPToolCallResult?
    public var error: Error?
}

// MARK: - Resource Browser State

/// 资源浏览状态
public struct ResourceBrowserState {
    public var currentPath: String = "/"
    public var selectedResource: MCPResource?
    public var resourceContent: MCPResourceContent?
    public var isLoading = false
}
