import Foundation
import CoreCommon

/// Escrow托管合约包装器
/// 提供买卖双方安全交易的托管服务
@MainActor
public class EscrowContractWrapper: ObservableObject {

    // MARK: - Properties

    private let contractManager: ContractManager
    private let chainManager: ChainManager
    private let contractName = "EscrowContract"

    @Published public var isLoading = false
    @Published public var errorMessage: String?

    // MARK: - Initialization

    public init() {
        self.contractManager = ContractManager.shared
        self.chainManager = ChainManager.shared
    }

    // MARK: - Read Methods

    /// 查询托管信息
    public func getEscrowInfo(
        escrowId: String,
        chain: SupportedChain? = nil
    ) async throws -> EscrowInfo {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw EscrowError.contractNotDeployed
        }

        return try await contractManager.getEscrowInfo(
            escrowAddress: contractAddress,
            escrowId: escrowId,
            chain: chain
        )
    }

    // MARK: - Create Escrow

    /// 创建原生币托管（ETH/MATIC等）
    public func createNativeEscrow(
        wallet: Wallet,
        seller: String,
        arbitrator: String,
        amount: String,
        chain: SupportedChain? = nil
    ) async throws -> CreateEscrowResult {
        isLoading = true
        defer { isLoading = false }

        // 生成托管ID
        let escrowId = generateEscrowId()

        let txHash = try await contractManager.createNativeEscrow(
            wallet: wallet,
            escrowId: escrowId,
            seller: seller,
            arbitrator: arbitrator,
            amount: amount,
            chain: chain
        )

        Logger.shared.info("[Escrow] 原生币托管创建交易已发送: \(txHash)")

        return CreateEscrowResult(
            escrowId: escrowId,
            transactionHash: txHash,
            buyer: wallet.address,
            seller: seller,
            arbitrator: arbitrator,
            amount: amount,
            paymentType: .native
        )
    }

    /// 创建ERC20代币托管
    public func createERC20Escrow(
        wallet: Wallet,
        seller: String,
        arbitrator: String,
        tokenAddress: String,
        amount: String,
        chain: SupportedChain? = nil
    ) async throws -> CreateEscrowResult {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw EscrowError.contractNotDeployed
        }

        isLoading = true
        defer { isLoading = false }

        // 生成托管ID
        let escrowId = generateEscrowId()

        // 1. 先授权代币给托管合约
        try await approveToken(
            wallet: wallet,
            tokenAddress: tokenAddress,
            spender: contractAddress,
            amount: amount,
            chain: chain
        )

        // 2. 创建托管
        let txHash = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            abi: ContractABI.escrowContractABI,
            functionName: "createERC20Escrow",
            parameters: [escrowId, seller, arbitrator, tokenAddress, amount],
            chain: chain
        )

        Logger.shared.info("[Escrow] ERC20托管创建交易已发送: \(txHash)")

        return CreateEscrowResult(
            escrowId: escrowId,
            transactionHash: txHash,
            buyer: wallet.address,
            seller: seller,
            arbitrator: arbitrator,
            amount: amount,
            paymentType: .erc20,
            tokenAddress: tokenAddress
        )
    }

    // MARK: - Escrow Lifecycle

    /// 卖家标记已交付
    public func markAsDelivered(
        wallet: Wallet,
        escrowId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw EscrowError.contractNotDeployed
        }

        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            abi: ContractABI.escrowContractABI,
            functionName: "markAsDelivered",
            parameters: [escrowId],
            chain: chain
        )

        Logger.shared.info("[Escrow] 标记交付交易已发送: \(txHash)")
        return txHash
    }

    /// 买家确认收货并释放资金
    public func release(
        wallet: Wallet,
        escrowId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.releaseEscrow(
            wallet: wallet,
            escrowId: escrowId,
            chain: chain
        )

        Logger.shared.info("[Escrow] 释放资金交易已发送: \(txHash)")
        return txHash
    }

    /// 退款给买家
    public func refund(
        wallet: Wallet,
        escrowId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.refundEscrow(
            wallet: wallet,
            escrowId: escrowId,
            chain: chain
        )

        Logger.shared.info("[Escrow] 退款交易已发送: \(txHash)")
        return txHash
    }

    // MARK: - Dispute Resolution

    /// 发起争议
    public func dispute(
        wallet: Wallet,
        escrowId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw EscrowError.contractNotDeployed
        }

        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            abi: ContractABI.escrowContractABI,
            functionName: "dispute",
            parameters: [escrowId],
            chain: chain
        )

        Logger.shared.info("[Escrow] 发起争议交易已发送: \(txHash)")
        return txHash
    }

    /// 仲裁者解决争议：释放给卖家
    public func resolveDisputeToSeller(
        wallet: Wallet,
        escrowId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw EscrowError.contractNotDeployed
        }

        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            abi: ContractABI.escrowContractABI,
            functionName: "resolveDisputeToSeller",
            parameters: [escrowId],
            chain: chain
        )

        Logger.shared.info("[Escrow] 争议解决（卖家）交易已发送: \(txHash)")
        return txHash
    }

    /// 仲裁者解决争议：退款给买家
    public func resolveDisputeToBuyer(
        wallet: Wallet,
        escrowId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw EscrowError.contractNotDeployed
        }

        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            abi: ContractABI.escrowContractABI,
            functionName: "resolveDisputeToBuyer",
            parameters: [escrowId],
            chain: chain
        )

        Logger.shared.info("[Escrow] 争议解决（买家）交易已发送: \(txHash)")
        return txHash
    }

    // MARK: - Event Listening

    /// 监听EscrowCreated事件
    public func listenToEscrowCreated(
        fromBlock: String = "latest",
        chain: SupportedChain? = nil,
        handler: @escaping (EscrowCreatedEvent) -> Void
    ) {
        guard let contractAddress = getContractAddress(chain: chain) else {
            Logger.shared.error("[Escrow] 合约未部署，无法监听事件")
            return
        }

        contractManager.listenToEvents(
            contractAddress: contractAddress,
            abi: ContractABI.escrowContractABI,
            eventName: "EscrowCreated",
            fromBlock: fromBlock,
            chain: chain
        ) { event in
            if let createdEvent = self.parseEscrowCreatedEvent(event) {
                handler(createdEvent)
            }
        }
    }

    /// 监听EscrowCompleted事件
    public func listenToEscrowCompleted(
        fromBlock: String = "latest",
        chain: SupportedChain? = nil,
        handler: @escaping (EscrowCompletedEvent) -> Void
    ) {
        guard let contractAddress = getContractAddress(chain: chain) else {
            Logger.shared.error("[Escrow] 合约未部署，无法监听事件")
            return
        }

        contractManager.listenToEvents(
            contractAddress: contractAddress,
            abi: ContractABI.escrowContractABI,
            eventName: "EscrowCompleted",
            fromBlock: fromBlock,
            chain: chain
        ) { event in
            if let completedEvent = self.parseEscrowCompletedEvent(event) {
                handler(completedEvent)
            }
        }
    }

    /// 停止监听所有事件
    public func stopListening(chain: SupportedChain? = nil) {
        guard let contractAddress = getContractAddress(chain: chain) else {
            return
        }

        contractManager.stopListeningToEvents(
            contractAddress: contractAddress,
            eventName: "EscrowCreated"
        )
        contractManager.stopListeningToEvents(
            contractAddress: contractAddress,
            eventName: "EscrowCompleted"
        )
    }

    // MARK: - Private Helpers

    private func getContractAddress(chain: SupportedChain? = nil) -> String? {
        return contractManager.getContractAddress(name: contractName, chain: chain)
    }

    private func generateEscrowId() -> String {
        // 生成32字节的唯一ID（bytes32）
        let uuid = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let timestamp = String(format: "%016llx", UInt64(Date().timeIntervalSince1970 * 1000))
        let combined = uuid + timestamp

        // 取前64个字符（32字节）
        let escrowId = "0x" + String(combined.prefix(64))
        return escrowId
    }

    private func approveToken(
        wallet: Wallet,
        tokenAddress: String,
        spender: String,
        amount: String,
        chain: SupportedChain?
    ) async throws {
        _ = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: tokenAddress,
            abi: ContractABI.erc20ABI,
            functionName: "approve",
            parameters: [spender, amount],
            chain: chain
        )

        Logger.shared.info("[Escrow] 代币授权成功")
    }

    private func parseEscrowCreatedEvent(_ event: ContractEvent) -> EscrowCreatedEvent? {
        // TODO: 解析事件参数
        guard event.parameters.count >= 4 else {
            return nil
        }

        return EscrowCreatedEvent(
            escrowId: event.parameters[0].value,
            buyer: event.parameters[1].value,
            seller: event.parameters[2].value,
            amount: event.parameters[3].value,
            transactionHash: event.transactionHash,
            blockNumber: event.blockNumber,
            timestamp: event.timestamp
        )
    }

    private func parseEscrowCompletedEvent(_ event: ContractEvent) -> EscrowCompletedEvent? {
        // TODO: 解析事件参数
        guard event.parameters.count >= 3 else {
            return nil
        }

        return EscrowCompletedEvent(
            escrowId: event.parameters[0].value,
            seller: event.parameters[1].value,
            amount: event.parameters[2].value,
            transactionHash: event.transactionHash,
            blockNumber: event.blockNumber,
            timestamp: event.timestamp
        )
    }
}

// MARK: - Models

/// 托管创建结果
public struct CreateEscrowResult {
    public let escrowId: String
    public let transactionHash: String
    public let buyer: String
    public let seller: String
    public let arbitrator: String
    public let amount: String
    public let paymentType: PaymentType
    public let tokenAddress: String?

    public init(
        escrowId: String,
        transactionHash: String,
        buyer: String,
        seller: String,
        arbitrator: String,
        amount: String,
        paymentType: PaymentType,
        tokenAddress: String? = nil
    ) {
        self.escrowId = escrowId
        self.transactionHash = transactionHash
        self.buyer = buyer
        self.seller = seller
        self.arbitrator = arbitrator
        self.amount = amount
        self.paymentType = paymentType
        self.tokenAddress = tokenAddress
    }
}

/// 托管创建事件
public struct EscrowCreatedEvent {
    public let escrowId: String
    public let buyer: String
    public let seller: String
    public let amount: String
    public let transactionHash: String
    public let blockNumber: String
    public let timestamp: Date

    public init(
        escrowId: String,
        buyer: String,
        seller: String,
        amount: String,
        transactionHash: String,
        blockNumber: String,
        timestamp: Date
    ) {
        self.escrowId = escrowId
        self.buyer = buyer
        self.seller = seller
        self.amount = amount
        self.transactionHash = transactionHash
        self.blockNumber = blockNumber
        self.timestamp = timestamp
    }
}

/// 托管完成事件
public struct EscrowCompletedEvent {
    public let escrowId: String
    public let seller: String
    public let amount: String
    public let transactionHash: String
    public let blockNumber: String
    public let timestamp: Date

    public init(
        escrowId: String,
        seller: String,
        amount: String,
        transactionHash: String,
        blockNumber: String,
        timestamp: Date
    ) {
        self.escrowId = escrowId
        self.seller = seller
        self.amount = amount
        self.transactionHash = transactionHash
        self.blockNumber = blockNumber
        self.timestamp = timestamp
    }
}

// MARK: - Errors

public enum EscrowError: Error, LocalizedError {
    case contractNotDeployed
    case invalidEscrowId
    case invalidState
    case unauthorized
    case insufficientBalance

    public var errorDescription: String? {
        switch self {
        case .contractNotDeployed:
            return "托管合约未部署"
        case .invalidEscrowId:
            return "无效的托管ID"
        case .invalidState:
            return "托管状态无效"
        case .unauthorized:
            return "无权限执行此操作"
        case .insufficientBalance:
            return "余额不足"
        }
    }
}
