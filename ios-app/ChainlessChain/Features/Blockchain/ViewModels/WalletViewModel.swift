import Foundation
import SwiftUI
import Combine

/// 钱包视图模型
@MainActor
class WalletViewModel: ObservableObject {
    @Published var wallets: [Wallet] = []
    @Published var currentWallet: Wallet?
    @Published var balances: [String: WalletBalance] = [:]  // walletId -> balance
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var showError = false

    private let walletManager = WalletManager.shared
    private let balanceService = BalanceService.shared
    private let chainManager = ChainManager.shared
    private let biometricSigner = BiometricSigner.shared
    private var cancellables = Set<AnyCancellable>()

    init() {
        // 订阅钱包管理器的变化
        walletManager.$wallets
            .assign(to: &$wallets)

        walletManager.$currentWallet
            .assign(to: &$currentWallet)

        // 加载钱包余额
        Task {
            await loadBalances()
        }
    }

    // MARK: - 创建钱包

    /// 创建新钱包
    func createWallet(password: String, chainId: Int = 1) async {
        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await walletManager.createWallet(password: password, chainId: chainId)

            // 显示助记词备份提示
            Logger.shared.info("钱包创建成功，请备份助记词")

            // 刷新余额
            await loadBalance(for: result.wallet)
        } catch {
            handleError(error)
        }
    }

    /// 从助记词导入钱包
    func createWalletWithMnemonic(password: String, chainId: Int = 1) async throws -> String {
        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await walletManager.createWallet(password: password, chainId: chainId)
            await loadBalance(for: result.wallet)
            return result.mnemonic
        } catch {
            handleError(error)
            throw error
        }
    }

    func importFromMnemonic(mnemonic: String, password: String, chainId: Int = 1) async {
        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await walletManager.importFromMnemonic(
                mnemonic: mnemonic,
                password: password,
                chainId: chainId
            )

            Logger.shared.info("钱包导入成功: \(result.wallet.address)")

            await loadBalance(for: result.wallet)
        } catch {
            handleError(error)
        }
    }

    /// 从私钥导入钱包
    func importFromPrivateKey(privateKey: String, password: String, chainId: Int = 1) async {
        isLoading = true
        defer { isLoading = false }

        do {
            let wallet = try await walletManager.importFromPrivateKey(
                privateKey: privateKey,
                password: password,
                chainId: chainId
            )

            Logger.shared.info("从私钥导入成功: \(wallet.address)")

            await loadBalance(for: wallet)
        } catch {
            handleError(error)
        }
    }

    // MARK: - 钱包操作

    /// 删除钱包
    func deleteWallet(_ wallet: Wallet) async {
        isLoading = true
        defer { isLoading = false }

        do {
            try await walletManager.deleteWallet(wallet)

            // 移除余额缓存
            balances.removeValue(forKey: wallet.id)

            Logger.shared.info("钱包已删除: \(wallet.address)")
        } catch {
            handleError(error)
        }
    }

    /// 设置默认钱包
    func setDefaultWallet(_ wallet: Wallet) async {
        isLoading = true
        defer { isLoading = false }

        do {
            try await walletManager.setDefaultWallet(wallet)

            Logger.shared.info("默认钱包已设置: \(wallet.address)")
        } catch {
            handleError(error)
        }
    }

    /// 使用生物识别解锁钱包
    func unlockWithBiometric(walletId: String, password: String) async -> Bool {
        do {
            _ = try await biometricSigner.unlockWalletWithBiometric(
                walletId: walletId,
                password: password
            )
            return true
        } catch {
            handleError(error)
            return false
        }
    }

    // MARK: - 余额查询

    /// 加载所有钱包余额
    func loadBalances() async {
        for wallet in wallets {
            await loadBalance(for: wallet)
        }
    }

    /// 加载单个钱包余额
    func loadBalance(for wallet: Wallet) async {
        do {
            // 使用 BalanceService 查询真实余额
            let balance = try await balanceService.fetchBalance(for: wallet)

            // 更新缓存
            balances[wallet.id] = balance

            Logger.shared.info("余额加载成功: \(wallet.address) = \(balance.displayBalance) \(balance.symbol)")
        } catch {
            // 查询失败时使用占位数据
            Logger.shared.warn("余额查询失败: \(error.localizedDescription)")

            let placeholderBalance = WalletBalance(
                walletId: wallet.id,
                chainId: wallet.chainId,
                balance: "0",
                symbol: wallet.chain?.symbol ?? "ETH",
                decimals: 18,
                updatedAt: Date()
            )

            balances[wallet.id] = placeholderBalance
        }
    }

    /// 刷新余额
    func refreshBalances() async {
        isLoading = true
        defer { isLoading = false }

        await loadBalances()
    }

    /// 获取钱包余额
    func getBalance(for walletId: String) -> WalletBalance? {
        balances[walletId]
    }

    // MARK: - 多链操作

    /// 查询多链余额
    func fetchMultiChainBalances(for wallet: Wallet, chains: [SupportedChain]) async {
        isLoading = true
        defer { isLoading = false }

        do {
            let multiChainBalances = await balanceService.fetchBalancesForMultipleChains(
                for: wallet,
                chains: chains
            )

            // 更新缓存 - 选择主链余额
            if let primaryChain = SupportedChain(rawValue: wallet.chainId),
               let primaryBalance = multiChainBalances[primaryChain.rawValue] {
                balances[wallet.id] = primaryBalance
            }

            Logger.shared.info("多链余额查询完成: \(multiChainBalances.count) 条链")
        } catch {
            handleError(error)
        }
    }

    /// 切换钱包网络
    func switchChain(for wallet: Wallet, to chain: SupportedChain) async {
        isLoading = true
        defer { isLoading = false }

        // 切换ChainManager的当前链
        chainManager.switchChain(to: chain)

        // 重新加载余额
        await loadBalance(for: wallet)

        Logger.shared.info("切换网络: \(chain.name)")
    }

    /// 获取当前选中的链
    var currentChain: SupportedChain {
        chainManager.currentChain
    }

    /// 获取所有支持的链
    var supportedChains: [SupportedChain] {
        SupportedChain.allCases
    }

    // MARK: - 辅助方法

    /// 格式化地址
    func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        let start = address.prefix(6)
        let end = address.suffix(4)
        return "\(start)...\(end)"
    }

    /// 检查生物识别可用性
    func biometricAvailable() -> Bool {
        biometricSigner.biometricAvailable().available
    }

    /// 获取生物识别类型
    func biometricType() -> String {
        biometricSigner.biometricTypeName()
    }

    /// 处理错误
    private func handleError(_ error: Error) {
        errorMessage = error.localizedDescription
        showError = true
        Logger.shared.error("钱包操作失败: \(error)")
    }

    /// 清除错误
    func clearError() {
        errorMessage = nil
        showError = false
    }
}
