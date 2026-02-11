//
//  MCPClientManager+Extensions.swift
//  ChainlessChain
//
//  MCP客户端管理器扩展
//  添加Prompt支持、批量操作、健康检查、安全策略集成
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import Combine
import CoreCommon

// MARK: - Prompt Support Extension

extension MCPClientManager {

    /// 列出服务器Prompts
    public func listPrompts(_ serverName: String) async throws -> [MCPPrompt] {
        let transport = try getConnectedTransport(serverName)

        Logger.shared.info("[MCPClientManager] 列出Prompts: \(serverName)")

        let request = MCPRequest(method: "prompts/list")
        let response = try await transport.sendRequest(request)

        guard let result = response.result?.dictValue,
              let promptsData = result["prompts"] as? [[String: Any]] else {
            return []
        }

        let prompts = promptsData.compactMap { dict -> MCPPrompt? in
            guard let name = dict["name"] as? String else { return nil }

            var arguments: [MCPPromptArgument]?
            if let argsData = dict["arguments"] as? [[String: Any]] {
                arguments = argsData.map { arg in
                    MCPPromptArgument(
                        name: arg["name"] as? String ?? "",
                        description: arg["description"] as? String,
                        required: arg["required"] as? Bool ?? false
                    )
                }
            }

            return MCPPrompt(
                name: name,
                description: dict["description"] as? String,
                arguments: arguments
            )
        }

        // 更新缓存
        servers[serverName]?.capabilities.prompts = prompts

        Logger.shared.info("[MCPClientManager] 获取到 \(prompts.count) 个Prompts")

        return prompts
    }

    /// 执行Prompt
    public func executePrompt(
        serverName: String,
        promptName: String,
        arguments: [String: Any] = [:]
    ) async throws -> MCPPromptResult {
        let startTime = Date()
        let transport = try getConnectedTransport(serverName)

        Logger.shared.info("[MCPClientManager] 执行Prompt: \(serverName).\(promptName)")

        let params: [String: AnyCodable] = [
            "name": AnyCodable(promptName),
            "arguments": AnyCodable(arguments)
        ]

        let request = MCPRequest(method: "prompts/get", params: params)
        let response = try await transport.sendRequest(request)

        let latency = Date().timeIntervalSince(startTime)

        guard let result = response.result?.dictValue else {
            throw MCPError(
                code: MCPErrorCode.invalidParams.rawValue,
                message: "无效的Prompt响应"
            )
        }

        // 解析消息
        var messages: [MCPPromptMessage] = []
        if let messagesData = result["messages"] as? [[String: Any]] {
            messages = messagesData.compactMap { msg -> MCPPromptMessage? in
                guard let role = msg["role"] as? String,
                      let content = msg["content"] as? [String: Any] else {
                    return nil
                }

                let contentType = content["type"] as? String ?? "text"
                let text = content["text"] as? String

                return MCPPromptMessage(
                    role: MCPPromptRole(rawValue: role) ?? .assistant,
                    content: MCPPromptContent(type: contentType, text: text)
                )
            }
        }

        Logger.shared.info("[MCPClientManager] Prompt执行成功 (\(Int(latency * 1000))ms)")

        return MCPPromptResult(
            description: result["description"] as? String,
            messages: messages
        )
    }
}

// MARK: - Batch Operations Extension

extension MCPClientManager {

    /// 批量调用工具
    public func batchCallTools(
        serverName: String,
        calls: [MCPToolCallRequest]
    ) async throws -> [MCPBatchCallResult] {
        guard !calls.isEmpty else { return [] }

        Logger.shared.info("[MCPClientManager] 批量调用工具: \(serverName), \(calls.count) 个调用")

        var results: [MCPBatchCallResult] = []

        // 使用TaskGroup并发执行
        await withTaskGroup(of: MCPBatchCallResult.self) { group in
            for (index, call) in calls.enumerated() {
                group.addTask {
                    do {
                        let result = try await self.callTool(
                            serverName: serverName,
                            toolName: call.name,
                            params: call.arguments.mapValues { $0.value }
                        )
                        return MCPBatchCallResult(
                            index: index,
                            toolName: call.name,
                            result: result,
                            error: nil
                        )
                    } catch {
                        return MCPBatchCallResult(
                            index: index,
                            toolName: call.name,
                            result: nil,
                            error: error
                        )
                    }
                }
            }

            for await result in group {
                results.append(result)
            }
        }

        // 按原始顺序排序
        results.sort { $0.index < $1.index }

        let successCount = results.filter { $0.error == nil }.count
        Logger.shared.info("[MCPClientManager] 批量调用完成: \(successCount)/\(calls.count) 成功")

        return results
    }

    /// 批量读取资源
    public func batchReadResources(
        serverName: String,
        resourceUris: [String]
    ) async throws -> [MCPBatchResourceResult] {
        guard !resourceUris.isEmpty else { return [] }

        Logger.shared.info("[MCPClientManager] 批量读取资源: \(serverName), \(resourceUris.count) 个资源")

        var results: [MCPBatchResourceResult] = []

        await withTaskGroup(of: MCPBatchResourceResult.self) { group in
            for (index, uri) in resourceUris.enumerated() {
                group.addTask {
                    do {
                        let content = try await self.readResource(
                            serverName: serverName,
                            resourceUri: uri
                        )
                        return MCPBatchResourceResult(
                            index: index,
                            uri: uri,
                            content: content,
                            error: nil
                        )
                    } catch {
                        return MCPBatchResourceResult(
                            index: index,
                            uri: uri,
                            content: nil,
                            error: error
                        )
                    }
                }
            }

            for await result in group {
                results.append(result)
            }
        }

        results.sort { $0.index < $1.index }

        return results
    }
}

// MARK: - Health Check Extension

extension MCPClientManager {

    /// 健康检查
    public func healthCheck(serverId: String) async throws -> MCPServerHealth {
        let startTime = Date()

        Logger.shared.info("[MCPClientManager] 健康检查: \(serverId)")

        guard let server = servers[serverId] else {
            return MCPServerHealth(
                serverId: serverId,
                status: .unknown,
                latency: nil,
                message: "服务器未找到",
                checkedAt: Date()
            )
        }

        // 如果服务器状态为错误
        if server.state == .error {
            return MCPServerHealth(
                serverId: serverId,
                status: .unhealthy,
                latency: nil,
                message: server.lastError?.message,
                checkedAt: Date()
            )
        }

        // 如果服务器未连接
        if server.state != .connected {
            return MCPServerHealth(
                serverId: serverId,
                status: .disconnected,
                latency: nil,
                message: "服务器未连接",
                checkedAt: Date()
            )
        }

        // 尝试ping服务器
        do {
            let transport = try getConnectedTransport(serverId)

            // 发送ping请求（使用tools/list作为轻量级检查）
            _ = try await transport.listTools()

            let latency = Date().timeIntervalSince(startTime)

            return MCPServerHealth(
                serverId: serverId,
                status: .healthy,
                latency: latency,
                message: nil,
                checkedAt: Date()
            )
        } catch {
            let latency = Date().timeIntervalSince(startTime)

            return MCPServerHealth(
                serverId: serverId,
                status: .unhealthy,
                latency: latency,
                message: error.localizedDescription,
                checkedAt: Date()
            )
        }
    }

    /// 批量健康检查
    public func healthCheckAll() async -> [MCPServerHealth] {
        var results: [MCPServerHealth] = []

        await withTaskGroup(of: MCPServerHealth.self) { group in
            for serverId in servers.keys {
                group.addTask {
                    do {
                        return try await self.healthCheck(serverId: serverId)
                    } catch {
                        return MCPServerHealth(
                            serverId: serverId,
                            status: .unknown,
                            latency: nil,
                            message: error.localizedDescription,
                            checkedAt: Date()
                        )
                    }
                }
            }

            for await result in group {
                results.append(result)
            }
        }

        return results
    }
}

// MARK: - Security Policy Integration

extension MCPClientManager {

    /// 验证工具权限
    public func validateToolPermission(
        serverName: String,
        toolName: String,
        params: [String: Any] = [:]
    ) async throws -> MCPPermissionResult {
        guard let server = servers[serverName] else {
            return MCPPermissionResult(
                allowed: false,
                reason: "服务器未找到"
            )
        }

        let permissions = server.config.permissions
        let securityPolicy = MCPSecurityPolicy.shared

        // 检查全局安全策略
        let policyCheck = await securityPolicy.validateToolCall(
            serverName: serverName,
            toolName: toolName,
            params: params
        )

        if !policyCheck.allowed {
            return policyCheck
        }

        // 检查服务器级别权限
        // 只读模式检查
        if permissions.readOnly {
            let writeOperations = ["write", "create", "delete", "update", "insert", "modify"]
            if writeOperations.contains(where: { toolName.lowercased().contains($0) }) {
                return MCPPermissionResult(
                    allowed: false,
                    reason: "服务器配置为只读模式"
                )
            }
        }

        // 需要用户确认
        if permissions.requireConsent {
            // 这里应该返回需要确认状态，让UI处理
            return MCPPermissionResult(
                allowed: true,
                requiresConsent: true,
                reason: nil
            )
        }

        return MCPPermissionResult(allowed: true)
    }

    /// 获取传输层（内部使用）
    internal func getConnectedTransport(_ serverName: String) throws -> MCPHttpSseTransport {
        guard let server = servers[serverName] else {
            throw MCPError(
                code: MCPErrorCode.connectionError.rawValue,
                message: "服务器未找到: \(serverName)"
            )
        }

        guard server.state == .connected else {
            throw MCPError(
                code: MCPErrorCode.connectionError.rawValue,
                message: "服务器未连接: \(serverName)"
            )
        }

        guard let transport = transports[serverName] else {
            throw MCPError(
                code: MCPErrorCode.connectionError.rawValue,
                message: "传输层未找到: \(serverName)"
            )
        }

        return transport
    }
}

// MARK: - Supporting Types

/// MCP Prompt结果
public struct MCPPromptResult {
    public let description: String?
    public let messages: [MCPPromptMessage]
}

/// MCP Prompt消息
public struct MCPPromptMessage {
    public let role: MCPPromptRole
    public let content: MCPPromptContent
}

/// MCP Prompt角色
public enum MCPPromptRole: String {
    case user
    case assistant
}

/// MCP Prompt内容
public struct MCPPromptContent {
    public let type: String
    public let text: String?
}

/// 批量调用结果
public struct MCPBatchCallResult {
    public let index: Int
    public let toolName: String
    public let result: MCPToolCallResult?
    public let error: Error?

    public var isSuccess: Bool {
        return error == nil && result != nil
    }
}

/// 批量资源读取结果
public struct MCPBatchResourceResult {
    public let index: Int
    public let uri: String
    public let content: MCPResourceContent?
    public let error: Error?

    public var isSuccess: Bool {
        return error == nil && content != nil
    }
}

/// 服务器健康状态
public struct MCPServerHealth {
    public let serverId: String
    public let status: HealthStatus
    public let latency: TimeInterval?
    public let message: String?
    public let checkedAt: Date

    public enum HealthStatus: String {
        case healthy
        case unhealthy
        case disconnected
        case unknown
    }
}

/// 权限验证结果
public struct MCPPermissionResult {
    public let allowed: Bool
    public var requiresConsent: Bool = false
    public let reason: String?

    public init(allowed: Bool, requiresConsent: Bool = false, reason: String? = nil) {
        self.allowed = allowed
        self.requiresConsent = requiresConsent
        self.reason = reason
    }
}

// MARK: - MCPHttpSseTransport Extension

extension MCPHttpSseTransport {

    /// 发送请求
    func sendRequest(_ request: MCPRequest) async throws -> MCPResponse {
        // 这个方法需要在MCPHttpSseTransport中实现
        // 这里提供一个占位实现
        fatalError("需要在MCPHttpSseTransport中实现sendRequest")
    }
}
