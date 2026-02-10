import Foundation
import Combine
import CoreCommon

// MARK: - Security Error

/// MCP安全错误
public enum MCPSecurityError: Error, LocalizedError {
    case accessDenied(path: String, reason: String)
    case untrustedServer(name: String)
    case readOnlyViolation(server: String, operation: String)
    case consentTimeout
    case consentDenied
    case pathNotAllowed(path: String)
    case pathForbidden(path: String)

    public var errorDescription: String? {
        switch self {
        case .accessDenied(let path, let reason):
            return "访问被拒绝: \(path) - \(reason)"
        case .untrustedServer(let name):
            return "不受信任的服务器: \(name)"
        case .readOnlyViolation(let server, let operation):
            return "只读模式违规: \(server) 不允许 \(operation) 操作"
        case .consentTimeout:
            return "用户同意请求超时"
        case .consentDenied:
            return "用户拒绝了操作"
        case .pathNotAllowed(let path):
            return "路径不在允许列表中: \(path)"
        case .pathForbidden(let path):
            return "路径被禁止访问: \(path)"
        }
    }
}

// MARK: - Risk Level

/// 风险等级
public enum MCPRiskLevel: String, Comparable {
    case low = "low"           // 只读安全操作
    case medium = "medium"     // 写入允许路径
    case high = "high"         // 删除操作、敏感读取
    case critical = "critical" // 系统级操作

    public static func < (lhs: MCPRiskLevel, rhs: MCPRiskLevel) -> Bool {
        let order: [MCPRiskLevel] = [.low, .medium, .high, .critical]
        return order.firstIndex(of: lhs)! < order.firstIndex(of: rhs)!
    }
}

// MARK: - Operation Type

/// 操作类型
public enum MCPOperationType: String {
    case read = "read"
    case write = "write"
    case delete = "delete"
    case execute = "execute"
    case query = "query"
    case unknown = "unknown"

    public var isDestructive: Bool {
        return self == .delete || self == .execute
    }
}

// MARK: - Consent Decision

/// 用户同意决策
public enum MCPConsentDecision: String {
    case allow = "allow"
    case deny = "deny"
    case alwaysAllow = "always_allow"
    case alwaysDeny = "always_deny"
}

// MARK: - Consent Request

/// 同意请求
public struct MCPConsentRequest: Identifiable {
    public let id: String
    public let serverName: String
    public let toolName: String
    public let params: [String: Any]
    public let riskLevel: MCPRiskLevel
    public let operationType: MCPOperationType
    public let timestamp: Date

    public init(
        serverName: String,
        toolName: String,
        params: [String: Any],
        riskLevel: MCPRiskLevel,
        operationType: MCPOperationType
    ) {
        self.id = UUID().uuidString
        self.serverName = serverName
        self.toolName = toolName
        self.params = params
        self.riskLevel = riskLevel
        self.operationType = operationType
        self.timestamp = Date()
    }
}

// MARK: - Audit Log Entry

/// 审计日志条目
public struct MCPAuditLogEntry: Codable, Identifiable {
    public let id: String
    public let timestamp: Date
    public let decision: String  // "ALLOWED" or "DENIED"
    public let serverName: String
    public let toolName: String
    public let params: String  // JSON字符串
    public let riskLevel: String
    public let reason: String?
    public let userId: String?

    public init(
        decision: String,
        serverName: String,
        toolName: String,
        params: [String: Any],
        riskLevel: MCPRiskLevel,
        reason: String? = nil,
        userId: String? = nil
    ) {
        self.id = UUID().uuidString
        self.timestamp = Date()
        self.decision = decision
        self.serverName = serverName
        self.toolName = toolName
        self.params = (try? JSONSerialization.data(withJSONObject: params).base64EncodedString()) ?? "{}"
        self.riskLevel = riskLevel.rawValue
        self.reason = reason
        self.userId = userId
    }
}

// MARK: - MCP Security Policy

/// MCP安全策略
@MainActor
public class MCPSecurityPolicy: ObservableObject {

    // MARK: - Singleton

    public static let shared = MCPSecurityPolicy()

    // MARK: - Configuration

    public struct Config {
        public var trustedServers: [String]
        public var allowUntrustedServers: Bool
        public var consentTimeout: TimeInterval
        public var maxAuditLogSize: Int

        public init(
            trustedServers: [String] = [],
            allowUntrustedServers: Bool = false,
            consentTimeout: TimeInterval = 30,
            maxAuditLogSize: Int = 1000
        ) {
            self.trustedServers = trustedServers
            self.allowUntrustedServers = allowUntrustedServers
            self.consentTimeout = consentTimeout
            self.maxAuditLogSize = maxAuditLogSize
        }
    }

    // MARK: - Properties

    private var config: Config

    /// 全局禁止路径 (始终阻止)
    private let FORBIDDEN_PATHS: [String] = [
        "chainlesschain.db",
        "data/ukey/",
        "data/did/private-keys/",
        "data/p2p/keys/",
        ".env",
        "config/secrets/",
        "Keychain"
    ]

    /// 服务器权限配置
    private var serverPermissions: [String: MCPServerPermissions] = [:]

    /// 同意缓存 (key: hash -> decision)
    private var consentCache: [String: MCPConsentDecision] = [:]

    /// 待处理的同意请求
    private var pendingConsentRequests: [String: CheckedContinuation<MCPConsentDecision, Error>] = [:]

    /// 审计日志
    @Published public var auditLog: [MCPAuditLogEntry] = []

    /// 统计信息
    @Published public var stats: MCPSecurityStats

    /// 事件发布器
    public let consentRequired = PassthroughSubject<MCPConsentRequest, Never>()
    public let auditLogUpdated = PassthroughSubject<MCPAuditLogEntry, Never>()

    // MARK: - Initialization

    private init() {
        self.config = Config()
        self.stats = MCPSecurityStats()

        Logger.shared.info("[MCPSecurityPolicy] 安全策略已初始化")
    }

    public func configure(_ config: Config) {
        self.config = config
    }

    // MARK: - Permission Management

    /// 设置服务器权限
    public func setServerPermissions(_ serverName: String, permissions: MCPServerPermissions) {
        serverPermissions[serverName] = permissions
        Logger.shared.info("[MCPSecurityPolicy] 设置服务器权限: \(serverName)")
    }

    /// 获取服务器权限
    public func getServerPermissions(_ serverName: String) -> MCPServerPermissions? {
        return serverPermissions[serverName]
    }

    // MARK: - Validation

    /// 验证工具执行
    public func validateToolExecution(
        serverName: String,
        toolName: String,
        params: [String: Any]
    ) async throws {
        do {
            // 1. 检查服务器是否受信任
            try validateTrustedServer(serverName)

            // 2. 检测操作类型和风险等级
            let operation = detectOperation(toolName: toolName, params: params)
            let riskLevel = assessRiskLevel(toolName: toolName, params: params, operation: operation)

            // 3. 验证路径访问 (如果适用)
            if let path = params["path"] as? String ?? params["uri"] as? String ?? params["file"] as? String {
                try validatePathAccess(serverName: serverName, operation: operation, targetPath: path)
            }

            // 4. 检查只读约束
            if operation != .read {
                try validateWritePermission(serverName: serverName, operation: operation)
            }

            // 5. 高风险操作需要用户同意
            if riskLevel >= .high {
                try await requestUserConsent(
                    serverName: serverName,
                    toolName: toolName,
                    params: params,
                    riskLevel: riskLevel,
                    operation: operation
                )
            }

            // 6. 记录审计日志
            logAudit(
                decision: "ALLOWED",
                serverName: serverName,
                toolName: toolName,
                params: params,
                riskLevel: riskLevel
            )

            stats.allowedOperations += 1

            Logger.shared.info("[MCPSecurityPolicy] 验证通过: \(serverName).\(toolName) (\(riskLevel.rawValue))")

        } catch {
            // 记录拒绝
            let operation = detectOperation(toolName: toolName, params: params)
            let riskLevel = assessRiskLevel(toolName: toolName, params: params, operation: operation)

            logAudit(
                decision: "DENIED",
                serverName: serverName,
                toolName: toolName,
                params: params,
                riskLevel: riskLevel,
                reason: error.localizedDescription
            )

            stats.deniedOperations += 1

            Logger.shared.error("[MCPSecurityPolicy] 验证失败: \(error.localizedDescription)")

            throw error
        }
    }

    /// 验证工具调用 (同步检查)
    public func validateToolCall(
        serverName: String,
        toolName: String,
        args: [String: Any]
    ) -> (permitted: Bool, reason: String?) {
        do {
            // 检查服务器权限配置
            guard let permissions = serverPermissions[serverName] else {
                Logger.shared.info("[MCPSecurityPolicy] 服务器 \(serverName) 无权限配置，默认允许")
                return (true, nil)
            }

            // 检测操作类型
            let operation = detectOperation(toolName: toolName, params: args)

            // 检查只读约束
            if permissions.readOnly && operation != .read {
                return (false, "服务器 \(serverName) 为只读模式，不允许 \(operation.rawValue) 操作")
            }

            // 验证路径访问
            if let targetPath = args["path"] as? String ?? args["uri"] as? String ?? args["file"] as? String {
                if !permissions.allowedPaths.isEmpty {
                    do {
                        try validatePathAccess(serverName: serverName, operation: operation, targetPath: targetPath)
                    } catch {
                        return (false, error.localizedDescription)
                    }
                }
            }

            return (true, nil)

        } catch {
            return (false, error.localizedDescription)
        }
    }

    /// 验证资源访问
    public func validateResourceAccess(
        serverName: String,
        resourceUri: String
    ) -> (permitted: Bool, reason: String?) {
        guard let permissions = serverPermissions[serverName] else {
            Logger.shared.info("[MCPSecurityPolicy] 服务器 \(serverName) 无权限配置，允许资源访问")
            return (true, nil)
        }

        if !permissions.allowedPaths.isEmpty {
            do {
                try validatePathAccess(serverName: serverName, operation: .read, targetPath: resourceUri)
            } catch {
                return (false, error.localizedDescription)
            }
        }

        return (true, nil)
    }

    // MARK: - Consent Handling

    /// 处理同意响应
    public func handleConsentResponse(requestId: String, decision: MCPConsentDecision) {
        guard let continuation = pendingConsentRequests.removeValue(forKey: requestId) else {
            Logger.shared.warning("[MCPSecurityPolicy] 未知的同意请求: \(requestId)")
            return
        }

        Logger.shared.info("[MCPSecurityPolicy] 收到同意响应: \(requestId) -> \(decision.rawValue)")

        continuation.resume(returning: decision)
    }

    /// 取消同意请求
    public func cancelConsentRequest(requestId: String) {
        guard let continuation = pendingConsentRequests.removeValue(forKey: requestId) else {
            return
        }

        continuation.resume(throwing: MCPSecurityError.consentDenied)
        Logger.shared.info("[MCPSecurityPolicy] 同意请求已取消: \(requestId)")
    }

    /// 清除同意缓存
    public func clearConsentCache() {
        consentCache.removeAll()
        Logger.shared.info("[MCPSecurityPolicy] 同意缓存已清除")
    }

    // MARK: - Audit Log

    /// 获取审计日志
    public func getAuditLog(
        serverName: String? = nil,
        decision: String? = nil,
        since: Date? = nil
    ) -> [MCPAuditLogEntry] {
        var log = auditLog

        if let serverName = serverName {
            log = log.filter { $0.serverName == serverName }
        }

        if let decision = decision {
            log = log.filter { $0.decision == decision }
        }

        if let since = since {
            log = log.filter { $0.timestamp >= since }
        }

        return log
    }

    /// 清除审计日志
    public func clearAuditLog() {
        auditLog.removeAll()
        Logger.shared.info("[MCPSecurityPolicy] 审计日志已清除")
    }

    // MARK: - Statistics

    /// 获取统计信息
    public func getStatistics() -> MCPSecurityStats {
        var updatedStats = stats
        updatedStats.totalOperations = auditLog.count
        updatedStats.allowedOperations = auditLog.filter { $0.decision == "ALLOWED" }.count
        updatedStats.deniedOperations = auditLog.filter { $0.decision == "DENIED" }.count
        updatedStats.consentCacheSize = consentCache.count
        updatedStats.configuredServers = serverPermissions.count
        return updatedStats
    }

    // MARK: - Private Methods

    /// 验证受信任服务器
    private func validateTrustedServer(_ serverName: String) throws {
        guard !config.trustedServers.isEmpty else { return }
        guard !config.allowUntrustedServers else { return }

        if !config.trustedServers.contains(serverName) {
            throw MCPSecurityError.untrustedServer(name: serverName)
        }
    }

    /// 验证路径访问
    private func validatePathAccess(
        serverName: String,
        operation: MCPOperationType,
        targetPath: String
    ) throws {
        let normalizedPath = normalizePath(targetPath)

        // 检查全局禁止路径
        for forbidden in FORBIDDEN_PATHS {
            if pathMatches(normalizedPath, pattern: forbidden) {
                throw MCPSecurityError.pathForbidden(path: targetPath)
            }
        }

        // 获取服务器权限
        guard let permissions = serverPermissions[serverName] else {
            throw MCPSecurityError.accessDenied(path: targetPath, reason: "服务器未配置权限")
        }

        // 检查服务器禁止路径
        for forbidden in permissions.forbiddenPaths {
            if pathMatches(normalizedPath, pattern: forbidden) {
                throw MCPSecurityError.pathForbidden(path: targetPath)
            }
        }

        // 检查允许路径 (白名单)
        if !permissions.allowedPaths.isEmpty {
            let isAllowed = permissions.allowedPaths.contains { allowed in
                if allowed.hasSuffix("*") {
                    let prefix = normalizePath(String(allowed.dropLast()))
                    return normalizedPath.hasPrefix(prefix)
                }
                return pathMatches(normalizedPath, pattern: allowed)
            }

            if !isAllowed {
                throw MCPSecurityError.pathNotAllowed(path: targetPath)
            }
        }

        Logger.shared.info("[MCPSecurityPolicy] 路径访问允许: \(targetPath)")
    }

    /// 验证写入权限
    private func validateWritePermission(serverName: String, operation: MCPOperationType) throws {
        guard let permissions = serverPermissions[serverName] else { return }

        if permissions.readOnly && operation != .read {
            throw MCPSecurityError.readOnlyViolation(server: serverName, operation: operation.rawValue)
        }
    }

    /// 检测操作类型
    private func detectOperation(toolName: String, params: [String: Any]) -> MCPOperationType {
        let lowerName = toolName.lowercased()

        if lowerName.contains("read") || lowerName.contains("get") || lowerName.contains("list") {
            return .read
        }

        if lowerName.contains("write") || lowerName.contains("create") || lowerName.contains("update") {
            return .write
        }

        if lowerName.contains("delete") || lowerName.contains("remove") {
            return .delete
        }

        if lowerName.contains("exec") || lowerName.contains("run") || lowerName.contains("execute") {
            return .execute
        }

        if lowerName.contains("query") || lowerName.contains("select") {
            return .query
        }

        return .read  // 默认安全假设
    }

    /// 评估风险等级
    private func assessRiskLevel(
        toolName: String,
        params: [String: Any],
        operation: MCPOperationType
    ) -> MCPRiskLevel {
        // Critical: 破坏性操作
        if operation.isDestructive {
            return .critical
        }

        // High: 写入或执行
        if operation == .execute || operation == .write {
            return .high
        }

        // Medium: 写入用户数据
        if operation == .write {
            return .medium
        }

        // Low: 读取操作
        return .low
    }

    /// 请求用户同意
    private func requestUserConsent(
        serverName: String,
        toolName: String,
        params: [String: Any],
        riskLevel: MCPRiskLevel,
        operation: MCPOperationType
    ) async throws {
        // 检查缓存
        let cacheKey = generateConsentKey(serverName: serverName, toolName: toolName, params: params)

        if let cached = consentCache[cacheKey] {
            if cached == .alwaysAllow {
                Logger.shared.info("[MCPSecurityPolicy] 使用缓存同意: 始终允许")
                return
            }

            if cached == .alwaysDeny {
                throw MCPSecurityError.consentDenied
            }
        }

        Logger.shared.info("[MCPSecurityPolicy] 请求用户同意: \(serverName).\(toolName)")

        let request = MCPConsentRequest(
            serverName: serverName,
            toolName: toolName,
            params: params,
            riskLevel: riskLevel,
            operationType: operation
        )

        // 发布同意请求事件
        consentRequired.send(request)

        // 等待响应
        let decision: MCPConsentDecision = try await withCheckedThrowingContinuation { continuation in
            pendingConsentRequests[request.id] = continuation

            // 设置超时
            Task {
                try? await Task.sleep(nanoseconds: UInt64(config.consentTimeout * 1_000_000_000))

                if pendingConsentRequests.removeValue(forKey: request.id) != nil {
                    continuation.resume(throwing: MCPSecurityError.consentTimeout)
                }
            }
        }

        // 处理决策
        switch decision {
        case .allow:
            return
        case .alwaysAllow:
            consentCache[cacheKey] = .alwaysAllow
            return
        case .deny:
            throw MCPSecurityError.consentDenied
        case .alwaysDeny:
            consentCache[cacheKey] = .alwaysDeny
            throw MCPSecurityError.consentDenied
        }
    }

    /// 规范化路径
    private func normalizePath(_ path: String) -> String {
        var normalized = path

        // 转换反斜杠为正斜杠
        normalized = normalized.replacingOccurrences(of: "\\", with: "/")

        // 移除尾部斜杠
        while normalized.hasSuffix("/") && normalized.count > 1 {
            normalized = String(normalized.dropLast())
        }

        // 规范化多个斜杠
        while normalized.contains("//") {
            normalized = normalized.replacingOccurrences(of: "//", with: "/")
        }

        // 移除开头的 ./
        if normalized.hasPrefix("./") {
            normalized = String(normalized.dropFirst(2))
        }

        return normalized.lowercased()
    }

    /// 路径匹配
    private func pathMatches(_ testPath: String, pattern: String) -> Bool {
        let normalizedPath = normalizePath(testPath)
        let normalizedPattern = normalizePath(pattern)

        // 精确匹配
        if normalizedPath == normalizedPattern {
            return true
        }

        // 目录匹配
        if normalizedPath.hasPrefix(normalizedPattern + "/") {
            return true
        }

        // 模式以 / 结尾
        if normalizedPattern.hasSuffix("/") && normalizedPath.hasPrefix(normalizedPattern) {
            return true
        }

        // 包含匹配
        if normalizedPath.contains("/" + normalizedPattern + "/") ||
           normalizedPath.contains("/" + normalizedPattern) ||
           normalizedPath.hasSuffix("/" + normalizedPattern) {
            return true
        }

        return false
    }

    /// 生成同意缓存键
    private func generateConsentKey(serverName: String, toolName: String, params: [String: Any]) -> String {
        let paramsHash = (try? JSONSerialization.data(withJSONObject: params).base64EncodedString()) ?? ""
        return "\(serverName):\(toolName):\(paramsHash)"
    }

    /// 记录审计日志
    private func logAudit(
        decision: String,
        serverName: String,
        toolName: String,
        params: [String: Any],
        riskLevel: MCPRiskLevel,
        reason: String? = nil
    ) {
        let entry = MCPAuditLogEntry(
            decision: decision,
            serverName: serverName,
            toolName: toolName,
            params: params,
            riskLevel: riskLevel,
            reason: reason
        )

        auditLog.insert(entry, at: 0)

        // 限制大小
        if auditLog.count > config.maxAuditLogSize {
            auditLog = Array(auditLog.prefix(config.maxAuditLogSize))
        }

        auditLogUpdated.send(entry)
    }
}

// MARK: - Statistics

/// MCP安全统计
public struct MCPSecurityStats {
    public var totalOperations: Int = 0
    public var allowedOperations: Int = 0
    public var deniedOperations: Int = 0
    public var consentCacheSize: Int = 0
    public var configuredServers: Int = 0

    public var allowRate: Double {
        guard totalOperations > 0 else { return 0 }
        return Double(allowedOperations) / Double(totalOperations) * 100
    }
}
