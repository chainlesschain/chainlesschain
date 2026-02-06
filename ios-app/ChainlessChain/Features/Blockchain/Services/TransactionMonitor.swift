import Foundation
import Combine

/// 交易状态
public enum TransactionMonitorStatus: String, Codable {
    case pending = "pending"
    case confirmed = "confirmed"
    case failed = "failed"
}

/// 待处理交易信息
struct PendingTransactionInfo {
    let txHash: String
    var retries: Int
    let addedAt: Date
    var onConfirmed: ((TransactionReceipt) -> Void)?
    var onFailed: ((Error?) -> Void)?
}

/// 交易收据
public struct TransactionReceipt: Codable {
    public let transactionHash: String
    public let blockNumber: Int
    public let blockHash: String
    public let status: Int  // 1 = success, 0 = failure
    public let gasUsed: String
    public let gasPrice: String?
    public let from: String
    public let to: String?

    public var isSuccess: Bool {
        return status == 1
    }
}

/// 交易监控器
/// 负责监控区块链交易状态，自动更新本地数据库
/// 功能：
/// - 提交交易并监控
/// - 等待交易确认
/// - 更新数据库状态
/// - 交易重试机制
@MainActor
public class TransactionMonitor: ObservableObject {

    // MARK: - Singleton

    public static let shared = TransactionMonitor()

    // MARK: - Published Properties

    @Published public var pendingTransactionCount: Int = 0
    @Published public var isMonitoring = false

    // MARK: - Events

    public let transactionConfirmed = PassthroughSubject<(txHash: String, receipt: TransactionReceipt), Never>()
    public let transactionFailed = PassthroughSubject<(txHash: String, error: Error?), Never>()

    // MARK: - Private Properties

    private let rpcClient: BlockchainRPCClient
    private let database: DatabaseManager

    /// 待处理交易 (txHash => info)
    private var pendingTxs: [String: PendingTransactionInfo] = [:]

    /// 监控间隔（秒）
    private let monitorInterval: TimeInterval = 5

    /// 最大重试次数
    private let maxRetries = 10

    /// 监控定时器
    private var monitorTimer: Timer?

    private var initialized = false

    // MARK: - Initialization

    private init() {
        self.rpcClient = BlockchainRPCClient.shared
        self.database = DatabaseManager.shared
        Logger.shared.info("[TransactionMonitor] 交易监控器已初始化")
    }

    // MARK: - Public Methods

    /// 初始化监控器
    public func initialize() async throws {
        Logger.shared.info("[TransactionMonitor] 初始化交易监控器...")

        try await initializeTables()
        await recoverPendingTransactions()
        startMonitoring()

        initialized = true
        Logger.shared.info("[TransactionMonitor] 交易监控器初始化成功")
    }

    /// 提交交易并监控状态
    /// - Parameters:
    ///   - txHash: 交易哈希
    ///   - fromAddress: 发送地址
    ///   - toAddress: 接收地址
    ///   - value: 金额
    ///   - txType: 交易类型
    ///   - localRefId: 本地引用ID
    ///   - onConfirmed: 确认回调
    ///   - onFailed: 失败回调
    /// - Returns: 交易哈希
    public func submitAndMonitor(
        txHash: String,
        fromAddress: String,
        toAddress: String?,
        value: String?,
        txType: String? = nil,
        localRefId: String? = nil,
        onConfirmed: ((TransactionReceipt) -> Void)? = nil,
        onFailed: ((Error?) -> Void)? = nil
    ) async throws -> String {
        // 保存到数据库（状态: pending）
        try await saveTx(
            txHash: txHash,
            fromAddress: fromAddress,
            toAddress: toAddress,
            value: value,
            status: .pending,
            txType: txType,
            localRefId: localRefId
        )

        // 添加到监控列表
        let info = PendingTransactionInfo(
            txHash: txHash,
            retries: 0,
            addedAt: Date(),
            onConfirmed: onConfirmed,
            onFailed: onFailed
        )
        pendingTxs[txHash] = info
        pendingTransactionCount = pendingTxs.count

        Logger.shared.info("[TransactionMonitor] 开始监控交易: \(txHash)")

        return txHash
    }

    /// 监控交易确认
    /// - Parameters:
    ///   - txHash: 交易哈希
    ///   - confirmations: 所需确认数（默认1）
    public func monitorTx(
        txHash: String,
        confirmations: Int = 1,
        onConfirmed: ((TransactionReceipt) -> Void)? = nil,
        onFailed: ((Error?) -> Void)? = nil
    ) async {
        do {
            // 获取交易收据
            if let receipt = try await rpcClient.getTransactionReceipt(txHash: txHash) {
                if receipt.isSuccess {
                    // 交易成功
                    try await updateTxStatus(txHash: txHash, status: .confirmed, receipt: receipt)
                    onConfirmed?(receipt)
                    transactionConfirmed.send((txHash: txHash, receipt: receipt))
                    Logger.shared.info("[TransactionMonitor] 交易确认成功: \(txHash)")
                } else {
                    // 交易失败
                    try await updateTxStatus(txHash: txHash, status: .failed, receipt: receipt)
                    let error = TransactionMonitorError.transactionFailed
                    onFailed?(error)
                    transactionFailed.send((txHash: txHash, error: error))
                    Logger.shared.error("[TransactionMonitor] 交易失败: \(txHash)")
                }

                // 从待处理列表移除
                pendingTxs.removeValue(forKey: txHash)
                pendingTransactionCount = pendingTxs.count
            }
        } catch {
            Logger.shared.error("[TransactionMonitor] 监控交易出错: \(txHash) - \(error)")
        }
    }

    /// 获取交易历史
    /// - Parameters:
    ///   - address: 地址（可选）
    ///   - chainId: 链ID（可选）
    ///   - limit: 限制数量
    ///   - offset: 偏移量
    /// - Returns: 交易列表
    public func getTxHistory(
        address: String? = nil,
        chainId: Int? = nil,
        limit: Int = 100,
        offset: Int = 0
    ) async throws -> [TransactionRecord] {
        var query = "SELECT * FROM blockchain_transactions WHERE 1=1"
        var params: [Any] = []

        if let address = address {
            query += " AND (from_address = ? OR to_address = ?)"
            params.append(contentsOf: [address, address])
        }

        if let chainId = chainId {
            query += " AND chain_id = ?"
            params.append(chainId)
        }

        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.append(contentsOf: [limit, offset])

        let rows = try database.prepare(query, params)

        return rows.compactMap { parseTransactionRow($0) }
    }

    /// 获取交易详情
    /// - Parameter txHash: 交易哈希
    /// - Returns: 交易记录
    public func getTxDetail(txHash: String) async throws -> TransactionRecord? {
        let rows = try database.prepare(
            "SELECT * FROM blockchain_transactions WHERE tx_hash = ?",
            [txHash]
        )
        return rows.first.flatMap { parseTransactionRow($0) }
    }

    /// 取消交易监控
    public func cancelMonitoring(txHash: String) {
        pendingTxs.removeValue(forKey: txHash)
        pendingTransactionCount = pendingTxs.count
        Logger.shared.info("[TransactionMonitor] 已取消监控: \(txHash)")
    }

    /// 加速交易（通过提高 gas price 重新发送）
    public func speedUpTransaction(
        txHash: String,
        newGasPrice: String
    ) async throws -> String {
        // 获取原始交易
        guard let tx = try await getTxDetail(txHash: txHash) else {
            throw TransactionMonitorError.transactionNotFound
        }

        // 这里需要重新签名并发送交易
        // 实际实现需要钱包管理器配合
        Logger.shared.info("[TransactionMonitor] 加速交易: \(txHash) -> 新 gas price: \(newGasPrice)")

        throw TransactionMonitorError.notImplemented
    }

    /// 取消交易（通过发送 0 值交易替换）
    public func cancelTransaction(txHash: String) async throws -> String {
        // 获取原始交易
        guard let tx = try await getTxDetail(txHash: txHash) else {
            throw TransactionMonitorError.transactionNotFound
        }

        // 这里需要发送一个 0 值交易到自己地址，使用相同 nonce
        Logger.shared.info("[TransactionMonitor] 取消交易: \(txHash)")

        throw TransactionMonitorError.notImplemented
    }

    /// 清理资源
    public func cleanup() {
        Logger.shared.info("[TransactionMonitor] 清理资源...")

        stopMonitoring()
        pendingTxs.removeAll()
        pendingTransactionCount = 0
        initialized = false
    }

    // MARK: - Private Methods

    /// 初始化数据库表
    private func initializeTables() async throws {
        try database.execute("""
            CREATE TABLE IF NOT EXISTS blockchain_transactions (
                id TEXT PRIMARY KEY,
                tx_hash TEXT UNIQUE NOT NULL,
                chain_id INTEGER NOT NULL,
                from_address TEXT NOT NULL,
                to_address TEXT,
                value TEXT,
                gas_used TEXT,
                gas_price TEXT,
                status TEXT,
                block_number INTEGER,
                tx_type TEXT,
                local_ref_id TEXT,
                created_at INTEGER NOT NULL,
                confirmed_at INTEGER
            )
        """)

        // 创建索引
        try database.execute("""
            CREATE INDEX IF NOT EXISTS idx_tx_hash ON blockchain_transactions(tx_hash)
        """)
        try database.execute("""
            CREATE INDEX IF NOT EXISTS idx_tx_from ON blockchain_transactions(from_address)
        """)
        try database.execute("""
            CREATE INDEX IF NOT EXISTS idx_tx_to ON blockchain_transactions(to_address)
        """)
        try database.execute("""
            CREATE INDEX IF NOT EXISTS idx_tx_status ON blockchain_transactions(status)
        """)
    }

    /// 保存交易到数据库
    private func saveTx(
        txHash: String,
        fromAddress: String,
        toAddress: String?,
        value: String?,
        status: TransactionMonitorStatus,
        txType: String?,
        localRefId: String?
    ) async throws {
        let id = UUID().uuidString
        let chainId = ChainManager.shared.currentChain?.chainId ?? 1
        let createdAt = Int(Date().timeIntervalSince1970)

        try database.execute("""
            INSERT INTO blockchain_transactions (
                id, tx_hash, chain_id, from_address, to_address, value,
                status, tx_type, local_ref_id, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            id,
            txHash,
            chainId,
            fromAddress,
            toAddress,
            value,
            status.rawValue,
            txType,
            localRefId,
            createdAt
        )
    }

    /// 更新交易状态
    private func updateTxStatus(
        txHash: String,
        status: TransactionMonitorStatus,
        receipt: TransactionReceipt? = nil
    ) async throws {
        let confirmedAt = status == .confirmed ? Int(Date().timeIntervalSince1970) : nil
        let gasUsed = receipt?.gasUsed
        let gasPrice = receipt?.gasPrice
        let blockNumber = receipt?.blockNumber

        try database.execute("""
            UPDATE blockchain_transactions
            SET status = ?, confirmed_at = ?, gas_used = ?, gas_price = ?, block_number = ?
            WHERE tx_hash = ?
        """,
            status.rawValue,
            confirmedAt,
            gasUsed,
            gasPrice,
            blockNumber,
            txHash
        )
    }

    /// 启动监控定时器
    private func startMonitoring() {
        guard monitorTimer == nil else { return }

        isMonitoring = true

        monitorTimer = Timer.scheduledTimer(withTimeInterval: monitorInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.checkPendingTransactions()
            }
        }

        Logger.shared.info("[TransactionMonitor] 启动交易监控定时器")
    }

    /// 停止监控定时器
    private func stopMonitoring() {
        monitorTimer?.invalidate()
        monitorTimer = nil
        isMonitoring = false
        Logger.shared.info("[TransactionMonitor] 停止交易监控定时器")
    }

    /// 检查待处理交易
    private func checkPendingTransactions() async {
        for (txHash, info) in pendingTxs {
            // 检查重试次数
            if info.retries >= maxRetries {
                Logger.shared.warn("[TransactionMonitor] 交易 \(txHash) 超过最大重试次数")
                try? await updateTxStatus(txHash: txHash, status: .failed)
                info.onFailed?(TransactionMonitorError.maxRetriesExceeded)
                transactionFailed.send((txHash: txHash, error: TransactionMonitorError.maxRetriesExceeded))
                pendingTxs.removeValue(forKey: txHash)
                continue
            }

            // 增加重试计数
            var updatedInfo = info
            updatedInfo.retries += 1
            pendingTxs[txHash] = updatedInfo

            // 检查交易状态
            await monitorTx(
                txHash: txHash,
                onConfirmed: info.onConfirmed,
                onFailed: info.onFailed
            )
        }

        pendingTransactionCount = pendingTxs.count
    }

    /// 恢复未完成的交易监控
    private func recoverPendingTransactions() async {
        do {
            let rows = try database.prepare(
                "SELECT * FROM blockchain_transactions WHERE status = ?",
                [TransactionMonitorStatus.pending.rawValue]
            )

            for row in rows {
                if let txHash = row["tx_hash"] as? String,
                   let createdAt = row["created_at"] as? Int {
                    let info = PendingTransactionInfo(
                        txHash: txHash,
                        retries: 0,
                        addedAt: Date(timeIntervalSince1970: TimeInterval(createdAt))
                    )
                    pendingTxs[txHash] = info
                }
            }

            pendingTransactionCount = pendingTxs.count
            Logger.shared.info("[TransactionMonitor] 恢复 \(pendingTxs.count) 个待处理交易")
        } catch {
            Logger.shared.error("[TransactionMonitor] 恢复待处理交易失败: \(error)")
        }
    }

    /// 解析交易行
    private func parseTransactionRow(_ row: [String: Any]) -> TransactionRecord? {
        guard
            let id = row["id"] as? String,
            let txHash = row["tx_hash"] as? String,
            let chainId = row["chain_id"] as? Int,
            let fromAddress = row["from_address"] as? String,
            let statusRaw = row["status"] as? String,
            let createdAt = row["created_at"] as? Int
        else {
            return nil
        }

        let status: TransactionStatus
        switch statusRaw {
        case "pending": status = .pending
        case "confirmed": status = .confirmed
        case "failed": status = .failed
        default: status = .pending
        }

        return TransactionRecord(
            id: id,
            hash: txHash,
            chainId: chainId,
            fromAddress: fromAddress,
            toAddress: row["to_address"] as? String,
            value: row["value"] as? String,
            gasUsed: row["gas_used"] as? String,
            gasPrice: row["gas_price"] as? String,
            status: status,
            blockNumber: row["block_number"] as? Int,
            txType: row["tx_type"] as? String,
            localRefId: row["local_ref_id"] as? String,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAt)),
            confirmedAt: (row["confirmed_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }
        )
    }
}

// MARK: - Errors

public enum TransactionMonitorError: Error, LocalizedError {
    case transactionNotFound
    case transactionFailed
    case maxRetriesExceeded
    case notImplemented
    case networkError(String)

    public var errorDescription: String? {
        switch self {
        case .transactionNotFound:
            return "交易未找到"
        case .transactionFailed:
            return "交易失败"
        case .maxRetriesExceeded:
            return "超过最大重试次数"
        case .notImplemented:
            return "功能暂未实现"
        case .networkError(let message):
            return "网络错误: \(message)"
        }
    }
}
