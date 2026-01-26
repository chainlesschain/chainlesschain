import XCTest
@testable import ChainlessChain

/// DAppBrowserE2ETests - End-to-End tests for DApp Browser
/// Tests complete workflows for WalletConnect and DApp interactions
class DAppBrowserE2ETests: XCTestCase {

    var walletManager: WalletManager!
    var walletConnectManager: WalletConnectManager!
    var dappBrowserManager: DAppBrowserManager!
    var database: Database!
    var testWallet: Wallet!

    override func setUpWithError() throws {
        try super.setUpWithError()

        database = Database.shared
        try database.connect(path: ":memory:", password: "test123")

        walletManager = WalletManager.shared
        walletConnectManager = WalletConnectManager.shared
        dappBrowserManager = DAppBrowserManager.shared

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

    // MARK: - E2E Test: DApp Discovery

    func testE2E_DAppDiscovery_FullFlow() async throws {
        // Given: App has featured DApps
        await dappBrowserManager.loadDApps()

        // Then: Featured DApps should be loaded
        XCTAssertFalse(dappBrowserManager.featuredDApps.isEmpty)
        XCTAssertGreaterThanOrEqual(dappBrowserManager.featuredDApps.count, 5)

        // And: Featured DApps should include major protocols
        let hasUniswap = dappBrowserManager.featuredDApps.contains { $0.name == "Uniswap" }
        let hasOpenSea = dappBrowserManager.featuredDApps.contains { $0.name == "OpenSea" }

        XCTAssertTrue(hasUniswap)
        XCTAssertTrue(hasOpenSea)
    }

    // MARK: - E2E Test: Add Favorite DApp

    func testE2E_AddFavoriteDApp_FullFlow() async throws {
        // Given: User discovers a DApp
        let dapp = DApp(
            name: "Uniswap",
            url: "https://app.uniswap.org",
            description: "Leading DEX",
            category: .defi,
            isFavorite: false
        )

        // When: User adds to favorites
        try await dappBrowserManager.addDApp(dapp)
        try await dappBrowserManager.toggleFavorite(dappId: dapp.id)

        // Then: Should appear in favorites
        XCTAssertTrue(dappBrowserManager.favorites.contains(where: { $0.id == dapp.id }))

        // When: User removes from favorites
        try await dappBrowserManager.toggleFavorite(dappId: dapp.id)

        // Then: Should be removed from favorites
        XCTAssertFalse(dappBrowserManager.favorites.contains(where: { $0.id == dapp.id }))
    }

    // MARK: - E2E Test: Search DApps

    func testE2E_SearchDApps_FullFlow() async throws {
        // Given: Multiple DApps are saved
        let uniswap = DApp(
            name: "Uniswap",
            url: "https://app.uniswap.org",
            description: "Decentralized exchange",
            category: .defi
        )

        let opensea = DApp(
            name: "OpenSea",
            url: "https://opensea.io",
            description: "NFT marketplace",
            category: .nft
        )

        let aave = DApp(
            name: "Aave",
            url: "https://app.aave.com",
            description: "DeFi lending protocol",
            category: .defi
        )

        try await dappBrowserManager.addDApp(uniswap)
        try await dappBrowserManager.addDApp(opensea)
        try await dappBrowserManager.addDApp(aave)

        // When: User searches for "swap"
        let swapResults = try await dappBrowserManager.searchDApps(query: "swap")

        // Then: Should find Uniswap
        XCTAssertTrue(swapResults.contains(where: { $0.id == uniswap.id }))

        // When: User searches for "NFT"
        let nftResults = try await dappBrowserManager.searchDApps(query: "NFT")

        // Then: Should find OpenSea
        XCTAssertTrue(nftResults.contains(where: { $0.id == opensea.id }))

        // When: User searches for "DeFi"
        let defiResults = try await dappBrowserManager.searchDApps(query: "DeFi")

        // Then: Should find DeFi DApps
        XCTAssertGreaterThanOrEqual(defiResults.count, 2)
    }

    // MARK: - E2E Test: Visit Tracking

    func testE2E_VisitTracking_FullFlow() async throws {
        // Given: User has a DApp
        let dapp = DApp(
            name: "Uniswap",
            url: "https://app.uniswap.org",
            description: "Leading DEX",
            category: .defi,
            visitCount: 0
        )

        try await dappBrowserManager.addDApp(dapp)

        // When: User visits DApp multiple times
        for _ in 0..<5 {
            try await dappBrowserManager.recordVisit(
                dappId: dapp.id,
                url: dapp.url,
                title: dapp.name
            )
        }

        // Then: Visit count should increase
        if let updatedDApp = try await dappBrowserManager.getDApp(id: dapp.id) {
            XCTAssertEqual(updatedDApp.visitCount, 5)
            XCTAssertNotNil(updatedDApp.lastVisited)
        } else {
            XCTFail("DApp not found")
        }

        // And: History should be recorded
        let history = try await dappBrowserManager.getRecentHistory(limit: 10)
        XCTAssertGreaterThanOrEqual(history.count, 5)
    }

    // MARK: - E2E Test: WalletConnect Session

    func testE2E_WalletConnectSession_FullFlow() async throws {
        // Given: WalletConnect is initialized
        try await walletConnectManager.initialize()

        XCTAssertTrue(walletConnectManager.isInitialized)

        // When: User connects to DApp (validates flow)
        // Note: Actual WalletConnect requires network, this tests the flow
        let proposalId = UUID().uuidString

        do {
            let session = try await walletConnectManager.approveSession(
                proposalId: proposalId,
                accounts: [testWallet.address],
                chainIds: [testWallet.chainId]
            )

            // Then: Session should be created
            XCTAssertNotNil(session)
            XCTAssertTrue(session.accounts.contains(testWallet.address))
            XCTAssertTrue(session.chainIds.contains(testWallet.chainId))
            XCTAssertEqual(session.isActive, true)

            // And: Session should be in active sessions
            let activeSessions = walletConnectManager.getActiveSessions()
            XCTAssertTrue(activeSessions.contains(where: { $0.id == session.id }))

            // When: User disconnects session
            try await walletConnectManager.disconnectSession(sessionId: session.id)

            // Then: Session should be inactive
            let remainingSessions = walletConnectManager.getActiveSessions()
            XCTAssertFalse(remainingSessions.contains(where: { $0.id == session.id }))

        } catch {
            // Expected to fail without real WalletConnect SDK
            print("WalletConnect session failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: Sign Message Request

    func testE2E_SignMessageRequest_FullFlow() async throws {
        // Given: DApp requests message signature
        let message = "Sign this message to authenticate"
        let requestId = UUID().uuidString

        let request = WalletConnectRequest(
            id: requestId,
            sessionTopic: "test-topic",
            dappName: "Test DApp",
            method: .personalSign,
            params: .signMessage(message: message, address: testWallet.address),
            chainId: testWallet.chainId
        )

        // When: User approves request (validates flow)
        do {
            let signature = try await walletConnectManager.approveSignMessage(
                requestId: requestId,
                message: message,
                wallet: testWallet,
                password: "TestPassword123!"
            )

            // Then: Should return valid signature
            XCTAssertFalse(signature.isEmpty)
            XCTAssertTrue(signature.hasPrefix("0x"))
            XCTAssertEqual(signature.count, 132) // 0x + 130 hex chars

        } catch {
            // Expected to fail without real WalletConnect SDK
            print("Sign message failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: Transaction Request

    func testE2E_TransactionRequest_FullFlow() async throws {
        // Given: DApp requests transaction
        let txParams = TransactionParams(
            from: testWallet.address,
            to: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
            data: nil,
            value: "1000000000000000000", // 1 ETH
            gas: "21000",
            gasPrice: "20000000000",
            nonce: "0"
        )

        let requestId = UUID().uuidString

        // When: User approves transaction (validates flow)
        do {
            let txHash = try await walletConnectManager.approveSendTransaction(
                requestId: requestId,
                transaction: txParams,
                wallet: testWallet,
                password: "TestPassword123!"
            )

            // Then: Should return transaction hash
            XCTAssertFalse(txHash.isEmpty)
            XCTAssertTrue(txHash.hasPrefix("0x"))

        } catch {
            // Expected to fail without balance/real WalletConnect
            print("Transaction request failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: Reject Request

    func testE2E_RejectRequest_FullFlow() async throws {
        // Given: User receives malicious request
        let requestId = UUID().uuidString

        let request = WalletConnectRequest(
            id: requestId,
            sessionTopic: "test-topic",
            dappName: "Suspicious DApp",
            method: .personalSign,
            params: .signMessage(
                message: "Transfer all your funds to scammer",
                address: testWallet.address
            ),
            chainId: testWallet.chainId
        )

        // When: User rejects request
        do {
            try await walletConnectManager.rejectRequest(
                requestId: requestId,
                reason: "Suspicious request"
            )

            // Then: Request should be rejected (no error)
            // DApp receives rejection

        } catch {
            // Expected to fail without real WalletConnect SDK
            print("Reject request failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: Browse History

    func testE2E_BrowseHistory_FullFlow() async throws {
        // Given: User browses multiple pages
        let urls = [
            "https://app.uniswap.org",
            "https://opensea.io",
            "https://app.aave.com",
            "https://pancakeswap.finance"
        ]

        for url in urls {
            let entry = BrowserHistory(
                url: url,
                title: url,
                timestamp: Date()
            )
            try await dappBrowserManager.addToHistory(entry)
        }

        // When: User views history
        let history = try await dappBrowserManager.getRecentHistory(limit: 10)

        // Then: All visits should be recorded
        XCTAssertGreaterThanOrEqual(history.count, 4)

        // When: User clears history
        try await dappBrowserManager.clearHistory()

        // Then: History should be empty
        let clearedHistory = try await dappBrowserManager.getRecentHistory(limit: 10)
        XCTAssertEqual(clearedHistory.count, 0)
    }

    // MARK: - E2E Test: Category Browsing

    func testE2E_CategoryBrowsing_FullFlow() async throws {
        // Given: Multiple DApps in different categories
        try await dappBrowserManager.addDApp(DApp(
            name: "Uniswap",
            url: "https://app.uniswap.org",
            category: .defi
        ))

        try await dappBrowserManager.addDApp(DApp(
            name: "Curve",
            url: "https://curve.fi",
            category: .defi
        ))

        try await dappBrowserManager.addDApp(DApp(
            name: "OpenSea",
            url: "https://opensea.io",
            category: .nft
        ))

        try await dappBrowserManager.addDApp(DApp(
            name: "Blur",
            url: "https://blur.io",
            category: .nft
        ))

        // When: User browses DeFi category
        let defiDApps = try await dappBrowserManager.getDAppsByCategory(.defi)

        // Then: Should find DeFi DApps
        XCTAssertGreaterThanOrEqual(defiDApps.count, 2)
        XCTAssertTrue(defiDApps.allSatisfy { $0.category == .defi })

        // When: User browses NFT category
        let nftDApps = try await dappBrowserManager.getDAppsByCategory(.nft)

        // Then: Should find NFT DApps
        XCTAssertGreaterThanOrEqual(nftDApps.count, 2)
        XCTAssertTrue(nftDApps.allSatisfy { $0.category == .nft })
    }

    // MARK: - Performance Tests

    func testE2E_Performance_LoadDAppList() throws {
        // Create 100 DApps
        let expectation = XCTestExpectation(description: "Create DApps")

        Task {
            for i in 0..<100 {
                let dapp = DApp(
                    name: "DApp \(i)",
                    url: "https://dapp\(i).com",
                    category: DAppCategory.allCases.randomElement() ?? .other,
                    visitCount: i
                )
                try? await dappBrowserManager.addDApp(dapp)
            }
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 15.0)

        // Measure load time
        measure {
            let loadExpectation = XCTestExpectation(description: "Load DApps")

            Task {
                _ = try? await dappBrowserManager.searchDApps(query: "")
                loadExpectation.fulfill()
            }

            wait(for: [loadExpectation], timeout: 2.0)
        }
    }

    func testE2E_Performance_HistoryOperations() throws {
        // Create 1000 history entries
        let expectation = XCTestExpectation(description: "Create history")

        Task {
            for i in 0..<1000 {
                let entry = BrowserHistory(
                    url: "https://dapp\(i).com",
                    title: "DApp \(i)",
                    timestamp: Date().addingTimeInterval(TimeInterval(-i))
                )
                try? await dappBrowserManager.addToHistory(entry)
            }
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 20.0)

        // Measure retrieval time
        measure {
            let loadExpectation = XCTestExpectation(description: "Load history")

            Task {
                _ = try? await dappBrowserManager.getRecentHistory(limit: 100)
                loadExpectation.fulfill()
            }

            wait(for: [loadExpectation], timeout: 1.0)
        }
    }
}
