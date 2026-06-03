//
//  PluginSandbox.swift
//  ChainlessChain
//
//  插件沙箱
//  提供安全的插件执行环境
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import CoreCommon

// MARK: - Plugin Sandbox

/// 插件沙箱管理器
public class PluginSandbox {
    public static let shared = PluginSandbox()

    // MARK: - Private Properties

    private var activeSandboxes: [String: SandboxEnvironment] = [:]
    private let lock = NSLock()

    // 资源限制
    private let defaultMemoryLimit: Int = 50 * 1024 * 1024 // 50MB
    private let defaultCpuLimit: Double = 0.5 // 50%
    private let defaultExecutionTimeout: TimeInterval = 30

    // MARK: - Initialization

    private init() {
        Logger.shared.info("[PluginSandbox] 初始化完成")
    }

    // MARK: - Public Methods

    /// 创建沙箱环境
    public func createSandbox(
        for plugin: Plugin,
        context: PluginSandboxContext
    ) async throws -> SandboxEnvironment {
        Logger.shared.info("[PluginSandbox] 创建沙箱: \(plugin.id)")

        let sandbox = SandboxEnvironment(
            pluginId: plugin.id,
            context: context,
            permissions: plugin.permissions
        )

        // 配置资源限制
        sandbox.memoryLimit = context.memoryLimit
        sandbox.cpuLimit = context.cpuLimit
        sandbox.executionTimeout = defaultExecutionTimeout

        // 注册沙箱
        lock.lock()
        activeSandboxes[plugin.id] = sandbox
        lock.unlock()

        Logger.shared.info("[PluginSandbox] 沙箱创建成功: \(plugin.id)")

        return sandbox
    }

    /// 销毁沙箱
    public func destroySandbox(_ pluginId: String) async {
        Logger.shared.info("[PluginSandbox] 销毁沙箱: \(pluginId)")

        lock.lock()
        if let sandbox = activeSandboxes[pluginId] {
            sandbox.cleanup()
            activeSandboxes.removeValue(forKey: pluginId)
        }
        lock.unlock()
    }

    /// 获取沙箱
    public func getSandbox(_ pluginId: String) -> SandboxEnvironment? {
        lock.lock()
        defer { lock.unlock() }

        return activeSandboxes[pluginId]
    }

    /// 在沙箱中执行代码
    public func execute<T>(
        in pluginId: String,
        operation: @escaping () async throws -> T
    ) async throws -> T {
        guard let sandbox = getSandbox(pluginId) else {
            throw PluginError.sandboxViolation("沙箱未找到")
        }

        return try await sandbox.execute(operation)
    }

    /// 检查文件访问权限
    public func checkFileAccess(
        pluginId: String,
        path: String,
        operation: FileOperation
    ) -> AccessResult {
        guard let sandbox = getSandbox(pluginId) else {
            return AccessResult(allowed: false, reason: "沙箱未找到")
        }

        return sandbox.checkFileAccess(path: path, operation: operation)
    }

    /// 检查网络访问权限
    public func checkNetworkAccess(
        pluginId: String,
        url: String,
        method: String
    ) -> AccessResult {
        guard let sandbox = getSandbox(pluginId) else {
            return AccessResult(allowed: false, reason: "沙箱未找到")
        }

        return sandbox.checkNetworkAccess(url: url, method: method)
    }

    /// 获取沙箱统计
    public func getStats(_ pluginId: String) -> SandboxStats? {
        guard let sandbox = getSandbox(pluginId) else {
            return nil
        }

        return sandbox.getStats()
    }

    /// 获取所有活跃沙箱
    public func getActiveSandboxes() -> [String] {
        lock.lock()
        defer { lock.unlock() }

        return Array(activeSandboxes.keys)
    }
}

// MARK: - Sandbox Environment

/// 沙箱执行环境
public class SandboxEnvironment {
    public let pluginId: String
    public let context: PluginSandboxContext
    public let permissions: PluginPermissions

    // 资源限制
    public var memoryLimit: Int
    public var cpuLimit: Double
    public var executionTimeout: TimeInterval

    // 统计
    private var executionCount: Int = 0
    private var totalExecutionTime: TimeInterval = 0
    private var fileAccessCount: Int = 0
    private var networkAccessCount: Int = 0
    private var deniedCount: Int = 0

    // 访问日志
    private var accessLogs: [AccessLog] = []
    private let maxLogSize = 1000

    private let lock = NSLock()

    init(
        pluginId: String,
        context: PluginSandboxContext,
        permissions: PluginPermissions
    ) {
        self.pluginId = pluginId
        self.context = context
        self.permissions = permissions
        self.memoryLimit = context.memoryLimit
        self.cpuLimit = context.cpuLimit
        self.executionTimeout = 30
    }

    /// 执行操作
    public func execute<T>(_ operation: @escaping () async throws -> T) async throws -> T {
        let startTime = Date()

        // 检查资源使用
        try checkResourceUsage()

        // 执行操作，带超时控制
        do {
            let result = try await withTimeout(seconds: executionTimeout) {
                try await operation()
            }

            // 更新统计
            lock.lock()
            executionCount += 1
            totalExecutionTime += Date().timeIntervalSince(startTime)
            lock.unlock()

            return result

        } catch {
            lock.lock()
            executionCount += 1
            totalExecutionTime += Date().timeIntervalSince(startTime)
            lock.unlock()

            throw error
        }
    }

    /// 检查文件访问
    public func checkFileAccess(path: String, operation: FileOperation) -> AccessResult {
        lock.lock()
        defer { lock.unlock() }

        fileAccessCount += 1

        // 检查禁止路径
        for denied in context.deniedPaths {
            if path.hasPrefix(denied) {
                logAccess(type: .file, target: path, allowed: false, reason: "路径被禁止")
                deniedCount += 1
                return AccessResult(allowed: false, reason: "路径被禁止: \(denied)")
            }
        }

        // 检查允许路径
        if !context.allowedPaths.isEmpty {
            var allowed = false
            for allowedPath in context.allowedPaths {
                if path.hasPrefix(allowedPath) {
                    allowed = true
                    break
                }
            }

            if !allowed {
                logAccess(type: .file, target: path, allowed: false, reason: "路径未授权")
                deniedCount += 1
                return AccessResult(allowed: false, reason: "路径未授权")
            }
        }

        // 检查操作权限
        switch operation {
        case .read:
            if !permissions.filesystem.read {
                logAccess(type: .file, target: path, allowed: false, reason: "无读取权限")
                deniedCount += 1
                return AccessResult(allowed: false, reason: "无读取权限")
            }

        case .write, .create, .delete:
            if !permissions.filesystem.write {
                logAccess(type: .file, target: path, allowed: false, reason: "无写入权限")
                deniedCount += 1
                return AccessResult(allowed: false, reason: "无写入权限")
            }

        case .execute:
            if !permissions.filesystem.execute {
                logAccess(type: .file, target: path, allowed: false, reason: "无执行权限")
                deniedCount += 1
                return AccessResult(allowed: false, reason: "无执行权限")
            }
        }

        logAccess(type: .file, target: path, allowed: true, reason: nil)
        return AccessResult(allowed: true)
    }

    /// 检查网络访问
    public func checkNetworkAccess(url: String, method: String) -> AccessResult {
        lock.lock()
        defer { lock.unlock() }

        networkAccessCount += 1

        // 检查是否允许网络访问
        if !context.networkAllowed {
            logAccess(type: .network, target: url, allowed: false, reason: "网络访问被禁止")
            deniedCount += 1
            return AccessResult(allowed: false, reason: "网络访问被禁止")
        }

        // 解析域名
        guard let urlObj = URL(string: url), let host = urlObj.host else {
            logAccess(type: .network, target: url, allowed: false, reason: "无效URL")
            deniedCount += 1
            return AccessResult(allowed: false, reason: "无效URL")
        }

        // 检查域名白名单
        if !context.allowedDomains.isEmpty {
            var allowed = false
            for domain in context.allowedDomains {
                if host == domain || host.hasSuffix(".\(domain)") {
                    allowed = true
                    break
                }
            }

            if !allowed {
                logAccess(type: .network, target: url, allowed: false, reason: "域名未授权")
                deniedCount += 1
                return AccessResult(allowed: false, reason: "域名未授权: \(host)")
            }
        }

        logAccess(type: .network, target: url, allowed: true, reason: nil)
        return AccessResult(allowed: true)
    }

    /// 获取统计信息
    public func getStats() -> SandboxStats {
        lock.lock()
        defer { lock.unlock() }

        return SandboxStats(
            pluginId: pluginId,
            executionCount: executionCount,
            totalExecutionTime: totalExecutionTime,
            fileAccessCount: fileAccessCount,
            networkAccessCount: networkAccessCount,
            deniedCount: deniedCount,
            memoryUsage: getMemoryUsage(),
            recentLogs: Array(accessLogs.suffix(100))
        )
    }

    /// 清理资源
    public func cleanup() {
        lock.lock()
        defer { lock.unlock() }

        accessLogs.removeAll()
        Logger.shared.info("[SandboxEnvironment] 清理完成: \(pluginId)")
    }

    // MARK: - Private Methods

    private func checkResourceUsage() throws {
        let memoryUsage = getMemoryUsage()
        if memoryUsage > memoryLimit {
            throw PluginError.sandboxViolation("内存超限: \(memoryUsage / 1024 / 1024)MB > \(memoryLimit / 1024 / 1024)MB")
        }
    }

    private func getMemoryUsage() -> Int {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }

        if result == KERN_SUCCESS {
            return Int(info.resident_size)
        }
        return 0
    }

    private func logAccess(type: AccessType, target: String, allowed: Bool, reason: String?) {
        if accessLogs.count >= maxLogSize {
            accessLogs.removeFirst(100)
        }

        accessLogs.append(AccessLog(
            type: type,
            target: target,
            allowed: allowed,
            reason: reason,
            timestamp: Date()
        ))
    }

    private func withTimeout<T>(seconds: TimeInterval, operation: @escaping () async throws -> T) async throws -> T {
        return try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }

            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                throw PluginError.timeout("操作超时 (\(Int(seconds))秒)")
            }

            guard let result = try await group.next() else {
                throw PluginError.executionFailed("无结果")
            }

            group.cancelAll()
            return result
        }
    }
}

// MARK: - Supporting Types

/// 文件操作类型
public enum FileOperation {
    case read
    case write
    case create
    case delete
    case execute
}

/// 访问结果
public struct AccessResult {
    public let allowed: Bool
    public let reason: String?

    public init(allowed: Bool, reason: String? = nil) {
        self.allowed = allowed
        self.reason = reason
    }
}

/// 访问类型
public enum AccessType: String, Codable {
    case file
    case network
    case system
}

/// 访问日志
public struct AccessLog: Codable {
    public let type: AccessType
    public let target: String
    public let allowed: Bool
    public let reason: String?
    public let timestamp: Date
}

/// 沙箱统计
public struct SandboxStats {
    public let pluginId: String
    public let executionCount: Int
    public let totalExecutionTime: TimeInterval
    public let fileAccessCount: Int
    public let networkAccessCount: Int
    public let deniedCount: Int
    public let memoryUsage: Int
    public let recentLogs: [AccessLog]

    public var averageExecutionTime: TimeInterval {
        guard executionCount > 0 else { return 0 }
        return totalExecutionTime / Double(executionCount)
    }

    public var denyRate: Double {
        let totalAccess = fileAccessCount + networkAccessCount
        guard totalAccess > 0 else { return 0 }
        return Double(deniedCount) / Double(totalAccess)
    }
}
