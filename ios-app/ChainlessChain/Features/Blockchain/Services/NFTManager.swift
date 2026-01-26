//
//  NFTManager.swift
//  ChainlessChain
//
//  NFT管理器
//  负责NFT查询、元数据获取、转账和存储
//
//  Created by ChainlessChain on 2026-01-26.
//

import Foundation
import Combine

/// NFT管理器
@MainActor
public class NFTManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = NFTManager()

    // MARK: - Published Properties

    @Published public var nfts: [NFT] = []
    @Published public var collections: [NFTCollection] = []
    @Published public var isLoading = false

    // MARK: - Private Properties

    private let contractManager: ContractManager
    private let transactionManager: TransactionManager
    private let chainManager: ChainManager
    private let database: DatabaseManager

    private var cancellables = Set<AnyCancellable>()
    private var metadataCache: [String: NFTMetadata] = [:]  // tokenURI -> metadata
    private var imageCache: [String: Data] = [:]  // imageURL -> data

    // MARK: - Initialization

    private init() {
        self.contractManager = ContractManager.shared
        self.transactionManager = TransactionManager.shared
        self.chainManager = ChainManager.shared
        self.database = DatabaseManager.shared

        Logger.shared.info("[NFTManager] NFT管理器已初始化")
    }

    // MARK: - Initialization

    /// 初始化NFT管理器
    public func initialize() async throws {
        Logger.shared.info("[NFTManager] 初始化NFT管理器...")

        // 初始化数据库表
        try await initializeTables()

        // 加载已保存的NFT
        try await loadNFTs()

        Logger.shared.info("[NFTManager] NFT管理器初始化成功，已加载 \(nfts.count) 个NFT")
    }

    // MARK: - Database

    /// 初始化数据库表
    private func initializeTables() async throws {
        // NFT表
        let createNFTTable = """
        CREATE TABLE IF NOT EXISTS nfts (
            id TEXT PRIMARY KEY,
            contract_address TEXT NOT NULL,
            token_id TEXT NOT NULL,
            chain_id INTEGER NOT NULL,
            standard TEXT NOT NULL,
            name TEXT,
            description TEXT,
            image_url TEXT,
            image_data BLOB,
            animation_url TEXT,
            collection_name TEXT,
            collection_symbol TEXT,
            owner_address TEXT NOT NULL,
            balance TEXT NOT NULL DEFAULT '1',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(contract_address, token_id, chain_id)
        )
        """

        try database.execute(createNFTTable)

        // NFT属性表
        let createAttributeTable = """
        CREATE TABLE IF NOT EXISTS nft_attributes (
            id TEXT PRIMARY KEY,
            nft_id TEXT NOT NULL,
            trait_type TEXT NOT NULL,
            value TEXT NOT NULL,
            display_type TEXT,
            FOREIGN KEY (nft_id) REFERENCES nfts(id) ON DELETE CASCADE
        )
        """

        try database.execute(createAttributeTable)

        // NFT集合表
        let createCollectionTable = """
        CREATE TABLE IF NOT EXISTS nft_collections (
            id TEXT PRIMARY KEY,
            contract_address TEXT NOT NULL,
            chain_id INTEGER NOT NULL,
            standard TEXT NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            description TEXT,
            image_url TEXT,
            total_supply TEXT,
            nft_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(contract_address, chain_id)
        )
        """

        try database.execute(createCollectionTable)

        // 创建索引
        try database.execute("CREATE INDEX IF NOT EXISTS idx_nft_owner ON nfts(owner_address)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_nft_contract ON nfts(contract_address, chain_id)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_attribute_nft ON nft_attributes(nft_id)")

        Logger.shared.info("[NFTManager] 数据库表初始化成功")
    }

    // MARK: - NFT Query

    /// 查询钱包的所有NFT（ERC-721）
    public func getWalletNFTs(
        wallet: Wallet,
        refresh: Bool = false
    ) async throws -> [NFT] {
        if !refresh {
            // 返回缓存
            return nfts.filter { $0.ownerAddress.lowercased() == wallet.address.lowercased() && $0.chainId == wallet.chainId }
        }

        // 刷新逻辑：需要链下索引服务（Alchemy/Moralis）或合约事件扫描
        // 这里只返回数据库中已有的NFT
        Logger.shared.warning("[NFTManager] NFT刷新需要集成链下索引服务")
        return nfts.filter { $0.ownerAddress.lowercased() == wallet.address.lowercased() && $0.chainId == wallet.chainId }
    }

    /// 查询NFT所有者（ERC-721）
    public func getNFTOwner(
        contractAddress: String,
        tokenId: String,
        chain: SupportedChain
    ) async throws -> String {
        let result = try await contractManager.callContractFunction(
            contractAddress: contractAddress,
            abi: ContractABI.erc721ABI,
            functionName: "ownerOf",
            parameters: [tokenId],
            chain: chain
        )

        return try contractManager.decodeAddress(from: result)
    }

    /// 查询NFT余额（ERC-1155）
    public func getNFTBalance(
        contractAddress: String,
        tokenId: String,
        ownerAddress: String,
        chain: SupportedChain
    ) async throws -> String {
        let result = try await contractManager.callContractFunction(
            contractAddress: contractAddress,
            abi: ContractABI.erc1155ABI,
            functionName: "balanceOf",
            parameters: [ownerAddress, tokenId],
            chain: chain
        )

        return try contractManager.decodeUint256(from: result)
    }

    /// 添加NFT（手动添加）
    public func addNFT(
        contractAddress: String,
        tokenId: String,
        chain: SupportedChain,
        ownerAddress: String
    ) async throws -> NFT {
        // 检查是否已存在
        if let existing = nfts.first(where: {
            $0.contractAddress.lowercased() == contractAddress.lowercased() &&
            $0.tokenId == tokenId &&
            $0.chainId == chain.chainId
        }) {
            return existing
        }

        // 检测NFT标准
        let standard = try await detectNFTStandard(contractAddress: contractAddress, chain: chain)

        // 查询所有权
        let isOwner: Bool
        if standard == .erc721 {
            let owner = try await getNFTOwner(contractAddress: contractAddress, tokenId: tokenId, chain: chain)
            isOwner = owner.lowercased() == ownerAddress.lowercased()
        } else {
            let balance = try await getNFTBalance(contractAddress: contractAddress, tokenId: tokenId, ownerAddress: ownerAddress, chain: chain)
            isOwner = Int(balance) ?? 0 > 0
        }

        guard isOwner else {
            throw NFTError.notOwner
        }

        // 查询TokenURI
        let tokenURI = try await getTokenURI(contractAddress: contractAddress, tokenId: tokenId, standard: standard, chain: chain)

        // 获取元数据
        let metadata = try? await fetchMetadata(from: tokenURI)

        // 获取集合信息
        let collectionName = try? await contractManager.callContractFunction(
            contractAddress: contractAddress,
            abi: standard == .erc721 ? ContractABI.erc721ABI : ContractABI.erc1155ABI,
            functionName: "name",
            parameters: [],
            chain: chain
        )

        let collectionSymbol = try? await contractManager.callContractFunction(
            contractAddress: contractAddress,
            abi: standard == .erc721 ? ContractABI.erc721ABI : ContractABI.erc1155ABI,
            functionName: "symbol",
            parameters: [],
            chain: chain
        )

        // 解析属性
        let attributes = metadata?.attributes?.compactMap { NFTAttribute.from(json: $0) } ?? []

        // 创建NFT
        let nft = NFT(
            contractAddress: contractAddress,
            tokenId: tokenId,
            chainId: chain.chainId,
            standard: standard,
            name: metadata?.name,
            description: metadata?.description,
            imageUrl: metadata?.image,
            animationUrl: metadata?.animation_url,
            collectionName: collectionName,
            collectionSymbol: collectionSymbol,
            ownerAddress: ownerAddress,
            balance: standard == .erc1155 ? (try? await getNFTBalance(contractAddress: contractAddress, tokenId: tokenId, ownerAddress: ownerAddress, chain: chain)) ?? "1" : "1",
            attributes: attributes,
            metadata: metadata
        )

        // 保存到数据库
        try await saveNFT(nft)

        // 添加到列表
        nfts.append(nft)

        Logger.shared.info("[NFTManager] 已添加NFT: \(nft.displayName)")

        return nft
    }

    /// 删除NFT
    public func deleteNFT(_ nft: NFT) async throws {
        // 从数据库删除
        try database.execute("DELETE FROM nfts WHERE id = ?", nft.id)
        try database.execute("DELETE FROM nft_attributes WHERE nft_id = ?", nft.id)

        // 从列表删除
        nfts.removeAll { $0.id == nft.id }

        Logger.shared.info("[NFTManager] 已删除NFT: \(nft.displayName)")
    }

    // MARK: - Metadata

    /// 获取TokenURI
    private func getTokenURI(
        contractAddress: String,
        tokenId: String,
        standard: NFTStandard,
        chain: SupportedChain
    ) async throws -> String {
        let result = try await contractManager.callContractFunction(
            contractAddress: contractAddress,
            abi: standard == .erc721 ? ContractABI.erc721ABI : ContractABI.erc1155ABI,
            functionName: standard == .erc721 ? "tokenURI" : "uri",
            parameters: [tokenId],
            chain: chain
        )

        return try contractManager.decodeString(from: result)
    }

    /// 获取元数据
    public func fetchMetadata(from uri: String) async throws -> NFTMetadata {
        // 检查缓存
        if let cached = metadataCache[uri] {
            return cached
        }

        // 转换IPFS URI
        let url = convertIPFSUrl(uri)

        // 获取JSON
        guard let urlObj = URL(string: url) else {
            throw NFTError.invalidMetadataURI
        }

        let (data, _) = try await URLSession.shared.data(from: urlObj)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NFTError.metadataParsingFailed
        }

        let metadata = NFTMetadata(from: json)

        // 缓存
        metadataCache[uri] = metadata

        return metadata
    }

    /// 下载图片
    public func fetchImage(from url: String) async throws -> Data {
        // 检查缓存
        if let cached = imageCache[url] {
            return cached
        }

        // 转换IPFS URL
        let imageUrl = convertIPFSUrl(url)

        guard let urlObj = URL(string: imageUrl) else {
            throw NFTError.invalidImageURL
        }

        let (data, _) = try await URLSession.shared.data(from: urlObj)

        // 缓存
        imageCache[url] = data

        return data
    }

    /// 转换IPFS URL
    private func convertIPFSUrl(_ url: String) -> String {
        if url.hasPrefix("ipfs://") {
            let hash = url.replacingOccurrences(of: "ipfs://", with: "")
            return "https://ipfs.io/ipfs/\(hash)"
        }
        return url
    }

    // MARK: - NFT Transfer

    /// 转移NFT（ERC-721）
    public func transferNFT(
        wallet: Wallet,
        nft: NFT,
        to: String,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard nft.standard == .erc721 else {
            throw NFTError.unsupportedStandard
        }

        // 编码safeTransferFrom函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.erc721ABI,
            functionName: "safeTransferFrom",
            parameters: [wallet.address, to, nft.tokenId],
            chain: nft.chain
        )

        // 发送合约交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: nft.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .nftTransfer,
            chain: nft.chain
        )

        Logger.shared.info("[NFTManager] NFT转移已提交: \(nft.displayName)")

        return record
    }

    /// 转移NFT（ERC-1155）
    public func transferNFT1155(
        wallet: Wallet,
        nft: NFT,
        to: String,
        amount: String,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard nft.standard == .erc1155 else {
            throw NFTError.unsupportedStandard
        }

        // 编码safeTransferFrom函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.erc1155ABI,
            functionName: "safeTransferFrom",
            parameters: [wallet.address, to, nft.tokenId, amount, "0x"],
            chain: nft.chain
        )

        // 发送合约交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: nft.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .nftTransfer,
            chain: nft.chain
        )

        Logger.shared.info("[NFTManager] NFT转移已提交: \(nft.displayName) x\(amount)")

        return record
    }

    /// 授权NFT（ERC-721）
    public func approveNFT(
        wallet: Wallet,
        nft: NFT,
        to: String,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard nft.standard == .erc721 else {
            throw NFTError.unsupportedStandard
        }

        // 编码approve函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.erc721ABI,
            functionName: "approve",
            parameters: [to, nft.tokenId],
            chain: nft.chain
        )

        // 发送合约交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: nft.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .approve,
            chain: nft.chain
        )

        Logger.shared.info("[NFTManager] NFT授权已提交: \(nft.displayName) to \(to)")

        return record
    }

    /// 批量授权（ERC-721）
    public func setApprovalForAll(
        wallet: Wallet,
        contractAddress: String,
        operator: String,
        approved: Bool,
        standard: NFTStandard,
        chain: SupportedChain? = nil,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        // 编码setApprovalForAll函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: standard == .erc721 ? ContractABI.erc721ABI : ContractABI.erc1155ABI,
            functionName: "setApprovalForAll",
            parameters: [`operator`, approved ? "1" : "0"],
            chain: chain
        )

        // 发送合约交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .approve,
            chain: chain
        )

        Logger.shared.info("[NFTManager] NFT批量授权已提交: \(contractAddress)")

        return record
    }

    // MARK: - Helper Methods

    /// 检测NFT标准
    private func detectNFTStandard(contractAddress: String, chain: SupportedChain) async throws -> NFTStandard {
        // 尝试调用ERC-721的ownerOf
        do {
            _ = try await contractManager.callContractFunction(
                contractAddress: contractAddress,
                abi: ContractABI.erc721ABI,
                functionName: "ownerOf",
                parameters: ["1"],
                chain: chain
            )
            return .erc721
        } catch {
            // 可能是ERC-1155
        }

        // 尝试调用ERC-1155的uri
        do {
            _ = try await contractManager.callContractFunction(
                contractAddress: contractAddress,
                abi: ContractABI.erc1155ABI,
                functionName: "uri",
                parameters: ["1"],
                chain: chain
            )
            return .erc1155
        } catch {
            throw NFTError.unsupportedStandard
        }
    }

    /// 获取NFT列表（按集合筛选）
    public func getNFTs(for collection: NFTCollection? = nil) -> [NFT] {
        if let collection = collection {
            return nfts.filter { $0.contractAddress.lowercased() == collection.contractAddress.lowercased() }
        }
        return nfts
    }

    // MARK: - Database Operations

    /// 加载NFT
    private func loadNFTs() async throws {
        let rows = try database.prepare("SELECT * FROM nfts ORDER BY created_at DESC")

        nfts = rows.compactMap { parseNFTRow($0) }

        // 加载属性
        for i in 0..<nfts.count {
            let attributes = try loadAttributes(for: nfts[i].id)
            nfts[i] = NFT(
                id: nfts[i].id,
                contractAddress: nfts[i].contractAddress,
                tokenId: nfts[i].tokenId,
                chainId: nfts[i].chainId,
                standard: nfts[i].standard,
                name: nfts[i].name,
                description: nfts[i].description,
                imageUrl: nfts[i].imageUrl,
                imageData: nfts[i].imageData,
                animationUrl: nfts[i].animationUrl,
                collectionName: nfts[i].collectionName,
                collectionSymbol: nfts[i].collectionSymbol,
                ownerAddress: nfts[i].ownerAddress,
                balance: nfts[i].balance,
                attributes: attributes,
                metadata: nfts[i].metadata,
                createdAt: nfts[i].createdAt,
                updatedAt: nfts[i].updatedAt
            )
        }

        Logger.shared.info("[NFTManager] 已加载 \(nfts.count) 个NFT")
    }

    /// 保存NFT
    private func saveNFT(_ nft: NFT) async throws {
        let sql = """
        INSERT OR REPLACE INTO nfts (
            id, contract_address, token_id, chain_id, standard,
            name, description, image_url, image_data, animation_url,
            collection_name, collection_symbol, owner_address, balance,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        try database.execute(
            sql,
            nft.id,
            nft.contractAddress,
            nft.tokenId,
            nft.chainId,
            nft.standard.rawValue,
            nft.name,
            nft.description,
            nft.imageUrl,
            nft.imageData,
            nft.animationUrl,
            nft.collectionName,
            nft.collectionSymbol,
            nft.ownerAddress,
            nft.balance,
            Int(nft.createdAt.timeIntervalSince1970),
            Int(nft.updatedAt.timeIntervalSince1970)
        )

        // 保存属性
        try await saveAttributes(nft.attributes, for: nft.id)
    }

    /// 保存属性
    private func saveAttributes(_ attributes: [NFTAttribute], for nftId: String) async throws {
        // 删除旧属性
        try database.execute("DELETE FROM nft_attributes WHERE nft_id = ?", nftId)

        // 插入新属性
        for attr in attributes {
            let sql = """
            INSERT INTO nft_attributes (id, nft_id, trait_type, value, display_type)
            VALUES (?, ?, ?, ?, ?)
            """

            try database.execute(sql, attr.id, nftId, attr.traitType, attr.value, attr.displayType)
        }
    }

    /// 加载属性
    private func loadAttributes(for nftId: String) throws -> [NFTAttribute] {
        let rows = try database.prepare("SELECT * FROM nft_attributes WHERE nft_id = ?", nftId)

        return rows.compactMap { row in
            guard
                let id = row["id"] as? String,
                let traitType = row["trait_type"] as? String,
                let value = row["value"] as? String
            else {
                return nil
            }

            let displayType = row["display_type"] as? String

            return NFTAttribute(id: id, traitType: traitType, value: value, displayType: displayType)
        }
    }

    /// 解析NFT行
    private func parseNFTRow(_ row: [String: Any]) -> NFT? {
        guard
            let id = row["id"] as? String,
            let contractAddress = row["contract_address"] as? String,
            let tokenId = row["token_id"] as? String,
            let chainId = row["chain_id"] as? Int,
            let standardRaw = row["standard"] as? String,
            let standard = NFTStandard(rawValue: standardRaw),
            let ownerAddress = row["owner_address"] as? String,
            let balance = row["balance"] as? String,
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int
        else {
            return nil
        }

        return NFT(
            id: id,
            contractAddress: contractAddress,
            tokenId: tokenId,
            chainId: chainId,
            standard: standard,
            name: row["name"] as? String,
            description: row["description"] as? String,
            imageUrl: row["image_url"] as? String,
            imageData: row["image_data"] as? Data,
            animationUrl: row["animation_url"] as? String,
            collectionName: row["collection_name"] as? String,
            collectionSymbol: row["collection_symbol"] as? String,
            ownerAddress: ownerAddress,
            balance: balance,
            attributes: [],  // Will be loaded separately
            metadata: nil,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
        )
    }

    // MARK: - Cleanup

    /// 清理资源
    public func cleanup() {
        nfts.removeAll()
        collections.removeAll()
        metadataCache.removeAll()
        imageCache.removeAll()

        Logger.shared.info("[NFTManager] 资源已清理")
    }
}

// MARK: - Errors

public enum NFTError: Error, LocalizedError {
    case invalidAddress
    case notOwner
    case unsupportedStandard
    case invalidMetadataURI
    case metadataParsingFailed
    case invalidImageURL
    case transferFailed

    public var errorDescription: String? {
        switch self {
        case .invalidAddress:
            return "无效的合约地址"
        case .notOwner:
            return "您不是该NFT的所有者"
        case .unsupportedStandard:
            return "不支持的NFT标准"
        case .invalidMetadataURI:
            return "无效的元数据URI"
        case .metadataParsingFailed:
            return "元数据解析失败"
        case .invalidImageURL:
            return "无效的图片URL"
        case .transferFailed:
            return "NFT转移失败"
        }
    }
}
