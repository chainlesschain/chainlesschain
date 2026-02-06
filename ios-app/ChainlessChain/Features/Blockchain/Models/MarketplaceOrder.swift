import Foundation

/// 订单类型
public enum MarketplaceOrderType: String, Codable, CaseIterable {
    case buy = "buy"           // 求购
    case sell = "sell"         // 出售
    case service = "service"   // 服务
    case barter = "barter"     // 以物换物

    public var displayName: String {
        switch self {
        case .buy: return "求购"
        case .sell: return "出售"
        case .service: return "服务"
        case .barter: return "以物换物"
        }
    }
}

/// 订单状态
public enum MarketplaceOrderStatus: String, Codable, CaseIterable {
    case open = "open"             // 开放
    case matched = "matched"       // 已匹配
    case escrow = "escrow"         // 托管中
    case completed = "completed"   // 已完成
    case cancelled = "cancelled"   // 已取消
    case disputed = "disputed"     // 有争议
    case expired = "expired"       // 已过期

    public var displayName: String {
        switch self {
        case .open: return "开放中"
        case .matched: return "已匹配"
        case .escrow: return "托管中"
        case .completed: return "已完成"
        case .cancelled: return "已取消"
        case .disputed: return "争议中"
        case .expired: return "已过期"
        }
    }

    public var isActive: Bool {
        return self == .open || self == .matched || self == .escrow
    }

    public var isFinal: Bool {
        return self == .completed || self == .cancelled || self == .expired
    }
}

/// 交易状态
public enum MarketplaceTransactionStatus: String, Codable, CaseIterable {
    case pending = "pending"       // 待处理
    case escrowed = "escrowed"     // 已托管
    case delivered = "delivered"   // 已交付
    case completed = "completed"   // 已完成
    case refunded = "refunded"     // 已退款
    case disputed = "disputed"     // 有争议

    public var displayName: String {
        switch self {
        case .pending: return "待处理"
        case .escrowed: return "已托管"
        case .delivered: return "已交付"
        case .completed: return "已完成"
        case .refunded: return "已退款"
        case .disputed: return "争议中"
        }
    }
}

/// 市场订单
public struct MarketplaceOrder: Identifiable, Codable {
    public let id: String
    public var type: MarketplaceOrderType
    public let creatorDid: String
    public var assetId: String?
    public var assetType: String
    public var assetName: String?
    public var title: String
    public var description: String?
    public var priceAssetId: String?
    public var price: Double?
    public var totalPrice: Double?
    public var currency: String?
    public var quantity: Double?
    public var status: MarketplaceOrderStatus
    public var buyerDid: String?
    public var metadata: [String: String]?
    public let createdAt: Date
    public var updatedAt: Date
    public var expiresAt: Date?
    public var completedAt: Date?
    public var cancelledAt: Date?

    // 联系信息
    public var contactInfo: String?
    public var location: String?

    public init(
        id: String = UUID().uuidString,
        type: MarketplaceOrderType,
        creatorDid: String,
        assetId: String? = nil,
        assetType: String,
        assetName: String? = nil,
        title: String,
        description: String? = nil,
        priceAssetId: String? = nil,
        price: Double? = nil,
        totalPrice: Double? = nil,
        currency: String? = "CNY",
        quantity: Double? = nil,
        status: MarketplaceOrderStatus = .open,
        buyerDid: String? = nil,
        metadata: [String: String]? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        expiresAt: Date? = nil,
        completedAt: Date? = nil,
        cancelledAt: Date? = nil,
        contactInfo: String? = nil,
        location: String? = nil
    ) {
        self.id = id
        self.type = type
        self.creatorDid = creatorDid
        self.assetId = assetId
        self.assetType = assetType
        self.assetName = assetName
        self.title = title
        self.description = description
        self.priceAssetId = priceAssetId
        self.price = price
        self.totalPrice = totalPrice
        self.currency = currency
        self.quantity = quantity
        self.status = status
        self.buyerDid = buyerDid
        self.metadata = metadata
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.expiresAt = expiresAt
        self.completedAt = completedAt
        self.cancelledAt = cancelledAt
        self.contactInfo = contactInfo
        self.location = location
    }

    /// 是否可以取消
    public func canCancel(by did: String) -> Bool {
        return creatorDid == did && status == .open
    }

    /// 是否可以购买
    public func canBuy(by did: String) -> Bool {
        return creatorDid != did && status == .open && !isExpired
    }

    /// 是否已过期
    public var isExpired: Bool {
        guard let expiresAt = expiresAt else { return false }
        return expiresAt < Date()
    }
}

/// 市场交易
public struct MarketplaceTransaction: Identifiable, Codable {
    public let id: String
    public let orderId: String
    public let buyerDid: String
    public let sellerDid: String
    public var assetId: String?
    public let paymentAssetId: String?
    public let paymentAmount: Double
    public let quantity: Double
    public var status: MarketplaceTransactionStatus
    public var escrowId: String?
    public let createdAt: Date
    public var completedAt: Date?

    public init(
        id: String = UUID().uuidString,
        orderId: String,
        buyerDid: String,
        sellerDid: String,
        assetId: String? = nil,
        paymentAssetId: String? = nil,
        paymentAmount: Double,
        quantity: Double,
        status: MarketplaceTransactionStatus = .pending,
        escrowId: String? = nil,
        createdAt: Date = Date(),
        completedAt: Date? = nil
    ) {
        self.id = id
        self.orderId = orderId
        self.buyerDid = buyerDid
        self.sellerDid = sellerDid
        self.assetId = assetId
        self.paymentAssetId = paymentAssetId
        self.paymentAmount = paymentAmount
        self.quantity = quantity
        self.status = status
        self.escrowId = escrowId
        self.createdAt = createdAt
        self.completedAt = completedAt
    }

    /// 是否可以确认交付（买家操作）
    public func canConfirmDelivery(by did: String) -> Bool {
        return buyerDid == did && (status == .escrowed || status == .delivered)
    }

    /// 是否可以申请退款（买家操作）
    public func canRequestRefund(by did: String) -> Bool {
        return buyerDid == did && status == .escrowed
    }
}

/// 订单筛选器
public struct MarketplaceOrderFilter {
    public var type: MarketplaceOrderType?
    public var status: MarketplaceOrderStatus?
    public var creatorDid: String?
    public var assetId: String?
    public var search: String?
    public var priceMin: Double?
    public var priceMax: Double?
    public var createdAfter: Date?
    public var createdBefore: Date?
    public var sortBy: SortField = .createdAt
    public var sortOrder: SortOrder = .descending
    public var page: Int = 1
    public var pageSize: Int = 20

    public enum SortField: String {
        case createdAt = "created_at"
        case price = "price_amount"
        case quantity = "quantity"
        case updatedAt = "updated_at"
    }

    public enum SortOrder: String {
        case ascending = "ASC"
        case descending = "DESC"
    }

    public init() {}

    public var offset: Int {
        return (page - 1) * pageSize
    }
}

/// 分页结果
public struct PaginatedOrders {
    public let items: [MarketplaceOrder]
    public let total: Int
    public let page: Int
    public let pageSize: Int
    public var totalPages: Int {
        return (total + pageSize - 1) / pageSize
    }
    public var hasNextPage: Bool {
        return page < totalPages
    }
    public var hasPreviousPage: Bool {
        return page > 1
    }
}

/// 搜索建议
public struct OrderSearchSuggestion {
    public let suggestion: String
    public let source: String
    public var value: String?
}
