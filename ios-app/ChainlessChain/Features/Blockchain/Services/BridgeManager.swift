import Foundation
import CoreCommon
import Combine

/// 跨链桥管理器
/// 负责资产跨链转移、桥接监控、状态同步
@MainActor
public class BridgeManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = BridgeManager()

    // MARK: - Properties

    private let contractManager: ContractManager
    private let transactionManager: TransactionManager
    private let chainManager: ChainManager
    private let walletManager: WalletManager
    private let database: Database

    @Published public var bridgeContracts: [Int: String] = [:]  // chainId -> contractAddress
    @Published public var pendingBridges: [String: BridgeRecord] = [:]
    @Published public var isMonitoring = false

    /// 监控间隔（秒）
    private let monitorInterval: TimeInterval = 10.0

    /// 监控任务
    private var monitorTask: Task<Void, Never>?

    /// 支持的桥接路线
    private var supportedRoutes: Set<BridgeRoute> = []

    /// 事件发布器
    public let bridgeCompleted = PassthroughSubject<BridgeRecord, Never>()
    public let bridgeFailed = PassthroughSubject<BridgeRecord, Never>()
    public let bridgeUpdated = PassthroughSubject<BridgeRecord, Never>()
    public let assetLocked = PassthroughSubject<BridgeEvent, Never>()
    public let assetMinted = PassthroughSubject<BridgeEvent, Never>()

    // MARK: - Initialization

    private init() {
        self.contractManager = ContractManager.shared
        self.transactionManager = TransactionManager.shared
        self.chainManager = ChainManager.shared
        self.walletManager = WalletManager.shared
        self.database = Database.shared

        Logger.shared.info("[BridgeManager] 桥接管理器已初始化")
    }

    // MARK: - Initialization

    /// 初始化桥接管理器
    public func initialize() async throws {
        Logger.shared.info("[BridgeManager] 初始化桥接管理器...")

        // 初始化数据库表
        try await initializeTables()

        // 加载已部署的桥接合约
        try await loadBridgeContracts()

        // 恢复待处理桥接
        try await recoverPendingBridges()

        // 初始化支持的路线
        initializeSupportedRoutes()

        // 启动监控
        startMonitoring()

        Logger.shared.info("[BridgeManager] 桥接管理器初始化成功")
    }

    /// 初始化数据库表
    private func initializeTables() async throws {
        let createTableSQL = """
        CREATE TABLE IF NOT EXISTS bridge_transfers (
            id TEXT PRIMARY KEY,
            from_chain_id INTEGER NOT NULL,
            to_chain_id INTEGER NOT NULL,
            from_tx_hash TEXT,
            to_tx_hash TEXT,
            asset_id TEXT,
            asset_address TEXT NOT NULL,
            amount TEXT NOT NULL,
            sender_address TEXT NOT NULL,
            recipient_address TEXT NOT NULL,
            status TEXT NOT NULL,
            bridge_type TEXT NOT NULL,
            protocol TEXT NOT NULL,
            lock_timestamp INTEGER,
            mint_timestamp INTEGER,
            created_at INTEGER NOT NULL,
            completed_at INTEGER,
            error_message TEXT,
            request_id TEXT,
            estimated_fee TEXT,
            actual_fee TEXT
        )
        """

        try await database.execute(createTableSQL)

        // 创建索引
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_bridge_tx_hash ON bridge_transfers(from_tx_hash)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_bridge_status ON bridge_transfers(status)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_bridge_sender ON bridge_transfers(sender_address)")

        Logger.shared.info("[BridgeManager] 数据库表初始化成功")
    }

    /// 加载桥接合约地址
    private func loadBridgeContracts() async throws {
        // TODO: 从数据库或配置加载已部署的桥接合约地址
        // 这里使用硬编码的测试地址作为示例

        // 示例：在测试网络上注册桥接合约
        // registerBridgeContract(chainId: 11155111, address: "0x...")  // Sepolia
        // registerBridgeContract(chainId: 80001, address: "0x...")     // Mumbai

        Logger.shared.info("[BridgeManager] 已加载 \(bridgeContracts.count) 个桥接合约")
    }

    /// 注册桥接合约
    public func registerBridgeContract(chainId: Int, address: String) {
        bridgeContracts[chainId] = address
        contractManager.registerContract(
            name: "AssetBridge_\(chainId)",
            address: address,
            abi: ContractABI.assetBridgeABI,
            chain: SupportedChain.allCases.first { $0.chainId == chainId }
        )
        Logger.shared.info("[BridgeManager] 注册桥接合约: Chain \(chainId) -> \(address)")
    }

    /// 初始化支持的路线
    private func initializeSupportedRoutes() {
        // 主网路线（当合约部署后启用）
        supportedRoutes = Set([
            // Ethereum <-> Polygon
            BridgeRoute(fromChainId: 1, toChainId: 137),
            BridgeRoute(fromChainId: 137, toChainId: 1),

            // Ethereum <-> BSC
            BridgeRoute(fromChainId: 1, toChainId: 56),
            BridgeRoute(fromChainId: 56, toChainId: 1),

            // Ethereum <-> Arbitrum
            BridgeRoute(fromChainId: 1, toChainId: 42161),
            BridgeRoute(fromChainId: 42161, toChainId: 1),

            // Ethereum <-> Optimism
            BridgeRoute(fromChainId: 1, toChainId: 10),
            BridgeRoute(fromChainId: 10, toChainId: 1),
        ])

        Logger.shared.info("[BridgeManager] 初始化 \(supportedRoutes.count) 条桥接路线")
    }

    /// 恢复待处理桥接
    private func recoverPendingBridges() async throws {
        let query = """
        SELECT * FROM bridge_transfers
        WHERE status IN ('pending', 'locking', 'locked', 'minting')
        ORDER BY created_at DESC
        """

        let rows = try await database.query(query)

        for row in rows {
            if let record = parseBridgeRecord(from: row) {
                pendingBridges[record.id] = record
            }
        }

        Logger.shared.info("[BridgeManager] 恢复 \(pendingBridges.count) 个待处理桥接")
    }

    // MARK: - Bridge Operations

    /// 桥接资产（跨链转移）
    public func bridgeAsset(
        wallet: Wallet,
        tokenAddress: String,
        amount: String,
        fromChain: SupportedChain,
        toChain: SupportedChain,
        recipientAddress: String? = nil,
        protocol: BridgeProtocol = .native
    ) async throws -> BridgeRecord {
        Logger.shared.info("[BridgeManager] 开始桥接资产: \(fromChain.name) -> \(toChain.name)")

        // 验证参数
        try validateBridgeParams(
            fromChain: fromChain,
            toChain: toChain,
            amount: amount,
            tokenAddress: tokenAddress
        )

        // 检查是否支持该路线
        let route = BridgeRoute(
            fromChainId: fromChain.chainId,
            toChainId: toChain.chainId,
            protocol: protocol
        )

        guard supportedRoutes.contains(route) else {
            throw BridgeError.unsupportedRoute
        }

        // 获取桥接合约地址
        guard let bridgeAddress = bridgeContracts[fromChain.chainId] else {
            throw BridgeError.bridgeNotDeployed
        }

        let receiver = recipientAddress ?? wallet.address

        // 创建桥接记录
        var record = BridgeRecord(
            fromChainId: fromChain.chainId,
            toChainId: toChain.chainId,
            assetAddress: tokenAddress,
            amount: amount,
            senderAddress: wallet.address,
            recipientAddress: receiver,
            status: .pending,
            bridgeType: .lockMint,
            protocol: protocol
        )

        // 保存到数据库
        try await saveBridgeRecord(record)

        // 添加到监控列表
        pendingBridges[record.id] = record

        // 步骤1: 授权代币给桥接合约
        Logger.shared.info("[BridgeManager] 步骤1: 授权代币...")
        try await approveToken(
            wallet: wallet,
            tokenAddress: tokenAddress,
            spender: bridgeAddress,
            amount: amount,
            chain: fromChain
        )

        // 步骤2: 在源链锁定资产
        Logger.shared.info("[BridgeManager] 步骤2: 锁定资产...")
        record.status = .locking
        try await updateBridgeRecord(record)

        let lockTxHash = try await lockAsset(
            wallet: wallet,
            bridgeAddress: bridgeAddress,
            tokenAddress: tokenAddress,
            amount: amount,
            targetChainId: toChain.chainId,
            chain: fromChain
        )

        record.fromTxHash = lockTxHash
        record.status = .locked
        record.lockTimestamp = Date()
        try await updateBridgeRecord(record)

        // 更新内存中的记录
        pendingBridges[record.id] = record

        // 发布更新事件
        bridgeUpdated.send(record)

        Logger.shared.info("[BridgeManager] 桥接请求已创建: \(record.id)")

        // 步骤3: 监控器会自动检测锁定事件并执行铸造（中继功能）

        return record
    }

    /// 锁定资产（源链操作）
    private func lockAsset(
        wallet: Wallet,
        bridgeAddress: String,
        tokenAddress: String,
        amount: String,
        targetChainId: Int,
        chain: SupportedChain
    ) async throws -> String {
        // 调用桥接合约的lockAsset函数
        let txRecord = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: bridgeAddress,
            abi: ContractABI.assetBridgeABI,
            functionName: "lockAsset",
            parameters: [tokenAddress, amount, String(targetChainId)],
            txType: .contract,
            chain: chain
        )

        guard let txHash = txRecord.hash else {
            throw BridgeError.lockFailed
        }

        return txHash
    }

    /// 授权代币
    private func approveToken(
        wallet: Wallet,
        tokenAddress: String,
        spender: String,
        amount: String,
        chain: SupportedChain
    ) async throws {
        _ = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: tokenAddress,
            abi: ContractABI.erc20ABI,
            functionName: "approve",
            parameters: [spender, amount],
            txType: .approve,
            chain: chain
        )

        Logger.shared.info("[BridgeManager] 代币授权成功")
    }

    // MARK: - Monitoring

    /// 启动桥接监控
    public func startMonitoring() {
        guard monitorTask == nil else { return }

        isMonitoring = true

        monitorTask = Task {
            while !Task.isCancelled {
                await checkPendingBridges()
                try? await Task.sleep(nanoseconds: UInt64(monitorInterval * 1_000_000_000))
            }
        }

        Logger.shared.info("[BridgeManager] 桥接监控已启动")
    }

    /// 停止桥接监控
    public func stopMonitoring() {
        monitorTask?.cancel()
        monitorTask = nil
        isMonitoring = false

        Logger.shared.info("[BridgeManager] 桥接监控已停止")
    }

    /// 检查待处理桥接
    private func checkPendingBridges() async {
        for (bridgeId, record) in pendingBridges {
            do {
                try await updateBridgeStatus(bridgeId: bridgeId, record: record)
            } catch {
                Logger.shared.error("[BridgeManager] 更新桥接状态失败 \(bridgeId): \(error)")
            }
        }
    }

    /// 更新桥接状态
    private func updateBridgeStatus(bridgeId: String, record: BridgeRecord) async throws {
        // 检查源链交易是否已确认
        if record.status == .locked, let txHash = record.fromTxHash {
            let txRecord = try await transactionManager.getTransaction(txHash: txHash)

            if txRecord?.status == .confirmed {
                // 源链交易已确认，可以在目标链铸造
                // 注意：实际的铸造操作需要中继器执行
                // 这里只是示例，实际生产环境需要后端中继服务

                var updatedRecord = record
                updatedRecord.status = .minting
                try await updateBridgeRecord(updatedRecord)
                pendingBridges[bridgeId] = updatedRecord

                Logger.shared.info("[BridgeManager] 桥接进入铸造阶段: \(bridgeId)")
            } else if txRecord?.status == .failed {
                // 源链交易失败
                var updatedRecord = record
                updatedRecord.status = .failed
                updatedRecord.errorMessage = "Source chain transaction failed"
                updatedRecord.completedAt = Date()
                try await updateBridgeRecord(updatedRecord)

                pendingBridges.removeValue(forKey: bridgeId)
                bridgeFailed.send(updatedRecord)

                Logger.shared.error("[BridgeManager] 桥接失败: \(bridgeId)")
            }
        }

        // TODO: 实现完整的中继逻辑
        // 1. 监听源链的AssetLocked事件
        // 2. 验证事件有效性
        // 3. 在目标链调用mintAsset
        // 4. 更新桥接状态为completed
    }

    // MARK: - Query Methods

    /// 获取桥接历史
    public func getBridgeHistory(
        senderAddress: String? = nil,
        limit: Int = 100,
        offset: Int = 0
    ) async throws -> [BridgeRecord] {
        var query = "SELECT * FROM bridge_transfers WHERE 1=1"
        var params: [Any] = []

        if let sender = senderAddress {
            query += " AND sender_address = ?"
            params.append(sender)
        }

        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.append(limit)
        params.append(offset)

        let rows = try await database.query(query, params)
        return rows.compactMap { parseBridgeRecord(from: $0) }
    }

    /// 获取桥接详情
    public func getBridge(bridgeId: String) async throws -> BridgeRecord? {
        let query = "SELECT * FROM bridge_transfers WHERE id = ?"
        let rows = try await database.query(query, [bridgeId])
        return rows.first.flatMap { parseBridgeRecord(from: $0) }
    }

    /// 获取桥接数量
    public func getBridgeCount(
        status: BridgeStatus? = nil
    ) async throws -> Int {
        var query = "SELECT COUNT(*) as count FROM bridge_transfers WHERE 1=1"
        var params: [Any] = []

        if let status = status {
            query += " AND status = ?"
            params.append(status.rawValue)
        }

        let rows = try await database.query(query, params)
        return rows.first?["count"] as? Int ?? 0
    }

    /// 估算桥接费用
    public func estimateBridgeFee(
        tokenAddress: String,
        amount: String,
        fromChain: SupportedChain,
        toChain: SupportedChain
    ) async throws -> BridgeFeeEstimate {
        let gasManager = GasManager.shared

        // 估算源链交易费用（approve + lock）
        let approveGas = try await gasManager.estimateGasLimit(
            from: "0x0000000000000000000000000000000000000000",  // 占位地址
            to: tokenAddress,
            value: "0",
            chain: fromChain
        )

        let sourceGasPrice = try await gasManager.getGasPrice(chain: fromChain)
        let sourceTxFee = calculateFee(gasLimit: approveGas, gasPrice: sourceGasPrice)

        // 估算目标链交易费用（mint）
        let targetGasPrice = try await gasManager.getGasPrice(chain: toChain)
        let targetTxFee = "0"  // 铸造由中继器支付

        // 桥接费用（假设为0.1%）
        let bridgeFee = calculateBridgeFee(amount: amount, feePercent: 0.001)

        // 总费用
        guard let sourceDecimal = Decimal(string: sourceTxFee),
              let bridgeDecimal = Decimal(string: bridgeFee) else {
            throw BridgeError.invalidAmount
        }

        let totalFee = String(describing: sourceDecimal + bridgeDecimal)

        return BridgeFeeEstimate(
            sourceTxFee: sourceTxFee,
            targetTxFee: targetTxFee,
            bridgeFee: bridgeFee,
            totalFee: totalFee,
            estimatedTime: 300  // 5分钟
        )
    }

    /// 计算手续费
    private func calculateFee(gasLimit: String, gasPrice: String) -> String {
        guard let gasLimitDecimal = Decimal(string: gasLimit),
              let gasPriceDecimal = Decimal(string: gasPrice) else {
            return "0"
        }

        return String(describing: gasLimitDecimal * gasPriceDecimal)
    }

    /// 计算桥接费用
    private func calculateBridgeFee(amount: String, feePercent: Decimal) -> String {
        guard let amountDecimal = Decimal(string: amount) else {
            return "0"
        }

        return String(describing: amountDecimal * feePercent)
    }

    // MARK: - Validation

    /// 验证桥接参数
    private func validateBridgeParams(
        fromChain: SupportedChain,
        toChain: SupportedChain,
        amount: String,
        tokenAddress: String
    ) throws {
        // 验证源链和目标链不同
        guard fromChain.chainId != toChain.chainId else {
            throw BridgeError.sameChain
        }

        // 验证金额有效
        guard let amountDecimal = Decimal(string: amount), amountDecimal > 0 else {
            throw BridgeError.invalidAmount
        }

        // 验证代币地址
        guard tokenAddress.hasPrefix("0x") && tokenAddress.count == 42 else {
            throw BridgeError.invalidAmount
        }
    }

    // MARK: - Database Operations

    /// 保存桥接记录
    private func saveBridgeRecord(_ record: BridgeRecord) async throws {
        let sql = """
        INSERT INTO bridge_transfers (
            id, from_chain_id, to_chain_id, from_tx_hash, to_tx_hash,
            asset_id, asset_address, amount, sender_address, recipient_address,
            status, bridge_type, protocol, lock_timestamp, mint_timestamp,
            created_at, completed_at, error_message, request_id,
            estimated_fee, actual_fee
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        let params: [Any?] = [
            record.id,
            record.fromChainId,
            record.toChainId,
            record.fromTxHash,
            record.toTxHash,
            record.assetId,
            record.assetAddress,
            record.amount,
            record.senderAddress,
            record.recipientAddress,
            record.status.rawValue,
            record.bridgeType.rawValue,
            record.protocol.rawValue,
            record.lockTimestamp.map { Int($0.timeIntervalSince1970) },
            record.mintTimestamp.map { Int($0.timeIntervalSince1970) },
            Int(record.createdAt.timeIntervalSince1970),
            record.completedAt.map { Int($0.timeIntervalSince1970) },
            record.errorMessage,
            record.requestId,
            record.estimatedFee,
            record.actualFee
        ]

        try await database.execute(sql, params)
    }

    /// 更新桥接记录
    private func updateBridgeRecord(_ record: BridgeRecord) async throws {
        let sql = """
        UPDATE bridge_transfers SET
            from_tx_hash = ?, to_tx_hash = ?, status = ?,
            lock_timestamp = ?, mint_timestamp = ?, completed_at = ?,
            error_message = ?, request_id = ?, actual_fee = ?
        WHERE id = ?
        """

        let params: [Any?] = [
            record.fromTxHash,
            record.toTxHash,
            record.status.rawValue,
            record.lockTimestamp.map { Int($0.timeIntervalSince1970) },
            record.mintTimestamp.map { Int($0.timeIntervalSince1970) },
            record.completedAt.map { Int($0.timeIntervalSince1970) },
            record.errorMessage,
            record.requestId,
            record.actualFee,
            record.id
        ]

        try await database.execute(sql, params)
    }

    /// 解析桥接记录
    private func parseBridgeRecord(from row: [String: Any]) -> BridgeRecord? {
        guard
            let id = row["id"] as? String,
            let fromChainId = row["from_chain_id"] as? Int,
            let toChainId = row["to_chain_id"] as? Int,
            let assetAddress = row["asset_address"] as? String,
            let amount = row["amount"] as? String,
            let senderAddress = row["sender_address"] as? String,
            let recipientAddress = row["recipient_address"] as? String,
            let statusRaw = row["status"] as? String,
            let status = BridgeStatus(rawValue: statusRaw),
            let bridgeTypeRaw = row["bridge_type"] as? String,
            let bridgeType = BridgeType(rawValue: bridgeTypeRaw),
            let protocolRaw = row["protocol"] as? String,
            let protocol = BridgeProtocol(rawValue: protocolRaw),
            let createdAtTimestamp = row["created_at"] as? Int
        else {
            return nil
        }

        let createdAt = Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp))
        let lockTimestamp = (row["lock_timestamp"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }
        let mintTimestamp = (row["mint_timestamp"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }
        let completedAt = (row["completed_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }

        return BridgeRecord(
            id: id,
            fromChainId: fromChainId,
            toChainId: toChainId,
            fromTxHash: row["from_tx_hash"] as? String,
            toTxHash: row["to_tx_hash"] as? String,
            assetId: row["asset_id"] as? String,
            assetAddress: assetAddress,
            amount: amount,
            senderAddress: senderAddress,
            recipientAddress: recipientAddress,
            status: status,
            bridgeType: bridgeType,
            protocol: protocol,
            lockTimestamp: lockTimestamp,
            mintTimestamp: mintTimestamp,
            createdAt: createdAt,
            completedAt: completedAt,
            errorMessage: row["error_message"] as? String,
            requestId: row["request_id"] as? String,
            estimatedFee: row["estimated_fee"] as? String,
            actualFee: row["actual_fee"] as? String
        )
    }

    // MARK: - Cleanup

    /// 清理资源
    public func cleanup() {
        stopMonitoring()
        pendingBridges.removeAll()

        Logger.shared.info("[BridgeManager] 资源已清理")
    }
}
