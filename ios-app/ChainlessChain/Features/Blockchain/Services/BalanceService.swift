import Foundation
import Combine

/// 余额服务
/// 负责查询和缓存钱包余额
@MainActor
class BalanceService: ObservableObject {
    static let shared = BalanceService()

    @Published var balances: [String: [Int: WalletBalance]] = [:]  // walletId -> chainId -> balance
    @Published var isRefreshing = false

    private let chainManager = ChainManager.shared
    private let databaseManager = DatabaseManager.shared

    private var refreshTask: Task<Void, Never>?
    private let autoRefreshInterval: TimeInterval = 60  // 60秒自动刷新

    private init() {
        // 启动自动刷新
        startAutoRefresh()
    }

    deinit {
        refreshTask?.cancel()
    }

    // MARK: - Balance Query

    /// 查询单个钱包在单个链上的余额
    func fetchBalance(
        for wallet: Wallet,
        chain: SupportedChain? = nil
    ) async throws -> WalletBalance {
        let targetChain = chain ?? SupportedChain(rawValue: wallet.chainId) ?? .ethereumMainnet

        // 查询余额
        let balanceWei = try await chainManager.getBalance(
            address: wallet.address,
            chain: targetChain
        )

        let balance = WalletBalance(
            walletId: wallet.id,
            chainId: targetChain.rawValue,
            balance: balanceWei,
            symbol: targetChain.symbol,
            decimals: 18,
            updatedAt: Date()
        )

        // 更新缓存
        var chainBalances = balances[wallet.id] ?? [:]
        chainBalances[targetChain.rawValue] = balance
        balances[wallet.id] = chainBalances

        // 保存到数据库
        try await saveBalanceToDatabase(balance)

        return balance
    }

    /// 查询单个钱包在多个链上的余额（并行）
    func fetchBalancesForMultipleChains(
        for wallet: Wallet,
        chains: [SupportedChain]
    ) async -> [Int: WalletBalance] {
        await withTaskGroup(of: (Int, WalletBalance?).self) { group in
            for chain in chains {
                group.addTask {
                    do {
                        let balance = try await self.fetchBalance(for: wallet, chain: chain)
                        return (chain.rawValue, balance)
                    } catch {
                        Logger.shared.error("查询余额失败 - Chain: \(chain.name), Error: \(error)")
                        return (chain.rawValue, nil)
                    }
                }
            }

            var results: [Int: WalletBalance] = [:]
            for await (chainId, balance) in group {
                if let balance = balance {
                    results[chainId] = balance
                }
            }
            return results
        }
    }

    /// 刷新所有钱包的余额
    func refreshAll(wallets: [Wallet]) async {
        isRefreshing = true
        defer { isRefreshing = false }

        for wallet in wallets {
            do {
                _ = try await fetchBalance(for: wallet)
            } catch {
                Logger.shared.error("刷新钱包余额失败: \(wallet.address), Error: \(error)")
            }
        }
    }

    /// 从缓存获取余额
    func getBalance(walletId: String, chainId: Int) -> WalletBalance? {
        balances[walletId]?[chainId]
    }

    // MARK: - Token Balance

    /// 查询ERC-20 Token余额
    func fetchTokenBalance(
        for wallet: Wallet,
        tokenAddress: String,
        chain: SupportedChain? = nil
    ) async throws -> WalletBalance {
        let targetChain = chain ?? SupportedChain(rawValue: wallet.chainId) ?? .ethereumMainnet

        // 查询Token余额
        let balanceWei = try await chainManager.getTokenBalance(
            tokenAddress: tokenAddress,
            walletAddress: wallet.address,
            chain: targetChain
        )

        // 查询Token信息（并行）
        async let symbolTask = try await chainManager.rpcClient.getTokenSymbol(
            rpcUrl: try await chainManager.getAvailableRPCUrl(for: targetChain),
            tokenAddress: tokenAddress
        )

        async let decimalsTask = try await chainManager.rpcClient.getTokenDecimals(
            rpcUrl: try await chainManager.getAvailableRPCUrl(for: targetChain),
            tokenAddress: tokenAddress
        )

        let symbol = try await symbolTask
        let decimals = try await decimalsTask

        let balance = WalletBalance(
            walletId: wallet.id,
            chainId: targetChain.rawValue,
            balance: balanceWei,
            symbol: symbol,
            decimals: decimals,
            updatedAt: Date()
        )

        // 保存到数据库
        try await saveBalanceToDatabase(balance)

        return balance
    }

    // MARK: - Database

    /// 从数据库加载余额
    func loadBalancesFromDatabase(for walletId: String) async throws {
        let sql = """
            SELECT wallet_id, chain_id, balance, symbol, decimals, updated_at
            FROM wallet_balances
            WHERE wallet_id = ?
        """

        let results = try databaseManager.query(sql, parameters: [walletId]) { stmt in
            parseBalanceRow(stmt)
        }

        var chainBalances: [Int: WalletBalance] = [:]
        for balance in results {
            chainBalances[balance.chainId] = balance
        }

        balances[walletId] = chainBalances
    }

    /// 保存余额到数据库
    private func saveBalanceToDatabase(_ balance: WalletBalance) async throws {
        let sql = """
            INSERT INTO wallet_balances (wallet_id, chain_id, balance, symbol, decimals, token_address, updated_at)
            VALUES (?, ?, ?, ?, ?, NULL, ?)
            ON CONFLICT(wallet_id, chain_id, COALESCE(token_address, ''))
            DO UPDATE SET
                balance = excluded.balance,
                updated_at = excluded.updated_at
        """

        try databaseManager.execute(
            sql,
            balance.walletId,
            balance.chainId,
            balance.balance,
            balance.symbol,
            balance.decimals,
            Int(balance.updatedAt.timeIntervalSince1970 * 1000)
        )
    }

    /// 解析余额行
    private func parseBalanceRow(_ stmt: OpaquePointer) -> WalletBalance? {
        guard let walletIdPtr = sqlite3_column_text(stmt, 0),
              let symbolPtr = sqlite3_column_text(stmt, 3),
              let balancePtr = sqlite3_column_text(stmt, 2) else {
            return nil
        }

        let walletId = String(cString: walletIdPtr)
        let chainId = Int(sqlite3_column_int(stmt, 1))
        let balance = String(cString: balancePtr)
        let symbol = String(cString: symbolPtr)
        let decimals = Int(sqlite3_column_int(stmt, 4))
        let updatedAtMs = Int64(sqlite3_column_int64(stmt, 5))

        return WalletBalance(
            walletId: walletId,
            chainId: chainId,
            balance: balance,
            symbol: symbol,
            decimals: decimals,
            updatedAt: Date(timeIntervalSince1970: Double(updatedAtMs) / 1000)
        )
    }

    // MARK: - Auto Refresh

    /// 启动自动刷新
    private func startAutoRefresh() {
        refreshTask = Task {
            while !Task.isCancelled {
                // 等待间隔
                try? await Task.sleep(nanoseconds: UInt64(autoRefreshInterval * 1_000_000_000))

                // 刷新所有已加载的钱包余额
                if !balances.isEmpty {
                    Logger.shared.debug("自动刷新余额...")
                    // TODO: 获取当前钱包列表并刷新
                }
            }
        }
    }

    /// 停止自动刷新
    func stopAutoRefresh() {
        refreshTask?.cancel()
    }

    /// 清除缓存
    func clearCache() {
        balances.removeAll()
    }
}
