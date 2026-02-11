//
//  PluginSecurityPolicy.swift
//  ChainlessChain
//
//  插件安全策略
//  定义和执行插件的安全规则
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import CoreCommon

// MARK: - Plugin Security Policy

/// 插件安全策略管理器
public class PluginSecurityPolicy {
    public static let shared = PluginSecurityPolicy()

    // MARK: - Private Properties

    // 全局策略设置
    private var globalPolicy: GlobalSecurityPolicy = GlobalSecurityPolicy()

    // 插件特定策略
    private var pluginPolicies: [String: PluginSpecificPolicy] = [:]

    // 运行时限制
    private var rateLimits: [String: RateLimitState] = [:]

    private let lock = NSLock()

    // MARK: - Initialization

    private init() {
        loadPolicies()
        Logger.shared.info("[PluginSecurityPolicy] 初始化完成")
    }

    // MARK: - Public Methods

    /// 检查动作权限
    public func checkActionPermission(
        plugin: Plugin,
        action: PluginAction,
        params: [String: Any]
    ) async -> PermissionCheckResult {
        // 检查全局策略
        if !globalPolicy.allowPluginExecution {
            return PermissionCheckResult(
                allowed: false,
                reason: "插件执行已被全局禁用"
            )
        }

        // 检查插件是否被禁用
        if let policy = pluginPolicies[plugin.id], !policy.enabled {
            return PermissionCheckResult(
                allowed: false,
                reason: "该插件已被禁用"
            )
        }

        // 检查速率限制
        if !checkRateLimit(pluginId: plugin.id) {
            return PermissionCheckResult(
                allowed: false,
                reason: "请求频率过高，请稍后再试"
            )
        }

        // 检查动作黑名单
        if globalPolicy.blockedActions.contains(action.id) {
            return PermissionCheckResult(
                allowed: false,
                reason: "该动作已被禁止"
            )
        }

        // 检查参数安全
        let paramCheck = validateParams(params, for: action)
        if !paramCheck.allowed {
            return paramCheck
        }

        // 检查是否需要用户确认
        if shouldRequireConfirmation(plugin: plugin, action: action) {
            return PermissionCheckResult(
                allowed: true,
                requiresConfirmation: true,
                reason: nil
            )
        }

        return PermissionCheckResult(allowed: true)
    }

    /// 更新全局策略
    public func updateGlobalPolicy(_ policy: GlobalSecurityPolicy) {
        lock.lock()
        defer { lock.unlock() }

        globalPolicy = policy
        savePolicies()

        Logger.shared.info("[PluginSecurityPolicy] 全局策略已更新")
    }

    /// 更新插件策略
    public func updatePluginPolicy(_ pluginId: String, policy: PluginSpecificPolicy) {
        lock.lock()
        defer { lock.unlock() }

        pluginPolicies[pluginId] = policy
        savePolicies()

        Logger.shared.info("[PluginSecurityPolicy] 插件策略已更新: \(pluginId)")
    }

    /// 获取全局策略
    public func getGlobalPolicy() -> GlobalSecurityPolicy {
        lock.lock()
        defer { lock.unlock() }

        return globalPolicy
    }

    /// 获取插件策略
    public func getPluginPolicy(_ pluginId: String) -> PluginSpecificPolicy? {
        lock.lock()
        defer { lock.unlock() }

        return pluginPolicies[pluginId]
    }

    /// 重置速率限制
    public func resetRateLimit(_ pluginId: String) {
        lock.lock()
        defer { lock.unlock() }

        rateLimits.removeValue(forKey: pluginId)
    }

    /// 添加动作到黑名单
    public func blockAction(_ actionId: String) {
        lock.lock()
        defer { lock.unlock() }

        if !globalPolicy.blockedActions.contains(actionId) {
            globalPolicy.blockedActions.append(actionId)
            savePolicies()
        }
    }

    /// 从黑名单移除动作
    public func unblockAction(_ actionId: String) {
        lock.lock()
        defer { lock.unlock() }

        globalPolicy.blockedActions.removeAll { $0 == actionId }
        savePolicies()
    }

    // MARK: - Private Methods

    private func loadPolicies() {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let policyPath = documentsPath.appendingPathComponent(".chainlesschain/security-policy.json")

        guard FileManager.default.fileExists(atPath: policyPath.path) else {
            Logger.shared.info("[PluginSecurityPolicy] 使用默认策略")
            return
        }

        do {
            let data = try Data(contentsOf: policyPath)
            let policies = try JSONDecoder().decode(SecurityPoliciesData.self, from: data)

            globalPolicy = policies.global
            pluginPolicies = policies.plugins

            Logger.shared.info("[PluginSecurityPolicy] 加载了策略配置")

        } catch {
            Logger.shared.error("[PluginSecurityPolicy] 加载策略失败: \(error)")
        }
    }

    private func savePolicies() {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let policyPath = documentsPath.appendingPathComponent(".chainlesschain/security-policy.json")

        do {
            let policies = SecurityPoliciesData(
                global: globalPolicy,
                plugins: pluginPolicies
            )

            let data = try JSONEncoder().encode(policies)

            // 确保目录存在
            let directory = policyPath.deletingLastPathComponent()
            if !FileManager.default.fileExists(atPath: directory.path) {
                try FileManager.default.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true
                )
            }

            try data.write(to: policyPath)

        } catch {
            Logger.shared.error("[PluginSecurityPolicy] 保存策略失败: \(error)")
        }
    }

    private func checkRateLimit(pluginId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }

        let now = Date()
        let windowSeconds: TimeInterval = 60 // 1分钟窗口
        let maxRequests = globalPolicy.maxRequestsPerMinute

        if var state = rateLimits[pluginId] {
            // 清理过期的请求时间
            state.requestTimes = state.requestTimes.filter {
                now.timeIntervalSince($0) < windowSeconds
            }

            // 检查是否超过限制
            if state.requestTimes.count >= maxRequests {
                return false
            }

            // 添加新请求时间
            state.requestTimes.append(now)
            rateLimits[pluginId] = state

        } else {
            rateLimits[pluginId] = RateLimitState(requestTimes: [now])
        }

        return true
    }

    private func validateParams(_ params: [String: Any], for action: PluginAction) -> PermissionCheckResult {
        // 检查危险参数
        for (key, value) in params {
            // 检查路径遍历
            if let strValue = value as? String {
                if strValue.contains("../") || strValue.contains("..\\") {
                    return PermissionCheckResult(
                        allowed: false,
                        reason: "参数包含路径遍历: \(key)"
                    )
                }

                // 检查命令注入
                let dangerousChars = [";", "|", "&", "`", "$", "(", ")"]
                for char in dangerousChars {
                    if strValue.contains(char) && action.id.contains("shell") {
                        return PermissionCheckResult(
                            allowed: false,
                            reason: "参数包含潜在危险字符: \(key)"
                        )
                    }
                }
            }
        }

        return PermissionCheckResult(allowed: true)
    }

    private func shouldRequireConfirmation(plugin: Plugin, action: PluginAction) -> Bool {
        // 需要确认的场景
        if globalPolicy.alwaysConfirm {
            return true
        }

        if let policy = pluginPolicies[plugin.id], policy.confirmAllActions {
            return true
        }

        // 敏感操作需要确认
        let sensitiveActions = ["delete", "transfer", "sign", "execute", "shell"]
        for keyword in sensitiveActions {
            if action.id.lowercased().contains(keyword) {
                return true
            }
        }

        // 区块链相关操作需要确认
        if plugin.permissions.blockchain.sign || plugin.permissions.blockchain.transfer {
            return true
        }

        return false
    }
}

// MARK: - Supporting Types

/// 全局安全策略
public struct GlobalSecurityPolicy: Codable {
    public var allowPluginExecution: Bool
    public var maxRequestsPerMinute: Int
    public var blockedActions: [String]
    public var alwaysConfirm: Bool
    public var allowUnsignedPlugins: Bool
    public var maxActivePlugins: Int

    public init(
        allowPluginExecution: Bool = true,
        maxRequestsPerMinute: Int = 60,
        blockedActions: [String] = [],
        alwaysConfirm: Bool = false,
        allowUnsignedPlugins: Bool = true,
        maxActivePlugins: Int = 10
    ) {
        self.allowPluginExecution = allowPluginExecution
        self.maxRequestsPerMinute = maxRequestsPerMinute
        self.blockedActions = blockedActions
        self.alwaysConfirm = alwaysConfirm
        self.allowUnsignedPlugins = allowUnsignedPlugins
        self.maxActivePlugins = maxActivePlugins
    }
}

/// 插件特定策略
public struct PluginSpecificPolicy: Codable {
    public var enabled: Bool
    public var confirmAllActions: Bool
    public var allowedActions: [String]?
    public var blockedActions: [String]
    public var maxRequestsPerMinute: Int?

    public init(
        enabled: Bool = true,
        confirmAllActions: Bool = false,
        allowedActions: [String]? = nil,
        blockedActions: [String] = [],
        maxRequestsPerMinute: Int? = nil
    ) {
        self.enabled = enabled
        self.confirmAllActions = confirmAllActions
        self.allowedActions = allowedActions
        self.blockedActions = blockedActions
        self.maxRequestsPerMinute = maxRequestsPerMinute
    }
}

/// 权限检查结果
public struct PermissionCheckResult {
    public let allowed: Bool
    public var requiresConfirmation: Bool
    public let reason: String?

    public init(
        allowed: Bool,
        requiresConfirmation: Bool = false,
        reason: String? = nil
    ) {
        self.allowed = allowed
        self.requiresConfirmation = requiresConfirmation
        self.reason = reason
    }
}

/// 速率限制状态
private struct RateLimitState {
    var requestTimes: [Date]
}

/// 策略数据
private struct SecurityPoliciesData: Codable {
    let global: GlobalSecurityPolicy
    let plugins: [String: PluginSpecificPolicy]
}
