import Foundation

/// 桥接状态
public enum BridgeStatus: String, Codable {
    case pending = "pending"           // 待处理
    case locking = "locking"           // 锁定中
    case locked = "locked"             // 已锁定
    case minting = "minting"           // 铸造中
    case completed = "completed"       // 已完成
    case failed = "failed"             // 失败
    case cancelled = "cancelled"       // 已取消

    var displayName: String {
        switch self {
        case .pending: return "待处理"
        case .locking: return "锁定中"
        case .locked: return "已锁定"
        case .minting: return "铸造中"
        case .completed: return "已完成"
        case .failed: return "失败"
        case .cancelled: return "已取消"
        }
    }

    var isCompleted: Bool {
        return self == .completed || self == .failed || self == .cancelled
    }
}

/// 桥接类型
public enum BridgeType: String, Codable {
    case lockMint = "lock_mint"        // 锁定-铸造（原生资产到目标链）
    case burnRelease = "burn_release"  // 销毁-释放（桥接资产回源链）

    var displayName: String {
        switch self {
        case .lockMint: return "锁定-铸造"
        case .burnRelease: return "销毁-释放"
        }
    }
}

/// 桥接协议
public enum BridgeProtocol: String, Codable {
    case native = "native"             // 自有桥接合约
    case layerZero = "layerzero"       // LayerZero协议
    case wormhole = "wormhole"         // Wormhole协议
    case ccip = "ccip"                 // Chainlink CCIP

    var displayName: String {
        switch self {
        case .native: return "Native Bridge"
        case .layerZero: return "LayerZero"
        case .wormhole: return "Wormhole"
        case .ccip: return "Chainlink CCIP"
        }
    }
}

/// 桥接记录
public struct BridgeRecord: Identifiable, Codable {
    public let id: String
    public let fromChainId: Int
    public let toChainId: Int
    public var fromTxHash: String?
    public var toTxHash: String?
    public let assetId: String?
    public let assetAddress: String
    public let amount: String
    public let senderAddress: String
    public let recipientAddress: String
    public var status: BridgeStatus
    public let bridgeType: BridgeType
    public let protocol: BridgeProtocol
    public var lockTimestamp: Date?
    public var mintTimestamp: Date?
    public let createdAt: Date
    public var completedAt: Date?
    public var errorMessage: String?
    public var requestId: String?           // 链上桥接请求ID
    public var estimatedFee: String?
    public var actualFee: String?

    public init(
        id: String = UUID().uuidString,
        fromChainId: Int,
        toChainId: Int,
        fromTxHash: String? = nil,
        toTxHash: String? = nil,
        assetId: String? = nil,
        assetAddress: String,
        amount: String,
        senderAddress: String,
        recipientAddress: String,
        status: BridgeStatus = .pending,
        bridgeType: BridgeType = .lockMint,
        protocol: BridgeProtocol = .native,
        lockTimestamp: Date? = nil,
        mintTimestamp: Date? = nil,
        createdAt: Date = Date(),
        completedAt: Date? = nil,
        errorMessage: String? = nil,
        requestId: String? = nil,
        estimatedFee: String? = nil,
        actualFee: String? = nil
    ) {
        self.id = id
        self.fromChainId = fromChainId
        self.toChainId = toChainId
        self.fromTxHash = fromTxHash
        self.toTxHash = toTxHash
        self.assetId = assetId
        self.assetAddress = assetAddress
        self.amount = amount
        self.senderAddress = senderAddress
        self.recipientAddress = recipientAddress
        self.status = status
        self.bridgeType = bridgeType
        self.protocol = protocol
        self.lockTimestamp = lockTimestamp
        self.mintTimestamp = mintTimestamp
        self.createdAt = createdAt
        self.completedAt = completedAt
        self.errorMessage = errorMessage
        self.requestId = requestId
        self.estimatedFee = estimatedFee
        self.actualFee = actualFee
    }

    /// 格式化金额显示
    public var amountDisplay: String {
        return WeiConverter.weiToEther(amount)
    }

    /// 格式化费用显示
    public var feeDisplay: String? {
        guard let fee = actualFee ?? estimatedFee else { return nil }
        return WeiConverter.weiToEther(fee)
    }

    /// 获取源链名称
    public var fromChainName: String {
        return SupportedChain.allCases.first { $0.chainId == fromChainId }?.name ?? "Unknown"
    }

    /// 获取目标链名称
    public var toChainName: String {
        return SupportedChain.allCases.first { $0.chainId == toChainId }?.name ?? "Unknown"
    }
}

/// 桥接请求（链上数据结构）
public struct BridgeRequest: Codable {
    public let requestId: String        // bytes32
    public let user: String
    public let token: String
    public let amount: String
    public let targetChainId: Int
    public let sourceChainId: Int
    public let status: BridgeStatus
    public let createdAt: Date
    public var completedAt: Date?

    public init(
        requestId: String,
        user: String,
        token: String,
        amount: String,
        targetChainId: Int,
        sourceChainId: Int,
        status: BridgeStatus,
        createdAt: Date,
        completedAt: Date? = nil
    ) {
        self.requestId = requestId
        self.user = user
        self.token = token
        self.amount = amount
        self.targetChainId = targetChainId
        self.sourceChainId = sourceChainId
        self.status = status
        self.createdAt = createdAt
        self.completedAt = completedAt
    }
}

/// 桥接配置
public struct BridgeConfig: Codable {
    public let bridgeAddress: String
    public let chainId: Int
    public let isRelayer: Bool
    public let minAmount: String
    public let maxAmount: String
    public let feePercent: Decimal
    public let estimatedTime: TimeInterval  // seconds

    public init(
        bridgeAddress: String,
        chainId: Int,
        isRelayer: Bool = false,
        minAmount: String = "0",
        maxAmount: String = "0",
        feePercent: Decimal = 0.001,
        estimatedTime: TimeInterval = 300
    ) {
        self.bridgeAddress = bridgeAddress
        self.chainId = chainId
        self.isRelayer = isRelayer
        self.minAmount = minAmount
        self.maxAmount = maxAmount
        self.feePercent = feePercent
        self.estimatedTime = estimatedTime
    }
}

/// 桥接费用估算
public struct BridgeFeeEstimate: Codable {
    public let sourceTxFee: String      // 源链交易费用（Wei）
    public let targetTxFee: String      // 目标链交易费用（Wei）
    public let bridgeFee: String        // 桥接费用（Wei）
    public let totalFee: String         // 总费用（Wei）
    public let estimatedTime: TimeInterval

    public init(
        sourceTxFee: String,
        targetTxFee: String,
        bridgeFee: String,
        totalFee: String,
        estimatedTime: TimeInterval
    ) {
        self.sourceTxFee = sourceTxFee
        self.targetTxFee = targetTxFee
        self.bridgeFee = bridgeFee
        self.totalFee = totalFee
        self.estimatedTime = estimatedTime
    }

    /// 格式化总费用显示
    public var totalFeeDisplay: String {
        return WeiConverter.weiToEther(totalFee)
    }

    /// 格式化预计时间
    public var estimatedTimeDisplay: String {
        let minutes = Int(estimatedTime / 60)
        if minutes < 1 {
            return "< 1分钟"
        } else if minutes < 60 {
            return "\(minutes)分钟"
        } else {
            let hours = minutes / 60
            return "\(hours)小时"
        }
    }
}

/// 桥接事件（链上事件）
public struct BridgeEvent: Codable {
    public let eventType: BridgeEventType
    public let requestId: String
    public let user: String
    public let token: String
    public let amount: String
    public let chainId: Int
    public let targetChainId: Int?
    public let sourceChainId: Int?
    public let transactionHash: String
    public let blockNumber: String
    public let timestamp: Date

    public init(
        eventType: BridgeEventType,
        requestId: String,
        user: String,
        token: String,
        amount: String,
        chainId: Int,
        targetChainId: Int? = nil,
        sourceChainId: Int? = nil,
        transactionHash: String,
        blockNumber: String,
        timestamp: Date
    ) {
        self.eventType = eventType
        self.requestId = requestId
        self.user = user
        self.token = token
        self.amount = amount
        self.chainId = chainId
        self.targetChainId = targetChainId
        self.sourceChainId = sourceChainId
        self.transactionHash = transactionHash
        self.blockNumber = blockNumber
        self.timestamp = timestamp
    }
}

/// 桥接事件类型
public enum BridgeEventType: String, Codable {
    case assetLocked = "AssetLocked"
    case assetMinted = "AssetMinted"
    case assetBurned = "AssetBurned"
    case assetReleased = "AssetReleased"
    case relayerAdded = "RelayerAdded"
    case relayerRemoved = "RelayerRemoved"

    var displayName: String {
        switch self {
        case .assetLocked: return "资产已锁定"
        case .assetMinted: return "资产已铸造"
        case .assetBurned: return "资产已销毁"
        case .assetReleased: return "资产已释放"
        case .relayerAdded: return "中继者已添加"
        case .relayerRemoved: return "中继者已移除"
        }
    }
}

/// 支持的桥接路线
public struct BridgeRoute: Codable, Hashable {
    public let fromChainId: Int
    public let toChainId: Int
    public let protocol: BridgeProtocol
    public let isActive: Bool

    public init(
        fromChainId: Int,
        toChainId: Int,
        protocol: BridgeProtocol = .native,
        isActive: Bool = true
    ) {
        self.fromChainId = fromChainId
        self.toChainId = toChainId
        self.protocol = protocol
        self.isActive = isActive
    }

    public var routeName: String {
        let fromChain = SupportedChain.allCases.first { $0.chainId == fromChainId }?.name ?? "Unknown"
        let toChain = SupportedChain.allCases.first { $0.chainId == toChainId }?.name ?? "Unknown"
        return "\(fromChain) → \(toChain)"
    }
}

// MARK: - Error Types

public enum BridgeError: Error, LocalizedError {
    case bridgeNotDeployed
    case invalidAmount
    case sameChain
    case unsupportedRoute
    case insufficientLiquidity
    case lockFailed
    case mintFailed
    case burnFailed
    case releaseFailed
    case requestNotFound
    case alreadyCompleted
    case securityCheckFailed(String)
    case networkError(String)

    public var errorDescription: String? {
        switch self {
        case .bridgeNotDeployed:
            return "桥接合约未部署"
        case .invalidAmount:
            return "无效的转移金额"
        case .sameChain:
            return "源链和目标链不能相同"
        case .unsupportedRoute:
            return "不支持的桥接路线"
        case .insufficientLiquidity:
            return "桥接合约流动性不足"
        case .lockFailed:
            return "锁定资产失败"
        case .mintFailed:
            return "铸造资产失败"
        case .burnFailed:
            return "销毁资产失败"
        case .releaseFailed:
            return "释放资产失败"
        case .requestNotFound:
            return "桥接请求未找到"
        case .alreadyCompleted:
            return "桥接请求已完成"
        case .securityCheckFailed(let reason):
            return "安全检查失败: \(reason)"
        case .networkError(let message):
            return "网络错误: \(message)"
        }
    }
}
