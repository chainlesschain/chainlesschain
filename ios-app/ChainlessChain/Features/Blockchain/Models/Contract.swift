import Foundation

/// 智能合约模型
public struct SmartContract: Codable, Identifiable {
    /// 合约ID
    public let id: String

    /// 合约名称
    public let name: String

    /// 合约类型
    public let type: ContractType

    /// 合约地址（按链ID索引）
    public var addresses: [Int: String]

    /// 合约ABI（JSON字符串）
    public let abi: String

    /// Bytecode（用于部署）
    public let bytecode: String?

    /// 部署状态
    public var deploymentStatus: DeploymentStatus

    /// 创建时间
    public let createdAt: Date

    /// 更新时间
    public var updatedAt: Date

    /// 合约描述
    public let description: String?

    public init(
        id: String = UUID().uuidString,
        name: String,
        type: ContractType,
        addresses: [Int: String] = [:],
        abi: String,
        bytecode: String? = nil,
        deploymentStatus: DeploymentStatus = .notDeployed,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        description: String? = nil
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.addresses = addresses
        self.abi = abi
        self.bytecode = bytecode
        self.deploymentStatus = deploymentStatus
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.description = description
    }

    /// 获取指定链的合约地址
    public func getAddress(for chainId: Int) -> String? {
        return addresses[chainId]
    }

    /// 设置合约地址
    public mutating func setAddress(_ address: String, for chainId: Int) {
        addresses[chainId] = address
        updatedAt = Date()
    }
}

/// 合约类型
public enum ContractType: String, Codable, CaseIterable {
    case erc20 = "ERC20"
    case erc721 = "ERC721"
    case erc1155 = "ERC1155"
    case escrow = "Escrow"
    case marketplace = "Marketplace"
    case subscription = "Subscription"
    case bounty = "Bounty"
    case bridge = "Bridge"
    case custom = "Custom"

    var displayName: String {
        switch self {
        case .erc20: return "ERC-20代币"
        case .erc721: return "ERC-721 NFT"
        case .erc1155: return "ERC-1155多代币"
        case .escrow: return "托管合约"
        case .marketplace: return "市场合约"
        case .subscription: return "订阅合约"
        case .bounty: return "悬赏合约"
        case .bridge: return "跨链桥"
        case .custom: return "自定义合约"
        }
    }
}

/// 部署状态
public enum DeploymentStatus: String, Codable {
    case notDeployed = "not_deployed"
    case deploying = "deploying"
    case deployed = "deployed"
    case failed = "failed"

    var displayName: String {
        switch self {
        case .notDeployed: return "未部署"
        case .deploying: return "部署中"
        case .deployed: return "已部署"
        case .failed: return "部署失败"
        }
    }
}

/// 合约函数调用参数
public struct ContractFunctionCall: Codable {
    /// 合约地址
    public let contractAddress: String

    /// 函数名称
    public let functionName: String

    /// 函数参数
    public let parameters: [FunctionParameter]

    /// 发送的原生币金额（Wei）
    public let value: String?

    /// Gas限制
    public let gasLimit: String?

    /// Gas价格（Wei）
    public let gasPrice: String?

    public init(
        contractAddress: String,
        functionName: String,
        parameters: [FunctionParameter] = [],
        value: String? = nil,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) {
        self.contractAddress = contractAddress
        self.functionName = functionName
        self.parameters = parameters
        self.value = value
        self.gasLimit = gasLimit
        self.gasPrice = gasPrice
    }
}

/// 函数参数
public struct FunctionParameter: Codable {
    /// 参数名称
    public let name: String

    /// 参数类型（Solidity类型）
    public let type: String

    /// 参数值（JSON编码）
    public let value: String

    public init(name: String, type: String, value: String) {
        self.name = name
        self.type = type
        self.value = value
    }
}

/// 合约事件
public struct ContractEvent: Codable {
    /// 事件名称
    public let name: String

    /// 事件签名（topic0）
    public let signature: String

    /// 合约地址
    public let address: String

    /// 交易哈希
    public let transactionHash: String

    /// 区块号
    public let blockNumber: String

    /// 事件参数
    public let parameters: [EventParameter]

    /// 时间戳
    public let timestamp: Date

    public init(
        name: String,
        signature: String,
        address: String,
        transactionHash: String,
        blockNumber: String,
        parameters: [EventParameter] = [],
        timestamp: Date = Date()
    ) {
        self.name = name
        self.signature = signature
        self.address = address
        self.transactionHash = transactionHash
        self.blockNumber = blockNumber
        self.parameters = parameters
        self.timestamp = timestamp
    }
}

/// 事件参数
public struct EventParameter: Codable {
    /// 参数名称
    public let name: String

    /// 参数类型
    public let type: String

    /// 参数值
    public let value: String

    /// 是否indexed
    public let indexed: Bool

    public init(name: String, type: String, value: String, indexed: Bool = false) {
        self.name = name
        self.type = type
        self.value = value
        self.indexed = indexed
    }
}

/// 合约调用结果
public struct ContractCallResult: Codable {
    /// 是否成功
    public let success: Bool

    /// 返回值
    public let returnValue: String?

    /// 交易哈希（如果是交易）
    public let transactionHash: String?

    /// Gas消耗
    public let gasUsed: String?

    /// 错误信息
    public let error: String?

    /// 事件日志
    public let events: [ContractEvent]

    public init(
        success: Bool,
        returnValue: String? = nil,
        transactionHash: String? = nil,
        gasUsed: String? = nil,
        error: String? = nil,
        events: [ContractEvent] = []
    ) {
        self.success = success
        self.returnValue = returnValue
        self.transactionHash = transactionHash
        self.gasUsed = gasUsed
        self.error = error
        self.events = events
    }
}
