//
//  EscrowManager.swift
//  ChainlessChain
//
//  托管合约管理器
//  负责托管交易的创建、管理和状态更新
//
//  Created by ChainlessChain on 2026-01-26.
//

import Foundation
import Combine
import CryptoKit

/// 托管合约管理器
@MainActor
public class EscrowManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = EscrowManager()

    // MARK: - Published Properties

    @Published public var escrows: [Escrow] = []
    @Published public var escrowEvents: [String: [EscrowEvent]] = [:]  // escrowId -> events
    @Published public var isLoading = false

    // MARK: - Events

    public let escrowCreated = PassthroughSubject<Escrow, Never>()
    public let escrowUpdated = PassthroughSubject<Escrow, Never>()
    public let escrowCompleted = PassthroughSubject<Escrow, Never>()

    // MARK: - Private Properties

    private let contractManager: ContractManager
    private let transactionManager: TransactionManager
    private let tokenManager: TokenManager
    private let chainManager: ChainManager
    private let database: DatabaseManager

    private var cancellables = Set<AnyCancellable>()

    // Default escrow contract addresses (per chain)
    private var escrowContracts: [Int: String] = [:]

    // MARK: - Initialization

    private init() {
        self.contractManager = ContractManager.shared
        self.transactionManager = TransactionManager.shared
        self.tokenManager = TokenManager.shared
        self.chainManager = ChainManager.shared
        self.database = DatabaseManager.shared

        Logger.shared.info("[EscrowManager] 托管管理器已初始化")
    }

    // MARK: - Initialization

    /// 初始化托管管理器
    public func initialize() async throws {
        Logger.shared.info("[EscrowManager] 初始化托管管理器...")

        // 初始化数据库表
        try await initializeTables()

        // 加载已保存的托管
        try await loadEscrows()

        Logger.shared.info("[EscrowManager] 托管管理器初始化成功，已加载 \(escrows.count) 个托管")
    }

    // MARK: - Database

    /// 初始化数据库表
    private func initializeTables() async throws {
        // 托管表
        let createEscrowTable = """
        CREATE TABLE IF NOT EXISTS escrows (
            id TEXT PRIMARY KEY,
            escrow_id TEXT NOT NULL,
            contract_address TEXT NOT NULL,
            chain_id INTEGER NOT NULL,
            buyer TEXT NOT NULL,
            seller TEXT NOT NULL,
            arbitrator TEXT NOT NULL,
            amount TEXT NOT NULL,
            payment_type INTEGER NOT NULL,
            token_address TEXT,
            state INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            delivered_at INTEGER,
            completed_at INTEGER,
            transaction_hash TEXT,
            block_number TEXT,
            title TEXT,
            description TEXT,
            item_images TEXT,
            updated_at INTEGER NOT NULL,
            UNIQUE(escrow_id, contract_address)
        )
        """

        try database.execute(createEscrowTable)

        // 托管事件表
        let createEventTable = """
        CREATE TABLE IF NOT EXISTS escrow_events (
            id TEXT PRIMARY KEY,
            escrow_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            actor TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            transaction_hash TEXT,
            block_number TEXT,
            FOREIGN KEY (escrow_id) REFERENCES escrows(escrow_id) ON DELETE CASCADE
        )
        """

        try database.execute(createEventTable)

        // 创建索引
        try database.execute("CREATE INDEX IF NOT EXISTS idx_escrow_buyer ON escrows(buyer)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_escrow_seller ON escrows(seller)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_escrow_arbitrator ON escrows(arbitrator)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_escrow_state ON escrows(state)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_event_escrow ON escrow_events(escrow_id)")

        Logger.shared.info("[EscrowManager] 数据库表初始化成功")
    }

    // MARK: - Escrow Contract Management

    /// 设置托管合约地址
    public func setEscrowContract(address: String, for chain: SupportedChain) {
        escrowContracts[chain.chainId] = address
        Logger.shared.info("[EscrowManager] 设置托管合约地址: \(address) for \(chain.name)")
    }

    /// 获取托管合约地址
    public func getEscrowContract(for chain: SupportedChain) -> String? {
        return escrowContracts[chain.chainId]
    }

    // MARK: - Create Escrow

    /// 创建原生代币托管
    public func createNativeEscrow(
        wallet: Wallet,
        seller: String,
        arbitrator: String,
        amount: String,  // Wei format
        title: String? = nil,
        description: String? = nil,
        itemImages: [String]? = nil,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> Escrow {
        guard let chain = wallet.chain else {
            throw EscrowError.chainNotSupported
        }

        guard let contractAddress = getEscrowContract(for: chain) else {
            throw EscrowError.contractNotDeployed
        }

        // 生成唯一的escrow ID
        let escrowId = generateEscrowId(buyer: wallet.address, seller: seller, timestamp: Date())

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.escrowContractABI,
            functionName: "createNativeEscrow",
            parameters: [escrowId, seller, arbitrator],
            chain: chain
        )

        // 发送交易（带value）
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            data: data,
            value: amount,
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: chain
        )

        // 创建托管对象
        let escrow = Escrow(
            escrowId: escrowId,
            contractAddress: contractAddress,
            chainId: chain.chainId,
            buyer: wallet.address,
            seller: seller,
            arbitrator: arbitrator,
            amount: amount,
            paymentType: .native,
            state: .created,
            transactionHash: record.hash,
            title: title,
            description: description,
            itemImages: itemImages
        )

        // 保存到数据库
        try await saveEscrow(escrow)

        // 添加到列表
        escrows.append(escrow)

        // 发送事件
        escrowCreated.send(escrow)

        Logger.shared.info("[EscrowManager] 原生代币托管已创建: \(escrowId)")

        return escrow
    }

    /// 创建ERC-20代币托管
    public func createERC20Escrow(
        wallet: Wallet,
        seller: String,
        arbitrator: String,
        tokenAddress: String,
        amount: String,  // Token's smallest unit
        title: String? = nil,
        description: String? = nil,
        itemImages: [String]? = nil,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> Escrow {
        guard let chain = wallet.chain else {
            throw EscrowError.chainNotSupported
        }

        guard let contractAddress = getEscrowContract(for: chain) else {
            throw EscrowError.contractNotDeployed
        }

        // 先授权代币给托管合约
        _ = try await tokenManager.approveToken(
            wallet: wallet,
            token: Token(
                address: tokenAddress,
                chainId: chain.chainId,
                type: .erc20,
                name: "",
                symbol: "",
                decimals: 18
            ),
            spender: contractAddress,
            amount: amount,
            gasLimit: gasLimit,
            gasPrice: gasPrice
        )

        // 生成escrow ID
        let escrowId = generateEscrowId(buyer: wallet.address, seller: seller, timestamp: Date())

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.escrowContractABI,
            functionName: "createERC20Escrow",
            parameters: [escrowId, seller, arbitrator, tokenAddress, amount],
            chain: chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: chain
        )

        // 创建托管对象
        let escrow = Escrow(
            escrowId: escrowId,
            contractAddress: contractAddress,
            chainId: chain.chainId,
            buyer: wallet.address,
            seller: seller,
            arbitrator: arbitrator,
            amount: amount,
            paymentType: .erc20,
            tokenAddress: tokenAddress,
            state: .created,
            transactionHash: record.hash,
            title: title,
            description: description,
            itemImages: itemImages
        )

        // 保存到数据库
        try await saveEscrow(escrow)

        // 添加到列表
        escrows.append(escrow)

        // 发送事件
        escrowCreated.send(escrow)

        Logger.shared.info("[EscrowManager] ERC-20代币托管已创建: \(escrowId)")

        return escrow
    }

    // MARK: - Escrow Operations

    /// 标记为已交付（卖家操作）
    public func markAsDelivered(
        escrow: Escrow,
        wallet: Wallet,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard escrow.canMarkDelivered(walletAddress: wallet.address) else {
            throw EscrowError.invalidOperation
        }

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.escrowContractABI,
            functionName: "markAsDelivered",
            parameters: [escrow.escrowId],
            chain: escrow.chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: escrow.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: escrow.chain
        )

        // 更新状态
        var updatedEscrow = escrow
        updatedEscrow.state = .delivered
        updatedEscrow.deliveredAt = Date()
        try await updateEscrow(updatedEscrow)

        // 添加事件
        try await addEvent(
            escrowId: escrow.escrowId,
            eventType: .delivered,
            actor: wallet.address,
            transactionHash: record.hash
        )

        Logger.shared.info("[EscrowManager] 托管已标记为已交付: \(escrow.escrowId)")

        return record
    }

    /// 释放资金给卖家（买家确认收货）
    public func release(
        escrow: Escrow,
        wallet: Wallet,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard escrow.canRelease(walletAddress: wallet.address) else {
            throw EscrowError.invalidOperation
        }

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.escrowContractABI,
            functionName: "release",
            parameters: [escrow.escrowId],
            chain: escrow.chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: escrow.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: escrow.chain
        )

        // 更新状态
        var updatedEscrow = escrow
        updatedEscrow.state = .completed
        updatedEscrow.completedAt = Date()
        try await updateEscrow(updatedEscrow)

        // 添加事件
        try await addEvent(
            escrowId: escrow.escrowId,
            eventType: .released,
            actor: wallet.address,
            transactionHash: record.hash
        )

        // 发送完成事件
        escrowCompleted.send(updatedEscrow)

        Logger.shared.info("[EscrowManager] 托管资金已释放: \(escrow.escrowId)")

        return record
    }

    /// 退款给买家
    public func refund(
        escrow: Escrow,
        wallet: Wallet,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard escrow.canRefund(walletAddress: wallet.address) else {
            throw EscrowError.invalidOperation
        }

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.escrowContractABI,
            functionName: "refund",
            parameters: [escrow.escrowId],
            chain: escrow.chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: escrow.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: escrow.chain
        )

        // 更新状态
        var updatedEscrow = escrow
        updatedEscrow.state = .refunded
        updatedEscrow.completedAt = Date()
        try await updateEscrow(updatedEscrow)

        // 添加事件
        try await addEvent(
            escrowId: escrow.escrowId,
            eventType: .refunded,
            actor: wallet.address,
            transactionHash: record.hash
        )

        Logger.shared.info("[EscrowManager] 托管已退款: \(escrow.escrowId)")

        return record
    }

    /// 发起争议
    public func dispute(
        escrow: Escrow,
        wallet: Wallet,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard escrow.canDispute(walletAddress: wallet.address) else {
            throw EscrowError.invalidOperation
        }

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.escrowContractABI,
            functionName: "dispute",
            parameters: [escrow.escrowId],
            chain: escrow.chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: escrow.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: escrow.chain
        )

        // 更新状态
        var updatedEscrow = escrow
        updatedEscrow.state = .disputed
        try await updateEscrow(updatedEscrow)

        // 添加事件
        try await addEvent(
            escrowId: escrow.escrowId,
            eventType: .disputed,
            actor: wallet.address,
            transactionHash: record.hash
        )

        Logger.shared.info("[EscrowManager] 托管争议已发起: \(escrow.escrowId)")

        return record
    }

    /// 解决争议：资金给卖家（仲裁者操作）
    public func resolveDisputeToSeller(
        escrow: Escrow,
        wallet: Wallet,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard escrow.canResolveDispute(walletAddress: wallet.address) else {
            throw EscrowError.invalidOperation
        }

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.escrowContractABI,
            functionName: "resolveDisputeToSeller",
            parameters: [escrow.escrowId],
            chain: escrow.chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: escrow.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: escrow.chain
        )

        // 更新状态
        var updatedEscrow = escrow
        updatedEscrow.state = .completed
        updatedEscrow.completedAt = Date()
        try await updateEscrow(updatedEscrow)

        // 添加事件
        try await addEvent(
            escrowId: escrow.escrowId,
            eventType: .resolvedToSeller,
            actor: wallet.address,
            transactionHash: record.hash
        )

        // 发送完成事件
        escrowCompleted.send(updatedEscrow)

        Logger.shared.info("[EscrowManager] 争议已解决，资金给卖家: \(escrow.escrowId)")

        return record
    }

    /// 解决争议：资金退还买家（仲裁者操作）
    public func resolveDisputeToBuyer(
        escrow: Escrow,
        wallet: Wallet,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard escrow.canResolveDispute(walletAddress: wallet.address) else {
            throw EscrowError.invalidOperation
        }

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.escrowContractABI,
            functionName: "resolveDisputeToBuyer",
            parameters: [escrow.escrowId],
            chain: escrow.chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: escrow.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: escrow.chain
        )

        // 更新状态
        var updatedEscrow = escrow
        updatedEscrow.state = .refunded
        updatedEscrow.completedAt = Date()
        try await updateEscrow(updatedEscrow)

        // 添加事件
        try await addEvent(
            escrowId: escrow.escrowId,
            eventType: .resolvedToBuyer,
            actor: wallet.address,
            transactionHash: record.hash
        )

        Logger.shared.info("[EscrowManager] 争议已解决，资金退还买家: \(escrow.escrowId)")

        return record
    }

    // MARK: - Query Functions

    /// 获取托管列表（按筛选条件）
    public func getEscrows(filter: EscrowFilter, walletAddress: String) -> [Escrow] {
        switch filter {
        case .all:
            return escrows
        case .asBuyer:
            return escrows.filter { $0.buyer.lowercased() == walletAddress.lowercased() }
        case .asSeller:
            return escrows.filter { $0.seller.lowercased() == walletAddress.lowercased() }
        case .asArbitrator:
            return escrows.filter { $0.arbitrator.lowercased() == walletAddress.lowercased() }
        case .active:
            return escrows.filter { $0.state == .funded || $0.state == .delivered }
        case .completed:
            return escrows.filter { $0.state == .completed || $0.state == .refunded }
        case .disputed:
            return escrows.filter { $0.state == .disputed }
        }
    }

    /// 获取托管事件
    public func getEvents(for escrowId: String) -> [EscrowEvent] {
        return escrowEvents[escrowId] ?? []
    }

    /// 查询链上托管状态
    public func queryEscrowState(
        escrowId: String,
        contractAddress: String,
        chain: SupportedChain
    ) async throws -> EscrowState {
        let result = try await contractManager.callContractFunction(
            contractAddress: contractAddress,
            abi: ContractABI.escrowContractABI,
            functionName: "getEscrow",
            parameters: [escrowId],
            chain: chain
        )

        // Parse result (simplified - actual parsing would be more complex)
        // Expected: tuple with state at index 7
        // For now, return current state
        throw EscrowError.notImplemented
    }

    // MARK: - Helper Methods

    /// 生成唯一的escrow ID
    private func generateEscrowId(buyer: String, seller: String, timestamp: Date) -> String {
        let data = "\(buyer)\(seller)\(timestamp.timeIntervalSince1970)".data(using: .utf8)!
        let hash = SHA256.hash(data: data)
        return "0x" + hash.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Database Operations

    /// 加载托管
    private func loadEscrows() async throws {
        let rows = try database.prepare("SELECT * FROM escrows ORDER BY created_at DESC")

        escrows = rows.compactMap { parseEscrowRow($0) }

        // 加载事件
        for escrow in escrows {
            let events = try loadEvents(for: escrow.escrowId)
            escrowEvents[escrow.escrowId] = events
        }

        Logger.shared.info("[EscrowManager] 已加载 \(escrows.count) 个托管")
    }

    /// 保存托管
    private func saveEscrow(_ escrow: Escrow) async throws {
        let sql = """
        INSERT OR REPLACE INTO escrows (
            id, escrow_id, contract_address, chain_id, buyer, seller, arbitrator,
            amount, payment_type, token_address, state, created_at, delivered_at,
            completed_at, transaction_hash, block_number, title, description,
            item_images, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        let itemImagesJSON = escrow.itemImages.map { try? JSONEncoder().encode($0) }.flatMap { String(data: $0, encoding: .utf8) }

        try database.execute(
            sql,
            escrow.id,
            escrow.escrowId,
            escrow.contractAddress,
            escrow.chainId,
            escrow.buyer,
            escrow.seller,
            escrow.arbitrator,
            escrow.amount,
            escrow.paymentType.rawValue,
            escrow.tokenAddress,
            escrow.state.rawValue,
            Int(escrow.createdAt.timeIntervalSince1970),
            escrow.deliveredAt.map { Int($0.timeIntervalSince1970) },
            escrow.completedAt.map { Int($0.timeIntervalSince1970) },
            escrow.transactionHash,
            escrow.blockNumber,
            escrow.title,
            escrow.description,
            itemImagesJSON,
            Int(escrow.updatedAt.timeIntervalSince1970)
        )
    }

    /// 更新托管
    private func updateEscrow(_ escrow: Escrow) async throws {
        try await saveEscrow(escrow)

        // 更新内存中的托管
        if let index = escrows.firstIndex(where: { $0.id == escrow.id }) {
            escrows[index] = escrow
        }

        // 发送更新事件
        escrowUpdated.send(escrow)
    }

    /// 添加事件
    private func addEvent(
        escrowId: String,
        eventType: EscrowEventType,
        actor: String,
        transactionHash: String? = nil,
        blockNumber: String? = nil
    ) async throws {
        let event = EscrowEvent(
            escrowId: escrowId,
            eventType: eventType,
            actor: actor,
            transactionHash: transactionHash,
            blockNumber: blockNumber
        )

        let sql = """
        INSERT INTO escrow_events (
            id, escrow_id, event_type, actor, timestamp, transaction_hash, block_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """

        try database.execute(
            sql,
            event.id,
            event.escrowId,
            event.eventType.rawValue,
            event.actor,
            Int(event.timestamp.timeIntervalSince1970),
            event.transactionHash,
            event.blockNumber
        )

        // 添加到内存
        var events = escrowEvents[escrowId] ?? []
        events.append(event)
        escrowEvents[escrowId] = events
    }

    /// 加载事件
    private func loadEvents(for escrowId: String) throws -> [EscrowEvent] {
        let rows = try database.prepare(
            "SELECT * FROM escrow_events WHERE escrow_id = ? ORDER BY timestamp ASC",
            escrowId
        )

        return rows.compactMap { parseEventRow($0) }
    }

    /// 解析托管行
    private func parseEscrowRow(_ row: [String: Any]) -> Escrow? {
        guard
            let id = row["id"] as? String,
            let escrowId = row["escrow_id"] as? String,
            let contractAddress = row["contract_address"] as? String,
            let chainId = row["chain_id"] as? Int,
            let buyer = row["buyer"] as? String,
            let seller = row["seller"] as? String,
            let arbitrator = row["arbitrator"] as? String,
            let amount = row["amount"] as? String,
            let paymentTypeRaw = row["payment_type"] as? Int,
            let paymentType = PaymentType(rawValue: paymentTypeRaw),
            let stateRaw = row["state"] as? Int,
            let state = EscrowState(rawValue: stateRaw),
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int
        else {
            return nil
        }

        let deliveredAt = (row["delivered_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }
        let completedAt = (row["completed_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }

        let itemImagesJSON = row["item_images"] as? String
        let itemImages = itemImagesJSON.flatMap { try? JSONDecoder().decode([String].self, from: $0.data(using: .utf8)!) }

        return Escrow(
            id: id,
            escrowId: escrowId,
            contractAddress: contractAddress,
            chainId: chainId,
            buyer: buyer,
            seller: seller,
            arbitrator: arbitrator,
            amount: amount,
            paymentType: paymentType,
            tokenAddress: row["token_address"] as? String,
            state: state,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
            deliveredAt: deliveredAt,
            completedAt: completedAt,
            transactionHash: row["transaction_hash"] as? String,
            blockNumber: row["block_number"] as? String,
            title: row["title"] as? String,
            description: row["description"] as? String,
            itemImages: itemImages,
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
        )
    }

    /// 解析事件行
    private func parseEventRow(_ row: [String: Any]) -> EscrowEvent? {
        guard
            let id = row["id"] as? String,
            let escrowId = row["escrow_id"] as? String,
            let eventTypeRaw = row["event_type"] as? String,
            let eventType = EscrowEventType(rawValue: eventTypeRaw),
            let actor = row["actor"] as? String,
            let timestampInt = row["timestamp"] as? Int
        else {
            return nil
        }

        return EscrowEvent(
            id: id,
            escrowId: escrowId,
            eventType: eventType,
            actor: actor,
            timestamp: Date(timeIntervalSince1970: TimeInterval(timestampInt)),
            transactionHash: row["transaction_hash"] as? String,
            blockNumber: row["block_number"] as? String
        )
    }

    // MARK: - Cleanup

    /// 清理资源
    public func cleanup() {
        escrows.removeAll()
        escrowEvents.removeAll()

        Logger.shared.info("[EscrowManager] 资源已清理")
    }
}

// MARK: - Errors

public enum EscrowError: Error, LocalizedError {
    case chainNotSupported
    case contractNotDeployed
    case invalidOperation
    case insufficientBalance
    case notImplemented

    public var errorDescription: String? {
        switch self {
        case .chainNotSupported:
            return "不支持的区块链"
        case .contractNotDeployed:
            return "托管合约未部署"
        case .invalidOperation:
            return "无效的操作"
        case .insufficientBalance:
            return "余额不足"
        case .notImplemented:
            return "功能尚未实现"
        }
    }
}
