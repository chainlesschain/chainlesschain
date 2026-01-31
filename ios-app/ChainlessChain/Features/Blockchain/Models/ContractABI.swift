import Foundation

/// 合约ABI定义
/// 包含常用的ERC标准和ChainlessChain自定义合约的ABI
public struct ContractABI {

    // MARK: - ERC-20 Standard ABI

    /// ERC-20标准ABI
    public static let erc20ABI = """
    [
        {
            "constant": true,
            "inputs": [],
            "name": "name",
            "outputs": [{"name": "", "type": "string"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "symbol",
            "outputs": [{"name": "", "type": "string"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "decimals",
            "outputs": [{"name": "", "type": "uint8"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "totalSupply",
            "outputs": [{"name": "", "type": "uint256"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [{"name": "owner", "type": "address"}],
            "name": "balanceOf",
            "outputs": [{"name": "", "type": "uint256"}],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "to", "type": "address"},
                {"name": "amount", "type": "uint256"}
            ],
            "name": "transfer",
            "outputs": [{"name": "", "type": "bool"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {"name": "owner", "type": "address"},
                {"name": "spender", "type": "address"}
            ],
            "name": "allowance",
            "outputs": [{"name": "", "type": "uint256"}],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "spender", "type": "address"},
                {"name": "amount", "type": "uint256"}
            ],
            "name": "approve",
            "outputs": [{"name": "", "type": "bool"}],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "amount", "type": "uint256"}
            ],
            "name": "transferFrom",
            "outputs": [{"name": "", "type": "bool"}],
            "type": "function"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "from", "type": "address"},
                {"indexed": true, "name": "to", "type": "address"},
                {"name": "value", "type": "uint256"}
            ],
            "name": "Transfer",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "owner", "type": "address"},
                {"indexed": true, "name": "spender", "type": "address"},
                {"name": "value", "type": "uint256"}
            ],
            "name": "Approval",
            "type": "event"
        }
    ]
    """

    // MARK: - ERC-721 Standard ABI

    /// ERC-721标准ABI
    public static let erc721ABI = """
    [
        {
            "constant": true,
            "inputs": [],
            "name": "name",
            "outputs": [{"name": "", "type": "string"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "symbol",
            "outputs": [{"name": "", "type": "string"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [{"name": "tokenId", "type": "uint256"}],
            "name": "tokenURI",
            "outputs": [{"name": "", "type": "string"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [{"name": "owner", "type": "address"}],
            "name": "balanceOf",
            "outputs": [{"name": "", "type": "uint256"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [{"name": "tokenId", "type": "uint256"}],
            "name": "ownerOf",
            "outputs": [{"name": "", "type": "address"}],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "tokenId", "type": "uint256"}
            ],
            "name": "safeTransferFrom",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "tokenId", "type": "uint256"}
            ],
            "name": "transferFrom",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "to", "type": "address"},
                {"name": "tokenId", "type": "uint256"}
            ],
            "name": "approve",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [{"name": "tokenId", "type": "uint256"}],
            "name": "getApproved",
            "outputs": [{"name": "", "type": "address"}],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "operator", "type": "address"},
                {"name": "approved", "type": "bool"}
            ],
            "name": "setApprovalForAll",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {"name": "owner", "type": "address"},
                {"name": "operator", "type": "address"}
            ],
            "name": "isApprovedForAll",
            "outputs": [{"name": "", "type": "bool"}],
            "type": "function"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "from", "type": "address"},
                {"indexed": true, "name": "to", "type": "address"},
                {"indexed": true, "name": "tokenId", "type": "uint256"}
            ],
            "name": "Transfer",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "owner", "type": "address"},
                {"indexed": true, "name": "approved", "type": "address"},
                {"indexed": true, "name": "tokenId", "type": "uint256"}
            ],
            "name": "Approval",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "owner", "type": "address"},
                {"indexed": true, "name": "operator", "type": "address"},
                {"name": "approved", "type": "bool"}
            ],
            "name": "ApprovalForAll",
            "type": "event"
        }
    ]
    """

    // MARK: - ERC-1155 Standard ABI

    /// ERC-1155标准ABI
    public static let erc1155ABI = """
    [
        {
            "constant": true,
            "inputs": [{"name": "id", "type": "uint256"}],
            "name": "uri",
            "outputs": [{"name": "", "type": "string"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {"name": "account", "type": "address"},
                {"name": "id", "type": "uint256"}
            ],
            "name": "balanceOf",
            "outputs": [{"name": "", "type": "uint256"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {"name": "accounts", "type": "address[]"},
                {"name": "ids", "type": "uint256[]"}
            ],
            "name": "balanceOfBatch",
            "outputs": [{"name": "", "type": "uint256[]"}],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "operator", "type": "address"},
                {"name": "approved", "type": "bool"}
            ],
            "name": "setApprovalForAll",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {"name": "account", "type": "address"},
                {"name": "operator", "type": "address"}
            ],
            "name": "isApprovedForAll",
            "outputs": [{"name": "", "type": "bool"}],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "id", "type": "uint256"},
                {"name": "amount", "type": "uint256"},
                {"name": "data", "type": "bytes"}
            ],
            "name": "safeTransferFrom",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "ids", "type": "uint256[]"},
                {"name": "amounts", "type": "uint256[]"},
                {"name": "data", "type": "bytes"}
            ],
            "name": "safeBatchTransferFrom",
            "outputs": [],
            "type": "function"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "operator", "type": "address"},
                {"indexed": true, "name": "from", "type": "address"},
                {"indexed": true, "name": "to", "type": "address"},
                {"indexed": false, "name": "id", "type": "uint256"},
                {"indexed": false, "name": "value", "type": "uint256"}
            ],
            "name": "TransferSingle",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "operator", "type": "address"},
                {"indexed": true, "name": "from", "type": "address"},
                {"indexed": true, "name": "to", "type": "address"},
                {"indexed": false, "name": "ids", "type": "uint256[]"},
                {"indexed": false, "name": "values", "type": "uint256[]"}
            ],
            "name": "TransferBatch",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "account", "type": "address"},
                {"indexed": true, "name": "operator", "type": "address"},
                {"name": "approved", "type": "bool"}
            ],
            "name": "ApprovalForAll",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": false, "name": "value", "type": "string"},
                {"indexed": true, "name": "id", "type": "uint256"}
            ],
            "name": "URI",
            "type": "event"
        }
    ]
    """

    // MARK: - ChainlessNFT ABI

    /// ChainlessNFT合约ABI（扩展ERC-721）
    public static let chainlessNFTABI = """
    [
        {
            "constant": false,
            "inputs": [
                {"name": "to", "type": "address"},
                {"name": "uri", "type": "string"}
            ],
            "name": "mint",
            "outputs": [{"name": "", "type": "uint256"}],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "to", "type": "address"},
                {"name": "uris", "type": "string[]"}
            ],
            "name": "mintBatch",
            "outputs": [{"name": "", "type": "uint256[]"}],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [{"name": "tokenId", "type": "uint256"}],
            "name": "burn",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "nextTokenId",
            "outputs": [{"name": "", "type": "uint256"}],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [{"name": "owner", "type": "address"}],
            "name": "tokensOfOwner",
            "outputs": [{"name": "", "type": "uint256[]"}],
            "type": "function"
        }
    ]
    """

    // MARK: - EscrowContract ABI

    /// 托管合约ABI
    public static let escrowContractABI = """
    [
        {
            "constant": false,
            "inputs": [
                {"name": "escrowId", "type": "bytes32"},
                {"name": "seller", "type": "address"},
                {"name": "arbitrator", "type": "address"}
            ],
            "name": "createNativeEscrow",
            "outputs": [],
            "payable": true,
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "escrowId", "type": "bytes32"},
                {"name": "seller", "type": "address"},
                {"name": "arbitrator", "type": "address"},
                {"name": "tokenAddress", "type": "address"},
                {"name": "amount", "type": "uint256"}
            ],
            "name": "createERC20Escrow",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [{"name": "escrowId", "type": "bytes32"}],
            "name": "markAsDelivered",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [{"name": "escrowId", "type": "bytes32"}],
            "name": "release",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [{"name": "escrowId", "type": "bytes32"}],
            "name": "refund",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [{"name": "escrowId", "type": "bytes32"}],
            "name": "dispute",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [{"name": "escrowId", "type": "bytes32"}],
            "name": "resolveDisputeToSeller",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [{"name": "escrowId", "type": "bytes32"}],
            "name": "resolveDisputeToBuyer",
            "outputs": [],
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [{"name": "escrowId", "type": "bytes32"}],
            "name": "getEscrow",
            "outputs": [
                {
                    "name": "",
                    "type": "tuple",
                    "components": [
                        {"name": "id", "type": "bytes32"},
                        {"name": "buyer", "type": "address"},
                        {"name": "seller", "type": "address"},
                        {"name": "arbitrator", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                        {"name": "paymentType", "type": "uint8"},
                        {"name": "tokenAddress", "type": "address"},
                        {"name": "state", "type": "uint8"},
                        {"name": "createdAt", "type": "uint256"},
                        {"name": "completedAt", "type": "uint256"}
                    ]
                }
            ],
            "type": "function"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "escrowId", "type": "bytes32"},
                {"indexed": true, "name": "buyer", "type": "address"},
                {"indexed": true, "name": "seller", "type": "address"},
                {"name": "amount", "type": "uint256"},
                {"name": "paymentType", "type": "uint8"}
            ],
            "name": "EscrowCreated",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "escrowId", "type": "bytes32"},
                {"name": "amount", "type": "uint256"}
            ],
            "name": "EscrowFunded",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "escrowId", "type": "bytes32"}
            ],
            "name": "EscrowDelivered",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "escrowId", "type": "bytes32"},
                {"indexed": true, "name": "seller", "type": "address"},
                {"name": "amount", "type": "uint256"}
            ],
            "name": "EscrowCompleted",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "escrowId", "type": "bytes32"},
                {"indexed": true, "name": "buyer", "type": "address"},
                {"name": "amount", "type": "uint256"}
            ],
            "name": "EscrowRefunded",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "escrowId", "type": "bytes32"},
                {"indexed": true, "name": "initiator", "type": "address"}
            ],
            "name": "EscrowDisputed",
            "type": "event"
        }
    ]
    """

    // MARK: - Helper Methods

    /// 合并基础ERC-721 ABI和ChainlessNFT扩展ABI
    public static func getFullChainlessNFTABI() -> String {
        // 简化处理：在实际使用时需要JSON合并
        return chainlessNFTABI
    }

    /// 根据合约类型获取ABI
    public static func getABI(for contractType: ContractType) -> String {
        switch contractType {
        case .erc20:
            return erc20ABI
        case .erc721:
            return erc721ABI
        case .erc1155:
            return erc1155ABI
        case .escrow:
            return escrowContractABI
        case .custom:
            return "{}"
        default:
            return "{}"
        }
    }
}

/// 托管状态枚举（对应Solidity enum State）
public enum EscrowState: Int, Codable {
    case created = 0
    case funded = 1
    case delivered = 2
    case completed = 3
    case refunded = 4
    case disputed = 5

    var displayName: String {
        switch self {
        case .created: return "已创建"
        case .funded: return "已锁定资金"
        case .delivered: return "已交付"
        case .completed: return "已完成"
        case .refunded: return "已退款"
        case .disputed: return "争议中"
        }
    }
}

/// 支付类型（对应Solidity enum PaymentType）
public enum PaymentType: Int, Codable {
    case native = 0  // ETH/MATIC等原生币
    case erc20 = 1   // ERC20代币

    var displayName: String {
        switch self {
        case .native: return "原生代币"
        case .erc20: return "ERC-20代币"
        }
    }
}

/// 托管信息
public struct EscrowInfo: Codable {
    public let id: String
    public let buyer: String
    public let seller: String
    public let arbitrator: String
    public let amount: String
    public let paymentType: PaymentType
    public let tokenAddress: String?
    public let state: EscrowState
    public let createdAt: Date
    public let completedAt: Date?

    public init(
        id: String,
        buyer: String,
        seller: String,
        arbitrator: String,
        amount: String,
        paymentType: PaymentType,
        tokenAddress: String? = nil,
        state: EscrowState,
        createdAt: Date,
        completedAt: Date? = nil
    ) {
        self.id = id
        self.buyer = buyer
        self.seller = seller
        self.arbitrator = arbitrator
        self.amount = amount
        self.paymentType = paymentType
        self.tokenAddress = tokenAddress
        self.state = state
        self.createdAt = createdAt
        self.completedAt = completedAt
    }
}

// MARK: - AssetBridge Contract ABI

extension ContractABI {
    /// AssetBridge 跨链桥合约 ABI
    public static let assetBridgeABI = """
    [
        {
            "inputs": [],
            "stateMutability": "nonpayable",
            "type": "constructor"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "requestId", "type": "bytes32"},
                {"indexed": true, "name": "user", "type": "address"},
                {"indexed": true, "name": "token", "type": "address"},
                {"indexed": false, "name": "amount", "type": "uint256"},
                {"indexed": false, "name": "targetChainId", "type": "uint256"}
            ],
            "name": "AssetLocked",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "requestId", "type": "bytes32"},
                {"indexed": true, "name": "user", "type": "address"},
                {"indexed": true, "name": "token", "type": "address"},
                {"indexed": false, "name": "amount", "type": "uint256"},
                {"indexed": false, "name": "sourceChainId", "type": "uint256"}
            ],
            "name": "AssetMinted",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "requestId", "type": "bytes32"},
                {"indexed": true, "name": "user", "type": "address"},
                {"indexed": true, "name": "token", "type": "address"},
                {"indexed": false, "name": "amount", "type": "uint256"},
                {"indexed": false, "name": "targetChainId", "type": "uint256"}
            ],
            "name": "AssetBurned",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "requestId", "type": "bytes32"},
                {"indexed": true, "name": "user", "type": "address"},
                {"indexed": true, "name": "token", "type": "address"},
                {"indexed": false, "name": "amount", "type": "uint256"},
                {"indexed": false, "name": "sourceChainId", "type": "uint256"}
            ],
            "name": "AssetReleased",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "relayer", "type": "address"}
            ],
            "name": "RelayerAdded",
            "type": "event"
        },
        {
            "anonymous": false,
            "inputs": [
                {"indexed": true, "name": "relayer", "type": "address"}
            ],
            "name": "RelayerRemoved",
            "type": "event"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "relayer", "type": "address"}
            ],
            "name": "addRelayer",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "relayer", "type": "address"}
            ],
            "name": "removeRelayer",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "token", "type": "address"},
                {"name": "amount", "type": "uint256"},
                {"name": "targetChainId", "type": "uint256"}
            ],
            "name": "lockAsset",
            "outputs": [
                {"name": "", "type": "bytes32"}
            ],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "requestId", "type": "bytes32"},
                {"name": "user", "type": "address"},
                {"name": "token", "type": "address"},
                {"name": "amount", "type": "uint256"},
                {"name": "sourceChainId", "type": "uint256"}
            ],
            "name": "mintAsset",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "token", "type": "address"},
                {"name": "amount", "type": "uint256"},
                {"name": "targetChainId", "type": "uint256"}
            ],
            "name": "burnAsset",
            "outputs": [
                {"name": "", "type": "bytes32"}
            ],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "requestId", "type": "bytes32"},
                {"name": "user", "type": "address"},
                {"name": "token", "type": "address"},
                {"name": "amount", "type": "uint256"},
                {"name": "sourceChainId", "type": "uint256"}
            ],
            "name": "releaseAsset",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {"name": "requestId", "type": "bytes32"}
            ],
            "name": "getBridgeRequest",
            "outputs": [
                {
                    "components": [
                        {"name": "id", "type": "bytes32"},
                        {"name": "user", "type": "address"},
                        {"name": "token", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                        {"name": "targetChainId", "type": "uint256"},
                        {"name": "status", "type": "uint8"},
                        {"name": "createdAt", "type": "uint256"},
                        {"name": "completedAt", "type": "uint256"}
                    ],
                    "name": "",
                    "type": "tuple"
                }
            ],
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {"name": "requestId", "type": "bytes32"}
            ],
            "name": "isBridgeCompleted",
            "outputs": [
                {"name": "", "type": "bool"}
            ],
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {"name": "token", "type": "address"}
            ],
            "name": "getLockedBalance",
            "outputs": [
                {"name": "", "type": "uint256"}
            ],
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [
                {"name": "account", "type": "address"}
            ],
            "name": "isRelayer",
            "outputs": [
                {"name": "", "type": "bool"}
            ],
            "stateMutability": "view",
            "type": "function"
        },
        {
            "constant": false,
            "inputs": [
                {"name": "token", "type": "address"},
                {"name": "amount", "type": "uint256"}
            ],
            "name": "emergencyWithdraw",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        }
    ]
    """
}
