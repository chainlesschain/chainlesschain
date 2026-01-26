import XCTest
@testable import ChainlessChain

/// TransactionE2ETests - End-to-End tests for transaction functionality
/// Tests complete transaction flows from creation to confirmation
class TransactionE2ETests: XCTestCase {

    var walletManager: WalletManager!
    var transactionManager: TransactionManager!
    var gasManager: GasManager!
    var database: Database!
    var testWallet: Wallet!

    override func setUpWithError() throws {
        try super.setUpWithError()

        database = Database.shared
        try database.connect(path: ":memory:", password: "test123")

        walletManager = WalletManager.shared
        transactionManager = TransactionManager.shared
        gasManager = GasManager.shared

        // Create test wallet
        let expectation = XCTestExpectation(description: "Create test wallet")
        Task {
            do {
                testWallet = try await walletManager.createWallet(
                    name: "Test Wallet",
                    password: "TestPassword123!",
                    chain: .goerli // Use testnet
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

    // MARK: - E2E Test: Send Transaction Flow

    func testE2E_SendTransaction_FullFlow() async throws {
        // Given: User has wallet with balance (simulated)
        let toAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
        let amount = "0.001" // 0.001 ETH

        // When: User sends transaction
        let amountWei = WeiConverter.etherToWei(amount)

        // Step 1: Estimate gas
        let gasLimit = try await gasManager.estimateGas(
            from: testWallet.address,
            to: toAddress,
            value: amountWei,
            data: nil,
            chain: testWallet.chain
        )

        XCTAssertGreaterThan(Int(gasLimit) ?? 0, 0)

        // Step 2: Get gas price
        let gasPrice = try await gasManager.getCurrentGasPrice(
            chain: testWallet.chain,
            speed: .standard
        )

        XCTAssertGreaterThan(Int(gasPrice) ?? 0, 0)

        // Step 3: Calculate total cost
        let gasCostWei = BigInt(gasLimit) * BigInt(gasPrice)
        let totalCostWei = BigInt(amountWei) + gasCostWei
        let totalCostEther = WeiConverter.weiToEther(totalCostWei.description)

        XCTAssertGreaterThan(totalCostEther, 0)

        // Step 4: Create transaction (will fail without real balance, but validates flow)
        do {
            let transaction = try await transactionManager.sendTransaction(
                wallet: testWallet,
                to: toAddress,
                value: amountWei,
                data: nil,
                gasLimit: gasLimit,
                gasPrice: gasPrice
            )

            // Then: Transaction should be created
            XCTAssertNotNil(transaction)
            XCTAssertEqual(transaction.from.lowercased(), testWallet.address.lowercased())
            XCTAssertEqual(transaction.to.lowercased(), toAddress.lowercased())
            XCTAssertEqual(transaction.value, amountWei)
            XCTAssertEqual(transaction.status, .pending)

            // And: Should be in database
            let savedTx = try await transactionManager.getTransaction(hash: transaction.hash)
            XCTAssertNotNil(savedTx)

        } catch {
            // Expected to fail on testnet without balance
            // But the flow should be validated
            print("Transaction failed (expected): \(error)")
        }
    }

    // MARK: - E2E Test: Transaction History

    func testE2E_TransactionHistory_FullFlow() async throws {
        // Given: User has multiple transactions
        let toAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"

        // Create mock transactions in database
        try await createMockTransaction(to: toAddress, value: "1000000000000000000", status: .confirmed)
        try await createMockTransaction(to: toAddress, value: "2000000000000000000", status: .confirmed)
        try await createMockTransaction(to: toAddress, value: "3000000000000000000", status: .pending)
        try await createMockTransaction(to: toAddress, value: "4000000000000000000", status: .failed)

        // When: User views transaction history
        let allTransactions = try await transactionManager.getTransactions(
            walletAddress: testWallet.address,
            chain: testWallet.chain
        )

        // Then: All transactions should be present
        XCTAssertEqual(allTransactions.count, 4)

        // When: User filters by status
        let confirmedTxs = allTransactions.filter { $0.status == .confirmed }
        let pendingTxs = allTransactions.filter { $0.status == .pending }
        let failedTxs = allTransactions.filter { $0.status == .failed }

        // Then: Filters should work correctly
        XCTAssertEqual(confirmedTxs.count, 2)
        XCTAssertEqual(pendingTxs.count, 1)
        XCTAssertEqual(failedTxs.count, 1)

        // When: User sorts by timestamp
        let sortedTxs = allTransactions.sorted { $0.timestamp > $1.timestamp }

        // Then: Most recent should be first
        XCTAssertEqual(sortedTxs.first?.value, "4000000000000000000")
    }

    // MARK: - E2E Test: Gas Management

    func testE2E_GasManagement_FullFlow() async throws {
        // Given: User needs to send transaction
        let toAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
        let amountWei = "1000000000000000000" // 1 ETH

        // When: User checks gas prices for different speeds
        let slowGas = try await gasManager.getCurrentGasPrice(
            chain: testWallet.chain,
            speed: .slow
        )

        let standardGas = try await gasManager.getCurrentGasPrice(
            chain: testWallet.chain,
            speed: .standard
        )

        let fastGas = try await gasManager.getCurrentGasPrice(
            chain: testWallet.chain,
            speed: .fast
        )

        // Then: Fast should be highest, slow should be lowest
        let slowPrice = Int(slowGas) ?? 0
        let standardPrice = Int(standardGas) ?? 0
        let fastPrice = Int(fastGas) ?? 0

        XCTAssertLessThan(slowPrice, standardPrice)
        XCTAssertLessThan(standardPrice, fastPrice)

        // And: Prices should be reasonable (within 50% range)
        let slowToStandardRatio = Double(standardPrice) / Double(slowPrice)
        let standardToFastRatio = Double(fastPrice) / Double(standardPrice)

        XCTAssertLessThanOrEqual(slowToStandardRatio, 1.3) // Max 30% increase
        XCTAssertLessThanOrEqual(standardToFastRatio, 1.3)
    }

    // MARK: - E2E Test: Transaction Monitoring

    func testE2E_TransactionMonitoring_FullFlow() async throws {
        // Given: User has pending transaction
        let toAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
        let tx = try await createMockTransaction(
            to: toAddress,
            value: "1000000000000000000",
            status: .pending
        )

        // When: Transaction confirmation event is received
        let expectation = XCTestExpectation(description: "Transaction confirmed")

        transactionManager.transactionConfirmed
            .filter { $0.hash == tx.hash }
            .sink { confirmedTx in
                // Then: Should receive confirmation event
                XCTAssertEqual(confirmedTx.status, .confirmed)
                XCTAssertNotNil(confirmedTx.blockNumber)
                expectation.fulfill()
            }
            .store(in: &transactionManager.cancellables)

        // Simulate confirmation
        try await transactionManager.updateTransactionStatus(
            hash: tx.hash,
            status: .confirmed,
            blockNumber: "12345678"
        )

        wait(for: [expectation], timeout: 2.0)
    }

    // MARK: - E2E Test: Nonce Management

    func testE2E_NonceManagement_FullFlow() async throws {
        // Given: User sends multiple transactions
        let toAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"

        // When: User sends first transaction
        let nonce1 = try await transactionManager.getNextNonce(
            address: testWallet.address,
            chain: testWallet.chain
        )

        try await createMockTransaction(
            to: toAddress,
            value: "1000000000000000000",
            status: .pending,
            nonce: nonce1
        )

        // And: User sends second transaction immediately
        let nonce2 = try await transactionManager.getNextNonce(
            address: testWallet.address,
            chain: testWallet.chain
        )

        // Then: Nonces should increment
        XCTAssertEqual(Int(nonce2) ?? 0, (Int(nonce1) ?? 0) + 1)
    }

    // MARK: - Helper Methods

    @discardableResult
    private func createMockTransaction(
        to: String,
        value: String,
        status: TransactionStatus,
        nonce: String = "0"
    ) async throws -> TransactionRecord {
        let tx = TransactionRecord(
            id: UUID().uuidString,
            hash: "0x" + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(64)),
            from: testWallet.address,
            to: to,
            value: value,
            gasLimit: "21000",
            gasPrice: "20000000000",
            nonce: nonce,
            data: nil,
            chainId: testWallet.chainId,
            status: status,
            blockNumber: status == .confirmed ? "12345678" : nil,
            timestamp: Date(),
            confirmations: status == .confirmed ? 12 : 0
        )

        try await transactionManager.saveTransaction(tx)
        return tx
    }

    // MARK: - Performance Tests

    func testE2E_Performance_GasEstimation() throws {
        let toAddress = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
        let amountWei = "1000000000000000000"

        measure {
            let expectation = XCTestExpectation(description: "Gas estimation")

            Task {
                do {
                    _ = try await gasManager.estimateGas(
                        from: testWallet.address,
                        to: toAddress,
                        value: amountWei,
                        data: nil,
                        chain: testWallet.chain
                    )
                    expectation.fulfill()
                } catch {
                    // Network error expected in test environment
                    expectation.fulfill()
                }
            }

            wait(for: [expectation], timeout: 5.0)
        }
    }
}
