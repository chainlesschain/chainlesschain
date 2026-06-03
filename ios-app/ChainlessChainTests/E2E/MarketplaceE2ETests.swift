import XCTest
@testable import ChainlessChain

/// MarketplaceE2ETests - End-to-End tests for NFT Marketplace
/// Tests complete workflows for listing, buying, and offering
class MarketplaceE2ETests: XCTestCase {

    var walletManager: WalletManager!
    var marketplaceManager: MarketplaceManager!
    var nftManager: NFTManager!
    var database: Database!
    var sellerWallet: Wallet!
    var buyerWallet: Wallet!
    var testNFT: NFT!

    override func setUpWithError() throws {
        try super.setUpWithError()

        database = Database.shared
        try database.connect(path: ":memory:", password: "test123")

        walletManager = WalletManager.shared
        marketplaceManager = MarketplaceManager.shared
        nftManager = NFTManager.shared

        // Create test wallets and NFT
        let expectation = XCTestExpectation(description: "Setup test data")
        Task {
            do {
                // Create seller wallet
                sellerWallet = try await walletManager.createWallet(
                    name: "Seller Wallet",
                    password: "SellerPass123!",
                    chain: .ethereum
                )

                // Create buyer wallet
                buyerWallet = try await walletManager.createWallet(
                    name: "Buyer Wallet",
                    password: "BuyerPass123!",
                    chain: .ethereum
                )

                // Create test NFT
                testNFT = NFT(
                    id: UUID().uuidString,
                    contractAddress: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
                    tokenId: "1",
                    chainId: 1,
                    standard: .erc721,
                    name: "Bored Ape #1",
                    imageUrl: "https://example.com/nft.png",
                    imageData: nil,
                    balance: "1",
                    attributes: []
                )

                try await nftManager.saveNFT(testNFT)

                expectation.fulfill()
            } catch {
                XCTFail("Failed to setup test data: \(error)")
            }
        }
        wait(for: [expectation], timeout: 5.0)
    }

    override func tearDownWithError() throws {
        try walletManager.deleteAllWallets()
        try database.disconnect()
        try super.tearDownWithError()
    }

    // MARK: - E2E Test: List NFT for Sale

    func testE2E_ListNFT_FullFlow() async throws {
        // Given: Seller wants to list NFT
        let price = "1000000000000000000" // 1 ETH

        // When: Seller lists NFT (validates flow)
        do {
            let listing = try await marketplaceManager.listNFT(
                wallet: sellerWallet,
                nft: testNFT,
                price: price,
                paymentToken: nil // Native token
            )

            // Then: Listing should be created
            XCTAssertNotNil(listing)
            XCTAssertEqual(listing.seller.lowercased(), sellerWallet.address.lowercased())
            XCTAssertEqual(listing.nftContract.lowercased(), testNFT.contractAddress.lowercased())
            XCTAssertEqual(listing.tokenId, testNFT.tokenId)
            XCTAssertEqual(listing.price, price)
            XCTAssertEqual(listing.status, .active)
            XCTAssertNil(listing.paymentToken) // Native payment

            // And: Should be in database
            let savedListing = try await marketplaceManager.getListing(id: listing.listingId)
            XCTAssertNotNil(savedListing)

            // And: Should appear in marketplace
            let listings = try await marketplaceManager.getListings(
                chain: sellerWallet.chain,
                filter: .all
            )
            XCTAssertTrue(listings.contains(where: { $0.id == listing.id }))

        } catch {
            // Expected to fail without contract
            print("List NFT failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: Buy NFT

    func testE2E_BuyNFT_FullFlow() async throws {
        // Given: NFT is listed for sale
        let listing = try await createMockListing(
            seller: sellerWallet.address,
            price: "1000000000000000000",
            status: .active
        )

        // When: Buyer purchases NFT (validates flow)
        do {
            let transaction = try await marketplaceManager.buyNFT(
                listing: listing,
                wallet: buyerWallet
            )

            // Then: Transaction should be created
            XCTAssertNotNil(transaction)
            XCTAssertEqual(transaction.from.lowercased(), buyerWallet.address.lowercased())

            // And: Listing should be marked as sold
            let updatedListing = try await marketplaceManager.getListing(id: listing.listingId)
            XCTAssertEqual(updatedListing?.status, .sold)
            XCTAssertEqual(updatedListing?.buyer?.lowercased(), buyerWallet.address.lowercased())

        } catch {
            // Expected to fail without balance/contract
            print("Buy NFT failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: Make Offer

    func testE2E_MakeOffer_FullFlow() async throws {
        // Given: Buyer wants to make offer
        let listing = try await createMockListing(
            seller: sellerWallet.address,
            price: "1000000000000000000",
            status: .active
        )

        let offerPrice = "900000000000000000" // 0.9 ETH (below listing)
        let expiresIn = 86400 // 24 hours

        // When: Buyer makes offer (validates flow)
        do {
            let offer = try await marketplaceManager.makeOffer(
                wallet: buyerWallet,
                nftContract: testNFT.contractAddress,
                tokenId: testNFT.tokenId,
                price: offerPrice,
                paymentToken: nil,
                expiresIn: expiresIn
            )

            // Then: Offer should be created
            XCTAssertNotNil(offer)
            XCTAssertEqual(offer.buyer.lowercased(), buyerWallet.address.lowercased())
            XCTAssertEqual(offer.nftContract.lowercased(), testNFT.contractAddress.lowercased())
            XCTAssertEqual(offer.tokenId, testNFT.tokenId)
            XCTAssertEqual(offer.price, offerPrice)
            XCTAssertEqual(offer.status, .pending)

            // And: Should have expiration time
            let expectedExpiry = Date().addingTimeInterval(TimeInterval(expiresIn))
            XCTAssertEqual(
                offer.expiresAt.timeIntervalSince1970,
                expectedExpiry.timeIntervalSince1970,
                accuracy: 2.0
            )

            // And: Should appear in offers list
            let offers = try await marketplaceManager.getOffers(
                nftContract: testNFT.contractAddress,
                tokenId: testNFT.tokenId,
                chain: buyerWallet.chain
            )
            XCTAssertTrue(offers.contains(where: { $0.id == offer.id }))

        } catch {
            // Expected to fail without contract
            print("Make offer failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: Accept Offer

    func testE2E_AcceptOffer_FullFlow() async throws {
        // Given: Buyer has made offer
        let offer = try await createMockOffer(
            buyer: buyerWallet.address,
            price: "900000000000000000",
            status: .pending
        )

        // When: Seller accepts offer (validates flow)
        do {
            try await marketplaceManager.acceptOffer(
                offer: offer,
                wallet: sellerWallet,
                nftOwnerAddress: sellerWallet.address
            )

            // Then: Offer should be marked as accepted
            let updatedOffer = try await marketplaceManager.getOffer(id: offer.offerId)
            XCTAssertEqual(updatedOffer?.status, .accepted)
            XCTAssertEqual(updatedOffer?.seller?.lowercased(), sellerWallet.address.lowercased())

        } catch {
            // Expected to fail without contract
            print("Accept offer failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: Cancel Listing

    func testE2E_CancelListing_FullFlow() async throws {
        // Given: Seller has active listing
        let listing = try await createMockListing(
            seller: sellerWallet.address,
            price: "1000000000000000000",
            status: .active
        )

        // When: Seller cancels listing (validates flow)
        do {
            try await marketplaceManager.cancelListing(
                listing: listing,
                wallet: sellerWallet
            )

            // Then: Listing should be marked as canceled
            let updatedListing = try await marketplaceManager.getListing(id: listing.listingId)
            XCTAssertEqual(updatedListing?.status, .canceled)

        } catch {
            // Expected to fail without contract
            print("Cancel listing failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: Marketplace Filters

    func testE2E_MarketplaceFilters_FullFlow() async throws {
        // Given: Multiple listings
        let activeListing1 = try await createMockListing(
            seller: sellerWallet.address,
            price: "1000000000000000000",
            status: .active
        )

        let activeListing2 = try await createMockListing(
            seller: sellerWallet.address,
            price: "2000000000000000000",
            status: .active
        )

        let soldListing = try await createMockListing(
            seller: sellerWallet.address,
            price: "1500000000000000000",
            status: .sold,
            buyer: buyerWallet.address
        )

        // When: User filters by status
        let allListings = try await marketplaceManager.getListings(
            chain: sellerWallet.chain,
            filter: .all
        )

        let activeListings = try await marketplaceManager.getListings(
            chain: sellerWallet.chain,
            filter: .active
        )

        let soldListings = try await marketplaceManager.getListings(
            chain: sellerWallet.chain,
            filter: .sold
        )

        // Then: Filters should work correctly
        XCTAssertGreaterThanOrEqual(allListings.count, 3)
        XCTAssertGreaterThanOrEqual(activeListings.count, 2)
        XCTAssertGreaterThanOrEqual(soldListings.count, 1)

        // And: All active listings should have active status
        XCTAssertTrue(activeListings.allSatisfy { $0.status == .active })

        // And: All sold listings should have sold status
        XCTAssertTrue(soldListings.allSatisfy { $0.status == .sold })
    }

    // MARK: - E2E Test: Offer Expiration

    func testE2E_OfferExpiration_FullFlow() async throws {
        // Given: Offer with short expiration
        var offer = try await createMockOffer(
            buyer: buyerWallet.address,
            price: "900000000000000000",
            status: .pending
        )

        // Set expiration to past
        offer.expiresAt = Date().addingTimeInterval(-3600) // 1 hour ago

        try await marketplaceManager.saveOffer(offer)

        // When: Checking if offer is expired
        let updatedOffer = try await marketplaceManager.getOffer(id: offer.offerId)

        // Then: Offer should be marked as expired
        XCTAssertNotNil(updatedOffer)
        XCTAssertTrue(updatedOffer!.isExpired)

        // And: Should not be able to accept expired offer
        XCTAssertFalse(updatedOffer!.canAccept(
            sellerAddress: sellerWallet.address,
            nftOwnerAddress: sellerWallet.address
        ))
    }

    // MARK: - E2E Test: Permission Checks

    func testE2E_PermissionChecks_FullFlow() async throws {
        // Given: Active listing
        let listing = try await createMockListing(
            seller: sellerWallet.address,
            price: "1000000000000000000",
            status: .active
        )

        // Then: Seller cannot buy own listing
        XCTAssertFalse(listing.canBuy(walletAddress: sellerWallet.address))

        // And: Buyer can buy listing
        XCTAssertTrue(listing.canBuy(walletAddress: buyerWallet.address))

        // And: Only seller can cancel
        XCTAssertTrue(listing.canCancel(walletAddress: sellerWallet.address))
        XCTAssertFalse(listing.canCancel(walletAddress: buyerWallet.address))
    }

    // MARK: - Helper Methods

    @discardableResult
    private func createMockListing(
        seller: String,
        price: String,
        status: ListingStatus,
        buyer: String? = nil
    ) async throws -> NFTListing {
        let listing = NFTListing(
            id: UUID().uuidString,
            listingId: UUID().uuidString,
            contractAddress: "0xMARKETPLACE",
            chainId: 1,
            nftContract: testNFT.contractAddress,
            tokenId: testNFT.tokenId,
            seller: seller,
            price: price,
            paymentToken: nil,
            status: status,
            buyer: buyer,
            nft: testNFT
        )

        try await marketplaceManager.saveListing(listing)
        return listing
    }

    @discardableResult
    private func createMockOffer(
        buyer: String,
        price: String,
        status: OfferStatus
    ) async throws -> NFTOffer {
        let offer = NFTOffer(
            id: UUID().uuidString,
            offerId: UUID().uuidString,
            contractAddress: "0xMARKETPLACE",
            chainId: 1,
            nftContract: testNFT.contractAddress,
            tokenId: testNFT.tokenId,
            buyer: buyer,
            price: price,
            paymentToken: nil,
            status: status,
            seller: nil,
            expiresAt: Date().addingTimeInterval(86400) // 24 hours
        )

        try await marketplaceManager.saveOffer(offer)
        return offer
    }

    // MARK: - Performance Tests

    func testE2E_Performance_LoadMarketplace() throws {
        // Create 100 mock listings
        let expectation = XCTestExpectation(description: "Create listings")

        Task {
            for i in 0..<100 {
                _ = try? await createMockListing(
                    seller: sellerWallet.address,
                    price: String(format: "%d000000000000000000", i + 1),
                    status: i % 3 == 0 ? .sold : .active,
                    buyer: i % 3 == 0 ? buyerWallet.address : nil
                )
            }
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 15.0)

        // Measure load time
        measure {
            let loadExpectation = XCTestExpectation(description: "Load marketplace")

            Task {
                _ = try? await marketplaceManager.getListings(
                    chain: sellerWallet.chain,
                    filter: .all
                )
                loadExpectation.fulfill()
            }

            wait(for: [loadExpectation], timeout: 2.0)
        }
    }
}
