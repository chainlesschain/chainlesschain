import Foundation
@testable import ChainlessChain

/// E2ETestConfig - Configuration and utilities for E2E tests
/// Provides shared test data, helpers, and configuration
enum E2ETestConfig {

    // MARK: - Test Configuration

    /// Test database path
    static let testDatabasePath = ":memory:"

    /// Test database password
    static let testDatabasePassword = "test123"

    /// Default test wallet password
    static let defaultPassword = "TestPassword123!"

    /// Test wallet name
    static let defaultWalletName = "Test Wallet"

    /// Test network (use testnet for real transactions)
    static let testChain: SupportedChain = .goerli

    // MARK: - Test Data

    /// Known test mnemonic (DO NOT USE IN PRODUCTION)
    static let testMnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

    /// Expected address for test mnemonic
    static let testMnemonicAddress = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"

    /// Test addresses
    static let testAddresses = [
        "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
        "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
        "0xdBDD957135a3dCC8D9aAB8C1e6F6E8e0C7C85a1E"
    ]

    /// Test token contracts
    static let testTokenContracts: [String: (name: String, symbol: String, decimals: Int)] = [
        "0xdAC17F958D2ee523a2206206994597C13D831ec7": ("Tether USD", "USDT", 6),
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": ("USD Coin", "USDC", 6),
        "0x6B175474E89094C44Da98b954EedeAC495271d0F": ("Dai Stablecoin", "DAI", 18)
    ]

    /// Test NFT contracts
    static let testNFTContracts: [String: String] = [
        "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D": "Bored Ape Yacht Club",
        "0x60E4d786628Fea6478F785A6d7e704777c86a7c6": "Mutant Ape Yacht Club",
        "0xED5AF388653567Af2F388E6224dC7C4b3241C544": "Azuki"
    ]

    // MARK: - Test Timeouts

    /// Short timeout for fast operations (2 seconds)
    static let shortTimeout: TimeInterval = 2.0

    /// Standard timeout for normal operations (5 seconds)
    static let standardTimeout: TimeInterval = 5.0

    /// Long timeout for slow operations (10 seconds)
    static let longTimeout: TimeInterval = 10.0

    /// Network timeout for operations requiring network (30 seconds)
    static let networkTimeout: TimeInterval = 30.0

    // MARK: - Helper Methods

    /// Generate random wallet name
    static func randomWalletName() -> String {
        return "Test Wallet \(UUID().uuidString.prefix(8))"
    }

    /// Generate random amount in Wei (between 0.001 and 1 ETH)
    static func randomAmountWei() -> String {
        let etherAmount = Double.random(in: 0.001...1.0)
        return WeiConverter.etherToWei(String(etherAmount))
    }

    /// Generate random gas price
    static func randomGasPrice() -> String {
        let gwei = Double.random(in: 20...100)
        let wei = gwei * 1_000_000_000
        return String(format: "%.0f", wei)
    }

    /// Generate random NFT token ID
    static func randomTokenId() -> String {
        return String(Int.random(in: 1...10000))
    }

    /// Create deterministic UUID from seed
    static func deterministicUUID(seed: String) -> String {
        let hash = seed.data(using: .utf8)?.base64EncodedString() ?? ""
        let hashPrefix = String(hash.prefix(32))
        return hashPrefix.padding(toLength: 36, withPad: "0", startingAt: 0)
    }

    // MARK: - Wait Helpers

    /// Wait for async operation with timeout
    static func waitForAsync(
        timeout: TimeInterval = standardTimeout,
        operation: @escaping () async throws -> Void
    ) throws {
        let expectation = XCTestExpectation(description: "Async operation")
        var error: Error?

        Task {
            do {
                try await operation()
                expectation.fulfill()
            } catch let err {
                error = err
                expectation.fulfill()
            }
        }

        let result = XCTWaiter.wait(for: [expectation], timeout: timeout)

        if let error = error {
            throw error
        }

        if result != .completed {
            throw E2ETestError.timeout
        }
    }

    /// Wait for condition to become true
    static func waitForCondition(
        timeout: TimeInterval = standardTimeout,
        pollingInterval: TimeInterval = 0.1,
        condition: () -> Bool
    ) -> Bool {
        let startTime = Date()

        while Date().timeIntervalSince(startTime) < timeout {
            if condition() {
                return true
            }
            Thread.sleep(forTimeInterval: pollingInterval)
        }

        return false
    }

    // MARK: - Validation Helpers

    /// Validate Ethereum address format
    static func isValidAddress(_ address: String) -> Bool {
        return address.hasPrefix("0x") && address.count == 42
    }

    /// Validate transaction hash format
    static func isValidTxHash(_ hash: String) -> Bool {
        return hash.hasPrefix("0x") && hash.count == 66
    }

    /// Validate signature format
    static func isValidSignature(_ signature: String) -> Bool {
        return signature.hasPrefix("0x") && signature.count == 132
    }

    /// Validate Wei amount
    static func isValidWeiAmount(_ amount: String) -> Bool {
        return Int(amount) != nil && Int(amount)! >= 0
    }
}

// MARK: - E2E Test Error

enum E2ETestError: Error {
    case timeout
    case invalidData
    case setupFailed
    case teardownFailed

    var localizedDescription: String {
        switch self {
        case .timeout:
            return "Operation timed out"
        case .invalidData:
            return "Invalid test data"
        case .setupFailed:
            return "Test setup failed"
        case .teardownFailed:
            return "Test teardown failed"
        }
    }
}

// MARK: - Test Assertions

extension XCTestCase {

    /// Assert wallet is valid
    func assertWalletValid(_ wallet: Wallet, file: StaticString = #file, line: UInt = #line) {
        XCTAssertFalse(wallet.id.isEmpty, "Wallet ID should not be empty", file: file, line: line)
        XCTAssertFalse(wallet.name.isEmpty, "Wallet name should not be empty", file: file, line: line)
        XCTAssertTrue(E2ETestConfig.isValidAddress(wallet.address), "Wallet address should be valid", file: file, line: line)
        XCTAssertGreaterThan(wallet.chainId, 0, "Chain ID should be positive", file: file, line: line)
    }

    /// Assert transaction is valid
    func assertTransactionValid(_ tx: TransactionRecord, file: StaticString = #file, line: UInt = #line) {
        XCTAssertFalse(tx.id.isEmpty, "Transaction ID should not be empty", file: file, line: line)
        XCTAssertTrue(E2ETestConfig.isValidTxHash(tx.hash), "Transaction hash should be valid", file: file, line: line)
        XCTAssertTrue(E2ETestConfig.isValidAddress(tx.from), "From address should be valid", file: file, line: line)
        XCTAssertTrue(E2ETestConfig.isValidAddress(tx.to), "To address should be valid", file: file, line: line)
        XCTAssertTrue(E2ETestConfig.isValidWeiAmount(tx.value), "Value should be valid Wei amount", file: file, line: line)
    }

    /// Assert token is valid
    func assertTokenValid(_ token: Token, file: StaticString = #file, line: UInt = #line) {
        XCTAssertFalse(token.id.isEmpty, "Token ID should not be empty", file: file, line: line)
        XCTAssertTrue(E2ETestConfig.isValidAddress(token.address), "Token address should be valid", file: file, line: line)
        XCTAssertFalse(token.symbol.isEmpty, "Token symbol should not be empty", file: file, line: line)
        XCTAssertGreaterThan(token.decimals, 0, "Token decimals should be positive", file: file, line: line)
    }

    /// Assert NFT is valid
    func assertNFTValid(_ nft: NFT, file: StaticString = #file, line: UInt = #line) {
        XCTAssertFalse(nft.id.isEmpty, "NFT ID should not be empty", file: file, line: line)
        XCTAssertTrue(E2ETestConfig.isValidAddress(nft.contractAddress), "NFT contract address should be valid", file: file, line: line)
        XCTAssertFalse(nft.tokenId.isEmpty, "NFT token ID should not be empty", file: file, line: line)
        XCTAssertGreaterThan(Int(nft.balance) ?? 0, 0, "NFT balance should be positive", file: file, line: line)
    }
}

// MARK: - Mock Data Generator

enum MockDataGenerator {

    /// Generate mock wallet
    static func mockWallet(chainId: Int = 1) -> Wallet {
        return Wallet(
            id: UUID().uuidString,
            address: E2ETestConfig.testMnemonicAddress,
            name: E2ETestConfig.randomWalletName(),
            chainId: chainId,
            encryptedPrivateKey: Data(),
            createdAt: Date()
        )
    }

    /// Generate mock transaction
    static func mockTransaction(from: String, to: String) -> TransactionRecord {
        return TransactionRecord(
            id: UUID().uuidString,
            hash: "0x" + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(64)),
            from: from,
            to: to,
            value: E2ETestConfig.randomAmountWei(),
            gasLimit: "21000",
            gasPrice: E2ETestConfig.randomGasPrice(),
            nonce: "0",
            data: nil,
            chainId: 1,
            status: .pending,
            blockNumber: nil,
            timestamp: Date(),
            confirmations: 0
        )
    }

    /// Generate mock token
    static func mockToken(address: String) -> Token {
        let tokenInfo = E2ETestConfig.testTokenContracts[address] ?? ("Test Token", "TEST", 18)
        return Token(
            id: UUID().uuidString,
            address: address,
            chainId: 1,
            type: .erc20,
            name: tokenInfo.name,
            symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals,
            isCustom: true,
            isVerified: false
        )
    }

    /// Generate mock NFT
    static func mockNFT(contractAddress: String, tokenId: String) -> NFT {
        let collectionName = E2ETestConfig.testNFTContracts[contractAddress] ?? "Test Collection"
        return NFT(
            id: UUID().uuidString,
            contractAddress: contractAddress,
            tokenId: tokenId,
            chainId: 1,
            standard: .erc721,
            name: "\(collectionName) #\(tokenId)",
            imageUrl: nil,
            imageData: nil,
            balance: "1",
            attributes: []
        )
    }
}
