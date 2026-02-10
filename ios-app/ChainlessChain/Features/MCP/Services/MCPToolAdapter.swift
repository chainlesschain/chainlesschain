import Foundation
import Combine
import CoreCommon

// MARK: - ChainlessChain Tool Format

/// ChainlessChain工具定义
public struct ChainlessChainTool: Codable, Identifiable {
    public let id: String
    public var name: String
    public var displayName: String
    public var description: String
    public var category: String
    public var toolType: String
    public var parametersSchema: MCPJSONSchema
    public var returnSchema: MCPJSONSchema?
    public var isBuiltin: Bool
    public var pluginId: String?
    public var config: String?
    public var examples: [ToolExample]

    public init(
        id: String = UUID().uuidString,
        name: String,
        displayName: String,
        description: String,
        category: String = "mcp",
        toolType: String = "mcp-proxy",
        parametersSchema: MCPJSONSchema = MCPJSONSchema(),
        returnSchema: MCPJSONSchema? = nil,
        isBuiltin: Bool = false,
        pluginId: String? = nil,
        config: String? = nil,
        examples: [ToolExample] = []
    ) {
        self.id = id
        self.name = name
        self.displayName = displayName
        self.description = description
        self.category = category
        self.toolType = toolType
        self.parametersSchema = parametersSchema
        self.returnSchema = returnSchema
        self.isBuiltin = isBuiltin
        self.pluginId = pluginId
        self.config = config
        self.examples = examples
    }
}

/// 工具示例
public struct ToolExample: Codable {
    public let input: [String: AnyCodable]
    public let output: AnyCodable?
    public let description: String?
}

// MARK: - Tool Execution Result

/// 工具执行结果
public struct ToolExecutionResult {
    public let success: Bool
    public let data: Any?
    public let error: String?
    public let mcpResult: MCPToolCallResult?
    public let timestamp: Date

    public init(
        success: Bool,
        data: Any? = nil,
        error: String? = nil,
        mcpResult: MCPToolCallResult? = nil
    ) {
        self.success = success
        self.data = data
        self.error = error
        self.mcpResult = mcpResult
        self.timestamp = Date()
    }
}

// MARK: - MCP Tool Registry Entry

/// MCP工具注册表条目
public struct MCPToolRegistryEntry {
    public let serverName: String
    public let originalToolName: String
    public let tool: ChainlessChainTool
}

// MARK: - MCP Tool Adapter

/// MCP工具适配器
/// 将MCP工具桥接到ChainlessChain工具系统
@MainActor
public class MCPToolAdapter: ObservableObject {

    // MARK: - Singleton

    public static let shared = MCPToolAdapter()

    // MARK: - Properties

    /// 工具ID -> 注册信息
    private var mcpToolRegistry: [String: MCPToolRegistryEntry] = [:]

    /// 服务器名称 -> 工具ID列表
    private var serverTools: [String: [String]] = [:]

    /// 安全策略
    private let securityPolicy: MCPSecurityPolicy

    /// 客户端管理器
    private let clientManager: MCPClientManager

    /// 已注册的工具列表
    @Published public var registeredTools: [ChainlessChainTool] = []

    /// 事件发布器
    public let serverRegistered = PassthroughSubject<(String, [String]), Never>()
    public let serverUnregistered = PassthroughSubject<String, Never>()
    public let toolExecuted = PassthroughSubject<(String, ToolExecutionResult), Never>()

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        self.securityPolicy = MCPSecurityPolicy.shared
        self.clientManager = MCPClientManager.shared

        Logger.shared.info("[MCPToolAdapter] 已初始化")
    }

    // MARK: - Server Initialization

    /// 初始化并自动连接配置的服务器
    public func initializeServers(_ config: MCPConfiguration) async {
        Logger.shared.info("[MCPToolAdapter] 正在初始化MCP服务器...")

        guard config.enabled else {
            Logger.shared.info("[MCPToolAdapter] MCP未启用")
            return
        }

        var connectedCount = 0

        for (serverName, serverConfig) in config.servers {
            guard serverConfig.enabled else {
                Logger.shared.info("[MCPToolAdapter] 服务器 \(serverName) 已禁用，跳过")
                continue
            }

            guard serverConfig.autoConnect else {
                Logger.shared.info("[MCPToolAdapter] 服务器 \(serverName) 未配置自动连接，跳过")
                continue
            }

            do {
                _ = try await registerMCPServerTools(serverName: serverName, serverConfig: serverConfig)
                connectedCount += 1
            } catch {
                Logger.shared.error("[MCPToolAdapter] 初始化 \(serverName) 失败: \(error)")
            }
        }

        Logger.shared.info("[MCPToolAdapter] 初始化完成，已注册 \(connectedCount) 个服务器的工具")
    }

    // MARK: - Tool Registration

    /// 注册MCP服务器的所有工具
    @discardableResult
    public func registerMCPServerTools(
        serverName: String,
        serverConfig: MCPServerConfig
    ) async throws -> [String] {
        Logger.shared.info("[MCPToolAdapter] 正在注册服务器工具: \(serverName)")

        // 连接服务器
        let capabilities = try await clientManager.connectServer(serverName, config: serverConfig)

        // 设置安全策略权限
        securityPolicy.setServerPermissions(serverName, permissions: serverConfig.permissions)

        var toolIds: [String] = []

        // 注册每个工具
        for mcpTool in capabilities.tools {
            let toolId = registerSingleTool(serverName: serverName, mcpTool: mcpTool)
            toolIds.append(toolId)
        }

        // 记录服务器 -> 工具映射
        serverTools[serverName] = toolIds

        Logger.shared.info("[MCPToolAdapter] 已注册 \(toolIds.count) 个工具 from \(serverName)")

        serverRegistered.send((serverName, toolIds))

        // 更新发布的工具列表
        updateRegisteredTools()

        return toolIds
    }

    /// 注销服务器的所有工具
    public func unregisterMCPServerTools(serverName: String) async {
        Logger.shared.info("[MCPToolAdapter] 正在注销服务器工具: \(serverName)")

        guard let toolIds = serverTools[serverName] else {
            Logger.shared.warning("[MCPToolAdapter] 服务器 \(serverName) 没有注册的工具")
            return
        }

        // 移除工具
        for toolId in toolIds {
            mcpToolRegistry.removeValue(forKey: toolId)
        }

        serverTools.removeValue(forKey: serverName)

        // 断开服务器连接
        await clientManager.disconnectServer(serverName)

        Logger.shared.info("[MCPToolAdapter] 已注销 \(toolIds.count) 个工具 from \(serverName)")

        serverUnregistered.send(serverName)

        // 更新发布的工具列表
        updateRegisteredTools()
    }

    /// 刷新服务器工具
    public func refreshServerTools(serverName: String) async throws {
        Logger.shared.info("[MCPToolAdapter] 正在刷新服务器工具: \(serverName)")

        let tools = try await clientManager.listTools(serverName)

        // 获取当前工具名称
        let currentToolIds = serverTools[serverName] ?? []
        var currentToolNames = Set<String>()

        for toolId in currentToolIds {
            if let entry = mcpToolRegistry[toolId] {
                currentToolNames.insert(entry.originalToolName)
            }
        }

        // 找出新工具
        let newTools = tools.filter { !currentToolNames.contains($0.name) }

        // 注册新工具
        var newToolIds: [String] = []
        for mcpTool in newTools {
            let toolId = registerSingleTool(serverName: serverName, mcpTool: mcpTool)
            newToolIds.append(toolId)
        }

        // 更新服务器工具列表
        serverTools[serverName] = (serverTools[serverName] ?? []) + newToolIds

        Logger.shared.info("[MCPToolAdapter] 刷新完成，新增 \(newToolIds.count) 个工具")

        updateRegisteredTools()
    }

    // MARK: - Tool Execution

    /// 执行MCP工具
    public func executeTool(toolId: String, params: [String: Any]) async throws -> ToolExecutionResult {
        guard let entry = mcpToolRegistry[toolId] else {
            throw MCPError(code: MCPErrorCode.methodNotFound.rawValue, message: "工具未找到: \(toolId)")
        }

        let serverName = entry.serverName
        let toolName = entry.originalToolName

        Logger.shared.info("[MCPToolAdapter] 执行工具: \(serverName).\(toolName)")

        do {
            // 安全验证
            try await securityPolicy.validateToolExecution(
                serverName: serverName,
                toolName: toolName,
                params: params
            )

            // 调用MCP服务器
            let result = try await clientManager.callTool(
                serverName: serverName,
                toolName: toolName,
                params: params
            )

            // 转换结果
            let executionResult = transformMCPResult(result)

            toolExecuted.send((toolId, executionResult))

            return executionResult

        } catch {
            Logger.shared.error("[MCPToolAdapter] 工具执行失败: \(error)")

            let errorResult = ToolExecutionResult(
                success: false,
                error: error.localizedDescription
            )

            toolExecuted.send((toolId, errorResult))

            throw error
        }
    }

    // MARK: - Query Methods

    /// 获取所有MCP工具
    public func getMCPTools() -> [MCPToolInfo] {
        return mcpToolRegistry.map { toolId, entry in
            MCPToolInfo(
                toolId: toolId,
                serverName: entry.serverName,
                originalToolName: entry.originalToolName,
                displayName: entry.tool.displayName,
                description: entry.tool.description
            )
        }
    }

    /// 检查是否是MCP工具
    public func isMCPTool(_ toolId: String) -> Bool {
        return mcpToolRegistry[toolId] != nil
    }

    /// 获取工具所属服务器
    public func getToolServer(_ toolId: String) -> String? {
        return mcpToolRegistry[toolId]?.serverName
    }

    /// 获取工具定义
    public func getTool(_ toolId: String) -> ChainlessChainTool? {
        return mcpToolRegistry[toolId]?.tool
    }

    /// 获取服务器的工具列表
    public func getToolsForServer(_ serverName: String) -> [ChainlessChainTool] {
        guard let toolIds = serverTools[serverName] else { return [] }

        return toolIds.compactMap { toolId in
            mcpToolRegistry[toolId]?.tool
        }
    }

    // MARK: - Private Methods

    /// 注册单个工具
    private func registerSingleTool(serverName: String, mcpTool: MCPTool) -> String {
        // 转换为ChainlessChain格式
        let chainlessTool = convertMCPToolFormat(serverName: serverName, mcpTool: mcpTool)

        let toolId = chainlessTool.id

        // 创建注册表条目
        let entry = MCPToolRegistryEntry(
            serverName: serverName,
            originalToolName: mcpTool.name,
            tool: chainlessTool
        )

        mcpToolRegistry[toolId] = entry

        Logger.shared.info("[MCPToolAdapter] 注册工具: \(chainlessTool.name) -> \(toolId)")

        return toolId
    }

    /// 转换MCP工具格式
    private func convertMCPToolFormat(serverName: String, mcpTool: MCPTool) -> ChainlessChainTool {
        let toolId = "mcp_\(serverName)_\(mcpTool.name)"

        // 构建配置JSON
        let configDict: [String: Any] = [
            "mcpServer": serverName,
            "originalToolName": mcpTool.name,
            "isMCPTool": true
        ]
        let configJson = (try? JSONSerialization.data(withJSONObject: configDict).base64EncodedString()) ?? "{}"

        return ChainlessChainTool(
            id: toolId,
            name: "mcp_\(serverName)_\(mcpTool.name)",
            displayName: "\(mcpTool.name) (MCP)",
            description: mcpTool.description ?? "MCP工具 from \(serverName)",
            category: "mcp",
            toolType: "mcp-proxy",
            parametersSchema: mcpTool.inputSchema,
            returnSchema: MCPJSONSchema(
                type: "object",
                properties: [
                    "content": MCPPropertySchema(type: "array", description: "MCP结果内容"),
                    "isError": MCPPropertySchema(type: "boolean", description: "是否为错误")
                ]
            ),
            isBuiltin: false,
            pluginId: "mcp-server-\(serverName)",
            config: configJson,
            examples: []
        )
    }

    /// 转换MCP结果
    private func transformMCPResult(_ mcpResult: MCPToolCallResult) -> ToolExecutionResult {
        if mcpResult.isError {
            let errorMessage = extractErrorMessage(mcpResult.content)
            return ToolExecutionResult(
                success: false,
                error: errorMessage,
                mcpResult: mcpResult
            )
        }

        let data = extractContent(mcpResult.content)

        return ToolExecutionResult(
            success: true,
            data: data,
            mcpResult: mcpResult
        )
    }

    /// 提取内容
    private func extractContent(_ content: [MCPContent]) -> Any {
        if content.count == 1 {
            let item = content[0]
            return item.text ?? item.data ?? item
        }

        // 合并文本内容
        let texts = content.filter { $0.type == .text }.compactMap { $0.text }
        if !texts.isEmpty {
            return texts.joined(separator: "\n")
        }

        return content.map { $0.text ?? "data" }
    }

    /// 提取错误消息
    private func extractErrorMessage(_ content: [MCPContent]) -> String {
        let errorTexts = content.filter { $0.type == .text }.compactMap { $0.text }
        return errorTexts.joined(separator: "\n")
    }

    /// 更新发布的工具列表
    private func updateRegisteredTools() {
        registeredTools = mcpToolRegistry.values.map { $0.tool }
    }
}

// MARK: - Supporting Types

/// MCP工具信息
public struct MCPToolInfo {
    public let toolId: String
    public let serverName: String
    public let originalToolName: String
    public let displayName: String
    public let description: String
}

// MARK: - Convenience Extensions

extension MCPToolAdapter {

    /// 执行工具 (便捷方法)
    public func execute(
        serverName: String,
        toolName: String,
        params: [String: Any] = [:]
    ) async throws -> ToolExecutionResult {
        let toolId = "mcp_\(serverName)_\(toolName)"
        return try await executeTool(toolId: toolId, params: params)
    }

    /// 查找工具
    public func findTool(serverName: String, toolName: String) -> ChainlessChainTool? {
        let toolId = "mcp_\(serverName)_\(toolName)"
        return mcpToolRegistry[toolId]?.tool
    }

    /// 获取所有服务器名称
    public func getRegisteredServers() -> [String] {
        return Array(serverTools.keys)
    }

    /// 获取工具总数
    public var totalToolCount: Int {
        return mcpToolRegistry.count
    }
}
