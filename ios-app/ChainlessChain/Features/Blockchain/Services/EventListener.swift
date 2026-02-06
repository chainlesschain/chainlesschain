import Foundation
import Combine

/// 合约类型
public enum ContractEventType: String, Codable {
    case erc20 = "ERC20"
    case erc721 = "ERC721"
    case erc1155 = "ERC1155"
    case escrow = "Escrow"
    case subscription = "Subscription"
    case bounty = "Bounty"
    case marketplace = "Marketplace"
    case bridge = "Bridge"
}

/// 事件监听器配置
public struct EventListenerConfig: Identifiable, Codable {
    public let id: String
    public let contractAddress: String
    public let chainId: Int
    public let eventName: String
    public let contractType: ContractEventType
    public let abiJson: String
    public var isActive: Bool
    public var lastBlock: Int
    public let createdAt: Date

    public init(
        contractAddress: String,
        chainId: Int,
        eventName: String,
        contractType: ContractEventType,
        abiJson: String,
        isActive: Bool = true,
        lastBlock: Int = 0
    ) {
        self.id = "\(contractAddress)-\(chainId)-\(eventName)"
        self.contractAddress = contractAddress
        self.chainId = chainId
        self.eventName = eventName
        self.contractType = contractType
        self.abiJson = abiJson
        self.isActive = isActive
        self.lastBlock = lastBlock
        self.createdAt = Date()
    }
}

/// 处理过的事件记录
public struct ProcessedEvent: Identifiable, Codable {
    public let id: String
    public let contractAddress: String
    public let chainId: Int
    public let eventName: String
    public let blockNumber: Int
    public let transactionHash: String
    public let eventData: [String: String]
    public let processedAt: Date

    public init(
        contractAddress: String,
        chainId: Int,
        eventName: String,
        blockNumber: Int,
        transactionHash: String,
        eventData: [String: String]
    ) {
        self.id = "\(transactionHash)-\(eventName)"
        self.contractAddress = contractAddress
        self.chainId = chainId
        self.eventName = eventName
        self.blockNumber = blockNumber
        self.transactionHash = transactionHash
        self.eventData = eventData
        self.processedAt = Date()
    }
}

/// 链上事件数据
public struct BlockchainEventData {
    public let eventName: String
    public let contractAddress: String
    public let transactionHash: String
    public let blockNumber: Int
    public let blockHash: String
    public let args: [String: Any]
    public let timestamp: Date
}

/// 区块链事件监听器
/// 负责监听链上事件并同步到本地数据库
/// 支持：
/// - 资产转账事件
/// - 托管合约事件
/// - 市场合约事件
/// - 桥接合约事件
@MainActor
public class EventListener: ObservableObject {

    // MARK: - Singleton

    public static let shared = EventListener()

    // MARK: - Published Properties

    @Published public var activeListeners: [String: EventListenerConfig] = [:]
    @Published public var processedEventsCount: Int = 0
    @Published public var isListening = false

    // MARK: - Events

    public let eventProcessed = PassthroughSubject<ProcessedEvent, Never>()
    public let eventError = PassthroughSubject<(event: BlockchainEventData?, error: Error), Never>()

    // MARK: - Private Properties

    private let rpcClient: BlockchainRPCClient
    private let database: DatabaseManager
    private let chainManager: ChainManager

    /// 最后处理的区块号 (chainId -> blockNumber)
    private var lastProcessedBlock: [Int: Int] = [:]

    /// 事件处理器 (eventName -> handler)
    private var eventHandlers: [String: (BlockchainEventData) async -> Void] = [:]

    /// 轮询定时器
    private var pollingTimer: Timer?

    /// 轮询间隔（秒）
    private let pollingInterval: TimeInterval = 15

    private var initialized = false

    // MARK: - Initialization

    private init() {
        self.rpcClient = BlockchainRPCClient.shared
        self.database = DatabaseManager.shared
        self.chainManager = ChainManager.shared
        Logger.shared.info("[EventListener] 事件监听器已初始化")
    }

    // MARK: - Public Methods

    /// 初始化事件监听器
    public func initialize() async throws {
        Logger.shared.info("[EventListener] 初始化事件监听器...")

        try await initializeTables()
        await restoreListeners()

        initialized = true
        Logger.shared.info("[EventListener] 事件监听器初始化成功")
    }

    /// 添加事件监听器
    /// - Parameters:
    ///   - contractAddress: 合约地址
    ///   - chainId: 链ID
    ///   - eventName: 事件名称
    ///   - contractType: 合约类型
    ///   - abi: 合约ABI
    ///   - handler: 事件处理器（可选）
    /// - Returns: 监听器ID
    public func addListener(
        contractAddress: String,
        chainId: Int,
        eventName: String,
        contractType: ContractEventType,
        abi: String,
        handler: ((BlockchainEventData) async -> Void)? = nil
    ) async throws -> String {
        let listenerId = "\(contractAddress)-\(chainId)-\(eventName)"

        // 保存监听器配置到数据库
        let config = EventListenerConfig(
            contractAddress: contractAddress,
            chainId: chainId,
            eventName: eventName,
            contractType: contractType,
            abiJson: abi
        )

        try database.execute("""
            INSERT OR REPLACE INTO event_listeners
            (id, contract_address, chain_id, event_name, contract_type, abi_json, active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        """,
            listenerId,
            contractAddress,
            chainId,
            eventName,
            contractType.rawValue,
            abi,
            Int(Date().timeIntervalSince1970)
        )

        // 记录活跃监听器
        activeListeners[listenerId] = config

        // 注册自定义处理器
        if let handler = handler {
            eventHandlers["\(listenerId)"] = handler
        }

        // 启动轮询（如果未启动）
        if !isListening {
            startPolling()
        }

        Logger.shared.info("[EventListener] 已添加监听器: \(listenerId)")

        return listenerId
    }

    /// 移除事件监听器
    public func removeListener(listenerId: String) async throws {
        // 从数据库中标记为不活跃
        try database.execute("""
            UPDATE event_listeners SET active = 0 WHERE id = ?
        """, listenerId)

        // 从活跃监听器中移除
        activeListeners.removeValue(forKey: listenerId)
        eventHandlers.removeValue(forKey: listenerId)

        // 如果没有活跃监听器，停止轮询
        if activeListeners.isEmpty {
            stopPolling()
        }

        Logger.shared.info("[EventListener] 已移除监听器: \(listenerId)")
    }

    /// 获取已处理的事件
    public func getProcessedEvents(
        contractAddress: String? = nil,
        chainId: Int? = nil,
        eventName: String? = nil,
        limit: Int = 100
    ) async throws -> [ProcessedEvent] {
        var query = "SELECT * FROM processed_events WHERE 1=1"
        var params: [Any] = []

        if let contractAddress = contractAddress {
            query += " AND contract_address = ?"
            params.append(contractAddress)
        }

        if let chainId = chainId {
            query += " AND chain_id = ?"
            params.append(chainId)
        }

        if let eventName = eventName {
            query += " AND event_name = ?"
            params.append(eventName)
        }

        query += " ORDER BY processed_at DESC LIMIT ?"
        params.append(limit)

        let rows = try database.prepare(query, params)

        return rows.compactMap { parseProcessedEvent($0) }
    }

    /// 手动触发事件轮询
    public func pollEvents() async {
        await checkForNewEvents()
    }

    /// 清理资源
    public func cleanup() async {
        Logger.shared.info("[EventListener] 清理资源...")

        stopPolling()
        activeListeners.removeAll()
        eventHandlers.removeAll()
        lastProcessedBlock.removeAll()
        initialized = false
    }

    // MARK: - Polling

    /// 启动轮询
    private func startPolling() {
        guard pollingTimer == nil else { return }

        isListening = true

        pollingTimer = Timer.scheduledTimer(withTimeInterval: pollingInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.checkForNewEvents()
            }
        }

        Logger.shared.info("[EventListener] 事件轮询已启动 (间隔: \(Int(pollingInterval))秒)")
    }

    /// 停止轮询
    private func stopPolling() {
        pollingTimer?.invalidate()
        pollingTimer = nil
        isListening = false
        Logger.shared.info("[EventListener] 事件轮询已停止")
    }

    /// 检查新事件
    private func checkForNewEvents() async {
        for (listenerId, config) in activeListeners {
            guard config.isActive else { continue }

            do {
                // 获取当前区块号
                let currentBlock = try await rpcClient.getBlockNumber(chainId: config.chainId)

                // 获取上次处理的区块
                let fromBlock = lastProcessedBlock[config.chainId] ?? config.lastBlock

                // 如果有新区块，获取日志
                if currentBlock > fromBlock {
                    let logs = try await rpcClient.getLogs(
                        contractAddress: config.contractAddress,
                        fromBlock: fromBlock + 1,
                        toBlock: currentBlock,
                        chainId: config.chainId
                    )

                    // 处理每个日志
                    for log in logs {
                        await processLog(log, config: config, listenerId: listenerId)
                    }

                    // 更新最后处理的区块
                    lastProcessedBlock[config.chainId] = currentBlock
                    try await updateLastBlock(listenerId: listenerId, blockNumber: currentBlock)
                }
            } catch {
                Logger.shared.error("[EventListener] 检查事件失败 \(listenerId): \(error)")
            }
        }
    }

    /// 处理日志
    private func processLog(_ log: RPCLog, config: EventListenerConfig, listenerId: String) async {
        // 检查是否已处理
        let eventId = "\(log.transactionHash)-\(config.eventName)"

        do {
            let existing = try database.prepare(
                "SELECT id FROM processed_events WHERE id = ?",
                [eventId]
            )

            if !existing.isEmpty {
                Logger.shared.debug("[EventListener] 事件已处理，跳过: \(eventId)")
                return
            }
        } catch {
            Logger.shared.error("[EventListener] 检查事件状态失败: \(error)")
        }

        Logger.shared.info("[EventListener] 处理事件: \(config.eventName) @ \(config.contractAddress)")

        // 构造事件数据
        let eventData = BlockchainEventData(
            eventName: config.eventName,
            contractAddress: config.contractAddress,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            args: parseLogData(log, eventName: config.eventName),
            timestamp: Date()
        )

        // 调用自定义处理器
        if let handler = eventHandlers[listenerId] {
            await handler(eventData)
        }

        // 根据合约类型执行默认处理
        await processEventByType(config.contractType, eventName: config.eventName, eventData: eventData)

        // 记录已处理的事件
        let processedEvent = ProcessedEvent(
            contractAddress: config.contractAddress,
            chainId: config.chainId,
            eventName: config.eventName,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            eventData: eventData.args.mapValues { "\($0)" }
        )

        do {
            try database.execute("""
                INSERT INTO processed_events
                (id, contract_address, chain_id, event_name, block_number, transaction_hash, event_data, processed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                processedEvent.id,
                processedEvent.contractAddress,
                processedEvent.chainId,
                processedEvent.eventName,
                processedEvent.blockNumber,
                processedEvent.transactionHash,
                try JSONEncoder().encode(processedEvent.eventData),
                Int(processedEvent.processedAt.timeIntervalSince1970)
            )

            processedEventsCount += 1
            eventProcessed.send(processedEvent)

            Logger.shared.info("[EventListener] 事件处理完成: \(eventId)")
        } catch {
            Logger.shared.error("[EventListener] 保存事件记录失败: \(error)")
        }
    }

    /// 根据合约类型处理事件
    private func processEventByType(
        _ contractType: ContractEventType,
        eventName: String,
        eventData: BlockchainEventData
    ) async {
        switch contractType {
        case .erc20:
            await processERC20Event(eventName: eventName, eventData: eventData)
        case .erc721:
            await processERC721Event(eventName: eventName, eventData: eventData)
        case .erc1155:
            await processERC1155Event(eventName: eventName, eventData: eventData)
        case .escrow:
            await processEscrowEvent(eventName: eventName, eventData: eventData)
        case .marketplace:
            await processMarketplaceEvent(eventName: eventName, eventData: eventData)
        case .bridge:
            await processBridgeEvent(eventName: eventName, eventData: eventData)
        case .subscription:
            await processSubscriptionEvent(eventName: eventName, eventData: eventData)
        case .bounty:
            await processBountyEvent(eventName: eventName, eventData: eventData)
        }
    }

    // MARK: - Event Processors

    /// 处理 ERC-20 事件
    private func processERC20Event(eventName: String, eventData: BlockchainEventData) async {
        if eventName == "Transfer" {
            let from = eventData.args["from"] as? String ?? ""
            let to = eventData.args["to"] as? String ?? ""
            let value = eventData.args["value"] as? String ?? "0"
            Logger.shared.info("[EventListener] ERC-20 转账: \(from) -> \(to), 数量: \(value)")

            // TODO: 同步到本地资产管理器
        } else if eventName == "Approval" {
            let owner = eventData.args["owner"] as? String ?? ""
            let spender = eventData.args["spender"] as? String ?? ""
            let value = eventData.args["value"] as? String ?? "0"
            Logger.shared.info("[EventListener] ERC-20 授权: \(owner) -> \(spender), 数量: \(value)")
        }
    }

    /// 处理 ERC-721 事件
    private func processERC721Event(eventName: String, eventData: BlockchainEventData) async {
        if eventName == "Transfer" {
            let from = eventData.args["from"] as? String ?? ""
            let to = eventData.args["to"] as? String ?? ""
            let tokenId = eventData.args["tokenId"] as? String ?? "0"
            Logger.shared.info("[EventListener] NFT 转账: \(from) -> \(to), Token ID: \(tokenId)")

            // TODO: 同步到本地 NFT 管理器
        }
    }

    /// 处理 ERC-1155 事件
    private func processERC1155Event(eventName: String, eventData: BlockchainEventData) async {
        if eventName == "TransferSingle" {
            let from = eventData.args["from"] as? String ?? ""
            let to = eventData.args["to"] as? String ?? ""
            let id = eventData.args["id"] as? String ?? "0"
            let value = eventData.args["value"] as? String ?? "0"
            Logger.shared.info("[EventListener] ERC-1155 转账: \(from) -> \(to), ID: \(id), 数量: \(value)")
        }
    }

    /// 处理托管合约事件
    private func processEscrowEvent(eventName: String, eventData: BlockchainEventData) async {
        Logger.shared.info("[EventListener] 托管事件: \(eventName)")

        switch eventName {
        case "EscrowCreated":
            Logger.shared.info("[EventListener] 托管已创建")
        case "EscrowCompleted":
            Logger.shared.info("[EventListener] 托管已完成")
        case "EscrowRefunded":
            Logger.shared.info("[EventListener] 托管已退款")
        case "EscrowDisputed":
            Logger.shared.info("[EventListener] 托管发生争议")
        default:
            break
        }
    }

    /// 处理市场合约事件
    private func processMarketplaceEvent(eventName: String, eventData: BlockchainEventData) async {
        Logger.shared.info("[EventListener] 市场事件: \(eventName)")

        switch eventName {
        case "Listed":
            Logger.shared.info("[EventListener] NFT 已上架")
        case "Sold":
            Logger.shared.info("[EventListener] NFT 已售出")
        case "Canceled":
            Logger.shared.info("[EventListener] 挂单已取消")
        case "OfferMade":
            Logger.shared.info("[EventListener] 收到出价")
        case "OfferAccepted":
            Logger.shared.info("[EventListener] 出价已接受")
        default:
            break
        }
    }

    /// 处理桥接合约事件
    private func processBridgeEvent(eventName: String, eventData: BlockchainEventData) async {
        Logger.shared.info("[EventListener] 桥接事件: \(eventName)")

        switch eventName {
        case "AssetLocked":
            Logger.shared.info("[EventListener] 资产已锁定")
            // 通知 BridgeManager
            BridgeManager.shared.assetLocked.send(BridgeEvent(
                eventType: .assetLocked,
                requestId: eventData.args["requestId"] as? String ?? "",
                user: eventData.args["user"] as? String ?? "",
                token: eventData.args["token"] as? String ?? "",
                amount: eventData.args["amount"] as? String ?? "0",
                chainId: 0,
                transactionHash: eventData.transactionHash,
                blockNumber: String(eventData.blockNumber),
                timestamp: eventData.timestamp
            ))
        case "AssetMinted":
            Logger.shared.info("[EventListener] 资产已铸造")
        default:
            break
        }
    }

    /// 处理订阅合约事件
    private func processSubscriptionEvent(eventName: String, eventData: BlockchainEventData) async {
        Logger.shared.info("[EventListener] 订阅事件: \(eventName)")

        switch eventName {
        case "Subscribed":
            Logger.shared.info("[EventListener] 新订阅")
        case "SubscriptionRenewed":
            Logger.shared.info("[EventListener] 订阅已续订")
        case "SubscriptionCancelled":
            Logger.shared.info("[EventListener] 订阅已取消")
        case "PaymentReceived":
            Logger.shared.info("[EventListener] 收到订阅支付")
        default:
            break
        }
    }

    /// 处理悬赏合约事件
    private func processBountyEvent(eventName: String, eventData: BlockchainEventData) async {
        Logger.shared.info("[EventListener] 悬赏事件: \(eventName)")
        // TODO: 实现悬赏合约事件处理逻辑
    }

    // MARK: - Private Methods

    /// 初始化数据库表
    private func initializeTables() async throws {
        // 事件监听配置表
        try database.execute("""
            CREATE TABLE IF NOT EXISTS event_listeners (
                id TEXT PRIMARY KEY,
                contract_address TEXT NOT NULL,
                chain_id INTEGER NOT NULL,
                event_name TEXT NOT NULL,
                contract_type TEXT NOT NULL,
                abi_json TEXT NOT NULL,
                active BOOLEAN DEFAULT 1,
                last_block INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                UNIQUE(contract_address, chain_id, event_name)
            )
        """)

        // 事件处理记录表
        try database.execute("""
            CREATE TABLE IF NOT EXISTS processed_events (
                id TEXT PRIMARY KEY,
                contract_address TEXT NOT NULL,
                chain_id INTEGER NOT NULL,
                event_name TEXT NOT NULL,
                block_number INTEGER NOT NULL,
                transaction_hash TEXT NOT NULL,
                event_data TEXT NOT NULL,
                processed_at INTEGER NOT NULL,
                UNIQUE(transaction_hash, event_name)
            )
        """)

        // 创建索引
        try database.execute("""
            CREATE INDEX IF NOT EXISTS idx_event_listeners_contract ON event_listeners(contract_address, chain_id)
        """)
        try database.execute("""
            CREATE INDEX IF NOT EXISTS idx_processed_events_contract ON processed_events(contract_address, chain_id)
        """)
        try database.execute("""
            CREATE INDEX IF NOT EXISTS idx_processed_events_tx ON processed_events(transaction_hash)
        """)

        Logger.shared.info("[EventListener] 数据库表初始化完成")
    }

    /// 恢复之前的监听器
    private func restoreListeners() async {
        do {
            let rows = try database.prepare(
                "SELECT * FROM event_listeners WHERE active = 1"
            )

            Logger.shared.info("[EventListener] 恢复 \(rows.count) 个监听器...")

            for row in rows {
                if let config = parseListenerConfig(row) {
                    activeListeners[config.id] = config
                    lastProcessedBlock[config.chainId] = config.lastBlock
                }
            }

            // 如果有活跃监听器，启动轮询
            if !activeListeners.isEmpty {
                startPolling()
            }
        } catch {
            Logger.shared.error("[EventListener] 恢复监听器失败: \(error)")
        }
    }

    /// 更新最后处理的区块号
    private func updateLastBlock(listenerId: String, blockNumber: Int) async throws {
        try database.execute("""
            UPDATE event_listeners SET last_block = ? WHERE id = ?
        """, blockNumber, listenerId)

        if var config = activeListeners[listenerId] {
            config = EventListenerConfig(
                contractAddress: config.contractAddress,
                chainId: config.chainId,
                eventName: config.eventName,
                contractType: config.contractType,
                abiJson: config.abiJson,
                isActive: config.isActive,
                lastBlock: blockNumber
            )
            activeListeners[listenerId] = config
        }
    }

    /// 解析日志数据
    private func parseLogData(_ log: RPCLog, eventName: String) -> [String: Any] {
        // 简化的日志解析
        // 实际实现需要根据 ABI 解码
        var args: [String: Any] = [:]
        args["topics"] = log.topics
        args["data"] = log.data
        return args
    }

    /// 解析监听器配置
    private func parseListenerConfig(_ row: [String: Any]) -> EventListenerConfig? {
        guard
            let id = row["id"] as? String,
            let contractAddress = row["contract_address"] as? String,
            let chainId = row["chain_id"] as? Int,
            let eventName = row["event_name"] as? String,
            let contractTypeRaw = row["contract_type"] as? String,
            let contractType = ContractEventType(rawValue: contractTypeRaw),
            let abiJson = row["abi_json"] as? String,
            let active = row["active"] as? Int,
            let lastBlock = row["last_block"] as? Int
        else {
            return nil
        }

        return EventListenerConfig(
            contractAddress: contractAddress,
            chainId: chainId,
            eventName: eventName,
            contractType: contractType,
            abiJson: abiJson,
            isActive: active == 1,
            lastBlock: lastBlock
        )
    }

    /// 解析已处理事件
    private func parseProcessedEvent(_ row: [String: Any]) -> ProcessedEvent? {
        guard
            let contractAddress = row["contract_address"] as? String,
            let chainId = row["chain_id"] as? Int,
            let eventName = row["event_name"] as? String,
            let blockNumber = row["block_number"] as? Int,
            let transactionHash = row["transaction_hash"] as? String
        else {
            return nil
        }

        var eventData: [String: String] = [:]
        if let eventDataRaw = row["event_data"] as? Data {
            eventData = (try? JSONDecoder().decode([String: String].self, from: eventDataRaw)) ?? [:]
        }

        return ProcessedEvent(
            contractAddress: contractAddress,
            chainId: chainId,
            eventName: eventName,
            blockNumber: blockNumber,
            transactionHash: transactionHash,
            eventData: eventData
        )
    }
}

// MARK: - RPC Log

/// RPC 日志数据
struct RPCLog {
    let address: String
    let topics: [String]
    let data: String
    let blockNumber: Int
    let blockHash: String
    let transactionHash: String
    let transactionIndex: Int
    let logIndex: Int
}
