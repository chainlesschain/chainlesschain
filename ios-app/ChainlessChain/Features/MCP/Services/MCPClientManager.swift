import Foundation
import Combine
import CoreCommon

// MARK: - MCP Client Manager

/// MCP客户端管理器
/// 管理MCP服务器连接的生命周期
@MainActor
public class MCPClientManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = MCPClientManager()

    // MARK: - Configuration

    public struct Config {
        public var defaultTimeout: TimeInterval = 30
        public var maxConcurrentConnections: Int = 5
        public var autoReconnect: Bool = true

        public init() {}
    }

    // MARK: - Properties

    private var config: Config

    /// 服务器名称 -> 连接信息
    private var servers: [String: MCPConnectedServer] = [:]

    /// 服务器名称 -> 传输层
    private var transports: [String: MCPHttpSseTransport] = [:]

    /// 性能指标
    @Published public var metrics: MCPManagerMetrics

    /// 全局启用状态
    @Published public var enabled: Bool = true

    /// 事件发布器
    public let serverConnected = PassthroughSubject<(String, MCPServerCapabilities), Never>()
    public let serverDisconnected = PassthroughSubject<String, Never>()
    public let serverError = PassthroughSubject<(String, Error), Never>()
    public let toolCalled = PassthroughSubject<MCPToolCallEvent, Never>()

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        self.config = Config()
        self.metrics = MCPManagerMetrics()

        Logger.shared.info("[MCPClientManager] 已初始化")
    }

    /// 配置
    public func configure(_ config: Config) {
        self.config = config
    }

    // MARK: - Server Connection

    /// 连接到MCP服务器
    @discardableResult
    public func connectServer(
        _ serverName: String,
        config serverConfig: MCPServerConfig
    ) async throws -> MCPServerCapabilities {
        let startTime = Date()

        Logger.shared.info("[MCPClientManager] 正在连接服务器: \(serverName)")

        // 检查是否已连接
        if let existing = servers[serverName], existing.state == .connected {
            Logger.shared.info("[MCPClientManager] 服务器 \(serverName) 已连接")
            return existing.capabilities
        }

        do {
            // 创建传输层
            let transport = MCPHttpSseTransport(config: MCPHttpSseTransport.Config(
                baseURL: serverConfig.baseURL ?? "",
                apiKey: serverConfig.apiKey,
                headers: serverConfig.headers,
                timeout: serverConfig.timeout,
                maxRetries: serverConfig.maxRetries
            ))

            // 设置事件处理
            setupTransportHandlers(transport, serverName: serverName)

            // 启动传输层
            try await transport.start()

            // 初始化MCP会话
            _ = try await transport.initialize()

            // 获取服务器能力
            let capabilities = try await fetchCapabilities(transport, serverName: serverName)

            // 存储连接信息
            var connectedServer = MCPConnectedServer(
                config: serverConfig,
                state: .connected,
                capabilities: capabilities
            )
            connectedServer.connectedAt = Date()
            connectedServer.metrics.connectionTime = Date().timeIntervalSince(startTime)

            servers[serverName] = connectedServer
            transports[serverName] = transport

            // 更新指标
            metrics.connectionTimes[serverName] = connectedServer.metrics.connectionTime

            Logger.shared.info("[MCPClientManager] 服务器 \(serverName) 连接成功 (\(Int(connectedServer.metrics.connectionTime * 1000))ms)")
            Logger.shared.info("  工具: \(capabilities.tools.count)")
            Logger.shared.info("  资源: \(capabilities.resources.count)")
            Logger.shared.info("  Prompts: \(capabilities.prompts.count)")

            serverConnected.send((serverName, capabilities))

            return capabilities

        } catch {
            Logger.shared.error("[MCPClientManager] 连接 \(serverName) 失败: \(error)")

            var errorServer = MCPConnectedServer(
                config: serverConfig,
                state: .error
            )
            errorServer.lastError = MCPError(code: -1, message: error.localizedDescription)

            servers[serverName] = errorServer

            metrics.errorCounts[serverName, default: 0] += 1

            serverError.send((serverName, error))

            throw error
        }
    }

    /// 断开MCP服务器连接
    public func disconnectServer(_ serverName: String) async {
        Logger.shared.info("[MCPClientManager] 正在断开服务器: \(serverName)")

        guard let transport = transports[serverName] else {
            Logger.shared.warning("[MCPClientManager] 服务器 \(serverName) 未找到")
            return
        }

        await transport.stop()

        servers.removeValue(forKey: serverName)
        transports.removeValue(forKey: serverName)

        Logger.shared.info("[MCPClientManager] 服务器 \(serverName) 已断开")

        serverDisconnected.send(serverName)
    }

    // MARK: - Tool Operations

    /// 列出服务器工具
    public func listTools(_ serverName: String) async throws -> [MCPTool] {
        let transport = try getConnectedTransport(serverName)
        let tools = try await transport.listTools()

        // 更新缓存
        servers[serverName]?.capabilities.tools = tools

        return tools
    }

    /// 列出服务器资源
    public func listResources(_ serverName: String) async throws -> [MCPResource] {
        let transport = try getConnectedTransport(serverName)
        let resources = try await transport.listResources()

        // 更新缓存
        servers[serverName]?.capabilities.resources = resources

        return resources
    }

    /// 调用工具
    public func callTool(
        serverName: String,
        toolName: String,
        params: [String: Any] = [:]
    ) async throws -> MCPToolCallResult {
        let startTime = Date()
        let transport = try getConnectedTransport(serverName)

        metrics.totalCalls += 1

        Logger.shared.info("[MCPClientManager] 调用工具: \(serverName).\(toolName)")

        do {
            let result = try await transport.callTool(name: toolName, arguments: params)

            let latency = Date().timeIntervalSince(startTime)

            // 更新指标
            metrics.successfulCalls += 1
            servers[serverName]?.metrics.recordCall(toolName: toolName, latency: latency, success: true)

            if metrics.toolLatencies[toolName] == nil {
                metrics.toolLatencies[toolName] = []
            }
            metrics.toolLatencies[toolName]?.append(latency)

            Logger.shared.info("[MCPClientManager] 工具调用成功 (\(Int(latency * 1000))ms)")

            // 发送事件
            toolCalled.send(MCPToolCallEvent(
                serverName: serverName,
                toolName: toolName,
                params: params,
                latency: latency,
                success: true
            ))

            return result

        } catch {
            let latency = Date().timeIntervalSince(startTime)

            Logger.shared.error("[MCPClientManager] 工具调用失败 (\(Int(latency * 1000))ms): \(error)")

            metrics.errorCounts[serverName, default: 0] += 1
            servers[serverName]?.metrics.recordCall(toolName: toolName, latency: latency, success: false)

            toolCalled.send(MCPToolCallEvent(
                serverName: serverName,
                toolName: toolName,
                params: params,
                latency: latency,
                success: false,
                error: error
            ))

            throw error
        }
    }

    /// 读取资源
    public func readResource(
        serverName: String,
        resourceUri: String
    ) async throws -> MCPResourceContent {
        let transport = try getConnectedTransport(serverName)

        Logger.shared.info("[MCPClientManager] 读取资源: \(resourceUri)")

        let content = try await transport.readResource(uri: resourceUri)

        Logger.shared.info("[MCPClientManager] 资源读取成功")

        return content
    }

    // MARK: - Server Information

    /// 获取已连接的服务器列表
    public func getConnectedServers() -> [String] {
        return servers.filter { $0.value.state == .connected }.map { $0.key }
    }

    /// 获取服务器信息
    public func getServerInfo(_ serverName: String) -> MCPServerStatus? {
        guard let server = servers[serverName] else { return nil }

        return MCPServerStatus(
            name: serverName,
            state: server.state,
            connectedAt: server.connectedAt,
            toolCount: server.capabilities.tools.count,
            resourceCount: server.capabilities.resources.count,
            promptCount: server.capabilities.prompts.count,
            errorCount: metrics.errorCounts[serverName] ?? 0,
            metrics: server.metrics
        )
    }

    /// 获取所有服务器状态
    public func getAllServerStatus() -> [MCPServerStatus] {
        return servers.map { name, server in
            MCPServerStatus(
                name: name,
                state: server.state,
                connectedAt: server.connectedAt,
                toolCount: server.capabilities.tools.count,
                resourceCount: server.capabilities.resources.count,
                promptCount: server.capabilities.prompts.count,
                errorCount: metrics.errorCounts[name] ?? 0,
                metrics: server.metrics
            )
        }
    }

    /// 获取服务器工具
    public func getServerTools(_ serverName: String) -> [MCPTool] {
        return servers[serverName]?.capabilities.tools ?? []
    }

    /// 获取服务器资源
    public func getServerResources(_ serverName: String) -> [MCPResource] {
        return servers[serverName]?.capabilities.resources ?? []
    }

    // MARK: - Metrics

    /// 获取性能指标
    public func getMetrics() -> MCPManagerMetrics {
        return metrics
    }

    /// 重置指标
    public func resetMetrics() {
        metrics = MCPManagerMetrics()

        for key in servers.keys {
            servers[key]?.metrics = MCPServerMetrics()
        }
    }

    // MARK: - Lifecycle

    /// 关闭所有连接
    public func shutdown() async {
        Logger.shared.info("[MCPClientManager] 正在关闭所有连接...")

        for serverName in servers.keys {
            await disconnectServer(serverName)
        }

        Logger.shared.info("[MCPClientManager] 所有连接已关闭")
    }

    // MARK: - Private Methods

    /// 获取已连接的传输层
    private func getConnectedTransport(_ serverName: String) throws -> MCPHttpSseTransport {
        guard let server = servers[serverName] else {
            throw MCPError(code: MCPErrorCode.connectionError.rawValue, message: "服务器未找到: \(serverName)")
        }

        guard server.state == .connected else {
            throw MCPError(code: MCPErrorCode.connectionError.rawValue, message: "服务器未连接: \(serverName) (状态: \(server.state.rawValue))")
        }

        guard let transport = transports[serverName] else {
            throw MCPError(code: MCPErrorCode.connectionError.rawValue, message: "传输层未找到: \(serverName)")
        }

        return transport
    }

    /// 获取服务器能力
    private func fetchCapabilities(_ transport: MCPHttpSseTransport, serverName: String) async throws -> MCPServerCapabilities {
        async let toolsResult = transport.listTools()
        async let resourcesResult = transport.listResources()

        let tools = try await toolsResult
        let resources = try await resourcesResult

        Logger.shared.info("[MCPClientManager] \(serverName) 能力获取成功: \(tools.count)工具, \(resources.count)资源")

        return MCPServerCapabilities(
            tools: tools,
            resources: resources,
            prompts: []
        )
    }

    /// 设置传输层事件处理
    private func setupTransportHandlers(_ transport: MCPHttpSseTransport, serverName: String) {
        transport.connected
            .sink { [weak self] in
                Logger.shared.info("[MCPClientManager] \(serverName) 传输层已连接")
                self?.servers[serverName]?.state = .connected
            }
            .store(in: &cancellables)

        transport.disconnected
            .sink { [weak self] in
                Logger.shared.info("[MCPClientManager] \(serverName) 传输层已断开")
                self?.servers[serverName]?.state = .disconnected
                self?.serverDisconnected.send(serverName)
            }
            .store(in: &cancellables)

        transport.reconnected
            .sink { [weak self] in
                Logger.shared.info("[MCPClientManager] \(serverName) 传输层已重连")
                self?.servers[serverName]?.state = .connected
            }
            .store(in: &cancellables)

        transport.errorOccurred
            .sink { [weak self] error in
                Logger.shared.error("[MCPClientManager] \(serverName) 传输层错误: \(error)")
                self?.servers[serverName]?.state = .error
                self?.serverError.send((serverName, error))
            }
            .store(in: &cancellables)

        transport.notificationReceived
            .sink { notification in
                Logger.shared.info("[MCPClientManager] \(serverName) 收到通知: \(String(describing: notification.id))")
            }
            .store(in: &cancellables)
    }
}

// MARK: - Supporting Types

/// MCP管理器指标
public struct MCPManagerMetrics {
    public var totalCalls: Int = 0
    public var successfulCalls: Int = 0
    public var connectionTimes: [String: TimeInterval] = [:]
    public var toolLatencies: [String: [TimeInterval]] = [:]
    public var errorCounts: [String: Int] = [:]

    public var failedCalls: Int {
        return totalCalls - successfulCalls
    }

    public var successRate: Double {
        guard totalCalls > 0 else { return 0 }
        return Double(successfulCalls) / Double(totalCalls) * 100
    }

    /// 获取工具平均延迟
    public func getAverageLatency(toolName: String) -> TimeInterval? {
        guard let latencies = toolLatencies[toolName], !latencies.isEmpty else { return nil }
        return latencies.reduce(0, +) / Double(latencies.count)
    }

    /// 获取工具P95延迟
    public func getP95Latency(toolName: String) -> TimeInterval? {
        guard let latencies = toolLatencies[toolName], !latencies.isEmpty else { return nil }
        let sorted = latencies.sorted()
        let index = Int(ceil(Double(sorted.count) * 0.95)) - 1
        return sorted[max(0, index)]
    }
}

/// MCP服务器状态
public struct MCPServerStatus {
    public let name: String
    public let state: MCPServerState
    public let connectedAt: Date?
    public let toolCount: Int
    public let resourceCount: Int
    public let promptCount: Int
    public let errorCount: Int
    public let metrics: MCPServerMetrics
}

/// MCP工具调用事件
public struct MCPToolCallEvent {
    public let serverName: String
    public let toolName: String
    public let params: [String: Any]
    public let latency: TimeInterval
    public let success: Bool
    public let error: Error?
    public let timestamp: Date

    public init(
        serverName: String,
        toolName: String,
        params: [String: Any],
        latency: TimeInterval,
        success: Bool,
        error: Error? = nil
    ) {
        self.serverName = serverName
        self.toolName = toolName
        self.params = params
        self.latency = latency
        self.success = success
        self.error = error
        self.timestamp = Date()
    }
}
