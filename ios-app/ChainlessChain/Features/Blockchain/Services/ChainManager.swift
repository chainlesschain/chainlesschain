import Foundation
import Combine

/// 链管理器
/// 负责多链管理、RPC端点容错、链状态监控
@MainActor
class ChainManager: ObservableObject {
    static let shared = ChainManager()

    @Published var currentChain: SupportedChain = .ethereumSepolia
    @Published var chainStatus: [Int: ChainStatus] = [:]

    private let rpcClient = BlockchainRPCClient()
    private var healthCheckTask: Task<Void, Never>?

    // RPC端点状态缓存
    private var endpointHealth: [String: EndpointHealth] = [:]

    private init() {
        // 启动健康检查
        startHealthCheck()
    }

    deinit {
        healthCheckTask?.cancel()
    }

    // MARK: - Chain Operations

    /// 切换当前链
    func switchChain(to chain: SupportedChain) {
        currentChain = chain
        Logger.shared.info("切换到链: \(chain.name)")
    }

    /// 获取链配置
    func getConfig(for chain: SupportedChain) -> NetworkConfig {
        NetworkConfig.config(for: chain)
    }

    /// 获取当前链配置
    var currentConfig: NetworkConfig {
        getConfig(for: currentChain)
    }

    // MARK: - RPC Endpoint Management

    /// 获取可用的RPC URL（带容错）
    func getAvailableRPCUrl(for chain: SupportedChain) async throws -> String {
        let config = getConfig(for: chain)

        // 尝试所有RPC端点，返回第一个可用的
        for rpcUrl in config.rpcUrls {
            if await isEndpointHealthy(rpcUrl) {
                return rpcUrl
            }
        }

        // 如果所有端点都不可用，返回第一个（尝试恢复）
        Logger.shared.warn("链 \(chain.name) 所有RPC端点不可用，使用第一个端点")
        return config.rpcUrl
    }

    /// 检查端点健康状态
    func isEndpointHealthy(_ rpcUrl: String) async -> Bool {
        // 检查缓存的健康状态
        if let health = endpointHealth[rpcUrl],
           Date().timeIntervalSince(health.lastCheck) < 60 {
            return health.isHealthy
        }

        // 执行健康检查
        let isHealthy = await performHealthCheck(rpcUrl)

        // 更新缓存
        endpointHealth[rpcUrl] = EndpointHealth(
            isHealthy: isHealthy,
            lastCheck: Date()
        )

        return isHealthy
    }

    /// 执行健康检查
    private func performHealthCheck(_ rpcUrl: String) async -> Bool {
        do {
            // 尝试获取区块号（简单且快速的调用）
            let _ = try await rpcClient.getBlockNumber(rpcUrl: rpcUrl)
            return true
        } catch {
            Logger.shared.warn("RPC端点健康检查失败: \(rpcUrl), 错误: \(error)")
            return false
        }
    }

    // MARK: - Balance Queries

    /// 获取账户余额
    func getBalance(
        address: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        let targetChain = chain ?? currentChain
        let rpcUrl = try await getAvailableRPCUrl(for: targetChain)

        return try await rpcClient.getBalance(
            rpcUrl: rpcUrl,
            address: address
        )
    }

    /// 获取Token余额
    func getTokenBalance(
        tokenAddress: String,
        walletAddress: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        let targetChain = chain ?? currentChain
        let rpcUrl = try await getAvailableRPCUrl(for: targetChain)

        return try await rpcClient.getTokenBalance(
            rpcUrl: rpcUrl,
            tokenAddress: tokenAddress,
            walletAddress: walletAddress
        )
    }

    /// 获取多个链的余额（并行查询）
    func getBalancesForMultipleChains(
        address: String,
        chains: [SupportedChain]
    ) async -> [Int: Result<String, Error>] {
        await withTaskGroup(of: (Int, Result<String, Error>).self) { group in
            for chain in chains {
                group.addTask {
                    do {
                        let balance = try await self.getBalance(
                            address: address,
                            chain: chain
                        )
                        return (chain.rawValue, .success(balance))
                    } catch {
                        return (chain.rawValue, .failure(error))
                    }
                }
            }

            var results: [Int: Result<String, Error>] = [:]
            for await (chainId, result) in group {
                results[chainId] = result
            }
            return results
        }
    }

    // MARK: - Transaction Methods

    /// 获取Nonce
    func getTransactionCount(
        address: String,
        chain: SupportedChain? = nil
    ) async throws -> Int {
        let targetChain = chain ?? currentChain
        let rpcUrl = try await getAvailableRPCUrl(for: targetChain)

        let nonceHex = try await rpcClient.getTransactionCount(
            rpcUrl: rpcUrl,
            address: address
        )

        return try hexToInt(nonceHex)
    }

    /// 估算Gas
    func estimateGas(
        transaction: [String: Any],
        chain: SupportedChain? = nil
    ) async throws -> String {
        let targetChain = chain ?? currentChain
        let rpcUrl = try await getAvailableRPCUrl(for: targetChain)

        return try await rpcClient.estimateGas(
            rpcUrl: rpcUrl,
            transaction: transaction
        )
    }

    /// 获取Gas价格
    func getGasPrice(chain: SupportedChain? = nil) async throws -> GasPriceEstimate {
        let targetChain = chain ?? currentChain
        let rpcUrl = try await getAvailableRPCUrl(for: targetChain)

        // 获取当前Gas价格
        let currentPriceWei = try await rpcClient.getGasPrice(rpcUrl: rpcUrl)
        let currentPrice = try hexToInt(currentPriceWei)

        // 基于当前价格计算slow/standard/fast
        // slow: 90%, standard: 100%, fast: 120%
        let slow = Int(Double(currentPrice) * 0.9)
        let standard = currentPrice
        let fast = Int(Double(currentPrice) * 1.2)

        return GasPriceEstimate(
            slow: String(slow),
            standard: String(standard),
            fast: String(fast)
        )
    }

    /// 发送原始交易
    func sendRawTransaction(
        signedTransaction: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        let targetChain = chain ?? currentChain
        let rpcUrl = try await getAvailableRPCUrl(for: targetChain)

        return try await rpcClient.sendRawTransaction(
            rpcUrl: rpcUrl,
            signedTransaction: signedTransaction
        )
    }

    /// 获取交易回执
    func getTransactionReceipt(
        txHash: String,
        chain: SupportedChain? = nil
    ) async throws -> TransactionReceipt? {
        let targetChain = chain ?? currentChain
        let rpcUrl = try await getAvailableRPCUrl(for: targetChain)

        return try await rpcClient.getTransactionReceipt(
            rpcUrl: rpcUrl,
            txHash: txHash
        )
    }

    // MARK: - Chain Status Monitoring

    /// 启动链状态监控
    private func startHealthCheck() {
        healthCheckTask = Task {
            while !Task.isCancelled {
                await updateChainStatus()

                // 每30秒检查一次
                try? await Task.sleep(nanoseconds: 30_000_000_000)
            }
        }
    }

    /// 更新所有链的状态
    private func updateChainStatus() async {
        for chain in SupportedChain.allCases {
            await updateStatus(for: chain)
        }
    }

    /// 更新单个链的状态
    private func updateStatus(for chain: SupportedChain) async {
        let config = getConfig(for: chain)

        do {
            let rpcUrl = try await getAvailableRPCUrl(for: chain)
            let blockNumber = try await rpcClient.getBlockNumber(rpcUrl: rpcUrl)
            let block = try hexToInt(blockNumber)

            chainStatus[chain.rawValue] = ChainStatus(
                chain: chain,
                isOnline: true,
                latestBlock: block,
                lastChecked: Date()
            )
        } catch {
            chainStatus[chain.rawValue] = ChainStatus(
                chain: chain,
                isOnline: false,
                latestBlock: 0,
                lastChecked: Date(),
                error: error.localizedDescription
            )
        }
    }

    /// 获取链状态
    func getStatus(for chain: SupportedChain) -> ChainStatus? {
        chainStatus[chain.rawValue]
    }

    // MARK: - Helper Methods

    /// 十六进制转整数
    private func hexToInt(_ hex: String) throws -> Int {
        let cleanHex = hex.hasPrefix("0x") ? String(hex.dropFirst(2)) : hex

        guard let value = Int(cleanHex, radix: 16) else {
            throw ChainManagerError.invalidHexValue(hex)
        }

        return value
    }

    /// 整数转十六进制
    func intToHex(_ value: Int) -> String {
        return "0x" + String(value, radix: 16)
    }

    /// 清除缓存
    func clearCache() {
        rpcClient.clearCache()
        endpointHealth.removeAll()
    }
}

// MARK: - Models

/// 端点健康状态
struct EndpointHealth {
    let isHealthy: Bool
    let lastCheck: Date
}

/// 链状态
struct ChainStatus {
    let chain: SupportedChain
    let isOnline: Bool
    let latestBlock: Int
    let lastChecked: Date
    let error: String?

    init(chain: SupportedChain, isOnline: Bool, latestBlock: Int, lastChecked: Date, error: String? = nil) {
        self.chain = chain
        self.isOnline = isOnline
        self.latestBlock = latestBlock
        self.lastChecked = lastChecked
        self.error = error
    }
}

// MARK: - Errors

enum ChainManagerError: LocalizedError {
    case invalidHexValue(String)
    case noAvailableEndpoint

    var errorDescription: String? {
        switch self {
        case .invalidHexValue(let hex):
            return "无效的十六进制值: \(hex)"
        case .noAvailableEndpoint:
            return "没有可用的RPC端点"
        }
    }
}
