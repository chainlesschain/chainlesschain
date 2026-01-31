import Foundation
import CoreCommon
import Combine

/// 交易管理器
/// 负责交易提交、监控、状态更新和历史记录管理
@MainActor
public class TransactionManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = TransactionManager()

    // MARK: - Properties

    private let rpcClient: BlockchainRPCClient
    private let chainManager: ChainManager
    private let walletManager: WalletManager
    private let database: Database

    @Published public var pendingTransactions: [String: TransactionRecord] = [:]
    @Published public var isMonitoring = false

    /// 监控间隔（秒）
    private let monitorInterval: TimeInterval = 5.0

    /// 确认数要求
    private let requiredConfirmations = 12

    /// 监控任务
    private var monitorTask: Task<Void, Never>?

    /// 事件发布器
    public let transactionConfirmed = PassthroughSubject<TransactionRecord, Never>()
    public let transactionFailed = PassthroughSubject<TransactionRecord, Never>()
    public let transactionUpdated = PassthroughSubject<TransactionRecord, Never>()

    // MARK: - Initialization

    private init() {
        self.rpcClient = BlockchainRPCClient.shared
        self.chainManager = ChainManager.shared
        self.walletManager = WalletManager.shared
        self.database = Database.shared

        Logger.shared.info("[TransactionManager] 交易管理器已初始化")
    }

    // MARK: - Initialization

    /// 初始化交易管理器
    public func initialize() async throws {
        Logger.shared.info("[TransactionManager] 初始化交易管理器...")

        // 初始化数据库表
        try await initializeTables()

        // 恢复待处理交易
        try await recoverPendingTransactions()

        // 启动监控
        startMonitoring()

        Logger.shared.info("[TransactionManager] 交易管理器初始化成功")
    }

    /// 初始化数据库表
    private func initializeTables() async throws {
        let createTableSQL = """
        CREATE TABLE IF NOT EXISTS blockchain_transactions (
            id TEXT PRIMARY KEY,
            tx_hash TEXT UNIQUE,
            wallet_id TEXT NOT NULL,
            chain_id INTEGER NOT NULL,
            tx_type TEXT NOT NULL,
            status TEXT NOT NULL,
            from_address TEXT NOT NULL,
            to_address TEXT NOT NULL,
            value TEXT NOT NULL,
            data TEXT,
            nonce TEXT NOT NULL,
            gas_limit TEXT NOT NULL,
            gas_price TEXT NOT NULL,
            gas_used TEXT,
            fee TEXT,
            block_number TEXT,
            block_hash TEXT,
            confirmations INTEGER DEFAULT 0,
            error_message TEXT,
            contract_address TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            confirmed_at INTEGER
        )
        """

        try await database.execute(createTableSQL)

        // 创建索引
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_tx_hash ON blockchain_transactions(tx_hash)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_wallet_chain ON blockchain_transactions(wallet_id, chain_id)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_status ON blockchain_transactions(status)")

        Logger.shared.info("[TransactionManager] 数据库表初始化成功")
    }

    // MARK: - Transaction Submission

    /// 发送原生代币交易
    public func sendTransaction(
        wallet: Wallet,
        to: String,
        value: String,
        gasLimit: String? = nil,
        gasPrice: String? = nil,
        chain: SupportedChain? = nil
    ) async throws -> TransactionRecord {
        let activeChain = chain ?? chainManager.currentChain
        let config = chainManager.getConfig(for: activeChain)

        // 获取nonce
        let nonce = try await getNonce(address: wallet.address, chain: activeChain)

        // Gas估算
        let estimatedGasLimit = gasLimit ?? try await estimateGas(
            from: wallet.address,
            to: to,
            value: value,
            chain: activeChain
        )

        let estimatedGasPrice = gasPrice ?? try await getGasPrice(chain: activeChain)

        // 构建交易
        let txRequest = TransactionRequest(
            from: wallet.address,
            to: to,
            value: value,
            data: nil,
            gasLimit: estimatedGasLimit,
            gasPrice: estimatedGasPrice,
            nonce: nonce
        )

        // 获取已解锁的私钥
        guard let privateKey = walletManager.getUnlockedPrivateKey(walletId: wallet.id) else {
            throw TransactionError.walletLocked
        }

        // 签名交易
        let signedTx = try WalletCoreAdapter.signTransaction(
            privateKey: privateKey,
            to: to,
            amount: value,
            gasLimit: estimatedGasLimit,
            gasPrice: estimatedGasPrice,
            nonce: nonce,
            data: nil,
            chainId: activeChain.rawValue
        )

        // 发送交易
        let txHash = try await rpcClient.sendRawTransaction(
            rpcUrl: config.rpcUrl,
            signedTransaction: signedTx
        )

        // 创建交易记录
        let record = TransactionRecord(
            id: UUID().uuidString,
            hash: txHash,
            walletId: wallet.id,
            chainId: activeChain.chainId,
            type: .send,
            status: .pending,
            from: wallet.address,
            to: to,
            value: value,
            data: nil,
            nonce: String(nonce),
            gasLimit: estimatedGasLimit,
            gasPrice: estimatedGasPrice,
            gasUsed: nil,
            fee: nil,
            blockNumber: nil,
            blockHash: nil,
            confirmations: 0,
            errorMessage: nil,
            contractAddress: nil,
            createdAt: Date(),
            updatedAt: Date(),
            confirmedAt: nil
        )

        // 保存到数据库
        try await saveTransaction(record)

        // 添加到监控列表
        pendingTransactions[txHash] = record

        Logger.shared.info("[TransactionManager] 交易已提交: \(txHash)")

        return record
    }

    /// 发送合约交易
    public func sendContractTransaction(
        wallet: Wallet,
        contractAddress: String,
        data: String,
        value: String = "0",
        gasLimit: String? = nil,
        gasPrice: String? = nil,
        txType: TransactionType,
        chain: SupportedChain? = nil
    ) async throws -> TransactionRecord {
        let activeChain = chain ?? chainManager.currentChain
        let config = chainManager.getConfig(for: activeChain)

        // 获取nonce
        let nonce = try await getNonce(address: wallet.address, chain: activeChain)

        // Gas估算
        let estimatedGasLimit = gasLimit ?? try await estimateGas(
            from: wallet.address,
            to: contractAddress,
            value: value,
            data: data,
            chain: activeChain
        )

        let estimatedGasPrice = gasPrice ?? try await getGasPrice(chain: activeChain)

        // 获取已解锁的私钥
        guard let privateKey = walletManager.getUnlockedPrivateKey(walletId: wallet.id) else {
            throw TransactionError.walletLocked
        }

        // 签名交易
        let signedTx = try WalletCoreAdapter.signTransaction(
            privateKey: privateKey,
            to: contractAddress,
            amount: value,
            gasLimit: estimatedGasLimit,
            gasPrice: estimatedGasPrice,
            nonce: nonce,
            data: data,
            chainId: activeChain.rawValue
        )

        // 发送交易
        let txHash = try await rpcClient.sendRawTransaction(
            rpcUrl: config.rpcUrl,
            signedTransaction: signedTx
        )

        // 创建交易记录
        let record = TransactionRecord(
            id: UUID().uuidString,
            hash: txHash,
            walletId: wallet.id,
            chainId: activeChain.chainId,
            type: txType,
            status: .pending,
            from: wallet.address,
            to: contractAddress,
            value: value,
            data: data,
            nonce: String(nonce),
            gasLimit: estimatedGasLimit,
            gasPrice: estimatedGasPrice,
            gasUsed: nil,
            fee: nil,
            blockNumber: nil,
            blockHash: nil,
            confirmations: 0,
            errorMessage: nil,
            contractAddress: nil,
            createdAt: Date(),
            updatedAt: Date(),
            confirmedAt: nil
        )

        // 保存到数据库
        try await saveTransaction(record)

        // 添加到监控列表
        pendingTransactions[txHash] = record

        Logger.shared.info("[TransactionManager] 合约交易已提交: \(txHash)")

        return record
    }

    // MARK: - Transaction Monitoring

    /// 启动交易监控
    public func startMonitoring() {
        guard monitorTask == nil else { return }

        isMonitoring = true

        monitorTask = Task {
            while !Task.isCancelled {
                await checkPendingTransactions()
                try? await Task.sleep(nanoseconds: UInt64(monitorInterval * 1_000_000_000))
            }
        }

        Logger.shared.info("[TransactionManager] 交易监控已启动")
    }

    /// 停止交易监控
    public func stopMonitoring() {
        monitorTask?.cancel()
        monitorTask = nil
        isMonitoring = false

        Logger.shared.info("[TransactionManager] 交易监控已停止")
    }

    /// 检查待处理交易
    private func checkPendingTransactions() async {
        for (txHash, record) in pendingTransactions {
            do {
                try await updateTransactionStatus(txHash: txHash, record: record)
            } catch {
                Logger.shared.error("[TransactionManager] 更新交易状态失败 \(txHash): \(error)")
            }
        }
    }

    /// 更新交易状态
    private func updateTransactionStatus(txHash: String, record: TransactionRecord) async throws {
        let chain = SupportedChain.allCases.first { $0.chainId == record.chainId }
        guard let chain = chain else {
            throw TransactionError.invalidChain
        }

        let config = NetworkConfig.config(for: chain)

        // 获取交易收据
        guard let receipt = try? await rpcClient.getTransactionReceipt(
            rpcUrl: config.rpcUrl,
            txHash: txHash
        ) else {
            // 交易还未上链，保持pending状态
            return
        }

        var updatedRecord = record

        // 更新收据信息
        updatedRecord.blockNumber = receipt.blockNumber
        updatedRecord.blockHash = receipt.blockHash
        updatedRecord.gasUsed = receipt.gasUsed
        updatedRecord.contractAddress = receipt.contractAddress

        // 计算手续费
        if let gasUsed = receipt.gasUsed, let gasPrice = updatedRecord.gasPrice,
           let gasUsedDecimal = Decimal(string: gasUsed),
           let gasPriceDecimal = Decimal(string: gasPrice) {
            let feeInWei = gasUsedDecimal * gasPriceDecimal
            updatedRecord.fee = String(describing: feeInWei)
        }

        // 获取当前区块高度计算确认数
        if let blockNumber = receipt.blockNumber,
           let blockNum = Int(blockNumber.dropFirst(2), radix: 16) {
            if let currentBlock = try? await getCurrentBlockNumber(chain: chain) {
                updatedRecord.confirmations = max(0, currentBlock - blockNum + 1)
            }
        }

        // 更新状态
        if receipt.isSuccess {
            if updatedRecord.confirmations >= requiredConfirmations {
                updatedRecord.status = .confirmed
                updatedRecord.confirmedAt = Date()

                // 发布确认事件
                transactionConfirmed.send(updatedRecord)

                // 从监控列表移除
                pendingTransactions.removeValue(forKey: txHash)

                Logger.shared.info("[TransactionManager] 交易已确认: \(txHash)")
            } else {
                updatedRecord.status = .confirming
            }
        } else {
            updatedRecord.status = .failed
            updatedRecord.errorMessage = "Transaction execution failed"

            // 发布失败事件
            transactionFailed.send(updatedRecord)

            // 从监控列表移除
            pendingTransactions.removeValue(forKey: txHash)

            Logger.shared.error("[TransactionManager] 交易失败: \(txHash)")
        }

        updatedRecord.updatedAt = Date()

        // 更新数据库
        try await updateTransaction(updatedRecord)

        // 更新内存中的记录
        if !updatedRecord.isCompleted {
            pendingTransactions[txHash] = updatedRecord
        }

        // 发布更新事件
        transactionUpdated.send(updatedRecord)
    }

    /// 恢复待处理交易
    private func recoverPendingTransactions() async throws {
        let query = """
        SELECT * FROM blockchain_transactions
        WHERE status IN ('pending', 'confirming')
        ORDER BY created_at DESC
        """

        let rows = try await database.query(query)

        for row in rows {
            if let record = parseTransactionRecord(from: row),
               let txHash = record.hash {
                pendingTransactions[txHash] = record
            }
        }

        Logger.shared.info("[TransactionManager] 恢复 \(pendingTransactions.count) 个待处理交易")
    }

    // MARK: - Transaction History

    /// 获取交易历史
    public func getTransactionHistory(
        walletId: String? = nil,
        chainId: Int? = nil,
        limit: Int = 100,
        offset: Int = 0
    ) async throws -> [TransactionRecord] {
        var query = "SELECT * FROM blockchain_transactions WHERE 1=1"
        var params: [Any] = []

        if let walletId = walletId {
            query += " AND wallet_id = ?"
            params.append(walletId)
        }

        if let chainId = chainId {
            query += " AND chain_id = ?"
            params.append(chainId)
        }

        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.append(limit)
        params.append(offset)

        let rows = try await database.query(query, params)
        return rows.compactMap { parseTransactionRecord(from: $0) }
    }

    /// 根据地址获取交易历史
    public func getTransactionsByAddress(
        address: String,
        chainId: Int? = nil,
        limit: Int = 100
    ) async throws -> [TransactionRecord] {
        var query = """
        SELECT * FROM blockchain_transactions
        WHERE (from_address = ? OR to_address = ?)
        """
        var params: [Any] = [address, address]

        if let chainId = chainId {
            query += " AND chain_id = ?"
            params.append(chainId)
        }

        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        let rows = try await database.query(query, params)
        return rows.compactMap { parseTransactionRecord(from: $0) }
    }

    /// 获取交易详情
    public func getTransaction(txHash: String) async throws -> TransactionRecord? {
        let query = "SELECT * FROM blockchain_transactions WHERE tx_hash = ?"
        let rows = try await database.query(query, [txHash])
        return rows.first.flatMap { parseTransactionRecord(from: $0) }
    }

    /// 获取交易数量
    public func getTransactionCount(
        walletId: String? = nil,
        chainId: Int? = nil,
        status: TransactionStatus? = nil
    ) async throws -> Int {
        var query = "SELECT COUNT(*) as count FROM blockchain_transactions WHERE 1=1"
        var params: [Any] = []

        if let walletId = walletId {
            query += " AND wallet_id = ?"
            params.append(walletId)
        }

        if let chainId = chainId {
            query += " AND chain_id = ?"
            params.append(chainId)
        }

        if let status = status {
            query += " AND status = ?"
            params.append(status.rawValue)
        }

        let rows = try await database.query(query, params)
        return rows.first?["count"] as? Int ?? 0
    }

    // MARK: - Gas & Nonce Management

    /// 获取nonce
    public func getNonce(address: String, chain: SupportedChain) async throws -> Int {
        let config = NetworkConfig.config(for: chain)
        let nonceHex = try await rpcClient.getTransactionCount(
            rpcUrl: config.rpcUrl,
            address: address,
            block: "pending"
        )

        guard let nonce = Int(nonceHex.dropFirst(2), radix: 16) else {
            throw TransactionError.invalidNonce
        }

        return nonce
    }

    /// 估算Gas
    public func estimateGas(
        from: String,
        to: String,
        value: String,
        data: String? = nil,
        chain: SupportedChain? = nil
    ) async throws -> String {
        let activeChain = chain ?? chainManager.activeChain
        let config = NetworkConfig.config(for: activeChain)

        return try await rpcClient.estimateGas(
            rpcUrl: config.rpcUrl,
            from: from,
            to: to,
            value: value,
            data: data
        )
    }

    /// 获取Gas价格
    public func getGasPrice(chain: SupportedChain? = nil) async throws -> String {
        let activeChain = chain ?? chainManager.activeChain
        let config = NetworkConfig.config(for: activeChain)

        return try await rpcClient.getGasPrice(rpcUrl: config.rpcUrl)
    }

    /// 获取当前区块高度
    private func getCurrentBlockNumber(chain: SupportedChain) async throws -> Int {
        let config = NetworkConfig.config(for: chain)
        let blockHex = try await rpcClient.getBlockNumber(rpcUrl: config.rpcUrl)

        guard let blockNumber = Int(blockHex.dropFirst(2), radix: 16) else {
            throw TransactionError.invalidBlockNumber
        }

        return blockNumber
    }

    // MARK: - Database Operations

    /// 保存交易记录
    private func saveTransaction(_ record: TransactionRecord) async throws {
        let sql = """
        INSERT INTO blockchain_transactions (
            id, tx_hash, wallet_id, chain_id, tx_type, status,
            from_address, to_address, value, data, nonce,
            gas_limit, gas_price, gas_used, fee,
            block_number, block_hash, confirmations,
            error_message, contract_address,
            created_at, updated_at, confirmed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        let params: [Any?] = [
            record.id,
            record.hash,
            record.walletId,
            record.chainId,
            record.type.rawValue,
            record.status.rawValue,
            record.from,
            record.to,
            record.value,
            record.data,
            record.nonce,
            record.gasLimit,
            record.gasPrice,
            record.gasUsed,
            record.fee,
            record.blockNumber,
            record.blockHash,
            record.confirmations,
            record.errorMessage,
            record.contractAddress,
            Int(record.createdAt.timeIntervalSince1970),
            Int(record.updatedAt.timeIntervalSince1970),
            record.confirmedAt.map { Int($0.timeIntervalSince1970) }
        ]

        try await database.execute(sql, params)
    }

    /// 更新交易记录
    private func updateTransaction(_ record: TransactionRecord) async throws {
        let sql = """
        UPDATE blockchain_transactions SET
            status = ?, gas_used = ?, fee = ?,
            block_number = ?, block_hash = ?, confirmations = ?,
            error_message = ?, contract_address = ?,
            updated_at = ?, confirmed_at = ?
        WHERE tx_hash = ?
        """

        let params: [Any?] = [
            record.status.rawValue,
            record.gasUsed,
            record.fee,
            record.blockNumber,
            record.blockHash,
            record.confirmations,
            record.errorMessage,
            record.contractAddress,
            Int(record.updatedAt.timeIntervalSince1970),
            record.confirmedAt.map { Int($0.timeIntervalSince1970) },
            record.hash
        ]

        try await database.execute(sql, params)
    }

    /// 解析交易记录
    private func parseTransactionRecord(from row: [String: Any]) -> TransactionRecord? {
        guard
            let id = row["id"] as? String,
            let walletId = row["wallet_id"] as? String,
            let chainId = row["chain_id"] as? Int,
            let typeRaw = row["tx_type"] as? String,
            let type = TransactionType(rawValue: typeRaw),
            let statusRaw = row["status"] as? String,
            let status = TransactionStatus(rawValue: statusRaw),
            let from = row["from_address"] as? String,
            let to = row["to_address"] as? String,
            let value = row["value"] as? String,
            let nonce = row["nonce"] as? String,
            let gasLimit = row["gas_limit"] as? String,
            let gasPrice = row["gas_price"] as? String,
            let confirmations = row["confirmations"] as? Int,
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int
        else {
            return nil
        }

        let createdAt = Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp))
        let updatedAt = Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
        let confirmedAt = (row["confirmed_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }

        return TransactionRecord(
            id: id,
            hash: row["tx_hash"] as? String,
            walletId: walletId,
            chainId: chainId,
            type: type,
            status: status,
            from: from,
            to: to,
            value: value,
            data: row["data"] as? String,
            nonce: nonce,
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            gasUsed: row["gas_used"] as? String,
            fee: row["fee"] as? String,
            blockNumber: row["block_number"] as? String,
            blockHash: row["block_hash"] as? String,
            confirmations: confirmations,
            errorMessage: row["error_message"] as? String,
            contractAddress: row["contract_address"] as? String,
            createdAt: createdAt,
            updatedAt: updatedAt,
            confirmedAt: confirmedAt
        )
    }

    // MARK: - Cleanup

    /// 清理资源
    public func cleanup() {
        stopMonitoring()
        pendingTransactions.removeAll()

        Logger.shared.info("[TransactionManager] 资源已清理")
    }
}

// MARK: - Errors

public enum TransactionError: Error, LocalizedError {
    case invalidChain
    case invalidNonce
    case invalidBlockNumber
    case gasEstimationFailed
    case transactionFailed
    case receiptNotFound
    case walletLocked

    public var errorDescription: String? {
        switch self {
        case .invalidChain:
            return "无效的区块链网络"
        case .invalidNonce:
            return "无效的Nonce"
        case .invalidBlockNumber:
            return "无效的区块号"
        case .gasEstimationFailed:
            return "Gas估算失败"
        case .transactionFailed:
            return "交易执行失败"
        case .receiptNotFound:
            return "交易收据未找到"
        case .walletLocked:
            return "钱包已锁定，请先解锁钱包"
        }
    }
}
