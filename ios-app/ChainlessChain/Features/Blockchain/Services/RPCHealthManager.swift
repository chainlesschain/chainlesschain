import Foundation
import Combine

/// RPC 节点状态
struct RPCNodeStatus: Identifiable {
    let id = UUID()
    let url: String
    var isHealthy: Bool
    var latency: TimeInterval
    var lastCheck: Date
    var failureCount: Int
    var requestCount: Int
    var errorCount: Int

    var errorRate: Double {
        requestCount > 0 ? Double(errorCount) / Double(requestCount) : 0
    }
}

/// RPC 健康检查配置
struct RPCHealthConfig {
    /// 健康检查间隔（秒）
    var healthCheckInterval: TimeInterval = 60
    /// 健康检查超时（秒）
    var healthCheckTimeout: TimeInterval = 5
    /// 最大失败次数
    var maxFailures: Int = 3
}

/// RPC 健康管理器
/// 负责管理多个 RPC 节点，实现负载均衡、健康检查和自动故障转移
@MainActor
public class RPCHealthManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = RPCHealthManager()

    // MARK: - Published Properties

    @Published public var nodeStats: [Int: [RPCNodeStatus]] = [:]  // chainId -> nodes
    @Published public var isMonitoring = false

    // MARK: - Events

    public let nodeRecovered = PassthroughSubject<(url: String, chainId: Int), Never>()
    public let nodeUnhealthy = PassthroughSubject<(url: String, chainId: Int), Never>()
    public let healthChecked = PassthroughSubject<(chainId: Int, healthyCount: Int, totalCount: Int), Never>()

    // MARK: - Private Properties

    private var nodes: [Int: [String: RPCNodeStatus]] = [:]  // chainId -> url -> status
    private var currentNodeIndex: [Int: Int] = [:]  // chainId -> index for round-robin
    private var healthCheckTimer: Timer?
    private var config = RPCHealthConfig()
    private var initialized = false

    // MARK: - Initialization

    private init() {
        Logger.shared.info("[RPCHealthManager] RPC 健康管理器已初始化")
    }

    // MARK: - Public Methods

    /// 初始化 RPC 管理器
    /// - Parameters:
    ///   - chainId: 链 ID
    ///   - rpcUrls: RPC URL 列表
    public func initialize(chainId: Int, rpcUrls: [String]) async throws {
        Logger.shared.info("[RPCHealthManager] 初始化 RPC 管理器 (Chain \(chainId))...")

        nodes[chainId] = [:]

        for url in rpcUrls {
            // 跳过包含占位符的 URL
            if url.contains("your-api-key") || url.contains("YOUR_") {
                Logger.shared.info("[RPCHealthManager] 跳过占位符 URL: \(url)")
                continue
            }

            do {
                let latency = try await measureLatency(url: url)

                let status = RPCNodeStatus(
                    url: url,
                    isHealthy: true,
                    latency: latency,
                    lastCheck: Date(),
                    failureCount: 0,
                    requestCount: 0,
                    errorCount: 0
                )

                nodes[chainId]?[url] = status
                Logger.shared.info("[RPCHealthManager] 节点初始化成功: \(url) (延迟: \(Int(latency * 1000))ms)")
            } catch {
                Logger.shared.warn("[RPCHealthManager] 节点初始化失败: \(url) - \(error.localizedDescription)")

                let status = RPCNodeStatus(
                    url: url,
                    isHealthy: false,
                    latency: .infinity,
                    lastCheck: Date(),
                    failureCount: 1,
                    requestCount: 0,
                    errorCount: 0
                )

                nodes[chainId]?[url] = status
            }
        }

        let healthyCount = getHealthyNodes(chainId: chainId).count
        let totalCount = nodes[chainId]?.count ?? 0

        guard healthyCount > 0 else {
            throw RPCError.noAvailableNodes
        }

        currentNodeIndex[chainId] = 0
        updateNodeStats()

        if !isMonitoring {
            startHealthCheck()
        }

        initialized = true
        Logger.shared.info("[RPCHealthManager] RPC 管理器初始化成功，\(healthyCount)/\(totalCount) 个节点可用")
    }

    /// 添加 RPC URL
    /// - Parameters:
    ///   - chainId: 链 ID
    ///   - urls: RPC URL 列表
    public func addRPCUrls(chainId: Int, urls: [String]) async {
        for url in urls {
            guard nodes[chainId]?[url] == nil else { continue }

            do {
                let latency = try await measureLatency(url: url)

                let status = RPCNodeStatus(
                    url: url,
                    isHealthy: true,
                    latency: latency,
                    lastCheck: Date(),
                    failureCount: 0,
                    requestCount: 0,
                    errorCount: 0
                )

                nodes[chainId]?[url] = status
                Logger.shared.info("[RPCHealthManager] 新节点已添加: \(url)")
            } catch {
                Logger.shared.warn("[RPCHealthManager] 添加节点失败: \(url)")
            }
        }

        updateNodeStats()
    }

    /// 移除 RPC URL
    public func removeRPCUrl(chainId: Int, url: String) {
        nodes[chainId]?.removeValue(forKey: url)
        updateNodeStats()
        Logger.shared.info("[RPCHealthManager] 节点已移除: \(url)")
    }

    /// 获取最佳节点 URL
    /// - Parameter chainId: 链 ID
    /// - Returns: 最佳 RPC URL
    public func getBestRPCUrl(chainId: Int) throws -> String {
        let healthyNodes = getHealthyNodes(chainId: chainId)

        guard !healthyNodes.isEmpty else {
            throw RPCError.noAvailableNodes
        }

        // 按延迟排序，选择最快的节点
        let sortedNodes = healthyNodes.sorted { $0.latency < $1.latency }
        let bestNode = sortedNodes.first!

        Logger.shared.info("[RPCHealthManager] 使用最佳节点: \(bestNode.url) (延迟: \(Int(bestNode.latency * 1000))ms)")

        return bestNode.url
    }

    /// 获取下一个可用节点 URL（轮询）
    /// - Parameter chainId: 链 ID
    /// - Returns: 下一个 RPC URL
    public func getNextRPCUrl(chainId: Int) throws -> String {
        let healthyNodes = getHealthyNodes(chainId: chainId)

        guard !healthyNodes.isEmpty else {
            throw RPCError.noAvailableNodes
        }

        let index = currentNodeIndex[chainId] ?? 0
        let nextIndex = (index + 1) % healthyNodes.count
        currentNodeIndex[chainId] = nextIndex

        let node = healthyNodes[nextIndex]
        Logger.shared.info("[RPCHealthManager] 使用节点 \(nextIndex + 1)/\(healthyNodes.count): \(node.url)")

        return node.url
    }

    /// 执行带故障转移的请求
    /// - Parameters:
    ///   - chainId: 链 ID
    ///   - maxRetries: 最大重试次数
    ///   - request: 请求闭包
    /// - Returns: 请求结果
    public func executeWithFailover<T>(
        chainId: Int,
        maxRetries: Int = 3,
        request: @escaping (String) async throws -> T
    ) async throws -> T {
        let healthyNodes = getHealthyNodes(chainId: chainId)

        guard !healthyNodes.isEmpty else {
            throw RPCError.noAvailableNodes
        }

        var lastError: Error?
        let nodesToTry = Array(healthyNodes.prefix(min(maxRetries, healthyNodes.count)))

        for (index, node) in nodesToTry.enumerated() {
            do {
                Logger.shared.info("[RPCHealthManager] 尝试节点 \(index + 1)/\(nodesToTry.count): \(node.url)")

                // 更新请求计数
                incrementRequestCount(chainId: chainId, url: node.url)

                let result = try await request(node.url)

                Logger.shared.info("[RPCHealthManager] 请求成功: \(node.url)")
                return result
            } catch {
                lastError = error
                Logger.shared.warn("[RPCHealthManager] 节点请求失败 (尝试 \(index + 1)): \(node.url) - \(error.localizedDescription)")

                // 更新错误计数
                incrementErrorCount(chainId: chainId, url: node.url)

                // 如果失败次数过多，标记为不健康
                if let nodeStatus = nodes[chainId]?[node.url], nodeStatus.failureCount >= config.maxFailures {
                    markNodeUnhealthy(chainId: chainId, url: node.url)
                }
            }
        }

        Logger.shared.error("[RPCHealthManager] 所有节点请求失败 (\(nodesToTry.count) 次尝试)")
        throw lastError ?? RPCError.allNodesFailed
    }

    /// 获取健康节点列表
    /// - Parameter chainId: 链 ID
    /// - Returns: 健康节点列表
    public func getHealthyNodes(chainId: Int) -> [RPCNodeStatus] {
        guard let chainNodes = nodes[chainId] else { return [] }
        return chainNodes.values.filter { $0.isHealthy }
    }

    /// 获取节点统计信息
    /// - Parameter chainId: 链 ID
    /// - Returns: 节点统计列表
    public func getNodeStats(chainId: Int) -> [RPCNodeStatus] {
        return Array(nodes[chainId]?.values ?? [])
    }

    /// 重置节点统计
    public func resetStats(chainId: Int, url: String? = nil) {
        if let url = url {
            if var node = nodes[chainId]?[url] {
                node = RPCNodeStatus(
                    url: node.url,
                    isHealthy: node.isHealthy,
                    latency: node.latency,
                    lastCheck: node.lastCheck,
                    failureCount: 0,
                    requestCount: 0,
                    errorCount: 0
                )
                nodes[chainId]?[url] = node
                Logger.shared.info("[RPCHealthManager] 已重置节点统计: \(url)")
            }
        } else {
            for (url, node) in nodes[chainId] ?? [:] {
                var newNode = node
                newNode = RPCNodeStatus(
                    url: newNode.url,
                    isHealthy: newNode.isHealthy,
                    latency: newNode.latency,
                    lastCheck: newNode.lastCheck,
                    failureCount: 0,
                    requestCount: 0,
                    errorCount: 0
                )
                nodes[chainId]?[url] = newNode
            }
            Logger.shared.info("[RPCHealthManager] 已重置所有节点统计")
        }

        updateNodeStats()
    }

    // MARK: - Health Check

    /// 启动健康检查
    public func startHealthCheck() {
        guard healthCheckTimer == nil else { return }

        isMonitoring = true
        Logger.shared.info("[RPCHealthManager] 启动健康检查 (间隔: \(Int(config.healthCheckInterval))秒)")

        healthCheckTimer = Timer.scheduledTimer(withTimeInterval: config.healthCheckInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.performHealthCheck()
            }
        }
    }

    /// 停止健康检查
    public func stopHealthCheck() {
        healthCheckTimer?.invalidate()
        healthCheckTimer = nil
        isMonitoring = false
        Logger.shared.info("[RPCHealthManager] 健康检查已停止")
    }

    /// 执行健康检查
    public func performHealthCheck() async {
        for chainId in nodes.keys {
            await performHealthCheck(chainId: chainId)
        }
    }

    /// 执行特定链的健康检查
    public func performHealthCheck(chainId: Int) async {
        Logger.shared.info("[RPCHealthManager] 执行健康检查 (Chain \(chainId))...")

        guard let chainNodes = nodes[chainId] else { return }

        for (url, node) in chainNodes {
            do {
                let latency = try await measureLatency(url: url)

                var updatedNode = node

                if !node.isHealthy {
                    Logger.shared.info("[RPCHealthManager] 节点恢复健康: \(url)")
                    nodeRecovered.send((url: url, chainId: chainId))
                }

                updatedNode = RPCNodeStatus(
                    url: url,
                    isHealthy: true,
                    latency: latency,
                    lastCheck: Date(),
                    failureCount: 0,
                    requestCount: node.requestCount,
                    errorCount: node.errorCount
                )

                nodes[chainId]?[url] = updatedNode
            } catch {
                var updatedNode = node

                if node.isHealthy {
                    Logger.shared.warn("[RPCHealthManager] 节点变为不健康: \(url)")
                    nodeUnhealthy.send((url: url, chainId: chainId))
                }

                updatedNode = RPCNodeStatus(
                    url: url,
                    isHealthy: false,
                    latency: .infinity,
                    lastCheck: Date(),
                    failureCount: node.failureCount + 1,
                    requestCount: node.requestCount,
                    errorCount: node.errorCount
                )

                nodes[chainId]?[url] = updatedNode
            }
        }

        let healthyCount = getHealthyNodes(chainId: chainId).count
        let totalCount = chainNodes.count

        healthChecked.send((chainId: chainId, healthyCount: healthyCount, totalCount: totalCount))
        updateNodeStats()

        Logger.shared.info("[RPCHealthManager] 健康检查完成: \(healthyCount)/\(totalCount) 个节点健康")
    }

    /// 清理资源
    public func cleanup() {
        Logger.shared.info("[RPCHealthManager] 清理资源...")

        stopHealthCheck()
        nodes.removeAll()
        currentNodeIndex.removeAll()
        nodeStats.removeAll()
        initialized = false
    }

    // MARK: - Private Methods

    /// 测量节点延迟
    private func measureLatency(url: String) async throws -> TimeInterval {
        let start = Date()

        guard let rpcUrl = URL(string: url) else {
            throw RPCError.invalidURL
        }

        var request = URLRequest(url: rpcUrl)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = config.healthCheckTimeout

        // 发送 eth_blockNumber 请求
        let body: [String: Any] = [
            "jsonrpc": "2.0",
            "method": "eth_blockNumber",
            "params": [],
            "id": 1
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw RPCError.healthCheckFailed
        }

        return Date().timeIntervalSince(start)
    }

    /// 更新节点统计（用于 UI）
    private func updateNodeStats() {
        var stats: [Int: [RPCNodeStatus]] = [:]
        for (chainId, chainNodes) in nodes {
            stats[chainId] = Array(chainNodes.values)
        }
        nodeStats = stats
    }

    /// 增加请求计数
    private func incrementRequestCount(chainId: Int, url: String) {
        guard var node = nodes[chainId]?[url] else { return }

        node = RPCNodeStatus(
            url: node.url,
            isHealthy: node.isHealthy,
            latency: node.latency,
            lastCheck: node.lastCheck,
            failureCount: node.failureCount,
            requestCount: node.requestCount + 1,
            errorCount: node.errorCount
        )

        nodes[chainId]?[url] = node
    }

    /// 增加错误计数
    private func incrementErrorCount(chainId: Int, url: String) {
        guard var node = nodes[chainId]?[url] else { return }

        node = RPCNodeStatus(
            url: node.url,
            isHealthy: node.isHealthy,
            latency: node.latency,
            lastCheck: node.lastCheck,
            failureCount: node.failureCount + 1,
            requestCount: node.requestCount,
            errorCount: node.errorCount + 1
        )

        nodes[chainId]?[url] = node
    }

    /// 标记节点为不健康
    private func markNodeUnhealthy(chainId: Int, url: String) {
        guard var node = nodes[chainId]?[url] else { return }

        if node.isHealthy {
            Logger.shared.warn("[RPCHealthManager] 节点标记为不健康: \(url)")
            nodeUnhealthy.send((url: url, chainId: chainId))
        }

        node = RPCNodeStatus(
            url: node.url,
            isHealthy: false,
            latency: node.latency,
            lastCheck: node.lastCheck,
            failureCount: node.failureCount,
            requestCount: node.requestCount,
            errorCount: node.errorCount
        )

        nodes[chainId]?[url] = node
        updateNodeStats()
    }
}

// MARK: - Errors

public enum RPCError: Error, LocalizedError {
    case invalidURL
    case noAvailableNodes
    case allNodesFailed
    case healthCheckFailed
    case timeout

    public var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "无效的 RPC URL"
        case .noAvailableNodes:
            return "没有可用的 RPC 节点"
        case .allNodesFailed:
            return "所有 RPC 节点请求失败"
        case .healthCheckFailed:
            return "健康检查失败"
        case .timeout:
            return "请求超时"
        }
    }
}
