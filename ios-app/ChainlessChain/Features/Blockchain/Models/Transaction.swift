import Foundation

/// 交易状态
enum TransactionStatus: String, Codable {
    case pending        // 待处理
    case confirming     // 确认中
    case confirmed      // 已确认
    case failed         // 失败
    case replaced       // 被替换（加速/取消）
    case dropped        // 被丢弃

    var displayName: String {
        switch self {
        case .pending: return "待确认"
        case .confirming: return "确认中"
        case .confirmed: return "已确认"
        case .failed: return "失败"
        case .replaced: return "已替换"
        case .dropped: return "已丢弃"
        }
    }

    var isCompleted: Bool {
        return self == .confirmed || self == .failed || self == .replaced || self == .dropped
    }
}

/// 交易类型
enum TransactionType: String, Codable {
    case send           // 发送
    case receive        // 接收
    case contract       // 合约调用
    case tokenTransfer  // 代币转账
    case nftTransfer    // NFT转移
    case nftMint        // NFT铸造
    case escrowCreate   // 创建托管
    case escrowRelease  // 释放托管
    case approve        // 授权

    var displayName: String {
        switch self {
        case .send: return "转账"
        case .receive: return "接收"
        case .contract: return "合约调用"
        case .tokenTransfer: return "代币转账"
        case .nftTransfer: return "NFT转移"
        case .nftMint: return "NFT铸造"
        case .escrowCreate: return "创建托管"
        case .escrowRelease: return "释放托管"
        case .approve: return "授权"
        }
    }
}

/// 交易模型
struct BlockchainTransaction: Identifiable, Codable {
    let id: String
    let hash: String
    let from: String
    let to: String
    let value: String           // Wei
    let gasPrice: String        // Wei
    let gasLimit: String
    let data: String?
    let nonce: Int
    let chainId: Int
    let status: TransactionStatus
    let type: TransactionType
    let blockNumber: Int?
    let timestamp: Date
    let confirmations: Int

    /// 格式化交易值
    var formattedValue: String {
        guard let valueDecimal = Decimal(string: value) else { return "0.0" }
        let divisor = pow(Decimal(10), 18)  // ETH默认18位小数
        let result = valueDecimal / divisor
        return String(describing: result)
    }

    /// 格式化Gas价格（Gwei）
    var formattedGasPrice: String {
        guard let gasDecimal = Decimal(string: gasPrice) else { return "0.0" }
        let divisor = pow(Decimal(10), 9)  // 1 Gwei = 10^9 Wei
        let result = gasDecimal / divisor
        return String(describing: result)
    }

    /// 交易费用（Gas * GasPrice）
    var transactionFee: String {
        guard let gasLimitDecimal = Decimal(string: gasLimit),
              let gasPriceDecimal = Decimal(string: gasPrice) else {
            return "0.0"
        }
        let feeInWei = gasLimitDecimal * gasPriceDecimal
        let divisor = pow(Decimal(10), 18)
        let feeInEth = feeInWei / divisor
        return String(describing: feeInEth)
    }

    /// 是否已确认
    var isConfirmed: Bool {
        status == .confirmed && confirmations >= 12
    }

    /// 获取浏览器链接
    func explorerUrl(for chain: SupportedChain) -> String? {
        let config = NetworkConfig.config(for: chain)
        return config.explorerUrl(for: hash)
    }
}

/// 交易请求
struct TransactionRequest {
    let from: String
    let to: String
    let value: String           // Wei
    let data: String?
    let gasLimit: String?
    let gasPrice: String?
    let nonce: Int?
}

/// Gas估算结果
struct GasEstimate {
    let gasLimit: String
    let gasPrice: GasPriceEstimate
    let estimatedCost: String    // Wei

    /// 格式化估算成本（ETH）
    var formattedCost: String {
        guard let costDecimal = Decimal(string: estimatedCost) else { return "0.0" }
        let divisor = pow(Decimal(10), 18)
        let result = costDecimal / divisor
        return String(describing: result)
    }
}

/// Gas价格估算
struct GasPriceEstimate {
    let slow: String        // Gwei
    let standard: String    // Gwei
    let fast: String        // Gwei

    /// 转换为Wei
    func toWei(speed: GasSpeed) -> String {
        let gwei: String
        switch speed {
        case .slow: gwei = slow
        case .standard: gwei = standard
        case .fast: gwei = fast
        }

        guard let gweiDecimal = Decimal(string: gwei) else { return "0" }
        let multiplier = pow(Decimal(10), 9)  // 1 Gwei = 10^9 Wei
        let weiDecimal = gweiDecimal * multiplier
        return String(describing: weiDecimal)
    }
}

/// Gas速度
enum GasSpeed {
    case slow
    case standard
    case fast
}

// MARK: - Phase 1.4: 交易系统扩展

/// 交易收据
struct TransactionReceipt: Codable {
    let transactionHash: String
    let transactionIndex: String
    let blockHash: String
    let blockNumber: String
    let from: String
    let to: String?
    let gasUsed: String
    let cumulativeGasUsed: String
    let contractAddress: String?
    let logs: [TransactionLog]
    let status: String

    var isSuccess: Bool {
        return status == "1" || status == "0x1"
    }
}

/// 交易日志
struct TransactionLog: Codable {
    let logIndex: String
    let transactionHash: String
    let transactionIndex: String
    let blockHash: String
    let blockNumber: String
    let address: String
    let data: String
    let topics: [String]
}

/// 交易历史记录（扩展版）
struct TransactionRecord: Identifiable, Codable {
    let id: String
    var hash: String?
    let walletId: String
    let chainId: Int
    let type: TransactionType
    var status: TransactionStatus
    let from: String
    let to: String
    let value: String
    let data: String?
    let nonce: String
    let gasLimit: String
    let gasPrice: String
    var gasUsed: String?
    var fee: String?
    var blockNumber: String?
    var blockHash: String?
    var confirmations: Int
    var errorMessage: String?
    var contractAddress: String?
    let createdAt: Date
    var updatedAt: Date
    var confirmedAt: Date?

    var isCompleted: Bool {
        return status.isCompleted
    }

    var feeDisplay: String {
        guard let fee = fee else { return "0" }
        return WeiConverter.weiToEther(fee)
    }

    var valueDisplay: String {
        return WeiConverter.weiToEther(value)
    }
}

/// Wei转换工具
struct WeiConverter {
    /// Wei转Ether
    static func weiToEther(_ wei: String) -> String {
        guard let weiValue = Decimal(string: wei) else {
            return "0"
        }
        let etherValue = weiValue / Decimal(sign: .plus, exponent: 18, significand: 1)
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 8
        return formatter.string(from: etherValue as NSDecimalNumber) ?? "0"
    }

    /// Ether转Wei
    static func etherToWei(_ ether: String) -> String {
        guard let etherValue = Decimal(string: ether) else {
            return "0"
        }
        let weiValue = etherValue * Decimal(sign: .plus, exponent: 18, significand: 1)
        return "\(weiValue)"
    }

    /// Gwei转Wei
    static func gweiToWei(_ gwei: String) -> String {
        guard let gweiValue = Decimal(string: gwei) else {
            return "0"
        }
        let weiValue = gweiValue * Decimal(sign: .plus, exponent: 9, significand: 1)
        return "\(weiValue)"
    }

    /// Wei转Gwei
    static func weiToGwei(_ wei: String) -> String {
        guard let weiValue = Decimal(string: wei) else {
            return "0"
        }
        let gweiValue = weiValue / Decimal(sign: .plus, exponent: 9, significand: 1)
        return "\(gweiValue)"
    }
}
