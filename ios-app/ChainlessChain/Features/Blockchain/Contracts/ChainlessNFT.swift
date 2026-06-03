import Foundation
import CoreCommon

/// ChainlessNFT合约包装器
/// 提供便捷的NFT铸造、转移、查询接口
@MainActor
public class ChainlessNFTContract: ObservableObject {

    // MARK: - Properties

    private let contractManager: ContractManager
    private let chainManager: ChainManager
    private let contractName = "ChainlessNFT"

    @Published public var isLoading = false
    @Published public var errorMessage: String?

    // MARK: - Initialization

    public init() {
        self.contractManager = ContractManager.shared
        self.chainManager = ChainManager.shared
    }

    // MARK: - Read Methods

    /// 查询NFT所有者
    public func ownerOf(tokenId: String, chain: SupportedChain? = nil) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw NFTError.contractNotDeployed
        }

        return try await contractManager.getNFTOwner(
            nftAddress: contractAddress,
            tokenId: tokenId,
            chain: chain
        )
    }

    /// 查询NFT元数据URI
    public func tokenURI(tokenId: String, chain: SupportedChain? = nil) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw NFTError.contractNotDeployed
        }

        return try await contractManager.getNFTTokenURI(
            nftAddress: contractAddress,
            tokenId: tokenId,
            chain: chain
        )
    }

    /// 查询地址拥有的NFT数量
    public func balanceOf(owner: String, chain: SupportedChain? = nil) async throws -> Int {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw NFTError.contractNotDeployed
        }

        let result = try await contractManager.callContractFunction(
            contractAddress: contractAddress,
            abi: ContractABI.chainlessNFTABI,
            functionName: "balanceOf",
            parameters: [owner],
            chain: chain
        )

        // 解码uint256
        guard let balance = Int(result.dropFirst(2), radix: 16) else {
            throw NFTError.invalidData
        }

        return balance
    }

    /// 查询地址拥有的所有Token ID
    public func tokensOfOwner(owner: String, chain: SupportedChain? = nil) async throws -> [String] {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw NFTError.contractNotDeployed
        }

        let result = try await contractManager.callContractFunction(
            contractAddress: contractAddress,
            abi: ContractABI.chainlessNFTABI,
            functionName: "tokensOfOwner",
            parameters: [owner],
            chain: chain
        )

        // TODO: 解码uint256数组
        return []
    }

    /// 查询下一个Token ID
    public func nextTokenId(chain: SupportedChain? = nil) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw NFTError.contractNotDeployed
        }

        let result = try await contractManager.callContractFunction(
            contractAddress: contractAddress,
            abi: ContractABI.chainlessNFTABI,
            functionName: "nextTokenId",
            chain: chain
        )

        return result
    }

    // MARK: - Write Methods

    /// 铸造NFT
    public func mint(
        wallet: Wallet,
        to: String,
        uri: String,
        chain: SupportedChain? = nil
    ) async throws -> MintResult {
        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.mintNFT(
            wallet: wallet,
            to: to,
            uri: uri,
            chain: chain
        )

        Logger.shared.info("[ChainlessNFT] NFT铸造交易已发送: \(txHash)")

        // TODO: 等待交易确认并解析tokenId
        return MintResult(
            transactionHash: txHash,
            tokenId: nil,  // 需要从事件日志中解析
            to: to,
            uri: uri
        )
    }

    /// 批量铸造NFT（仅限合约所有者）
    public func mintBatch(
        wallet: Wallet,
        to: String,
        uris: [String],
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw NFTError.contractNotDeployed
        }

        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            abi: ContractABI.chainlessNFTABI,
            functionName: "mintBatch",
            parameters: [to, uris],
            chain: chain
        )

        Logger.shared.info("[ChainlessNFT] 批量铸造交易已发送: \(txHash)")
        return txHash
    }

    /// 转移NFT
    public func transfer(
        wallet: Wallet,
        to: String,
        tokenId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw NFTError.contractNotDeployed
        }

        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.transferNFT(
            wallet: wallet,
            nftAddress: contractAddress,
            from: wallet.address,
            to: to,
            tokenId: tokenId,
            chain: chain
        )

        Logger.shared.info("[ChainlessNFT] NFT转移交易已发送: \(txHash)")
        return txHash
    }

    /// 安全转移NFT
    public func safeTransferFrom(
        wallet: Wallet,
        from: String,
        to: String,
        tokenId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw NFTError.contractNotDeployed
        }

        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            abi: ContractABI.erc721ABI,
            functionName: "safeTransferFrom",
            parameters: [from, to, tokenId],
            chain: chain
        )

        Logger.shared.info("[ChainlessNFT] NFT安全转移交易已发送: \(txHash)")
        return txHash
    }

    /// 授权NFT
    public func approve(
        wallet: Wallet,
        to: String,
        tokenId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw NFTError.contractNotDeployed
        }

        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            abi: ContractABI.erc721ABI,
            functionName: "approve",
            parameters: [to, tokenId],
            chain: chain
        )

        Logger.shared.info("[ChainlessNFT] NFT授权交易已发送: \(txHash)")
        return txHash
    }

    /// 销毁NFT
    public func burn(
        wallet: Wallet,
        tokenId: String,
        chain: SupportedChain? = nil
    ) async throws -> String {
        guard let contractAddress = getContractAddress(chain: chain) else {
            throw NFTError.contractNotDeployed
        }

        isLoading = true
        defer { isLoading = false }

        let txHash = try await contractManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            abi: ContractABI.chainlessNFTABI,
            functionName: "burn",
            parameters: [tokenId],
            chain: chain
        )

        Logger.shared.info("[ChainlessNFT] NFT销毁交易已发送: \(txHash)")
        return txHash
    }

    // MARK: - Event Listening

    /// 监听Transfer事件
    public func listenToTransfers(
        fromBlock: String = "latest",
        chain: SupportedChain? = nil,
        handler: @escaping (NFTTransferEvent) -> Void
    ) {
        guard let contractAddress = getContractAddress(chain: chain) else {
            Logger.shared.error("[ChainlessNFT] 合约未部署，无法监听事件")
            return
        }

        contractManager.listenToEvents(
            contractAddress: contractAddress,
            abi: ContractABI.erc721ABI,
            eventName: "Transfer",
            fromBlock: fromBlock,
            chain: chain
        ) { event in
            // 解析Transfer事件
            if let transferEvent = self.parseTransferEvent(event) {
                handler(transferEvent)
            }
        }
    }

    /// 停止监听Transfer事件
    public func stopListeningToTransfers(chain: SupportedChain? = nil) {
        guard let contractAddress = getContractAddress(chain: chain) else {
            return
        }

        contractManager.stopListeningToEvents(
            contractAddress: contractAddress,
            eventName: "Transfer"
        )
    }

    // MARK: - Private Helpers

    private func getContractAddress(chain: SupportedChain? = nil) -> String? {
        return contractManager.getContractAddress(name: contractName, chain: chain)
    }

    private func parseTransferEvent(_ event: ContractEvent) -> NFTTransferEvent? {
        // TODO: 解析事件参数
        guard event.parameters.count >= 3 else {
            return nil
        }

        return NFTTransferEvent(
            from: event.parameters[0].value,
            to: event.parameters[1].value,
            tokenId: event.parameters[2].value,
            transactionHash: event.transactionHash,
            blockNumber: event.blockNumber,
            timestamp: event.timestamp
        )
    }
}

// MARK: - Models

/// NFT铸造结果
public struct MintResult {
    public let transactionHash: String
    public let tokenId: String?
    public let to: String
    public let uri: String

    public init(transactionHash: String, tokenId: String?, to: String, uri: String) {
        self.transactionHash = transactionHash
        self.tokenId = tokenId
        self.to = to
        self.uri = uri
    }
}

/// NFT转移事件
public struct NFTTransferEvent {
    public let from: String
    public let to: String
    public let tokenId: String
    public let transactionHash: String
    public let blockNumber: String
    public let timestamp: Date

    public init(
        from: String,
        to: String,
        tokenId: String,
        transactionHash: String,
        blockNumber: String,
        timestamp: Date
    ) {
        self.from = from
        self.to = to
        self.tokenId = tokenId
        self.transactionHash = transactionHash
        self.blockNumber = blockNumber
        self.timestamp = timestamp
    }
}

// MARK: - Errors

public enum NFTError: Error, LocalizedError {
    case contractNotDeployed
    case invalidTokenId
    case notOwner
    case invalidData

    public var errorDescription: String? {
        switch self {
        case .contractNotDeployed:
            return "NFT合约未部署"
        case .invalidTokenId:
            return "无效的Token ID"
        case .notOwner:
            return "不是NFT所有者"
        case .invalidData:
            return "无效的数据"
        }
    }
}
