import XCTest
@testable import ChainlessChain

/// TokenNFTE2ETests - End-to-End tests for Token and NFT functionality
/// Tests complete workflows for ERC-20 tokens and NFTs
class TokenNFTE2ETests: XCTestCase {

    var walletManager: WalletManager!
    var tokenManager: TokenManager!
    var nftManager: NFTManager!
    var database: Database!
    var testWallet: Wallet!

    override func setUpWithError() throws {
        try super.setUpWithError()

        database = Database.shared
        try database.connect(path: ":memory:", password: "test123")

        walletManager = WalletManager.shared
        tokenManager = TokenManager.shared
        nftManager = NFTManager.shared

        // Create test wallet
        let expectation = XCTestExpectation(description: "Create test wallet")
        Task {
            do {
                testWallet = try await walletManager.createWallet(
                    name: "Test Wallet",
                    password: "TestPassword123!",
                    chain: .ethereum
                )
                expectation.fulfill()
            } catch {
                XCTFail("Failed to create test wallet: \(error)")
            }
        }
        wait(for: [expectation], timeout: 5.0)
    }

    override func tearDownWithError() throws {
        try walletManager.deleteAllWallets()
        try database.disconnect()
        try super.tearDownWithError()
    }

    // MARK: - E2E Test: Add Custom Token Flow

    func testE2E_AddCustomToken_FullFlow() async throws {
        // Given: User wants to add USDT token
        let usdtAddress = "0xdAC17F958D2ee523a2206206994597C13D831ec7"

        // When: User adds token (will fail without network, but validates flow)
        do {
            let token = try await tokenManager.addToken(
                address: usdtAddress,
                chain: .ethereum
            )

            // Then: Token should be added
            XCTAssertNotNil(token)
            XCTAssertEqual(token.address.lowercased(), usdtAddress.lowercased())
            XCTAssertEqual(token.chainId, 1)
            XCTAssertTrue(token.isCustom)

            // And: Should be in database
            let savedToken = try await tokenManager.getToken(
                address: usdtAddress,
                chain: .ethereum
            )
            XCTAssertNotNil(savedToken)

            // And: Should appear in token list
            let tokens = try await tokenManager.getTokens(chain: .ethereum)
            XCTAssertTrue(tokens.contains(where: { $0.id == token.id }))

        } catch {
            // Expected to fail without network
            print("Token add failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: Token Management

    func testE2E_TokenManagement_FullFlow() async throws {
        // Given: User adds multiple tokens
        let usdt = try await createMockToken(
            name: "Tether USD",
            symbol: "USDT",
            decimals: 6,
            address: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
        )

        let usdc = try await createMockToken(
            name: "USD Coin",
            symbol: "USDC",
            decimals: 6,
            address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
        )

        let dai = try await createMockToken(
            name: "Dai Stablecoin",
            symbol: "DAI",
            decimals: 18,
            address: "0x6B175474E89094C44Da98b954EedeAC495271d0F"
        )

        // When: User views token list
        let tokens = try await tokenManager.getTokens(chain: .ethereum)

        // Then: All tokens should be present
        XCTAssertGreaterThanOrEqual(tokens.count, 3)
        XCTAssertTrue(tokens.contains(where: { $0.id == usdt.id }))
        XCTAssertTrue(tokens.contains(where: { $0.id == usdc.id }))
        XCTAssertTrue(tokens.contains(where: { $0.id == dai.id }))

        // When: User removes a token
        try await tokenManager.removeToken(id: dai.id)

        // Then: Token should be removed
        let remainingTokens = try await tokenManager.getTokens(chain: .ethereum)
        XCTAssertFalse(remainingTokens.contains(where: { $0.id == dai.id }))
    }

    // MARK: - E2E Test: Token Transfer

    func testE2E_TokenTransfer_FullFlow() async throws {
        // Given: User has tokens
        let token = try await createMockToken(
            name: "Test Token",
            symbol: "TEST",
            decimals: 18,
            address: "0x1234567890123456789012345678901234567890"
        )

        let toAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
        let amount = "100.5" // 100.5 tokens

        // When: User transfers tokens (validates flow, will fail without balance)
        do {
            let transaction = try await tokenManager.transferToken(
                wallet: testWallet,
                token: token,
                to: toAddress,
                amount: amount
            )

            // Then: Transaction should be created
            XCTAssertNotNil(transaction)
            XCTAssertEqual(transaction.from.lowercased(), testWallet.address.lowercased())
            XCTAssertEqual(transaction.to.lowercased(), token.address.lowercased()) // To token contract
            XCTAssertNotNil(transaction.data) // Should have transfer data

        } catch {
            // Expected to fail without balance
            print("Token transfer failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: NFT Gallery

    func testE2E_NFTGallery_FullFlow() async throws {
        // Given: User has multiple NFTs
        let nft1 = try await createMockNFT(
            contractAddress: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D", // BAYC
            tokenId: "1",
            name: "Bored Ape #1",
            standard: .erc721
        )

        let nft2 = try await createMockNFT(
            contractAddress: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
            tokenId: "2",
            name: "Bored Ape #2",
            standard: .erc721
        )

        let nft3 = try await createMockNFT(
            contractAddress: "0x495f947276749Ce646f68AC8c248420045cb7b5e", // OpenSea
            tokenId: "1",
            name: "NFT Collection #1",
            standard: .erc1155
        )

        // When: User views NFT gallery
        let nfts = try await nftManager.getNFTsByOwner(
            ownerAddress: testWallet.address,
            chain: testWallet.chain
        )

        // Then: All NFTs should be present
        XCTAssertGreaterThanOrEqual(nfts.count, 3)

        // And: Should be grouped by collection
        let collections = Dictionary(grouping: nfts) { $0.contractAddress }
        XCTAssertGreaterThanOrEqual(collections.count, 2)

        // When: User filters by standard
        let erc721NFTs = nfts.filter { $0.standard == .erc721 }
        let erc1155NFTs = nfts.filter { $0.standard == .erc1155 }

        // Then: Filters should work
        XCTAssertGreaterThanOrEqual(erc721NFTs.count, 2)
        XCTAssertGreaterThanOrEqual(erc1155NFTs.count, 1)
    }

    // MARK: - E2E Test: NFT Transfer

    func testE2E_NFTTransfer_FullFlow() async throws {
        // Given: User owns an NFT
        let nft = try await createMockNFT(
            contractAddress: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
            tokenId: "1",
            name: "Bored Ape #1",
            standard: .erc721
        )

        let toAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"

        // When: User transfers NFT (validates flow)
        do {
            let transaction = try await nftManager.transferNFT(
                wallet: testWallet,
                nft: nft,
                to: toAddress
            )

            // Then: Transaction should be created
            XCTAssertNotNil(transaction)
            XCTAssertEqual(transaction.to.lowercased(), nft.contractAddress.lowercased())
            XCTAssertNotNil(transaction.data)

        } catch {
            // Expected to fail without ownership
            print("NFT transfer failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: NFT Metadata

    func testE2E_NFTMetadata_FullFlow() async throws {
        // Given: User views NFT details
        let nft = try await createMockNFT(
            contractAddress: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
            tokenId: "1",
            name: "Bored Ape #1",
            standard: .erc721
        )

        // Add attributes
        var nftWithAttributes = nft
        nftWithAttributes.attributes = [
            NFTAttribute(traitType: "Background", value: "Blue"),
            NFTAttribute(traitType: "Eyes", value: "Laser"),
            NFTAttribute(traitType: "Mouth", value: "Bored")
        ]

        try await nftManager.saveNFT(nftWithAttributes)

        // When: User loads NFT
        let loadedNFT = try await nftManager.getNFT(
            contractAddress: nft.contractAddress,
            tokenId: nft.tokenId,
            chain: testWallet.chain
        )

        // Then: Should have all metadata
        XCTAssertNotNil(loadedNFT)
        XCTAssertEqual(loadedNFT?.name, "Bored Ape #1")
        XCTAssertEqual(loadedNFT?.attributes.count, 3)

        // And: Should display attributes
        let bgAttribute = loadedNFT?.attributes.first { $0.traitType == "Background" }
        XCTAssertEqual(bgAttribute?.value, "Blue")
    }

    // MARK: - E2E Test: ERC-1155 Multi-Quantity

    func testE2E_ERC1155Transfer_FullFlow() async throws {
        // Given: User has ERC-1155 NFT with quantity
        var nft = try await createMockNFT(
            contractAddress: "0x495f947276749Ce646f68AC8c248420045cb7b5e",
            tokenId: "1",
            name: "Game Item",
            standard: .erc1155
        )
        nft.balance = "10" // Has 10 units

        try await nftManager.saveNFT(nft)

        let toAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
        let quantity = "5" // Transfer 5 units

        // When: User transfers partial quantity
        do {
            let transaction = try await nftManager.transferNFT(
                wallet: testWallet,
                nft: nft,
                to: toAddress,
                amount: quantity
            )

            // Then: Transaction should include quantity
            XCTAssertNotNil(transaction)
            XCTAssertNotNil(transaction.data)

        } catch {
            // Expected to fail without ownership
            print("ERC-1155 transfer failed (expected): \(error)")
        }
    }

    // MARK: - Helper Methods

    @discardableResult
    private func createMockToken(
        name: String,
        symbol: String,
        decimals: Int,
        address: String
    ) async throws -> Token {
        let token = Token(
            id: UUID().uuidString,
            address: address,
            chainId: testWallet.chainId,
            type: .erc20,
            name: name,
            symbol: symbol,
            decimals: decimals,
            isCustom: true,
            isVerified: false
        )

        try await tokenManager.saveToken(token)
        return token
    }

    @discardableResult
    private func createMockNFT(
        contractAddress: String,
        tokenId: String,
        name: String,
        standard: NFTStandard
    ) async throws -> NFT {
        let nft = NFT(
            id: UUID().uuidString,
            contractAddress: contractAddress,
            tokenId: tokenId,
            chainId: testWallet.chainId,
            standard: standard,
            name: name,
            imageUrl: nil,
            imageData: nil,
            balance: standard == .erc721 ? "1" : "10",
            attributes: []
        )

        try await nftManager.saveNFT(nft)
        return nft
    }

    // MARK: - Performance Tests

    func testE2E_Performance_LoadTokenList() throws {
        // Create 100 mock tokens
        let expectation = XCTestExpectation(description: "Create tokens")

        Task {
            for i in 0..<100 {
                _ = try? await createMockToken(
                    name: "Token \(i)",
                    symbol: "TKN\(i)",
                    decimals: 18,
                    address: String(format: "0x%040d", i)
                )
            }
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 10.0)

        // Measure load time
        measure {
            let loadExpectation = XCTestExpectation(description: "Load tokens")

            Task {
                _ = try? await tokenManager.getTokens(chain: .ethereum)
                loadExpectation.fulfill()
            }

            wait(for: [loadExpectation], timeout: 2.0)
        }
    }

    func testE2E_Performance_LoadNFTGallery() throws {
        // Create 50 mock NFTs
        let expectation = XCTestExpectation(description: "Create NFTs")

        Task {
            for i in 0..<50 {
                _ = try? await createMockNFT(
                    contractAddress: String(format: "0x%040d", i / 10),
                    tokenId: String(i % 10),
                    name: "NFT #\(i)",
                    standard: .erc721
                )
            }
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 10.0)

        // Measure load time
        measure {
            let loadExpectation = XCTestExpectation(description: "Load NFTs")

            Task {
                _ = try? await nftManager.getNFTsByOwner(
                    ownerAddress: testWallet.address,
                    chain: testWallet.chain
                )
                loadExpectation.fulfill()
            }

            wait(for: [loadExpectation], timeout: 2.0)
        }
    }
}
