//
//  TokenManager.swift
//  ChainlessChain
//
//  ERC-20代币管理器
//  负责代币添加、删除、余额查询和转账
//
//  Created by ChainlessChain on 2026-01-26.
//

import Foundation
import Combine

/// ERC-20代币管理器
@MainActor
public class TokenManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = TokenManager()

    // MARK: - Published Properties

    @Published public var tokens: [Token] = []
    @Published public var tokenBalances: [String: TokenBalance] = [:]  // tokenId+walletAddress -> balance
    @Published public var isLoading = false

    // MARK: - Private Properties

    private let contractManager: ContractManager
    private let transactionManager: TransactionManager
    private let chainManager: ChainManager
    private let database: DatabaseManager

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        self.contractManager = ContractManager.shared
        self.transactionManager = TransactionManager.shared
        self.chainManager = ChainManager.shared
        self.database = DatabaseManager.shared

        Logger.shared.info("[TokenManager] 代币管理器已初始化")
    }

    // MARK: - Initialization

    /// 初始化代币管理器
    public func initialize() async throws {
        Logger.shared.info("[TokenManager] 初始化代币管理器...")

        // 初始化数据库表
        try await initializeTables()

        // 加载已保存的代币
        try await loadTokens()

        // 添加常用代币（如果是首次运行）
        if tokens.isEmpty {
            try await addPopularTokens()
        }

        Logger.shared.info("[TokenManager] 代币管理器初始化成功，已加载 \(tokens.count) 个代币")
    }

    // MARK: - Database

    /// 初始化数据库表
    private func initializeTables() async throws {
        // 代币表
        let createTokenTable = """
        CREATE TABLE IF NOT EXISTS tokens (
            id TEXT PRIMARY KEY,
            address TEXT NOT NULL,
            chain_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            decimals INTEGER NOT NULL,
            logo_url TEXT,
            is_custom INTEGER NOT NULL DEFAULT 0,
            is_verified INTEGER NOT NULL DEFAULT 0,
            price_usd TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(address, chain_id)
        )
        """

        try database.execute(createTokenTable)

        // 代币余额表
        let createBalanceTable = """
        CREATE TABLE IF NOT EXISTS token_balances (
            id TEXT PRIMARY KEY,
            token_id TEXT NOT NULL,
            wallet_address TEXT NOT NULL,
            chain_id INTEGER NOT NULL,
            balance TEXT NOT NULL,
            balance_formatted TEXT NOT NULL,
            balance_usd TEXT,
            updated_at INTEGER NOT NULL,
            UNIQUE(token_id, wallet_address)
        )
        """

        try database.execute(createBalanceTable)

        // 创建索引
        try database.execute("CREATE INDEX IF NOT EXISTS idx_token_chain ON tokens(chain_id)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_balance_wallet ON token_balances(wallet_address)")

        Logger.shared.info("[TokenManager] 数据库表初始化成功")
    }

    // MARK: - Token Management

    /// 添加自定义代币
    public func addToken(
        address: String,
        chain: SupportedChain
    ) async throws -> Token {
        // 验证地址格式
        guard address.starts(with: "0x") && address.count == 42 else {
            throw TokenError.invalidAddress
        }

        // 检查是否已存在
        if let existing = tokens.first(where: { $0.address.lowercased() == address.lowercased() && $0.chainId == chain.chainId }) {
            return existing
        }

        // 查询代币信息
        let name = try await contractManager.getTokenName(tokenAddress: address, chain: chain)
        let symbol = try await contractManager.getTokenSymbol(tokenAddress: address, chain: chain)
        let decimals = try await contractManager.getTokenDecimals(tokenAddress: address, chain: chain)

        // 创建代币
        let token = Token(
            address: address,
            chainId: chain.chainId,
            type: .erc20,
            name: name,
            symbol: symbol,
            decimals: decimals,
            isCustom: true,
            isVerified: false
        )

        // 保存到数据库
        try await saveToken(token)

        // 添加到列表
        tokens.append(token)

        Logger.shared.info("[TokenManager] 已添加代币: \(symbol) (\(address))")

        return token
    }

    /// 删除代币
    public func deleteToken(_ token: Token) async throws {
        // 只能删除自定义代币
        guard token.isCustom else {
            throw TokenError.cannotDeleteVerifiedToken
        }

        // 从数据库删除
        try database.execute("DELETE FROM tokens WHERE id = ?", token.id)

        // 从列表删除
        tokens.removeAll { $0.id == token.id }

        Logger.shared.info("[TokenManager] 已删除代币: \(token.symbol)")
    }

    /// 获取代币列表（按链筛选）
    public func getTokens(for chain: SupportedChain? = nil) -> [Token] {
        if let chain = chain {
            return tokens.filter { $0.chainId == chain.chainId }
        }
        return tokens
    }

    /// 添加常用代币
    private func addPopularTokens() async throws {
        let popularTokens = Token.popularTestnetTokens + Token.popularMainnetTokens

        for token in popularTokens {
            try await saveToken(token)
            tokens.append(token)
        }

        Logger.shared.info("[TokenManager] 已添加 \(popularTokens.count) 个常用代币")
    }

    // MARK: - Balance Management

    /// 查询代币余额
    public func getTokenBalance(
        token: Token,
        walletAddress: String,
        refresh: Bool = false
    ) async throws -> TokenBalance {
        let balanceKey = "\(token.id)_\(walletAddress)"

        // 如果有缓存且不强制刷新，返回缓存
        if !refresh, let cached = tokenBalances[balanceKey] {
            return cached
        }

        // 查询链上余额
        let balanceRaw: String
        if token.isNative {
            // 原生代币余额
            balanceRaw = try await chainManager.getBalance(
                address: walletAddress,
                chain: token.chain ?? .ethereumMainnet
            )
        } else {
            // ERC-20代币余额
            balanceRaw = try await contractManager.getTokenBalance(
                tokenAddress: token.address,
                ownerAddress: walletAddress,
                chain: token.chain
            )
        }

        // 格式化余额
        let balanceFormatted = formatTokenBalance(balanceRaw, decimals: token.decimals)

        // 计算美元价值
        var balanceUSD: Decimal? = nil
        if let price = token.priceUSD,
           let balanceDec = Decimal(string: balanceFormatted) {
            balanceUSD = balanceDec * price
        }

        // 创建余额对象
        let balance = TokenBalance(
            id: UUID().uuidString,
            tokenId: token.id,
            walletAddress: walletAddress,
            chainId: token.chainId,
            balance: balanceRaw,
            balanceFormatted: balanceFormatted,
            balanceUSD: balanceUSD,
            updatedAt: Date()
        )

        // 保存到数据库
        try await saveTokenBalance(balance)

        // 更新缓存
        tokenBalances[balanceKey] = balance

        return balance
    }

    /// 批量查询余额
    public func refreshBalances(
        wallet: Wallet,
        tokens: [Token]
    ) async throws {
        for token in tokens {
            do {
                _ = try await getTokenBalance(token: token, walletAddress: wallet.address, refresh: true)
            } catch {
                Logger.shared.error("[TokenManager] 查询余额失败 \(token.symbol): \(error)")
            }
        }
    }

    /// 获取钱包的所有代币余额
    public func getWalletBalances(wallet: Wallet) async throws -> [TokenWithBalance] {
        let walletTokens = tokens.filter { $0.chainId == wallet.chainId }
        var result: [TokenWithBalance] = []

        for token in walletTokens {
            let balance = try? await getTokenBalance(token: token, walletAddress: wallet.address)
            result.append(TokenWithBalance(token: token, balance: balance))
        }

        // 过滤掉余额为0的代币（可选）
        // result = result.filter { $0.hasBalance }

        return result
    }

    // MARK: - Token Transfer

    /// 转账ERC-20代币
    public func transferToken(
        wallet: Wallet,
        token: Token,
        to: String,
        amount: String,  // 已格式化的数量（如 "100.50"）
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        // 转换为最小单位
        let amountInWei = convertToTokenWei(amount, decimals: token.decimals)

        // 编码transfer函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.erc20ABI,
            functionName: "transfer",
            parameters: [to, amountInWei]
        )

        // 发送合约交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: token.address,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .tokenTransfer,
            chain: token.chain
        )

        Logger.shared.info("[TokenManager] 代币转账已提交: \(amount) \(token.symbol)")

        return record
    }

    /// 授权代币给合约
    public func approveToken(
        wallet: Wallet,
        token: Token,
        spender: String,
        amount: String,  // 已格式化的数量
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        // 转换为最小单位
        let amountInWei = convertToTokenWei(amount, decimals: token.decimals)

        // 编码approve函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.erc20ABI,
            functionName: "approve",
            parameters: [spender, amountInWei]
        )

        // 发送合约交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: token.address,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .approve,
            chain: token.chain
        )

        Logger.shared.info("[TokenManager] 代币授权已提交: \(amount) \(token.symbol) to \(spender)")

        return record
    }

    /// 查询授权额度
    public func getAllowance(
        token: Token,
        owner: String,
        spender: String
    ) async throws -> String {
        let result = try await contractManager.callContractFunction(
            contractAddress: token.address,
            abi: ContractABI.erc20ABI,
            functionName: "allowance",
            parameters: [owner, spender],
            chain: token.chain
        )

        return try contractManager.decodeUint256(from: result)
    }

    // MARK: - Helper Methods

    /// 格式化代币余额
    private func formatTokenBalance(_ balance: String, decimals: Int) -> String {
        guard let balanceDecimal = Decimal(string: balance) else {
            return "0"
        }

        let divisor = Decimal(sign: .plus, exponent: decimals, significand: 1)
        let formatted = balanceDecimal / divisor

        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = min(decimals, 8)  // 最多显示8位小数

        return formatter.string(from: formatted as NSDecimalNumber) ?? "0"
    }

    /// 转换为代币最小单位
    private func convertToTokenWei(_ amount: String, decimals: Int) -> String {
        guard let amountDecimal = Decimal(string: amount) else {
            return "0"
        }

        let multiplier = Decimal(sign: .plus, exponent: decimals, significand: 1)
        let result = amountDecimal * multiplier

        return "\(result)"
    }

    // MARK: - Database Operations

    /// 加载代币
    private func loadTokens() async throws {
        let rows = try database.prepare("SELECT * FROM tokens ORDER BY created_at DESC")

        tokens = rows.compactMap { parseTokenRow($0) }

        Logger.shared.info("[TokenManager] 已加载 \(tokens.count) 个代币")
    }

    /// 保存代币
    private func saveToken(_ token: Token) async throws {
        let sql = """
        INSERT OR REPLACE INTO tokens (
            id, address, chain_id, type, name, symbol, decimals,
            logo_url, is_custom, is_verified, price_usd, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        try database.execute(
            sql,
            token.id,
            token.address,
            token.chainId,
            token.type.rawValue,
            token.name,
            token.symbol,
            token.decimals,
            token.logoUrl,
            token.isCustom ? 1 : 0,
            token.isVerified ? 1 : 0,
            token.priceUSD.map { "\($0)" },
            Int(token.createdAt.timeIntervalSince1970),
            Int(token.updatedAt.timeIntervalSince1970)
        )
    }

    /// 保存代币余额
    private func saveTokenBalance(_ balance: TokenBalance) async throws {
        let sql = """
        INSERT OR REPLACE INTO token_balances (
            id, token_id, wallet_address, chain_id, balance,
            balance_formatted, balance_usd, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """

        try database.execute(
            sql,
            balance.id,
            balance.tokenId,
            balance.walletAddress,
            balance.chainId,
            balance.balance,
            balance.balanceFormatted,
            balance.balanceUSD.map { "\($0)" },
            Int(balance.updatedAt.timeIntervalSince1970)
        )
    }

    /// 解析代币行
    private func parseTokenRow(_ row: [String: Any]) -> Token? {
        guard
            let id = row["id"] as? String,
            let address = row["address"] as? String,
            let chainId = row["chain_id"] as? Int,
            let typeRaw = row["type"] as? String,
            let type = TokenType(rawValue: typeRaw),
            let name = row["name"] as? String,
            let symbol = row["symbol"] as? String,
            let decimals = row["decimals"] as? Int,
            let isCustom = row["is_custom"] as? Int,
            let isVerified = row["is_verified"] as? Int,
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int
        else {
            return nil
        }

        let priceUSD = (row["price_usd"] as? String).flatMap { Decimal(string: $0) }

        return Token(
            id: id,
            address: address,
            chainId: chainId,
            type: type,
            name: name,
            symbol: symbol,
            decimals: decimals,
            logoUrl: row["logo_url"] as? String,
            isCustom: isCustom == 1,
            isVerified: isVerified == 1,
            priceUSD: priceUSD,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
        )
    }

    // MARK: - Cleanup

    /// 清理资源
    public func cleanup() {
        tokens.removeAll()
        tokenBalances.removeAll()

        Logger.shared.info("[TokenManager] 资源已清理")
    }
}

// MARK: - Errors

public enum TokenError: Error, LocalizedError {
    case invalidAddress
    case tokenNotFound
    case insufficientBalance
    case cannotDeleteVerifiedToken
    case queryFailed

    public var errorDescription: String? {
        switch self {
        case .invalidAddress:
            return "无效的代币合约地址"
        case .tokenNotFound:
            return "代币不存在"
        case .insufficientBalance:
            return "余额不足"
        case .cannotDeleteVerifiedToken:
            return "无法删除已验证的代币"
        case .queryFailed:
            return "查询代币信息失败"
        }
    }
}
