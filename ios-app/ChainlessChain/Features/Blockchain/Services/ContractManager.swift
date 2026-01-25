import Foundation
import Combine
import CoreCommon

/// 智能合约管理器
/// 负责合约的加载、调用、事件监听等操作
@MainActor
public class ContractManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = ContractManager()

    // MARK: - Published Properties

    @Published public private(set) var contracts: [String: SmartContract] = [:]
    @Published public private(set) var isLoading = false
    @Published public var errorMessage: String?

    // MARK: - Private Properties

    private let rpcClient: BlockchainRPCClient
    private let chainManager: ChainManager
    private let walletManager: WalletManager
    private var eventListeners: [String: Task<Void, Never>] = [:]

    // 预定义合约部署地址（测试网）
    private var deployedContracts: [SupportedChain: [ContractType: String]] = [:]

    // MARK: - Initialization

    private init() {
        self.rpcClient = BlockchainRPCClient.shared
        self.chainManager = ChainManager.shared
        self.walletManager = WalletManager.shared

        // 初始化预定义合约
        initializeBuiltinContracts()
        loadDeployedAddresses()
    }

    // MARK: - Contract Loading

    /// 初始化内置合约
    private func initializeBuiltinContracts() {
        // ChainlessNFT合约
        let chainlessNFT = SmartContract(
            name: "ChainlessNFT",
            type: .erc721,
            abi: ContractABI.chainlessNFTABI,
            description: "ChainlessChain官方NFT合约，支持铸造和转移NFT"
        )
        contracts["ChainlessNFT"] = chainlessNFT

        // Escrow合约
        let escrowContract = SmartContract(
            name: "EscrowContract",
            type: .escrow,
            abi: ContractABI.escrowContractABI,
            description: "托管合约，用于买卖双方安全交易"
        )
        contracts["EscrowContract"] = escrowContract

        Logger.shared.info("[ContractManager] 已加载 \(contracts.count) 个内置合约")
    }

    /// 加载已部署的合约地址（从配置或数据库）
    private func loadDeployedAddresses() {
        // TODO: 从数据库或配置文件加载实际部署的合约地址
        // 示例：Sepolia测试网地址
        deployedContracts[.ethereumSepolia] = [
            .erc721: "0x0000000000000000000000000000000000000000",  // 替换为实际地址
            .escrow: "0x0000000000000000000000000000000000000000"   // 替换为实际地址
        ]

        Logger.shared.info("[ContractManager] 已加载部署地址")
    }

    /// 获取合约
    public func getContract(name: String) -> SmartContract? {
        return contracts[name]
    }

    /// 获取合约地址
    public func getContractAddress(name: String, chain: SupportedChain? = nil) -> String? {
        guard let contract = contracts[name] else {
            return nil
        }

        let targetChain = chain ?? chainManager.currentChain
        return contract.getAddress(for: targetChain.rawValue)
    }

    /// 注册自定义合约
    public func registerContract(_ contract: SmartContract) {
        contracts[contract.name] = contract
        Logger.shared.info("[ContractManager] 已注册合约: \(contract.name)")
    }

    // MARK: - Contract Calls (Read-only)

    /// 调用合约只读函数（call）
    public func callContractFunction(
        contractAddress: String,
        abi: String,
        functionName: String,
        parameters: [Any] = [],
        from: String? = nil,
        chain: SupportedChain? = nil
    ) async throws -> String {
        let targetChain = chain ?? chainManager.currentChain
        let rpcUrl = try await chainManager.getAvailableRPCUrl(for: targetChain)

        // 编码函数调用数据
        let data = try encodeFunctionCall(
            abi: abi,
            functionName: functionName,
            parameters: parameters
        )

        // 使用eth_call调用
        let result = try await rpcClient.call(
            rpcUrl: rpcUrl,
            to: contractAddress,
            data: data,
            from: from
        )

        return result
    }

    /// 查询ERC-20代币名称
    public func getTokenName(
        tokenAddress: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        let result = try await callContractFunction(
            contractAddress: tokenAddress,
            abi: ContractABI.erc20ABI,
            functionName: "name",
            chain: chain
        )

        return try decodeString(from: result)
    }

    /// 查询ERC-20代币符号
    public func getTokenSymbol(
        tokenAddress: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        let result = try await callContractFunction(
            contractAddress: tokenAddress,
            abi: ContractABI.erc20ABI,
            functionName: "symbol",
            chain: chain
        )

        return try decodeString(from: result)
    }

    /// 查询ERC-20代币小数位数
    public func getTokenDecimals(
        tokenAddress: String,
        chain: SupportedChain? = nil
    ) async throws -> Int {
        let result = try await callContractFunction(
            contractAddress: tokenAddress,
            abi: ContractABI.erc20ABI,
            functionName: "decimals",
            chain: chain
        )

        return try decodeUInt8(from: result)
    }

    /// 查询NFT所有者
    public func getNFTOwner(
        nftAddress: String,
        tokenId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        let result = try await callContractFunction(
            contractAddress: nftAddress,
            abi: ContractABI.erc721ABI,
            functionName: "ownerOf",
            parameters: [tokenId],
            chain: chain
        )

        return try decodeAddress(from: result)
    }

    /// 查询NFT元数据URI
    public func getNFTTokenURI(
        nftAddress: String,
        tokenId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        let result = try await callContractFunction(
            contractAddress: nftAddress,
            abi: ContractABI.erc721ABI,
            functionName: "tokenURI",
            parameters: [tokenId],
            chain: chain
        )

        return try decodeString(from: result)
    }

    /// 查询托管信息
    public func getEscrowInfo(
        escrowAddress: String,
        escrowId: String,
        chain: SupportedChain? = nil
    ) async throws -> EscrowInfo {
        let result = try await callContractFunction(
            contractAddress: escrowAddress,
            abi: ContractABI.escrowContractABI,
            functionName: "getEscrow",
            parameters: [escrowId],
            chain: chain
        )

        // TODO: 解析复杂的tuple返回值
        // 这里需要实现复杂的ABI解码逻辑
        throw ContractError.notImplemented("Escrow info parsing not yet implemented")
    }

    // MARK: - Contract Transactions (Write)

    /// 发送合约交易（state-changing）
    public func sendContractTransaction(
        wallet: Wallet,
        contractAddress: String,
        abi: String,
        functionName: String,
        parameters: [Any] = [],
        value: String = "0",
        gasLimit: String? = nil,
        gasPrice: String? = nil,
        txType: TransactionType = .contract,
        chain: SupportedChain? = nil
    ) async throws -> String {
        isLoading = true
        defer { isLoading = false }

        // 编码函数调用数据
        let data = try encodeFunctionCall(
            abi: abi,
            functionName: functionName,
            parameters: parameters
        )

        // 使用TransactionManager发送交易（自动处理nonce、gas估算、监控）
        let transactionManager = TransactionManager.shared
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            data: data,
            value: value,
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: txType,
            chain: chain
        )

        guard let txHash = record.hash else {
            throw ContractError.transactionFailed
        }

        Logger.shared.info("[ContractManager] 合约交易已提交: \(txHash)")
        return txHash
    }

    // MARK: - ChainlessNFT Contract Methods

    /// 铸造NFT
    public func mintNFT(
        wallet: Wallet,
        to: String,
        uri: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let nftAddress = getContractAddress(name: "ChainlessNFT", chain: chain) else {
            throw ContractError.contractNotDeployed
        }

        return try await sendContractTransaction(
            wallet: wallet,
            contractAddress: nftAddress,
            abi: ContractABI.chainlessNFTABI,
            functionName: "mint",
            parameters: [to, uri],
            txType: .nftMint,
            chain: chain
        )
    }

    /// 转移NFT
    public func transferNFT(
        wallet: Wallet,
        nftAddress: String,
        from: String,
        to: String,
        tokenId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        return try await sendContractTransaction(
            wallet: wallet,
            contractAddress: nftAddress,
            abi: ContractABI.erc721ABI,
            functionName: "transferFrom",
            parameters: [from, to, tokenId],
            txType: .nftTransfer,
            chain: chain
        )
    }

    // MARK: - Escrow Contract Methods

    /// 创建原生币托管
    public func createNativeEscrow(
        wallet: Wallet,
        escrowId: String,
        seller: String,
        arbitrator: String,
        amount: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let escrowAddress = getContractAddress(name: "EscrowContract", chain: chain) else {
            throw ContractError.contractNotDeployed
        }

        return try await sendContractTransaction(
            wallet: wallet,
            contractAddress: escrowAddress,
            abi: ContractABI.escrowContractABI,
            functionName: "createNativeEscrow",
            parameters: [escrowId, seller, arbitrator],
            value: amount,
            txType: .escrowCreate,
            chain: chain
        )
    }

    /// 买家确认收货并释放资金
    public func releaseEscrow(
        wallet: Wallet,
        escrowId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let escrowAddress = getContractAddress(name: "EscrowContract", chain: chain) else {
            throw ContractError.contractNotDeployed
        }

        return try await sendContractTransaction(
            wallet: wallet,
            contractAddress: escrowAddress,
            abi: ContractABI.escrowContractABI,
            functionName: "release",
            parameters: [escrowId],
            txType: .escrowRelease,
            chain: chain
        )
    }

    /// 退款
    public func refundEscrow(
        wallet: Wallet,
        escrowId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let escrowAddress = getContractAddress(name: "EscrowContract", chain: chain) else {
            throw ContractError.contractNotDeployed
        }

        return try await sendContractTransaction(
            wallet: wallet,
            contractAddress: escrowAddress,
            abi: ContractABI.escrowContractABI,
            functionName: "refund",
            parameters: [escrowId],
            chain: chain
        )
    }

    // MARK: - Event Listening

    /// 监听合约事件
    public func listenToEvents(
        contractAddress: String,
        abi: String,
        eventName: String,
        fromBlock: String = "latest",
        chain: SupportedChain? = nil,
        handler: @escaping (ContractEvent) -> Void
    ) {
        let listenerKey = "\(contractAddress):\(eventName)"

        // 取消现有监听器
        eventListeners[listenerKey]?.cancel()

        // 创建新监听器
        let task = Task {
            await startEventPolling(
                contractAddress: contractAddress,
                abi: abi,
                eventName: eventName,
                fromBlock: fromBlock,
                chain: chain,
                handler: handler
            )
        }

        eventListeners[listenerKey] = task
        Logger.shared.info("[ContractManager] 开始监听事件: \(eventName)")
    }

    /// 停止监听事件
    public func stopListeningToEvents(contractAddress: String, eventName: String) {
        let listenerKey = "\(contractAddress):\(eventName)"
        eventListeners[listenerKey]?.cancel()
        eventListeners.removeValue(forKey: listenerKey)
        Logger.shared.info("[ContractManager] 停止监听事件: \(eventName)")
    }

    // MARK: - Private Helpers

    /// 轮询事件
    private func startEventPolling(
        contractAddress: String,
        abi: String,
        eventName: String,
        fromBlock: String,
        chain: SupportedChain?,
        handler: @escaping (ContractEvent) -> Void
    ) async {
        var lastBlock = fromBlock

        while !Task.isCancelled {
            do {
                // 查询新事件
                let events = try await fetchEvents(
                    contractAddress: contractAddress,
                    abi: abi,
                    eventName: eventName,
                    fromBlock: lastBlock,
                    toBlock: "latest",
                    chain: chain
                )

                // 处理事件
                for event in events {
                    handler(event)
                }

                // 更新lastBlock
                if let lastEvent = events.last {
                    lastBlock = lastEvent.blockNumber
                }

                // 等待10秒后继续轮询
                try await Task.sleep(nanoseconds: 10_000_000_000)
            } catch {
                Logger.shared.error("[ContractManager] 事件轮询错误: \(error)")
                try? await Task.sleep(nanoseconds: 30_000_000_000)  // 错误后等待30秒
            }
        }
    }

    /// 查询事件
    private func fetchEvents(
        contractAddress: String,
        abi: String,
        eventName: String,
        fromBlock: String,
        toBlock: String,
        chain: SupportedChain?
    ) async throws -> [ContractEvent] {
        // TODO: 实现eth_getLogs调用并解析事件
        return []
    }

    /// 编码函数调用数据
    private func encodeFunctionCall(
        abi: String,
        functionName: String,
        parameters: [Any]
    ) throws -> String {
        // TODO: 实现完整的ABI编码逻辑
        // 这是一个简化的占位实现
        // 实际需要：
        // 1. 解析ABI JSON
        // 2. 找到函数签名
        // 3. 计算函数选择器（keccak256的前4字节）
        // 4. 编码参数
        // 5. 拼接数据

        Logger.shared.warn("[ContractManager] ABI编码功能尚未完整实现")
        return "0x"
    }

    /// 解码字符串返回值
    private func decodeString(from hex: String) throws -> String {
        // TODO: 实现ABI字符串解码
        return ""
    }

    /// 解码地址返回值
    private func decodeAddress(from hex: String) throws -> String {
        // 地址是最后40个字符（去掉0x和padding）
        guard hex.hasPrefix("0x"), hex.count >= 42 else {
            throw ContractError.invalidReturnData
        }

        return "0x" + String(hex.suffix(40))
    }

    /// 解码uint8返回值
    private func decodeUInt8(from hex: String) throws -> Int {
        guard hex.hasPrefix("0x") else {
            throw ContractError.invalidReturnData
        }

        let hexValue = String(hex.dropFirst(2))
        guard let value = Int(hexValue, radix: 16) else {
            throw ContractError.invalidReturnData
        }

        return value
    }
}

// MARK: - Errors

public enum ContractError: Error, LocalizedError {
    case contractNotFound
    case contractNotDeployed
    case invalidABI
    case invalidParameters
    case encodingFailed
    case decodingFailed
    case invalidReturnData
    case notImplemented(String)

    public var errorDescription: String? {
        switch self {
        case .contractNotFound:
            return "合约未找到"
        case .contractNotDeployed:
            return "合约未部署"
        case .invalidABI:
            return "无效的ABI"
        case .invalidParameters:
            return "无效的参数"
        case .encodingFailed:
            return "编码失败"
        case .decodingFailed:
            return "解码失败"
        case .invalidReturnData:
            return "无效的返回数据"
        case .notImplemented(let message):
            return "功能未实现: \(message)"
        }
    }
}
