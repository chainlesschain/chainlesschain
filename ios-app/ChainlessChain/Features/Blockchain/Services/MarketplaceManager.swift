//
//  MarketplaceManager.swift
//  ChainlessChain
//
//  市场合约管理器
//  负责NFT挂单、购买、出价和版税处理
//
//  Created by ChainlessChain on 2026-01-26.
//

import Foundation
import Combine
import CryptoKit

/// 市场合约管理器
@MainActor
public class MarketplaceManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = MarketplaceManager()

    // MARK: - Published Properties

    @Published public var listings: [NFTListing] = []
    @Published public var offers: [NFTOffer] = []
    @Published public var marketplaceEvents: [String: [MarketplaceEvent]] = []  // listingId/offerId -> events
    @Published public var isLoading = false

    // MARK: - Events

    public let listingCreated = PassthroughSubject<NFTListing, Never>()
    public let listingUpdated = PassthroughSubject<NFTListing, Never>()
    public let listingSold = PassthroughSubject<NFTListing, Never>()

    public let offerCreated = PassthroughSubject<NFTOffer, Never>()
    public let offerAccepted = PassthroughSubject<NFTOffer, Never>()

    // MARK: - Private Properties

    private let contractManager: ContractManager
    private let transactionManager: TransactionManager
    private let nftManager: NFTManager
    private let tokenManager: TokenManager
    private let chainManager: ChainManager
    private let database: DatabaseManager

    private var cancellables = Set<AnyCancellable>()

    // Marketplace contract addresses (per chain)
    private var marketplaceContracts: [Int: String] = [:]

    // MARK: - Initialization

    private init() {
        self.contractManager = ContractManager.shared
        self.transactionManager = TransactionManager.shared
        self.nftManager = NFTManager.shared
        self.tokenManager = TokenManager.shared
        self.chainManager = ChainManager.shared
        self.database = DatabaseManager.shared

        Logger.shared.info("[MarketplaceManager] 市场管理器已初始化")
    }

    // MARK: - Initialization

    /// 初始化市场管理器
    public func initialize() async throws {
        Logger.shared.info("[MarketplaceManager] 初始化市场管理器...")

        // 初始化数据库表
        try await initializeTables()

        // 加载已保存的挂单和出价
        try await loadData()

        Logger.shared.info("[MarketplaceManager] 市场管理器初始化成功，已加载 \(listings.count) 个挂单，\(offers.count) 个出价")
    }

    // MARK: - Database

    /// 初始化数据库表
    private func initializeTables() async throws {
        // 挂单表
        let createListingTable = """
        CREATE TABLE IF NOT EXISTS nft_listings (
            id TEXT PRIMARY KEY,
            listing_id TEXT NOT NULL,
            contract_address TEXT NOT NULL,
            chain_id INTEGER NOT NULL,
            nft_contract TEXT NOT NULL,
            token_id TEXT NOT NULL,
            seller TEXT NOT NULL,
            price TEXT NOT NULL,
            payment_token TEXT,
            status INTEGER NOT NULL,
            buyer TEXT,
            created_at INTEGER NOT NULL,
            sold_at INTEGER,
            canceled_at INTEGER,
            transaction_hash TEXT,
            block_number TEXT,
            nft_name TEXT,
            nft_description TEXT,
            nft_image_url TEXT,
            collection_name TEXT,
            updated_at INTEGER NOT NULL,
            UNIQUE(listing_id, contract_address)
        )
        """

        try database.execute(createListingTable)

        // 出价表
        let createOfferTable = """
        CREATE TABLE IF NOT EXISTS nft_offers (
            id TEXT PRIMARY KEY,
            offer_id TEXT NOT NULL,
            contract_address TEXT NOT NULL,
            chain_id INTEGER NOT NULL,
            nft_contract TEXT NOT NULL,
            token_id TEXT NOT NULL,
            buyer TEXT NOT NULL,
            price TEXT NOT NULL,
            payment_token TEXT,
            status INTEGER NOT NULL,
            seller TEXT,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            accepted_at INTEGER,
            canceled_at INTEGER,
            transaction_hash TEXT,
            updated_at INTEGER NOT NULL,
            UNIQUE(offer_id, contract_address)
        )
        """

        try database.execute(createOfferTable)

        // 市场事件表
        let createEventTable = """
        CREATE TABLE IF NOT EXISTS marketplace_events (
            id TEXT PRIMARY KEY,
            listing_id TEXT,
            offer_id TEXT,
            event_type TEXT NOT NULL,
            actor TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            transaction_hash TEXT
        )
        """

        try database.execute(createEventTable)

        // 创建索引
        try database.execute("CREATE INDEX IF NOT EXISTS idx_listing_seller ON nft_listings(seller)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_listing_nft ON nft_listings(nft_contract, token_id)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_listing_status ON nft_listings(status)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_offer_buyer ON nft_offers(buyer)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_offer_nft ON nft_offers(nft_contract, token_id)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_event_listing ON marketplace_events(listing_id)")
        try database.execute("CREATE INDEX IF NOT EXISTS idx_event_offer ON marketplace_events(offer_id)")

        Logger.shared.info("[MarketplaceManager] 数据库表初始化成功")
    }

    // MARK: - Contract Management

    /// 设置市场合约地址
    public func setMarketplaceContract(address: String, for chain: SupportedChain) {
        marketplaceContracts[chain.chainId] = address
        Logger.shared.info("[MarketplaceManager] 设置市场合约地址: \(address) for \(chain.name)")
    }

    /// 获取市场合约地址
    public func getMarketplaceContract(for chain: SupportedChain) -> String? {
        return marketplaceContracts[chain.chainId]
    }

    // MARK: - List NFT

    /// 上架NFT
    public func listNFT(
        wallet: Wallet,
        nft: NFT,
        price: String,  // Wei format
        paymentToken: String? = nil,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> NFTListing {
        guard let chain = wallet.chain else {
            throw MarketplaceError.chainNotSupported
        }

        guard let contractAddress = getMarketplaceContract(for: chain) else {
            throw MarketplaceError.contractNotDeployed
        }

        // 先授权NFT给市场合约
        if nft.isERC721 {
            _ = try await nftManager.approveNFT(
                wallet: wallet,
                nft: nft,
                to: contractAddress,
                gasLimit: gasLimit,
                gasPrice: gasPrice
            )
        } else {
            _ = try await nftManager.setApprovalForAll(
                wallet: wallet,
                contractAddress: nft.contractAddress,
                operator: contractAddress,
                approved: true,
                standard: nft.standard,
                chain: chain,
                gasLimit: gasLimit,
                gasPrice: gasPrice
            )
        }

        // 生成listing ID
        let listingId = String(listings.count + 1)

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.marketplaceABI,
            functionName: "listNFT",
            parameters: [
                nft.contractAddress,
                nft.tokenId,
                price,
                paymentToken ?? "0x0000000000000000000000000000000000000000"
            ],
            chain: chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: chain
        )

        // 创建挂单对象
        let listing = NFTListing(
            listingId: listingId,
            contractAddress: contractAddress,
            chainId: chain.chainId,
            nftContract: nft.contractAddress,
            tokenId: nft.tokenId,
            seller: wallet.address,
            price: price,
            paymentToken: paymentToken,
            status: .active,
            transactionHash: record.hash,
            nftMetadata: NFTListingMetadata(
                nftName: nft.name,
                nftDescription: nft.description,
                nftImageUrl: nft.imageUrl,
                collectionName: nft.collectionName
            )
        )

        // 保存到数据库
        try await saveListing(listing)

        // 添加到列表
        listings.append(listing)

        // 添加事件
        try await addEvent(
            listingId: listingId,
            eventType: .listed,
            actor: wallet.address,
            transactionHash: record.hash
        )

        // 发送事件
        listingCreated.send(listing)

        Logger.shared.info("[MarketplaceManager] NFT已上架: \(nft.displayName)")

        return listing
    }

    /// 取消挂单
    public func cancelListing(
        listing: NFTListing,
        wallet: Wallet,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard listing.canCancel(walletAddress: wallet.address) else {
            throw MarketplaceError.invalidOperation
        }

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.marketplaceABI,
            functionName: "cancelListing",
            parameters: [listing.listingId],
            chain: listing.chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: listing.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: listing.chain
        )

        // 更新状态
        var updatedListing = listing
        updatedListing.status = .canceled
        updatedListing.canceledAt = Date()
        try await updateListing(updatedListing)

        // 添加事件
        try await addEvent(
            listingId: listing.listingId,
            eventType: .canceled,
            actor: wallet.address,
            transactionHash: record.hash
        )

        Logger.shared.info("[MarketplaceManager] 挂单已取消: \(listing.listingId)")

        return record
    }

    // MARK: - Buy NFT

    /// 购买NFT
    public func buyNFT(
        listing: NFTListing,
        wallet: Wallet,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard listing.canBuy(walletAddress: wallet.address) else {
            throw MarketplaceError.invalidOperation
        }

        var value = "0"

        // 如果是ERC-20支付，先授权代币
        if let paymentToken = listing.paymentToken {
            _ = try await tokenManager.approveToken(
                wallet: wallet,
                token: Token(
                    address: paymentToken,
                    chainId: listing.chainId,
                    type: .erc20,
                    name: "",
                    symbol: "",
                    decimals: 18
                ),
                spender: listing.contractAddress,
                amount: listing.price,
                gasLimit: gasLimit,
                gasPrice: gasPrice
            )
        } else {
            // 原生代币支付
            value = listing.price
        }

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.marketplaceABI,
            functionName: "buyNFT",
            parameters: [listing.listingId],
            chain: listing.chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: listing.contractAddress,
            data: data,
            value: value,
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: listing.chain
        )

        // 更新状态
        var updatedListing = listing
        updatedListing.status = .sold
        updatedListing.buyer = wallet.address
        updatedListing.soldAt = Date()
        try await updateListing(updatedListing)

        // 添加事件
        try await addEvent(
            listingId: listing.listingId,
            eventType: .sold,
            actor: wallet.address,
            transactionHash: record.hash
        )

        // 发送事件
        listingSold.send(updatedListing)

        Logger.shared.info("[MarketplaceManager] NFT已购买: \(listing.listingId)")

        return record
    }

    // MARK: - Offers

    /// 出价
    public func makeOffer(
        wallet: Wallet,
        nftContract: String,
        tokenId: String,
        price: String,  // Wei format
        paymentToken: String? = nil,
        expiresIn: TimeInterval = 86400,  // 24 hours default
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> NFTOffer {
        guard let chain = wallet.chain else {
            throw MarketplaceError.chainNotSupported
        }

        guard let contractAddress = getMarketplaceContract(for: chain) else {
            throw MarketplaceError.contractNotDeployed
        }

        // 如果是ERC-20支付，先授权代币
        if let paymentToken = paymentToken {
            _ = try await tokenManager.approveToken(
                wallet: wallet,
                token: Token(
                    address: paymentToken,
                    chainId: chain.chainId,
                    type: .erc20,
                    name: "",
                    symbol: "",
                    decimals: 18
                ),
                spender: contractAddress,
                amount: price,
                gasLimit: gasLimit,
                gasPrice: gasPrice
            )
        }

        // 生成offer ID
        let offerId = String(offers.count + 1)

        let expiresAt = Date().addingTimeInterval(expiresIn)
        let expiresAtTimestamp = Int(expiresAt.timeIntervalSince1970)

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.marketplaceABI,
            functionName: "makeOffer",
            parameters: [
                nftContract,
                tokenId,
                price,
                paymentToken ?? "0x0000000000000000000000000000000000000000",
                String(expiresAtTimestamp)
            ],
            chain: chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: chain
        )

        // 创建出价对象
        let offer = NFTOffer(
            offerId: offerId,
            contractAddress: contractAddress,
            chainId: chain.chainId,
            nftContract: nftContract,
            tokenId: tokenId,
            buyer: wallet.address,
            price: price,
            paymentToken: paymentToken,
            status: .pending,
            expiresAt: expiresAt,
            transactionHash: record.hash
        )

        // 保存到数据库
        try await saveOffer(offer)

        // 添加到列表
        offers.append(offer)

        // 添加事件
        try await addEvent(
            offerId: offerId,
            eventType: .offerMade,
            actor: wallet.address,
            transactionHash: record.hash
        )

        // 发送事件
        offerCreated.send(offer)

        Logger.shared.info("[MarketplaceManager] 已出价: \(price) for NFT \(tokenId)")

        return offer
    }

    /// 接受出价
    public func acceptOffer(
        offer: NFTOffer,
        wallet: Wallet,
        nftOwnerAddress: String,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard offer.canAccept(walletAddress: wallet.address, ownerAddress: nftOwnerAddress) else {
            throw MarketplaceError.invalidOperation
        }

        // 编码函数调用
        let data = try contractManager.encodeFunctionCall(
            abi: ContractABI.marketplaceABI,
            functionName: "acceptOffer",
            parameters: [offer.offerId],
            chain: offer.chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: offer.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: offer.chain
        )

        // 更新状态
        var updatedOffer = offer
        updatedOffer.status = .accepted
        updatedOffer.seller = wallet.address
        updatedOffer.acceptedAt = Date()
        try await updateOffer(updatedOffer)

        // 添加事件
        try await addEvent(
            offerId: offer.offerId,
            eventType: .offerAccepted,
            actor: wallet.address,
            transactionHash: record.hash
        )

        // 发送事件
        offerAccepted.send(updatedOffer)

        Logger.shared.info("[MarketplaceManager] 出价已接受: \(offer.offerId)")

        return record
    }

    /// 取消出价
    public func cancelOffer(
        offer: NFTOffer,
        wallet: Wallet,
        gasLimit: String? = nil,
        gasPrice: String? = nil
    ) async throws -> TransactionRecord {
        guard offer.canCancel(walletAddress: wallet.address) else {
            throw MarketplaceError.invalidOperation
        }

        // 编码函数调用
        let data = try await contractManager.encodeFunctionCall(
            abi: ContractABI.marketplaceABI,
            functionName: "cancelOffer",
            parameters: [offer.offerId],
            chain: offer.chain
        )

        // 发送交易
        let record = try await transactionManager.sendContractTransaction(
            wallet: wallet,
            contractAddress: offer.contractAddress,
            data: data,
            value: "0",
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            txType: .contractInteraction,
            chain: offer.chain
        )

        // 更新状态
        var updatedOffer = offer
        updatedOffer.status = .canceled
        updatedOffer.canceledAt = Date()
        try await updateOffer(updatedOffer)

        // 添加事件
        try await addEvent(
            offerId: offer.offerId,
            eventType: .offerCanceled,
            actor: wallet.address,
            transactionHash: record.hash
        )

        Logger.shared.info("[MarketplaceManager] 出价已取消: \(offer.offerId)")

        return record
    }

    // MARK: - Query Functions

    /// 获取挂单列表（按筛选条件）
    public func getListings(filter: MarketplaceFilter, walletAddress: String) -> [NFTListing] {
        switch filter {
        case .all:
            return listings
        case .myListings:
            return listings.filter { $0.seller.lowercased() == walletAddress.lowercased() }
        case .myPurchases:
            return listings.filter { $0.buyer?.lowercased() == walletAddress.lowercased() }
        case .active:
            return listings.filter { $0.status == .active }
        case .sold:
            return listings.filter { $0.status == .sold }
        }
    }

    /// 获取NFT的出价
    public func getOffers(for nftContract: String, tokenId: String) -> [NFTOffer] {
        return offers.filter {
            $0.nftContract.lowercased() == nftContract.lowercased() &&
            $0.tokenId == tokenId &&
            $0.status == .pending &&
            !$0.isExpired
        }
    }

    /// 获取事件
    public func getEvents(for id: String) -> [MarketplaceEvent] {
        return marketplaceEvents[id] ?? []
    }

    // MARK: - Database Operations

    /// 加载数据
    private func loadData() async throws {
        try await loadListings()
        try await loadOffers()
    }

    /// 加载挂单
    private func loadListings() async throws {
        let rows = try database.prepare("SELECT * FROM nft_listings ORDER BY created_at DESC")

        listings = rows.compactMap { parseListingRow($0) }

        Logger.shared.info("[MarketplaceManager] 已加载 \(listings.count) 个挂单")
    }

    /// 保存挂单
    private func saveListing(_ listing: NFTListing) async throws {
        let sql = """
        INSERT OR REPLACE INTO nft_listings (
            id, listing_id, contract_address, chain_id, nft_contract, token_id,
            seller, price, payment_token, status, buyer, created_at, sold_at,
            canceled_at, transaction_hash, block_number, nft_name, nft_description,
            nft_image_url, collection_name, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        try database.execute(
            sql,
            listing.id,
            listing.listingId,
            listing.contractAddress,
            listing.chainId,
            listing.nftContract,
            listing.tokenId,
            listing.seller,
            listing.price,
            listing.paymentToken,
            listing.status.rawValue,
            listing.buyer,
            Int(listing.createdAt.timeIntervalSince1970),
            listing.soldAt.map { Int($0.timeIntervalSince1970) },
            listing.canceledAt.map { Int($0.timeIntervalSince1970) },
            listing.transactionHash,
            listing.blockNumber,
            listing.nftMetadata?.nftName,
            listing.nftMetadata?.nftDescription,
            listing.nftMetadata?.nftImageUrl,
            listing.nftMetadata?.collectionName,
            Int(listing.updatedAt.timeIntervalSince1970)
        )
    }

    /// 更新挂单
    private func updateListing(_ listing: NFTListing) async throws {
        try await saveListing(listing)

        // 更新内存中的挂单
        if let index = listings.firstIndex(where: { $0.id == listing.id }) {
            listings[index] = listing
        }

        // 发送更新事件
        listingUpdated.send(listing)
    }

    /// 加载出价
    private func loadOffers() async throws {
        let rows = try database.prepare("SELECT * FROM nft_offers ORDER BY created_at DESC")

        offers = rows.compactMap { parseOfferRow($0) }

        Logger.shared.info("[MarketplaceManager] 已加载 \(offers.count) 个出价")
    }

    /// 保存出价
    private func saveOffer(_ offer: NFTOffer) async throws {
        let sql = """
        INSERT OR REPLACE INTO nft_offers (
            id, offer_id, contract_address, chain_id, nft_contract, token_id,
            buyer, price, payment_token, status, seller, expires_at, created_at,
            accepted_at, canceled_at, transaction_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        try database.execute(
            sql,
            offer.id,
            offer.offerId,
            offer.contractAddress,
            offer.chainId,
            offer.nftContract,
            offer.tokenId,
            offer.buyer,
            offer.price,
            offer.paymentToken,
            offer.status.rawValue,
            offer.seller,
            Int(offer.expiresAt.timeIntervalSince1970),
            Int(offer.createdAt.timeIntervalSince1970),
            offer.acceptedAt.map { Int($0.timeIntervalSince1970) },
            offer.canceledAt.map { Int($0.timeIntervalSince1970) },
            offer.transactionHash,
            Int(offer.updatedAt.timeIntervalSince1970)
        )
    }

    /// 更新出价
    private func updateOffer(_ offer: NFTOffer) async throws {
        try await saveOffer(offer)

        // 更新内存中的出价
        if let index = offers.firstIndex(where: { $0.id == offer.id }) {
            offers[index] = offer
        }
    }

    /// 添加事件
    private func addEvent(
        listingId: String? = nil,
        offerId: String? = nil,
        eventType: MarketplaceEventType,
        actor: String,
        transactionHash: String? = nil
    ) async throws {
        let event = MarketplaceEvent(
            listingId: listingId,
            offerId: offerId,
            eventType: eventType,
            actor: actor,
            transactionHash: transactionHash
        )

        let sql = """
        INSERT INTO marketplace_events (
            id, listing_id, offer_id, event_type, actor, timestamp, transaction_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """

        try database.execute(
            sql,
            event.id,
            event.listingId,
            event.offerId,
            event.eventType.rawValue,
            event.actor,
            Int(event.timestamp.timeIntervalSince1970),
            event.transactionHash
        )

        // 添加到内存
        let key = listingId ?? offerId ?? ""
        var events = marketplaceEvents[key] ?? []
        events.append(event)
        marketplaceEvents[key] = events
    }

    /// 解析挂单行
    private func parseListingRow(_ row: [String: Any]) -> NFTListing? {
        guard
            let id = row["id"] as? String,
            let listingId = row["listing_id"] as? String,
            let contractAddress = row["contract_address"] as? String,
            let chainId = row["chain_id"] as? Int,
            let nftContract = row["nft_contract"] as? String,
            let tokenId = row["token_id"] as? String,
            let seller = row["seller"] as? String,
            let price = row["price"] as? String,
            let statusRaw = row["status"] as? Int,
            let status = ListingStatus(rawValue: statusRaw),
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int
        else {
            return nil
        }

        let soldAt = (row["sold_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }
        let canceledAt = (row["canceled_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }

        let metadata = NFTListingMetadata(
            nftName: row["nft_name"] as? String,
            nftDescription: row["nft_description"] as? String,
            nftImageUrl: row["nft_image_url"] as? String,
            collectionName: row["collection_name"] as? String
        )

        return NFTListing(
            id: id,
            listingId: listingId,
            contractAddress: contractAddress,
            chainId: chainId,
            nftContract: nftContract,
            tokenId: tokenId,
            seller: seller,
            price: price,
            paymentToken: row["payment_token"] as? String,
            status: status,
            buyer: row["buyer"] as? String,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
            soldAt: soldAt,
            canceledAt: canceledAt,
            transactionHash: row["transaction_hash"] as? String,
            blockNumber: row["block_number"] as? String,
            nftMetadata: metadata,
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
        )
    }

    /// 解析出价行
    private func parseOfferRow(_ row: [String: Any]) -> NFTOffer? {
        guard
            let id = row["id"] as? String,
            let offerId = row["offer_id"] as? String,
            let contractAddress = row["contract_address"] as? String,
            let chainId = row["chain_id"] as? Int,
            let nftContract = row["nft_contract"] as? String,
            let tokenId = row["token_id"] as? String,
            let buyer = row["buyer"] as? String,
            let price = row["price"] as? String,
            let statusRaw = row["status"] as? Int,
            let status = OfferStatus(rawValue: statusRaw),
            let expiresAtTimestamp = row["expires_at"] as? Int,
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int
        else {
            return nil
        }

        let acceptedAt = (row["accepted_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }
        let canceledAt = (row["canceled_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }

        return NFTOffer(
            id: id,
            offerId: offerId,
            contractAddress: contractAddress,
            chainId: chainId,
            nftContract: nftContract,
            tokenId: tokenId,
            buyer: buyer,
            price: price,
            paymentToken: row["payment_token"] as? String,
            status: status,
            seller: row["seller"] as? String,
            expiresAt: Date(timeIntervalSince1970: TimeInterval(expiresAtTimestamp)),
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
            acceptedAt: acceptedAt,
            canceledAt: canceledAt,
            transactionHash: row["transaction_hash"] as? String,
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
        )
    }

    // MARK: - Cleanup

    /// 清理资源
    public func cleanup() {
        listings.removeAll()
        offers.removeAll()
        marketplaceEvents.removeAll()

        Logger.shared.info("[MarketplaceManager] 资源已清理")
    }
}

// MARK: - Errors

public enum MarketplaceError: Error, LocalizedError {
    case chainNotSupported
    case contractNotDeployed
    case invalidOperation
    case insufficientBalance
    case notApproved

    public var errorDescription: String? {
        switch self {
        case .chainNotSupported:
            return "不支持的区块链"
        case .contractNotDeployed:
            return "市场合约未部署"
        case .invalidOperation:
            return "无效的操作"
        case .insufficientBalance:
            return "余额不足"
        case .notApproved:
            return "未授权"
        }
    }
}
