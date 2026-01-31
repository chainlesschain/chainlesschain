import XCTest
@testable import ChainlessChain

/// WalletE2ETests - End-to-End tests for wallet functionality
/// Tests complete user workflows for wallet creation, import, and management
class WalletE2ETests: XCTestCase {

    var walletManager: WalletManager!
    var database: Database!

    override func setUpWithError() throws {
        try super.setUpWithError()

        // Use test database
        database = Database.shared
        try database.connect(path: ":memory:", password: "test123")

        walletManager = WalletManager.shared
    }

    override func tearDownWithError() throws {
        // Clean up test data
        try walletManager.deleteAllWallets()
        try database.disconnect()

        try super.tearDownWithError()
    }

    // MARK: - E2E Test: Create Wallet Flow

    func testE2E_CreateWallet_FullFlow() async throws {
        // Given: User wants to create a new wallet
        let walletName = "Test Wallet"
        let password = "SecurePassword123!"

        // When: User creates wallet
        let wallet = try await walletManager.createWallet(
            name: walletName,
            password: password,
            chain: .ethereum
        )

        // Then: Wallet should be created successfully
        XCTAssertNotNil(wallet)
        XCTAssertEqual(wallet.name, walletName)
        XCTAssertEqual(wallet.chainId, 1) // Ethereum
        XCTAssertFalse(wallet.address.isEmpty)
        XCTAssertTrue(wallet.address.hasPrefix("0x"))
        XCTAssertEqual(wallet.address.count, 42) // 0x + 40 hex chars

        // And: Wallet should be in database
        let savedWallet = try await walletManager.getWallet(id: wallet.id)
        XCTAssertNotNil(savedWallet)
        XCTAssertEqual(savedWallet?.id, wallet.id)

        // And: Should be selected as current wallet
        XCTAssertEqual(walletManager.selectedWallet?.id, wallet.id)

        // And: Should be able to export mnemonic
        let mnemonic = try await walletManager.exportMnemonic(
            wallet: wallet,
            password: password
        )
        XCTAssertFalse(mnemonic.isEmpty)
        XCTAssertEqual(mnemonic.components(separatedBy: " ").count, 12) // 12-word mnemonic
    }

    // MARK: - E2E Test: Import Wallet Flow

    func testE2E_ImportWallet_FullFlow() async throws {
        // Given: User has a mnemonic phrase
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
        let walletName = "Imported Wallet"
        let password = "SecurePassword123!"

        // When: User imports wallet
        let wallet = try await walletManager.importWallet(
            mnemonic: mnemonic,
            name: walletName,
            password: password,
            chain: .ethereum
        )

        // Then: Wallet should be imported successfully
        XCTAssertNotNil(wallet)
        XCTAssertEqual(wallet.name, walletName)

        // And: Address should be deterministic
        XCTAssertEqual(wallet.address, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94")

        // And: Should be able to re-export same mnemonic
        let exportedMnemonic = try await walletManager.exportMnemonic(
            wallet: wallet,
            password: password
        )
        XCTAssertEqual(exportedMnemonic, mnemonic)
    }

    // MARK: - E2E Test: Multi-Wallet Management

    func testE2E_MultiWalletManagement_FullFlow() async throws {
        let password = "SecurePassword123!"

        // Given: User creates multiple wallets
        let wallet1 = try await walletManager.createWallet(
            name: "Wallet 1",
            password: password,
            chain: .ethereum
        )

        let wallet2 = try await walletManager.createWallet(
            name: "Wallet 2",
            password: password,
            chain: .polygon
        )

        let wallet3 = try await walletManager.createWallet(
            name: "Wallet 3",
            password: password,
            chain: .bsc
        )

        // When: User lists all wallets
        let wallets = try await walletManager.getAllWallets()

        // Then: All wallets should be present
        XCTAssertEqual(wallets.count, 3)
        XCTAssertTrue(wallets.contains(where: { $0.id == wallet1.id }))
        XCTAssertTrue(wallets.contains(where: { $0.id == wallet2.id }))
        XCTAssertTrue(wallets.contains(where: { $0.id == wallet3.id }))

        // When: User switches wallet
        try await walletManager.selectWallet(id: wallet2.id)

        // Then: Selected wallet should change
        XCTAssertEqual(walletManager.selectedWallet?.id, wallet2.id)
        XCTAssertEqual(walletManager.selectedWallet?.chainId, 137) // Polygon

        // When: User deletes a wallet
        try await walletManager.deleteWallet(id: wallet3.id, password: password)

        // Then: Wallet should be removed
        let remainingWallets = try await walletManager.getAllWallets()
        XCTAssertEqual(remainingWallets.count, 2)
        XCTAssertFalse(remainingWallets.contains(where: { $0.id == wallet3.id }))
    }

    // MARK: - E2E Test: Password Change

    func testE2E_PasswordChange_FullFlow() async throws {
        // Given: User has a wallet
        let wallet = try await walletManager.createWallet(
            name: "Test Wallet",
            password: "OldPassword123!",
            chain: .ethereum
        )

        let originalMnemonic = try await walletManager.exportMnemonic(
            wallet: wallet,
            password: "OldPassword123!"
        )

        // When: User changes password
        let newPassword = "NewPassword456!"
        try await walletManager.changePassword(
            wallet: wallet,
            oldPassword: "OldPassword123!",
            newPassword: newPassword
        )

        // Then: Should be able to export with new password
        let mnemonicWithNewPassword = try await walletManager.exportMnemonic(
            wallet: wallet,
            password: newPassword
        )
        XCTAssertEqual(mnemonicWithNewPassword, originalMnemonic)

        // And: Old password should no longer work
        do {
            _ = try await walletManager.exportMnemonic(
                wallet: wallet,
                password: "OldPassword123!"
            )
            XCTFail("Should not export with old password")
        } catch {
            // Expected to fail
        }
    }

    // MARK: - E2E Test: Wallet Recovery

    func testE2E_WalletRecovery_FullFlow() async throws {
        let password = "SecurePassword123!"

        // Given: User creates wallet and exports mnemonic
        let originalWallet = try await walletManager.createWallet(
            name: "Original Wallet",
            password: password,
            chain: .ethereum
        )

        let mnemonic = try await walletManager.exportMnemonic(
            wallet: originalWallet,
            password: password
        )

        let originalAddress = originalWallet.address

        // When: User deletes wallet and recovers it
        try await walletManager.deleteWallet(id: originalWallet.id, password: password)

        let recoveredWallet = try await walletManager.importWallet(
            mnemonic: mnemonic,
            name: "Recovered Wallet",
            password: password,
            chain: .ethereum
        )

        // Then: Recovered wallet should have same address
        XCTAssertEqual(recoveredWallet.address, originalAddress)

        // And: Should be able to export same mnemonic
        let recoveredMnemonic = try await walletManager.exportMnemonic(
            wallet: recoveredWallet,
            password: password
        )
        XCTAssertEqual(recoveredMnemonic, mnemonic)
    }

    // MARK: - E2E Test: Multi-Chain Support

    func testE2E_MultiChainSupport_FullFlow() async throws {
        let password = "SecurePassword123!"
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

        // Given: User imports wallet on different chains
        let ethWallet = try await walletManager.importWallet(
            mnemonic: mnemonic,
            name: "ETH Wallet",
            password: password,
            chain: .ethereum
        )

        let polyWallet = try await walletManager.importWallet(
            mnemonic: mnemonic,
            name: "Polygon Wallet",
            password: password,
            chain: .polygon
        )

        let bscWallet = try await walletManager.importWallet(
            mnemonic: mnemonic,
            name: "BSC Wallet",
            password: password,
            chain: .bsc
        )

        // Then: All wallets should have same address (same mnemonic)
        XCTAssertEqual(ethWallet.address, polyWallet.address)
        XCTAssertEqual(ethWallet.address, bscWallet.address)

        // But: Different chain IDs
        XCTAssertEqual(ethWallet.chainId, 1)    // Ethereum
        XCTAssertEqual(polyWallet.chainId, 137) // Polygon
        XCTAssertEqual(bscWallet.chainId, 56)   // BSC
    }

    // MARK: - Performance Tests

    func testE2E_Performance_CreateMultipleWallets() throws {
        let password = "SecurePassword123!"

        measure {
            // Measure time to create 10 wallets
            for i in 0..<10 {
                let expectation = XCTestExpectation(description: "Create wallet \(i)")

                Task {
                    do {
                        _ = try await walletManager.createWallet(
                            name: "Wallet \(i)",
                            password: password,
                            chain: .ethereum
                        )
                        expectation.fulfill()
                    } catch {
                        XCTFail("Failed to create wallet: \(error)")
                    }
                }

                wait(for: [expectation], timeout: 5.0)
            }
        }
    }
}
