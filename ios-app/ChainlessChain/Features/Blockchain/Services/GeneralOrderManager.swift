import Foundation
import Combine

/// 通用订单管理器
/// 负责交易市场的管理，包括订单创建、匹配、交易流程和托管集成
/// 参考PC端: desktop-app-vue/src/main/trade/marketplace-manager.js
@MainActor
public class GeneralOrderManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = GeneralOrderManager()

    // MARK: - Published Properties

    @Published public var orders: [MarketplaceOrder] = []
    @Published public var transactions: [MarketplaceTransaction] = []
    @Published public var isLoading = false

    // MARK: - Events

    public let orderCreated = PassthroughSubject<MarketplaceOrder, Never>()
    public let orderUpdated = PassthroughSubject<MarketplaceOrder, Never>()
    public let orderCancelled = PassthroughSubject<String, Never>()
    public let orderMatched = PassthroughSubject<(orderId: String, transactionId: String), Never>()

    public let transactionCreated = PassthroughSubject<MarketplaceTransaction, Never>()
    public let transactionCompleted = PassthroughSubject<String, Never>()
    public let refundRequested = PassthroughSubject<(transactionId: String, reason: String), Never>()

    // MARK: - Private Properties

    private let database: DatabaseManager
    private let didManager: DIDManager
    private let escrowManager: EscrowManager

    private var initialized = false

    // MARK: - Initialization

    private init() {
        self.database = DatabaseManager.shared
        self.didManager = DIDManager.shared
        self.escrowManager = EscrowManager.shared

        Logger.shared.info("[GeneralOrderManager] 通用订单管理器已初始化")
    }

    // MARK: - Public Methods

    /// 初始化订单管理器
    public func initialize() async throws {
        Logger.shared.info("[GeneralOrderManager] 初始化订单管理器...")

        try await initializeTables()
        try await loadOrders()
        try await loadTransactions()

        initialized = true
        Logger.shared.info("[GeneralOrderManager] 订单管理器初始化成功，已加载 \(orders.count) 个订单")
    }

    // MARK: - Order CRUD

    /// 创建订单
    public func createOrder(
        type: MarketplaceOrderType,
        assetId: String? = nil,
        assetType: String,
        assetName: String? = nil,
        title: String,
        description: String? = nil,
        priceAssetId: String? = nil,
        price: Double,
        quantity: Double,
        currency: String = "CNY",
        expiresIn: TimeInterval? = nil,
        metadata: [String: String]? = nil,
        contactInfo: String? = nil,
        location: String? = nil
    ) async throws -> MarketplaceOrder {
        guard let currentDid = didManager.currentIdentity?.did else {
            throw GeneralOrderError.notLoggedIn
        }

        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw GeneralOrderError.invalidTitle
        }

        guard price > 0 else {
            throw GeneralOrderError.invalidPrice
        }

        guard quantity > 0 else {
            throw GeneralOrderError.invalidQuantity
        }

        let now = Date()
        let expiresAt = expiresIn.map { now.addingTimeInterval($0) }

        let order = MarketplaceOrder(
            type: type,
            creatorDid: currentDid,
            assetId: assetId,
            assetType: assetType,
            assetName: assetName,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description,
            priceAssetId: priceAssetId,
            price: price,
            totalPrice: price * quantity,
            currency: currency,
            quantity: quantity,
            status: .open,
            metadata: metadata,
            createdAt: now,
            updatedAt: now,
            expiresAt: expiresAt,
            contactInfo: contactInfo,
            location: location
        )

        try await saveOrder(order)
        orders.insert(order, at: 0)
        orderCreated.send(order)

        Logger.shared.info("[GeneralOrderManager] 订单已创建: \(order.id)")
        return order
    }

    /// 更新订单
    public func updateOrder(
        orderId: String,
        price: Double? = nil,
        quantity: Double? = nil,
        description: String? = nil,
        contactInfo: String? = nil,
        location: String? = nil
    ) async throws -> MarketplaceOrder {
        guard let currentDid = didManager.currentIdentity?.did else {
            throw GeneralOrderError.notLoggedIn
        }

        guard var order = orders.first(where: { $0.id == orderId }) else {
            throw GeneralOrderError.orderNotFound
        }

        guard order.creatorDid == currentDid else {
            throw GeneralOrderError.notOrderOwner
        }

        guard order.status == .open else {
            throw GeneralOrderError.orderNotEditable
        }

        // 更新字段
        if let price = price, price > 0 {
            order.price = price
            if let quantity = order.quantity {
                order.totalPrice = price * quantity
            }
        }

        if let quantity = quantity, quantity > 0 {
            order.quantity = quantity
            if let price = order.price {
                order.totalPrice = price * quantity
            }
        }

        if let description = description {
            order.description = description
        }

        if let contactInfo = contactInfo {
            order.contactInfo = contactInfo
        }

        if let location = location {
            order.location = location
        }

        order.updatedAt = Date()

        try await updateOrderInDB(order)

        if let index = orders.firstIndex(where: { $0.id == orderId }) {
            orders[index] = order
        }

        orderUpdated.send(order)
        Logger.shared.info("[GeneralOrderManager] 订单已更新: \(orderId)")

        return order
    }

    /// 取消订单
    public func cancelOrder(orderId: String) async throws {
        guard let currentDid = didManager.currentIdentity?.did else {
            throw GeneralOrderError.notLoggedIn
        }

        guard var order = orders.first(where: { $0.id == orderId }) else {
            throw GeneralOrderError.orderNotFound
        }

        guard order.creatorDid == currentDid else {
            throw GeneralOrderError.notOrderOwner
        }

        guard order.status == .open else {
            throw GeneralOrderError.cannotCancelOrder
        }

        order.status = .cancelled
        order.cancelledAt = Date()
        order.updatedAt = Date()

        try await updateOrderInDB(order)

        if let index = orders.firstIndex(where: { $0.id == orderId }) {
            orders[index] = order
        }

        orderCancelled.send(orderId)
        Logger.shared.info("[GeneralOrderManager] 订单已取消: \(orderId)")
    }

    /// 获取订单详情
    public func getOrder(orderId: String) -> MarketplaceOrder? {
        return orders.first { $0.id == orderId }
    }

    // MARK: - Order Search and Filter

    /// 获取订单列表（支持高级筛选和分页）
    public func getOrders(filter: MarketplaceOrderFilter) async throws -> PaginatedOrders {
        var query = "SELECT * FROM marketplace_orders WHERE 1=1"
        var countQuery = "SELECT COUNT(*) as total FROM marketplace_orders WHERE 1=1"
        var params: [Any] = []
        var countParams: [Any] = []

        // 搜索条件
        if let search = filter.search, !search.isEmpty {
            query += " AND (title LIKE ? OR description LIKE ?)"
            countQuery += " AND (title LIKE ? OR description LIKE ?)"
            let pattern = "%\(search)%"
            params.append(contentsOf: [pattern, pattern])
            countParams.append(contentsOf: [pattern, pattern])
        }

        // 类型筛选
        if let type = filter.type {
            query += " AND order_type = ?"
            countQuery += " AND order_type = ?"
            params.append(type.rawValue)
            countParams.append(type.rawValue)
        }

        // 状态筛选
        if let status = filter.status {
            query += " AND status = ?"
            countQuery += " AND status = ?"
            params.append(status.rawValue)
            countParams.append(status.rawValue)
        }

        // 创建者筛选
        if let creatorDid = filter.creatorDid {
            query += " AND creator_did = ?"
            countQuery += " AND creator_did = ?"
            params.append(creatorDid)
            countParams.append(creatorDid)
        }

        // 价格范围
        if let priceMin = filter.priceMin {
            query += " AND price >= ?"
            countQuery += " AND price >= ?"
            params.append(priceMin)
            countParams.append(priceMin)
        }

        if let priceMax = filter.priceMax {
            query += " AND price <= ?"
            countQuery += " AND price <= ?"
            params.append(priceMax)
            countParams.append(priceMax)
        }

        // 时间范围
        if let createdAfter = filter.createdAfter {
            query += " AND created_at >= ?"
            countQuery += " AND created_at >= ?"
            params.append(Int(createdAfter.timeIntervalSince1970))
            countParams.append(Int(createdAfter.timeIntervalSince1970))
        }

        if let createdBefore = filter.createdBefore {
            query += " AND created_at <= ?"
            countQuery += " AND created_at <= ?"
            params.append(Int(createdBefore.timeIntervalSince1970))
            countParams.append(Int(createdBefore.timeIntervalSince1970))
        }

        // 排序
        query += " ORDER BY \(filter.sortBy.rawValue) \(filter.sortOrder.rawValue)"

        // 分页
        query += " LIMIT ? OFFSET ?"
        params.append(contentsOf: [filter.pageSize, filter.offset])

        // 执行查询
        let rows = try database.prepare(query, params)
        let countRows = try database.prepare(countQuery, countParams)

        let total = countRows.first?["total"] as? Int ?? 0
        let items = rows.compactMap { parseOrderRow($0) }

        return PaginatedOrders(
            items: items,
            total: total,
            page: filter.page,
            pageSize: filter.pageSize
        )
    }

    /// 搜索订单
    public func searchOrders(keyword: String, status: MarketplaceOrderStatus = .open) async throws -> PaginatedOrders {
        var filter = MarketplaceOrderFilter()
        filter.search = keyword
        filter.status = status
        return try await getOrders(filter: filter)
    }

    /// 获取搜索建议
    public func getSearchSuggestions(prefix: String, limit: Int = 10) async -> [OrderSearchSuggestion] {
        guard prefix.count >= 2 else { return [] }

        var suggestions: [OrderSearchSuggestion] = []

        // 类型建议
        let typeSuggestions = MarketplaceOrderType.allCases
            .filter { $0.displayName.contains(prefix) || $0.rawValue.contains(prefix.lowercased()) }
            .map { OrderSearchSuggestion(suggestion: $0.displayName, source: "type", value: $0.rawValue) }

        suggestions.append(contentsOf: typeSuggestions)

        // 标题建议
        do {
            let pattern = "\(prefix)%"
            let rows = try database.prepare(
                "SELECT DISTINCT title FROM marketplace_orders WHERE title LIKE ? AND status = ? LIMIT ?",
                [pattern, MarketplaceOrderStatus.open.rawValue, limit / 2]
            )

            for row in rows {
                if let title = row["title"] as? String {
                    suggestions.append(OrderSearchSuggestion(suggestion: title, source: "title"))
                }
            }
        } catch {
            Logger.shared.error("[GeneralOrderManager] 获取搜索建议失败: \(error)")
        }

        return Array(suggestions.prefix(limit))
    }

    // MARK: - Order Matching

    /// 匹配订单（购买）
    public func matchOrder(orderId: String, quantity: Double? = nil) async throws -> MarketplaceTransaction {
        guard let currentDid = didManager.currentIdentity?.did else {
            throw GeneralOrderError.notLoggedIn
        }

        guard var order = orders.first(where: { $0.id == orderId }) else {
            throw GeneralOrderError.orderNotFound
        }

        guard order.status == .open else {
            throw GeneralOrderError.orderNotAvailable
        }

        guard order.creatorDid != currentDid else {
            throw GeneralOrderError.cannotBuyOwnOrder
        }

        let buyQuantity = quantity ?? order.quantity ?? 1
        guard buyQuantity <= (order.quantity ?? 1) else {
            throw GeneralOrderError.quantityExceeded
        }

        // 创建交易
        let transaction = try await createTransaction(
            orderId: orderId,
            buyerDid: currentDid,
            sellerDid: order.creatorDid,
            assetId: order.assetId,
            paymentAssetId: order.priceAssetId,
            paymentAmount: (order.price ?? 0) * buyQuantity,
            quantity: buyQuantity
        )

        // 更新订单状态
        if buyQuantity == (order.quantity ?? 1) {
            order.status = .matched
            order.buyerDid = currentDid
            order.updatedAt = Date()
            try await updateOrderInDB(order)

            if let index = orders.firstIndex(where: { $0.id == orderId }) {
                orders[index] = order
            }
        }

        orderMatched.send((orderId: orderId, transactionId: transaction.id))
        Logger.shared.info("[GeneralOrderManager] 订单已匹配: \(orderId)")

        return transaction
    }

    // MARK: - Transaction Management

    /// 创建交易
    private func createTransaction(
        orderId: String,
        buyerDid: String,
        sellerDid: String,
        assetId: String?,
        paymentAssetId: String?,
        paymentAmount: Double,
        quantity: Double
    ) async throws -> MarketplaceTransaction {
        var transaction = MarketplaceTransaction(
            orderId: orderId,
            buyerDid: buyerDid,
            sellerDid: sellerDid,
            assetId: assetId,
            paymentAssetId: paymentAssetId,
            paymentAmount: paymentAmount,
            quantity: quantity,
            status: .pending
        )

        // 创建托管（如果有支付资产）
        if paymentAssetId != nil {
            do {
                let escrow = try await escrowManager.createEscrow(
                    buyerDid: buyerDid,
                    sellerDid: sellerDid,
                    amount: String(paymentAmount),
                    assetType: paymentAssetId ?? "native"
                )
                transaction.escrowId = escrow.id
                transaction.status = .escrowed
            } catch {
                Logger.shared.warn("[GeneralOrderManager] 创建托管失败: \(error)")
            }
        }

        try await saveTransaction(transaction)
        transactions.insert(transaction, at: 0)
        transactionCreated.send(transaction)

        Logger.shared.info("[GeneralOrderManager] 交易已创建: \(transaction.id)")
        return transaction
    }

    /// 确认交付（买家操作）
    public func confirmDelivery(transactionId: String) async throws {
        guard let currentDid = didManager.currentIdentity?.did else {
            throw GeneralOrderError.notLoggedIn
        }

        guard var transaction = transactions.first(where: { $0.id == transactionId }) else {
            throw GeneralOrderError.transactionNotFound
        }

        guard transaction.buyerDid == currentDid else {
            throw GeneralOrderError.notBuyer
        }

        guard transaction.status == .escrowed || transaction.status == .delivered else {
            throw GeneralOrderError.invalidTransactionStatus
        }

        // 释放托管资金给卖家
        if let escrowId = transaction.escrowId {
            try await escrowManager.releaseEscrow(escrowId: escrowId, to: transaction.sellerDid)
        }

        transaction.status = .completed
        transaction.completedAt = Date()

        try await updateTransactionInDB(transaction)

        if let index = transactions.firstIndex(where: { $0.id == transactionId }) {
            transactions[index] = transaction
        }

        // 更新订单状态
        if var order = orders.first(where: { $0.id == transaction.orderId }) {
            order.status = .completed
            order.completedAt = Date()
            order.updatedAt = Date()
            try await updateOrderInDB(order)

            if let index = orders.firstIndex(where: { $0.id == order.id }) {
                orders[index] = order
            }
        }

        transactionCompleted.send(transactionId)
        Logger.shared.info("[GeneralOrderManager] 交易已完成: \(transactionId)")
    }

    /// 申请退款（买家操作）
    public func requestRefund(transactionId: String, reason: String) async throws {
        guard let currentDid = didManager.currentIdentity?.did else {
            throw GeneralOrderError.notLoggedIn
        }

        guard var transaction = transactions.first(where: { $0.id == transactionId }) else {
            throw GeneralOrderError.transactionNotFound
        }

        guard transaction.buyerDid == currentDid else {
            throw GeneralOrderError.notBuyer
        }

        guard transaction.status == .escrowed else {
            throw GeneralOrderError.cannotRequestRefund
        }

        transaction.status = .disputed

        try await updateTransactionInDB(transaction)

        if let index = transactions.firstIndex(where: { $0.id == transactionId }) {
            transactions[index] = transaction
        }

        // 更新订单状态
        if var order = orders.first(where: { $0.id == transaction.orderId }) {
            order.status = .disputed
            order.updatedAt = Date()
            try await updateOrderInDB(order)

            if let index = orders.firstIndex(where: { $0.id == order.id }) {
                orders[index] = order
            }
        }

        refundRequested.send((transactionId: transactionId, reason: reason))
        Logger.shared.info("[GeneralOrderManager] 退款申请已提交: \(transactionId)")
    }

    /// 获取交易列表
    public func getTransactions(
        orderId: String? = nil,
        buyerDid: String? = nil,
        sellerDid: String? = nil,
        status: MarketplaceTransactionStatus? = nil,
        limit: Int? = nil
    ) -> [MarketplaceTransaction] {
        var result = transactions

        if let orderId = orderId {
            result = result.filter { $0.orderId == orderId }
        }

        if let buyerDid = buyerDid {
            result = result.filter { $0.buyerDid == buyerDid }
        }

        if let sellerDid = sellerDid {
            result = result.filter { $0.sellerDid == sellerDid }
        }

        if let status = status {
            result = result.filter { $0.status == status }
        }

        if let limit = limit {
            result = Array(result.prefix(limit))
        }

        return result
    }

    /// 获取我的订单
    public func getMyOrders() -> (created: [MarketplaceOrder], purchased: [MarketplaceTransaction]) {
        guard let currentDid = didManager.currentIdentity?.did else {
            return ([], [])
        }

        let created = orders.filter { $0.creatorDid == currentDid }
        let purchased = transactions.filter { $0.buyerDid == currentDid }

        return (created, purchased)
    }

    // MARK: - Database Operations

    private func initializeTables() async throws {
        // 订单表
        try database.execute("""
            CREATE TABLE IF NOT EXISTS marketplace_orders (
                id TEXT PRIMARY KEY,
                order_type TEXT NOT NULL,
                creator_did TEXT NOT NULL,
                asset_id TEXT,
                asset_type TEXT NOT NULL,
                asset_name TEXT,
                title TEXT NOT NULL,
                description TEXT,
                price_asset_id TEXT,
                price REAL,
                total_price REAL,
                currency TEXT,
                quantity REAL,
                status TEXT NOT NULL DEFAULT 'open',
                buyer_did TEXT,
                metadata TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                expires_at INTEGER,
                completed_at INTEGER,
                cancelled_at INTEGER,
                contact_info TEXT,
                location TEXT
            )
        """)

        // 交易表
        try database.execute("""
            CREATE TABLE IF NOT EXISTS marketplace_transactions (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL,
                buyer_did TEXT NOT NULL,
                seller_did TEXT NOT NULL,
                asset_id TEXT,
                payment_asset_id TEXT,
                payment_amount REAL NOT NULL,
                quantity REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                escrow_id TEXT,
                created_at INTEGER NOT NULL,
                completed_at INTEGER
            )
        """)

        // 创建索引
        try database.execute("CREATE INDEX IF NOT EXISTS idx_mo_creator ON marketplace_orders(creator_did)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_mo_status ON marketplace_orders(status)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_mo_type ON marketplace_orders(order_type)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_mo_price ON marketplace_orders(price)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_mo_created ON marketplace_orders(created_at)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_mt_order ON marketplace_transactions(order_id)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_mt_buyer ON marketplace_transactions(buyer_did)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_mt_seller ON marketplace_transactions(seller_did)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_mt_status ON marketplace_transactions(status)")

        Logger.shared.info("[GeneralOrderManager] 数据库表初始化完成")
    }

    private func loadOrders() async throws {
        let rows = try database.prepare(
            "SELECT * FROM marketplace_orders ORDER BY created_at DESC LIMIT 1000"
        )
        orders = rows.compactMap { parseOrderRow($0) }
    }

    private func loadTransactions() async throws {
        let rows = try database.prepare(
            "SELECT * FROM marketplace_transactions ORDER BY created_at DESC LIMIT 1000"
        )
        transactions = rows.compactMap { parseTransactionRow($0) }
    }

    private func saveOrder(_ order: MarketplaceOrder) async throws {
        let metadataJson = order.metadata.map { try? JSONSerialization.data(withJSONObject: $0) }
            .flatMap { String(data: $0, encoding: .utf8) }

        try database.execute("""
            INSERT INTO marketplace_orders (
                id, order_type, creator_did, asset_id, asset_type, asset_name,
                title, description, price_asset_id, price, total_price, currency,
                quantity, status, buyer_did, metadata, created_at, updated_at,
                expires_at, completed_at, cancelled_at, contact_info, location
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            order.id,
            order.type.rawValue,
            order.creatorDid,
            order.assetId,
            order.assetType,
            order.assetName,
            order.title,
            order.description,
            order.priceAssetId,
            order.price,
            order.totalPrice,
            order.currency,
            order.quantity,
            order.status.rawValue,
            order.buyerDid,
            metadataJson,
            Int(order.createdAt.timeIntervalSince1970),
            Int(order.updatedAt.timeIntervalSince1970),
            order.expiresAt.map { Int($0.timeIntervalSince1970) },
            order.completedAt.map { Int($0.timeIntervalSince1970) },
            order.cancelledAt.map { Int($0.timeIntervalSince1970) },
            order.contactInfo,
            order.location
        )
    }

    private func updateOrderInDB(_ order: MarketplaceOrder) async throws {
        let metadataJson = order.metadata.map { try? JSONSerialization.data(withJSONObject: $0) }
            .flatMap { String(data: $0, encoding: .utf8) }

        try database.execute("""
            UPDATE marketplace_orders SET
                order_type = ?, asset_id = ?, asset_type = ?, asset_name = ?,
                title = ?, description = ?, price_asset_id = ?, price = ?,
                total_price = ?, currency = ?, quantity = ?, status = ?,
                buyer_did = ?, metadata = ?, updated_at = ?, expires_at = ?,
                completed_at = ?, cancelled_at = ?, contact_info = ?, location = ?
            WHERE id = ?
        """,
            order.type.rawValue,
            order.assetId,
            order.assetType,
            order.assetName,
            order.title,
            order.description,
            order.priceAssetId,
            order.price,
            order.totalPrice,
            order.currency,
            order.quantity,
            order.status.rawValue,
            order.buyerDid,
            metadataJson,
            Int(order.updatedAt.timeIntervalSince1970),
            order.expiresAt.map { Int($0.timeIntervalSince1970) },
            order.completedAt.map { Int($0.timeIntervalSince1970) },
            order.cancelledAt.map { Int($0.timeIntervalSince1970) },
            order.contactInfo,
            order.location,
            order.id
        )
    }

    private func saveTransaction(_ transaction: MarketplaceTransaction) async throws {
        try database.execute("""
            INSERT INTO marketplace_transactions (
                id, order_id, buyer_did, seller_did, asset_id, payment_asset_id,
                payment_amount, quantity, status, escrow_id, created_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            transaction.id,
            transaction.orderId,
            transaction.buyerDid,
            transaction.sellerDid,
            transaction.assetId,
            transaction.paymentAssetId,
            transaction.paymentAmount,
            transaction.quantity,
            transaction.status.rawValue,
            transaction.escrowId,
            Int(transaction.createdAt.timeIntervalSince1970),
            transaction.completedAt.map { Int($0.timeIntervalSince1970) }
        )
    }

    private func updateTransactionInDB(_ transaction: MarketplaceTransaction) async throws {
        try database.execute("""
            UPDATE marketplace_transactions SET
                status = ?, escrow_id = ?, completed_at = ?
            WHERE id = ?
        """,
            transaction.status.rawValue,
            transaction.escrowId,
            transaction.completedAt.map { Int($0.timeIntervalSince1970) },
            transaction.id
        )
    }

    private func parseOrderRow(_ row: [String: Any]) -> MarketplaceOrder? {
        guard
            let id = row["id"] as? String,
            let typeRaw = row["order_type"] as? String,
            let type = MarketplaceOrderType(rawValue: typeRaw),
            let creatorDid = row["creator_did"] as? String,
            let assetType = row["asset_type"] as? String,
            let title = row["title"] as? String,
            let statusRaw = row["status"] as? String,
            let status = MarketplaceOrderStatus(rawValue: statusRaw),
            let createdAt = row["created_at"] as? Int,
            let updatedAt = row["updated_at"] as? Int
        else {
            return nil
        }

        var metadata: [String: String]?
        if let metadataJson = row["metadata"] as? String,
           let data = metadataJson.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            metadata = parsed
        }

        return MarketplaceOrder(
            id: id,
            type: type,
            creatorDid: creatorDid,
            assetId: row["asset_id"] as? String,
            assetType: assetType,
            assetName: row["asset_name"] as? String,
            title: title,
            description: row["description"] as? String,
            priceAssetId: row["price_asset_id"] as? String,
            price: row["price"] as? Double,
            totalPrice: row["total_price"] as? Double,
            currency: row["currency"] as? String,
            quantity: row["quantity"] as? Double,
            status: status,
            buyerDid: row["buyer_did"] as? String,
            metadata: metadata,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAt)),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAt)),
            expiresAt: (row["expires_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) },
            completedAt: (row["completed_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) },
            cancelledAt: (row["cancelled_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) },
            contactInfo: row["contact_info"] as? String,
            location: row["location"] as? String
        )
    }

    private func parseTransactionRow(_ row: [String: Any]) -> MarketplaceTransaction? {
        guard
            let id = row["id"] as? String,
            let orderId = row["order_id"] as? String,
            let buyerDid = row["buyer_did"] as? String,
            let sellerDid = row["seller_did"] as? String,
            let paymentAmount = row["payment_amount"] as? Double,
            let quantity = row["quantity"] as? Double,
            let statusRaw = row["status"] as? String,
            let status = MarketplaceTransactionStatus(rawValue: statusRaw),
            let createdAt = row["created_at"] as? Int
        else {
            return nil
        }

        return MarketplaceTransaction(
            id: id,
            orderId: orderId,
            buyerDid: buyerDid,
            sellerDid: sellerDid,
            assetId: row["asset_id"] as? String,
            paymentAssetId: row["payment_asset_id"] as? String,
            paymentAmount: paymentAmount,
            quantity: quantity,
            status: status,
            escrowId: row["escrow_id"] as? String,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAt)),
            completedAt: (row["completed_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }
        )
    }

    /// 清理资源
    public func cleanup() {
        orders.removeAll()
        transactions.removeAll()
        initialized = false
        Logger.shared.info("[GeneralOrderManager] 资源已清理")
    }
}

// MARK: - Errors

public enum GeneralOrderError: Error, LocalizedError {
    case notLoggedIn
    case orderNotFound
    case transactionNotFound
    case notOrderOwner
    case notBuyer
    case notSeller
    case orderNotEditable
    case orderNotAvailable
    case cannotCancelOrder
    case cannotBuyOwnOrder
    case quantityExceeded
    case invalidTitle
    case invalidPrice
    case invalidQuantity
    case invalidTransactionStatus
    case cannotRequestRefund

    public var errorDescription: String? {
        switch self {
        case .notLoggedIn:
            return "未登录"
        case .orderNotFound:
            return "订单不存在"
        case .transactionNotFound:
            return "交易不存在"
        case .notOrderOwner:
            return "只有订单创建者才能执行此操作"
        case .notBuyer:
            return "只有买家才能执行此操作"
        case .notSeller:
            return "只有卖家才能执行此操作"
        case .orderNotEditable:
            return "只能编辑开放状态的订单"
        case .orderNotAvailable:
            return "订单不可用"
        case .cannotCancelOrder:
            return "只能取消开放状态的订单"
        case .cannotBuyOwnOrder:
            return "不能购买自己的订单"
        case .quantityExceeded:
            return "购买数量超过订单数量"
        case .invalidTitle:
            return "订单标题不能为空"
        case .invalidPrice:
            return "价格必须大于0"
        case .invalidQuantity:
            return "数量必须大于0"
        case .invalidTransactionStatus:
            return "交易状态不正确"
        case .cannotRequestRefund:
            return "当前状态无法申请退款"
        }
    }
}
